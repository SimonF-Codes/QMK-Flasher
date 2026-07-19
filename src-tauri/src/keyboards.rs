//! Keyboard target registry (`shared/keyboards.json`) — the single source of
//! truth for which boards the app can seed/generate/build for and how each
//! maps onto QMK (`qmkKeyboard` make path, layout macro, key count) and Oryx
//! (`oryxGeometry`). `LayoutFile.meta.geometry` is the keyboard `id`.
//!
//! Only the Moonlander ships today (`supported: true`); adding a board means
//! adding its entry + geometry JSON + Oryx→LAYOUT permutation table, at which
//! point codegen's board-specific pieces must be generalized too.

use std::sync::OnceLock;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

const KEYBOARDS_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/keyboards.json"
));

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardInfo {
    /// Registry id; `LayoutFile.meta.geometry` stores this.
    pub id: String,
    /// Display name for the UI, e.g. "ZSA Moonlander".
    pub name: String,
    /// QMK keyboard path as used in the make target, e.g. "zsa/moonlander/reva".
    pub qmk_keyboard: String,
    /// Geometry string for the Oryx GraphQL query.
    pub oryx_geometry: String,
    /// e.g. "LAYOUT_moonlander".
    pub layout_macro: String,
    pub key_count: u32,
    /// Geometry JSON under `shared/`, e.g. "moonlander_geometry.json".
    pub geometry_file: String,
    /// False = listed in the UI but seed/codegen/build refuse it.
    pub supported: bool,
}

pub fn all() -> &'static [KeyboardInfo] {
    static ALL: OnceLock<Vec<KeyboardInfo>> = OnceLock::new();
    ALL.get_or_init(|| {
        serde_json::from_str(KEYBOARDS_JSON).expect("shared/keyboards.json must parse")
    })
}

pub fn find(id: &str) -> Option<&'static KeyboardInfo> {
    all().iter().find(|k| k.id == id)
}

pub fn get(id: &str) -> Result<&'static KeyboardInfo, AppError> {
    find(id).ok_or_else(|| {
        AppError::InvalidLayout(format!("unknown keyboard {id:?} — not in shared/keyboards.json"))
    })
}

/// The keyboard, but only if the pipeline actually supports it.
pub fn supported(id: &str) -> Result<&'static KeyboardInfo, AppError> {
    let kb = get(id)?;
    if !kb.supported {
        return Err(AppError::CodegenUnsupportedKey(format!(
            "keyboard {:?} is not yet supported by seed/codegen/build",
            kb.name
        )));
    }
    Ok(kb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_parses_and_contains_supported_moonlander() {
        let kb = get("moonlander").unwrap();
        assert!(kb.supported);
        assert_eq!(kb.qmk_keyboard, "zsa/moonlander/reva");
        assert_eq!(kb.layout_macro, "LAYOUT_moonlander");
        assert_eq!(kb.key_count, 72);
        assert_eq!(kb.oryx_geometry, "moonlander");
        assert!(supported("moonlander").is_ok());
    }

    #[test]
    fn unknown_keyboard_is_an_error() {
        assert!(get("planck").is_err());
        assert!(find("planck").is_none());
    }
}
