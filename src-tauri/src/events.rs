//! Event names and payload types emitted from Rust to the webview.
//! Mirrored by `src/lib/types.ts`. See `docs/CONTRACT.md`.
//!
//! These are STUBS for the shared contract — real emission logic belongs to
//! the flashing worker.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Emitted during compile/flash to report progress.
pub const EVENT_FLASH_PROGRESS: &str = "flash:progress";
/// Emitted once when a flash attempt finishes (success or failure).
pub const EVENT_FLASH_DONE: &str = "flash:done";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlashStage {
    Compiling,
    WaitingForBootloader,
    Flashing,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlashProgress {
    pub stage: FlashStage,
    /// 0–100 within the current stage.
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlashDone {
    pub success: bool,
    pub message: String,
}

pub fn emit_flash_progress(app: &AppHandle, payload: FlashProgress) {
    // Emission failure is not fatal to the flash itself; log and continue.
    if let Err(e) = app.emit(EVENT_FLASH_PROGRESS, &payload) {
        eprintln!("failed to emit {EVENT_FLASH_PROGRESS}: {e}");
    }
}

pub fn emit_flash_done(app: &AppHandle, payload: FlashDone) {
    if let Err(e) = app.emit(EVENT_FLASH_DONE, &payload) {
        eprintln!("failed to emit {EVENT_FLASH_DONE}: {e}");
    }
}
