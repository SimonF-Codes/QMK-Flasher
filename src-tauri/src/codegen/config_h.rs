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
    // Derived from the layout, not `s.combos` — see `keymap_c::uses_combos`.
    if super::keymap_c::uses_combos(layout) {
        out.push_str(&format!("#define COMBO_COUNT {}\n", layout.combos.len()));
    }
    if s.os_detection {
        // OS_DETECTION_DEBOUNCE is QMK's own default (quantum/os_detection.c);
        // pinning it here keeps the timing from moving under us upstream.
        //
        // OS_DETECTION_SINGLE_REPORT is deliberately NOT defined: it makes
        // os_detection_task() suppress every report after the first, and the
        // agreed precedence rule needs the later report — the one that says the
        // board was plugged into a different machine — to drop a manual
        // QF_OS_* override.
        out.push_str("\n#define OS_DETECTION_DEBOUNCE 250\n");
    }
    out.push_str(&format!(
        "\n#define RGB_MATRIX_STARTUP_SPD {}\n\n",
        s.rgb_startup_speed
    ));
    out
}
