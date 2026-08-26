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
        KeyAction::OsMacro { mac, windows, .. } => {
            mac.iter().chain(windows).map(|s| s.code.as_str()).collect()
        }
        // Not a field on the action: the four QF_OS_* names come from codegen,
        // and running them through the catalog check is what keeps
        // `shared/keycodes.json` and `os_mode_keycode` from drifting apart.
        KeyAction::OsMode { action, .. } => {
            vec![keymap_c::os_mode_keycode(*action)]
        }
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
/// level above a versioned leaf (`zsa/moonlander/revb` builds read
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

/// Write `contents` to `path` only if that is not already exactly what is
/// there. make keys off mtime, so an identical rewrite still invalidates
/// every object built from the file: rewriting config.h or rules.mk forces a
/// full rebuild of the tree (~240s) where a keymap.c-only change costs ~30s.
/// Most edits touch keymap.c alone, and keymap.json never changes at all.
fn write_if_changed(path: PathBuf, contents: &str) -> std::io::Result<()> {
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if existing == contents {
            return Ok(());
        }
    }
    std::fs::write(path, contents)
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
    write_if_changed(dir.join("keymap.c"), &sources.keymap_c).map_err(io)?;
    write_if_changed(dir.join("rules.mk"), &sources.rules_mk).map_err(io)?;
    write_if_changed(dir.join("config.h"), &sources.config_h).map_err(io)?;
    write_if_changed(dir.join("keymap.json"), KEYMAP_JSON).map_err(io)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::schema::{Lighting, LightingMode};
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

    /// The OS-mode keys are plain `special` actions: they must pass catalog
    /// validation and reach keymap.c verbatim, with no rules.mk change —
    /// MAGIC_ENABLE defaults to yes (qmk builddefs/generic_features.mk:17).
    #[test]
    fn generate_emits_os_mode_keycodes() {
        for code in ["CG_TOGG", "CG_SWAP", "CG_NORM"] {
            let mut layout = fixture();
            layout.layers[0].keys[0] =
                KeyAction::Special { code: code.into(), glow: None };
            let out = generate(&layout).expect("OS-mode keycode must generate");
            assert!(out.keymap_c.contains(code), "{code} missing from keymap.c");
            assert!(
                !out.rules_mk.contains("MAGIC_ENABLE"),
                "{code} should not need a MAGIC_ENABLE line"
            );
        }
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

    /// Build speed depends on this: make keys off mtime, so re-writing a
    /// byte-identical config.h/rules.mk would force a full rebuild of the
    /// tree (~240s) instead of the ~30s a keymap.c-only change costs.

    // ---- OS tooling (v3) --------------------------------------------------

    use crate::layout::schema::{MacroStep, OsModeAction, OsTarget};

    fn step(code: &str, mods: &[&str]) -> MacroStep {
        MacroStep {
            code: code.into(),
            delay: None,
            mods: if mods.is_empty() {
                None
            } else {
                Some(mods.iter().map(|m| m.to_string()).collect())
            },
        }
    }

    /// The contract's worked example. Windows drives virtual desktops with
    /// Gui+Ctrl+arrow and macOS with Ctrl+arrow — two unrelated sequences,
    /// which is exactly what the Ctrl↔Cmd swap cannot express.
    fn desktop_right() -> KeyAction {
        KeyAction::OsMacro {
            label: "Desktop right".into(),
            mac: vec![step("KC_RIGHT", &["MOD_LCTL"])],
            windows: vec![step("KC_RIGHT", &["MOD_LGUI", "MOD_LCTL"])],
            glow: None,
        }
    }

    fn desktop_left() -> KeyAction {
        KeyAction::OsMacro {
            label: "Desktop left".into(),
            mac: vec![step("KC_LEFT", &["MOD_LCTL"])],
            windows: vec![step("KC_LEFT", &["MOD_LGUI", "MOD_LCTL"])],
            glow: None,
        }
    }

    fn os_mode(action: OsModeAction) -> KeyAction {
        KeyAction::OsMode { action, glow: None }
    }

    /// The shipped default is the one layout we know every user will build, so
    /// it gets generated in CI rather than only on someone's desk. This is NOT
    /// a parity assertion — there is no Oryx output to compare it against, by
    /// construction — it only pins that the demo layer's richer content still
    /// renders and stays internally consistent.
    #[test]
    fn the_shipped_demo_layout_generates_consistent_sources() {
        let demo: LayoutFile =
            serde_json::from_str(crate::layout::store::DEFAULT_LAYOUT).unwrap();
        let out = generate(&demo).expect("the shipped default layout must generate");

        // The OS features the demo layer exists to show reach the firmware.
        assert!(out.keymap_c.contains("OS_MACRO_0"), "no OS macro in keymap.c");
        for code in ["QF_OS_TOGG", "QF_OS_MAC", "QF_OS_WIN", "QF_OS_AUTO"] {
            assert!(out.keymap_c.contains(code), "{code} missing from keymap.c");
        }
        assert!(out.rules_mk.contains("OS_DETECTION_ENABLE = yes"));

        // The two flags that fail the QMK build when keymap.c and rules.mk
        // disagree, checked against what the layout actually binds.
        assert_eq!(
            out.rules_mk.contains("TAP_DANCE_ENABLE = yes"),
            out.keymap_c.contains("tap_dance_actions"),
            "tap dance must be on in both files or neither"
        );
        assert!(
            out.config_h.contains(&format!("#define COMBO_COUNT {}", demo.combos.len())),
            "COMBO_COUNT must match the layout's combo count:\n{}",
            out.config_h
        );

        // One ledmap row per layer, including the demo layer.
        assert_eq!(
            out.keymap_c.matches("] = { {").count(),
            demo.layers.len(),
            "one ledmap row per layer"
        );
    }

    /// A layout with no OS tooling must be untouched by this feature — the
    /// golden test pins the bytes, this pins the reason.
    #[test]
    fn a_layout_without_os_tooling_emits_none_of_it() {
        let out = generate(&fixture()).unwrap();
        for absent in ["QF_OS_", "OS_MACRO_", "qf_os_mac", "process_detected_host_os_user"] {
            assert!(!out.keymap_c.contains(absent), "{absent} leaked into keymap.c");
        }
        assert!(!out.rules_mk.contains("OS_DETECTION_ENABLE"));
        assert!(!out.config_h.contains("OS_DETECTION"));
    }

    /// One custom keycode per *distinct* (mac, windows) pair, the way
    /// `plan.macros` dedupes `ST_MACRO_n`: three keys, two pairs, two keycodes,
    /// and the repeat renders the keycode it shares.
    #[test]
    fn os_macros_dedupe_by_step_pair_like_st_macros() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = desktop_right();
        layout.layers[0].keys[1] = desktop_left();
        layout.layers[1].keys[0] = desktop_right();
        let c = generate(&layout).unwrap().keymap_c;

        assert!(c.contains("  OS_MACRO_0,"), "enum entry missing:\n{c}");
        assert!(c.contains("  OS_MACRO_1,"));
        assert!(!c.contains("OS_MACRO_2"), "three keys but only two distinct pairs");
        assert_eq!(c.matches("case OS_MACRO_0:").count(), 1);
        assert_eq!(c.matches("case OS_MACRO_1:").count(), 1);
        // enum entry + two LAYOUT slots + one case.
        assert_eq!(
            c.matches("OS_MACRO_0").count(),
            4,
            "both keys with the same pair must render the shared keycode"
        );
    }

    /// Both halves present: the board picks one at press time from `qf_os_mac`.
    #[test]
    fn os_macro_sends_the_half_matching_the_boards_os_mode() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = desktop_right();
        let c = generate(&layout).unwrap().keymap_c;
        assert!(
            c.contains(concat!(
                "      if (qf_os_mac) {\n",
                "        SEND_STRING(SS_LCTL(SS_TAP(X_RIGHT)));\n",
                "      } else {\n",
                "        SEND_STRING(SS_LGUI(SS_LCTL(SS_TAP(X_RIGHT))));\n",
                "      }\n"
            )),
            "{c}"
        );
    }

    /// "Does nothing on that OS" is an empty branch, not `SEND_STRING()` —
    /// which is not valid C.
    #[test]
    fn os_macro_with_an_empty_side_emits_no_send_string_for_it() {
        for mac_side_empty in [true, false] {
            let mut layout = fixture();
            let steps = vec![step("KC_RIGHT", &["MOD_LGUI", "MOD_LCTL"])];
            layout.layers[0].keys[0] = KeyAction::OsMacro {
                label: "One-sided".into(),
                mac: if mac_side_empty { vec![] } else { steps.clone() },
                windows: if mac_side_empty { steps.clone() } else { vec![] },
                glow: None,
            };
            let c = generate(&layout).unwrap().keymap_c;
            let case = os_macro_case(&c, 0);

            assert!(!case.contains("SEND_STRING()"), "empty SEND_STRING emitted:\n{case}");
            assert_eq!(case.matches("SEND_STRING(").count(), 1, "{case}");
            assert!(!case.contains("} else {"), "the dead branch must be dropped:\n{case}");
            let guard = if mac_side_empty { "if (!qf_os_mac) {" } else { "if (qf_os_mac) {" };
            assert!(case.contains(guard), "{case}");
        }
    }

    /// The body of `case OS_MACRO_n:` up to its `break;`.
    fn os_macro_case(keymap_c: &str, n: usize) -> String {
        keymap_c
            .split(&format!("case OS_MACRO_{n}:"))
            .nth(1)
            .expect("case not generated")
            .split("    break;")
            .next()
            .unwrap()
            .to_string()
    }

    #[test]
    fn os_mode_keys_generate_only_the_actions_the_layout_binds() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = os_mode(OsModeAction::Toggle);
        layout.layers[0].keys[1] = os_mode(OsModeAction::Mac);
        let out = generate(&layout).unwrap();
        for used in ["QF_OS_TOGG", "QF_OS_MAC"] {
            assert!(out.keymap_c.contains(&format!("  {used},")), "{used} enum entry");
            assert!(out.keymap_c.contains(&format!("case {used}:")), "{used} case");
        }
        for unused in ["QF_OS_WIN", "QF_OS_AUTO"] {
            assert!(!out.keymap_c.contains(unused), "{unused} is not bound by this layout");
        }
    }

    /// The point of the feature: setting the mode drives BOTH the Ctrl↔Cmd swap
    /// and which half of every OS macro fires, off one flag.
    #[test]
    fn os_mode_and_os_macros_read_the_same_flag() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = os_mode(OsModeAction::Toggle);
        layout.layers[0].keys[1] = desktop_right();
        let c = generate(&layout).unwrap().keymap_c;

        assert!(c.contains("        qf_os_mac = !qf_os_mac;\n        qf_os_apply();"), "{c}");
        assert!(c.contains("const bool swap = (qf_os_mac != QF_OS_DEFAULT_MAC);"));
        assert!(c.contains("keymap_config.swap_lctl_lgui = swap;"));
        assert!(c.contains("keymap_config.swap_rctl_rgui = swap;"));
        assert!(c.contains("      if (qf_os_mac) {"), "the macro reads the same flag");
    }

    /// `settings.osDefault` is the OS the layout's plain Ctrl/Gui mods were
    /// authored against, so it decides which way the swap runs. It has to reach
    /// the firmware as a `#define` with the direction derived from it — flipping
    /// the setting must change that one line and nothing else.
    #[test]
    fn os_default_is_a_define_and_the_swap_direction_is_derived_from_it() {
        let mut windows_authored = fixture();
        windows_authored.layers[0].keys[0] = desktop_right();
        assert_eq!(windows_authored.settings.os_default, OsTarget::Windows);
        let mut mac_authored = windows_authored.clone();
        mac_authored.settings.os_default = OsTarget::Mac;

        let win_c = generate(&windows_authored).unwrap().keymap_c;
        let mac_c = generate(&mac_authored).unwrap().keymap_c;
        assert!(win_c.contains("#define QF_OS_DEFAULT_MAC false"), "{win_c}");
        assert!(mac_c.contains("#define QF_OS_DEFAULT_MAC true"), "{mac_c}");
        assert_eq!(
            win_c.replace("#define QF_OS_DEFAULT_MAC false", "@"),
            mac_c.replace("#define QF_OS_DEFAULT_MAC true", "@"),
            "osDefault must move the #define and nothing else — no baked-in direction"
        );
    }

    /// Detection on, no OS keys: the board still follows the host, because the
    /// mode drives the Ctrl↔Cmd swap on its own.
    #[test]
    fn detection_alone_still_emits_the_mode_and_the_swap() {
        let mut layout = fixture();
        layout.settings.os_detection = true;
        let c = generate(&layout).unwrap().keymap_c;
        assert!(c.contains("#define QF_OS_DEFAULT_MAC false"));
        assert!(c.contains("qf_os_apply();"));
        // The banner comment names OS_MACRO_n; what must be absent is the code.
        assert!(!c.contains("case OS_MACRO_"));
        assert!(!c.contains("  OS_MACRO_0,"));
    }

    #[test]
    fn os_detection_emits_the_feature_and_the_agreed_precedence() {
        let mut layout = fixture();
        layout.settings.os_detection = true;
        let out = generate(&layout).unwrap();

        assert!(out.rules_mk.contains("OS_DETECTION_ENABLE = yes"), "{}", out.rules_mk);
        assert!(out.config_h.contains("#define OS_DETECTION_DEBOUNCE 250"), "{}", out.config_h);
        // Single-report suppresses every report after the first, and the
        // precedence rule is built on the later one that says the board moved.
        assert!(
            !out.config_h.contains("OS_DETECTION_SINGLE_REPORT"),
            "single-report would break the override-drop rule"
        );

        let c = &out.keymap_c;
        assert!(c.contains("bool process_detected_host_os_user(os_variant_t os) {"), "{c}");
        // OS_UNSURE is ignored.
        assert!(c.contains("  if (os == OS_UNSURE) {\n    return true;\n  }"), "{c}");
        // The override is dropped only when detection reports a DIFFERENT OS.
        assert!(
            c.contains(concat!(
                "  if (qf_os_override && qf_os_detected_once && os != qf_os_last_detected) {\n",
                "    qf_os_override = false;\n",
                "  }\n"
            )),
            "{c}"
        );
        // Detection is authoritative whenever no override stands.
        assert!(
            c.contains(concat!(
                "  if (!qf_os_override) {\n",
                "    qf_os_mac = qf_os_is_mac(os);\n",
                "    qf_os_apply();\n",
                "  }\n"
            )),
            "{c}"
        );
        assert!(c.contains("return os == OS_MACOS || os == OS_IOS;"), "iOS counts as Mac");
    }

    #[test]
    fn a_manual_os_key_overrides_detection_and_auto_hands_it_back() {
        let mut layout = fixture();
        layout.settings.os_detection = true;
        layout.layers[0].keys[0] = os_mode(OsModeAction::Mac);
        layout.layers[0].keys[1] = os_mode(OsModeAction::Auto);
        let c = generate(&layout).unwrap().keymap_c;

        assert!(
            c.contains(concat!(
                "    case QF_OS_MAC:\n",
                "      if (record->event.pressed) {\n",
                "        qf_os_override = true;\n",
                "        qf_os_mac = true;\n",
                "        qf_os_apply();\n"
            )),
            "{c}"
        );
        assert!(
            c.contains("    case QF_OS_AUTO:\n      if (record->event.pressed) {\n        qf_os_override = false;\n"),
            "auto must clear the override:\n{c}"
        );
        assert!(
            c.contains("qf_os_mac = (os == OS_UNSURE) ? QF_OS_DEFAULT_MAC : qf_os_is_mac(os);"),
            "auto must re-adopt what detection last reported:\n{c}"
        );
    }

    /// With detection off there is nothing to override, so the override flag is
    /// not emitted at all (it would be set-but-never-read), and "auto" can only
    /// mean the OS the layout was authored against.
    #[test]
    fn without_detection_there_is_no_override_and_auto_means_the_default() {
        let mut layout = fixture();
        assert!(!layout.settings.os_detection);
        layout.layers[0].keys[0] = os_mode(OsModeAction::Auto);
        let c = generate(&layout).unwrap().keymap_c;
        assert!(!c.contains("qf_os_override"), "{c}");
        assert!(!c.contains("process_detected_host_os_user"), "{c}");
        assert!(
            c.contains("        qf_os_mac = QF_OS_DEFAULT_MAC;\n        qf_os_apply();"),
            "{c}"
        );
    }

    /// Settled against the firmware source before the generator was written, and
    /// independently confirmed by Alpha. `mod_config()` / `keycode_config()` —
    /// where `keymap_config.swap_lctl_lgui` is applied — are called ONLY from
    /// `quantum/keymap_common.c`, on the keycode→action path (QK_MODS, one-shot,
    /// layer-mod, mod-tap). `register_code16` (`quantum/quantum.c:126`) does not
    /// call them, and neither does the `register_code()`/`tap_code()` trio that
    /// `SEND_STRING` runs on: a modifier goes straight to
    /// `add_mods(MOD_BIT(code))` (`quantum/action.c`).
    ///
    /// So an OS macro's mods reach the host literally and are never swapped a
    /// second time. The case must NOT suspend and restore the swap: that would be
    /// dead code holding a licence to clobber the board's real mode. This pins the
    /// conclusion so a future "fix" has to argue with a test.
    #[test]
    fn os_macro_send_string_is_not_wrapped_in_a_swap_suspend() {
        let mut layout = fixture();
        layout.settings.os_detection = true;
        layout.layers[0].keys[0] = desktop_right();
        let case = os_macro_case(&generate(&layout).unwrap().keymap_c, 0);
        for banned in ["swap_lctl_lgui", "swap_rctl_rgui", "keymap_config", "qf_os_apply"] {
            assert!(!case.contains(banned), "OS macro must not touch the swap:\n{case}");
        }
    }

    /// The ledmap section owns `keyboard_post_init_user`; the OS block emits its
    /// own only when that section is absent. Two definitions would not link.
    #[test]
    fn keyboard_post_init_user_is_defined_exactly_once() {
        // Three shapes emit that function and each one must be the only one:
        // the ledmap section, the effect-mode section, and — when the layout
        // carries no LED data at all — the OS section.
        for (rgb_matrix_custom, lighting) in [
            (true, None),
            (false, None),
            (true, Some(effect_lighting(LightingMode::Ledmap))),
            (true, Some(effect_lighting(LightingMode::Effect))),
            (false, Some(effect_lighting(LightingMode::Effect))),
        ] {
            let mut layout = fixture();
            layout.settings.rgb_matrix_custom = rgb_matrix_custom;
            layout.settings.lighting = lighting.clone();
            layout.layers[0].keys[0] = desktop_right();
            let c = generate(&layout).unwrap().keymap_c;
            let case = format!("rgb_matrix_custom={rgb_matrix_custom} lighting={lighting:?}");
            assert_eq!(
                c.matches("void keyboard_post_init_user(void) {").count(),
                1,
                "{case}:\n{c}"
            );
            assert!(
                c.contains("  qf_os_apply();\n}"),
                "the OS mode must be applied at boot ({case}):\n{c}"
            );
        }
    }

    fn effect_lighting(mode: LightingMode) -> Lighting {
        Lighting {
            mode,
            effect: "SOLID_REACTIVE_SIMPLE".into(),
            extra_effects: vec![],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
        }
    }

    /// The constraint the UI models as a choice, checked where it is real. In
    /// effect mode the ledmap is not merely overdrawn — it is absent from the
    /// firmware, along with the three functions that exist to serve it.
    #[test]
    fn effect_mode_emits_no_ledmap_at_all() {
        let mut layout = fixture();
        layout.settings.lighting = Some(effect_lighting(LightingMode::Effect));
        let c = generate(&layout).unwrap().keymap_c;
        for absent in [
            "ledmap[]",
            "set_layer_color",
            "rgb_matrix_indicators_user",
            "hsv_to_rgb_with_value",
        ] {
            assert!(!c.contains(absent), "effect mode still emits {absent}:\n{c}");
        }
        // The matrix itself still has to be switched on, or the board boots dark.
        assert!(c.contains("rgb_matrix_enable();"));
    }

    /// The other half of the same claim: ledmap mode is untouched by this
    /// feature. A layout that picks an effect but leaves the ledmap in charge
    /// generates exactly the keymap.c it generated before — the effect is
    /// configured in config.h and reachable with TOGGLE_LAYER_COLOR, and that
    /// is the whole difference.
    #[test]
    fn ledmap_mode_generates_the_same_keymap_as_no_lighting_at_all() {
        let base = generate(&fixture()).unwrap().keymap_c;
        let mut layout = fixture();
        layout.settings.lighting = Some(effect_lighting(LightingMode::Ledmap));
        assert_eq!(generate(&layout).unwrap().keymap_c, base);
        // ...and the difference really is in config.h.
        assert_ne!(
            generate(&layout).unwrap().config_h,
            generate(&fixture()).unwrap().config_h
        );
    }

    /// A layout with no LED data has nothing to choose between, so effect mode
    /// must not conjure a second `keyboard_post_init_user` or a ledmap.
    #[test]
    fn effect_mode_without_rgb_matrix_custom_emits_no_led_code(
    ) {
        let mut layout = fixture();
        layout.settings.rgb_matrix_custom = false;
        layout.settings.lighting = Some(effect_lighting(LightingMode::Effect));
        let c = generate(&layout).unwrap().keymap_c;
        assert!(!c.contains("ledmap[]"));
        assert!(!c.contains("rgb_matrix_enable();"));
    }

    #[test]
    fn generate_rejects_an_unknown_keycode_inside_an_os_macro() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = KeyAction::OsMacro {
            label: "Bad".into(),
            mac: vec![step("KC_NOT_A_KEY", &[])],
            windows: vec![step("KC_RIGHT", &[])],
            glow: None,
        };
        let err = generate(&layout).unwrap_err();
        assert_eq!(err.code(), "CodegenUnsupportedKey");
    }

    /// Same desync the tap-dance tests above cover, now for combos: the stored
    /// `settings.combos` flag says yes but the layout has none. `COMBO_ENABLE`
    /// with no `key_combos[]` / `COMBO_COUNT` does not compile.
    #[test]
    fn stale_combo_flag_does_not_enable_without_combos() {
        let mut layout = fixture();
        assert!(layout.settings.combos, "fixture starts with the flag set");
        layout.combos.clear();
        let out = generate(&layout).unwrap();
        assert!(!out.rules_mk.contains("COMBO_ENABLE"), "{}", out.rules_mk);
        assert!(!out.config_h.contains("COMBO_COUNT"), "{}", out.config_h);
        assert!(!out.keymap_c.contains("key_combos"));
    }

    /// Inverse drift: combos present, flag off. Usage wins, as it does for tap
    /// dance — otherwise a combo editor's output would silently not fire.
    #[test]
    fn combos_enable_the_feature_even_if_the_flag_is_off() {
        let mut layout = fixture();
        layout.settings.combos = false;
        assert_eq!(layout.combos.len(), 2, "fixture must have combos for this test");
        let out = generate(&layout).unwrap();
        assert!(out.rules_mk.contains("COMBO_ENABLE = yes"), "{}", out.rules_mk);
        assert!(out.config_h.contains("#define COMBO_COUNT 2"), "{}", out.config_h);
        assert!(out.keymap_c.contains("combo_t key_combos[COMBO_COUNT]"));
    }

    #[test]
    fn write_if_changed_leaves_identical_files_untouched() {
        let dir = std::env::temp_dir().join("qmk-flasher-write-if-changed-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.h");
        write_if_changed(path.clone(), "#define A 1\n").unwrap();
        let first = std::fs::metadata(&path).unwrap().modified().unwrap();

        // Coarse filesystem timestamps: sleep past the resolution so a real
        // rewrite is guaranteed to be observable.
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_if_changed(path.clone(), "#define A 1\n").unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            first,
            "identical content must not touch the file"
        );

        std::thread::sleep(std::time::Duration::from_millis(50));
        write_if_changed(path.clone(), "#define A 2\n").unwrap();
        assert_ne!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            first,
            "changed content must be written"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "#define A 2\n");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
