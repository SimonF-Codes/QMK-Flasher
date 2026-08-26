//! RGB Matrix effect registry (`shared/rgb_effects.json`) — the single source
//! of truth for which animations QMK can compile in and what each one costs.
//!
//! Every entry is QMK's own, read out of
//! `quantum/rgb_matrix/animations/*.h`: `qmk` is the suffix shared by the
//! effect's `RGB_MATRIX_EFFECT(NAME)` declaration, its `ENABLE_RGB_MATRIX_NAME`
//! compile switch and its `RGB_MATRIX_NAME` mode constant. The three flags are
//! the ones that decide what `config.h` has to say:
//!
//! - `reactive` — the effect sits behind `RGB_MATRIX_KEYREACTIVE_ENABLED`,
//!   which `rgb_matrix_types.h:26` derives from `RGB_MATRIX_KEYPRESSES` /
//!   `RGB_MATRIX_KEYRELEASES`. Without one of those defined the effect is
//!   compiled out entirely, whatever `ENABLE_RGB_MATRIX_*` says.
//! - `framebuffer` — needs `RGB_MATRIX_FRAMEBUFFER_EFFECTS` as well.
//! - `hue` / `speed` — whether the configured hue and speed change what you
//!   see. Not cosmetic: `SOLID_REACTIVE*` assigns `hsv.h` from the timer and
//!   throws the configured hue away, `TYPING_HEATMAP` and `DIGITAL_RAIN` read
//!   neither hue nor speed. Showing a slider that does nothing is a lie the UI
//!   should not tell.
//!
//! `alwaysCompiled` marks `SOLID_COLOR`, the one effect with no `#ifdef` around
//! it (`solid_color_anim.h:1`) — it is always available and must never be
//! `#undef`ed.

use std::sync::OnceLock;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

const RGB_EFFECTS_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/rgb_effects.json"
));

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RgbEffect {
    /// QMK's name for the effect, without a prefix — e.g. `SOLID_REACTIVE_SIMPLE`.
    pub qmk: String,
    /// Display name.
    pub label: String,
    /// One line: what it looks like.
    pub blurb: String,
    /// Needs `RGB_MATRIX_KEYPRESSES` (or `RGB_MATRIX_KEYRELEASES`) to exist.
    pub reactive: bool,
    /// Needs `RGB_MATRIX_FRAMEBUFFER_EFFECTS` to exist.
    pub framebuffer: bool,
    /// The configured hue changes what this effect draws.
    pub hue: bool,
    /// The configured speed changes what this effect draws.
    pub speed: bool,
    /// Compiled in unconditionally — no `ENABLE_RGB_MATRIX_*` switch.
    pub always_compiled: bool,
}

/// Every effect, in QMK's own enum order
/// (`quantum/rgb_matrix/animations/rgb_matrix_effects.inc`).
pub fn all() -> &'static [RgbEffect] {
    static ALL: OnceLock<Vec<RgbEffect>> = OnceLock::new();
    ALL.get_or_init(|| {
        serde_json::from_str(RGB_EFFECTS_JSON).expect("shared/rgb_effects.json must parse")
    })
}

pub fn find(qmk: &str) -> Option<&'static RgbEffect> {
    all().iter().find(|e| e.qmk == qmk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses_and_is_unique() {
        let all = all();
        assert!(all.len() >= 40, "catalog looks truncated: {}", all.len());
        let mut names: Vec<&str> = all.iter().map(|e| e.qmk.as_str()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "duplicate effect name in the catalog");
    }

    /// `SOLID_COLOR` is the floor the generated `config.h` leans on: it is the
    /// only mode guaranteed to exist after every other effect is `#undef`ed,
    /// so exactly one entry may claim to be unconditional.
    #[test]
    fn solid_color_is_the_only_always_compiled_effect() {
        let always: Vec<&str> = all()
            .iter()
            .filter(|e| e.always_compiled)
            .map(|e| e.qmk.as_str())
            .collect();
        assert_eq!(always, ["SOLID_COLOR"]);
    }

    /// A framebuffer effect and a reactive effect are gated by different
    /// defines; nothing in QMK needs both, and codegen assumes as much.
    #[test]
    fn no_effect_is_both_reactive_and_framebuffer() {
        assert!(!all().iter().any(|e| e.reactive && e.framebuffer));
    }
}
