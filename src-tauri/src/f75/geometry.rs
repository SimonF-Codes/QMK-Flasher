//! F75 physical geometry, produced by `scripts/extract-f75-geometry.mjs` from
//! the OEM configurator's `KB.ini`.
//!
//! Unlike [`crate::geometry`], which `include_str!`s the Moonlander's geometry
//! into the binary, this one is **loaded at runtime** from
//! `%APPDATA%\qmk-flasher\f75_geometry.json`. That is not an inconsistency:
//! the Moonlander's geometry is derived from QMK's own `keyboard.json`, which
//! is GPL like this repo, whereas the F75's comes out of AULA's proprietary
//! Windows installer. Whether that derived data may ship here has not been
//! decided, so each user generates it from their own copy and the app treats
//! its absence as a normal state rather than an error.

use std::path::PathBuf;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Filename under the app data dir. Written by the extractor's default `--out`.
pub const GEOMETRY_FILENAME: &str = "f75_geometry.json";

/// How the extractor turned the OEM file's pixel rectangles into key units.
/// Carried through so a geometry file can be audited against its source
/// without re-reading the script that produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Scale {
    pub pitch_px: f64,
    pub v_pitch_px: f64,
    pub h_inset_px: f64,
    pub v_inset_px: f64,
}

/// An output as KB.ini packs it: `0xCC00UUUU`.
///
/// `category` is **AULA's own numbering** (0x07 keyboard, 0x02 consumer, 0x08
/// vendor, 0x00 unclassified). It is NOT the keybind blob's page byte and NOT
/// a HID usage-page number — the blob uses 0x00 for HID page 0x07 and 0x02 for
/// HID page 0x0C, so the two agree on one value and disagree on another. The
/// raw `packed` string stays the authority; no page byte is synthesised from
/// it here, because a half-correct page byte is exactly what turns into a
/// wrong write later.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PackedOutput {
    /// e.g. `"0x07000004"` — the value exactly as KB.ini carries it.
    pub packed: String,
    pub category: u8,
    /// Meaningful as a HID usage only for categories 0x07 and 0x02.
    pub usage: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct F75Key {
    /// Matrix index. This is also the keybind-blob slot index.
    pub slot: u16,
    /// Key name, taken from the comment above its line in KB.ini.
    pub label: String,
    /// False for the encoder ("Wheel"), which is a real slot the OEM app draws
    /// outside the key grid. Its position fields are absent, not zeroed.
    pub positioned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// Windows virtual-key code of the factory base-layer binding.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vk: Option<u32>,
    /// Factory binding given directly as a packed output rather than a VK.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hid: Option<PackedOutput>,
    /// Factory FN1-layer binding, where the OEM file defines one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fn1: Option<PackedOutput>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct F75Geometry {
    /// Which KB.ini variant this came from, e.g. "AULA F75 (KB.ini)".
    pub source: String,
    pub vid: Option<String>,
    pub pid: Option<String>,
    pub matrix_len: Option<u32>,
    pub scale: Scale,
    /// Firmware-pinned slots (F1–F12) that no tool, including AULA's own, can
    /// remap. Carried so the UI can show them as locked instead of offering an
    /// edit the board will silently ignore.
    pub locked_slots: Vec<u16>,
    pub key_count: u32,
    pub keys: Vec<F75Key>,
}

/// Whether the geometry file is present, and the geometry if so.
///
/// Absence is modelled as a value rather than an error: not having run the
/// extractor is the expected state on a fresh install, and the UI shows
/// instructions for it. A file that exists but does not parse IS an error —
/// that is a real problem the user needs told about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum F75GeometryState {
    /// No geometry file yet. `path` is where the extractor should write it.
    Missing { path: String },
    Loaded { geometry: Box<F75Geometry> },
}

pub fn geometry_path() -> Result<PathBuf, AppError> {
    Ok(crate::layout::store::data_dir()?.join(GEOMETRY_FILENAME))
}

pub fn load() -> Result<F75GeometryState, AppError> {
    let path = geometry_path()?;
    if !path.exists() {
        return Ok(F75GeometryState::Missing {
            path: path.to_string_lossy().into_owned(),
        });
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::InvalidLayout(format!("reading {}: {e}", path.display())))?;
    let geometry = parse(&text)?;
    Ok(F75GeometryState::Loaded {
        geometry: Box::new(geometry),
    })
}

/// Parse and validate. Split from [`load`] so the checks are testable without
/// touching the filesystem.
pub fn parse(text: &str) -> Result<F75Geometry, AppError> {
    let geo: F75Geometry = serde_json::from_str(text)
        .map_err(|e| AppError::InvalidLayout(format!("f75 geometry: {e}")))?;
    validate(&geo)?;
    Ok(geo)
}

/// Re-checks the invariants the extractor enforces, on the way in.
///
/// The file is user-generated and lives outside the repo, so it can be stale,
/// hand-edited, or produced by an older version of the script. Trusting it
/// blindly would let a bad slot index reach a keybind blob later, where slot
/// 127 would overwrite the frame's trailer.
pub fn validate(geo: &F75Geometry) -> Result<(), AppError> {
    if geo.keys.len() != geo.key_count as usize {
        return Err(AppError::InvalidLayout(format!(
            "f75 geometry keyCount {} != keys.len() {}",
            geo.key_count,
            geo.keys.len()
        )));
    }
    if geo.keys.is_empty() {
        return Err(AppError::InvalidLayout("f75 geometry has no keys".into()));
    }

    let mut seen = std::collections::HashSet::new();
    for k in &geo.keys {
        if !seen.insert(k.slot) {
            return Err(AppError::InvalidLayout(format!(
                "f75 geometry: duplicate slot {}",
                k.slot
            )));
        }
        // Slot 127's 4-byte entry would run into the blob's `5A A5` trailer,
        // so the firmware cannot address it and neither may we.
        if k.slot > MAX_SLOT {
            return Err(AppError::InvalidLayout(format!(
                "f75 geometry: slot {} is past the addressable maximum {MAX_SLOT}",
                k.slot
            )));
        }
        if k.positioned && (k.x.is_none() || k.y.is_none() || k.w.is_none() || k.h.is_none()) {
            return Err(AppError::InvalidLayout(format!(
                "f75 geometry: key {:?} (slot {}) is positioned but missing coordinates",
                k.label, k.slot
            )));
        }
    }

    for s in &geo.locked_slots {
        if !seen.contains(s) {
            return Err(AppError::InvalidLayout(format!(
                "f75 geometry: locked slot {s} is not one of the keys"
            )));
        }
    }
    Ok(())
}

/// Highest addressable keybind slot: entry `i` occupies bytes `8+4i ..= 11+4i`
/// of the 520-byte blob, and slot 127 would collide with the trailer at 518.
pub const MAX_SLOT: u16 = 126;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> String {
        // Mirrors the shape the extractor emits, kept minimal on purpose.
        r#"{
          "source": "test (KB.ini)",
          "vid": "0x258a",
          "pid": "0x010C",
          "matrixLen": 128,
          "scale": { "pitchPx": 38.37, "vPitchPx": 39.06, "hInsetPx": 13.37, "vInsetPx": 12.06 },
          "lockedSlots": [12],
          "keyCount": 3,
          "keys": [
            { "slot": 0, "label": "Esc", "positioned": true, "x": 0, "y": 0, "w": 1, "h": 1,
              "vk": 27, "fn1": { "packed": "0x07000004", "category": 7, "usage": 4 } },
            { "slot": 12, "label": "F1", "positioned": true, "x": 2, "y": 0, "w": 1, "h": 1,
              "vk": 112 },
            { "slot": 84, "label": "Wheel", "positioned": false,
              "hid": { "packed": "0x0700001d", "category": 7, "usage": 29 } }
          ]
        }"#
        .to_string()
    }

    #[test]
    fn parses_and_keeps_the_raw_packed_value() {
        let geo = parse(&sample()).unwrap();
        assert_eq!(geo.key_count, 3);
        assert_eq!(geo.locked_slots, vec![12]);
        let esc = &geo.keys[0];
        assert_eq!(esc.fn1.as_ref().unwrap().packed, "0x07000004");
        assert_eq!(esc.fn1.as_ref().unwrap().category, 0x07);
    }

    #[test]
    fn unpositioned_key_keeps_its_slot_but_has_no_coordinates() {
        let geo = parse(&sample()).unwrap();
        let wheel = geo.keys.iter().find(|k| k.label == "Wheel").unwrap();
        assert!(!wheel.positioned);
        assert!(wheel.x.is_none());
        assert_eq!(wheel.slot, 84);
    }

    #[test]
    fn rejects_a_key_count_that_disagrees_with_the_keys() {
        let bad = sample().replace("\"keyCount\": 3", "\"keyCount\": 4");
        let err = parse(&bad).unwrap_err().to_string();
        assert!(err.contains("keyCount 4"), "{err}");
    }

    #[test]
    fn rejects_duplicate_slots() {
        let bad = sample().replace("\"slot\": 12", "\"slot\": 0");
        let err = parse(&bad).unwrap_err().to_string();
        assert!(err.contains("duplicate slot 0"), "{err}");
    }

    #[test]
    fn rejects_a_slot_past_the_blob_trailer() {
        // Slot 127's bytes would land on the 5A A5 trailer.
        let bad = sample().replace("\"slot\": 84", "\"slot\": 127");
        let err = parse(&bad).unwrap_err().to_string();
        assert!(err.contains("past the addressable maximum"), "{err}");
    }

    #[test]
    fn rejects_a_positioned_key_with_no_coordinates() {
        let bad = sample().replace(
            r#"{ "slot": 12, "label": "F1", "positioned": true, "x": 2, "y": 0, "w": 1, "h": 1,
              "vk": 112 }"#,
            r#"{ "slot": 12, "label": "F1", "positioned": true, "vk": 112 }"#,
        );
        let err = parse(&bad).unwrap_err().to_string();
        assert!(err.contains("missing coordinates"), "{err}");
    }

    #[test]
    fn rejects_a_locked_slot_that_is_not_a_key() {
        let bad = sample().replace("\"lockedSlots\": [12]", "\"lockedSlots\": [99]");
        let err = parse(&bad).unwrap_err().to_string();
        assert!(err.contains("locked slot 99"), "{err}");
    }
}
