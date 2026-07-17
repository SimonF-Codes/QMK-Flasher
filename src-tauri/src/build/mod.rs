//! MSYS firmware build — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Responsible for compiling QMK firmware via the MSYS2 toolchain. STUB:
//! reports canned progress and returns a fake firmware path without invoking
//! any toolchain.

use crate::events::{FlashProgress, FlashStage};

/// Compile firmware for `keyboard`, reporting progress through `on_progress`
/// (the command layer forwards it as `flash:progress` events with stage
/// `compiling`). Returns the path of the built firmware image.
/// STUB: emits two progress ticks and returns a fake path.
pub fn compile<F: FnMut(FlashProgress)>(
    keyboard: &str,
    mut on_progress: F,
) -> Result<String, String> {
    on_progress(FlashProgress {
        stage: FlashStage::Compiling,
        percent: 0,
        message: format!("starting compile of '{keyboard}' (stub)"),
    });
    on_progress(FlashProgress {
        stage: FlashStage::Compiling,
        percent: 100,
        message: "compile finished (stub)".to_string(),
    });
    Ok(format!("target/firmware/{keyboard}.hex"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compile_reports_progress_and_returns_path() {
        let mut progress = Vec::new();
        let path = compile("ws_together", |p| progress.push(p)).unwrap();
        assert_eq!(path, "target/firmware/ws_together.hex");
        assert_eq!(progress.len(), 2);
        assert!(progress
            .iter()
            .all(|p| p.stage == FlashStage::Compiling));
        assert_eq!(progress.last().unwrap().percent, 100);
    }
}
