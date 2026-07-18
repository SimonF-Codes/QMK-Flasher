//! The Build & Flash pipeline: save → generate → build →
//! waitingForBootloader → erasing/flashing → leaving → done, emitting
//! `pipeline-state` at every transition through the caller's callback.
//!
//! Cancellation: one pipeline may run at a time; its [`CancelToken`] is
//! registered module-globally so the `cancel_pipeline` command (which has
//! no handle to the running pipeline) can fire it. A cancelled pipeline is
//! not an error — it emits phase `idle` (detail "cancelled") and returns
//! `Ok(())`.
//!
//! Worker A's `codegen::`/`build::` functions are called through their
//! public signatures; their stub bodies become real at merge.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::AppError;
use crate::events::{PipelinePhase, PipelineState};
use crate::flash::dfu::{self, FlashEvent, FlashOutcome, Flasher};
use crate::flash::watcher::{self, WaitOutcome};
use crate::layout::LayoutFile;
use crate::{build, codegen, layout};

/// Cooperative cancellation flag shared between the pipeline and the
/// `cancel_pipeline` command.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// The token of the currently running pipeline, if any. `Mutex<Option<..>>`
/// instead of Tauri managed state so `cancel_pipeline` works without an
/// `AppHandle` (its command signature is frozen without one).
static ACTIVE: Mutex<Option<CancelToken>> = Mutex::new(None);

/// Clears the active-token slot when the pipeline ends, however it ends.
#[derive(Debug)]
struct ActiveGuard;

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        *ACTIVE.lock().expect("pipeline lock poisoned") = None;
    }
}

/// Register a new pipeline run. Fails if one is already in flight — racing
/// two DFU downloads against one bootloader must never happen.
fn begin() -> Result<(CancelToken, ActiveGuard), AppError> {
    let mut active = ACTIVE.lock().expect("pipeline lock poisoned");
    if active.is_some() {
        return Err(AppError::BuildFailed(
            "a flash pipeline is already running — cancel it first".into(),
        ));
    }
    let token = CancelToken::default();
    *active = Some(token.clone());
    Ok((token, ActiveGuard))
}

/// Cancel the running pipeline. A no-op when nothing is running.
pub fn cancel() -> Result<(), AppError> {
    if let Some(token) = ACTIVE.lock().expect("pipeline lock poisoned").as_ref() {
        token.cancel();
    }
    Ok(())
}

/// The pipeline's dependencies, injectable so phase sequencing and
/// cancellation are unit-testable without hardware or a toolchain.
pub trait PipelineOps {
    fn save(&mut self, layout: &LayoutFile) -> Result<(), AppError>;
    fn generate(&mut self, layout: &LayoutFile) -> Result<(), AppError>;
    fn build(&mut self, on_log: &mut dyn FnMut(String)) -> Result<String, AppError>;
    fn read_firmware(&mut self, bin_path: &str) -> Result<Vec<u8>, AppError>;
    fn wait_for_bootloader(&mut self, cancel: &CancelToken) -> WaitOutcome;
    fn flasher(&mut self) -> &mut dyn Flasher;
}

/// Production wiring: real store/codegen/build/watcher plus the configured
/// DFU backend.
struct RealOps {
    flasher: Box<dyn Flasher + Send>,
}

impl RealOps {
    fn new() -> Self {
        Self { flasher: dfu::default_flasher() }
    }
}

impl PipelineOps for RealOps {
    fn save(&mut self, layout: &LayoutFile) -> Result<(), AppError> {
        layout::store::save(layout)
    }

    fn generate(&mut self, layout: &LayoutFile) -> Result<(), AppError> {
        codegen::generate(layout).map(|_| ())
    }

    fn build(&mut self, on_log: &mut dyn FnMut(String)) -> Result<String, AppError> {
        build::build_firmware(|line| on_log(line))
    }

    fn read_firmware(&mut self, bin_path: &str) -> Result<Vec<u8>, AppError> {
        read_firmware_file(bin_path)
    }

    fn wait_for_bootloader(&mut self, cancel: &CancelToken) -> WaitOutcome {
        watcher::wait_for_bootloader(cancel)
    }

    fn flasher(&mut self) -> &mut dyn Flasher {
        self.flasher.as_mut()
    }
}

pub fn read_firmware_file(bin_path: &str) -> Result<Vec<u8>, AppError> {
    let firmware = std::fs::read(bin_path).map_err(|e| {
        AppError::BuildFailed(format!("cannot read firmware image {bin_path}: {e}"))
    })?;
    dfu::validate_firmware(&firmware)?;
    Ok(firmware)
}

/// Full pipeline behind the `start_flash_pipeline` command.
pub fn run_full(
    layout: &LayoutFile,
    mut on_state: impl FnMut(PipelineState),
    mut on_log: impl FnMut(String),
) -> Result<(), AppError> {
    let (token, _guard) = begin()?;
    run_with(layout, &mut RealOps::new(), &mut on_state, &mut on_log, &token)
}

/// Flash an already-built image (the `flash_firmware` command): skips
/// save/generate/build, keeps the wait + flash phases and cancellation.
pub fn flash_only(
    bin_path: &str,
    mut on_state: impl FnMut(PipelineState),
) -> Result<(), AppError> {
    let (token, _guard) = begin()?;
    flash_only_with(bin_path, &mut RealOps::new(), &mut on_state, &token)
}

/// Emitted when a run is cancelled: back to idle, not an error.
fn cancelled_state() -> PipelineState {
    PipelineState {
        phase: PipelinePhase::Idle,
        detail: Some("cancelled".into()),
        progress: None,
    }
}

const RESET_INSTRUCTIONS: &str =
    "Press the reset button through the small hole next to the left thumb cluster";

pub fn run_with(
    layout: &LayoutFile,
    ops: &mut dyn PipelineOps,
    on_state: &mut dyn FnMut(PipelineState),
    on_log: &mut dyn FnMut(String),
    cancel: &CancelToken,
) -> Result<(), AppError> {
    macro_rules! bail_if_cancelled {
        () => {
            if cancel.is_cancelled() {
                on_state(cancelled_state());
                return Ok(());
            }
        };
    }

    bail_if_cancelled!();
    on_state(PipelineState::phase(PipelinePhase::Saving));
    ops.save(layout)?;

    bail_if_cancelled!();
    on_state(PipelineState::phase(PipelinePhase::Generating));
    ops.generate(layout)?;

    bail_if_cancelled!();
    on_state(PipelineState::phase(PipelinePhase::Building));
    let bin_path = ops.build(on_log)?;
    // Read (and sanity-check) the image before asking the user to reset the
    // board, so a bad build fails fast.
    let firmware = ops.read_firmware(&bin_path)?;

    flash_stage(ops, &firmware, on_state, cancel)
}

fn flash_only_with(
    bin_path: &str,
    ops: &mut dyn PipelineOps,
    on_state: &mut dyn FnMut(PipelineState),
    cancel: &CancelToken,
) -> Result<(), AppError> {
    let firmware = ops.read_firmware(bin_path)?;
    flash_stage(ops, &firmware, on_state, cancel)
}

/// The shared tail: waitingForBootloader → erasing → flashing → leaving →
/// done.
fn flash_stage(
    ops: &mut dyn PipelineOps,
    firmware: &[u8],
    on_state: &mut dyn FnMut(PipelineState),
    cancel: &CancelToken,
) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        on_state(cancelled_state());
        return Ok(());
    }
    on_state(PipelineState {
        phase: PipelinePhase::WaitingForBootloader,
        detail: Some(RESET_INSTRUCTIONS.into()),
        progress: None,
    });
    match ops.wait_for_bootloader(cancel) {
        WaitOutcome::Cancelled => {
            on_state(cancelled_state());
            return Ok(());
        }
        WaitOutcome::Ready => {}
    }

    let mut forward = |event: FlashEvent| on_state(flash_event_to_state(event));
    match ops.flasher().flash(firmware, &mut forward, cancel)? {
        FlashOutcome::Cancelled => {
            on_state(cancelled_state());
            Ok(())
        }
        FlashOutcome::Completed => {
            on_state(PipelineState::phase(PipelinePhase::Done));
            Ok(())
        }
    }
}

fn flash_event_to_state(event: FlashEvent) -> PipelineState {
    match event {
        FlashEvent::Erasing { progress } => PipelineState {
            phase: PipelinePhase::Erasing,
            detail: None,
            progress: progress.map(to_percent),
        },
        FlashEvent::Downloading { progress } => PipelineState {
            phase: PipelinePhase::Flashing,
            detail: None,
            progress: Some(to_percent(progress)),
        },
        FlashEvent::Leaving => PipelineState::phase(PipelinePhase::Leaving),
    }
}

fn to_percent(fraction: f32) -> u8 {
    (fraction.clamp(0.0, 1.0) * 100.0).round() as u8
}

#[cfg(test)]
pub(crate) static TEST_PIPELINE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes tests that touch the module-global ACTIVE slot.
    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_PIPELINE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct FakeFlasher {
        events: Vec<FlashEvent>,
        outcome: Result<FlashOutcome, AppError>,
        /// Cancel the token after this many events, if set.
        cancel_after: Option<usize>,
    }

    impl Flasher for FakeFlasher {
        fn flash(
            &mut self,
            _firmware: &[u8],
            on_event: &mut dyn FnMut(FlashEvent),
            cancel: &CancelToken,
        ) -> Result<FlashOutcome, AppError> {
            for (i, e) in self.events.iter().enumerate() {
                if Some(i) == self.cancel_after {
                    cancel.cancel();
                }
                if cancel.is_cancelled() {
                    return Ok(FlashOutcome::Cancelled);
                }
                on_event(*e);
            }
            match &self.outcome {
                Ok(o) => Ok(*o),
                Err(_) => Err(AppError::DfuVerifyFailed("fake failure".into())),
            }
        }
    }

    struct FakeOps {
        calls: Vec<&'static str>,
        build_result: Result<String, AppError>,
        wait_outcome: WaitOutcome,
        flasher: FakeFlasher,
        cancel_during_wait: bool,
    }

    impl FakeOps {
        fn happy() -> Self {
            Self {
                calls: Vec::new(),
                build_result: Ok("fake.bin".into()),
                wait_outcome: WaitOutcome::Ready,
                flasher: FakeFlasher {
                    events: vec![
                        FlashEvent::Erasing { progress: None },
                        FlashEvent::Downloading { progress: 0.5 },
                        FlashEvent::Downloading { progress: 1.0 },
                        FlashEvent::Leaving,
                    ],
                    outcome: Ok(FlashOutcome::Completed),
                    cancel_after: None,
                },
                cancel_during_wait: false,
            }
        }
    }

    impl PipelineOps for FakeOps {
        fn save(&mut self, _layout: &LayoutFile) -> Result<(), AppError> {
            self.calls.push("save");
            Ok(())
        }

        fn generate(&mut self, _layout: &LayoutFile) -> Result<(), AppError> {
            self.calls.push("generate");
            Ok(())
        }

        fn build(&mut self, on_log: &mut dyn FnMut(String)) -> Result<String, AppError> {
            self.calls.push("build");
            on_log("make: fake".into());
            match &self.build_result {
                Ok(p) => Ok(p.clone()),
                Err(_) => Err(AppError::BuildFailed("make exited 2".into())),
            }
        }

        fn read_firmware(&mut self, _bin_path: &str) -> Result<Vec<u8>, AppError> {
            self.calls.push("read_firmware");
            Ok(vec![0u8; 64])
        }

        fn wait_for_bootloader(&mut self, cancel: &CancelToken) -> WaitOutcome {
            self.calls.push("wait");
            if self.cancel_during_wait {
                cancel.cancel();
                return WaitOutcome::Cancelled;
            }
            self.wait_outcome
        }

        fn flasher(&mut self) -> &mut dyn Flasher {
            &mut self.flasher
        }
    }

    fn fixture_layout() -> LayoutFile {
        layout::store::load().expect("fixture layout loads")
    }

    fn run(ops: &mut FakeOps) -> (Result<(), AppError>, Vec<PipelineState>, Vec<String>) {
        let mut states = Vec::new();
        let mut logs = Vec::new();
        let cancel = CancelToken::default();
        let result = run_with(
            &fixture_layout(),
            ops,
            &mut |s| states.push(s),
            &mut |l| logs.push(l),
            &cancel,
        );
        (result, states, logs)
    }

    fn phases(states: &[PipelineState]) -> Vec<PipelinePhase> {
        states.iter().map(|s| s.phase).collect()
    }

    #[test]
    fn happy_path_emits_full_phase_sequence() {
        let mut ops = FakeOps::happy();
        let (result, states, logs) = run(&mut ops);
        assert!(result.is_ok());
        assert_eq!(
            phases(&states),
            vec![
                PipelinePhase::Saving,
                PipelinePhase::Generating,
                PipelinePhase::Building,
                PipelinePhase::WaitingForBootloader,
                PipelinePhase::Erasing,
                PipelinePhase::Flashing,
                PipelinePhase::Flashing,
                PipelinePhase::Leaving,
                PipelinePhase::Done,
            ]
        );
        assert_eq!(
            ops.calls,
            vec!["save", "generate", "build", "read_firmware", "wait"]
        );
        assert_eq!(logs, vec!["make: fake".to_string()]);
        // Progress forwarded as 0–100 within the flashing phase.
        let flashing: Vec<Option<u8>> = states
            .iter()
            .filter(|s| s.phase == PipelinePhase::Flashing)
            .map(|s| s.progress)
            .collect();
        assert_eq!(flashing, vec![Some(50), Some(100)]);
        // The bootloader wait carries the reset instructions.
        let waiting = states
            .iter()
            .find(|s| s.phase == PipelinePhase::WaitingForBootloader)
            .unwrap();
        assert!(waiting.detail.as_deref().unwrap().contains("reset button"));
    }

    #[test]
    fn build_failure_stops_pipeline_and_returns_error() {
        let mut ops = FakeOps::happy();
        ops.build_result = Err(AppError::BuildFailed("make exited 2".into()));
        let (result, states, _) = run(&mut ops);
        assert_eq!(result.unwrap_err().code(), "BuildFailed");
        assert_eq!(
            phases(&states),
            vec![
                PipelinePhase::Saving,
                PipelinePhase::Generating,
                PipelinePhase::Building,
            ]
        );
        assert!(ops.calls.iter().all(|c| *c != "wait"), "must not reach the wait");
    }

    #[test]
    fn flash_failure_returns_error_without_done() {
        let mut ops = FakeOps::happy();
        ops.flasher.outcome = Err(AppError::DfuVerifyFailed("fake".into()));
        let (result, states, _) = run(&mut ops);
        assert_eq!(result.unwrap_err().code(), "DfuVerifyFailed");
        assert!(!phases(&states).contains(&PipelinePhase::Done));
    }

    #[test]
    fn cancellation_during_wait_returns_ok_and_goes_idle() {
        let mut ops = FakeOps::happy();
        ops.cancel_during_wait = true;
        let (result, states, _) = run(&mut ops);
        assert!(result.is_ok());
        let last = states.last().unwrap();
        assert_eq!(last.phase, PipelinePhase::Idle);
        assert_eq!(last.detail.as_deref(), Some("cancelled"));
        assert!(!phases(&states).contains(&PipelinePhase::Done));
    }

    #[test]
    fn cancellation_mid_flash_returns_ok_and_goes_idle() {
        let mut ops = FakeOps::happy();
        ops.flasher.cancel_after = Some(2); // after erase + first progress
        let (result, states, _) = run(&mut ops);
        assert!(result.is_ok());
        assert_eq!(states.last().unwrap().phase, PipelinePhase::Idle);
        assert!(phases(&states).contains(&PipelinePhase::Erasing));
        assert!(!phases(&states).contains(&PipelinePhase::Leaving));
        assert!(!phases(&states).contains(&PipelinePhase::Done));
    }

    #[test]
    fn pre_cancelled_token_short_circuits_before_saving() {
        let mut ops = FakeOps::happy();
        let cancel = CancelToken::default();
        cancel.cancel();
        let mut states = Vec::new();
        let result = run_with(
            &fixture_layout(),
            &mut ops,
            &mut |s| states.push(s),
            &mut |_| {},
            &cancel,
        );
        assert!(result.is_ok());
        assert_eq!(phases(&states), vec![PipelinePhase::Idle]);
        assert!(ops.calls.is_empty());
    }

    #[test]
    fn only_one_pipeline_may_run_at_a_time() {
        let _lock = test_lock();
        let (token, guard) = begin().expect("first begin succeeds");
        let second = begin();
        assert!(second.is_err());
        assert!(second.unwrap_err().to_string().contains("already running"));
        assert!(!token.is_cancelled());
        drop(guard);
        let (_token2, _guard2) = begin().expect("slot freed after guard drop");
    }

    #[test]
    fn cancel_command_fires_the_active_token() {
        let _lock = test_lock();
        assert!(cancel().is_ok(), "cancel with no active pipeline is a no-op");
        let (token, _guard) = begin().unwrap();
        assert!(!token.is_cancelled());
        cancel().unwrap();
        assert!(token.is_cancelled());
    }

    #[test]
    fn flash_only_skips_build_phases() {
        let mut ops = FakeOps::happy();
        let mut states = Vec::new();
        let cancel = CancelToken::default();
        let result =
            flash_only_with("fake.bin", &mut ops, &mut |s| states.push(s), &cancel);
        assert!(result.is_ok());
        assert_eq!(
            phases(&states),
            vec![
                PipelinePhase::WaitingForBootloader,
                PipelinePhase::Erasing,
                PipelinePhase::Flashing,
                PipelinePhase::Flashing,
                PipelinePhase::Leaving,
                PipelinePhase::Done,
            ]
        );
        assert_eq!(ops.calls, vec!["read_firmware", "wait"]);
    }

    #[test]
    fn to_percent_clamps_and_rounds() {
        assert_eq!(to_percent(-0.5), 0);
        assert_eq!(to_percent(0.004), 0);
        assert_eq!(to_percent(0.5), 50);
        assert_eq!(to_percent(0.996), 100);
        assert_eq!(to_percent(1.5), 100);
    }
}
