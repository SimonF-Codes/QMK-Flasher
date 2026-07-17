//! Layout schema — the shared contract between the seeder, codegen, flashing,
//! and UI workers. Mirrored by `src/lib/types.ts` (zod). See `docs/CONTRACT.md`.
//!
//! Any change to these types MUST bump `SCHEMA_VERSION`, be mirrored in
//! `src/lib/types.ts`, and be recorded in `docs/CONTRACT.md`.

use serde::{Deserialize, Serialize};

/// Current version of the seeded-layout schema.
pub const SCHEMA_VERSION: u32 = 1;

/// A keyboard layout as produced by the seeder from QMK source files
/// (`keymap.c` / `config.h` / `rules.mk`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeededLayout {
    /// Must equal [`SCHEMA_VERSION`] for this build to accept the file.
    pub schema_version: u32,
    /// QMK keyboard name, e.g. `ws_together`.
    pub keyboard: String,
    /// QMK keymap name, e.g. `default`.
    pub keymap: String,
    /// The LAYOUT macro used in `keymap.c`, e.g. `LAYOUT_ortho_4x4`.
    pub layout_macro: String,
    /// Number of keys per layer; every layer's `keys` must have this length.
    pub key_count: usize,
    /// Layers in `keymap.c` order.
    pub layers: Vec<Layer>,
    /// Repo-relative paths of the QMK sources this layout was seeded from.
    pub source: SourceFiles,
    /// RFC 3339 timestamp of when the seeder produced this file.
    pub seeded_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    /// Position in the `keymaps[]` array.
    pub index: u32,
    /// Layer enum name from `keymap.c`, e.g. `_BASE`.
    pub name: String,
    /// Keycodes in LAYOUT-macro argument order, e.g. `KC_A`, `MO(_FN)`.
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceFiles {
    pub keymap_c: String,
    pub config_h: String,
    pub rules_mk: String,
}

impl SeededLayout {
    /// Structural checks beyond what serde enforces.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported schema_version {} (expected {})",
                self.schema_version, SCHEMA_VERSION
            ));
        }
        if self.layers.is_empty() {
            return Err("layout has no layers".into());
        }
        for layer in &self.layers {
            if layer.keys.len() != self.key_count {
                return Err(format!(
                    "layer {} ({}) has {} keys, expected key_count {}",
                    layer.index,
                    layer.name,
                    layer.keys.len(),
                    self.key_count
                ));
            }
        }
        for (i, layer) in self.layers.iter().enumerate() {
            if layer.index as usize != i {
                return Err(format!(
                    "layer {} has index {}, expected {}",
                    layer.name, layer.index, i
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/ws_together/seeded_layout.json"
    ));

    #[test]
    fn fixture_deserializes_and_validates() {
        let layout: SeededLayout =
            serde_json::from_str(FIXTURE).expect("fixture must match schema");
        layout.validate().expect("fixture must pass validation");
        assert_eq!(layout.keyboard, "ws_together");
        assert_eq!(layout.layers.len(), 2);
        assert_eq!(layout.key_count, 16);
    }

    #[test]
    fn fixture_roundtrips() {
        let layout: SeededLayout = serde_json::from_str(FIXTURE).unwrap();
        let json = serde_json::to_string(&layout).unwrap();
        let back: SeededLayout = serde_json::from_str(&json).unwrap();
        assert_eq!(layout, back);
    }

    #[test]
    fn validate_rejects_bad_key_count() {
        let mut layout: SeededLayout = serde_json::from_str(FIXTURE).unwrap();
        layout.layers[0].keys.pop();
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_wrong_schema_version() {
        let mut layout: SeededLayout = serde_json::from_str(FIXTURE).unwrap();
        layout.schema_version = 999;
        assert!(layout.validate().is_err());
    }
}
