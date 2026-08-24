//! Oryx GraphQL snapshot → [`LayoutFile`] seeder.
//!
//! Maps every Oryx key object to a [`KeyAction`] per the contract's mapping
//! table, applies the Oryx→LAYOUT permutation exactly once, then performs the
//! Key Lock transform (the single `KC_MEH` key becomes `qkLock`).

use serde::Deserialize;

use crate::error::AppError;
use crate::layout::schema::{
    Combo, KeyAction, Layer, LayerSwitchAction, LayoutFile, MacroStep, Meta,
    OsTarget, SeededFrom, Settings, TapSpec, MOONLANDER_KEY_COUNT, SCHEMA_VERSION,
};
use crate::oryx::permute;

/// The committed GraphQL snapshot; seeder unit tests run against this, offline.
#[cfg(test)]
pub const SNAPSHOT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/oryx_rddD7_QzpBEp.json"
));

/// Display name for the seeded layout. The Oryx GraphQL revision payload does
/// not carry the layout title, so v1 pins the only layout this app manages.
pub const LAYOUT_NAME: &str = "Arrows Together";

// ---------------------------------------------------------------------------
// Serde model of the Oryx GraphQL response (fields we consume; the rest of
// the key object — history, swapped, pristine, … — is ignored).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SnapshotRoot {
    data: SnapshotData,
}

#[derive(Debug, Deserialize)]
struct SnapshotData {
    layout: SnapshotLayout,
}

#[derive(Debug, Deserialize)]
struct SnapshotLayout {
    revision: OryxRevision,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OryxRevision {
    pub hash_id: String,
    pub qmk_version: String,
    pub layers: Vec<OryxLayer>,
    pub combos: Vec<OryxCombo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OryxLayer {
    #[allow(dead_code)]
    pub position: u32,
    pub title: String,
    pub color: Option<String>,
    pub keys: Vec<Option<OryxKey>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OryxKey {
    pub tap: Option<OryxAction>,
    pub hold: Option<OryxAction>,
    pub tap_hold: Option<OryxAction>,
    pub double_tap: Option<OryxAction>,
    pub glow_color: Option<String>,
    pub custom_label: Option<String>,
    pub tapping_term: Option<u16>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OryxAction {
    pub code: Option<String>,
    pub layer: Option<u8>,
    pub color: Option<String>,
    #[serde(rename = "macro")]
    pub macro_def: Option<OryxMacro>,
    pub modifiers: Option<OryxModifiers>,
}

#[derive(Debug, Default, Deserialize)]
pub struct OryxMacro {
    pub keys: Vec<OryxMacroKey>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OryxMacroKey {
    pub code: String,
    pub delay: Option<u16>,
    pub modifiers: Option<OryxModifiers>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OryxModifiers {
    pub left_ctrl: bool,
    pub left_shift: bool,
    pub left_alt: bool,
    pub left_gui: bool,
    pub right_ctrl: bool,
    pub right_shift: bool,
    pub right_alt: bool,
    pub right_gui: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OryxCombo {
    pub name: String,
    pub key_indices: Vec<usize>,
    pub layer_idx: u32,
    pub trigger: OryxKey,
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/// Oryx hold codes that are plain modifiers → `MOD_*` token for MT().
fn mod_token(code: &str) -> Option<&'static str> {
    Some(match code {
        "KC_LEFT_CTRL" => "MOD_LCTL",
        "KC_LEFT_SHIFT" => "MOD_LSFT",
        "KC_LEFT_ALT" => "MOD_LALT",
        "KC_LEFT_GUI" => "MOD_LGUI",
        "KC_RIGHT_CTRL" => "MOD_RCTL",
        "KC_RIGHT_SHIFT" => "MOD_RSFT",
        "KC_RIGHT_ALT" => "MOD_RALT",
        "KC_RIGHT_GUI" => "MOD_RGUI",
        _ => return None,
    })
}

/// Parameterless QMK specials that get their own `special` kind.
fn is_special(code: &str) -> bool {
    matches!(
        code,
        "QK_BOOT"
            | "CW_TOGG"
            | "AS_TOGG"
            | "AS_ON"
            | "AS_OFF"
            | "AU_TOGG"
            | "MU_TOGG"
            | "MU_NEXT"
            | "TOGGLE_LAYER_COLOR"
            | "WEBUSB_PAIR"
            | "QK_DYNAMIC_TAPPING_TERM_UP"
            | "QK_DYNAMIC_TAPPING_TERM_DOWN"
            | "QK_DYNAMIC_TAPPING_TERM_PRINT"
    )
}

fn layer_switch_action(code: &str) -> Option<LayerSwitchAction> {
    Some(match code {
        "MO" => LayerSwitchAction::MO,
        "TG" => LayerSwitchAction::TG,
        "TO" => LayerSwitchAction::TO,
        "TT" => LayerSwitchAction::TT,
        _ => return None,
    })
}

fn lowercase_hex(hex: &str) -> String {
    hex.to_ascii_lowercase()
}

/// Canonical MOD_* list from an Oryx modifiers-flags object, outermost first
/// (matches the SEND_STRING / LCTL() nesting order Oryx emits).
fn mods_from_flags(flags: &OryxModifiers) -> Vec<String> {
    let table: [(bool, &str); 8] = [
        (flags.left_ctrl, "MOD_LCTL"),
        (flags.left_shift, "MOD_LSFT"),
        (flags.left_alt, "MOD_LALT"),
        (flags.left_gui, "MOD_LGUI"),
        (flags.right_ctrl, "MOD_RCTL"),
        (flags.right_shift, "MOD_RSFT"),
        (flags.right_alt, "MOD_RALT"),
        (flags.right_gui, "MOD_RGUI"),
    ];
    table
        .iter()
        .filter(|(on, _)| *on)
        .map(|(_, tok)| tok.to_string())
        .collect()
}

/// Convert `#rrggbb` to Oryx's QMK-scale HSV bytes.
///
/// Reverse-engineered from the fixture pair and verified against all 504
/// reference ledmap entries plus the four HSV_x_y_z enum names:
///   h = floor(43 * hue_in_sixths)   (Oryx's 43-per-sector quirk, 43*6 = 258)
///   s = floor(255 * delta / max)
///   v = max
pub fn hex_to_hsv(hex: &str) -> Result<(u8, u8, u8), AppError> {
    let parse = |i: usize| {
        u8::from_str_radix(&hex[i..i + 2], 16)
            .map_err(|_| AppError::InvalidLayout(format!("bad hex color {hex:?}")))
    };
    if hex.len() != 7 || !hex.starts_with('#') {
        return Err(AppError::InvalidLayout(format!("bad hex color {hex:?}")));
    }
    let (r, g, b) = (parse(1)? as f64, parse(3)? as f64, parse(5)? as f64);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    if max == 0.0 || delta == 0.0 {
        return Ok((0, 0, max as u8));
    }
    let mut hue_sixths = if max == r {
        (g - b) / delta
    } else if max == g {
        2.0 + (b - r) / delta
    } else {
        4.0 + (r - g) / delta
    };
    if hue_sixths < 0.0 {
        hue_sixths += 6.0;
    }
    let h = ((43.0 * hue_sixths).floor() as u32) % 256;
    let s = (255.0 * delta / max).floor() as u32;
    Ok((h as u8, s as u8, max as u8))
}

/// Map one Oryx key object to a [`KeyAction`]. `where_` names the key in
/// error messages ("layer 3 oryx index 9").
pub fn map_key(key: &OryxKey, where_: &str) -> Result<KeyAction, AppError> {
    let glow = key.glow_color.as_deref().map(lowercase_hex);
    let tap_code = key.tap.as_ref().and_then(|a| a.code.as_deref());
    let hold_code = key.hold.as_ref().and_then(|a| a.code.as_deref());

    // Tap dance: any tapHold/doubleTap makes the key a dance. If Oryx leaves
    // doubleTap empty but tapHold is set, double-tapping repeats the tap
    // (Oryx emits register×2), which the schema records as doubleTap == tap.
    if key.tap_hold.is_some() || key.double_tap.is_some() {
        let double_tap = key
            .double_tap
            .as_ref()
            .and_then(|a| a.code.clone())
            .or_else(|| {
                if key.tap_hold.is_some() {
                    tap_code.map(str::to_string)
                } else {
                    None
                }
            });
        return Ok(KeyAction::TapDance {
            tap: tap_code.map(str::to_string),
            hold: hold_code.map(str::to_string),
            double_tap,
            tap_hold: key.tap_hold.as_ref().and_then(|a| a.code.clone()),
            tapping_term: key.tapping_term,
            glow,
        });
    }

    // Macro: Oryx parks macros on tap (tap.code is KC_TRANSPARENT), so this
    // must be checked before the transparent/basic rules.
    if let Some(mac) = key.tap.as_ref().and_then(|a| a.macro_def.as_ref()) {
        let steps = mac
            .keys
            .iter()
            .filter(|k| k.code != "KC_TRANSPARENT")
            .map(|k| {
                let mods = k
                    .modifiers
                    .as_ref()
                    .map(mods_from_flags)
                    .filter(|m| !m.is_empty());
                MacroStep { code: k.code.clone(), delay: k.delay, mods }
            })
            .collect();
        return Ok(KeyAction::Macro {
            label: key.custom_label.clone().unwrap_or_default(),
            steps,
            glow,
        });
    }

    if let Some(tap) = tap_code {
        // Layer switches (MO/TG/TO/TT live in tap.code with tap.layer).
        if let Some(action) = layer_switch_action(tap) {
            let layer = key.tap.as_ref().and_then(|a| a.layer).ok_or_else(|| {
                AppError::InvalidLayout(format!("{where_}: {tap} without layer"))
            })?;
            return Ok(KeyAction::LayerSwitch { action, layer, glow });
        }

        // Oryx "RGB" key: a fixed-HSV rgblight shortcut; the color rides in
        // tap.color.
        if tap == "RGB" {
            let color = key
                .tap
                .as_ref()
                .and_then(|a| a.color.as_deref())
                .ok_or_else(|| {
                    AppError::InvalidLayout(format!("{where_}: RGB key without color"))
                })?;
            let (h, s, v) = hex_to_hsv(color)?;
            return Ok(KeyAction::RgbHsv { h, s, v, glow });
        }

        if let Some(hold) = hold_code {
            // tap + hold-MO(n) → LT()
            if hold == "MO" {
                let layer =
                    key.hold.as_ref().and_then(|a| a.layer).ok_or_else(|| {
                        AppError::InvalidLayout(format!("{where_}: hold MO without layer"))
                    })?;
                return Ok(KeyAction::LayerTap { layer, tap: tap.to_string(), glow });
            }
            // tap + hold-modifier → MT()
            if let Some(m) = mod_token(hold) {
                return Ok(KeyAction::ModTap {
                    mods: vec![m.to_string()],
                    tap: tap.to_string(),
                    glow,
                });
            }
            // Any other tap/hold pair → Oryx DUAL_FUNC.
            return Ok(KeyAction::DualFunc {
                tap: TapSpec { code: tap.to_string(), mods: None },
                hold: TapSpec { code: hold.to_string(), mods: None },
                glow,
            });
        }

        // Tap-only.
        if tap == "KC_TRANSPARENT" {
            return Ok(KeyAction::Transparent { glow });
        }
        if tap == "KC_NO" {
            return Ok(KeyAction::None { glow });
        }
        if is_special(tap) {
            return Ok(KeyAction::Special { code: tap.to_string(), glow });
        }
        if tap.starts_with("RGB_") {
            return Ok(KeyAction::Rgb { code: tap.to_string(), glow });
        }
        let mods = key
            .tap
            .as_ref()
            .and_then(|a| a.modifiers.as_ref())
            .map(mods_from_flags)
            .filter(|m| !m.is_empty());
        return Ok(KeyAction::Basic { code: tap.to_string(), mods, glow });
    }

    if let Some(hold) = hold_code {
        // Hold-only keys act on press like a plain key.
        let code = match hold {
            "MEH_T" => "KC_MEH",
            "ALL_T" => "KC_HYPR",
            other => {
                if let Some(action) = layer_switch_action(other) {
                    let layer =
                        key.hold.as_ref().and_then(|a| a.layer).ok_or_else(|| {
                            AppError::InvalidLayout(format!(
                                "{where_}: hold {other} without layer"
                            ))
                        })?;
                    return Ok(KeyAction::LayerSwitch { action, layer, glow });
                }
                other
            }
        };
        return Ok(KeyAction::Basic { code: code.to_string(), mods: None, glow });
    }

    // Nothing assigned (possibly glow-only) → transparent.
    Ok(KeyAction::Transparent { glow })
}

/// The Key Lock transform: exactly one key mapping to `KC_MEH` becomes
/// `qkLock`. Any other count is a hard error — the layout has changed in a
/// way the app does not understand.
fn apply_key_lock_transform(layers: &mut [Layer]) -> Result<(), AppError> {
    let mut positions: Vec<(usize, usize)> = Vec::new();
    for (l, layer) in layers.iter().enumerate() {
        for (k, key) in layer.keys.iter().enumerate() {
            if matches!(key, KeyAction::Basic { code, .. } if code == "KC_MEH") {
                positions.push((l, k));
            }
        }
    }
    if positions.len() != 1 {
        return Err(AppError::InvalidLayout(format!(
            "Key Lock transform expected exactly 1 KC_MEH key, found {} at {:?}",
            positions.len(),
            positions
        )));
    }
    let (l, k) = positions[0];
    let glow = layers[l].keys[k].glow().cloned();
    layers[l].keys[k] = KeyAction::QkLock { glow };
    Ok(())
}

/// Build the full [`LayoutFile`] from a raw GraphQL response body.
pub fn layout_from_snapshot(
    snapshot_json: &str,
    layout_id: &str,
    seeded_at: &str,
) -> Result<LayoutFile, AppError> {
    let root: SnapshotRoot = serde_json::from_str(snapshot_json)
        .map_err(|e| AppError::OryxUnreachable(format!("unexpected Oryx response: {e}")))?;
    let rev = root.data.layout.revision;

    let mut layers = Vec::with_capacity(rev.layers.len());
    for (li, oryx_layer) in rev.layers.iter().enumerate() {
        if oryx_layer.keys.len() != MOONLANDER_KEY_COUNT {
            return Err(AppError::PermutationMismatch(format!(
                "Oryx layer {li} has {} keys, expected {MOONLANDER_KEY_COUNT}",
                oryx_layer.keys.len()
            )));
        }
        let default_key = OryxKey::default();
        let mut oryx_actions = Vec::with_capacity(MOONLANDER_KEY_COUNT);
        for (ki, key) in oryx_layer.keys.iter().enumerate() {
            let key = key.as_ref().unwrap_or(&default_key);
            oryx_actions.push(map_key(key, &format!("layer {li} oryx index {ki}"))?);
        }
        layers.push(Layer {
            title: oryx_layer.title.clone(),
            color: oryx_layer
                .color
                .as_deref()
                .map(lowercase_hex)
                .unwrap_or_else(|| "#000000".to_string()),
            keys: permute::permute(&oryx_actions),
        });
    }

    apply_key_lock_transform(&mut layers)?;

    let mut combos = Vec::with_capacity(rev.combos.len());
    for combo in &rev.combos {
        let mut keys = Vec::with_capacity(combo.key_indices.len());
        for &oryx_idx in &combo.key_indices {
            let arg = permute::layout_index_for_oryx(oryx_idx).ok_or_else(|| {
                AppError::PermutationMismatch(format!(
                    "combo {:?} references oryx index {oryx_idx} (out of range)",
                    combo.name
                ))
            })?;
            keys.push(arg as u32);
        }
        combos.push(Combo {
            name: combo.name.clone(),
            keys,
            layer: combo.layer_idx,
            action: map_key(&combo.trigger, &format!("combo {:?} trigger", combo.name))?,
        });
    }

    // Feature flags: derived from what the layout actually uses where
    // possible; the rest mirrors Oryx's fixed defaults for this board.
    let uses = |pred: &dyn Fn(&KeyAction) -> bool| {
        layers.iter().flat_map(|l| &l.keys).any(pred)
    };
    let settings = Settings {
        auto_shift: uses(&|k| {
            matches!(k, KeyAction::Special { code, .. } if code.starts_with("AS_"))
        }),
        caps_word: uses(&|k| {
            matches!(k, KeyAction::Special { code, .. } if code == "CW_TOGG")
        }),
        tap_dance: uses(&|k| matches!(k, KeyAction::TapDance { .. })),
        combos: !combos.is_empty(),
        key_lock: true,
        oryx: true,
        rgb_matrix_custom: true,
        layer_state_8bit: true,
        serial_number: format!("{layout_id}/{}", rev.hash_id),
        rgb_startup_speed: 60,
        // Oryx layouts carry no OS intent; a seeded layout starts on the
        // app defaults and the user opts in from the OS panel.
        os_detection: false,
        os_default: OsTarget::default(),
    };

    let layout = LayoutFile {
        schema_version: SCHEMA_VERSION,
        meta: Meta {
            name: LAYOUT_NAME.to_string(),
            geometry: "moonlander".to_string(),
            seeded_from: SeededFrom {
                layout_id: layout_id.to_string(),
                revision_hash: rev.hash_id.clone(),
                qmk_version: rev.qmk_version.clone(),
                seeded_at: seeded_at.to_string(),
            },
        },
        layers,
        combos,
        settings,
    };
    layout.validate().map_err(AppError::InvalidLayout)?;
    Ok(layout)
}

// ---------------------------------------------------------------------------
// Seed-time cross-check: the seeded layout must render to the same semantic
// tokens as the keymap.c Oryx generated for the same revision, at every
// position (modulo KC_MEH→QK_LOCK). Both sides canonicalize into one space:
// construct tokens (DUAL_FUNC_n / TD(DANCE_n) / ST_MACRO_n) resolve to their
// behavior, so numbering differences cannot false-positive.
// ---------------------------------------------------------------------------

use crate::oryx::parse_keymap_c::{self, ParsedKeymap};

/// Canonical semantic token for a seeded action. `KC_MEH` canonicalizes to
/// `QK_LOCK` (the transform the app always applies).
pub(crate) fn canon_action(a: &KeyAction) -> String {
    fn macro_canon(steps: &[crate::layout::schema::MacroStep]) -> String {
        let last = steps.len().saturating_sub(1);
        let parts: Vec<String> = steps
            .iter()
            .enumerate()
            .map(|(i, s)| {
                // The final step's delay is never rendered (SEND_STRING has
                // no trailing SS_DELAY), so it is not comparable.
                let delay = if i == last { None } else { s.delay };
                format!(
                    "{}@{}+{}",
                    s.code,
                    delay.map_or(String::new(), |d| d.to_string()),
                    s.mods.as_deref().unwrap_or_default().join("|")
                )
            })
            .collect();
        format!("MACRO({})", parts.join(","))
    }
    match a {
        KeyAction::None { .. } => "KC_NO".into(),
        KeyAction::Transparent { .. } => "KC_TRANSPARENT".into(),
        KeyAction::QkLock { .. } => "QK_LOCK".into(),
        KeyAction::Basic { code, mods: None, .. } if code == "KC_MEH" => "QK_LOCK".into(),
        KeyAction::Basic { code, mods: None, .. } => code.clone(),
        KeyAction::Basic { code, mods: Some(m), .. } => {
            format!("MODS({},{})", m.join("|"), code)
        }
        KeyAction::LayerSwitch { action, layer, .. } => format!("{action:?}({layer})"),
        KeyAction::ModTap { mods, tap, .. } => format!("MT({}, {tap})", mods.join(" | ")),
        KeyAction::LayerTap { layer, tap, .. } => format!("LT({layer}, {tap})"),
        KeyAction::DualFunc { tap, hold, .. } => format!("DF({},{})", tap.code, hold.code),
        KeyAction::Special { code, .. } | KeyAction::Rgb { code, .. } => code.clone(),
        KeyAction::TapDance { tap, hold, double_tap, tap_hold, .. } => format!(
            "TD({},{},{},{})",
            tap.as_deref().unwrap_or(""),
            hold.as_deref().unwrap_or(""),
            double_tap.as_deref().unwrap_or(""),
            tap_hold.as_deref().unwrap_or("")
        ),
        KeyAction::Macro { steps, .. } => macro_canon(steps),
        KeyAction::RgbHsv { h, s, v, .. } => format!("HSV_{h}_{s}_{v}"),
        // Oryx has no concept of either of these, so the seeder never builds
        // one and the cross-check can never meet one on the seeded side.
        // They still need a canonical form for the exhaustiveness check.
        KeyAction::OsMacro { mac, windows, .. } => {
            format!("OSMACRO({},{})", macro_canon(mac), macro_canon(windows))
        }
        KeyAction::OsMode { action, .. } => format!("OSMODE({action:?})"),
    }
}

/// Canonical semantic token for a keymap.c LAYOUT token, resolving
/// DUAL_FUNC_n / TD(DANCE_n) / ST_MACRO_n through the parsed keymap and
/// applying the KC_MEH→QK_LOCK equivalence.
pub(crate) fn canon_ref_token(tok: &str, p: &ParsedKeymap) -> String {
    if tok == "KC_MEH" {
        return "QK_LOCK".into();
    }
    if let Some(n) = tok.strip_prefix("DUAL_FUNC_") {
        if let Some(b) = n.parse::<u32>().ok().and_then(|n| p.dual_funcs.get(&n)) {
            return format!("DF({},{})", b.tap, b.hold);
        }
    }
    if let Some(inner) = tok.strip_prefix("TD(DANCE_") {
        if let Some(d) = inner
            .trim_end_matches(')')
            .parse::<u32>()
            .ok()
            .and_then(|n| p.dances.get(&n))
        {
            return format!(
                "TD({},{},{},{})",
                d.tap.as_deref().unwrap_or(""),
                d.hold.as_deref().unwrap_or(""),
                d.double_tap.as_deref().unwrap_or(""),
                d.tap_hold.as_deref().unwrap_or("")
            );
        }
    }
    if let Some(n) = tok.strip_prefix("ST_MACRO_") {
        if let Some(steps) = n.parse::<u32>().ok().and_then(|n| p.st_macros.get(&n)) {
            let parts: Vec<String> = steps
                .iter()
                .map(|s| {
                    format!(
                        "{}@{}+{}",
                        s.code,
                        s.delay.map_or(String::new(), |d| d.to_string()),
                        s.mods.join("|")
                    )
                })
                .collect();
            return format!("MACRO({})", parts.join(","));
        }
    }
    // Modifier wrappers: LCTL(LSFT(KC_C)) → MODS(MOD_LCTL|MOD_LSFT,KC_C).
    const WRAPPERS: [(&str, &str); 8] = [
        ("LCTL(", "MOD_LCTL"),
        ("LSFT(", "MOD_LSFT"),
        ("LALT(", "MOD_LALT"),
        ("LGUI(", "MOD_LGUI"),
        ("RCTL(", "MOD_RCTL"),
        ("RSFT(", "MOD_RSFT"),
        ("RALT(", "MOD_RALT"),
        ("RGUI(", "MOD_RGUI"),
    ];
    let mut mods = Vec::new();
    let mut inner = tok;
    'unwrap: loop {
        for (prefix, m) in WRAPPERS {
            if let Some(rest) = inner.strip_prefix(prefix) {
                if let Some(rest) = rest.strip_suffix(')') {
                    mods.push(m);
                    inner = rest;
                    continue 'unwrap;
                }
            }
        }
        break;
    }
    if !mods.is_empty() {
        return format!("MODS({},{})", mods.join("|"), inner);
    }
    tok.to_string()
}

/// Verify `layout` against the keymap.c Oryx generated for the same revision.
/// Any positional disagreement is a hard [`AppError::PermutationMismatch`]
/// carrying the differing positions.
pub fn cross_check(layout: &LayoutFile, oryx_keymap_c: &str) -> Result<(), AppError> {
    let parsed = parse_keymap_c::parse(oryx_keymap_c)?;
    if parsed.layers.len() != layout.layers.len() {
        return Err(AppError::PermutationMismatch(format!(
            "seeded {} layers but the Oryx source has {}",
            layout.layers.len(),
            parsed.layers.len()
        )));
    }
    let mut diffs = Vec::new();
    for (li, (layer, ref_tokens)) in
        layout.layers.iter().zip(&parsed.layers).enumerate()
    {
        if ref_tokens.len() != layer.keys.len() {
            return Err(AppError::PermutationMismatch(format!(
                "Oryx source layer {li} has {} tokens, expected {}",
                ref_tokens.len(),
                layer.keys.len()
            )));
        }
        for (arg, (key, tok)) in layer.keys.iter().zip(ref_tokens).enumerate() {
            let ours = canon_action(key);
            let theirs = canon_ref_token(tok, &parsed);
            if ours != theirs {
                diffs.push(format!(
                    "layer {li} arg {arg}: seeded {ours} vs source {theirs}"
                ));
            }
        }
    }
    if layout.combos.len() != parsed.combos.len() {
        diffs.push(format!(
            "seeded {} combos but the Oryx source has {}",
            layout.combos.len(),
            parsed.combos.len()
        ));
    }
    if diffs.is_empty() {
        return Ok(());
    }
    let shown = diffs.iter().take(10).cloned().collect::<Vec<_>>().join("; ");
    let extra = diffs.len().saturating_sub(10);
    Err(AppError::PermutationMismatch(if extra > 0 {
        format!("{} positions differ: {shown} (+{extra} more)", diffs.len())
    } else {
        format!("{} positions differ: {shown}", diffs.len())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oryx::permute::{layout_index_for_oryx, ORYX_TO_LAYOUT};

    const REFERENCE_KEYMAP_C: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../shared/fixtures/reference_keymap.c"
    ));

    /// seededAt used for the committed fixture (regen keeps it stable).
    const FIXTURE_SEEDED_AT: &str = "2026-07-17T22:00:00Z";

    fn seeded() -> LayoutFile {
        layout_from_snapshot(SNAPSHOT, "rddD7", FIXTURE_SEEDED_AT).unwrap()
    }

    /// Key at Oryx coordinates (layer, oryx index), post-permutation.
    fn at(layout: &LayoutFile, layer: usize, oryx_idx: usize) -> &KeyAction {
        &layout.layers[layer].keys[layout_index_for_oryx(oryx_idx).unwrap()]
    }

    #[test]
    fn seeds_seven_layers_of_72_keys() {
        let layout = seeded();
        assert_eq!(layout.layers.len(), 7);
        for (i, layer) in layout.layers.iter().enumerate() {
            assert_eq!(layer.keys.len(), 72, "layer {i}");
        }
        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        assert_eq!(layout.meta.name, LAYOUT_NAME);
        assert_eq!(layout.meta.seeded_from.layout_id, "rddD7");
        assert_eq!(layout.meta.seeded_from.revision_hash, "QzpBEp");
    }

    #[test]
    fn maps_every_key_action_kind() {
        let layout = seeded();
        // basic (tap-only)
        assert_eq!(
            at(&layout, 0, 0),
            &KeyAction::Basic { code: "KC_ESCAPE".into(), mods: None, glow: None }
        );
        // basic (hold-only modifier)
        assert_eq!(
            at(&layout, 0, 21),
            &KeyAction::Basic { code: "KC_LEFT_SHIFT".into(), mods: None, glow: None }
        );
        // layerSwitch with glow (Oryx glowColor lowercased)
        assert_eq!(
            at(&layout, 0, 6),
            &KeyAction::LayerSwitch {
                action: LayerSwitchAction::TO,
                layer: 3,
                glow: Some("#ed1616".into())
            }
        );
        // modTap
        assert_eq!(
            at(&layout, 0, 56),
            &KeyAction::ModTap {
                mods: vec!["MOD_RSFT".into()],
                tap: "KC_ENTER".into(),
                glow: None
            }
        );
        // layerTap
        assert_eq!(
            at(&layout, 0, 55),
            &KeyAction::LayerTap { layer: 3, tap: "KC_SCLN".into(), glow: None }
        );
        // dualFunc (tap/hold pair that is neither mod nor MO)
        assert_eq!(
            at(&layout, 0, 61),
            &KeyAction::DualFunc {
                tap: TapSpec { code: "KC_UP".into(), mods: None },
                hold: TapSpec { code: "KC_UP".into(), mods: None },
                glow: Some("#006b62".into())
            }
        );
        // tapDance: doubleTap only
        assert_eq!(
            at(&layout, 0, 20),
            &KeyAction::TapDance {
                tap: Some("KC_BSPC".into()),
                hold: None,
                double_tap: Some("KC_CALCULATOR".into()),
                tap_hold: None,
                tapping_term: None,
                glow: None
            }
        );
        // tapDance: tapHold set, empty doubleTap falls back to the tap code
        assert_eq!(
            at(&layout, 0, 35),
            &KeyAction::TapDance {
                tap: Some("KC_LEFT_GUI".into()),
                hold: Some("KC_LEFT_GUI".into()),
                double_tap: Some("KC_LEFT_GUI".into()),
                tap_hold: Some("KC_LEFT_CTRL".into()),
                tapping_term: None,
                glow: None
            }
        );
        // macro: trailing KC_TRANSPARENT padding dropped, delays kept
        match at(&layout, 3, 9) {
            KeyAction::Macro { label, steps, .. } => {
                assert_eq!(label, "push");
                assert_eq!(
                    steps.iter().map(|s| s.code.as_str()).collect::<Vec<_>>(),
                    ["KC_P", "KC_U", "KC_S", "KC_H"]
                );
                assert!(steps.iter().all(|s| s.delay == Some(100)));
                assert!(steps.iter().all(|s| s.mods.is_none()));
            }
            other => panic!("expected macro, got {other:?}"),
        }
        // macro with modifiers (Screenshot: Ctrl+Shift+5)
        match at(&layout, 4, 37) {
            KeyAction::Macro { label, steps, .. } => {
                assert_eq!(label, "Screenshot");
                assert_eq!(steps.len(), 1);
                assert_eq!(steps[0].code, "KC_5");
                assert_eq!(
                    steps[0].mods.as_deref(),
                    Some(&["MOD_LCTL".to_string(), "MOD_LSFT".to_string()][..])
                );
            }
            other => panic!("expected macro, got {other:?}"),
        }
        // rgb
        assert_eq!(
            at(&layout, 4, 26),
            &KeyAction::Rgb { code: "RGB_TOG".into(), glow: None }
        );
        // rgbHsv (Oryx RGB key with tap.color)
        assert_eq!(
            at(&layout, 1, 29),
            &KeyAction::RgbHsv { h: 0, s: 245, v: 245, glow: None }
        );
        // special
        assert_eq!(
            at(&layout, 2, 42),
            &KeyAction::Special { code: "QK_BOOT".into(), glow: None }
        );
        assert_eq!(
            at(&layout, 4, 19),
            &KeyAction::Special { code: "TOGGLE_LAYER_COLOR".into(), glow: None }
        );
        // transparent (unassigned, glow-only key)
        assert_eq!(
            at(&layout, 1, 13),
            &KeyAction::Transparent { glow: Some("#34006b".into()) }
        );
    }

    #[test]
    fn key_lock_transform_replaces_the_single_meh_key() {
        let layout = seeded();
        let mut qk_locks = Vec::new();
        for (li, layer) in layout.layers.iter().enumerate() {
            for (ki, key) in layer.keys.iter().enumerate() {
                match key {
                    KeyAction::QkLock { .. } => qk_locks.push((li, ki)),
                    KeyAction::Basic { code, .. } => {
                        assert_ne!(code, "KC_MEH", "no KC_MEH may survive the transform")
                    }
                    _ => {}
                }
            }
        }
        // Oryx 50 (hold-only MEH_T on layer 0) lands at LAYOUT arg 35.
        assert_eq!(qk_locks, vec![(0, layout_index_for_oryx(50).unwrap())]);
        assert_eq!(qk_locks, vec![(0, 35)]);
    }

    #[test]
    fn key_lock_transform_rejects_zero_or_multiple_meh() {
        let mut v: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
        // Zero MEH: repoint the hold-only MEH_T key (oryx 50) at plain Alt.
        v["data"]["layout"]["revision"]["layers"][0]["keys"][50]["hold"]["code"] =
            "KC_LEFT_ALT".into();
        let zero = serde_json::to_string(&v).unwrap();
        assert!(layout_from_snapshot(&zero, "rddD7", FIXTURE_SEEDED_AT).is_err());

        // Two MEH: restore, then clone MEH onto a second key.
        let keys = v["data"]["layout"]["revision"]["layers"][0]["keys"]
            .as_array_mut()
            .unwrap();
        keys[50]["hold"]["code"] = "MEH_T".into();
        keys[0] = keys[50].clone();
        let two = serde_json::to_string(&v).unwrap();
        assert!(layout_from_snapshot(&two, "rddD7", FIXTURE_SEEDED_AT).is_err());
    }

    #[test]
    fn combos_translate_key_indices_through_the_permutation() {
        let layout = seeded();
        assert_eq!(layout.combos.len(), 2);
        let c0 = &layout.combos[0];
        assert_eq!(c0.name, "Mirror 1");
        assert_eq!(c0.keys, vec![21, 7]); // oryx [43, 36]
        assert_eq!(c0.layer, 0);
        assert_eq!(
            c0.action,
            KeyAction::LayerSwitch { action: LayerSwitchAction::TG, layer: 5, glow: None }
        );
        let c1 = &layout.combos[1];
        assert_eq!(c1.name, "Mirror 2");
        assert_eq!(c1.keys, vec![20, 6]); // oryx [13, 6]
        assert_eq!(c1.layer, 0);
    }

    #[test]
    fn settings_derived_from_layout_content() {
        let s = seeded().settings;
        assert!(s.auto_shift, "AS_* keys present on layer 4");
        assert!(s.caps_word, "CW_TOGG present on layer 5");
        assert!(s.tap_dance);
        assert!(s.combos);
        assert!(s.key_lock);
        assert_eq!(s.serial_number, "rddD7/QzpBEp");
    }

    #[test]
    fn hex_to_hsv_matches_oryx_ledmap_bases() {
        // All 7 (Oryx layer color → reference ledmap base HSV) pairs, plus
        // the 4 RGB-key colors behind the reference HSV_h_s_v enum names.
        let cases = [
            ("#34006b", (192, 255, 107)),
            ("#1deb0e", (83, 239, 235)),
            ("#1301ed", (175, 253, 237)),
            ("#ed1616", (0, 231, 237)),
            ("#0effec", (125, 241, 255)),
            ("#c00eb9", (216, 236, 192)),
            ("#5f3dc6", (182, 176, 198)),
            ("#f50909", (0, 245, 245)),
            ("#14e403", (82, 251, 228)),
            ("#0029cb", (163, 255, 203)),
            ("#2d0054", (195, 255, 84)),
        ];
        for (hex, want) in cases {
            assert_eq!(hex_to_hsv(hex).unwrap(), want, "{hex}");
        }
        // Grey/black edges:
        assert_eq!(hex_to_hsv("#000000").unwrap(), (0, 0, 0));
        assert_eq!(hex_to_hsv("#ffffff").unwrap(), (0, 0, 255));
        assert!(hex_to_hsv("34006b").is_err());
        assert!(hex_to_hsv("#34006g").is_err());
    }

    // -----------------------------------------------------------------------
    // Permutation re-derivation from the fixture pair (the A1 centerpiece):
    // canonicalize both the un-permuted seeded actions and the parsed
    // reference tokens into one semantic space (the cross-check's canon
    // functions), then the unique column-matching between them must
    // reproduce ORYX_TO_LAYOUT exactly.
    // -----------------------------------------------------------------------

    #[test]
    fn permutation_rederived_from_fixture_pair_matches_table() {
        let parsed = parse_keymap_c::parse(REFERENCE_KEYMAP_C).unwrap();
        assert_eq!(parsed.layers.len(), 7);

        // Un-permuted seeded actions, canonicalized: canon_oryx[layer][oryx].
        let root: SnapshotRoot = serde_json::from_str(SNAPSHOT).unwrap();
        let rev = root.data.layout.revision;
        let default_key = OryxKey::default();
        let canon_oryx: Vec<Vec<String>> = rev
            .layers
            .iter()
            .map(|l| {
                l.keys
                    .iter()
                    .map(|k| {
                        let k = k.as_ref().unwrap_or(&default_key);
                        canon_action(&map_key(k, "test").unwrap())
                    })
                    .collect()
            })
            .collect();
        let canon_ref: Vec<Vec<String>> = parsed
            .layers
            .iter()
            .map(|l| l.iter().map(|t| canon_ref_token(t, &parsed)).collect())
            .collect();

        // For each LAYOUT arg, the oryx indices whose token column matches
        // across all 7 layers. The match must be unique and equal the table.
        for arg in 0..72 {
            let candidates: Vec<usize> = (0..72)
                .filter(|&oryx| {
                    (0..7).all(|l| canon_oryx[l][oryx] == canon_ref[l][arg])
                })
                .collect();
            assert_eq!(
                candidates,
                vec![ORYX_TO_LAYOUT[arg]],
                "arg {arg}: expected unique match {} (ref column: {:?})",
                ORYX_TO_LAYOUT[arg],
                (0..7).map(|l| canon_ref[l][arg].clone()).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn cross_check_accepts_the_reference_keymap() {
        cross_check(&seeded(), REFERENCE_KEYMAP_C).expect("fixture pair must agree");
    }

    #[test]
    fn cross_check_reports_positional_diffs() {
        let mut layout = seeded();
        layout.layers[0].keys[0] =
            KeyAction::Basic { code: "KC_F24".into(), mods: None, glow: None };
        let err = cross_check(&layout, REFERENCE_KEYMAP_C).unwrap_err();
        assert_eq!(err.code(), "PermutationMismatch");
        let msg = err.to_string();
        assert!(msg.contains("layer 0 arg 0"), "{msg}");
        assert!(msg.contains("KC_F24"), "{msg}");
        assert!(msg.contains("KC_ESCAPE"), "{msg}");
    }

    /// `shared/fixtures/seeded_layout.json` is the full seeder output over the
    /// committed snapshot. Run `REGEN_FIXTURE=1 cargo test seeded_layout` to
    /// regenerate after seeder changes (announce via cos-coord note — Worker C
    /// mocks sync to it).
    #[test]
    fn seeded_layout_fixture_up_to_date() {
        let layout = seeded();
        let generated = serde_json::to_string_pretty(&layout).unwrap() + "\n";
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../shared/fixtures/seeded_layout.json"
        );
        if std::env::var("REGEN_FIXTURE").is_ok() {
            std::fs::write(path, &generated).unwrap();
        }
        let committed = std::fs::read_to_string(path).unwrap();
        assert_eq!(
            committed.replace("\r\n", "\n"),
            generated,
            "seeded_layout.json is stale — run REGEN_FIXTURE=1 cargo test seeded_layout"
        );
    }
}
