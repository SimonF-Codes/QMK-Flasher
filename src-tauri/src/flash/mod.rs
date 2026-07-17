//! USB/DFU flashing — owned by Worker B. See `docs/CONTRACT.md`.
//!
//! Responsible for putting the keyboard into its bootloader and writing a
//! compiled firmware image over USB/DFU. STUB: reports a canned progress
//! sequence and touches no hardware.

use crate::events::{FlashDone, FlashProgress, FlashStage};

/// Flash the firmware image at `firmware_path` to `keyboard`, reporting
/// progress through `on_progress` (forwarded as `flash:progress` events by
/// the command layer). Returns the terminal [`FlashDone`] payload.
/// STUB: emits a canned sequence, touches no hardware.
pub fn flash<F: FnMut(FlashProgress)>(
    keyboard: &str,
    firmware_path: &str,
    mut on_progress: F,
) -> Result<FlashDone, String> {
    let steps = [
        (FlashStage::WaitingForBootloader, 0, "waiting for bootloader (stub)"),
        (FlashStage::Flashing, 50, "writing firmware (stub)"),
        (FlashStage::Done, 100, "flash complete (stub)"),
    ];
    for (stage, percent, message) in steps {
        on_progress(FlashProgress {
            stage,
            percent,
            message: message.to_string(),
        });
    }
    Ok(FlashDone {
        success: true,
        message: format!("stub flash of '{firmware_path}' to '{keyboard}' complete"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flash_reports_full_sequence_and_succeeds() {
        let mut progress = Vec::new();
        let done =
            flash("ws_together", "target/firmware/ws_together.hex", |p| {
                progress.push(p)
            })
            .unwrap();
        assert!(done.success);
        assert_eq!(progress.len(), 3);
        assert_eq!(progress.first().unwrap().stage, FlashStage::WaitingForBootloader);
        assert_eq!(progress.last().unwrap().stage, FlashStage::Done);
    }
}
