import { describe, expect, it } from "vitest";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import {
  DEFAULT_LIGHTING,
  RGB_EFFECTS,
  compiledEffects,
  costs,
  effectFor,
  effectLabel,
  paintedBy,
  patchLighting,
  respondsTo,
  setBootEffect,
  setLighting,
  toggleExtraEffect,
} from "./rgbEffects";
import {
  LayoutFileSchema,
  LightingSchema,
  REACTIVE_FADE_MS_MAX,
  REACTIVE_FADE_MS_MIN,
  type LayoutFile,
  type Lighting,
} from "./types";

const fixture = () => LayoutFileSchema.parse(fixtureJson);

const lighting = (over: Partial<Lighting> = {}): Lighting => ({
  ...DEFAULT_LIGHTING,
  ...over,
});

function withLighting(over: Partial<Lighting> = {}): LayoutFile {
  return setLighting(fixture(), lighting(over));
}

describe("the catalog", () => {
  it("parses, and every entry is a distinct QMK effect name", () => {
    expect(RGB_EFFECTS.length).toBeGreaterThan(40);
    const names = new Set(RGB_EFFECTS.map((e) => e.qmk));
    expect(names.size).toBe(RGB_EFFECTS.length);
  });

  /**
   * SOLID_COLOR is the floor codegen leans on: it is the one effect QMK
   * compiles in with no `#ifdef` around it, so it is the only mode guaranteed
   * to survive after everything else is `#undef`ed.
   */
  it("marks exactly one effect as unconditionally compiled", () => {
    const always = RGB_EFFECTS.filter((e) => e.alwaysCompiled).map((e) => e.qmk);
    expect(always).toEqual(["SOLID_COLOR"]);
  });

  it("knows which effects need keypress tracking", () => {
    expect(effectFor("SOLID_REACTIVE_SIMPLE")?.reactive).toBe(true);
    expect(effectFor("SPLASH")?.reactive).toBe(true);
    expect(effectFor("BREATHING")?.reactive).toBe(false);
  });

  it("falls back to the raw name for an effect it does not know", () => {
    expect(effectLabel("SPLASH")).toBe("Splash");
    expect(effectLabel("NOT_AN_EFFECT")).toBe("NOT_AN_EFFECT");
  });
});

describe("what a slider actually reaches", () => {
  /**
   * The reason `respondsTo` is per-effect rather than a blanket "animated
   * effects use hue and speed": SOLID_REACTIVE* assigns `hsv.h` from the timer
   * (`solid_reactive_simple_anim.h:8`) and throws the configured hue away, so a
   * live hue slider there would be a control that does nothing.
   */
  it("reports that the reactive effects ignore the configured hue", () => {
    expect(respondsTo("SOLID_REACTIVE_SIMPLE")).toEqual({
      hue: false,
      speed: true,
    });
    // ...while the splash family really does start from it.
    expect(respondsTo("SOLID_SPLASH")).toEqual({ hue: true, speed: true });
  });

  it("reports that the framebuffer effects read neither", () => {
    expect(respondsTo("TYPING_HEATMAP")).toEqual({ hue: false, speed: false });
    expect(respondsTo("DIGITAL_RAIN")).toEqual({ hue: false, speed: false });
  });
});

describe("the compiled effect set", () => {
  it("leads with the boot effect and collapses repeats", () => {
    const l = lighting({
      effect: "SPLASH",
      extraEffects: ["BREATHING", "SPLASH", "BREATHING"],
    });
    expect(compiledEffects(l)).toEqual(["SPLASH", "BREATHING"]);
  });

  /**
   * Mirrors what codegen derives, so the panel's warning and the generated
   * `config.h` can never disagree about why keypress tracking is on.
   */
  it("turns keypress tracking on for a reactive effect anywhere in the set", () => {
    expect(costs(lighting({ effect: "BREATHING" })).keypresses).toBe(false);
    expect(costs(lighting({ effect: "SPLASH" })).keypresses).toBe(true);
    // An extra counts too — RGB_MOD can cycle to it, so it is compiled in.
    const viaExtra = costs(
      lighting({ effect: "BREATHING", extraEffects: ["SPLASH"] }),
    );
    expect(viaExtra.keypresses).toBe(true);
    expect(viaExtra.reactiveEffects).toEqual(["SPLASH"]);
  });

  it("turns the framebuffer on only for the two effects that need it", () => {
    expect(costs(lighting({ effect: "TYPING_HEATMAP" })).framebuffer).toBe(true);
    expect(costs(lighting({ effect: "SPLASH" })).framebuffer).toBe(false);
  });

  it("counts what is compiled in, since each effect is code in the image", () => {
    expect(
      costs(lighting({ effect: "SPLASH", extraEffects: ["BREATHING"] }))
        .compiled,
    ).toBe(2);
  });
});

describe("who paints the board", () => {
  /**
   * The constraint this feature exists to surface. Mirrors
   * `codegen::keymap_c::emits_ledmap`: with `rgbMatrixCustom` on, the ledmap
   * repaints every LED after the effect has rendered, so effect mode is the
   * only way an animation is ever seen.
   */
  it("gives the ledmap the board unless effect mode says otherwise", () => {
    expect(paintedBy(fixture())).toBe("ledmap");
    expect(paintedBy(withLighting({ mode: "ledmap" }))).toBe("ledmap");
    expect(paintedBy(withLighting({ mode: "effect" }))).toBe("effect");
  });

  it("reports nothing when the layout carries no LED data at all", () => {
    const layout = fixture();
    layout.settings.rgbMatrixCustom = false;
    expect(paintedBy(layout)).toBe("none");
  });

  /** Effect mode wins even without the ledmap, because there is nothing to win against. */
  it("still reports effect mode when there is no ledmap to displace", () => {
    const layout = withLighting({ mode: "effect" });
    layout.settings.rgbMatrixCustom = false;
    expect(paintedBy(layout)).toBe("effect");
  });
});

describe("editing", () => {
  /**
   * Every transform here returns the INPUT OBJECT on a no-op, because
   * `layoutStore` keys off that identity to decide whether an edit dirtied the
   * layout. A structurally-equal copy would mark a redundant click as unsaved
   * work. Same contract as `lib/led.ts`.
   */
  it("returns the input layout unchanged when nothing moves", () => {
    const base = withLighting({ effect: "SPLASH" });
    expect(setLighting(base, base.settings.lighting!)).toBe(base);
    expect(patchLighting(base, { effect: "SPLASH" })).toBe(base);
    expect(setBootEffect(base, "SPLASH")).toBe(base);
    // An effect QMK does not have is refused rather than stored.
    expect(setBootEffect(base, "NOT_AN_EFFECT")).toBe(base);
    expect(toggleExtraEffect(base, "NOT_AN_EFFECT")).toBe(base);
    // A layout with lighting off has no field to patch.
    const off = fixture();
    expect(patchLighting(off, { effect: "SPLASH" })).toBe(off);
    expect(setBootEffect(off, "SPLASH")).toBe(off);
  });

  it("turning lighting off removes the field rather than blanking it", () => {
    const on = withLighting();
    const off = setLighting(on, null);
    expect(off.settings.lighting).toBeUndefined();
    expect("lighting" in off.settings).toBe(false);
  });

  /**
   * The boot effect is compiled in by virtue of being the boot effect, so it
   * must never also sit in the extras — it would be counted twice in the cost
   * line and emitted twice in `config.h`.
   */
  it("drops the new boot effect out of the extras", () => {
    const base = withLighting({
      effect: "BREATHING",
      extraEffects: ["SPLASH", "CYCLE_ALL"],
    });
    const next = setBootEffect(base, "SPLASH");
    expect(next.settings.lighting).toMatchObject({
      effect: "SPLASH",
      extraEffects: ["CYCLE_ALL"],
    });
  });

  it("refuses to add the boot effect as an extra", () => {
    const base = withLighting({ effect: "SPLASH" });
    expect(toggleExtraEffect(base, "SPLASH")).toBe(base);
  });

  it("toggles an extra on and back off", () => {
    const base = withLighting({ effect: "BREATHING" });
    const added = toggleExtraEffect(base, "SPLASH");
    expect(added.settings.lighting?.extraEffects).toEqual(["SPLASH"]);
    const removed = toggleExtraEffect(added, "SPLASH");
    expect(removed.settings.lighting?.extraEffects).toEqual([]);
  });

  /** Switching to effect mode must not discard the layer colours it hides. */
  it("keeps the layer colours when the effect takes over", () => {
    const before = withLighting({ mode: "ledmap" });
    const after = patchLighting(before, { mode: "effect" });
    expect(after.layers).toEqual(before.layers);
    expect(patchLighting(after, { mode: "ledmap" }).layers).toEqual(
      before.layers,
    );
  });
});

describe("the starting point", () => {
  /**
   * Turning lighting on must not change what the board looks like. It starts
   * in ledmap mode, so the visible change happens only when the user also hands
   * the LEDs to the effect — one decision at a time.
   */
  it("starts in ledmap mode, so enabling lighting changes nothing visible", () => {
    expect(DEFAULT_LIGHTING.mode).toBe("ledmap");
    expect(paintedBy(setLighting(fixture(), DEFAULT_LIGHTING))).toBe("ledmap");
  });

  it("starts on an effect the catalog actually has", () => {
    expect(effectFor(DEFAULT_LIGHTING.effect)).toBeDefined();
  });

  /** 175 is the Moonlander's RGB_MATRIX_MAXIMUM_BRIGHTNESS; going above it does nothing. */
  it("starts at the board's brightness ceiling and QMK's own speed", () => {
    expect(DEFAULT_LIGHTING.val).toBe(175);
    expect(DEFAULT_LIGHTING.speed).toBe(128);
  });
});

describe("the reactive ledmap", () => {
  /**
   * The whole reason the mode exists. QMK's twelve reactive effects all render
   * through `effect_runner_reactive`, which paints every LED from the single
   * global `rgb_matrix_config.hsv` — pick one and the board becomes one colour.
   * Reactive mode is a LEDMAP mode: the same table, the same repaint, with only
   * `v` modulated, so the layout's colours still reach the board and the
   * preview is still telling the truth.
   */
  it("is a ledmap painter, not an effect painter", () => {
    expect(paintedBy(withLighting({ mode: "reactive" }))).toBe("ledmap");
  });

  /**
   * Mirrors `Lighting::needs_keypresses`, including its mode arm: the generated
   * `set_layer_color()` reads `g_last_hit_tracker`, which QMK declares only
   * under `RGB_MATRIX_KEYREACTIVE_ENABLED`. Get this wrong in the UI and the
   * panel promises a cost-free feature that does not compile.
   */
  it("needs keypress tracking even with no reactive effect compiled in", () => {
    const c = costs(lighting({ mode: "reactive", effect: "BREATHING" }));
    expect(c.keypresses).toBe(true);
    expect(c.reactiveLedmap).toBe(true);
    // ...and the effect set is reported honestly: nothing there is reactive.
    expect(c.reactiveEffects).toEqual([]);
  });

  it("does not claim the reactive ledmap in the other modes", () => {
    for (const mode of ["ledmap", "effect"] as const) {
      const c = costs(lighting({ mode, effect: "BREATHING" }));
      expect(c.reactiveLedmap).toBe(false);
      expect(c.keypresses).toBe(false);
    }
  });
});

describe("settings that reach the board", () => {
  /**
   * `RGB_MATRIX_DEFAULT_*` is applied by `rgb_matrix_init()` only when EEPROM
   * holds no mode at all, so on a board that has been used the panel's hue,
   * saturation, brightness and effect are ignored. Defaulting this on is what
   * makes the app authoritative; the cost (an RGB_MOD mode not surviving a
   * replug) is stated in the panel rather than assumed away.
   */
  it("re-applies the settings at boot by default", () => {
    expect(DEFAULT_LIGHTING.applyOnBoot).toBe(true);
  });

  it("starts with a visible tap and a fade a typist can see", () => {
    expect(DEFAULT_LIGHTING.reactiveBoost).toBeGreaterThan(0);
    expect(DEFAULT_LIGHTING.reactiveFadeMs).toBeGreaterThanOrEqual(
      REACTIVE_FADE_MS_MIN,
    );
    expect(DEFAULT_LIGHTING.reactiveFadeMs).toBeLessThanOrEqual(
      REACTIVE_FADE_MS_MAX,
    );
  });

  /**
   * The fade window is a divisor in the generated C, and QMK's hit ticks are
   * `uint16_t` milliseconds. Rejecting it here is what stops a layout that
   * cannot compile from ever being saved. Mirrors `REACTIVE_FADE_MS_RANGE`.
   */
  it("refuses a fade window the firmware cannot express", () => {
    for (const reactiveFadeMs of [0, 10, 60_000]) {
      expect(() => LightingSchema.parse(lighting({ reactiveFadeMs }))).toThrow();
    }
    expect(() =>
      LightingSchema.parse(lighting({ reactiveFadeMs: 400 })),
    ).not.toThrow();
  });

  /**
   * A layout written before this feature existed must still open, and must
   * open with the settings reaching the board — that is the fix, and it should
   * not need the user to find a checkbox.
   */
  it("fills in the new fields when an older layout has none of them", () => {
    const { reactiveBoost, reactiveFadeMs, applyOnBoot, ...old } =
      DEFAULT_LIGHTING;
    void reactiveBoost;
    void reactiveFadeMs;
    void applyOnBoot;
    const parsed = LightingSchema.parse(old);
    expect(parsed.applyOnBoot).toBe(true);
    expect(parsed.reactiveBoost).toBe(160);
    expect(parsed.reactiveFadeMs).toBe(400);
  });
});
