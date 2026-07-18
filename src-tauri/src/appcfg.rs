//! App configuration (MSYS / qmk_firmware paths).
//! STUB: `get` returns defaults, `set` validates and discards. Real
//! persistence lands with Worker A's build merge.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// QMK MSYS install root, e.g. `C:\QMK_MSYS`.
    pub msys_path: String,
    /// qmk_firmware checkout, e.g. `C:\Users\fridl\qmk_firmware`.
    pub qmk_firmware_path: String,
    /// Keymap directory name codegen writes into (never `arrows_together`).
    pub keymap_name: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            msys_path: r"C:\QMK_MSYS".into(),
            qmk_firmware_path: r"C:\Users\fridl\qmk_firmware".into(),
            keymap_name: "qmk_flasher".into(),
        }
    }
}

pub fn get() -> AppConfig {
    AppConfig::default()
}

pub fn set(cfg: &AppConfig) -> Result<(), AppError> {
    if cfg.msys_path.trim().is_empty()
        || cfg.qmk_firmware_path.trim().is_empty()
        || cfg.keymap_name.trim().is_empty()
    {
        return Err(AppError::InvalidLayout(
            "app config fields must not be empty".into(),
        ));
    }
    if cfg.keymap_name == "arrows_together" {
        return Err(AppError::InvalidLayout(
            "keymap_name must not be arrows_together (recovery reference)".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_settable() {
        assert!(set(&get()).is_ok());
    }

    #[test]
    fn set_rejects_reference_keymap_name() {
        let mut cfg = get();
        cfg.keymap_name = "arrows_together".into();
        assert!(set(&cfg).is_err());
    }
}
