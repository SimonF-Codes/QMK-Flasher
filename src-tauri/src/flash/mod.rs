//! USB watching + DFU flashing — owned by Worker B. See `docs/CONTRACT.md`.
//!
//! - `watcher`: polls `nusb::list_devices()` (1 s) for the bootloader
//!   (0483:df11); the command layer forwards presence edges as `dfu-device`
//!   events. A ~500 ms debounce gates the start of flashing.
//! - `dfu`: the `Flasher` trait; DfuSe erase + download at 0x08000000 with
//!   progress, then manifest/leave (board re-enumerates as 3297:1969).
//!   Primary backend dfu-core + dfu-nusb, feature-flagged dfu-util.exe
//!   fallback. `wally-cli` is the behavioral reference.
//! - `pipeline`: save → generate → build → waitingForBootloader →
//!   erasing/flashing → leaving → done, with cooperative cancellation.
//!
//! Everything here takes plain `FnMut` callbacks — never `AppHandle`.

pub mod dfu;
pub mod pipeline;
pub mod watcher;

use nusb::MaybeFuture;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::events::PipelineState;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DfuDeviceInfo {
    pub vid: u16,
    pub pid: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
}

/// Enumerate DFU-mode boards (0483:df11) currently on the bus.
pub fn list_dfu_devices() -> Result<Vec<DfuDeviceInfo>, AppError> {
    let devices = nusb::list_devices()
        .wait()
        .map_err(|e| AppError::DfuVerifyFailed(format!("USB enumeration failed: {e}")))?;
    Ok(devices
        .filter(|d| d.vendor_id() == watcher::DFU_VID && d.product_id() == watcher::DFU_PID)
        .map(|d| DfuDeviceInfo {
            vid: d.vendor_id(),
            pid: d.product_id(),
            serial: d.serial_number().map(str::to_owned),
        })
        .collect())
}

/// Flash an already-built image (no rebuild), reporting phases through
/// `on_state` (forwarded as `pipeline-state` events).
pub fn flash_firmware<F: FnMut(PipelineState)>(
    bin_path: &str,
    on_state: F,
) -> Result<(), AppError> {
    pipeline::flash_only(bin_path, on_state)
}

/// Cancel the in-flight pipeline, if any.
pub fn cancel() -> Result<(), AppError> {
    pipeline::cancel()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dfu_devices_returns_only_bootloader_ids() {
        // No hardware assumptions: whatever is on the bus, every returned
        // entry must be the ST bootloader id pair.
        let devices = list_dfu_devices().expect("enumeration works without hardware");
        for d in devices {
            assert_eq!((d.vid, d.pid), (watcher::DFU_VID, watcher::DFU_PID));
        }
    }

    #[test]
    fn flash_firmware_with_missing_file_fails_fast_without_hardware() {
        let _lock = pipeline::TEST_PIPELINE_LOCK
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let mut states = Vec::new();
        let err = flash_firmware(
            r"C:\definitely\not\a\real\firmware.bin",
            |s| states.push(s),
        )
        .unwrap_err();
        assert_eq!(err.code(), "BuildFailed");
        // Must fail before asking the user to reset the board.
        assert!(states.is_empty());
    }
}
