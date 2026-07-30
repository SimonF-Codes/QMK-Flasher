/**
 * OS mode: the board-level Ctrl↔Cmd swap (QMK "magic" CG_* keycodes).
 *
 * Unlike `display.ts`'s Mac/Windows modes — which only change what a key is
 * *called* — this models what the board actually *emits* once the swap is on.
 * The two are bridged in the UI: the swap preview only unlocks when the layout
 * actually contains one of the OS-switch keys below, because without one there
 * is no way to reach the swapped state on the keyboard.
 *
 * Firmware reference (C:\Users\fridl\qmk_firmware):
 *   - keycodes.h:1022-1024        CG_SWAP / CG_NORM / CG_TOGG
 *   - process_magic.c:92,138,155  set true / set false / negate
 *   - keycode_config.c:126        mod_config(), mirrored by swapMods() below
 *   - generic_features.mk:17      MAGIC_ENABLE ?= yes  (on by default)
 */
import type { KeyAction, LayoutFile } from "./types";

/**
 * Which OS this layout is written for, i.e. what the board does with the swap
 * OFF. Evidence for "windows" in the Arrows Together layout:
 *   - `MT(MOD_LALT, KC_APPLICATION)` on the base layer — KC_APPLICATION is the
 *     Windows menu key and has no Mac equivalent.
 *   - Three Ctrl mod-taps in prime positions (grave, backslash, escape);
 *     exactly one bare KC_LEFT_GUI.
 * Flip this to "mac" for a Mac-authored layout — it is the single place the
 * assumption lives, and it drives every OS name shown in the UI. The OS-named
 * `label`s of CG_NORM/CG_SWAP in shared/keycodes.json are coupled to it.
 */
export const HOME_OS: FriendlyOs = "windows";

export type FriendlyOs = "mac" | "windows";

/** Keycodes that change the board's OS mode. */
export const OS_SWITCH_CODES = ["CG_TOGG", "CG_SWAP", "CG_NORM"] as const;
export type OsSwitchCode = (typeof OS_SWITCH_CODES)[number];

/** The OS in effect for a given swap state, given how the layout was authored. */
export function osForSwapState(swapped: boolean): FriendlyOs {
  const other: FriendlyOs = HOME_OS === "windows" ? "mac" : "windows";
  return swapped ? other : HOME_OS;
}

/** What a given OS-switch keycode does to the swap state. */
export function swapStateAfter(code: string, current: boolean): boolean {
  switch (code) {
    case "CG_SWAP":
      return true;
    case "CG_NORM":
      return false;
    case "CG_TOGG":
      return !current;
    default:
      return current;
  }
}

export function isOsSwitchCode(code: string): code is OsSwitchCode {
  return (OS_SWITCH_CODES as readonly string[]).includes(code);
}

// ---- The swap itself ----

const MOD_LCTL = 0b0001;
const MOD_LGUI = 0b1000;

/** MOD_* token → 5-bit packed value, matching QMK's modifiers.h. */
const MOD_BITS: Record<string, number> = {
  MOD_LCTL: 0b00001,
  MOD_LSFT: 0b00010,
  MOD_LALT: 0b00100,
  MOD_LGUI: 0b01000,
  MOD_RCTL: 0b10001,
  MOD_RSFT: 0b10010,
  MOD_RALT: 0b10100,
  MOD_RGUI: 0b11000,
};
const BITS_MOD: Record<number, string> = Object.fromEntries(
  Object.entries(MOD_BITS).map(([k, v]) => [v, k]),
);

/**
 * Mirror of QMK `mod_config()` for the Ctrl↔GUI case (keycode_config.c:147).
 *
 * The XOR guard matters and is easy to get wrong: if BOTH Ctrl and GUI are
 * present, or neither, nothing is swapped — only a lone Ctrl or lone GUI
 * flips. Handedness is preserved because the right-hand bit (0b10000) is
 * untouched by the `MOD_LCTL | MOD_LGUI` xor.
 */
export function swapMods(mods: readonly string[]): string[] {
  return mods.map((m) => {
    const bits = MOD_BITS[m];
    if (bits === undefined) return m;
    const hand = bits & 0b10000;
    const low = bits & 0b01111;
    const hasCtl = low === MOD_LCTL;
    const hasGui = low === MOD_LGUI;
    // Exactly one of the two — the `^` in QMK's guard.
    if (!(hasCtl !== hasGui)) return m;
    return BITS_MOD[hand | (low ^ (MOD_LCTL | MOD_LGUI))] ?? m;
  });
}

/** Bare modifier keycodes that trade places under the swap. */
const CODE_SWAP: Record<string, string> = {
  KC_LEFT_CTRL: "KC_LEFT_GUI",
  KC_LEFT_GUI: "KC_LEFT_CTRL",
  KC_RIGHT_CTRL: "KC_RIGHT_GUI",
  KC_RIGHT_GUI: "KC_RIGHT_CTRL",
  KC_LCTL: "KC_LGUI",
  KC_LGUI: "KC_LCTL",
  KC_RCTL: "KC_RGUI",
  KC_RGUI: "KC_RCTL",
};

/** A bare keycode as it behaves with the swap on. */
export function swapCode(code: string): string {
  return CODE_SWAP[code] ?? code;
}

/**
 * A KeyAction as the board actually behaves with Ctrl↔Cmd swapped.
 *
 * Deliberately a no-op for `dualFunc` and `macro`: those compile to
 * `register_code16()` / `SEND_STRING()` inside `process_record_user`, which
 * bypass `mod_config()` entirely — so the firmware does NOT swap them, and
 * neither do we. Diverging here would make the preview lie. `tapDance` is
 * likewise untouched (same `register_code16` path, see codegen/keymap_c.rs).
 */
export function applySwap(a: KeyAction): KeyAction {
  switch (a.kind) {
    case "basic":
      return {
        ...a,
        code: swapCode(a.code),
        ...(a.mods ? { mods: swapMods(a.mods) } : {}),
      };
    case "modTap":
      return { ...a, mods: swapMods(a.mods) };
    default:
      return a;
  }
}

// ---- Finding the switch keys in a layout ----

export interface OsSwitchKey {
  layer: number;
  /** Index into the layer's keys, in LAYOUT-arg order. */
  index: number;
  code: OsSwitchCode;
}

/** Every OS-switch key in the layout, in layer then key order. */
export function findOsSwitchKeys(layout: LayoutFile | null): OsSwitchKey[] {
  if (!layout) return [];
  const found: OsSwitchKey[] = [];
  layout.layers.forEach((layer, li) =>
    layer.keys.forEach((k, ki) => {
      if (k.kind === "special" && isOsSwitchCode(k.code)) {
        found.push({ layer: li, index: ki, code: k.code });
      }
    }),
  );
  return found;
}

/** Whether the board can reach the swapped state at all. */
export function hasOsSwitchKey(layout: LayoutFile | null): boolean {
  return findOsSwitchKeys(layout).length > 0;
}
