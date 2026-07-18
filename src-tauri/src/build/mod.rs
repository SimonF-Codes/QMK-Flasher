//! MSYS firmware build — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Real implementation (msys.rs): `MSYSTEM=MINGW64 bash -lc "cd qmk_firmware
//! && make zsa/moonlander/reva:qmk_flasher"`, streaming stdout lines through
//! `on_log`, then copying the .bin to `%APPDATA%\qmk-flasher\builds\`.
//! Never `qmk compile`. STUB: canned log lines and a fake path.

use crate::error::AppError;

/// Build the firmware, streaming make output through `on_log` (forwarded to
/// the webview as `build-log` events). Returns the built .bin path.
/// STUB: emits canned lines, touches no toolchain.
pub fn build_firmware<F: FnMut(String)>(mut on_log: F) -> Result<String, AppError> {
    on_log("make zsa/moonlander/reva:qmk_flasher (stub)".to_string());
    on_log("Creating binary load file for flashing: .build/zsa_moonlander_reva_qmk_flasher.bin (stub)".to_string());
    Ok(r"C:\Users\fridl\AppData\Roaming\qmk-flasher\builds\stub.bin".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_streams_log_and_returns_bin_path() {
        let mut lines = Vec::new();
        let path = build_firmware(|l| lines.push(l)).unwrap();
        assert!(path.ends_with(".bin"));
        assert!(!lines.is_empty());
        assert!(lines[0].contains("make zsa/moonlander/reva:qmk_flasher"));
    }
}
