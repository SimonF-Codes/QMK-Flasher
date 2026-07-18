//! Layout schema — the shared contract between all workers.
//! Mirrored by `src/lib/types.ts` (zod) and exported as JSON Schema at
//! `shared/layout.schema.json`. See `docs/CONTRACT.md`.
//!
//! Any change here MUST bump [`SCHEMA_VERSION`], be mirrored in
//! `src/lib/types.ts`, regenerate `shared/layout.schema.json`
//! (`REGEN_SCHEMA=1 cargo test`), and be recorded in `docs/CONTRACT.md`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Current version of the layout-file schema.
pub const SCHEMA_VERSION: u32 = 2;

/// Keys per layer in `LAYOUT_moonlander` argument order.
pub const MOONLANDER_KEY_COUNT: usize = 72;

/// The app's persisted layout (`%APPDATA%\qmk-flasher\layout.json`), seeded
/// once from Oryx. Keys are stored in **LAYOUT-arg order** — the Oryx→LAYOUT
/// permutation is applied once at seed time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LayoutFile {
    /// Must equal [`SCHEMA_VERSION`].
    pub schema_version: u32,
    pub meta: Meta,
    /// Index in this array == QMK layer number.
    pub layers: Vec<Layer>,
    pub combos: Vec<Combo>,
    pub settings: Settings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// Display name of the layout, e.g. "Arrows Together".
    pub name: String,
    /// Keyboard geometry id, e.g. "moonlander".
    pub geometry: String,
    pub seeded_from: SeededFrom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeededFrom {
    /// Oryx layout hash id, e.g. "rddD7".
    pub layout_id: String,
    /// Oryx revision hash id, e.g. "QzpBEp".
    pub revision_hash: String,
    /// QMK version reported by Oryx, e.g. "25.0".
    pub qmk_version: String,
    /// RFC 3339 timestamp of the seed.
    pub seeded_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    /// Layer title from Oryx (may be the default "Layer").
    pub title: String,
    /// Base layer color as "#rrggbb" (drives the ledmap base HSV).
    pub color: String,
    /// Exactly [`MOONLANDER_KEY_COUNT`] entries in LAYOUT-arg order.
    pub keys: Vec<KeyAction>,
}

/// One key's behavior. Tagged union on `kind`; every variant carries an
/// optional `glow` ("#rrggbb" per-key LED override).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeyAction {
    /// KC_NO — key does nothing.
    None {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// KC_TRANSPARENT — falls through to the layer below.
    Transparent {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// A plain keycode, optionally with modifiers (e.g. LCTL(KC_C)).
    Basic {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mods: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// MO/TG/TO/TT layer switches.
    LayerSwitch {
        action: LayerSwitchAction,
        layer: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// MT(mods, tap) — modifier on hold, keycode on tap.
    ModTap {
        mods: Vec<String>,
        tap: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// LT(layer, tap) — layer on hold, keycode on tap.
    LayerTap {
        layer: u8,
        tap: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Oryx DUAL_FUNC_n (LT trick + process_record_user case).
    DualFunc {
        tap: TapSpec,
        hold: TapSpec,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// QK_LOCK — the Key Lock key (the whole reason this app exists).
    QkLock {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Non-basic QMK codes with no parameters: QK_BOOT, CW_TOGG, AS_TOGG,
    /// AU_TOGG, MU_TOGG, TOGGLE_LAYER_COLOR, …
    Special {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// TD(DANCE_n) — v1 read-only.
    TapDance {
        #[serde(skip_serializing_if = "Option::is_none")]
        tap: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        hold: Option<String>,
        #[serde(rename = "doubleTap", skip_serializing_if = "Option::is_none")]
        double_tap: Option<String>,
        #[serde(rename = "tapHold", skip_serializing_if = "Option::is_none")]
        tap_hold: Option<String>,
        #[serde(rename = "tappingTerm", skip_serializing_if = "Option::is_none")]
        tapping_term: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// ST_MACRO_n — v1 read-only.
    Macro {
        label: String,
        steps: Vec<MacroStep>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Parameterless RGB controls: RGB_TOG, RGB_VAI, RGB_SLD, … — v1 read-only.
    Rgb {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Oryx HSV_h_s_v custom keycode (sets rgblight to a fixed HSV) — v1 read-only.
    RgbHsv {
        h: u8,
        s: u8,
        v: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum LayerSwitchAction {
    MO,
    TG,
    TO,
    TT,
}

/// A keycode plus optional modifiers, as used inside `dualFunc`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TapSpec {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods: Option<Vec<String>>,
}

/// One SEND_STRING step of a macro: tap `code` (with `mods` held), then wait
/// `delay` ms before the next step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods: Option<Vec<String>>,
}

/// COMBO(keys → action). `keys` are LAYOUT-arg key indices (the Oryx→LAYOUT
/// permutation is applied to combo indices at seed time too).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Combo {
    pub name: String,
    pub keys: Vec<u32>,
    /// Layer the combo listens on.
    pub layer: u32,
    pub action: KeyAction,
}

/// Feature toggles driving rules.mk / config.h generation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_shift: bool,
    pub caps_word: bool,
    pub tap_dance: bool,
    pub combos: bool,
    /// Always true — Key Lock is the point of this app.
    pub key_lock: bool,
    pub oryx: bool,
    pub rgb_matrix_custom: bool,
    #[serde(rename = "layerState8bit")]
    pub layer_state_8bit: bool,
    /// SERIAL_NUMBER in config.h, e.g. "rddD7/QzpBEp".
    pub serial_number: String,
    /// RGB_MATRIX_STARTUP_SPD in config.h.
    pub rgb_startup_speed: u16,
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl KeyAction {
    pub fn glow(&self) -> Option<&String> {
        match self {
            KeyAction::None { glow }
            | KeyAction::Transparent { glow }
            | KeyAction::Basic { glow, .. }
            | KeyAction::LayerSwitch { glow, .. }
            | KeyAction::ModTap { glow, .. }
            | KeyAction::LayerTap { glow, .. }
            | KeyAction::DualFunc { glow, .. }
            | KeyAction::QkLock { glow }
            | KeyAction::Special { glow, .. }
            | KeyAction::TapDance { glow, .. }
            | KeyAction::Macro { glow, .. }
            | KeyAction::Rgb { glow, .. }
            | KeyAction::RgbHsv { glow, .. } => glow.as_ref(),
        }
    }
}

impl LayoutFile {
    /// Structural checks beyond what serde enforces.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported schemaVersion {} (expected {})",
                self.schema_version, SCHEMA_VERSION
            ));
        }
        if self.layers.is_empty() {
            return Err("layout has no layers".into());
        }
        if !self.settings.key_lock {
            return Err("settings.keyLock must always be true".into());
        }
        for (i, layer) in self.layers.iter().enumerate() {
            if layer.keys.len() != MOONLANDER_KEY_COUNT {
                return Err(format!(
                    "layer {} ({}) has {} keys, expected {}",
                    i,
                    layer.title,
                    layer.keys.len(),
                    MOONLANDER_KEY_COUNT
                ));
            }
            if !is_hex_color(&layer.color) {
                return Err(format!(
                    "layer {} color {:?} is not \"#rrggbb\"",
                    i, layer.color
                ));
            }
            for (k, key) in layer.keys.iter().enumerate() {
                if let Some(glow) = key.glow() {
                    if !is_hex_color(glow) {
                        return Err(format!(
                            "layer {} key {} glow {:?} is not \"#rrggbb\"",
                            i, k, glow
                        ));
                    }
                }
            }
        }
        for combo in &self.combos {
            if combo.layer as usize >= self.layers.len() {
                return Err(format!(
                    "combo {:?} references layer {} but only {} layers exist",
                    combo.name,
                    combo.layer,
                    self.layers.len()
                ));
            }
            for &k in &combo.keys {
                if k as usize >= MOONLANDER_KEY_COUNT {
                    return Err(format!(
                        "combo {:?} references key index {} (max {})",
                        combo.name,
                        k,
                        MOONLANDER_KEY_COUNT - 1
                    ));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../shared/fixtures/seeded_layout.json"
    ));

    fn fixture() -> LayoutFile {
        serde_json::from_str(FIXTURE).expect("fixture must match schema")
    }

    #[test]
    fn fixture_deserializes_and_validates() {
        let layout = fixture();
        layout.validate().expect("fixture must pass validation");
        assert_eq!(layout.meta.seeded_from.layout_id, "rddD7");
        assert_eq!(layout.meta.seeded_from.revision_hash, "QzpBEp");
        assert!(layout.settings.key_lock);
        assert_eq!(layout.combos.len(), 2);
    }

    #[test]
    fn fixture_covers_core_key_kinds() {
        let layout = fixture();
        let all: Vec<&KeyAction> =
            layout.layers.iter().flat_map(|l| &l.keys).collect();
        assert!(all.iter().any(|k| matches!(k, KeyAction::QkLock { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::ModTap { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::LayerTap { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::DualFunc { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::TapDance { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::RgbHsv { .. })));
        assert!(all
            .iter()
            .any(|k| matches!(k, KeyAction::Transparent { .. })));
    }

    #[test]
    fn fixture_roundtrips() {
        let layout = fixture();
        let json = serde_json::to_string(&layout).unwrap();
        let back: LayoutFile = serde_json::from_str(&json).unwrap();
        assert_eq!(layout, back);
    }

    #[test]
    fn validate_rejects_bad_key_count() {
        let mut layout = fixture();
        layout.layers[0].keys.pop();
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_wrong_schema_version() {
        let mut layout = fixture();
        layout.schema_version = 1;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_key_lock_disabled() {
        let mut layout = fixture();
        layout.settings.key_lock = false;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_out_of_range_combo() {
        let mut layout = fixture();
        layout.combos[0].keys[0] = 72;
        assert!(layout.validate().is_err());
    }

    /// `shared/layout.schema.json` is generated from these types. Run
    /// `REGEN_SCHEMA=1 cargo test json_schema` after any schema change.
    #[test]
    fn json_schema_up_to_date() {
        let schema = schemars::schema_for!(LayoutFile);
        let generated =
            serde_json::to_string_pretty(&schema).unwrap() + "\n";
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../shared/layout.schema.json"
        );
        if std::env::var("REGEN_SCHEMA").is_ok() {
            std::fs::write(path, &generated).unwrap();
        }
        let committed = std::fs::read_to_string(path)
            .expect("shared/layout.schema.json missing — run REGEN_SCHEMA=1 cargo test");
        assert_eq!(
            committed.replace("\r\n", "\n"),
            generated,
            "shared/layout.schema.json is stale — run REGEN_SCHEMA=1 cargo test"
        );
    }
}
