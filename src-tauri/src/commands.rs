//! Tauri commands — the invoke surface of the app. See `docs/CONTRACT.md`.
//!
//! These are STUBS returning fixture data so the UI worker can build against
//! the real contract. The seeder, codegen, and flashing workers replace the
//! bodies without changing the signatures.

use tauri::AppHandle;

use crate::events::{
    emit_flash_done, emit_flash_progress, FlashDone, FlashProgress, FlashStage,
};
use crate::layout::SeededLayout;

const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/ws_together/seeded_layout.json"
));

/// Load the current seeded layout.
/// STUB: returns the checked-in fixture instead of running the seeder.
#[tauri::command]
pub fn get_layout() -> Result<SeededLayout, String> {
    let layout: SeededLayout =
        serde_json::from_str(FIXTURE_LAYOUT).map_err(|e| e.to_string())?;
    layout.validate()?;
    Ok(layout)
}

/// Save an edited layout back to disk (codegen worker regenerates keymap.c).
/// STUB: validates the payload and discards it.
#[tauri::command]
pub fn save_layout(layout: SeededLayout) -> Result<(), String> {
    layout.validate()
}

/// Compile and flash the firmware, emitting `flash:progress` events and a
/// final `flash:done`. STUB: emits a canned progress sequence, touches no
/// hardware.
#[tauri::command]
pub fn flash_firmware(app: AppHandle, keyboard: String) -> Result<(), String> {
    let steps = [
        (FlashStage::Compiling, 0, "starting compile (stub)"),
        (FlashStage::Compiling, 100, "compile finished (stub)"),
        (FlashStage::WaitingForBootloader, 0, "waiting for bootloader (stub)"),
        (FlashStage::Flashing, 50, "writing firmware (stub)"),
        (FlashStage::Done, 100, "flash complete (stub)"),
    ];
    for (stage, percent, message) in steps {
        emit_flash_progress(
            &app,
            FlashProgress {
                stage,
                percent,
                message: message.to_string(),
            },
        );
    }
    emit_flash_done(
        &app,
        FlashDone {
            success: true,
            message: format!("stub flash of '{keyboard}' complete"),
        },
    );
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
