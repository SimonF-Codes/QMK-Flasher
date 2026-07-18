//! `rules.mk` from `settings`. `KEY_LOCK_ENABLE = yes` always — it is the
//! point of this app (and `validate()` already rejects `keyLock: false`).

use crate::layout::schema::LayoutFile;

pub fn render(layout: &LayoutFile) -> String {
    let s = &layout.settings;
    let mut out = String::from("CONSOLE_ENABLE = no\nCOMMAND_ENABLE = no\n");
    let mut flag = |name: &str, on: bool| {
        if on {
            out.push_str(&format!("{name} = yes\n"));
        }
    };
    flag("AUTO_SHIFT_ENABLE", s.auto_shift);
    flag("ORYX_ENABLE", s.oryx);
    flag("RGB_MATRIX_CUSTOM_KB", s.rgb_matrix_custom);
    flag("TAP_DANCE_ENABLE", s.tap_dance);
    out.push_str("SPACE_CADET_ENABLE = no\n");
    let mut flag = |name: &str, on: bool| {
        if on {
            out.push_str(&format!("{name} = yes\n"));
        }
    };
    flag("CAPS_WORD_ENABLE", s.caps_word);
    flag("COMBO_ENABLE", s.combos);
    flag("KEY_LOCK_ENABLE", true);
    out
}
