//! `config.h` from `settings` (+ combo count).

use crate::layout::schema::LayoutFile;

pub fn render(layout: &LayoutFile) -> String {
    let s = &layout.settings;
    let mut out = String::from(
        "#define USB_SUSPEND_WAKEUP_DELAY 0\n#define CAPS_LOCK_STATUS\n",
    );
    out.push_str(&format!("#define SERIAL_NUMBER \"{}\"\n", s.serial_number));
    if s.layer_state_8bit {
        out.push_str("#define LAYER_STATE_8BIT\n");
    }
    if s.combos {
        out.push_str(&format!("#define COMBO_COUNT {}\n", layout.combos.len()));
    }
    out.push_str(&format!(
        "\n#define RGB_MATRIX_STARTUP_SPD {}\n\n",
        s.rgb_startup_speed
    ));
    out
}
