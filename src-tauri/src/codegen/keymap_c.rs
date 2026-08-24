//! `keymap.c` renderer. `shared/fixtures/reference_keymap.c` (the real
//! Oryx-generated arrows_together source, MEH→QK_LOCK applied) is the golden
//! spec: output must match it byte-identically modulo whitespace.

use crate::error::AppError;
use crate::layout::schema::{KeyAction, LayoutFile, MacroStep, TapSpec};

/// Numbering plan for the custom constructs a layout uses, in first-occurrence
/// LAYOUT-arg scan order (layers first, then combo actions).
#[derive(Debug, Default)]
pub struct RenderPlan {
    pub rgb_sld: bool,
    pub hsv_enums: Vec<(u8, u8, u8)>,
    pub macros: Vec<Vec<MacroStep>>,
    pub dual_funcs: Vec<(TapSpec, TapSpec)>,
    pub dances: Vec<DanceSpec>,
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
        self.rgb_sld || !self.hsv_enums.is_empty() || !self.macros.is_empty()
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
        // Contract-only for now: the schema can carry these, codegen cannot
        // yet emit them. Erroring here keeps a layout that uses one from
        // silently building into firmware that ignores it.
        KeyAction::OsMacro { label, .. } => {
            return Err(unsupported(format!(
                "osMacro {label:?}: OS-aware macros are not generated yet"
            )))
        }
        KeyAction::OsMode { action, .. } => {
            return Err(unsupported(format!(
                "osMode {action:?}: OS-mode keys are not generated yet"
            )))
        }
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
    if layout.combos.is_empty() {
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

fn ledmap_section(layout: &LayoutFile) -> Result<String, AppError> {
    let mut out = String::from(
        "\n\n\nextern rgb_config_t rgb_matrix_config;\n\nRGB hsv_to_rgb_with_value(HSV hsv) {\n  RGB rgb = hsv_to_rgb( hsv );\n  float f = (float)rgb_matrix_config.hsv.v / UINT8_MAX;\n  return (RGB){ f * rgb.r, f * rgb.g, f * rgb.b };\n}\n\nvoid keyboard_post_init_user(void) {\n  rgb_matrix_enable();\n}\n\n",
    );
    out.push_str(&super::ledmap::render(layout)?);
    out.push_str(
        "\nvoid set_layer_color(int layer) {\n  for (int i = 0; i < RGB_MATRIX_LED_COUNT; i++) {\n    HSV hsv = {\n      .h = pgm_read_byte(&ledmap[layer][i][0]),\n      .s = pgm_read_byte(&ledmap[layer][i][1]),\n      .v = pgm_read_byte(&ledmap[layer][i][2]),\n    };\n    if (!hsv.h && !hsv.s && !hsv.v) {\n        rgb_matrix_set_color( i, 0, 0, 0 );\n    } else {\n        RGB rgb = hsv_to_rgb_with_value(hsv);\n        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);\n    }\n  }\n}\n\nbool rgb_matrix_indicators_user(void) {\n  if (rawhid_state.rgb_control) {\n      return false;\n  }\n  if (!keyboard_config.disable_layer_led) { \n    switch (biton32(layer_state)) {\n",
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

fn process_record_user(plan: &RenderPlan) -> Result<String, AppError> {
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
    let mut out = header(&plan);
    out.push_str(&keymaps(layout, &plan)?);
    out.push_str(&combos(layout, &plan)?);
    if layout.settings.rgb_matrix_custom {
        out.push_str(&ledmap_section(layout)?);
    }
    out.push_str(&dance_section(&plan));
    out.push_str(&process_record_user(&plan)?);
    Ok(out)
}
