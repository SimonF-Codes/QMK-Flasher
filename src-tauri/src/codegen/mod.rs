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

/// Where the generated keymap dir lives for a keyboard. Keymaps sit one
/// level above a versioned leaf (`zsa/moonlander/reva` builds read
/// `zsa/moonlander/keymaps/`) — QMK resolves keymap dirs up the folder
/// hierarchy, so a trailing `revX` segment is stripped.
fn keymap_dir(cfg: &AppConfig, kb: &crate::keyboards::KeyboardInfo) -> PathBuf {
    let parts: Vec<&str> = kb.qmk_keyboard.split('/').collect();
    let strip_rev = parts.len() > 1 && parts.last().unwrap().starts_with("rev");
    let kb_parts = if strip_rev { &parts[..parts.len() - 1] } else { &parts[..] };
    let mut dir = PathBuf::from(&cfg.qmk_firmware_path).join("keyboards");
    for part in kb_parts {
        dir = dir.join(part);
    }
    dir.join("keymaps").join(&cfg.keymap_name)
}

/// Generate and write the sources into the keyboard's keymap dir.
/// Returns the keymap directory.
pub fn write_sources(layout: &LayoutFile, cfg: &AppConfig) -> Result<PathBuf, AppError> {
    if cfg.keymap_name == "arrows_together" {
        return Err(AppError::InvalidLayout(
            "refusing to write into arrows_together (recovery reference)".into(),
        ));
    }
    let keyboard = crate::keyboards::supported(&layout.meta.geometry)?;
    let sources = generate(layout)?;
    let dir = keymap_dir(cfg, keyboard);
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
    use similar::TextDiff;

    /// The committed seeded fixture — NOT `store::load()`, which reads the
    /// user's real (possibly edited) layout from %APPDATA%.
    fn fixture() -> LayoutFile {
        serde_json::from_str(crate::layout::store::FIXTURE_LAYOUT).unwrap()
    }

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
        let sources = generate(&fixture()).unwrap();
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

    /// Replace every `TapDance` key (in layers and combos) with a transparent
    /// key, leaving `settings.tap_dance` untouched. Models the real regression:
    /// an edit rebound the layout's only tap-dance keys to other actions but
    /// left the stored `tapDance: true` flag behind.
    fn strip_tap_dances(layout: &mut LayoutFile) {
        let blank = || KeyAction::Transparent { glow: None };
        for layer in &mut layout.layers {
            for key in &mut layer.keys {
                if matches!(key, KeyAction::TapDance { .. }) {
                    *key = blank();
                }
            }
        }
        for combo in &mut layout.combos {
            if matches!(combo.action, KeyAction::TapDance { .. }) {
                combo.action = blank();
            }
        }
    }

    /// The bug this brief chased: `settings.tap_dance == true` while the layout
    /// has no tap-dance actions must NOT enable the feature in rules.mk, or QMK's
    /// introspection references an undefined `tap_dance_actions[]` and the build
    /// fails. rules.mk and keymap.c must agree — both off here.
    #[test]
    fn stale_tap_dance_flag_does_not_enable_without_actions() {
        let mut layout = fixture();
        assert!(layout.settings.tap_dance, "fixture starts with the flag set");
        strip_tap_dances(&mut layout);
        assert!(
            layout.settings.tap_dance,
            "flag is intentionally left stale to reproduce the desync"
        );
        let sources = generate(&layout).unwrap();
        assert!(
            !sources.rules_mk.contains("TAP_DANCE_ENABLE"),
            "rules.mk must not enable tap dance when no actions exist:\n{}",
            sources.rules_mk
        );
        assert!(
            !sources.keymap_c.contains("tap_dance_actions"),
            "keymap.c must not reference tap_dance_actions when none exist"
        );
    }

    /// Inverse drift: actions present but the flag is off. Usage wins — the
    /// feature is enabled and the array is emitted, so `TD(DANCE_n)` resolves.
    #[test]
    fn tap_dance_actions_enable_the_feature_even_if_flag_is_off() {
        let mut layout = fixture();
        layout.settings.tap_dance = false;
        assert!(
            layout
                .layers
                .iter()
                .flat_map(|l| &l.keys)
                .any(|k| matches!(k, KeyAction::TapDance { .. })),
            "fixture must contain tap-dance keys for this test"
        );
        let sources = generate(&layout).unwrap();
        assert!(
            sources.rules_mk.contains("TAP_DANCE_ENABLE = yes"),
            "rules.mk must enable tap dance when actions exist:\n{}",
            sources.rules_mk
        );
        assert!(
            sources.keymap_c.contains("tap_dance_actions"),
            "keymap.c must define tap_dance_actions when actions exist"
        );
    }

    #[test]
    fn generate_rejects_invalid_layout() {
        let mut layout = fixture();
        layout.layers[0].keys.pop();
        assert!(generate(&layout).is_err());
    }

    #[test]
    fn generate_rejects_unknown_keycode() {
        let mut layout = fixture();
        layout.layers[0].keys[0] =
            KeyAction::Basic { code: "KC_NOT_A_KEY".into(), mods: None, glow: None };
        let err = generate(&layout).unwrap_err();
        assert_eq!(err.code(), "CodegenUnsupportedKey");
    }

    #[test]
    fn keymap_dir_strips_the_versioned_leaf() {
        let cfg = crate::appcfg::get();
        let kb = crate::keyboards::get("moonlander").unwrap();
        let dir = keymap_dir(&cfg, kb);
        assert!(
            dir.ends_with("keyboards/zsa/moonlander/keymaps/qmk_flasher"),
            "{}",
            dir.display()
        );
    }

    #[test]
    fn write_sources_refuses_arrows_together() {
        let mut cfg = crate::appcfg::get();
        cfg.keymap_name = "arrows_together".into();
        assert!(write_sources(&fixture(), &cfg).is_err());
    }
}
