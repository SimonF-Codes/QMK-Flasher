//! Per-layer LED color map: layer color as the base HSV, per-key `glow`
//! overrides, emitted in LED index order via `shared/moonlander_geometry.json`.

use crate::error::AppError;
use crate::geometry;
use crate::layout::schema::LayoutFile;
use crate::oryx::seed::hex_to_hsv;

/// Render the `const uint8_t PROGMEM ledmap[...]` block.
pub fn render(layout: &LayoutFile) -> Result<String, AppError> {
    let geo = geometry::get()?;
    let mut out = String::from("const uint8_t PROGMEM ledmap[][RGB_MATRIX_LED_COUNT][3] = {\n");
    for (li, layer) in layout.layers.iter().enumerate() {
        let base = hex_to_hsv(&layer.color)?;
        // arg order → LED order. Sized by the GEOMETRY, not by the layer: the
        // row has to cover every LED the firmware will read, and `led` indices
        // are what we scatter into. validate() already pins the two to the same
        // length, so the checks below only fire on a corrupt geometry file —
        // but they fail with a message instead of panicking on a bad index.
        let mut by_led = vec![base; geo.keys.len()];
        for (arg, key) in layer.keys.iter().enumerate() {
            let hsv = match key.glow() {
                Some(glow) => hex_to_hsv(glow)?,
                None => base,
            };
            let led = geo
                .keys
                .get(arg)
                .ok_or_else(|| {
                    AppError::InvalidLayout(format!(
                        "layer {li} has {} keys but the geometry defines {}",
                        layer.keys.len(),
                        geo.keys.len()
                    ))
                })?
                .led as usize;
            let slot = by_led.get_mut(led).ok_or_else(|| {
                AppError::InvalidLayout(format!(
                    "geometry key {arg} has led index {led}, past the {} LEDs defined",
                    geo.keys.len()
                ))
            })?;
            *slot = hsv;
        }
        let entries: Vec<String> = by_led
            .iter()
            .map(|(h, s, v)| format!("{{{h},{s},{v}}}"))
            .collect();
        out.push_str(&format!("    [{li}] = {{ {} }},\n\n", entries.join(", ")));
    }
    out.push_str("};\n");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::schema::KeyAction;

    fn fixture() -> LayoutFile {
        serde_json::from_str(crate::layout::store::FIXTURE_LAYOUT).unwrap()
    }

    /// The `{h,s,v}` triples of one rendered row, in LED order. Matches only
    /// braces followed by a digit, so the row's own outer `{` is skipped.
    fn triples(row: &str) -> Vec<&str> {
        let b = row.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < b.len() {
            let starts_triple =
                b[i] == b'{' && b.get(i + 1).is_some_and(u8::is_ascii_digit);
            if starts_triple {
                if let Some(rel) = row[i..].find('}') {
                    out.push(&row[i..i + rel + 1]);
                    i += rel + 1;
                    continue;
                }
            }
            i += 1;
        }
        out
    }

    fn row_for(out: &str, layer: usize) -> String {
        out.lines()
            .find(|l| l.trim_start().starts_with(&format!("[{layer}] = {{")))
            .unwrap_or_else(|| panic!("no row for layer {layer}"))
            .to_string()
    }

    fn hsv(hex: &str) -> String {
        let (h, s, v) = hex_to_hsv(hex).unwrap();
        format!("{{{h},{s},{v}}}")
    }

    /// One `{h,s,v}` triple per LED per layer, and the row is as long as the
    /// geometry — the firmware loops to RGB_MATRIX_LED_COUNT regardless of how
    /// many keys the layout carries.
    #[test]
    fn emits_one_entry_per_led_per_layer() {
        let layout = fixture();
        let geo = geometry::get().unwrap();
        let out = render(&layout).unwrap();
        // `starts_with('[')` and not just `contains("] = {")` — the block's own
        // header line `... ledmap[][RGB_MATRIX_LED_COUNT][3] = {` matches that too.
        let rows: Vec<&str> = out
            .lines()
            .filter(|l| l.trim_start().starts_with('['))
            .collect();
        assert_eq!(rows.len(), layout.layers.len());
        for row in rows {
            assert_eq!(triples(row).len(), geo.keys.len(), "row: {row}");
        }
    }

    /// A key with no glow gets the layer base; a glow lands at that key's LED
    /// index, which is NOT its argument index — the permutation is the whole
    /// reason this module exists.
    #[test]
    fn glow_lands_at_the_led_index_not_the_arg_index() {
        let geo = geometry::get().unwrap();
        // Pick an argument position whose LED index differs from it.
        let (arg, led) = geo
            .keys
            .iter()
            .enumerate()
            .map(|(i, k)| (i, k.led as usize))
            .find(|(i, led)| i != led)
            .expect("geometry is a non-trivial permutation");

        let mut layout = fixture();
        layout.layers[0].color = "#ff0000".into();
        layout.layers[0].keys[arg] = KeyAction::Basic {
            code: "KC_A".into(),
            mods: None,
            glow: Some("#00ff00".into()),
        };

        let out = render(&layout).unwrap();
        let entries = row_for(&out, 0);
        let entries = triples(&entries);

        assert_eq!(entries[led], hsv("#00ff00"), "glow belongs at LED {led}");
        assert_eq!(
            entries[arg],
            hsv("#ff0000"),
            "arg index {arg} must still hold the layer base"
        );
    }

    /// Black is the firmware's "off" (set_layer_color special-cases h=s=v=0),
    /// so it has to survive the hex → HSV conversion as a literal 0,0,0.
    #[test]
    fn black_renders_as_the_off_triple() {
        let mut layout = fixture();
        layout.layers[0].color = "#000000".into();
        // Clear the fixture's own glows so the base is the only thing showing.
        for key in layout.layers[0].keys.iter_mut() {
            *key = KeyAction::Transparent { glow: None };
        }
        let out = render(&layout).unwrap();
        let row = row_for(&out, 0);
        assert!(triples(&row).iter().all(|t| *t == "{0,0,0}"), "row: {row}");
    }

    #[test]
    fn rejects_a_bad_color_instead_of_emitting_garbage() {
        let mut layout = fixture();
        layout.layers[0].color = "not-a-color".into();
        assert!(render(&layout).is_err());
    }
}
