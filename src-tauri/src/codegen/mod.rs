//! QMK source generation — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Renders keymap.c / rules.mk / config.h from a [`LayoutFile`]
//! (keymap_c.rs, rules_mk.rs, config_h.rs, ledmap.rs);
//! `shared/fixtures/reference_keymap.c` is the golden spec. Every emitted
//! leaf keycode is validated against `shared/keycodes.json`
//! ([`AppError::CodegenUnsupportedKey`] on miss). `write_sources` emits into
//! `keymaps/<keymapName>/` — never `arrows_together`.

pub mod config_h;
pub mod keymap_c;
pub mod ledmap;
pub mod rules_mk;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::OnceLock;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::appcfg::AppConfig;
use crate::error::AppError;
use crate::layout::schema::KeyAction;
use crate::layout::LayoutFile;

const KEYCODES_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/keycodes.json"
));

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSources {
    pub keymap_c: String,
    pub rules_mk: String,
    pub config_h: String,
}

/// All codes known to `shared/keycodes.json` (qmk names + aliases).
fn known_codes() -> &'static HashSet<String> {
    static CODES: OnceLock<HashSet<String>> = OnceLock::new();
    CODES.get_or_init(|| {
        #[derive(Deserialize)]
        struct Entry {
            qmk: String,
            #[serde(default)]
            aliases: Vec<String>,
        }
        let entries: Vec<Entry> =
            serde_json::from_str(KEYCODES_JSON).expect("shared/keycodes.json must parse");
        entries
            .into_iter()
            .flat_map(|e| std::iter::once(e.qmk).chain(e.aliases))
            .collect()
    })
}

/// Every leaf keycode a key emits (construct wrappers like MO()/TD() aside).
fn leaf_codes(key: &KeyAction) -> Vec<&str> {
    match key {
        KeyAction::Basic { code, .. }
        | KeyAction::Special { code, .. }
        | KeyAction::Rgb { code, .. } => vec![code],
        KeyAction::ModTap { tap, .. } | KeyAction::LayerTap { tap, .. } => vec![tap],
        KeyAction::DualFunc { tap, hold, .. } => vec![&tap.code, &hold.code],
        KeyAction::TapDance { tap, hold, double_tap, tap_hold, .. } => [tap, hold, double_tap, tap_hold]
            .iter()
            .filter_map(|s| s.as_deref())
            .collect(),
        KeyAction::Macro { steps, .. } => steps.iter().map(|s| s.code.as_str()).collect(),
        _ => Vec::new(),
    }
}

fn validate_codes(layout: &LayoutFile) -> Result<(), AppError> {
    let known = known_codes();
    let check = |code: &str, where_: &str| {
        if known.contains(code) {
            Ok(())
        } else {
            Err(AppError::CodegenUnsupportedKey(format!(
                "{code} ({where_}) is not in shared/keycodes.json"
            )))
        }
    };
    for (li, layer) in layout.layers.iter().enumerate() {
        for (ki, key) in layer.keys.iter().enumerate() {
            for code in leaf_codes(key) {
                check(code, &format!("layer {li} key {ki}"))?;
            }
        }
    }
    for combo in &layout.combos {
        for code in leaf_codes(&combo.action) {
            check(code, &format!("combo {:?}", combo.name))?;
        }
    }
    Ok(())
}

/// Render `layout` into QMK sources.
pub fn generate(layout: &LayoutFile) -> Result<GeneratedSources, AppError> {
    layout.validate().map_err(AppError::InvalidLayout)?;
    validate_codes(layout)?;
    Ok(GeneratedSources {
        keymap_c: keymap_c::render(layout)?,
        rules_mk: rules_mk::render(layout),
        config_h: config_h::render(layout),
    })
}

/// The fourth file next to the generated three: pulls in the QMK community
/// modules the Oryx-generated code depends on (`rgb_matrix_kb.inc`,
/// `rawhid_state`, ORYX protocol — all live in `modules/zsa/`). Same content
/// as the arrows_together reference. Without it the build fails at
/// `#include "rgb_matrix_kb.inc"`.
const KEYMAP_JSON: &str =
    "{\n    \"modules\": [\n        \"zsa/oryx\",\n        \"zsa/defaults\"\n    ]\n}\n";

/// Generate and write the sources into
/// `<qmkFirmwarePath>\keyboards\zsa\moonlander\keymaps\<keymapName>\`.
/// Returns the keymap directory.
pub fn write_sources(layout: &LayoutFile, cfg: &AppConfig) -> Result<PathBuf, AppError> {
    if cfg.keymap_name == "arrows_together" {
        return Err(AppError::InvalidLayout(
            "refusing to write into arrows_together (recovery reference)".into(),
        ));
    }
    let sources = generate(layout)?;
    let dir = PathBuf::from(&cfg.qmk_firmware_path)
        .join("keyboards")
        .join("zsa")
        .join("moonlander")
        .join("keymaps")
        .join(&cfg.keymap_name);
    let io = |e: std::io::Error| AppError::BuildFailed(format!("writing sources: {e}"));
    std::fs::create_dir_all(&dir).map_err(io)?;
    std::fs::write(dir.join("keymap.c"), &sources.keymap_c).map_err(io)?;
    std::fs::write(dir.join("rules.mk"), &sources.rules_mk).map_err(io)?;
    std::fs::write(dir.join("config.h"), &sources.config_h).map_err(io)?;
    std::fs::write(dir.join("keymap.json"), KEYMAP_JSON).map_err(io)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::store;
    use similar::TextDiff;

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

    /// Whitespace normalization: trim lines, collapse inner runs, drop blank
    /// lines. Anything else must match the reference byte-for-byte.
    fn normalize(s: &str) -> String {
        s.lines()
            .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// A2 golden test: fixture layout → generate → the real arrows_together
    /// sources (QK_LOCK included), byte-identical modulo whitespace.
    #[test]
    fn golden_generated_sources_match_reference() {
        let sources = generate(&store::load().unwrap()).unwrap();
        for (name, got, want) in [
            ("keymap.c", &sources.keymap_c, REFERENCE_KEYMAP_C),
            ("rules.mk", &sources.rules_mk, REFERENCE_RULES_MK),
            ("config.h", &sources.config_h, REFERENCE_CONFIG_H),
        ] {
            let (got, want) = (normalize(got), normalize(want));
            if got != want {
                let diff = TextDiff::from_lines(&want, &got);
                let mut rendered = String::new();
                for change in diff.iter_all_changes() {
                    let sign = match change.tag() {
                        similar::ChangeTag::Delete => "-ref ",
                        similar::ChangeTag::Insert => "+gen ",
                        similar::ChangeTag::Equal => continue,
                    };
                    rendered.push_str(&format!("{sign}{change}"));
                }
                panic!("{name} differs from reference:\n{rendered}");
            }
        }
    }

    #[test]
    fn generate_rejects_invalid_layout() {
        let mut layout = store::load().unwrap();
        layout.layers[0].keys.pop();
        assert!(generate(&layout).is_err());
    }

    #[test]
    fn generate_rejects_unknown_keycode() {
        let mut layout = store::load().unwrap();
        layout.layers[0].keys[0] =
            KeyAction::Basic { code: "KC_NOT_A_KEY".into(), mods: None, glow: None };
        let err = generate(&layout).unwrap_err();
        assert_eq!(err.code(), "CodegenUnsupportedKey");
    }

    #[test]
    fn write_sources_refuses_arrows_together() {
        let mut cfg = crate::appcfg::get();
        cfg.keymap_name = "arrows_together".into();
        assert!(write_sources(&store::load().unwrap(), &cfg).is_err());
    }
}
