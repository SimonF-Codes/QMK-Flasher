//! Oryx GraphQL snapshot → [`LayoutFile`] seeder.
//!
//! Maps every Oryx key object to a [`KeyAction`] per the contract's mapping
//! table, applies the Oryx→LAYOUT permutation exactly once, then performs the
//! Key Lock transform (the single `KC_MEH` key becomes `qkLock`).

use serde::Deserialize;

use crate::error::AppError;
use crate::layout::schema::{
    Combo, KeyAction, Layer, LayerSwitchAction, LayoutFile, MacroStep, Meta,
    SeededFrom, Settings, TapSpec, MOONLANDER_KEY_COUNT, SCHEMA_VERSION,
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
