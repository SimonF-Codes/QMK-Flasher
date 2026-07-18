//! Parser for Oryx-generated `keymap.c`.
//!
//! Two consumers:
//! 1. The mandatory seed-time cross-check — seeded+rendered tokens must match
//!    the downloaded source at every position (modulo `KC_MEH`→`QK_LOCK`),
//!    else [`AppError::PermutationMismatch`] with a positional diff.
//! 2. Fallback seeding if the Oryx GraphQL shape ever changes.
//!
//! The grammar is exactly what Oryx emits (see
//! `shared/fixtures/reference_keymap.c`), not general C: LAYOUT blocks split
//! on paren-balanced commas, `DUAL_FUNC_n` defines + their
//! `process_record_user` behaviors, `ST_MACRO_n` SEND_STRING bodies,
//! tap-dance `dance_n_finished` blocks, and combo arrays.

use std::collections::BTreeMap;

use crate::error::AppError;

/// Everything we extract from one keymap.c.
#[derive(Debug, Default)]
pub struct ParsedKeymap {
    /// Per layer, the 72 LAYOUT argument tokens in arg order.
    pub layers: Vec<Vec<String>>,
    /// `DUAL_FUNC_n` → the raw `#define` value, e.g. `LT(10, KC_F20)`.
    pub dual_func_defines: BTreeMap<u32, String>,
    /// `DUAL_FUNC_n` → (tap code, hold code) from `process_record_user`.
    pub dual_funcs: BTreeMap<u32, DualFuncBehavior>,
    /// `ST_MACRO_n` → parsed SEND_STRING steps.
    pub st_macros: BTreeMap<u32, Vec<ParsedMacroStep>>,
    /// `DANCE_n` → behavior from `dance_n_finished`.
    pub dances: BTreeMap<u32, ParsedDance>,
    /// Combos in declaration order.
    pub combos: Vec<ParsedCombo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DualFuncBehavior {
    pub tap: String,
    pub hold: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMacroStep {
    pub code: String,
    /// The `SS_DELAY(ms)` following this tap, if any.
    pub delay: Option<u16>,
    /// `MOD_*` tokens of enclosing `SS_LCTL(..)`-style wrappers, outermost first.
    pub mods: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedDance {
    /// SINGLE_TAP register code.
    pub tap: Option<String>,
    /// SINGLE_HOLD register code.
    pub hold: Option<String>,
    /// DOUBLE_TAP register code.
    pub double_tap: Option<String>,
    /// DOUBLE_HOLD register code (Oryx "tap then hold").
    pub tap_hold: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCombo {
    /// Trigger key tokens, e.g. `["TG(2)", "TO(4)"]` (COMBO_END dropped).
    pub trigger_tokens: Vec<String>,
    /// The combo's output token, e.g. `TG(5)`.
    pub action_token: String,
}

fn err(what: &str) -> AppError {
    AppError::PermutationMismatch(format!("keymap.c parse: {what}"))
}

/// Index of the `)` matching the `(` at `open` (byte offsets).
fn matching_paren(src: &str, open: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    debug_assert_eq!(bytes[open], b'(');
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate().skip(open) {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Split on commas at paren depth 0, trimming whitespace.
fn split_top_level_commas(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (i, b) in src.bytes().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                out.push(src[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    let last = src[start..].trim();
    if !last.is_empty() {
        out.push(last.to_string());
    }
    out
}

/// Collapse internal whitespace runs to a single space ("LT(3,  KC_SCLN)" and
/// "LT(3,\n KC_SCLN)" compare equal).
fn normalize_token(tok: &str) -> String {
    tok.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// All `LAYOUT_moonlander(...)` argument lists, in source order.
fn parse_layout_blocks(src: &str) -> Result<Vec<Vec<String>>, AppError> {
    const MARKER: &str = "LAYOUT_moonlander";
    let mut layers = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = src[at..].find(MARKER) {
        let open = at + rel + MARKER.len();
        if src.as_bytes().get(open) != Some(&b'(') {
            at = open;
            continue;
        }
        let close = matching_paren(src, open)
            .ok_or_else(|| err("unbalanced LAYOUT_moonlander parens"))?;
        let args = split_top_level_commas(&src[open + 1..close])
            .iter()
            .map(|t| normalize_token(t))
            .collect::<Vec<_>>();
        layers.push(args);
        at = close;
    }
    if layers.is_empty() {
        return Err(err("no LAYOUT_moonlander blocks found"));
    }
    Ok(layers)
}

/// The body of `case <label>:` up to its terminating `return false;`/`break;`.
fn case_body<'a>(src: &'a str, label: &str) -> Option<&'a str> {
    let start = src.find(&format!("case {label}:"))? + label.len() + 6;
    let rest = &src[start..];
    let end = ["return false;", "break;"]
        .iter()
        .filter_map(|t| rest.find(t))
        .min()
        .unwrap_or(rest.len());
    Some(&rest[..end])
}

/// First `register_code16(X)` argument in `body` (never matches
/// `unregister_code16` — no word boundary inside `unregister`).
fn register_codes(body: &str) -> Vec<String> {
    let re = regex::Regex::new(r"\bregister_code16\(([A-Za-z0-9_]+)\)").unwrap();
    re.captures_iter(body)
        .map(|c| c[1].to_string())
        .collect()
}

/// `#define DUAL_FUNC_n <value>` lines.
fn parse_dual_func_defines(src: &str) -> BTreeMap<u32, String> {
    let re = regex::Regex::new(r"#define DUAL_FUNC_(\d+) (.+)").unwrap();
    re.captures_iter(src)
        .map(|c| (c[1].parse().unwrap(), normalize_token(c[2].trim())))
        .collect()
}

/// `case DUAL_FUNC_n:` behaviors: tap branch registers first, hold second.
fn parse_dual_funcs(
    src: &str,
    defines: &BTreeMap<u32, String>,
) -> Result<BTreeMap<u32, DualFuncBehavior>, AppError> {
    let mut out = BTreeMap::new();
    for &n in defines.keys() {
        let body = case_body(src, &format!("DUAL_FUNC_{n}"))
            .ok_or_else(|| err(&format!("no process_record_user case for DUAL_FUNC_{n}")))?;
        let codes = register_codes(body);
        match codes.as_slice() {
            [tap, hold] => {
                out.insert(n, DualFuncBehavior { tap: tap.clone(), hold: hold.clone() });
            }
            other => {
                return Err(err(&format!(
                    "DUAL_FUNC_{n}: expected 2 register_code16 calls, found {}",
                    other.len()
                )))
            }
        }
    }
    Ok(out)
}

/// Tokenize a SEND_STRING body into steps.
fn parse_send_string(body: &str) -> Result<Vec<ParsedMacroStep>, AppError> {
    const WRAPPERS: [(&str, &str); 8] = [
        ("SS_LCTL(", "MOD_LCTL"),
        ("SS_LSFT(", "MOD_LSFT"),
        ("SS_LALT(", "MOD_LALT"),
        ("SS_LGUI(", "MOD_LGUI"),
        ("SS_RCTL(", "MOD_RCTL"),
        ("SS_RSFT(", "MOD_RSFT"),
        ("SS_RALT(", "MOD_RALT"),
        ("SS_RGUI(", "MOD_RGUI"),
    ];
    let mut steps: Vec<ParsedMacroStep> = Vec::new();
    // (mod token, close depth) stack for SS_LCTL(...)-style wrappers.
    let mut mods: Vec<String> = Vec::new();
    let mut closes: Vec<usize> = Vec::new(); // pending wrapper close positions
    let mut i = 0usize;
    'outer: while i < body.len() {
        while let Some(&close) = closes.last() {
            if i == close {
                closes.pop();
                mods.pop();
                i += 1; // skip ')'
                continue 'outer;
            }
            break;
        }
        let rest = &body[i..];
        if let Some(rest2) = rest.strip_prefix("SS_TAP(") {
            let close = matching_paren(body, i + 6).ok_or_else(|| err("unbalanced SS_TAP"))?;
            let arg = rest2[..close - (i + 7)].trim();
            let code = arg
                .strip_prefix("X_")
                .map(|k| format!("KC_{k}"))
                .ok_or_else(|| err(&format!("SS_TAP arg {arg:?} is not X_*")))?;
            steps.push(ParsedMacroStep { code, delay: None, mods: mods.clone() });
            i = close + 1;
        } else if let Some(_rest2) = rest.strip_prefix("SS_DELAY(") {
            let close = matching_paren(body, i + 8).ok_or_else(|| err("unbalanced SS_DELAY"))?;
            let ms: u16 = body[i + 9..close]
                .trim()
                .parse()
                .map_err(|_| err("bad SS_DELAY value"))?;
            let step = steps
                .last_mut()
                .ok_or_else(|| err("SS_DELAY before any SS_TAP"))?;
            step.delay = Some(ms);
            i = close + 1;
        } else if let Some((prefix, tok)) =
            WRAPPERS.iter().find(|(p, _)| rest.starts_with(p))
        {
            let open = i + prefix.len() - 1;
            let close = matching_paren(body, open)
                .ok_or_else(|| err(&format!("unbalanced {prefix}")))?;
            mods.push(tok.to_string());
            closes.push(close);
            i = open + 1;
        } else if rest.starts_with(char::is_whitespace) {
            i += rest.len() - rest.trim_start().len();
        } else {
            return Err(err(&format!(
                "unrecognized SEND_STRING token at {:?}",
                &rest[..rest.len().min(24)]
            )));
        }
    }
    Ok(steps)
}

/// All `case ST_MACRO_n:` SEND_STRING bodies.
fn parse_st_macros(src: &str) -> Result<BTreeMap<u32, Vec<ParsedMacroStep>>, AppError> {
    let re = regex::Regex::new(r"\bST_MACRO_(\d+)\b").unwrap();
    let ids: std::collections::BTreeSet<u32> =
        re.captures_iter(src).map(|c| c[1].parse().unwrap()).collect();
    let mut out = BTreeMap::new();
    for n in ids {
        let body = case_body(src, &format!("ST_MACRO_{n}"))
            .ok_or_else(|| err(&format!("no process_record_user case for ST_MACRO_{n}")))?;
        let open = body
            .find("SEND_STRING(")
            .ok_or_else(|| err(&format!("ST_MACRO_{n}: no SEND_STRING")))?
            + "SEND_STRING".len();
        let close = matching_paren(body, open)
            .ok_or_else(|| err("unbalanced SEND_STRING"))?;
        out.insert(n, parse_send_string(&body[open + 1..close])?);
    }
    Ok(out)
}

/// `dance_n_finished` behaviors keyed by step.
fn parse_dances(src: &str) -> Result<BTreeMap<u32, ParsedDance>, AppError> {
    let re = regex::Regex::new(r"void dance_(\d+)_finished\(").unwrap();
    let mut out = BTreeMap::new();
    for cap in re.captures_iter(src) {
        let n: u32 = cap[1].parse().unwrap();
        let start = cap.get(0).unwrap().end();
        // The second occurrence is the definition (first is the prototype);
        // case_body-style scan works on whichever body follows this match.
        let body_src = &src[start..];
        // Only parse definitions (followed by a `{` before the next `;`).
        let brace = body_src.find('{');
        let semi = body_src.find(';').unwrap_or(usize::MAX);
        if brace.is_none() || brace.unwrap() > semi {
            continue;
        }
        let body = &body_src[brace.unwrap()..];
        let end = body.find("\n}").unwrap_or(body.len());
        let body = &body[..end];
        let mut dance = ParsedDance::default();
        for (label, slot) in [
            ("SINGLE_TAP", 0),
            ("SINGLE_HOLD", 1),
            ("DOUBLE_TAP", 2),
            ("DOUBLE_HOLD", 3),
        ] {
            if let Some(case) = case_body(body, label) {
                if let Some(code) = register_codes(case).first() {
                    match slot {
                        0 => dance.tap = Some(code.clone()),
                        1 => dance.hold = Some(code.clone()),
                        2 => dance.double_tap = Some(code.clone()),
                        _ => dance.tap_hold = Some(code.clone()),
                    }
                }
            }
        }
        out.insert(n, dance);
    }
    Ok(out)
}

/// Combo trigger arrays + `COMBO(comboN, action)` entries, in order.
fn parse_combos(src: &str) -> Result<Vec<ParsedCombo>, AppError> {
    let arr_re =
        regex::Regex::new(r"const uint16_t PROGMEM combo(\d+)\[\] = \{([^}]*)\}").unwrap();
    let mut triggers: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    for cap in arr_re.captures_iter(src) {
        let n: u32 = cap[1].parse().unwrap();
        let toks = split_top_level_commas(&cap[2])
            .into_iter()
            .map(|t| normalize_token(&t))
            .filter(|t| t != "COMBO_END")
            .collect();
        triggers.insert(n, toks);
    }
    let mut out = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = src[at..].find("COMBO(") {
        let open = at + rel + "COMBO".len();
        let close = matching_paren(src, open).ok_or_else(|| err("unbalanced COMBO("))?;
        let parts = split_top_level_commas(&src[open + 1..close]);
        if let [name, action] = parts.as_slice() {
            if let Some(n) = name.strip_prefix("combo").and_then(|s| s.parse::<u32>().ok()) {
                let trigger_tokens = triggers
                    .get(&n)
                    .cloned()
                    .ok_or_else(|| err(&format!("COMBO references unknown combo{n}")))?;
                out.push(ParsedCombo {
                    trigger_tokens,
                    action_token: normalize_token(action),
                });
            }
        }
        at = close;
    }
    Ok(out)
}

/// Parse an Oryx-generated keymap.c.
pub fn parse(src: &str) -> Result<ParsedKeymap, AppError> {
    let dual_func_defines = parse_dual_func_defines(src);
    let dual_funcs = parse_dual_funcs(src, &dual_func_defines)?;
    Ok(ParsedKeymap {
        layers: parse_layout_blocks(src)?,
        dual_func_defines,
        dual_funcs,
        st_macros: parse_st_macros(src)?,
        dances: parse_dances(src)?,
        combos: parse_combos(src)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFERENCE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../shared/fixtures/reference_keymap.c"
    ));

    fn parsed() -> ParsedKeymap {
        parse(REFERENCE).expect("reference keymap must parse")
    }

    #[test]
    fn layout_blocks_are_7x72() {
        let p = parsed();
        assert_eq!(p.layers.len(), 7);
        for (i, layer) in p.layers.iter().enumerate() {
            assert_eq!(layer.len(), 72, "layer {i} token count");
        }
        assert_eq!(p.layers[0][0], "KC_ESCAPE");
        assert_eq!(p.layers[0][35], "QK_LOCK");
        assert_eq!(p.layers[0][40], "LT(3, KC_SCLN)");
        assert_eq!(p.layers[0][41], "MT(MOD_RSFT, KC_ENTER)");
        assert_eq!(p.layers[0][52], "DUAL_FUNC_0");
        assert_eq!(p.layers[6][71], "KC_TRANSPARENT");
    }

    #[test]
    fn dual_funcs_parse_defines_and_behaviors() {
        let p = parsed();
        assert_eq!(p.dual_func_defines.len(), 6);
        assert_eq!(p.dual_func_defines[&0], "LT(10, KC_F20)");
        assert_eq!(
            p.dual_funcs[&0],
            DualFuncBehavior { tap: "KC_UP".into(), hold: "KC_UP".into() }
        );
        assert_eq!(
            p.dual_funcs[&4],
            DualFuncBehavior {
                tap: "KC_MEDIA_PREV_TRACK".into(),
                hold: "KC_MEDIA_REWIND".into()
            }
        );
    }

    #[test]
    fn st_macros_parse_taps_delays_and_mods() {
        let p = parsed();
        assert_eq!(p.st_macros.len(), 7);
        let push = &p.st_macros[&0];
        assert_eq!(
            push.iter().map(|s| s.code.as_str()).collect::<Vec<_>>(),
            ["KC_P", "KC_U", "KC_S", "KC_H"]
        );
        assert_eq!(push[0].delay, Some(100));
        assert_eq!(push[3].delay, None, "no delay after the final tap");
        let screenshot = &p.st_macros[&6];
        assert_eq!(screenshot.len(), 1);
        assert_eq!(screenshot[0].code, "KC_5");
        assert_eq!(screenshot[0].mods, ["MOD_LCTL", "MOD_LSFT"]);
    }

    #[test]
    fn dances_parse_behaviors() {
        let p = parsed();
        assert_eq!(p.dances.len(), 2);
        assert_eq!(
            p.dances[&0],
            ParsedDance {
                tap: Some("KC_BSPC".into()),
                hold: None,
                double_tap: Some("KC_CALCULATOR".into()),
                tap_hold: None,
            }
        );
        assert_eq!(
            p.dances[&1],
            ParsedDance {
                tap: Some("KC_LEFT_GUI".into()),
                hold: Some("KC_LEFT_GUI".into()),
                double_tap: Some("KC_LEFT_GUI".into()),
                tap_hold: Some("KC_LEFT_CTRL".into()),
            }
        );
    }

    #[test]
    fn combos_parse_triggers_and_actions() {
        let p = parsed();
        assert_eq!(p.combos.len(), 2);
        assert_eq!(p.combos[0].trigger_tokens, ["TG(2)", "TO(4)"]);
        assert_eq!(p.combos[0].action_token, "TG(5)");
        assert_eq!(p.combos[1].trigger_tokens, ["TG(1)", "TO(3)"]);
        assert_eq!(p.combos[1].action_token, "TG(5)");
    }
}
