/**
 * Keycap DISPLAY modes: how a KeyAction is *labeled*, never what it emits.
 *
 * - "advanced" — raw QMK tokens (KC_A, MO(2), LT(2, KC_SPC), LGUI_T(KC_A)…).
 *   The default; matches how the layout is actually stored/compiled.
 * - "mac" / "windows" — human-friendly split labels (tap char + hold glyph),
 *   so dual-function keys are readable. Mac uses ⌘⌥⌃⇧ glyphs; Windows uses
 *   Win/Alt/Ctrl/Shift words.
 *
 * This module is display-only: it reads a KeyAction and returns strings.
 * It never mutates the layout, and switching modes never marks it dirty.
 */
import { entryFor } from "./keycodes";
import { holdLabel, tapLabel } from "./labels";
import { applySwap } from "./osSwap";
import type { KeyAction, TapSpec } from "./types";

export type DisplayMode = "advanced" | "mac" | "windows";
export const DISPLAY_MODES: readonly DisplayMode[] = [
  "advanced",
  "mac",
  "windows",
] as const;
export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  advanced: "Advanced",
  mac: "Mac",
  windows: "Windows",
};

/** Resolved keycap text for the current mode. */
export interface KeycapLabels {
  tap: string;
  hold: string | null;
}

/** Modifier constant → friendly glyph/word per friendly mode. */
const MOD_FRIENDLY: Record<string, { mac: string; windows: string }> = {
  MOD_LCTL: { mac: "⌃", windows: "Ctrl" },
  MOD_LSFT: { mac: "⇧", windows: "Shift" },
  MOD_LALT: { mac: "⌥", windows: "Alt" },
  MOD_LGUI: { mac: "⌘", windows: "Win" },
  MOD_RCTL: { mac: "⌃", windows: "Ctrl" },
  MOD_RSFT: { mac: "⇧", windows: "Shift" },
  MOD_RALT: { mac: "⌥", windows: "Alt" },
  MOD_RGUI: { mac: "⌘", windows: "Win" },
};

type Friendly = "mac" | "windows";

/** MOD_LCTL → LCTL (the C-macro wrapper name). */
const modWrapper = (mod: string) => mod.replace(/^MOD_/, "");

/** Friendly glyphs/words for a set of mods (⌘⌥ on mac, Win+Alt on windows). */
function modGlyphs(mods: string[], mode: Friendly): string {
  const parts = mods.map((m) => MOD_FRIENDLY[m]?.[mode] ?? modWrapper(m));
  return parts.join(mode === "mac" ? "" : "+");
}

/** Friendly character/label for a raw code (uses per-OS overrides if present). */
function friendlyChar(code: string, mode: Friendly): string {
  const e = entryFor(code);
  if (e) {
    if (mode === "mac" && e.mac) return e.mac;
    if (mode === "windows" && e.windows) return e.windows;
    return e.label;
  }
  return code.replace(/^KC_/, "");
}

/** A code plus applied mods, friendly: "⌘C" (mac) / "Win+C" (windows). */
function friendlyCombo(spec: TapSpec, mode: Friendly): string {
  const base = friendlyChar(spec.code, mode);
  if (!spec.mods?.length) return base;
  const glyphs = modGlyphs(spec.mods, mode);
  return mode === "mac" ? `${glyphs}${base}` : `${glyphs}+${base}`;
}

/** A code plus applied mods, raw: "LCTL(KC_C)". */
function rawCombo(code: string, mods: string[] | undefined): string {
  if (!mods?.length) return code;
  return mods.reduceRight((acc, m) => `${modWrapper(m)}(${acc})`, code);
}

/** Advanced-mode single token (self-contained; no separate hold strip). */
function advancedTap(a: KeyAction): string {
  switch (a.kind) {
    case "basic":
      return rawCombo(a.code, a.mods);
    case "layerSwitch":
      return `${a.action}(${a.layer})`;
    case "modTap":
      return a.mods.length === 1
        ? `${modWrapper(a.mods[0])}_T(${a.tap})`
        : `MT(${a.mods.join(" | ")}, ${a.tap})`;
    case "layerTap":
      return `LT(${a.layer}, ${a.tap})`;
    case "dualFunc":
      return rawCombo(a.tap.code, a.tap.mods);
    case "qkLock":
      return "QK_LOCK";
    case "special":
    case "rgb":
      return a.code;
    default:
      return tapLabel(a);
  }
}

/** Extra context for label resolution. */
export interface KeycapOptions {
  /**
   * Label the key as the board behaves with Ctrl↔Cmd swapped (an OS-switch
   * key having been pressed). Unlike `mode`, this reflects what the key
   * actually EMITS, not just what it is called — see lib/osSwap.ts.
   */
  swapped?: boolean;
}

/**
 * Resolve the tap/hold keycap labels for a KeyAction in a given display mode.
 * `layerNames` supplies friendly layer titles for layer actions (index = layer).
 */
export function keycapLabels(
  a: KeyAction,
  mode: DisplayMode,
  layerNames: readonly string[] = [],
  opts: KeycapOptions = {},
): KeycapLabels {
  if (opts.swapped) a = applySwap(a);
  // Non-typing / read-only kinds look the same in every mode (badge + raw-ish).
  switch (a.kind) {
    case "none":
      return { tap: "", hold: null };
    case "transparent":
      return { tap: "▽", hold: null };
    case "tapDance":
    case "macro":
    case "rgb":
    case "rgbHsv":
    // OS keys carry their own name in every mode: an osMacro is labelled by
    // its author, and an osMode key names the mode it selects. Neither is a
    // character whose Mac/Windows spelling could differ.
    case "osMacro":
    case "osMode":
      return { tap: tapLabel(a), hold: holdLabel(a) };
  }

  if (mode === "advanced") {
    const hold =
      a.kind === "dualFunc" ? rawCombo(a.hold.code, a.hold.mods) : null;
    return { tap: advancedTap(a), hold };
  }

  const layerName = (n: number) => layerNames[n]?.trim() || `L${n}`;
  switch (a.kind) {
    case "basic":
      return { tap: friendlyCombo(a, mode), hold: null };
    case "layerSwitch":
      return { tap: layerName(a.layer), hold: a.action };
    case "modTap":
      return { tap: friendlyChar(a.tap, mode), hold: modGlyphs(a.mods, mode) };
    case "layerTap":
      return { tap: friendlyChar(a.tap, mode), hold: layerName(a.layer) };
    case "dualFunc":
      return {
        tap: friendlyCombo(a.tap, mode),
        hold: friendlyCombo(a.hold, mode),
      };
    case "qkLock":
      return { tap: friendlyChar("QK_LOCK", mode), hold: null };
    case "special":
      return { tap: friendlyChar(a.code, mode), hold: null };
  }
}
