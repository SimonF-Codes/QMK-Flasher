//! App configuration (MSYS / qmk_firmware paths), persisted at
//! `%APPDATA%\qmk-flasher\config.json`. `get` is infallible: any read or
//! parse problem falls back to the defaults.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::layout::store::data_dir;

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

fn config_path() -> Result<std::path::PathBuf, AppError> {
    Ok(data_dir()?.join("config.json"))
}

pub fn get() -> AppConfig {
    config_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn validate(cfg: &AppConfig) -> Result<(), AppError> {
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

pub fn set(cfg: &AppConfig) -> Result<(), AppError> {
    validate(cfg)?;
    let path = config_path()?;
    let io =
        |e: std::io::Error| AppError::InvalidLayout(format!("saving {}: {e}", path.display()));
    std::fs::create_dir_all(path.parent().expect("config path has a parent")).map_err(io)?;
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| AppError::InvalidLayout(e.to_string()))?
        + "\n";
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(io)?;
    std::fs::rename(&tmp, &path).map_err(io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        assert!(validate(&get()).is_ok());
    }

    #[test]
    fn set_rejects_reference_keymap_name() {
        let mut cfg = get();
        cfg.keymap_name = "arrows_together".into();
        assert!(set(&cfg).is_err());
    }
}
