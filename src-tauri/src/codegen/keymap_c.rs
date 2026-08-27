//! `keymap.c` renderer. `shared/fixtures/reference_keymap.c` (the real
//! Oryx-generated arrows_together source, MEH→QK_LOCK applied) is the golden
//! spec: output must match it byte-identically modulo whitespace.

use crate::error::AppError;
use crate::layout::schema::{
    KeyAction, LayoutFile, LightingMode, MacroStep, OsModeAction, OsTarget, TapSpec,
};

/// Numbering plan for the custom constructs a layout uses, in first-occurrence
/// LAYOUT-arg scan order (layers first, then combo actions).
#[derive(Debug, Default)]
pub struct RenderPlan {
    pub rgb_sld: bool,
    pub hsv_enums: Vec<(u8, u8, u8)>,
    pub macros: Vec<Vec<MacroStep>>,
    pub os_macros: Vec<OsMacroSpec>,
    /// OS-mode actions the layout binds, in first-occurrence order. Only the
    /// ones actually used get a keycode and a `process_record_user` case.
    pub os_modes: Vec<OsModeAction>,
    pub dual_funcs: Vec<(TapSpec, TapSpec)>,
    pub dances: Vec<DanceSpec>,
}

/// The (mac, windows) step-list pair behind one `OS_MACRO_n`. Deduped by value
/// exactly the way `plan.macros` dedupes `ST_MACRO_n`, so two keys carrying the
/// same pair share one keycode.
#[derive(Debug, Clone, PartialEq)]
pub struct OsMacroSpec {
    pub mac: Vec<MacroStep>,
    pub windows: Vec<MacroStep>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DanceSpec {
    pub tap: Option<String>,
    pub hold: Option<String>,
    pub double_tap: Option<String>,
    pub tap_hold: Option<String>,
}

impl RenderPlan {
    pub fn build(layout: &LayoutFile) -> Self {
        let mut plan = Self::default();
        let mut visit = |key: &KeyAction| match key {
            KeyAction::Rgb { code, .. } if code == "RGB_SLD" => plan.rgb_sld = true,
            KeyAction::RgbHsv { h, s, v, .. } => {
                if !plan.hsv_enums.contains(&(*h, *s, *v)) {
                    plan.hsv_enums.push((*h, *s, *v));
                }
            }
            KeyAction::Macro { steps, .. } => {
                if !plan.macros.contains(steps) {
                    plan.macros.push(steps.clone());
                }
            }
            KeyAction::DualFunc { tap, hold, .. } => {
                let pair = (tap.clone(), hold.clone());
                if !plan.dual_funcs.contains(&pair) {
                    plan.dual_funcs.push(pair);
                }
            }
            KeyAction::OsMacro { mac, windows, .. } => {
                let spec = OsMacroSpec { mac: mac.clone(), windows: windows.clone() };
                if !plan.os_macros.contains(&spec) {
                    plan.os_macros.push(spec);
                }
            }
            KeyAction::OsMode { action, .. } => {
                if !plan.os_modes.contains(action) {
                    plan.os_modes.push(*action);
                }
            }
            KeyAction::TapDance { tap, hold, double_tap, tap_hold, .. } => {
                let spec = DanceSpec {
                    tap: tap.clone(),
                    hold: hold.clone(),
                    double_tap: double_tap.clone(),
                    tap_hold: tap_hold.clone(),
                };
                if !plan.dances.contains(&spec) {
                    plan.dances.push(spec);
                }
            }
            _ => {}
        };
        for layer in &layout.layers {
            for key in &layer.keys {
                visit(key);
            }
        }
        for combo in &layout.combos {
            visit(&combo.action);
        }
        plan
    }

    fn has_custom_keycodes(&self) -> bool {
        self.rgb_sld
            || !self.hsv_enums.is_empty()
            || !self.macros.is_empty()
            || !self.os_macros.is_empty()
            || !self.os_modes.is_empty()
    }

    fn has_os_keys(&self) -> bool {
        !self.os_macros.is_empty() || !self.os_modes.is_empty()
    }
}

/// Whether the layout actually uses any tap dance. This is the SINGLE source of
/// truth for the two coupled emissions that must never disagree:
///   * `keymap.c` defines `tap_dance_actions[]` (+ the `DANCE_n` enum / fns), and
///   * `rules.mk` sets `TAP_DANCE_ENABLE = yes`.
///
/// It is derived from the presence of `KeyAction::TapDance` in the layout, NOT
/// from `settings.tap_dance` — that stored flag can drift out of sync (e.g. an
/// edit rebinds the only tap-dance keys to mod-taps but leaves the flag `true`),
/// and a `TAP_DANCE_ENABLE=yes` with no `tap_dance_actions[]` fails to compile
/// (`tap_dance_actions undeclared` in QMK's `keymap_introspection.c`, guarded by
/// `#if defined(TAP_DANCE_ENABLE)`). Keying both sides off actual usage makes any
/// drift in the flag harmless.
pub fn uses_tap_dance(layout: &LayoutFile) -> bool {
    !RenderPlan::build(layout).dances.is_empty()
}

/// Whether the layout actually has combos. Same single-source-of-truth rule as
/// [`uses_tap_dance`], for the same reason: `COMBO_ENABLE` (rules.mk),
/// `COMBO_COUNT` (config.h) and the `key_combos[]` array (keymap.c) must agree,
/// and `settings.combos` is a stored flag that can drift away from the layout.
/// `COMBO_ENABLE=yes` with `COMBO_COUNT` unset — or set to 0 — does not build.
pub fn uses_combos(layout: &LayoutFile) -> bool {
    !layout.combos.is_empty()
}

/// Whether keymap.c needs the OS-mode block: a `KeyAction::OsMacro`, a
/// `KeyAction::OsMode` key, or host OS detection (which drives the Ctrl↔Cmd
/// swap on its own). Gating on this keeps a layout that uses none of them
/// byte-identical to what previous builds emitted.
pub fn uses_os_tooling(layout: &LayoutFile) -> bool {
    layout.settings.os_detection || RenderPlan::build(layout).has_os_keys()
}

/// The custom keycode an [`OsModeAction`] generates. These four names are in
/// `shared/keycodes.json` (category `osmode`); `super::leaf_codes` feeds them
/// back through the catalog check so the two cannot drift apart.
pub fn os_mode_keycode(action: OsModeAction) -> &'static str {
    match action {
        OsModeAction::Toggle => "QF_OS_TOGG",
        OsModeAction::Mac => "QF_OS_MAC",
        OsModeAction::Windows => "QF_OS_WIN",
        OsModeAction::Auto => "QF_OS_AUTO",
    }
}

fn unsupported(what: impl std::fmt::Display) -> AppError {
    AppError::CodegenUnsupportedKey(what.to_string())
}

/// `MOD_LCTL` → the `LCTL(..)` wrapper name.
fn mod_wrapper(m: &str) -> Result<&'static str, AppError> {
    Ok(match m {
        "MOD_LCTL" => "LCTL",
        "MOD_LSFT" => "LSFT",
        "MOD_LALT" => "LALT",
        "MOD_LGUI" => "LGUI",
        "MOD_RCTL" => "RCTL",
        "MOD_RSFT" => "RSFT",
        "MOD_RALT" => "RALT",
        "MOD_RGUI" => "RGUI",
        other => return Err(unsupported(format!("unknown modifier {other}"))),
    })
}

/// Render one action to its LAYOUT/combo token.
pub fn render_key(key: &KeyAction, plan: &RenderPlan) -> Result<String, AppError> {
    Ok(match key {
        KeyAction::None { .. } => "KC_NO".into(),
        KeyAction::Transparent { .. } => "KC_TRANSPARENT".into(),
        KeyAction::QkLock { .. } => "QK_LOCK".into(),
        KeyAction::Basic { code, mods: None, .. } => code.clone(),
        KeyAction::Basic { code, mods: Some(mods), .. } => {
            let mut tok = code.clone();
            for m in mods.iter().rev() {
                tok = format!("{}({tok})", mod_wrapper(m)?);
            }
            tok
        }
        KeyAction::LayerSwitch { action, layer, .. } => format!("{action:?}({layer})"),
        KeyAction::ModTap { mods, tap, .. } => {
            let mods: Vec<&str> =
                mods.iter().map(|m| m.as_str()).collect();
            format!("MT({}, {tap})", mods.join(" | "))
        }
        KeyAction::LayerTap { layer, tap, .. } => format!("LT({layer}, {tap})"),
        KeyAction::DualFunc { tap, hold, .. } => {
            let pair = (tap.clone(), hold.clone());
            let n = plan
                .dual_funcs
                .iter()
                .position(|p| *p == pair)
                .ok_or_else(|| unsupported("dualFunc missing from plan"))?;
            format!("DUAL_FUNC_{n}")
        }
        KeyAction::Special { code, .. } | KeyAction::Rgb { code, .. } => code.clone(),
        KeyAction::TapDance { tap, hold, double_tap, tap_hold, .. } => {
            let spec = DanceSpec {
                tap: tap.clone(),
                hold: hold.clone(),
                double_tap: double_tap.clone(),
                tap_hold: tap_hold.clone(),
            };
            let n = plan
                .dances
                .iter()
                .position(|d| *d == spec)
                .ok_or_else(|| unsupported("tapDance missing from plan"))?;
            format!("TD(DANCE_{n})")
        }
        KeyAction::Macro { steps, .. } => {
            let n = plan
                .macros
                .iter()
                .position(|m| m == steps)
                .ok_or_else(|| unsupported("macro missing from plan"))?;
            format!("ST_MACRO_{n}")
        }
        KeyAction::RgbHsv { h, s, v, .. } => format!("HSV_{h}_{s}_{v}"),
        KeyAction::OsMacro { mac, windows, .. } => {
            let spec = OsMacroSpec { mac: mac.clone(), windows: windows.clone() };
            let n = plan
                .os_macros
                .iter()
                .position(|m| *m == spec)
                .ok_or_else(|| unsupported("osMacro missing from plan"))?;
            format!("OS_MACRO_{n}")
        }
        KeyAction::OsMode { action, .. } => os_mode_keycode(*action).into(),
    })
}

/// The decoy `LT(layer, key)` value for `#define DUAL_FUNC_n`. The args are
/// behaviorally inert (the `process_record_user` case returns `false` before
/// action processing), but Oryx picks arbitrary ones per generation, so the
/// pairs of the reference layout are pinned for golden/byte parity; anything
/// new gets a deterministic unique decoy.
fn dual_func_decoy(n: usize, tap: &TapSpec, hold: &TapSpec) -> String {
    const PINNED: [((&str, &str), &str); 6] = [
        (("KC_UP", "KC_UP"), "LT(10, KC_F20)"),
        (("KC_LEFT", "KC_LEFT"), "LT(2, KC_0)"),
        (("KC_DOWN", "KC_DOWN"), "LT(8, KC_Z)"),
        (("KC_RIGHT", "KC_RIGHT"), "LT(15, KC_R)"),
        (("KC_MEDIA_PREV_TRACK", "KC_MEDIA_REWIND"), "LT(5, KC_S)"),
        (("KC_MEDIA_NEXT_TRACK", "KC_MEDIA_FAST_FORWARD"), "LT(13, KC_L)"),
    ];
    for ((t, h), decoy) in PINNED {
        if tap.code == t && hold.code == h {
            return decoy.to_string();
        }
    }
    format!("LT({}, KC_F{})", (n % 15) + 1, 13 + (n % 12))
}

/// `KC_X` → the `SS_TAP(X_X)` name.
fn x_name(code: &str) -> Result<String, AppError> {
    code.strip_prefix("KC_")
        .map(|k| format!("X_{k}"))
        .ok_or_else(|| unsupported(format!("macro step {code} is not a KC_* code")))
}

fn send_string_body(steps: &[MacroStep]) -> Result<String, AppError> {
    let mut parts = Vec::new();
    let last = steps.len().saturating_sub(1);
    for (i, step) in steps.iter().enumerate() {
        let mut tok = format!("SS_TAP({})", x_name(&step.code)?);
        for m in step.mods.as_deref().unwrap_or_default().iter().rev() {
            let w = mod_wrapper(m)?;
            tok = format!("SS_{w}({tok})");
        }
        // No trailing delay after the final tap.
        if i != last {
            if let Some(d) = step.delay {
                tok.push_str(&format!("SS_DELAY({d})"));
            }
        }
        parts.push(tok);
    }
    Ok(parts.join("  "))
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

fn header(plan: &RenderPlan) -> String {
    let mut out = String::from(
        "#include QMK_KEYBOARD_H\n#include \"version.h\"\n#define MOON_LED_LEVEL LED_LEVEL\n#ifndef ZSA_SAFE_RANGE\n#define ZSA_SAFE_RANGE SAFE_RANGE\n#endif\n\n",
    );
    if plan.has_custom_keycodes() {
        out.push_str("enum custom_keycodes {\n  RGB_SLD = ZSA_SAFE_RANGE,\n");
        for (h, s, v) in &plan.hsv_enums {
            out.push_str(&format!("  HSV_{h}_{s}_{v},\n"));
        }
        for n in 0..plan.macros.len() {
            out.push_str(&format!("  ST_MACRO_{n},\n"));
        }
        for n in 0..plan.os_macros.len() {
            out.push_str(&format!("  OS_MACRO_{n},\n"));
        }
        for action in &plan.os_modes {
            out.push_str(&format!("  {},\n", os_mode_keycode(*action)));
        }
        out.push_str("};\n\n\n");
    }
    if !plan.dances.is_empty() {
        out.push_str("\nenum tap_dance_codes {\n");
        for n in 0..plan.dances.len() {
            out.push_str(&format!("  DANCE_{n},\n"));
        }
        out.push_str("};\n\n");
    }
    for (n, (tap, hold)) in plan.dual_funcs.iter().enumerate() {
        out.push_str(&format!(
            "#define DUAL_FUNC_{n} {}\n",
            dual_func_decoy(n, tap, hold)
        ));
    }
    out
}

/// The OS-mode block. `qf_os_mac` is the board's mode and the single source of
/// truth the feature needs: the same flag decides the Ctrl<->Cmd swap and which
/// half of every `OS_MACRO_n` fires.
///
/// `settings.osDefault` is emitted as `QF_OS_DEFAULT_MAC` and the swap is
/// derived from it (`swap == (qf_os_mac != QF_OS_DEFAULT_MAC)`) rather than the
/// direction being baked in: a Windows-authored layout swaps in Mac mode, a
/// Mac-authored one swaps in Windows mode, from the same generated code.
///
/// Emitted only when [`uses_os_tooling`]; it also carries
/// `keyboard_post_init_user` when the ledmap section — which owns that function
/// otherwise — is not emitted.
fn os_section(layout: &LayoutFile) -> String {
    let mut out = String::from(
        "\n\n/* ---- OS mode --------------------------------------------------------------\n * `qf_os_mac` is the board\'s OS mode and the single source of truth for it: it\n * drives both the Ctrl<->Cmd magic swap and which half of every OS_MACRO_n\n * fires, so the two cannot disagree.\n *\n * QF_OS_DEFAULT_MAC is settings.osDefault - the OS this layout\'s plain Ctrl/Gui\n * mods were authored against, and the mode assumed before detection answers.\n * The swap runs exactly when the current mode differs from it, so the direction\n * is derived from the define instead of being baked into this code.\n *\n * The OS_MACRO_n SEND_STRINGs are deliberately NOT wrapped to suspend the swap.\n * Verified in the firmware source, in two places:\n *   - mod_config()/keycode_config(), where keymap_config.swap_lctl_lgui is\n *     applied, are called ONLY from quantum/keymap_common.c, on the\n *     keycode->action path (QK_MODS, one-shot, layer-mod, mod-tap).\n *   - register_code16 (quantum/quantum.c:126) does not call them, and neither\n *     does the register_code()/unregister_code()/tap_code() trio SEND_STRING\n *     runs on: a modifier goes straight to add_mods(MOD_BIT(code))\n *     (quantum/action.c).\n * So these mods are emitted literally and are never re-swapped. There is no\n * double transformation here, and nothing to neutralize.\n */\n",
    );
    out.push_str(&format!(
        "#define QF_OS_DEFAULT_MAC {}\n\nstatic bool qf_os_mac = QF_OS_DEFAULT_MAC;\n\nstatic void qf_os_apply(void) {{\n  const bool swap = (qf_os_mac != QF_OS_DEFAULT_MAC);\n  eeconfig_read_keymap(&keymap_config);\n  if (keymap_config.swap_lctl_lgui != swap || keymap_config.swap_rctl_rgui != swap) {{\n    keymap_config.swap_lctl_lgui = swap;\n    keymap_config.swap_rctl_rgui = swap;\n    eeconfig_update_keymap(&keymap_config);\n    clear_keyboard();\n  }}\n}}\n",
        if matches!(layout.settings.os_default, OsTarget::Mac) { "true" } else { "false" }
    ));
    if layout.settings.os_detection {
        out.push_str(
            "\nstatic bool         qf_os_override      = false;\nstatic bool         qf_os_detected_once = false;\nstatic os_variant_t qf_os_last_detected = OS_UNSURE;\n\nstatic bool qf_os_is_mac(os_variant_t os) {\n  return os == OS_MACOS || os == OS_IOS;\n}\n\nbool process_detected_host_os_user(os_variant_t os) {\n  /* OS_UNSURE is not an answer: keep whatever mode we are in. */\n  if (os == OS_UNSURE) {\n    return true;\n  }\n  /* Detection is authoritative, a manual QF_OS_* key overrides it, and the\n   * override is dropped as soon as detection reports a DIFFERENT OS than last\n   * time - the board moved to another machine, so the override was about the\n   * old one. This is why config.h leaves OS_DETECTION_SINGLE_REPORT undefined:\n   * with it set, os_detection_task() suppresses every report after the first\n   * and that second report would never arrive. */\n  if (qf_os_override && qf_os_detected_once && os != qf_os_last_detected) {\n    qf_os_override = false;\n  }\n  qf_os_last_detected = os;\n  qf_os_detected_once = true;\n  if (!qf_os_override) {\n    qf_os_mac = qf_os_is_mac(os);\n    qf_os_apply();\n  }\n  return true;\n}\n",
        );
    }
    if !layout.settings.rgb_matrix_custom {
        out.push('\n');
        out.push_str(&post_init(layout, true));
    }
    out
}

/// The boot-time re-apply of `settings.lighting`, emitted inside
/// [`post_init`] when `lighting.apply_on_boot`.
///
/// Without it the `RGB_MATRIX_DEFAULT_*` defines are inert on any board that
/// has been used before. `rgb_matrix_init()` writes them to EEPROM only when
/// EEPROM holds no mode at all (`rgb_matrix.c`, `if (!rgb_matrix_config.mode)`
/// guarding `eeconfig_update_rgb_matrix_default()`), so a board with a stored
/// mode keeps whatever hue, saturation, brightness and effect it was last left
/// on and ignores every one of them — which is also why the ledmap's master
/// brightness (`hsv_to_rgb_with_value` reads `rgb_matrix_config.hsv.v` live)
/// has never followed `lighting.val`.
///
/// The `_noeeprom` variants are the point: they move the live config without
/// writing, so the firmware states the settings afresh on every boot instead of
/// racing EEPROM to own them. The cost — a mode cycled to with `RGB_MOD` does
/// not survive a replug — is stated in the app where the switch is.
const APPLY_LIGHTING: &str = "  /* settings.lighting, applied over whatever EEPROM happens to hold.\n   * rgb_matrix_init() writes the RGB_MATRIX_DEFAULT_* values only when EEPROM\n   * has no mode stored at all, so on a board that has ever been used they are\n   * ignored: it keeps its last hue, brightness and mode. Worse, #undef-ing\n   * effects shrinks the effect enum, so a stored mode index resolves to a\n   * DIFFERENT effect after each flash. These setters change the live config\n   * without writing it, so the firmware is the authority every boot.\n   * The cost, stated in the app where this is chosen: a mode reached with\n   * RGB_MOD on the board does not survive a replug. */\n  rgb_matrix_mode_noeeprom(RGB_MATRIX_DEFAULT_MODE);\n  rgb_matrix_sethsv_noeeprom(RGB_MATRIX_DEFAULT_HUE, RGB_MATRIX_DEFAULT_SAT, RGB_MATRIX_DEFAULT_VAL);\n  rgb_matrix_set_speed_noeeprom(RGB_MATRIX_DEFAULT_SPD);\n";

/// True when the layout needs a `keyboard_post_init_user` at all.
fn needs_post_init(layout: &LayoutFile, uses_os: bool) -> bool {
    uses_os || layout.settings.rgb_matrix_custom || applies_lighting(layout)
}

fn applies_lighting(layout: &LayoutFile) -> bool {
    layout
        .settings
        .lighting
        .as_ref()
        .is_some_and(|l| l.apply_on_boot)
}

/// The single `keyboard_post_init_user` this file emits, wherever it lands.
///
/// Four callers can own it — [`ledmap_section`], [`effect_section`],
/// [`os_section`], and [`render`] for a layout that configures lighting without
/// either LED section — so the body is built here rather than written out four
/// times and left to drift.
fn post_init(layout: &LayoutFile, uses_os: bool) -> String {
    let mut body = String::new();
    // Also the precondition for APPLY_LIGHTING: rgb_matrix_sethsv_* returns
    // having done nothing while the matrix is disabled
    // (`rgb_matrix_sethsv_eeprom_helper`, first line), so enabling comes first.
    if layout.settings.rgb_matrix_custom || applies_lighting(layout) {
        body.push_str("  rgb_matrix_enable();\n");
    }
    if applies_lighting(layout) {
        body.push_str(APPLY_LIGHTING);
    }
    if uses_os {
        body.push_str("  qf_os_apply();\n");
    }
    format!("void keyboard_post_init_user(void) {{\n{body}}}\n")
}

/// LAYOUT arg index ranges of the visual rows (left + right half per line).
const ROWS: [std::ops::Range<usize>; 6] =
    [0..14, 14..28, 28..42, 42..54, 54..66, 66..72];

fn keymaps(layout: &LayoutFile, plan: &RenderPlan) -> Result<String, AppError> {
    let mut out =
        String::from("\nconst uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n");
    for (li, layer) in layout.layers.iter().enumerate() {
        out.push_str(&format!("  [{li}] = LAYOUT_moonlander(\n"));
        for row in ROWS.iter() {
            out.push_str("    ");
            for arg in row.clone() {
                // Visual gap between the left and right halves (Oryx aligns
                // them; the golden comparison needs at least one space here).
                if matches!(arg, 7 | 21 | 35 | 48 | 60 | 69) {
                    out.push_str("                ");
                }
                let tok = render_key(&layer.keys[arg], plan)?;
                if arg == 71 {
                    out.push_str(&tok);
                } else {
                    out.push_str(&format!("{:<16}", format!("{tok},")));
                }
            }
            out.push('\n');
        }
        out.push_str("  ),\n");
    }
    out.push_str("};\n");
    Ok(out)
}

fn combos(layout: &LayoutFile, plan: &RenderPlan) -> Result<String, AppError> {
    if !uses_combos(layout) {
        return Ok(String::new());
    }
    let mut out = String::from("\n");
    for (n, combo) in layout.combos.iter().enumerate() {
        let layer = layout
            .layers
            .get(combo.layer as usize)
            .ok_or_else(|| unsupported(format!("combo {:?} layer out of range", combo.name)))?;
        let toks = combo
            .keys
            .iter()
            .map(|&k| render_key(&layer.keys[k as usize], plan))
            .collect::<Result<Vec<_>, _>>()?;
        out.push_str(&format!(
            "const uint16_t PROGMEM combo{n}[] = {{ {}, COMBO_END}};\n",
            toks.join(", ")
        ));
    }
    out.push_str("\ncombo_t key_combos[COMBO_COUNT] = {\n");
    for (n, combo) in layout.combos.iter().enumerate() {
        out.push_str(&format!(
            "    COMBO(combo{n}, {}),\n",
            render_key(&combo.action, plan)?
        ));
    }
    out.push_str("};\n");
    Ok(out)
}

/// True when the per-layer ledmap is what paints the board.
///
/// `settings.rgbMatrixCustom` says the layout carries LED data at all;
/// `lighting.mode` says whether that data is what the board shows. In
/// [`LightingMode::Effect`] the ledmap is not emitted — and that is a real
/// removal, not a suppression: `rgb_matrix_indicators_user()` runs after the
/// active effect has drawn its frame and `set_layer_color()` rewrites every
/// LED, so leaving the ledmap in would make the effect literally invisible.
///
/// [`LightingMode::Reactive`] is a ledmap mode: the same table, the same
/// repaint, with each LED's brightness modulated by how recently it was struck.
pub fn emits_ledmap(layout: &LayoutFile) -> bool {
    layout.settings.rgb_matrix_custom
        && !matches!(
            layout.settings.lighting.as_ref().map(|l| l.mode),
            Some(LightingMode::Effect)
        )
}

/// True when the emitted `set_layer_color()` modulates brightness from
/// `g_last_hit_tracker`.
fn ledmap_is_reactive(layout: &LayoutFile) -> bool {
    emits_ledmap(layout)
        && matches!(
            layout.settings.lighting.as_ref().map(|l| l.mode),
            Some(LightingMode::Reactive)
        )
}

/// `qf_reactive_value()` — the whole of the reactive ledmap, and the thing
/// none of QMK's twelve reactive effects can do.
///
/// Every one of them renders through `effect_runner_reactive`, which paints
/// each LED from `rgb_matrix_config.hsv`: one hue, one saturation, one board.
/// Turning one on replaces the layout's colours with a single colour, which is
/// what "reactive, but every key white" looks like. Here the colours come from
/// the ledmap exactly as in static mode and only `v` moves.
///
/// `g_last_hit_tracker` (`rgb_matrix.h:284`, declared only under
/// `RGB_MATRIX_KEYREACTIVE_ENABLED`) is QMK's record of recent hits: `count`
/// live entries, appended oldest-first, each with the `index` of the LED struck
/// and `tick`, milliseconds since. So the search runs backwards and takes the
/// first entry for this LED — the most recent one.
///
/// **It remembers `LED_HITS_TO_REMEMBER` hits, 8 by default, and no more.**
/// Strike a ninth key while eight are still inside the fade window and
/// `rgb_matrix_handle_key_event` shifts the oldest entry out of the buffer; that
/// key drops straight back to rest instead of finishing its fade. Eight keys
/// inside one fade window is faster than the fade is long, and the visible
/// failure is a glow cut short — never a wrong colour, because the colour never
/// came from here.
const REACTIVE_HELPER: &str = "\n#ifndef RGB_MATRIX_KEYREACTIVE_ENABLED\n#    error \"reactive ledmap needs RGB_MATRIX_KEYPRESSES: config.h and keymap.c disagree\"\n#endif\n\n/* The brightness of one LED this frame, given its ledmap value.\n *\n * g_last_hit_tracker is QMK's record of recent key hits: `count` live entries,\n * appended oldest-first, each carrying the `index` of the LED that was struck\n * and `tick`, milliseconds since. The newest is last, so this searches\n * backwards and stops at the first entry for this LED.\n *\n * It remembers LED_HITS_TO_REMEMBER hits (8) and no more. Strike a ninth key\n * while eight are still inside the fade window and rgb_matrix_handle_key_event\n * shifts the oldest entry out; that key drops straight back to rest instead of\n * finishing its fade. The colours are never affected - they come from the\n * ledmap, not from here. */\nstatic uint8_t qf_reactive_value(uint8_t led, uint8_t v) {\n  uint16_t tick = QF_REACTIVE_FADE_MS;\n  for (int8_t j = (int8_t)g_last_hit_tracker.count - 1; j >= 0; j--) {\n    if (g_last_hit_tracker.index[j] == led) {\n      tick = g_last_hit_tracker.tick[j];\n      break;\n    }\n  }\n  /* 255 - BOOST at rest, up to 255 the instant the key is struck. */\n  uint16_t level = 255 - QF_REACTIVE_BOOST;\n  if (tick < QF_REACTIVE_FADE_MS) {\n    level += ((uint32_t)QF_REACTIVE_BOOST * (QF_REACTIVE_FADE_MS - tick)) / QF_REACTIVE_FADE_MS;\n  }\n  return (uint8_t)(((uint16_t)v * level) / 255);\n}\n";

/// `keyboard_post_init_user` on its own, for effect mode: the board still has
/// to turn the matrix on, it just has no ledmap to paint with afterwards.
/// Everything else `ledmap_section` emits — `hsv_to_rgb_with_value`, the
/// `ledmap[]` table, `set_layer_color`, `rgb_matrix_indicators_user` — exists
/// only to serve that table and goes with it.
fn effect_section(layout: &LayoutFile, uses_os: bool) -> String {
    let mut out = String::from(
        "\n\n\n/* mode: effect — the RGB Matrix effect chosen in config.h owns the LEDs.\n * No ledmap is emitted, so nothing repaints over it. */\n",
    );
    out.push_str(&post_init(layout, uses_os));
    out
}

/// `uses_os` adds the boot-time OS-mode apply to `keyboard_post_init_user`,
/// which this section owns; `os_section` emits its own copy of that function
/// when neither this section nor [`effect_section`] is emitted at all.
fn ledmap_section(layout: &LayoutFile, uses_os: bool) -> Result<String, AppError> {
    let mut out = String::from(
        "\n\n\nextern rgb_config_t rgb_matrix_config;\n\nRGB hsv_to_rgb_with_value(HSV hsv) {\n  RGB rgb = hsv_to_rgb( hsv );\n  float f = (float)rgb_matrix_config.hsv.v / UINT8_MAX;\n  return (RGB){ f * rgb.r, f * rgb.g, f * rgb.b };\n}\n\n",
    );
    out.push_str(&post_init(layout, uses_os));
    out.push('\n');
    out.push_str(&super::ledmap::render(layout)?);
    if ledmap_is_reactive(layout) {
        out.push_str(REACTIVE_HELPER);
    }
    out.push_str(
        "\nvoid set_layer_color(int layer) {\n  for (int i = 0; i < RGB_MATRIX_LED_COUNT; i++) {\n    HSV hsv = {\n      .h = pgm_read_byte(&ledmap[layer][i][0]),\n      .s = pgm_read_byte(&ledmap[layer][i][1]),\n      .v = pgm_read_byte(&ledmap[layer][i][2]),\n    };\n    if (!hsv.h && !hsv.s && !hsv.v) {\n        rgb_matrix_set_color( i, 0, 0, 0 );\n    } else {\n",
    );
    if ledmap_is_reactive(layout) {
        // After the off test, deliberately: {0,0,0} is the ledmap's "LED off"
        // and stays off however hard the key is struck. Before the master-
        // brightness scaling in hsv_to_rgb_with_value, also deliberately: the
        // dip is relative to this key's own colour, and the board's ceiling
        // still applies to the result.
        out.push_str("        hsv.v = qf_reactive_value((uint8_t)i, hsv.v);\n");
    }
    out.push_str(
        "        RGB rgb = hsv_to_rgb_with_value(hsv);\n        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);\n    }\n  }\n}\n\nbool rgb_matrix_indicators_user(void) {\n  if (rawhid_state.rgb_control) {\n      return false;\n  }\n  if (!keyboard_config.disable_layer_led) { \n    switch (biton32(layer_state)) {\n",
    );
    for li in 0..layout.layers.len() {
        out.push_str(&format!(
            "      case {li}:\n        set_layer_color({li});\n        break;\n"
        ));
    }
    out.push_str(
        "     default:\n        if (rgb_matrix_get_flags() == LED_FLAG_NONE) {\n          rgb_matrix_set_color_all(0, 0, 0);\n        }\n    }\n  } else {\n    if (rgb_matrix_get_flags() == LED_FLAG_NONE) {\n      rgb_matrix_set_color_all(0, 0, 0);\n    }\n  }\n\n  return true;\n}\n",
    );
    Ok(out)
}

fn dance_section(plan: &RenderPlan) -> String {
    if plan.dances.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "\n\ntypedef struct {{\n    bool is_press_action;\n    uint8_t step;\n}} tap;\n\nenum {{\n    SINGLE_TAP = 1,      \n    SINGLE_HOLD,         \n    DOUBLE_TAP,          \n    DOUBLE_HOLD,         \n    DOUBLE_SINGLE_TAP,   \n    MORE_TAPS            \n}};\n\nstatic tap dance_state[{}];\n\nuint8_t dance_step(tap_dance_state_t *state);\n\nuint8_t dance_step(tap_dance_state_t *state) {{\n    if (state->count == 1) {{\n        if (state->interrupted || !state->pressed) return SINGLE_TAP;\n        else return SINGLE_HOLD;\n    }} else if (state->count == 2) {{\n        if (state->interrupted) return DOUBLE_SINGLE_TAP;\n        else if (state->pressed) return DOUBLE_HOLD;\n        else return DOUBLE_TAP;\n    }}\n    return MORE_TAPS;\n}}\n\n",
        plan.dances.len()
    );
    for (n, d) in plan.dances.iter().enumerate() {
        // (case label, code to register, tap-twice on DOUBLE_TAP)
        let mut finished: Vec<(&str, &str, bool)> = Vec::new();
        if let Some(tap) = &d.tap {
            finished.push(("SINGLE_TAP", tap, false));
        }
        if let Some(hold) = &d.hold {
            finished.push(("SINGLE_HOLD", hold, false));
        }
        if let Some(dt) = &d.double_tap {
            finished.push(("DOUBLE_TAP", dt, Some(dt) == d.tap.as_ref()));
        }
        if let Some(th) = &d.tap_hold {
            finished.push(("DOUBLE_HOLD", th, false));
        }
        out.push_str(&format!(
            "\nvoid on_dance_{n}(tap_dance_state_t *state, void *user_data);\nvoid dance_{n}_finished(tap_dance_state_t *state, void *user_data);\nvoid dance_{n}_reset(tap_dance_state_t *state, void *user_data);\n\n"
        ));
        // on_dance: triple-tap emits the tap code three times, further taps once.
        out.push_str(&format!("void on_dance_{n}(tap_dance_state_t *state, void *user_data) {{\n"));
        if let Some(tap) = &d.tap {
            out.push_str(&format!(
                "    if(state->count == 3) {{\n        tap_code16({tap});\n        tap_code16({tap});\n        tap_code16({tap});\n    }}\n    if(state->count > 3) {{\n        tap_code16({tap});\n    }}\n"
            ));
        }
        out.push_str("}\n\n");
        // finished
        out.push_str(&format!(
            "void dance_{n}_finished(tap_dance_state_t *state, void *user_data) {{\n    dance_state[{n}].step = dance_step(state);\n    switch (dance_state[{n}].step) {{\n"
        ));
        for (label, code, twice) in &finished {
            if *twice {
                out.push_str(&format!(
                    "        case {label}: register_code16({code}); register_code16({code}); break;\n"
                ));
            } else {
                out.push_str(&format!("        case {label}: register_code16({code}); break;\n"));
            }
        }
        if let Some(tap) = &d.tap {
            out.push_str(&format!(
                "        case DOUBLE_SINGLE_TAP: tap_code16({tap}); register_code16({tap});\n"
            ));
        }
        out.push_str("    }\n}\n\n");
        // reset
        out.push_str(&format!(
            "void dance_{n}_reset(tap_dance_state_t *state, void *user_data) {{\n    wait_ms(10);\n    switch (dance_state[{n}].step) {{\n"
        ));
        for (label, code, _) in &finished {
            out.push_str(&format!("        case {label}: unregister_code16({code}); break;\n"));
        }
        if let Some(tap) = &d.tap {
            out.push_str(&format!(
                "        case DOUBLE_SINGLE_TAP: unregister_code16({tap}); break;\n"
            ));
        }
        out.push_str(&format!("    }}\n    dance_state[{n}].step = 0;\n}}\n"));
    }
    out.push_str("\ntap_dance_action_t tap_dance_actions[] = {\n");
    for n in 0..plan.dances.len() {
        out.push_str(&format!(
            "        [DANCE_{n}] = ACTION_TAP_DANCE_FN_ADVANCED(on_dance_{n}, dance_{n}_finished, dance_{n}_reset),\n"
        ));
    }
    out.push_str("};\n");
    out
}

fn process_record_user(layout: &LayoutFile, plan: &RenderPlan)
    -> Result<String, AppError>
{
    let mut out = String::from(
        "\nbool process_record_user(uint16_t keycode, keyrecord_t *record) {\n  switch (keycode) {\n  case QK_MODS ... QK_MODS_MAX:\n    // Mouse and consumer keys (volume, media) with modifiers work inconsistently across operating systems,\n    // this makes sure that modifiers are always applied to the key that was pressed.\n    if (IS_MOUSE_KEYCODE(QK_MODS_GET_BASIC_KEYCODE(keycode)) || IS_CONSUMER_KEYCODE(QK_MODS_GET_BASIC_KEYCODE(keycode))) {\n      if (record->event.pressed) {\n        add_mods(QK_MODS_GET_MODS(keycode));\n        send_keyboard_report();\n        wait_ms(2);\n        register_code(QK_MODS_GET_BASIC_KEYCODE(keycode));\n        return false;\n      } else {\n        wait_ms(2);\n        del_mods(QK_MODS_GET_MODS(keycode));\n      }\n    }\n    break;\n",
    );
    for (n, steps) in plan.macros.iter().enumerate() {
        out.push_str(&format!(
            "    case ST_MACRO_{n}:\n    if (record->event.pressed) {{\n      SEND_STRING({});\n    }}\n    break;\n",
            send_string_body(steps)?
        ));
    }
    if !plan.macros.is_empty() {
        out.push('\n');
    }
    out.push_str(&os_cases(layout, plan)?);
    for (n, (tap, hold)) in plan.dual_funcs.iter().enumerate() {
        let tap_tok = render_tap_spec(tap)?;
        let hold_tok = render_tap_spec(hold)?;
        out.push_str(&format!(
            "    case DUAL_FUNC_{n}:\n      if (record->tap.count > 0) {{\n        if (record->event.pressed) {{\n          register_code16({tap_tok});\n        }} else {{\n          unregister_code16({tap_tok});\n        }}\n      }} else {{\n        if (record->event.pressed) {{\n          register_code16({hold_tok});\n        }} else {{\n          unregister_code16({hold_tok});\n        }}  \n      }}  \n      return false;\n"
        ));
    }
    if plan.rgb_sld {
        out.push_str(
            "    case RGB_SLD:\n        if (rawhid_state.rgb_control) {\n            return false;\n        }\n        if (record->event.pressed) {\n            rgblight_mode(1);\n        }\n        return false;\n",
        );
    }
    for (h, s, v) in &plan.hsv_enums {
        out.push_str(&format!(
            "    case HSV_{h}_{s}_{v}:\n        if (rawhid_state.rgb_control) {{\n            return false;\n        }}\n        if (record->event.pressed) {{\n            rgblight_mode(1);\n            rgblight_sethsv({h},{s},{v});\n        }}\n        return false;\n"
        ));
    }
    out.push_str("  }\n  return true;\n}\n");
    Ok(out)
}

/// The `process_record_user` arms for `OS_MACRO_n` and the `QF_OS_*` keys.
///
/// An OS macro reads the same `qf_os_mac` flag the Ctrl<->Cmd swap is derived
/// from, so a key and the swap can never disagree about which OS the board is
/// on. An empty step list for one OS means the key does nothing there: that
/// branch is dropped entirely rather than emitting an empty `SEND_STRING()`,
/// which is not valid C. `validate()` already rejects both sides empty.
///
/// `qf_os_override` only exists when detection is on — with nothing to override
/// it would be a set-but-never-read variable, and the manual keys are simply
/// authoritative.
fn os_cases(layout: &LayoutFile, plan: &RenderPlan) -> Result<String, AppError> {
    if !plan.has_os_keys() {
        return Ok(String::new());
    }
    let detection = layout.settings.os_detection;
    let mut out = String::new();
    for (n, spec) in plan.os_macros.iter().enumerate() {
        let body = match (spec.mac.is_empty(), spec.windows.is_empty()) {
            (false, false) => format!(
                "      if (qf_os_mac) {{\n        SEND_STRING({});\n      }} else {{\n        SEND_STRING({});\n      }}\n",
                send_string_body(&spec.mac)?,
                send_string_body(&spec.windows)?
            ),
            (true, false) => format!(
                "      /* nothing to send in Mac mode */\n      if (!qf_os_mac) {{\n        SEND_STRING({});\n      }}\n",
                send_string_body(&spec.windows)?
            ),
            (false, true) => format!(
                "      /* nothing to send in Windows mode */\n      if (qf_os_mac) {{\n        SEND_STRING({});\n      }}\n",
                send_string_body(&spec.mac)?
            ),
            // validate() rejects this; be explicit rather than emit dead C.
            (true, true) => {
                return Err(unsupported(format!(
                    "osMacro {n} has no steps for either OS"
                )))
            }
        };
        out.push_str(&format!(
            "    case OS_MACRO_{n}:\n    if (record->event.pressed) {{\n{body}    }}\n    break;\n"
        ));
    }
    for action in &plan.os_modes {
        let keycode = os_mode_keycode(*action);
        let mut body = String::new();
        if detection {
            // A manual key pins the mode until detection says the board moved.
            body.push_str(if matches!(action, OsModeAction::Auto) {
                "        qf_os_override = false;\n"
            } else {
                "        qf_os_override = true;\n"
            });
        }
        body.push_str(&match action {
            OsModeAction::Toggle => "        qf_os_mac = !qf_os_mac;\n".to_string(),
            OsModeAction::Mac => "        qf_os_mac = true;\n".to_string(),
            OsModeAction::Windows => "        qf_os_mac = false;\n".to_string(),
            OsModeAction::Auto if detection => {
                "        /* Follow the host again: adopt whatever it last told us,\n           and the layout's authored default until it tells us anything. */\n        const os_variant_t os = detected_host_os();\n        qf_os_mac = (os == OS_UNSURE) ? QF_OS_DEFAULT_MAC : qf_os_is_mac(os);\n"
                    .to_string()
            }
            // Detection is off, so there is nothing to hand control back to:
            // "auto" means the OS the layout was authored against.
            OsModeAction::Auto => "        qf_os_mac = QF_OS_DEFAULT_MAC;\n".to_string(),
        });
        out.push_str(&format!(
            "    case {keycode}:\n      if (record->event.pressed) {{\n{body}        qf_os_apply();\n      }}\n      return false;\n"
        ));
    }
    out.push('\n');
    Ok(out)
}

/// A dualFunc side as a register_code16 argument (mods → nested wrappers).
fn render_tap_spec(spec: &TapSpec) -> Result<String, AppError> {
    let mut tok = spec.code.clone();
    for m in spec.mods.as_deref().unwrap_or_default().iter().rev() {
        tok = format!("{}({tok})", mod_wrapper(m)?);
    }
    Ok(tok)
}

/// Render the whole keymap.c.
pub fn render(layout: &LayoutFile) -> Result<String, AppError> {
    // The renderer is Moonlander-shaped (LAYOUT_moonlander, its row split,
    // its ledmap): adding a keyboard to the registry requires generalizing
    // this file, so refuse anything else loudly rather than emit garbage.
    if layout.meta.geometry != "moonlander" {
        return Err(unsupported(format!(
            "codegen only supports the Moonlander today (layout is for {:?})",
            layout.meta.geometry
        )));
    }
    let plan = RenderPlan::build(layout);
    let uses_os = uses_os_tooling(layout);
    let mut out = header(&plan);
    // Before keymaps: `keyboard_post_init_user` (in the ledmap section) calls
    // `qf_os_apply`, so the OS block has to be defined by then.
    if uses_os {
        out.push_str(&os_section(layout));
    }
    out.push_str(&keymaps(layout, &plan)?);
    out.push_str(&combos(layout, &plan)?);
    if emits_ledmap(layout) {
        out.push_str(&ledmap_section(layout, uses_os)?);
    } else if layout.settings.rgb_matrix_custom {
        out.push_str(&effect_section(layout, uses_os));
    } else if !uses_os && needs_post_init(layout, uses_os) {
        // No LED section and no OS block, but the layout still configures
        // lighting and wants it applied at boot — so nothing else is going to
        // emit `keyboard_post_init_user` and this has to.
        out.push_str("\n\n\n/* The layout carries no ledmap, but it does configure RGB Matrix. */\n");
        out.push_str(&post_init(layout, uses_os));
    }
    out.push_str(&dance_section(&plan));
    out.push_str(&process_record_user(layout, &plan)?);
    Ok(out)
}
