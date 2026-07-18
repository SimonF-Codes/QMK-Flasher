//! DFU bootloader presence watching.
//!
//! Polls `nusb::list_devices()` (1 s) for the STM32 ROM bootloader
//! (0483:df11). Presence transitions are reported through a callback — the
//! command layer forwards them to the webview as `dfu-device {present}`
//! events. Flashing additionally waits a ~500 ms debounce after appearance
//! so Windows finishes binding the driver before we open the device.
//!
//! The state machine (`DebouncedWatcher`) is pure and unit-tested with fake
//! clocks/device lists; only the thin poll loops touch USB.

use std::time::{Duration, Instant};

use nusb::MaybeFuture;

use crate::flash::pipeline::CancelToken;

/// STM32 ROM DFU bootloader USB vendor id.
pub const DFU_VID: u16 = 0x0483;
/// STM32 ROM DFU bootloader USB product id.
pub const DFU_PID: u16 = 0xdf11;

/// How often the bus is polled.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// How long a device must stay present before flashing may start.
pub const DEBOUNCE: Duration = Duration::from_millis(500);

/// A presence edge observed by the watcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    Appeared,
    Disappeared,
}

/// Pure presence/debounce state machine.
#[derive(Debug)]
pub struct DebouncedWatcher {
    debounce: Duration,
    present: bool,
    appeared_at: Option<Instant>,
}

impl DebouncedWatcher {
    pub fn new(debounce: Duration) -> Self {
        Self { debounce, present: false, appeared_at: None }
    }

    /// Feed one poll sample. Returns the edge, if this sample is one.
    pub fn observe(&mut self, seen: bool, now: Instant) -> Option<Transition> {
        match (self.present, seen) {
            (false, true) => {
                self.present = true;
                self.appeared_at = Some(now);
                Some(Transition::Appeared)
            }
            (true, false) => {
                self.present = false;
                self.appeared_at = None;
                Some(Transition::Disappeared)
            }
            _ => None,
        }
    }

    pub fn present(&self) -> bool {
        self.present
    }

    /// True once the device has been present for at least the debounce
    /// window — the gate for starting a flash.
    pub fn ready(&self, now: Instant) -> bool {
        match self.appeared_at {
            Some(at) => self.present && now.duration_since(at) >= self.debounce,
            None => false,
        }
    }
}

/// One blocking bus scan: is a 0483:df11 device attached?
pub fn is_dfu_present() -> bool {
    match nusb::list_devices().wait() {
        Ok(mut devices) => {
            devices.any(|d| d.vendor_id() == DFU_VID && d.product_id() == DFU_PID)
        }
        Err(e) => {
            log::warn!("USB enumeration failed: {e}");
            false
        }
    }
}

/// Generic poll loop: samples `poll` every `interval`, reporting presence
/// edges to `on_transition`, until `cancel` fires. Returns when cancelled.
pub fn watch_until_cancelled<P, F>(
    mut poll: P,
    mut on_transition: F,
    cancel: &CancelToken,
    interval: Duration,
) where
    P: FnMut() -> bool,
    F: FnMut(bool),
{
    let mut watcher = DebouncedWatcher::new(DEBOUNCE);
    while !cancel.is_cancelled() {
        if let Some(t) = watcher.observe(poll(), Instant::now()) {
            on_transition(t == Transition::Appeared);
        }
        std::thread::sleep(interval);
    }
}

/// Spawn the app-lifetime watcher thread. The callback receives presence
/// edges; the command layer (lib.rs setup) emits `dfu-device` from it.
/// The thread runs until the process exits.
pub fn spawn(on_transition: impl FnMut(bool) + Send + 'static) {
    std::thread::Builder::new()
        .name("dfu-watcher".into())
        .spawn(move || {
            // Never-cancelled token: the watcher lives as long as the app.
            watch_until_cancelled(is_dfu_present, on_transition, &CancelToken::default(), POLL_INTERVAL)
        })
        .expect("failed to spawn dfu-watcher thread");
}

/// Outcome of waiting for the bootloader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitOutcome {
    /// Device present and debounced — safe to open and flash.
    Ready,
    /// The pipeline was cancelled while waiting.
    Cancelled,
}

/// Block until a DFU device is present for the debounce window, or the
/// token is cancelled. There is deliberately no timeout: `DfuNotFound` is
/// not fatal — the UI shows reset instructions and the user can cancel.
pub fn wait_for_bootloader(cancel: &CancelToken) -> WaitOutcome {
    wait_with_poll(is_dfu_present, cancel, POLL_INTERVAL, DEBOUNCE, Instant::now)
}

/// Testable core of [`wait_for_bootloader`]: injected poll fn and clock,
/// sleeping `interval` between samples (skipped when interval is zero).
pub fn wait_with_poll<P, C>(
    mut poll: P,
    cancel: &CancelToken,
    interval: Duration,
    debounce: Duration,
    mut now: C,
) -> WaitOutcome
where
    P: FnMut() -> bool,
    C: FnMut() -> Instant,
{
    let mut watcher = DebouncedWatcher::new(debounce);
    loop {
        if cancel.is_cancelled() {
            return WaitOutcome::Cancelled;
        }
        watcher.observe(poll(), now());
        if watcher.ready(now()) {
            return WaitOutcome::Ready;
        }
        if !interval.is_zero() {
            // Once present, poll faster so the debounce gate adds at most
            // ~debounce, not debounce + a full poll interval.
            let sleep = if watcher.present() { debounce.min(interval) } else { interval };
            std::thread::sleep(sleep);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn reports_appearance_and_disappearance_edges_once() {
        let base = Instant::now();
        let mut w = DebouncedWatcher::new(DEBOUNCE);
        assert_eq!(w.observe(false, t(base, 0)), None);
        assert_eq!(w.observe(true, t(base, 1000)), Some(Transition::Appeared));
        assert_eq!(w.observe(true, t(base, 2000)), None);
        assert_eq!(w.observe(false, t(base, 3000)), Some(Transition::Disappeared));
        assert_eq!(w.observe(false, t(base, 4000)), None);
    }

    #[test]
    fn ready_only_after_debounce_window() {
        let base = Instant::now();
        let mut w = DebouncedWatcher::new(Duration::from_millis(500));
        w.observe(true, t(base, 0));
        assert!(!w.ready(t(base, 0)));
        assert!(!w.ready(t(base, 499)));
        assert!(w.ready(t(base, 500)));
        assert!(w.ready(t(base, 10_000)));
    }

    #[test]
    fn flapping_resets_debounce() {
        let base = Instant::now();
        let mut w = DebouncedWatcher::new(Duration::from_millis(500));
        w.observe(true, t(base, 0));
        w.observe(false, t(base, 200));
        assert!(!w.ready(t(base, 600)));
        w.observe(true, t(base, 700));
        assert!(!w.ready(t(base, 1100)));
        assert!(w.ready(t(base, 1200)));
    }

    #[test]
    fn never_ready_while_absent() {
        let base = Instant::now();
        let w = DebouncedWatcher::new(Duration::from_millis(500));
        assert!(!w.ready(t(base, 10_000)));
    }

    #[test]
    fn wait_returns_ready_after_device_settles() {
        let base = Instant::now();
        // Scripted samples: absent twice, then present.
        let samples = std::cell::Cell::new(0u32);
        let poll = || {
            let n = samples.get();
            samples.set(n + 1);
            n >= 2
        };
        // Fake clock advancing 300 ms per query — debounce needs 2 present samples.
        let ticks = std::cell::Cell::new(0u64);
        let now = || {
            let n = ticks.get();
            ticks.set(n + 1);
            t(base, n * 300)
        };
        let outcome = wait_with_poll(
            poll,
            &CancelToken::default(),
            Duration::ZERO,
            Duration::from_millis(500),
            now,
        );
        assert_eq!(outcome, WaitOutcome::Ready);
        assert!(samples.get() >= 3, "must have kept polling until present");
    }

    #[test]
    fn wait_observes_cancellation() {
        let cancel = CancelToken::default();
        cancel.cancel();
        let outcome = wait_with_poll(
            || false,
            &cancel,
            Duration::ZERO,
            Duration::from_millis(500),
            Instant::now,
        );
        assert_eq!(outcome, WaitOutcome::Cancelled);
    }

    #[test]
    fn wait_cancelled_mid_wait() {
        let cancel = CancelToken::default();
        let cancel2 = cancel.clone();
        let count = std::cell::Cell::new(0u32);
        let poll = move || {
            let n = count.get();
            count.set(n + 1);
            if n == 5 {
                cancel2.cancel();
            }
            false // device never shows up
        };
        let outcome = wait_with_poll(
            poll,
            &cancel,
            Duration::ZERO,
            Duration::from_millis(500),
            Instant::now,
        );
        assert_eq!(outcome, WaitOutcome::Cancelled);
    }
}
