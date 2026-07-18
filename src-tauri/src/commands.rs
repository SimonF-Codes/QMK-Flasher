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
use crate::layout::{store, LayoutFile};
use crate::{build, oryx};

#[tauri::command]
pub fn load_layout() -> Result<LayoutFile, AppError> {
    store::load()
}

#[tauri::command]
pub fn save_layout(layout: LayoutFile) -> Result<(), AppError> {
    store::save(&layout)
}

#[tauri::command]
pub fn seed_from_oryx(layout_id: String, force: bool) -> Result<LayoutFile, AppError> {
    oryx::seed_from_oryx(&layout_id, force)
}

#[tauri::command]
pub fn get_geometry() -> Result<GeometryFile, AppError> {
    geometry::get()
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
#[tauri::command]
pub fn start_flash_pipeline(app: AppHandle, layout: LayoutFile) -> Result<(), AppError> {
    let run = |app: &AppHandle| -> Result<(), AppError> {
        emit_pipeline_state(app, PipelineState::phase(PipelinePhase::Saving));
        store::save(&layout)?;
        emit_pipeline_state(app, PipelineState::phase(PipelinePhase::Generating));
        codegen::generate(&layout)?;
        emit_pipeline_state(app, PipelineState::phase(PipelinePhase::Building));
        let bin = build::build_firmware(|line| emit_build_log(app, line))?;
        flash::flash_firmware(&bin, |state| emit_pipeline_state(app, state))
    };
    run(&app).inspect_err(|e| {
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
#[tauri::command]
pub fn flash_firmware(app: AppHandle, bin_path: String) -> Result<(), AppError> {
    flash::flash_firmware(&bin_path, |state| emit_pipeline_state(&app, state))
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
