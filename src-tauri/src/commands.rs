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
    emit_build_log, emit_pipeline_state, PipelinePhase, PipelineState,
};
use crate::flash::{self, DfuDeviceInfo};
use crate::geometry::{self, GeometryFile};
use crate::keyboards::{self, KeyboardInfo};
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_layout_returns_valid_fixture() {
        let layout = load_layout().unwrap();
        assert!(layout.validate().is_ok());
        assert_eq!(layout.meta.name, "Arrows Together");
    }

    #[test]
    fn save_layout_accepts_fixture() {
        assert!(save_layout(load_layout().unwrap()).is_ok());
    }

    #[test]
    fn generate_sources_matches_reference() {
        let sources = generate_sources(load_layout().unwrap()).unwrap();
        assert!(sources.keymap_c.contains("LAYOUT_moonlander"));
    }
}
