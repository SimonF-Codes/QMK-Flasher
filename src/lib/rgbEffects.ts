/**
 * The RGB Matrix effect catalog (`shared/rgb_effects.json`) and the pure
 * transforms over `settings.lighting`.
 *
 * Everything here mirrors what the firmware actually does, because the UI's
 * whole job in this feature is to stop being vague about it:
 *
 *  - **The two painters cannot share the board.** The generated
 *    `rgb_matrix_indicators_user()` repaints every LED from the ledmap *after*
 *    the active effect has drawn its frame, so in `ledmap` mode the effect is
 *    invisible until ZSA's `TOGGLE_LAYER_COLOR` keycode stops the repaint, and
 *    in `effect` mode no ledmap is emitted at all. `paintedBy` names the winner.
 *
 *  - **Reactive effects are not free, and their cost is a cliff.** The
 *    Moonlander's own `keyboard.json` already `ENABLE_`s all twelve of them;
 *    they are compiled out only because nothing defines `RGB_MATRIX_KEYPRESSES`.
 *    Ask for one and the matrix scan starts recording every hit. `costs()`
 *    reports that rather than letting a build discover it.
 *
 *  - **Sliders that do nothing are a lie.** `SOLID_REACTIVE*` assigns its hue
 *    from the timer and throws the configured one away; `TYPING_HEATMAP` and
 *    `DIGITAL_RAIN` read neither hue nor speed. `respondsTo` is per-effect,
 *    from the catalog, so the panel can grey out what will not move.
 */
import { z } from "zod";
import raw from "../../shared/rgb_effects.json";
import {
  RgbEffectSchema,
  type Lighting,
  type LayoutFile,
  type RgbEffect,
} from "./types";

/** Every effect, in QMK's own enum order — the order `RGB_MOD` cycles through. */
export const RGB_EFFECTS: RgbEffect[] = z.array(RgbEffectSchema).parse(raw);

const BY_NAME: ReadonlyMap<string, RgbEffect> = new Map(
  RGB_EFFECTS.map((e) => [e.qmk, e] as const),
);

export function effectFor(qmk: string): RgbEffect | undefined {
  return BY_NAME.get(qmk);
}

/** Display name for a QMK effect name, falling back to the name itself. */
export function effectLabel(qmk: string): string {
  return BY_NAME.get(qmk)?.label ?? qmk;
}

/**
 * The lighting a layout that has never configured any would start from:
 * the plainest tap-reactive effect, at the ledmap's own brightness ceiling
 * (`RGB_MATRIX_MAXIMUM_BRIGHTNESS` is 175 on the Moonlander) and QMK's own
 * default speed (`UINT8_MAX / 2`). `ledmap` mode, so turning lighting on
 * changes nothing you can see until you also hand the board over to the effect.
 */
export const DEFAULT_LIGHTING: Lighting = {
  mode: "ledmap",
  effect: "SOLID_REACTIVE_SIMPLE",
  extraEffects: [],
  hue: 0,
  sat: 255,
  val: 175,
  speed: 128,
  reactiveBoost: 160,
  reactiveFadeMs: 400,
  applyOnBoot: true,
};

/**
 * Every effect compiled into the firmware: the boot effect first, then the
 * extras, de-duplicated. Mirrors `Lighting::effects` in the Rust schema.
 */
export function compiledEffects(lighting: Lighting): string[] {
  const out = [lighting.effect];
  for (const e of lighting.extraEffects) if (!out.includes(e)) out.push(e);
  return out;
}

/** Which of hue and speed actually reach the board for this effect. */
export function respondsTo(qmk: string): { hue: boolean; speed: boolean } {
  const e = BY_NAME.get(qmk);
  return { hue: e?.hue ?? false, speed: e?.speed ?? false };
}

export interface LightingCosts {
  /** RGB_MATRIX_KEYPRESSES — the matrix scan records every hit. */
  keypresses: boolean;
  /** RGB_MATRIX_FRAMEBUFFER_EFFECTS — a per-LED buffer kept between frames. */
  framebuffer: boolean;
  /**
   * `mode === "reactive"` — the reactive ledmap needs the hit tracker too, and
   * needs it whether or not a stock reactive effect is compiled in. Reported
   * separately so the panel can say which of the two reasons applies.
   */
  reactiveLedmap: boolean;
  /** Which chosen effects are the reason `keypresses` is on. */
  reactiveEffects: string[];
  /** Which chosen effects are the reason `framebuffer` is on. */
  framebufferEffects: string[];
  /** How many effects are compiled in. Each one is code in the image. */
  compiled: number;
}

/**
 * What this effect set costs the firmware. Derived from the set exactly as
 * codegen derives the defines, so the panel and the generated `config.h` can
 * never disagree about why keypress tracking is on.
 */
export function costs(lighting: Lighting): LightingCosts {
  const chosen = compiledEffects(lighting);
  const entries = chosen
    .map((n) => BY_NAME.get(n))
    .filter((e): e is RgbEffect => !!e);
  const reactiveEffects = entries.filter((e) => e.reactive).map((e) => e.qmk);
  const framebufferEffects = entries
    .filter((e) => e.framebuffer)
    .map((e) => e.qmk);
  const reactiveLedmap = lighting.mode === "reactive";
  return {
    // Mirrors `Lighting::needs_keypresses` in the Rust schema, including the
    // mode arm: the generated `set_layer_color()` reads `g_last_hit_tracker`,
    // which QMK declares only under `RGB_MATRIX_KEYREACTIVE_ENABLED`.
    keypresses: reactiveLedmap || reactiveEffects.length > 0,
    framebuffer: framebufferEffects.length > 0,
    reactiveLedmap,
    reactiveEffects,
    framebufferEffects,
    compiled: chosen.length,
  };
}

/** What is lighting the board, given a layout's settings. */
export type Painter = "ledmap" | "effect" | "none";

/**
 * Which painter the generated firmware gives the LEDs to.
 *
 * `rgbMatrixCustom` says the layout carries LED data at all; `lighting.mode`
 * says whether that data is what the board shows. Mirrors
 * `codegen::keymap_c::emits_ledmap`, `reactive` included: that mode emits the
 * same ledmap and only modulates each LED's brightness, so the colours on the
 * board are still the layout's and the preview is still right.
 */
export function paintedBy(layout: LayoutFile): Painter {
  if (layout.settings.lighting?.mode === "effect") return "effect";
  return layout.settings.rgbMatrixCustom ? "ledmap" : "none";
}

/** A copy of `layout` with `lighting` replaced, or removed when null. */
export function setLighting(
  layout: LayoutFile,
  lighting: Lighting | null,
): LayoutFile {
  const current = layout.settings.lighting ?? null;
  // Identity on a no-op: layoutStore keys off it so a redundant edit never
  // marks the layout dirty. Same contract as everything in led.ts.
  if (JSON.stringify(current) === JSON.stringify(lighting)) return layout;
  const settings = { ...layout.settings };
  if (lighting === null) delete settings.lighting;
  else settings.lighting = lighting;
  return { ...layout, settings };
}

/** A copy of `layout` with one field of `lighting` changed. */
export function patchLighting(
  layout: LayoutFile,
  patch: Partial<Lighting>,
): LayoutFile {
  const current = layout.settings.lighting;
  if (!current) return layout;
  return setLighting(layout, { ...current, ...patch });
}

/**
 * Add or remove an extra effect. The boot effect is never in this list — it is
 * already compiled in — so asking to add it is a no-op rather than a duplicate.
 */
export function toggleExtraEffect(
  layout: LayoutFile,
  qmk: string,
): LayoutFile {
  const current = layout.settings.lighting;
  if (!current || !BY_NAME.has(qmk) || qmk === current.effect) return layout;
  const extraEffects = current.extraEffects.includes(qmk)
    ? current.extraEffects.filter((e) => e !== qmk)
    : [...current.extraEffects, qmk];
  return patchLighting(layout, { extraEffects });
}

/**
 * Make `qmk` the boot effect, dropping it from the extras if it was there —
 * the two lists must not both claim it, or it would be counted twice.
 */
export function setBootEffect(layout: LayoutFile, qmk: string): LayoutFile {
  const current = layout.settings.lighting;
  if (!current || !BY_NAME.has(qmk) || qmk === current.effect) return layout;
  return patchLighting(layout, {
    effect: qmk,
    extraEffects: current.extraEffects.filter((e) => e !== qmk),
  });
}
