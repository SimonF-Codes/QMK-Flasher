//! `keymap.json` — the QMK community modules this keymap declares.
//!
//! The fourth file next to the generated three. It used to be a constant:
//! `zsa/oryx` and `zsa/defaults`, which the Oryx-generated code depends on
//! (`rgb_matrix_kb.inc`, `rawhid_state`, the ORYX protocol, and the keycode
//! table that includes the Navigator's own keys). Without it the build fails at
//! `#include "rgb_matrix_kb.inc"`.
//!
//! It is derived now because a module is how ZSA ships the Navigator driver,
//! and declaring the module is the **whole** opt-in. QMK's
//! `generate-community-modules-rules-mk`
//! (`lib/python/qmk/cli/generate/community_modules.py`, `_generate_features_rules`)
//! turns `"features": {"pointing_device": true}` in the module's
//! `qmk_module.json` into `POINTING_DEVICE_ENABLE=yes`, and `build_keyboard.mk`
//! includes that generated file after the keymap's own `rules.mk` and before
//! `common_features.mk` reads the flag. The module's `rules.mk` sets
//! `POINTING_DEVICE_DRIVER = custom` and `I2C_DRIVER_REQUIRED = yes`; its
//! `config.h` defines `MOUSE_EXTENDED_REPORT` / `WHEEL_EXTENDED_REPORT` under
//! `#ifndef`. So our `rules.mk` and `config.h` add none of those: a second copy
//! of a flag the module already owns is the kind of thing that builds today
//! and breaks on a QMK bump.

use crate::layout::schema::LayoutFile;

/// Always declared — the Oryx-generated sources do not build without them.
const BASE_MODULES: [&str; 2] = ["zsa/oryx", "zsa/defaults"];

/// ZSA's trackball driver (`modules/zsa/navigator_trackball/`).
pub const NAVIGATOR_TRACKBALL_MODULE: &str = "zsa/navigator_trackball";

/// The modules this layout needs, in declaration order.
pub fn modules(layout: &LayoutFile) -> Vec<&'static str> {
    let mut out = BASE_MODULES.to_vec();
    if layout.settings.navigator_trackball.is_some() {
        out.push(NAVIGATOR_TRACKBALL_MODULE);
    }
    out
}

/// Rendered by hand rather than through `serde_json::to_string_pretty`, so that
/// a layout with no Navigator produces exactly the bytes the old constant did
/// (four-space indent, trailing newline). `write_if_changed` compares bytes, and
/// a reformatted-but-equal file would force a full rebuild of the tree.
pub fn render(layout: &LayoutFile) -> String {
    let entries: Vec<String> = modules(layout)
        .iter()
        .map(|m| format!("        \"{m}\""))
        .collect();
    format!("{{\n    \"modules\": [\n{}\n    ]\n}}\n", entries.join(",\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::schema::NavigatorTrackball;

    fn fixture() -> LayoutFile {
        serde_json::from_str(crate::layout::store::FIXTURE_LAYOUT).unwrap()
    }

    /// The bytes `codegen/mod.rs` hardcoded before this file existed. A layout
    /// that says nothing about the Navigator must still produce them exactly.
    const BEFORE_NAVIGATOR: &str =
        "{\n    \"modules\": [\n        \"zsa/oryx\",\n        \"zsa/defaults\"\n    ]\n}\n";

    #[test]
    fn absent_navigator_is_byte_identical_to_the_old_constant() {
        let layout = fixture();
        assert!(layout.settings.navigator_trackball.is_none());
        assert_eq!(render(&layout), BEFORE_NAVIGATOR);
    }

    #[test]
    fn a_trackball_adds_its_module_and_nothing_else() {
        let mut layout = fixture();
        layout.settings.navigator_trackball = Some(NavigatorTrackball::default());
        let json = render(&layout);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(
            parsed,
            serde_json::json!({
                "modules": ["zsa/oryx", "zsa/defaults", "zsa/navigator_trackball"]
            })
        );
    }

    /// The trackpad is a different module with a different manifest
    /// (`digitizer`, not `pointing_device`); this app does not support it, and
    /// a trackball setting must never declare it.
    #[test]
    fn the_trackpad_module_is_never_declared() {
        let mut layout = fixture();
        layout.settings.navigator_trackball = Some(NavigatorTrackball::default());
        assert!(!render(&layout).contains("navigator_trackpad"));
    }
}
