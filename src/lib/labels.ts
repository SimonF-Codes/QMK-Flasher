/**
 * KeyAction → display strings (keycap labels, badges, emitted QMK tokens).
 */
import { labelFor } from "./keycodes";
import type { KeyAction } from "./types";

export const ALL_MODS = [
  "MOD_LCTL",
  "MOD_LSFT",
  "MOD_LALT",
  "MOD_LGUI",
  "MOD_RCTL",
  "MOD_RSFT",
  "MOD_RALT",
  "MOD_RGUI",
] as const;

const MOD_SHORT: Record<string, string> = {
  MOD_LCTL: "Ctrl",
  MOD_LSFT: "Shift",
  MOD_LALT: "Alt",
  MOD_LGUI: "Gui",
  MOD_RCTL: "RCtrl",
  MOD_RSFT: "RShift",
  MOD_RALT: "RAlt",
  MOD_RGUI: "RGui",
};

/** MOD_LCTL → LCTL (the C-macro wrapper name). */
const modWrapper = (mod: string) => mod.replace(/^MOD_/, "");

export function modsShort(mods: string[] | undefined): string {
  if (!mods || mods.length === 0) return "";
  return mods.map((m) => MOD_SHORT[m] ?? m).join("+");
}

/** Main (centered) keycap label. */
export function tapLabel(a: KeyAction): string {
  switch (a.kind) {
    case "none":
      return "";
    case "transparent":
      return "▽";
    case "basic": {
      const base = labelFor(a.code);
      return a.mods?.length ? `${modsShort(a.mods)}+${base}` : base;
    }
    case "layerSwitch":
      return `${a.action} ${a.layer}`;
    case "modTap":
    case "layerTap":
      return labelFor(a.tap);
    case "dualFunc":
      return labelFor(a.tap.code);
    case "qkLock":
      return "🔒";
    case "special":
    case "rgb":
      return labelFor(a.code);
    case "tapDance":
      return a.tap ? labelFor(a.tap) : "TD";
    case "macro":
      return a.label || "Macro";
    case "rgbHsv":
      return "HSV";
  }
}

/** Secondary label rendered in the bottom strip (hold behavior). */
export function holdLabel(a: KeyAction): string | null {
  switch (a.kind) {
    case "modTap":
      return modsShort(a.mods);
    case "layerTap":
      return `L${a.layer}`;
    case "dualFunc":
      return a.hold.mods?.length
        ? `${modsShort(a.hold.mods)}+${labelFor(a.hold.code)}`
        : labelFor(a.hold.code);
    case "tapDance":
      return a.hold ? labelFor(a.hold) : null;
    default:
      return null;
  }
}

/** Small corner badge for kinds that need calling out. */
export function badge(a: KeyAction): string | null {
  switch (a.kind) {
    case "tapDance":
      return "TD";
    case "macro":
      return "M";
    case "rgb":
    case "rgbHsv":
      return "RGB";
    case "layerSwitch":
      return `L${a.layer}`;
    case "dualFunc":
      return "DF";
    default:
      return null;
  }
}

/** Kinds the v1 UI cannot edit in place (only replace wholesale). */
export function isReadOnly(a: KeyAction): boolean {
  return a.kind === "tapDance" || a.kind === "macro" || a.kind === "rgbHsv";
}

/** The QMK token this action will emit (best effort for display). */
export function qmkToken(a: KeyAction): string {
  switch (a.kind) {
    case "none":
      return "KC_NO";
    case "transparent":
      return "KC_TRANSPARENT";
    case "basic": {
      if (!a.mods?.length) return a.code;
      return a.mods.reduceRight((acc, m) => `${modWrapper(m)}(${acc})`, a.code);
    }
    case "layerSwitch":
      return `${a.action}(${a.layer})`;
    case "modTap":
      return `MT(${a.mods.join(" | ")}, ${a.tap})`;
    case "layerTap":
      return `LT(${a.layer}, ${a.tap})`;
    case "dualFunc":
      return `DUAL_FUNC (tap ${a.tap.code} / hold ${a.hold.code})`;
    case "qkLock":
      return "QK_LOCK";
    case "special":
    case "rgb":
      return a.code;
    case "tapDance":
      return "TD(…)";
    case "macro":
      return "ST_MACRO(…)";
    case "rgbHsv":
      return `HSV_${a.h}_${a.s}_${a.v}`;
  }
}

/** Carry the previous key's glow over to a replacement action. */
export function withGlow(next: KeyAction, prev: KeyAction): KeyAction {
  if (prev.glow && !next.glow) return { ...next, glow: prev.glow };
  return next;
}
