//! Event names and payload types emitted from Rust to the webview.
//! Mirrored by `src/lib/types.ts`. See `docs/CONTRACT.md`.
//!
//! Frozen contract — workers emit these via the helpers/callbacks, they do
//! not add event types without a contract bump.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// One line of MSYS make output, streamed during `building`.
pub const EVENT_BUILD_LOG: &str = "build-log";
/// Pipeline phase transitions (save → generate → build → flash).
pub const EVENT_PIPELINE_STATE: &str = "pipeline-state";
/// DFU bootloader (0483:df11) appeared/disappeared.
pub const EVENT_DFU_DEVICE: &str = "dfu-device";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildLog {
    pub line: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PipelinePhase {
    Idle,
    Saving,
    Generating,
    Building,
    WaitingForBootloader,
    Erasing,
    Flashing,
    Leaving,
    Done,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineState {
    pub phase: PipelinePhase,
    /// Human-readable detail (e.g. the error message in phase `error`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// 0–100 within the current phase, where meaningful (erasing/flashing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
}

impl PipelineState {
    pub fn phase(phase: PipelinePhase) -> Self {
        Self { phase, detail: None, progress: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DfuDevice {
    pub present: bool,
}

// Emission failure is never fatal to the pipeline itself; log and continue.

pub fn emit_build_log(app: &AppHandle, line: impl Into<String>) {
    let payload = BuildLog { line: line.into() };
    if let Err(e) = app.emit(EVENT_BUILD_LOG, &payload) {
        eprintln!("failed to emit {EVENT_BUILD_LOG}: {e}");
    }
}

pub fn emit_pipeline_state(app: &AppHandle, payload: PipelineState) {
    if let Err(e) = app.emit(EVENT_PIPELINE_STATE, &payload) {
        eprintln!("failed to emit {EVENT_PIPELINE_STATE}: {e}");
    }
}

pub fn emit_dfu_device(app: &AppHandle, present: bool) {
    if let Err(e) = app.emit(EVENT_DFU_DEVICE, &DfuDevice { present }) {
        eprintln!("failed to emit {EVENT_DFU_DEVICE}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_phase_serializes_camel_case() {
        let s = serde_json::to_string(&PipelinePhase::WaitingForBootloader).unwrap();
        assert_eq!(s, "\"waitingForBootloader\"");
    }

    #[test]
    fn pipeline_state_omits_empty_fields() {
        let v = serde_json::to_value(PipelineState::phase(PipelinePhase::Idle)).unwrap();
        assert_eq!(v, serde_json::json!({ "phase": "idle" }));
    }
}
