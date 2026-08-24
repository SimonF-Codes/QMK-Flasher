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
    // Derived from the layout's ACTUAL tap-dance usage, not `s.tap_dance`: the
    // stored flag can drift (an edit rebinds the last tap-dance key but leaves
    // it `true`), and enabling the feature without emitting `tap_dance_actions[]`
    // breaks the build. `uses_tap_dance` is the same predicate keymap.c uses to
    // emit that array, so the two can never disagree. See its doc comment.
    flag(
        "TAP_DANCE_ENABLE",
        super::keymap_c::uses_tap_dance(layout),
    );
    out.push_str("SPACE_CADET_ENABLE = no\n");
    let mut flag = |name: &str, on: bool| {
        if on {
            out.push_str(&format!("{name} = yes\n"));
        }
    };
    flag("CAPS_WORD_ENABLE", s.caps_word);
    // Same desync class as tap dance above, and the same fix: derived from
    // `layout.combos`, never from the stored `s.combos` flag. `COMBO_ENABLE=yes`
    // with no `key_combos[]`/`COMBO_COUNT` does not compile, and the inverse
    // (combos in the layout, flag off) would silently drop them. A combo editor
    // is landing in the UI, so this pair will start moving.
    flag("COMBO_ENABLE", super::keymap_c::uses_combos(layout));
    // Host OS detection: `OS_DETECTION` is a QMK generic feature
    // (builddefs/generic_features.mk), so this is all the build needs to
    // compile in os_detection.c and call `process_detected_host_os_user`.
    flag("OS_DETECTION_ENABLE", s.os_detection);
    flag("KEY_LOCK_ENABLE", true);
    out
}
