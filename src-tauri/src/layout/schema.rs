//! Layout schema — the shared contract between all workers.
//! Mirrored by `src/lib/types.ts` (zod) and exported as JSON Schema at
//! `shared/layout.schema.json`. See `docs/CONTRACT.md`.
//!
//! Any change here MUST bump [`SCHEMA_VERSION`], be mirrored in
//! `src/lib/types.ts`, regenerate `shared/layout.schema.json`
//! (`REGEN_SCHEMA=1 cargo test`), and be recorded in `docs/CONTRACT.md`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Current version of the layout-file schema.
pub const SCHEMA_VERSION: u32 = 6;

/// Keys per layer in `LAYOUT_moonlander` argument order.
pub const MOONLANDER_KEY_COUNT: usize = 72;

/// The app's persisted layout (`%APPDATA%\qmk-flasher\layout.json`), seeded
/// once from Oryx. Keys are stored in **LAYOUT-arg order** — the Oryx→LAYOUT
/// permutation is applied once at seed time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LayoutFile {
    /// Must equal [`SCHEMA_VERSION`].
    pub schema_version: u32,
    pub meta: Meta,
    /// Index in this array == QMK layer number.
    pub layers: Vec<Layer>,
    pub combos: Vec<Combo>,
    pub settings: Settings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// Display name of the layout, e.g. "Arrows Together".
    pub name: String,
    /// Keyboard geometry id, e.g. "moonlander".
    pub geometry: String,
    pub seeded_from: SeededFrom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeededFrom {
    /// Oryx layout hash id, e.g. "rddD7".
    pub layout_id: String,
    /// Oryx revision hash id, e.g. "QzpBEp".
    pub revision_hash: String,
    /// QMK version reported by Oryx, e.g. "25.0".
    pub qmk_version: String,
    /// RFC 3339 timestamp of the seed.
    pub seeded_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    /// Layer title from Oryx (may be the default "Layer").
    pub title: String,
    /// Base layer color as "#rrggbb" (drives the ledmap base HSV).
    pub color: String,
    /// Exactly [`MOONLANDER_KEY_COUNT`] entries in LAYOUT-arg order.
    pub keys: Vec<KeyAction>,
}

/// One key's behavior. Tagged union on `kind`; every variant carries an
/// optional `glow` ("#rrggbb" per-key LED override).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeyAction {
    /// KC_NO — key does nothing.
    None {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// KC_TRANSPARENT — falls through to the layer below.
    Transparent {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// A plain keycode, optionally with modifiers (e.g. LCTL(KC_C)).
    Basic {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mods: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// MO/TG/TO/TT layer switches.
    LayerSwitch {
        action: LayerSwitchAction,
        layer: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// MT(mods, tap) — modifier on hold, keycode on tap.
    ModTap {
        mods: Vec<String>,
        tap: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// LT(layer, tap) — layer on hold, keycode on tap.
    LayerTap {
        layer: u8,
        tap: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Oryx DUAL_FUNC_n (LT trick + process_record_user case).
    DualFunc {
        tap: TapSpec,
        hold: TapSpec,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// QK_LOCK — the Key Lock key (the whole reason this app exists).
    QkLock {
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Non-basic QMK codes with no parameters: QK_BOOT, CW_TOGG, AS_TOGG,
    /// AU_TOGG, MU_TOGG, TOGGLE_LAYER_COLOR, …
    Special {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// TD(DANCE_n) — v1 read-only.
    TapDance {
        #[serde(skip_serializing_if = "Option::is_none")]
        tap: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        hold: Option<String>,
        #[serde(rename = "doubleTap", skip_serializing_if = "Option::is_none")]
        double_tap: Option<String>,
        #[serde(rename = "tapHold", skip_serializing_if = "Option::is_none")]
        tap_hold: Option<String>,
        #[serde(rename = "tappingTerm", skip_serializing_if = "Option::is_none")]
        tapping_term: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// ST_MACRO_n — v1 read-only.
    Macro {
        label: String,
        steps: Vec<MacroStep>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Parameterless RGB controls: RGB_TOG, RGB_VAI, RGB_SLD, … — v1 read-only.
    Rgb {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// Oryx HSV_h_s_v custom keycode (sets rgblight to a fixed HSV) — v1 read-only.
    RgbHsv {
        h: u8,
        s: u8,
        v: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// OS_MACRO_n — one key, a different step list per host OS. The board picks
    /// which list to send at press time from its current OS mode, so the same
    /// physical key does the right thing on either machine. At least one of the
    /// two lists must be non-empty; an empty list means "do nothing on that OS".
    OsMacro {
        label: String,
        mac: Vec<MacroStep>,
        windows: Vec<MacroStep>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    /// QF_OS_* — sets the board’s OS mode, and with it both the Ctrl↔Cmd swap
    /// and which half of every [`KeyAction::OsMacro`] fires.
    OsMode {
        action: OsModeAction,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
}

/// Which OS a layout is written for / the board is currently in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum OsTarget {
    Mac,
    /// The Arrows Together layout is Windows-authored, so this is the default.
    #[default]
    Windows,
}

/// What an [`KeyAction::OsMode`] key does to the board’s OS mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum OsModeAction {
    /// Flip between Mac and Windows.
    Toggle,
    /// Force Mac.
    Mac,
    /// Force Windows.
    Windows,
    /// Drop the manual override and follow host detection again.
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum LayerSwitchAction {
    MO,
    TG,
    TO,
    TT,
}

/// A keycode plus optional modifiers, as used inside `dualFunc`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TapSpec {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods: Option<Vec<String>>,
}

/// One SEND_STRING step of a macro: tap `code` (with `mods` held), then wait
/// `delay` ms before the next step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods: Option<Vec<String>>,
}

/// COMBO(keys → action). `keys` are LAYOUT-arg key indices (the Oryx→LAYOUT
/// permutation is applied to combo indices at seed time too).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Combo {
    pub name: String,
    pub keys: Vec<u32>,
    /// Layer the combo listens on.
    pub layer: u32,
    pub action: KeyAction,
}

/// Feature toggles driving rules.mk / config.h generation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_shift: bool,
    pub caps_word: bool,
    pub tap_dance: bool,
    pub combos: bool,
    /// Always true — Key Lock is the point of this app.
    pub key_lock: bool,
    pub oryx: bool,
    pub rgb_matrix_custom: bool,
    #[serde(rename = "layerState8bit")]
    pub layer_state_8bit: bool,
    /// SERIAL_NUMBER in config.h, e.g. "rddD7/QzpBEp".
    pub serial_number: String,
    /// OS_DETECTION_ENABLE — the board asks the host what it is at USB
    /// enumeration and sets its OS mode from the answer.
    #[serde(default)]
    pub os_detection: bool,
    /// The OS the board assumes before detection answers (and whenever
    /// detection is off). This is also the OS the layout’s plain Ctrl/Gui
    /// mods were authored against, so it decides which way the swap runs.
    #[serde(default)]
    pub os_default: OsTarget,
    /// Reactive / animated RGB Matrix lighting, or `None` for "this layout does
    /// not configure RGB Matrix at all".
    ///
    /// `None` is deliberately the default and deliberately not the same as
    /// "solid color": a layout seeded from Oryx says nothing about RGB Matrix,
    /// so codegen must say nothing either — that is what keeps
    /// `shared/fixtures/reference_config.h` a frozen record of real Oryx output
    /// rather than a file we edited to match ourselves. See [`Lighting`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lighting: Option<Lighting>,
    /// A ZSA Navigator **trackball** attached to the board, or `None` for "no
    /// pointing device" — which is what every layout before v6 meant, and what
    /// keeps the generated sources byte-identical to Oryx's for a layout that
    /// says nothing about it. Same precedent as [`Settings::lighting`].
    ///
    /// `Some` declares the `zsa/navigator_trackball` community module in
    /// `keymap.json`, and that declaration is the whole opt-in: the module's
    /// own `qmk_module.json` (`features.pointing_device`) is what QMK turns
    /// into `POINTING_DEVICE_ENABLE`, and its `rules.mk` sets the driver and
    /// the I2C requirement. See `codegen::keymap_json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub navigator_trackball: Option<NavigatorTrackball>,
}

/// The Navigator trackball module's knobs. Every field defaults to the value
/// the module itself uses when the define is absent (`navigator.h`,
/// `navigator_trackball.h`), and codegen emits a `#define` only for a field
/// that differs from it — so `NavigatorTrackball::default()` adds the module
/// and not one line of config.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigatorTrackball {
    /// `NAVIGATOR_TRACKBALL_ROTATION`, raw degrees `0..=359`. The module
    /// rotates the sensor's motion by this much (clockwise on screen) before
    /// reporting it; 90/180/270 are exact swaps, any other angle goes through
    /// a compile-time `cosf`/`sinf`. Which number matches which printed shell
    /// is the user's to track — there are deliberately no named presets.
    #[serde(default)]
    pub rotation: u16,
    /// `NAVIGATOR_TRACKBALL_CPI` — the boot pointer speed, in the sensor's own
    /// units. [`NAVIGATOR_CPI_RANGE`], in steps of [`NAVIGATOR_CPI_TICK`]: the
    /// module's `NAVIGATOR_INC_CPI` / `_DEC_CPI` keys move by that tick and
    /// stop at `NAVIGATOR_TRACKBALL_CPI_MAX` (125).
    #[serde(default = "default_navigator_cpi")]
    pub cpi: u8,
    /// `NAVIGATOR_SCROLL_DIVIDER` — drag-scroll: ball motion per scroll step.
    /// Lower scrolls faster. A divisor in the module, so at least 1.
    #[serde(default = "default_navigator_scroll_divider")]
    pub scroll_divider: u8,
    /// `NAVIGATOR_SCROLL_ACCELERATION` — how hard a fast flick speeds up.
    #[serde(default = "default_navigator_scroll_acceleration")]
    pub scroll_acceleration: f32,
    /// `NAVIGATOR_SCROLL_MAX_SPEED` — the cap on one scroll report. The module
    /// casts it to `int8_t`, so it cannot usefully exceed 127.
    #[serde(default = "default_navigator_scroll_max_speed")]
    pub scroll_max_speed: f32,
    /// `NAVIGATOR_SCROLL_INVERT_X` — defined or not; the module checks `#ifdef`.
    #[serde(default)]
    pub scroll_invert_x: bool,
    /// `NAVIGATOR_SCROLL_INVERT_Y`.
    #[serde(default)]
    pub scroll_invert_y: bool,
    /// `NAVIGATOR_TURBO_MULTIPLIER` — what the Turbo keys multiply motion by.
    #[serde(default = "default_navigator_turbo_multiplier")]
    pub turbo_multiplier: u8,
    /// `NAVIGATOR_AIM_DIVIDER` — what the Aim keys divide motion by.
    #[serde(default = "default_navigator_aim_divider")]
    pub aim_divider: u8,
}

/// The module's own defaults, mirrored so codegen can omit what matches them.
pub const NAVIGATOR_DEFAULT_CPI: u8 = 40;
pub const NAVIGATOR_DEFAULT_SCROLL_DIVIDER: u8 = 10;
pub const NAVIGATOR_DEFAULT_SCROLL_ACCELERATION: f32 = 1.5;
pub const NAVIGATOR_DEFAULT_SCROLL_MAX_SPEED: f32 = 8.0;
pub const NAVIGATOR_DEFAULT_TURBO_MULTIPLIER: u8 = 3;
pub const NAVIGATOR_DEFAULT_AIM_DIVIDER: u8 = 3;

/// Bounds on [`NavigatorTrackball::cpi`]. The top is the module's
/// `NAVIGATOR_TRACKBALL_CPI_MAX`, a plain `#define` (not `#ifndef`) that caps
/// the runtime keys; booting above it would put the sensor somewhere the keys
/// could never bring it back to.
pub const NAVIGATOR_CPI_RANGE: std::ops::RangeInclusive<u8> = 5..=125;
/// `NAVIGATOR_TRACKBALL_CPI_TICK` — the step the runtime CPI keys move by.
pub const NAVIGATOR_CPI_TICK: u8 = 5;
/// Top of [`NavigatorTrackball::rotation`]. The module takes `% 360`, so 360
/// would compile, but it is 0 spelled differently.
pub const NAVIGATOR_ROTATION_MAX: u16 = 359;
/// Bounds on the turbo multiplier and aim divisor: a divisor of 0 is a
/// division by zero in the firmware, and past 10 the pointer is unusable.
pub const NAVIGATOR_FACTOR_RANGE: std::ops::RangeInclusive<u8> = 1..=10;
/// Bounds on [`NavigatorTrackball::scroll_divider`] (a divisor, so not 0).
pub const NAVIGATOR_SCROLL_DIVIDER_RANGE: std::ops::RangeInclusive<u8> = 1..=50;
/// Bounds on [`NavigatorTrackball::scroll_acceleration`].
pub const NAVIGATOR_SCROLL_ACCELERATION_RANGE: std::ops::RangeInclusive<f32> = 0.0..=10.0;
/// Bounds on [`NavigatorTrackball::scroll_max_speed`]: one step is the floor
/// (the module starts every scroll at 1.0), `int8_t` the ceiling.
pub const NAVIGATOR_SCROLL_MAX_SPEED_RANGE: std::ops::RangeInclusive<f32> = 1.0..=127.0;

fn default_navigator_cpi() -> u8 {
    NAVIGATOR_DEFAULT_CPI
}
fn default_navigator_scroll_divider() -> u8 {
    NAVIGATOR_DEFAULT_SCROLL_DIVIDER
}
fn default_navigator_scroll_acceleration() -> f32 {
    NAVIGATOR_DEFAULT_SCROLL_ACCELERATION
}
fn default_navigator_scroll_max_speed() -> f32 {
    NAVIGATOR_DEFAULT_SCROLL_MAX_SPEED
}
fn default_navigator_turbo_multiplier() -> u8 {
    NAVIGATOR_DEFAULT_TURBO_MULTIPLIER
}
fn default_navigator_aim_divider() -> u8 {
    NAVIGATOR_DEFAULT_AIM_DIVIDER
}

impl Default for NavigatorTrackball {
    fn default() -> Self {
        Self {
            rotation: 0,
            cpi: NAVIGATOR_DEFAULT_CPI,
            scroll_divider: NAVIGATOR_DEFAULT_SCROLL_DIVIDER,
            scroll_acceleration: NAVIGATOR_DEFAULT_SCROLL_ACCELERATION,
            scroll_max_speed: NAVIGATOR_DEFAULT_SCROLL_MAX_SPEED,
            scroll_invert_x: false,
            scroll_invert_y: false,
            turbo_multiplier: NAVIGATOR_DEFAULT_TURBO_MULTIPLIER,
            aim_divider: NAVIGATOR_DEFAULT_AIM_DIVIDER,
        }
    }
}

impl NavigatorTrackball {
    /// Every value the firmware cannot express, named. Codegen turns these
    /// straight into `#define`s, so a bad one is a broken board (a zero
    /// divisor) or a sensor the runtime keys cannot recover, not a typo.
    pub fn validate(&self) -> Result<(), String> {
        let at = "settings.navigatorTrackball";
        if self.rotation > NAVIGATOR_ROTATION_MAX {
            return Err(format!(
                "{at}.rotation is {}, outside 0..={NAVIGATOR_ROTATION_MAX}",
                self.rotation
            ));
        }
        if !NAVIGATOR_CPI_RANGE.contains(&self.cpi) || self.cpi % NAVIGATOR_CPI_TICK != 0 {
            return Err(format!(
                "{at}.cpi is {}, expected a multiple of {NAVIGATOR_CPI_TICK} in {}..={}",
                self.cpi,
                NAVIGATOR_CPI_RANGE.start(),
                NAVIGATOR_CPI_RANGE.end()
            ));
        }
        let int = |name: &str, v: u8, r: &std::ops::RangeInclusive<u8>| {
            if r.contains(&v) {
                Ok(())
            } else {
                Err(format!("{at}.{name} is {v}, outside {}..={}", r.start(), r.end()))
            }
        };
        int("scrollDivider", self.scroll_divider, &NAVIGATOR_SCROLL_DIVIDER_RANGE)?;
        int("turboMultiplier", self.turbo_multiplier, &NAVIGATOR_FACTOR_RANGE)?;
        int("aimDivider", self.aim_divider, &NAVIGATOR_FACTOR_RANGE)?;
        let float = |name: &str, v: f32, r: &std::ops::RangeInclusive<f32>| {
            // `contains` is false for NaN, which is the point.
            if r.contains(&v) {
                Ok(())
            } else {
                Err(format!("{at}.{name} is {v}, outside {}..={}", r.start(), r.end()))
            }
        };
        float(
            "scrollAcceleration",
            self.scroll_acceleration,
            &NAVIGATOR_SCROLL_ACCELERATION_RANGE,
        )?;
        float("scrollMaxSpeed", self.scroll_max_speed, &NAVIGATOR_SCROLL_MAX_SPEED_RANGE)?;
        Ok(())
    }
}

/// Which painter owns the LEDs.
///
/// The ledmap and a stock effect cannot share the board, and this is not a
/// policy choice — it falls out of the generated firmware.
/// `rgb_matrix_indicators_user()` runs *after* the active effect has rendered a
/// frame and `set_layer_color()` overwrites every LED from the ledmap, so with
/// the ledmap emitted no animation is ever visible. Rather than let one
/// silently win, the layout picks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LightingMode {
    /// Today's behavior: the per-layer ledmap repaints every LED every frame.
    /// The effect below is still compiled in and still configured — ZSA's
    /// `TOGGLE_LAYER_COLOR` keycode stops the repaint at runtime and reveals it.
    #[default]
    Ledmap,
    /// The chosen effect owns the board. `ledmap[]`, `set_layer_color()` and
    /// `rgb_matrix_indicators_user()` are not emitted at all, so the per-layer
    /// colors are absent from the firmware rather than merely overdrawn.
    Effect,
    /// The ledmap still owns the **colors**; a keypress owns the **brightness**
    /// of the key it struck, which then fades back.
    ///
    /// This is not one of QMK's reactive effects and could not be: every one of
    /// them renders through `effect_runner_reactive`, which paints each LED
    /// from the single global `rgb_matrix_config.hsv`
    /// (`quantum/rgb_matrix/animations/runners/effect_runner_reactive.h`) — one
    /// color for the whole board, per-key layout colors gone. Here the ledmap
    /// is emitted exactly as in [`LightingMode::Ledmap`] and
    /// `set_layer_color()` scales each LED's `v` by how recently that LED was
    /// hit, read from `g_last_hit_tracker`.
    Reactive,
}

/// RGB Matrix configuration: which effects are compiled in, which one boots,
/// and the HSV/speed the board starts at.
///
/// Names in `effect` / `extra_effects` are QMK's own, from
/// `shared/rgb_effects.json` — `SOLID_REACTIVE_SIMPLE`, `SPLASH`, … The
/// expensive switches (`RGB_MATRIX_KEYPRESSES`, `RGB_MATRIX_FRAMEBUFFER_EFFECTS`)
/// are **derived** from that set by `codegen::config_h`, never stored, for the
/// same reason `TAP_DANCE_ENABLE` is derived from the layout's actual tap
/// dances: a stored flag drifts from the thing it describes, and here the drift
/// compiles an effect that can never render or costs scan time nothing uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Lighting {
    pub mode: LightingMode,
    /// `RGB_MATRIX_DEFAULT_MODE` — the effect the board boots into.
    pub effect: String,
    /// Also compiled in, so `RGB_MOD` can reach them. Every name here costs
    /// flash, which is why the set is explicit instead of "all of them".
    #[serde(default)]
    pub extra_effects: Vec<String>,
    /// `RGB_MATRIX_DEFAULT_HUE`.
    pub hue: u8,
    /// `RGB_MATRIX_DEFAULT_SAT`.
    pub sat: u8,
    /// `RGB_MATRIX_DEFAULT_VAL`. Also the ledmap's master brightness: the
    /// generated `hsv_to_rgb_with_value()` scales every ledmap color by
    /// `rgb_matrix_config.hsv.v`, so this dims both modes.
    pub val: u8,
    /// `RGB_MATRIX_DEFAULT_SPD`.
    pub speed: u8,
    /// How much brighter a struck key goes than its resting level, on the
    /// ledmap's own 0–255 `v` scale. Only read in [`LightingMode::Reactive`].
    ///
    /// A tap cannot go *above* the layout's color: the peak the LEDs can reach
    /// is already `hsv.v` scaled by the board's master brightness, and pushing
    /// past that would mean overriding the ceiling the vendor set. So the
    /// resting state is the ledmap color dimmed **by** this much and a hit
    /// restores it to full. 0 is a static ledmap; 255 leaves unstruck keys
    /// dark.
    #[serde(default = "default_reactive_boost")]
    pub reactive_boost: u8,
    /// Milliseconds from the strike back to the resting level, linear. Only
    /// read in [`LightingMode::Reactive`]. Bounded by [`validate`] to
    /// [`REACTIVE_FADE_MS_RANGE`]: 0 would divide by zero in the generated C,
    /// and QMK's hit ticks are `uint16_t` milliseconds.
    ///
    /// [`validate`]: LayoutFile::validate
    #[serde(default = "default_reactive_fade_ms")]
    pub reactive_fade_ms: u16,
    /// Re-apply `mode`/`hue`/`sat`/`val`/`speed` from
    /// `keyboard_post_init_user()` on every boot, with the `_noeeprom` setters.
    ///
    /// Without this the settings above are **inert on any board that has been
    /// used before**: `rgb_matrix_init()` applies the `RGB_MATRIX_DEFAULT_*`
    /// defines only when EEPROM holds no mode at all (`rgb_matrix.c:492`,
    /// `if (!rgb_matrix_config.mode)`), so a board with a stored mode keeps
    /// whatever hue, saturation and brightness it was last left on — and,
    /// because `#undef`-ing effects shrinks the effect enum, a stored mode
    /// index resolves to a *different* effect after each flash.
    ///
    /// The cost is stated in the UI rather than hidden: with this on, a mode
    /// cycled to with `RGB_MOD` on the board does not survive a replug.
    #[serde(default = "default_apply_on_boot")]
    pub apply_on_boot: bool,
}

/// Bounds on [`Lighting::reactive_fade_ms`].
pub const REACTIVE_FADE_MS_RANGE: std::ops::RangeInclusive<u16> = 50..=5000;

fn default_reactive_boost() -> u8 {
    160
}

fn default_reactive_fade_ms() -> u16 {
    400
}

fn default_apply_on_boot() -> bool {
    true
}

impl Lighting {
    /// Every effect this layout compiles in — the boot effect first, then the
    /// extras, de-duplicated and in the order they were given.
    pub fn effects(&self) -> Vec<&str> {
        let mut out: Vec<&str> = vec![&self.effect];
        for e in &self.extra_effects {
            if !out.contains(&e.as_str()) {
                out.push(e);
            }
        }
        out
    }

    /// `RGB_MATRIX_KEYPRESSES` is needed iff some compiled-in effect is one of
    /// QMK's key-reactive ones, **or** the ledmap itself is reactive — the
    /// generated `set_layer_color()` reads `g_last_hit_tracker`, which QMK
    /// declares only under `RGB_MATRIX_KEYREACTIVE_ENABLED`
    /// (`rgb_matrix.h:284`), and that is what this define turns on
    /// (`rgb_matrix_types.h:26`). Derived, never stored.
    pub fn needs_keypresses(&self) -> bool {
        self.mode == LightingMode::Reactive
            || self
                .effects()
                .iter()
                .filter_map(|n| crate::rgb_effects::find(n))
                .any(|e| e.reactive)
    }

    /// Likewise `RGB_MATRIX_FRAMEBUFFER_EFFECTS`.
    pub fn needs_framebuffer(&self) -> bool {
        self.effects()
            .iter()
            .filter_map(|n| crate::rgb_effects::find(n))
            .any(|e| e.framebuffer)
    }
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl KeyAction {
    pub fn glow(&self) -> Option<&String> {
        match self {
            KeyAction::None { glow }
            | KeyAction::Transparent { glow }
            | KeyAction::Basic { glow, .. }
            | KeyAction::LayerSwitch { glow, .. }
            | KeyAction::ModTap { glow, .. }
            | KeyAction::LayerTap { glow, .. }
            | KeyAction::DualFunc { glow, .. }
            | KeyAction::QkLock { glow }
            | KeyAction::Special { glow, .. }
            | KeyAction::TapDance { glow, .. }
            | KeyAction::Macro { glow, .. }
            | KeyAction::Rgb { glow, .. }
            | KeyAction::RgbHsv { glow, .. }
            | KeyAction::OsMacro { glow, .. }
            | KeyAction::OsMode { glow, .. } => glow.as_ref(),
        }
    }
}

impl LayoutFile {
    /// Upgrade an older on-disk layout in place, so a file written by a
    /// previous build still opens.
    ///
    /// Every arm so far has been an additive one: v2→v3 added
    /// `settings.osDetection` / `settings.osDefault`, v3→v4 added
    /// `settings.lighting`, v4→v5 added the reactive-ledmap knobs and dropped
    /// `settings.rgbStartupSpeed`, v5→v6 added `settings.navigatorTrackball`,
    /// and every added field is `serde(default)`,
    /// so serde has already filled them in by the time this runs and the
    /// version stamp is all that is left to move. The arms are written as a
    /// **ladder**, not a match: a v2 file has to walk 2→3→4→5→6, and the day one
    /// of these steps stops being a no-op that ordering is what makes it
    /// correct.
    pub fn migrate(&mut self) {
        if self.schema_version == 2 {
            self.schema_version = 3;
        }
        if self.schema_version == 3 {
            // `lighting` absent means "this layout does not configure RGB
            // Matrix", which is exactly what every v3 layout meant. Nothing to
            // synthesize: filling in a default here would start emitting RGB
            // defines into firmware that never had them.
            self.schema_version = 4;
        }
        if self.schema_version == 4 {
            // `rgbStartupSpeed` is gone; serde has already dropped it (it is an
            // unknown field now, and this struct does not deny those). Nothing
            // is lost — `RGB_MATRIX_STARTUP_SPD` is not a macro QMK has ever
            // read, so the value never reached a board. A v4 layout that
            // configured `lighting` picks up `applyOnBoot: true` here, which is
            // the whole point of the version: its stored hue and mode start
            // reaching the board instead of being overruled by EEPROM.
            self.schema_version = 5;
        }
        if self.schema_version == 5 {
            // `navigatorTrackball` absent means "no pointing device", which is
            // what every v5 layout meant. Nothing to synthesize: filling in a
            // default here would declare the module and change the firmware of
            // a board that has no trackball attached.
            self.schema_version = 6;
        }
    }

    /// Structural checks beyond what serde enforces.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported schemaVersion {} (expected {})",
                self.schema_version, SCHEMA_VERSION
            ));
        }
        if self.layers.is_empty() {
            return Err("layout has no layers".into());
        }
        if !self.settings.key_lock {
            return Err("settings.keyLock must always be true".into());
        }
        if let Some(lighting) = &self.settings.lighting {
            // Every name has to be one QMK actually has, because codegen turns
            // it straight into `RGB_MATRIX_<name>` / `ENABLE_RGB_MATRIX_<name>`
            // — a typo here is a compile error two minutes into a build.
            for name in lighting.effects() {
                if crate::rgb_effects::find(name).is_none() {
                    return Err(format!(
                        "settings.lighting names {name:?}, which is not an effect in \
                         shared/rgb_effects.json"
                    ));
                }
            }
            // The fade window is a divisor in the generated C and QMK's hit
            // ticks are `uint16_t` milliseconds, so 0 is a division by zero and
            // a minute-long fade is past what the tracker can even represent.
            if !REACTIVE_FADE_MS_RANGE.contains(&lighting.reactive_fade_ms) {
                return Err(format!(
                    "settings.lighting.reactiveFadeMs is {}, outside {}..={}",
                    lighting.reactive_fade_ms,
                    REACTIVE_FADE_MS_RANGE.start(),
                    REACTIVE_FADE_MS_RANGE.end()
                ));
            }
        }
        if let Some(nav) = &self.settings.navigator_trackball {
            nav.validate()?;
        }
        // Per-keyboard key count from the registry (`meta.geometry` is the
        // keyboard id; only the 72-key Moonlander exists today).
        let key_count = crate::keyboards::find(&self.meta.geometry)
            .map(|kb| kb.key_count as usize)
            .ok_or_else(|| {
                format!(
                    "meta.geometry {:?} is not a keyboard in shared/keyboards.json",
                    self.meta.geometry
                )
            })?;
        for (i, layer) in self.layers.iter().enumerate() {
            if layer.keys.len() != key_count {
                return Err(format!(
                    "layer {} ({}) has {} keys, expected {}",
                    i,
                    layer.title,
                    layer.keys.len(),
                    key_count
                ));
            }
            if !is_hex_color(&layer.color) {
                return Err(format!(
                    "layer {} color {:?} is not \"#rrggbb\"",
                    i, layer.color
                ));
            }
            for (k, key) in layer.keys.iter().enumerate() {
                if let Some(glow) = key.glow() {
                    if !is_hex_color(glow) {
                        return Err(format!(
                            "layer {} key {} glow {:?} is not \"#rrggbb\"",
                            i, k, glow
                        ));
                    }
                }
                if let KeyAction::OsMacro {
                    label, mac, windows, ..
                } = key
                {
                    if label.trim().is_empty() {
                        return Err(format!("layer {i} key {k}: osMacro needs a label"));
                    }
                    // Both halves empty means the key is dead on every host,
                    // which is never what an author meant.
                    if mac.is_empty() && windows.is_empty() {
                        return Err(format!(
                            "layer {i} key {k}: osMacro {label:?} has no steps for either OS"
                        ));
                    }
                }
            }
        }
        for combo in &self.combos {
            // A combo is "these keys pressed together"; one key is just a key.
            if combo.keys.len() < 2 {
                return Err(format!(
                    "combo {:?} needs at least 2 keys, has {}",
                    combo.name,
                    combo.keys.len()
                ));
            }
            {
                let mut seen = combo.keys.clone();
                seen.sort_unstable();
                seen.dedup();
                if seen.len() != combo.keys.len() {
                    return Err(format!(
                        "combo {:?} lists the same key twice",
                        combo.name
                    ));
                }
            }
            if combo.layer as usize >= self.layers.len() {
                return Err(format!(
                    "combo {:?} references layer {} but only {} layers exist",
                    combo.name,
                    combo.layer,
                    self.layers.len()
                ));
            }
            for &k in &combo.keys {
                if k as usize >= key_count {
                    return Err(format!(
                        "combo {:?} references key index {} (max {})",
                        combo.name,
                        k,
                        key_count - 1
                    ));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../shared/fixtures/seeded_layout.json"
    ));

    fn fixture() -> LayoutFile {
        serde_json::from_str(FIXTURE).expect("fixture must match schema")
    }

    /// A layout written by the previous build (schemaVersion 2, no OS fields)
    /// must still open. This is the whole reason `migrate` exists: without it
    /// the version check rejects every layout already on disk.
    #[test]
    fn v2_layout_migrates_to_current_schema() {
        let mut doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        doc["schemaVersion"] = serde_json::json!(2);
        let settings = doc["settings"].as_object_mut().unwrap();
        settings.remove("osDetection");
        settings.remove("osDefault");

        let mut layout: LayoutFile = serde_json::from_value(doc).expect("v2 must deserialize");
        assert_eq!(layout.schema_version, 2);
        layout.migrate();

        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        layout.validate().expect("migrated layout must validate");
        // The absent fields land on the documented defaults.
        assert!(!layout.settings.os_detection);
        assert_eq!(layout.settings.os_default, OsTarget::Windows);
    }

    /// The same promise one version on: a layout written before RGB Matrix
    /// lighting existed must still open, and must still mean what it meant —
    /// which is "no lighting configured", not "lighting at its defaults". The
    /// difference is visible in the generated `config.h`, so it is not
    /// cosmetic.
    #[test]
    fn v3_layout_migrates_to_current_schema() {
        let mut doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        doc["schemaVersion"] = serde_json::json!(3);
        doc["settings"].as_object_mut().unwrap().remove("lighting");

        let mut layout: LayoutFile = serde_json::from_value(doc).expect("v3 must deserialize");
        assert_eq!(layout.schema_version, 3);
        layout.migrate();

        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        layout.validate().expect("migrated layout must validate");
        assert!(layout.settings.lighting.is_none());
    }

    /// v5→v6: a layout from before the Navigator setting opens, and means what
    /// it meant — no pointing device. Defaulting one in here would declare the
    /// module in the firmware of a board with nothing attached.
    #[test]
    fn v5_layout_migrates_with_no_trackball() {
        let mut doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        doc["schemaVersion"] = serde_json::json!(5);
        doc["settings"].as_object_mut().unwrap().remove("navigatorTrackball");

        let mut layout: LayoutFile = serde_json::from_value(doc).expect("v5 must deserialize");
        assert_eq!(layout.schema_version, 5);
        layout.migrate();

        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        layout.validate().expect("migrated layout must validate");
        assert!(layout.settings.navigator_trackball.is_none());
        // ...and it serializes back without the key, so a re-saved v5 layout
        // does not grow a field it never had.
        let out = serde_json::to_value(&layout).unwrap();
        assert!(out["settings"].get("navigatorTrackball").is_none());
    }

    /// `{}` is a whole trackball: every knob falls back to the module's own
    /// default, so the UI can switch the Navigator on without inventing values.
    #[test]
    fn an_empty_trackball_object_takes_the_modules_defaults() {
        let nav: NavigatorTrackball = serde_json::from_str("{}").unwrap();
        assert_eq!(nav, NavigatorTrackball::default());
        assert_eq!(nav.cpi, 40);
        assert_eq!(nav.rotation, 0);
        nav.validate().unwrap();
    }

    #[test]
    fn trackball_values_the_firmware_cannot_express_are_rejected() {
        let ok = NavigatorTrackball::default();
        let bad: Vec<(&str, NavigatorTrackball)> = vec![
            ("rotation 360", NavigatorTrackball { rotation: 360, ..ok.clone() }),
            // Above NAVIGATOR_TRACKBALL_CPI_MAX the runtime keys cannot recover.
            ("cpi 130", NavigatorTrackball { cpi: 130, ..ok.clone() }),
            ("cpi 0", NavigatorTrackball { cpi: 0, ..ok.clone() }),
            ("cpi off-tick", NavigatorTrackball { cpi: 42, ..ok.clone() }),
            // Divisors in the module: zero is a division by zero on the board.
            ("scroll divider 0", NavigatorTrackball { scroll_divider: 0, ..ok.clone() }),
            ("aim divider 0", NavigatorTrackball { aim_divider: 0, ..ok.clone() }),
            ("turbo 0", NavigatorTrackball { turbo_multiplier: 0, ..ok.clone() }),
            ("accel NaN", NavigatorTrackball { scroll_acceleration: f32::NAN, ..ok.clone() }),
            ("max speed 0.5", NavigatorTrackball { scroll_max_speed: 0.5, ..ok.clone() }),
            ("max speed 200", NavigatorTrackball { scroll_max_speed: 200.0, ..ok.clone() }),
        ];
        for (name, nav) in bad {
            let mut layout = fixture();
            layout.settings.navigator_trackball = Some(nav);
            assert!(layout.validate().is_err(), "{name} must be rejected");
        }
        for good in [
            NavigatorTrackball { rotation: 359, ..ok.clone() },
            NavigatorTrackball { cpi: 125, ..ok.clone() },
            NavigatorTrackball { cpi: 5, ..ok.clone() },
        ] {
            let mut layout = fixture();
            layout.settings.navigator_trackball = Some(good.clone());
            layout.validate().unwrap_or_else(|e| panic!("{good:?}: {e}"));
        }
    }

    /// A v2 file has to cross two arms to get here, so the ladder is walked
    /// rather than matched on. Without that, the oldest layouts on disk — the
    /// ones this whole mechanism exists for — would stop at v3 and be rejected.
    #[test]
    fn a_v2_layout_walks_every_arm_not_just_the_first() {
        let mut doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        doc["schemaVersion"] = serde_json::json!(2);
        let settings = doc["settings"].as_object_mut().unwrap();
        settings.remove("osDetection");
        settings.remove("osDefault");
        settings.remove("lighting");

        let mut layout: LayoutFile = serde_json::from_value(doc).unwrap();
        layout.migrate();
        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        layout.validate().expect("a v2 layout must reach the current schema");
    }

    /// v4→v5: `rgbStartupSpeed` leaves and the reactive knobs arrive. The
    /// consequential part is `applyOnBoot`, which lands on `true` — a v4 layout
    /// that configured lighting had settings the board was ignoring, and
    /// migrating is where they start reaching it. `reactiveBoost` and
    /// `reactiveFadeMs` are inert until the mode changes, so their defaults
    /// change nothing about the firmware a v4 layout generates.
    #[test]
    fn v4_layout_migrates_and_its_lighting_starts_reaching_the_board() {
        let mut doc: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        doc["schemaVersion"] = serde_json::json!(4);
        let settings = doc["settings"].as_object_mut().unwrap();
        settings.insert("rgbStartupSpeed".into(), serde_json::json!(60));
        settings.insert(
            "lighting".into(),
            serde_json::json!({
                "mode": "ledmap",
                "effect": "SPLASH",
                "extraEffects": [],
                "hue": 170,
                "sat": 255,
                "val": 175,
                "speed": 150,
            }),
        );

        let mut layout: LayoutFile = serde_json::from_value(doc).expect("v4 must deserialize");
        assert_eq!(layout.schema_version, 4);
        layout.migrate();

        assert_eq!(layout.schema_version, SCHEMA_VERSION);
        layout.validate().expect("migrated layout must validate");
        let lighting = layout.settings.lighting.expect("lighting survives");
        assert_eq!(lighting.mode, LightingMode::Ledmap);
        assert_eq!(lighting.hue, 170);
        assert!(lighting.apply_on_boot);
        assert_eq!(lighting.reactive_boost, 160);
        assert_eq!(lighting.reactive_fade_ms, 400);
    }

    /// The fade window is a divisor in the generated C — `(FADE_MS - tick) /
    /// FADE_MS` — and QMK's hit ticks are `uint16_t` milliseconds. A zero here
    /// is a division by zero in firmware, which is a compile that succeeds and
    /// a board that misbehaves, so it is refused where the layout is loaded.
    #[test]
    fn a_fade_window_the_firmware_cannot_express_is_rejected() {
        let mut layout = fixture();
        let mut lighting = Lighting {
            mode: LightingMode::Reactive,
            effect: "SPLASH".into(),
            extra_effects: vec![],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactive_boost: 160,
            reactive_fade_ms: 400,
            apply_on_boot: true,
        };
        layout.settings.lighting = Some(lighting.clone());
        layout.validate().expect("400ms is a fine fade");

        for bad in [0, 10, 60_000] {
            lighting.reactive_fade_ms = bad;
            layout.settings.lighting = Some(lighting.clone());
            assert!(layout.validate().is_err(), "{bad}ms must be rejected");
        }
    }

    /// The reactive ledmap reads `g_last_hit_tracker`, which QMK declares only
    /// under `RGB_MATRIX_KEYREACTIVE_ENABLED` — so the gate is needed for the
    /// MODE, not only for the effect set. Deriving it from the effects alone
    /// would generate a keymap.c that does not compile.
    #[test]
    fn the_reactive_mode_needs_keypresses_on_its_own() {
        let mut lighting = Lighting {
            mode: LightingMode::Ledmap,
            effect: "BREATHING".into(),
            extra_effects: vec![],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactive_boost: 160,
            reactive_fade_ms: 400,
            apply_on_boot: true,
        };
        assert!(!lighting.needs_keypresses());
        lighting.mode = LightingMode::Reactive;
        assert!(lighting.needs_keypresses());
    }

    /// `effect` and `extraEffects` are pasted into `RGB_MATRIX_<name>` by
    /// codegen, so a name QMK does not have is a compile error minutes later.
    /// Catch it where the layout is loaded instead.
    #[test]
    fn lighting_naming_an_unknown_effect_is_rejected() {
        let mut layout = fixture();
        layout.settings.lighting = Some(Lighting {
            mode: LightingMode::Effect,
            effect: "SPLASH_DELUXE".into(),
            extra_effects: vec![],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactive_boost: 160,
            reactive_fade_ms: 400,
            apply_on_boot: true,
        });
        assert!(layout.validate().is_err());

        let lighting = layout.settings.lighting.as_mut().unwrap();
        lighting.effect = "SPLASH".into();
        layout.validate().expect("a real effect name must be accepted");

        // ...and the extras are checked too, not just the boot effect.
        layout.settings.lighting.as_mut().unwrap().extra_effects =
            vec!["NOT_AN_EFFECT".into()];
        assert!(layout.validate().is_err());
    }

    /// The boot effect leads and repeats collapse, so `RGB_MATRIX_DEFAULT_MODE`
    /// is never emitted twice and an effect listed in both places costs its
    /// flash once.
    #[test]
    fn the_effect_set_leads_with_the_boot_effect_and_dedupes() {
        let lighting = Lighting {
            mode: LightingMode::Effect,
            effect: "SPLASH".into(),
            extra_effects: vec!["BREATHING".into(), "SPLASH".into(), "BREATHING".into()],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactive_boost: 160,
            reactive_fade_ms: 400,
            apply_on_boot: true,
        };
        assert_eq!(lighting.effects(), ["SPLASH", "BREATHING"]);
    }

    #[test]
    fn os_macro_with_no_steps_on_either_os_is_rejected() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = KeyAction::OsMacro {
            label: "Desktop right".into(),
            mac: vec![],
            windows: vec![],
            glow: None,
        };
        assert!(layout.validate().is_err());
    }

    #[test]
    fn os_macro_with_one_side_populated_is_allowed() {
        let mut layout = fixture();
        layout.layers[0].keys[0] = KeyAction::OsMacro {
            label: "Desktop right".into(),
            mac: vec![],
            windows: vec![MacroStep {
                code: "KC_RIGHT".into(),
                delay: None,
                mods: Some(vec!["MOD_LGUI".into(), "MOD_LCTL".into()]),
            }],
            glow: None,
        };
        layout.validate().expect("one populated side is enough");
    }

    #[test]
    fn combo_with_a_single_key_is_rejected() {
        let mut layout = fixture();
        layout.combos[0].keys = vec![21];
        assert!(layout.validate().is_err());
    }

    #[test]
    fn combo_repeating_a_key_is_rejected() {
        let mut layout = fixture();
        layout.combos[0].keys = vec![21, 21];
        assert!(layout.validate().is_err());
    }

    #[test]
    fn fixture_deserializes_and_validates() {
        let layout = fixture();
        layout.validate().expect("fixture must pass validation");
        assert_eq!(layout.meta.seeded_from.layout_id, "rddD7");
        assert_eq!(layout.meta.seeded_from.revision_hash, "QzpBEp");
        assert!(layout.settings.key_lock);
        assert_eq!(layout.combos.len(), 2);
    }

    #[test]
    fn fixture_covers_core_key_kinds() {
        let layout = fixture();
        let all: Vec<&KeyAction> =
            layout.layers.iter().flat_map(|l| &l.keys).collect();
        assert!(all.iter().any(|k| matches!(k, KeyAction::QkLock { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::ModTap { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::LayerTap { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::DualFunc { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::TapDance { .. })));
        assert!(all.iter().any(|k| matches!(k, KeyAction::RgbHsv { .. })));
        assert!(all
            .iter()
            .any(|k| matches!(k, KeyAction::Transparent { .. })));
    }

    #[test]
    fn fixture_roundtrips() {
        let layout = fixture();
        let json = serde_json::to_string(&layout).unwrap();
        let back: LayoutFile = serde_json::from_str(&json).unwrap();
        assert_eq!(layout, back);
    }

    #[test]
    fn validate_rejects_bad_key_count() {
        let mut layout = fixture();
        layout.layers[0].keys.pop();
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_wrong_schema_version() {
        let mut layout = fixture();
        layout.schema_version = 1;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_key_lock_disabled() {
        let mut layout = fixture();
        layout.settings.key_lock = false;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn validate_rejects_out_of_range_combo() {
        let mut layout = fixture();
        layout.combos[0].keys[0] = 72;
        assert!(layout.validate().is_err());
    }

    /// `shared/layout.schema.json` is generated from these types. Run
    /// `REGEN_SCHEMA=1 cargo test json_schema` after any schema change.
    #[test]
    fn json_schema_up_to_date() {
        let schema = schemars::schema_for!(LayoutFile);
        let generated =
            serde_json::to_string_pretty(&schema).unwrap() + "\n";
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../shared/layout.schema.json"
        );
        if std::env::var("REGEN_SCHEMA").is_ok() {
            std::fs::write(path, &generated).unwrap();
        }
        let committed = std::fs::read_to_string(path)
            .expect("shared/layout.schema.json missing — run REGEN_SCHEMA=1 cargo test");
        assert_eq!(
            committed.replace("\r\n", "\n"),
            generated,
            "shared/layout.schema.json is stale — run REGEN_SCHEMA=1 cargo test"
        );
    }
}
