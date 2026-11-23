/**
 * The ZSA Navigator trackball: pure transforms over `settings.navigatorTrackball`
 * plus the two things the panel derives from it — which way "up" ends up after
 * rotation, and which of the module's keys the layout already has.
 *
 * Every transform returns the input layout unchanged on a no-op, so the store
 * can key off identity and a redundant click never marks the layout dirty.
 * Same contract as `rgbEffects.ts` and `led.ts`.
 */
import { entryFor } from "./keycodes";
import {
  NavigatorTrackballSchema,
  type KeyAction,
  type LayoutFile,
  type NavigatorTrackball,
} from "./types";

/** Every knob at the module's own default — adds the module and no config. */
export const DEFAULT_NAVIGATOR_TRACKBALL: NavigatorTrackball =
  NavigatorTrackballSchema.parse({});

/** The keycode-catalog category the module's ten keys are filed under. */
export const NAVIGATOR_CATEGORY = "navigator";

/** Is this one of the trackball module's own keycodes? */
export function isNavigatorCode(code: string): boolean {
  return entryFor(code)?.category === NAVIGATOR_CATEGORY;
}

/** A copy of `layout` with the trackball attached (`nav`) or removed (`null`). */
export function setNavigatorTrackball(
  layout: LayoutFile,
  nav: NavigatorTrackball | null,
): LayoutFile {
  const current = layout.settings.navigatorTrackball ?? null;
  if (JSON.stringify(current) === JSON.stringify(nav)) return layout;
  const settings = { ...layout.settings };
  // Off means the key is gone, not `undefined`: absent is what keeps a saved
  // layout byte-identical to one that never had the setting.
  if (nav === null) delete settings.navigatorTrackball;
  else settings.navigatorTrackball = nav;
  return { ...layout, settings };
}

/** A copy of `layout` with some knobs changed; a no-op while the trackball is off. */
export function patchNavigatorTrackball(
  layout: LayoutFile,
  patch: Partial<NavigatorTrackball>,
): LayoutFile {
  const current = layout.settings.navigatorTrackball;
  if (!current) return layout;
  return setNavigatorTrackball(layout, { ...current, ...patch });
}

/** Normalize any integer to the module's 0–359 range (it takes `% 360`). */
export function normalizeRotation(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/**
 * Where a roll that moves the pointer straight **up** at rotation 0 moves it
 * after `deg` of rotation, as a screen-space unit vector (+x right, +y down).
 *
 * The module applies `x' = x·cos − y·sin`, `y' = x·sin + y·cos` to the
 * sensor's report (navigator.c; 90/180/270 are the exact-swap special cases of
 * the same formula). With "up" = (0, −1) that is (sin θ, −cos θ): the motion
 * turns **clockwise on screen** by θ. So at 90 the roll that used to go up now
 * goes right.
 */
export function rotatedUp(deg: number): { x: number; y: number } {
  const t = (normalizeRotation(deg) * Math.PI) / 180;
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { x: clean(Math.sin(t)), y: clean(-Math.cos(t)) };
}

const DIRECTIONS = [
  "up",
  "up and right",
  "right",
  "down and right",
  "down",
  "down and left",
  "left",
  "up and left",
];

/**
 * `rotatedUp` in words, to the nearest eighth of a turn — "roughly" when the
 * angle is not on one, so the panel never claims a precision it does not have.
 */
export function upLandsAt(deg: number): string {
  const d = normalizeRotation(deg);
  const word = DIRECTIONS[Math.round(d / 45) % 8];
  return d % 45 === 0 ? word : `roughly ${word}`;
}

/** Whether the module will rotate with integer swaps (exact) or float trig. */
export function isExactRotation(deg: number): boolean {
  return normalizeRotation(deg) % 90 === 0;
}

export interface NavigatorKeyLocation {
  layer: number;
  index: number;
  code: string;
}

/** Every key in the layout that is one of the module's own keycodes. */
export function findNavigatorKeys(layout: LayoutFile): NavigatorKeyLocation[] {
  const out: NavigatorKeyLocation[] = [];
  layout.layers.forEach((layer, li) =>
    layer.keys.forEach((k: KeyAction, ki) => {
      if (k.kind === "special" && isNavigatorCode(k.code)) {
        out.push({ layer: li, index: ki, code: k.code });
      }
    }),
  );
  return out;
}
