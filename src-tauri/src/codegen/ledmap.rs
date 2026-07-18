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
        // arg order → LED order.
        let mut by_led = vec![base; layout.layers[li].keys.len()];
        for (arg, key) in layer.keys.iter().enumerate() {
            let hsv = match key.glow() {
                Some(glow) => hex_to_hsv(glow)?,
                None => base,
            };
            by_led[geo.keys[arg].led as usize] = hsv;
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
