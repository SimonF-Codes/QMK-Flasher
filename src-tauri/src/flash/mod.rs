//! USB watching + DFU flashing — owned by Worker B. See `docs/CONTRACT.md`.
//!
//! Real implementation: watcher.rs polls `nusb::list_devices()` (1 s) for
//! 0483:df11 → `dfu-device` events; dfu.rs does DfuSe erase + download at
//! 0x08000000 with progress, then :leave (board re-enumerates as 3297:1969).
//! `wally-cli` source is the behavioral reference. STUB: canned sequence,
//! touches no hardware.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::events::{PipelinePhase, PipelineState};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DfuDeviceInfo {
    pub vid: u16,
    pub pid: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
}

/// Enumerate DFU-mode boards (0483:df11).
/// STUB: always empty — no hardware access yet.
pub fn list_dfu_devices() -> Result<Vec<DfuDeviceInfo>, AppError> {
    Ok(Vec::new())
}

/// Flash `bin_path`, reporting phases through `on_state` (forwarded as
/// `pipeline-state` events). STUB: canned phase sequence, no hardware.
pub fn flash_firmware<F: FnMut(PipelineState)>(
    bin_path: &str,
    mut on_state: F,
) -> Result<(), AppError> {
    if bin_path.trim().is_empty() {
        return Err(AppError::DfuVerifyFailed("empty bin path".into()));
    }
    on_state(PipelineState::phase(PipelinePhase::WaitingForBootloader));
    on_state(PipelineState {
        phase: PipelinePhase::Erasing,
        detail: None,
        progress: Some(100),
    });
    on_state(PipelineState {
        phase: PipelinePhase::Flashing,
        detail: Some(format!("writing {bin_path} (stub)")),
        progress: Some(100),
    });
    on_state(PipelineState::phase(PipelinePhase::Leaving));
    on_state(PipelineState::phase(PipelinePhase::Done));
    Ok(())
}

/// Cancel an in-flight pipeline. STUB: nothing to cancel.
pub fn cancel() -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flash_emits_phases_through_done() {
        let mut phases = Vec::new();
        flash_firmware("stub.bin", |s| phases.push(s.phase)).unwrap();
        assert_eq!(phases.first(), Some(&PipelinePhase::WaitingForBootloader));
        assert_eq!(phases.last(), Some(&PipelinePhase::Done));
    }

    #[test]
    fn list_dfu_devices_is_empty_in_stub() {
        assert!(list_dfu_devices().unwrap().is_empty());
    }
}
