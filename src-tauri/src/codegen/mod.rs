//! QMK source generation — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Real implementation renders keymap.c / rules.mk / config.h from a
//! [`LayoutFile`] (keymap_c.rs, rules_mk.rs, config_h.rs, ledmap.rs) into
//! `keymaps/qmk_flasher/`; `shared/fixtures/reference_keymap.c` is the golden
//! spec. STUB: validates and returns the reference files verbatim.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::layout::LayoutFile;

const REFERENCE_KEYMAP_C: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/reference_keymap.c"
));
const REFERENCE_RULES_MK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/reference_rules.mk"
));
const REFERENCE_CONFIG_H: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/reference_config.h"
));

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSources {
    pub keymap_c: String,
    pub rules_mk: String,
    pub config_h: String,
}

/// Render `layout` into QMK sources.
/// STUB: returns the reference fixture files instead of generating.
pub fn generate(layout: &LayoutFile) -> Result<GeneratedSources, AppError> {
    layout.validate().map_err(AppError::InvalidLayout)?;
    Ok(GeneratedSources {
        keymap_c: REFERENCE_KEYMAP_C.to_string(),
        rules_mk: REFERENCE_RULES_MK.to_string(),
        config_h: REFERENCE_CONFIG_H.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::store;

    #[test]
    fn generate_returns_reference_sources_for_fixture() {
        let sources = generate(&store::load().unwrap()).unwrap();
        assert!(sources.keymap_c.contains("QK_LOCK"));
        assert!(sources.rules_mk.contains("KEY_LOCK_ENABLE = yes"));
        assert!(sources.config_h.contains("SERIAL_NUMBER"));
    }

    #[test]
    fn generate_rejects_invalid_layout() {
        let mut layout = store::load().unwrap();
        layout.layers[0].keys.pop();
        assert!(generate(&layout).is_err());
    }
}
