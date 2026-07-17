//! Tauri commands — the invoke surface of the app. See `docs/CONTRACT.md`.
//!
//! This is a thin delegation layer: each command calls into the module owned
//! by the responsible worker (`oryx`, `codegen`, `build`, `flash`). Workers
//! replace their module's bodies — command signatures here do not change
//! without a contract bump.

use tauri::AppHandle;

use crate::events::{emit_flash_done, emit_flash_progress};
use crate::layout::SeededLayout;
use crate::{build, codegen, flash, oryx};

/// Load the current seeded layout (Worker A: `oryx`).
#[tauri::command]
pub fn get_layout() -> Result<SeededLayout, String> {
    oryx::seed_layout()
}

/// Save an edited layout back to QMK sources (Worker A: `codegen`).
/// STUB: renders and discards.
#[tauri::command]
pub fn save_layout(layout: SeededLayout) -> Result<(), String> {
    codegen::generate_keymap(&layout).map(|_| ())
}

/// Compile firmware for `keyboard` (Worker A: `build`), emitting
/// `flash:progress` events with stage `compiling`. Returns the firmware path.
#[tauri::command]
pub fn compile_firmware(app: AppHandle, keyboard: String) -> Result<String, String> {
    build::compile(&keyboard, |p| emit_flash_progress(&app, p))
}

/// Full pipeline: compile (Worker A: `build`) then flash (Worker B: `flash`),
/// emitting `flash:progress` throughout and `flash:done` once at the end.
#[tauri::command]
pub fn flash_firmware(app: AppHandle, keyboard: String) -> Result<(), String> {
    let firmware_path = build::compile(&keyboard, |p| emit_flash_progress(&app, p))?;
    let done = flash::flash(&keyboard, &firmware_path, |p| {
        emit_flash_progress(&app, p)
    })?;
    emit_flash_done(&app, done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_layout_returns_valid_fixture() {
        let layout = get_layout().expect("stub must return the fixture");
        assert_eq!(layout.keyboard, "ws_together");
        assert!(layout.validate().is_ok());
    }

    #[test]
    fn save_layout_accepts_fixture_and_rejects_invalid() {
        let layout = get_layout().unwrap();
        assert!(save_layout(layout.clone()).is_ok());

        let mut bad = layout;
        bad.key_count = 3;
        assert!(save_layout(bad).is_err());
    }
}
