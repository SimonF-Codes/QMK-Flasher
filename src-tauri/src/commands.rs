//! Tauri commands — the invoke surface of the app. See `docs/CONTRACT.md`.
//!
//! FROZEN contract after Phase 0: thin delegation into the worker-owned
//! modules (`oryx`, `codegen`, `build`, `flash`) plus foundation-owned
//! `layout::store`, `appcfg`, `geometry`. Workers replace module bodies;
//! signatures here change only with a contract bump on main.

use tauri::AppHandle;

use crate::appcfg::{self, AppConfig};
use crate::codegen::{self, GeneratedSources};
use crate::error::AppError;
use crate::events::{
    emit_build_log, emit_key_report, emit_layer_report, emit_pipeline_state,
    PipelinePhase, PipelineState,
};
use crate::f75;
use crate::flash::{self, DfuDeviceInfo};
use crate::geometry::{self, GeometryFile};
use crate::keyboards::{self, KeyboardInfo};
use crate::keyreport::{self, Report};
use crate::layout::store::{LayoutSummary, LayoutVersionSummary, VersionReason};
use crate::layout::{store, LayoutFile};
use crate::{build, oryx};

#[tauri::command]
pub fn load_layout() -> Result<LayoutFile, AppError> {
    store::load()
}

#[tauri::command]
pub fn save_layout(layout: LayoutFile) -> Result<(), AppError> {
    store::save_with_history(&layout)
}

#[tauri::command]
pub fn seed_from_oryx(layout_id: String, force: bool) -> Result<LayoutFile, AppError> {
    oryx::seed_from_oryx(&layout_id, force)
}

#[tauri::command]
pub fn get_geometry() -> Result<GeometryFile, AppError> {
    geometry::get()
}

// -- multi-layout / multi-keyboard (additive, 2026-07-19) -------------------

#[tauri::command]
pub fn list_layouts() -> Result<Vec<LayoutSummary>, AppError> {
    store::list_layouts()
}

/// Sets the active layout and returns it.
#[tauri::command]
pub fn select_layout(id: String) -> Result<LayoutFile, AppError> {
    store::select_layout(&id)
}

/// Creates a blank layout for `keyboard_id`; does NOT change the active
/// layout.
#[tauri::command]
pub fn create_layout(name: String, keyboard_id: String) -> Result<LayoutSummary, AppError> {
    store::create_layout(&name, &keyboard_id)
}

#[tauri::command]
pub fn duplicate_layout(id: String, new_name: String) -> Result<LayoutSummary, AppError> {
    store::duplicate_layout(&id, &new_name)
}

/// Renames the display name; the id (filename) is stable.
#[tauri::command]
pub fn rename_layout(id: String, name: String) -> Result<LayoutSummary, AppError> {
    store::rename_layout(&id, &name)
}

/// Refuses to delete the active layout.
#[tauri::command]
pub fn delete_layout(id: String) -> Result<(), AppError> {
    store::delete_layout(&id)
}

// -- layout version history (additive, 2026-07-21) --------------------------

/// Versions of `layout_id`, newest first.
#[tauri::command]
pub fn list_layout_versions(layout_id: String) -> Result<Vec<LayoutVersionSummary>, AppError> {
    store::list_layout_versions(&layout_id)
}

/// Snapshots the current as `preRestore`, overwrites it with `version_id`'s
/// content, and returns the restored layout (now active/current). The restore
/// is itself undoable via the `preRestore` snapshot it creates.
#[tauri::command]
pub fn restore_layout_version(
    layout_id: String,
    version_id: String,
) -> Result<LayoutFile, AppError> {
    store::restore_layout_version(&layout_id, &version_id)
}

/// Explicit user-requested snapshot. `reason` must be `"manual"`; the other
/// reasons are auto-snapshot only.
#[tauri::command]
pub fn snapshot_layout(
    layout_id: String,
    reason: String,
    label: Option<String>,
) -> Result<LayoutVersionSummary, AppError> {
    if reason != "manual" {
        return Err(AppError::InvalidLayout(format!(
            "snapshot_layout only accepts reason \"manual\", got {reason:?}"
        )));
    }
    store::snapshot_layout(&layout_id, VersionReason::Manual, label)
}

#[tauri::command]
pub fn list_keyboards() -> Vec<KeyboardInfo> {
    keyboards::all().to_vec()
}

#[tauri::command]
pub fn get_keyboard_geometry(keyboard_id: String) -> Result<GeometryFile, AppError> {
    geometry::get_for_keyboard(&keyboard_id)
}

#[tauri::command]
pub fn get_app_config() -> AppConfig {
    appcfg::get()
}

#[tauri::command]
pub fn set_app_config(cfg: AppConfig) -> Result<(), AppError> {
    appcfg::set(&cfg)
}

#[tauri::command]
pub fn generate_sources(layout: LayoutFile) -> Result<GeneratedSources, AppError> {
    codegen::generate(&layout)
}

/// Build only; returns the .bin path. Streams `build-log` events.
#[tauri::command]
pub fn build_firmware(app: AppHandle) -> Result<String, AppError> {
    build::build_firmware(|line| emit_build_log(&app, line))
}

/// Full pipeline: save → generate → build → flash, driven by
/// `pipeline-state` (+ `build-log`) events. On error, emits phase `error`
/// with the message in `detail` and also returns the `AppError`.
/// `(async)`: runs on a worker thread — it blocks for minutes (build) and
/// on the user pressing the reset button.
#[tauri::command(async)]
pub fn start_flash_pipeline(app: AppHandle, layout: LayoutFile) -> Result<(), AppError> {
    flash::pipeline::run_full(
        &layout,
        |state| emit_pipeline_state(&app, state),
        |line| emit_build_log(&app, line),
    )
    .inspect_err(|e| {
        emit_pipeline_state(
            &app,
            PipelineState {
                phase: PipelinePhase::Error,
                detail: Some(e.to_string()),
                progress: None,
            },
        )
    })
}

#[tauri::command]
pub fn cancel_pipeline() -> Result<(), AppError> {
    flash::cancel()
}

#[tauri::command]
pub fn list_dfu_devices() -> Result<Vec<DfuDeviceInfo>, AppError> {
    flash::list_dfu_devices()
}

/// Flash an already-built image (no rebuild). Streams `pipeline-state`.
/// `(async)`: blocks on the user pressing the reset button.
#[tauri::command(async)]
pub fn flash_firmware(app: AppHandle, bin_path: String) -> Result<(), AppError> {
    flash::flash_firmware(&bin_path, |state| emit_pipeline_state(&app, state)).inspect_err(
        |e| {
            emit_pipeline_state(
                &app,
                PipelineState {
                    phase: PipelinePhase::Error,
                    detail: Some(e.to_string()),
                    progress: None,
                },
            )
        },
    )
}

// -- live key reports (additive, 2026-08-01) --------------------------------

/// Open the board's raw-HID channel and stream `key-report` / `layer-report`
/// events until `stop_key_reporting`.
///
/// Deliberately a command pair rather than an app-lifetime listener like
/// `flash::watcher`: pairing sets the board's `rawhid_state.paired` flag, which
/// ZSA Keymapp and Oryx also use, so the pairing is held only while live view
/// or the trainer is actually on. Fails with `KeyReportUnavailable` when the
/// channel cannot be opened, so the UI can say why instead of showing a live
/// view that never lights up.
///
/// `(async)`: runs on a worker thread, and MUST — same reason as
/// `start_flash_pipeline` above, at a smaller scale. The up-front probe in
/// `keyreport::start` enumerates every HID interface on the machine (dozens on
/// a box that has seen a few ZSA boards) and then opens one; on Windows that is
/// seconds of blocking work. Run on the main thread it stops the window pumping
/// messages and Windows kills the app as hung (`AppHangB1`) — and because live
/// view restores its last state at launch, that freeze lands on startup, not
/// only when the user toggles it.
///
/// The probe itself stays. It is what turns "ZSA Keymapp has the channel" into
/// a readable error instead of a live view that silently never lights up;
/// moving it off the main thread is the fix, removing it would not be.
#[tauri::command(async)]
pub fn start_key_reporting(app: AppHandle) -> Result<(), AppError> {
    keyreport::start(move |report| match report {
        Report::Key { row, col, pressed } => emit_key_report(&app, row, col, pressed),
        Report::Layer { layer } => emit_layer_report(&app, layer),
        // Pairing and error frames are listener-internal: pairing is retried by
        // the listener itself, and there is no event on the contract for them.
        Report::Paired => log::info!("key reporting paired"),
        Report::PairingFailed => log::warn!("key report pairing refused by the board"),
        Report::Error(code) => log::warn!("key report error frame from the board: {code}"),
    })
    .map_err(AppError::KeyReportUnavailable)
}

/// Stop streaming and unpair, releasing the channel back to Keymapp/Oryx.
/// Idempotent — stopping when nothing is running is not an error.
///
/// Stays synchronous, deliberately, and it is worth saying why since its
/// sibling above could not: this does no I/O. It sets an `AtomicBool` and
/// returns. The listener thread notices on its next read tick (≤100 ms), and it
/// is that thread — not this one — that writes `ORYX_CMD_DISCONNECT` and exits.
/// Nothing here joins it. The only wait is `ACTIVE`'s mutex, which `start`
/// holds just long enough to swap a handle, having done its blocking probe
/// before taking it. Same shape as `cancel_pipeline`.
#[tauri::command]
pub fn stop_key_reporting() -> Result<(), AppError> {
    keyreport::stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_key_reporting_is_idempotent() {
        assert!(stop_key_reporting().is_ok());
        assert!(stop_key_reporting().is_ok());
        assert!(!keyreport::is_running());
    }

    /// The fixture, parsed directly.
    ///
     /// These three used to call `load_layout()`, which returned the fixture
    /// when they were written. Multi-layout changed that to "the user’s active
    /// layout", and the tests silently became assertions about whoever is
    /// running them: the name check failed the moment a second layout was
    /// selected, and `save_layout_accepts_fixture` was WRITING to the real
    /// store on every `cargo test`, snapshotting into version history as it
    /// went. Their names always said fixture; now they mean it.
    fn fixture() -> LayoutFile {
        let mut layout: LayoutFile =
            serde_json::from_str(store::FIXTURE_LAYOUT).expect("fixture parses");
        layout.migrate();
        layout
    }

    #[test]
    fn the_fixture_is_a_valid_layout() {
        assert!(fixture().validate().is_ok());
    }

    #[test]
    fn save_layout_accepts_a_valid_layout() {
        // Against a throwaway root, so running the suite cannot touch the
        // layouts someone actually uses.
        let tmp = std::env::temp_dir().join(format!(
            "qmk-flasher-test-{}",
            std::process::id()
        ));
        let store = store::Store::at(tmp.clone());
        let result = store.save(&fixture());
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(result.is_ok(), "save failed: {result:?}");
    }

    #[test]
    fn generate_sources_matches_reference() {
        let sources = generate_sources(fixture()).unwrap();
        assert!(sources.keymap_c.contains("LAYOUT_moonlander"));
    }
}

// -- AULA F75 (vendor-HID remapper, NOT a QMK target) -----------------------

/// The F75 geometry, or where to generate it if it is not there yet.
///
/// Absence is a normal return value, not an error: the file is produced by
/// `scripts/extract-f75-geometry.mjs` from the user's own OEM installer and is
/// expected to be missing until they run it.
#[tauri::command]
pub fn get_f75_geometry() -> Result<f75::geometry::F75GeometryState, AppError> {
    f75::geometry::load()
}
