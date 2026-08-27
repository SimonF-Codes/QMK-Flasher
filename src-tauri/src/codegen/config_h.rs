//! `config.h` from `settings` (+ combo count + RGB Matrix lighting).

use crate::layout::schema::{LayoutFile, Lighting, LightingMode};
use crate::rgb_effects;

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
    // `RGB_MATRIX_STARTUP_SPD` used to be emitted here, with `60` from
    // `settings.rgbStartupSpeed`, because Oryx writes that line. It is gone,
    // and so is the setting: the macro appears nowhere in qmk_firmware (the
    // name is `RGB_MATRIX_DEFAULT_SPD`), so nothing ever read it and no board
    // has ever behaved differently for it. Emitting it cost nothing but read as
    // the app's one dynamic lighting knob, which is worse than emitting
    // nothing. `settings.lighting.speed` is the knob that works; removing this
    // line is the only change to the generated firmware that is provably
    // invisible to the board, which is why it is a removal and not a rename.
    out.push('\n');
    if let Some(lighting) = &s.lighting {
        out.push_str(&render_lighting(lighting));
    }
    out
}

/// The RGB Matrix block: the effect set, the switches that set costs, and the
/// boot HSV/speed.
///
/// Ordering is load-bearing. QMK's build puts the keyboard's generated
/// `info_config.h` **before** the keymap's `config.h`
/// (`builddefs/build_keyboard.mk:430` vs `:508`, both fed to `-include` in
/// order by `common_rules.mk:275`), and the Moonlander's `keyboard.json`
/// enables 48 effects there. So this file is the last word: `#undef` genuinely
/// removes an effect the board would otherwise have compiled in, which is the
/// only lever that makes `RGB_MATRIX_KEYPRESSES` affordable — turning it on
/// unlocks all twelve reactive effects at once, since the board already
/// `ENABLE_`d every one of them.
fn render_lighting(lighting: &Lighting) -> String {
    let chosen = lighting.effects();
    let mut out = String::from("/* RGB Matrix — generated from settings.lighting. */\n");

    // Trim first, then enable, so the two lists cannot contradict each other
    // whatever order the catalog is in.
    out.push_str("/* Every effect this layout did not ask for. The board's own\n   keyboard.json turns most of these on; this is where they come back off. */\n");
    for effect in rgb_effects::all() {
        if effect.always_compiled || chosen.contains(&effect.qmk.as_str()) {
            continue;
        }
        out.push_str(&format!("#undef ENABLE_RGB_MATRIX_{}\n", effect.qmk));
    }
    out.push('\n');
    for name in &chosen {
        // SOLID_COLOR has no switch to define (`solid_color_anim.h` is not
        // guarded), and defining one would be a silent no-op that reads like it
        // does something.
        if rgb_effects::find(name).is_some_and(|e| e.always_compiled) {
            continue;
        }
        out.push_str(&format!(
            "#ifndef ENABLE_RGB_MATRIX_{name}\n#    define ENABLE_RGB_MATRIX_{name}\n#endif\n"
        ));
    }

    // Both derived from the chosen set — see `Lighting::needs_keypresses`.
    if lighting.needs_keypresses() {
        out.push_str(
            "\n/* A reactive effect is compiled in, so the matrix scan has to record\n   which key was hit and when (rgb_matrix_types.h:26 turns this into\n   RGB_MATRIX_KEYREACTIVE_ENABLED). Costs flash and scan time. */\n#define RGB_MATRIX_KEYPRESSES\n",
        );
    }
    if lighting.needs_framebuffer() {
        out.push_str(
            "\n/* A framebuffer effect is compiled in: QMK keeps a per-LED buffer\n   between frames for it. Costs RAM. */\n#define RGB_MATRIX_FRAMEBUFFER_EFFECTS\n",
        );
    }

    out.push_str(&format!(
        "\n#define RGB_MATRIX_DEFAULT_MODE RGB_MATRIX_{}\n#define RGB_MATRIX_DEFAULT_HUE {}\n#define RGB_MATRIX_DEFAULT_SAT {}\n#define RGB_MATRIX_DEFAULT_SPD {}\n",
        lighting.effect, lighting.hue, lighting.sat, lighting.speed
    ));

    // Brightness is clamped HERE, in the preprocessor, rather than in the app.
    //
    // QMK's own clamp against the board's ceiling lives inside
    // `rgb_matrix_sethsv_eeprom_helper` (rgb_matrix.c:604), and the boot path
    // does not go through it — `rgb_matrix_init_drivers` assigns
    // `rgb_matrix_config.hsv` straight from these defines (:103). So a `val`
    // above the board's maximum really would light the LEDs harder than the
    // vendor specified, which is a current-draw decision that is theirs, not
    // ours.
    //
    // The board's ceiling is not something this app knows — it comes from the
    // keyboard's own `keyboard.json` (175 on the Moonlander) via the generated
    // `info_config.h`, which the build includes before this file. Comparing
    // against it in C means the clamp stays correct for a board whose ceiling
    // we have never heard of. The `#ifdef` matters: an undefined macro reads as
    // 0 in an `#if`, which would silently clamp the board to black.
    out.push_str(&format!(
        "\n#define QF_RGB_REQUESTED_VAL {}\n#ifdef RGB_MATRIX_MAXIMUM_BRIGHTNESS\n#    if QF_RGB_REQUESTED_VAL > RGB_MATRIX_MAXIMUM_BRIGHTNESS\n#        define RGB_MATRIX_DEFAULT_VAL RGB_MATRIX_MAXIMUM_BRIGHTNESS\n#    else\n#        define RGB_MATRIX_DEFAULT_VAL QF_RGB_REQUESTED_VAL\n#    endif\n#else\n#    define RGB_MATRIX_DEFAULT_VAL QF_RGB_REQUESTED_VAL\n#endif\n",
        lighting.val
    ));

    match lighting.mode {
        LightingMode::Ledmap => out.push_str(
            "\n/* mode: ledmap — the per-layer ledmap repaints over the effect above\n   every frame. TOGGLE_LAYER_COLOR stops the repaint and reveals it. */\n",
        ),
        LightingMode::Effect => out.push_str(
            "\n/* mode: effect — no ledmap is emitted, so the effect above owns the board. */\n",
        ),
        LightingMode::Reactive => out.push_str(&format!(
            "\n/* mode: reactive — the ledmap owns the colours and a keypress owns the\n   brightness of the key it struck. The generated set_layer_color() reads\n   g_last_hit_tracker for this, which is why RGB_MATRIX_KEYPRESSES is on\n   above whether or not any stock reactive effect is compiled in.\n\n   QF_REACTIVE_BOOST: how far below its ledmap colour an untouched key rests,\n     on the ledmap's own 0-255 v scale. A hit restores the full colour. It is\n     a dip and not a lift because the full colour is already the ceiling: the\n     LEDs cannot go past rgb_matrix_config.hsv.v, which the board clamps.\n   QF_REACTIVE_FADE_MS: milliseconds from the strike back to rest, linear. */\n#define QF_REACTIVE_BOOST {}\n#define QF_REACTIVE_FADE_MS {}\n",
            lighting.reactive_boost, lighting.reactive_fade_ms
        )),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::schema::Lighting;

    fn fixture() -> LayoutFile {
        serde_json::from_str(crate::layout::store::FIXTURE_LAYOUT).unwrap()
    }

    fn with(lighting: Lighting) -> String {
        let mut layout = fixture();
        layout.settings.lighting = Some(lighting);
        render(&layout)
    }

    fn lighting(effect: &str, extras: &[&str]) -> Lighting {
        Lighting {
            mode: LightingMode::Effect,
            effect: effect.into(),
            extra_effects: extras.iter().map(|s| (*s).to_string()).collect(),
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactive_boost: 160,
            reactive_fade_ms: 400,
            apply_on_boot: true,
        }
    }

    /// The whole point of `lighting: None`: a layout that says nothing about
    /// RGB Matrix generates the file it generated before this feature existed,
    /// which is what keeps the Oryx golden fixture frozen.
    #[test]
    fn no_lighting_emits_no_rgb_matrix_block() {
        let out = render(&fixture());
        assert!(!out.contains("RGB_MATRIX_DEFAULT_MODE"));
        assert!(!out.contains("ENABLE_RGB_MATRIX_"));
        assert!(!out.contains("RGB_MATRIX_KEYPRESSES"));
    }

    /// The one macro QMK never had. It was emitted for years because Oryx
    /// emits it; nothing read it, so removing it changes no board's behaviour
    /// and stops the file claiming a knob that does not exist.
    #[test]
    fn the_dead_startup_speed_define_is_gone() {
        assert!(!render(&fixture()).contains("RGB_MATRIX_STARTUP_SPD"));
        assert!(!with(lighting("SPLASH", &[])).contains("RGB_MATRIX_STARTUP_SPD"));
    }

    /// The reactive ledmap is not one of QMK's effects — it is our
    /// `set_layer_color()` reading `g_last_hit_tracker`, which QMK declares
    /// only under `RGB_MATRIX_KEYREACTIVE_ENABLED`. So the gate has to be on
    /// even when every compiled-in effect is a static one.
    #[test]
    fn reactive_mode_turns_on_keypresses_without_a_reactive_effect() {
        let mut l = lighting("BREATHING", &[]);
        l.mode = LightingMode::Reactive;
        let out = with(l);
        assert!(out.contains("#define RGB_MATRIX_KEYPRESSES"), "{out}");
        assert!(out.contains("#define QF_REACTIVE_BOOST 160"), "{out}");
        assert!(out.contains("#define QF_REACTIVE_FADE_MS 400"), "{out}");
    }

    /// The two knobs are only meaningful in reactive mode, so they are only
    /// emitted there — a define that is read by no generated code reads like
    /// one that is.
    #[test]
    fn the_reactive_knobs_are_absent_in_the_other_modes() {
        for mode in [LightingMode::Ledmap, LightingMode::Effect] {
            let mut l = lighting("SPLASH", &[]);
            l.mode = mode;
            let out = with(l);
            assert!(!out.contains("QF_REACTIVE_"), "{mode:?}: {out}");
        }
    }

    #[test]
    fn the_boot_effect_becomes_the_default_mode() {
        let out = with(lighting("SPLASH", &[]));
        assert!(out.contains("#define RGB_MATRIX_DEFAULT_MODE RGB_MATRIX_SPLASH"));
        assert!(out.contains("#    define ENABLE_RGB_MATRIX_SPLASH\n"));
    }

    /// The size lever. An effect nobody picked must be actively removed, not
    /// merely left undefined — the board's keyboard.json already defined it.
    #[test]
    fn effects_nobody_picked_are_undefined_not_just_omitted() {
        let out = with(lighting("SPLASH", &[]));
        assert!(out.contains("#undef ENABLE_RGB_MATRIX_CYCLE_LEFT_RIGHT"));
        assert!(out.contains("#undef ENABLE_RGB_MATRIX_TYPING_HEATMAP"));
        // ...but not the one that was asked for.
        assert!(!out.contains("#undef ENABLE_RGB_MATRIX_SPLASH\n"));
    }

    /// `SOLID_COLOR` has no compile switch at all, so neither line may name it:
    /// `#undef` would be misleading and `#define` would be a no-op that reads
    /// like it matters.
    #[test]
    fn solid_color_is_never_undefined_or_enabled() {
        for l in [lighting("SOLID_COLOR", &[]), lighting("SPLASH", &[])] {
            let out = with(l);
            assert!(!out.contains("ENABLE_RGB_MATRIX_SOLID_COLOR"), "{out}");
        }
    }

    #[test]
    fn extra_effects_are_compiled_in_alongside_the_boot_effect() {
        let out = with(lighting("BREATHING", &["SPLASH", "CYCLE_ALL"]));
        for name in ["BREATHING", "SPLASH", "CYCLE_ALL"] {
            assert!(out.contains(&format!("#    define ENABLE_RGB_MATRIX_{name}\n")), "{name}");
            assert!(!out.contains(&format!("#undef ENABLE_RGB_MATRIX_{name}\n")), "{name}");
        }
    }

    /// Derived, not stored: keypress tracking appears because a reactive effect
    /// is in the set, and disappears when it leaves.
    #[test]
    fn keypresses_follows_the_effect_set() {
        assert!(with(lighting("SOLID_REACTIVE_SIMPLE", &[])).contains("#define RGB_MATRIX_KEYPRESSES"));
        assert!(!with(lighting("BREATHING", &[])).contains("#define RGB_MATRIX_KEYPRESSES"));
        // Reactive only as an extra still counts — RGB_MOD can reach it.
        assert!(with(lighting("BREATHING", &["SPLASH"])).contains("#define RGB_MATRIX_KEYPRESSES"));
    }

    #[test]
    fn framebuffer_follows_the_effect_set() {
        assert!(with(lighting("TYPING_HEATMAP", &[]))
            .contains("#define RGB_MATRIX_FRAMEBUFFER_EFFECTS"));
        assert!(!with(lighting("BREATHING", &[]))
            .contains("#define RGB_MATRIX_FRAMEBUFFER_EFFECTS"));
    }

    /// A reactive effect that is compiled in but whose gate is missing renders
    /// nothing at all — the board would boot to a dark keyboard. Guard the
    /// pairing directly rather than trusting the two `if`s to stay in step.
    #[test]
    fn every_compiled_reactive_effect_has_its_gate() {
        for effect in rgb_effects::all().iter().filter(|e| e.reactive) {
            let out = with(lighting(&effect.qmk, &[]));
            assert!(
                out.contains("#define RGB_MATRIX_KEYPRESSES"),
                "{} is compiled in without RGB_MATRIX_KEYPRESSES",
                effect.qmk
            );
        }
    }

    /// The boot path assigns `rgb_matrix_config.hsv` straight from these
    /// defines and never passes QMK's own clamp, so a `val` above the board's
    /// ceiling would drive the LEDs past what the vendor specified. The clamp
    /// is emitted as C because only the board's `info_config.h` knows the
    /// ceiling — and it is `#ifdef`-guarded, because an undefined macro reads
    /// as 0 in an `#if` and would clamp the board to black instead.
    #[test]
    fn brightness_is_clamped_against_the_boards_own_ceiling() {
        let mut l = lighting("BREATHING", &[]);
        l.val = 255;
        let out = with(l);
        assert!(out.contains("#define QF_RGB_REQUESTED_VAL 255"));
        assert!(out.contains("#ifdef RGB_MATRIX_MAXIMUM_BRIGHTNESS"));
        assert!(out
            .contains("#        define RGB_MATRIX_DEFAULT_VAL RGB_MATRIX_MAXIMUM_BRIGHTNESS"));
        // The fallback for a board that names no ceiling honours the request
        // rather than blacking the LEDs out.
        assert!(out.contains("#else\n#    define RGB_MATRIX_DEFAULT_VAL QF_RGB_REQUESTED_VAL"));
        // ...and never as a bare define, which would skip the clamp entirely.
        assert!(!out.contains("#define RGB_MATRIX_DEFAULT_VAL 255"));
    }

    #[test]
    fn the_mode_is_recorded_in_the_generated_file() {
        let mut l = lighting("SPLASH", &[]);
        l.mode = LightingMode::Ledmap;
        assert!(with(l).contains("mode: ledmap"));
        assert!(with(lighting("SPLASH", &[])).contains("mode: effect"));
    }
}
