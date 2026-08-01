//! The single app-wide error type. Crosses IPC as `{code, message, hint}`.
//! See `docs/CONTRACT.md`.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("could not reach Oryx: {0}")]
    OryxUnreachable(String),
    #[error("Oryx/keymap permutation mismatch: {0}")]
    PermutationMismatch(String),
    #[error("codegen cannot express key: {0}")]
    CodegenUnsupportedKey(String),
    #[error("firmware build failed: {0}")]
    BuildFailed(String),
    #[error("no DFU device (0483:df11 or 3297:2003) found")]
    DfuNotFound,
    #[error("DFU device found but access was denied")]
    DfuAccessDenied,
    #[error("DFU verification failed: {0}")]
    DfuVerifyFailed(String),
    /// Layout failed schema validation (not in the plan's original seven,
    /// but load/save need a failure code; documented in CONTRACT.md).
    #[error("layout is invalid: {0}")]
    InvalidLayout(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::OryxUnreachable(_) => "OryxUnreachable",
            AppError::PermutationMismatch(_) => "PermutationMismatch",
            AppError::CodegenUnsupportedKey(_) => "CodegenUnsupportedKey",
            AppError::BuildFailed(_) => "BuildFailed",
            AppError::DfuNotFound => "DfuNotFound",
            AppError::DfuAccessDenied => "DfuAccessDenied",
            AppError::DfuVerifyFailed(_) => "DfuVerifyFailed",
            AppError::InvalidLayout(_) => "InvalidLayout",
        }
    }

    pub fn hint(&self) -> Option<&'static str> {
        match self {
            AppError::OryxUnreachable(_) => {
                Some("Check your internet connection; Oryx may also be down.")
            }
            AppError::PermutationMismatch(_) => Some(
                "The Oryx layout and its generated source disagree — re-seed, \
                 and if it persists the Oryx key order may have changed.",
            ),
            AppError::DfuNotFound => Some(
                "Put the board in bootloader mode: press the reset button \
                 through the small hole next to the thumb cluster.",
            ),
            AppError::DfuAccessDenied => Some(
                "Close Keymapp if it is running. If the driver is missing, \
                 install WinUSB for 0483:df11 with Zadig.",
            ),
            AppError::DfuVerifyFailed(_) => Some(
                "Safe to retry — the bootloader is in ROM and cannot be \
                 bricked. Keymapp remains a manual fallback.",
            ),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.serialize_field("hint", &self.hint())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_message_hint() {
        let e = AppError::DfuAccessDenied;
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "DfuAccessDenied");
        assert!(v["message"].as_str().unwrap().contains("access was denied"));
        assert!(v["hint"].as_str().unwrap().contains("Zadig"));

        let e = AppError::BuildFailed("make exited 2".into());
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "BuildFailed");
        assert!(v["hint"].is_null());
    }
}
