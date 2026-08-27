/**
 * AULA F75 presentation helpers — read-only.
 *
 * The F75 has exactly two layers (base and FN1) and a slot holds one HID
 * page + usage: no tap/hold, tap dance, combos, macros or Key Lock. Nothing
 * here talks to a device.
 */
import type { F75Geometry, F75Key, F75PackedOutput } from "./types";

/** The board's two layers. There is no third — this is firmware, not config. */
export type F75LayerId = "base" | "fn1";

export const F75_LAYERS: ReadonlyArray<{ id: F75LayerId; title: string }> = [
  { id: "base", title: "Base" },
  { id: "fn1", title: "FN1" },
];

/**
 * KB.ini category numbers, which are AULA's own — NOT HID usage pages and NOT
 * the keybind blob's page byte. Only the first two have a known HID meaning.
 */
export const F75_CATEGORY = {
  keyboard: 0x07,
  consumer: 0x02,
  vendor: 0x08,
  unclassified: 0x00,
} as const;

/** What an unbound slot shows. */
export const UNBOUND = "—";

/**
 * An all-zero output is "no binding" — the keybind protocol spells a disabled
 * slot as page 0x00, usage 0x00. Without this it renders as the literal string
 * "0x00000000", which reads like a real vendor code rather than an empty key.
 */
export function isUnbound(out: F75PackedOutput): boolean {
  return out.category === 0 && out.usage === 0;
}

/**
 * A short human label for a packed output.
 *
 * Only categories with a known meaning are named. Everything else is shown as
 * its raw packed value rather than being guessed at — an invented name would
 * be indistinguishable from a real one in the UI.
 */
export function describePacked(out: F75PackedOutput): string {
  if (isUnbound(out)) return UNBOUND;
  if (out.category === F75_CATEGORY.keyboard) {
    return hidKeyboardName(out.usage) ?? `HID 0x${out.usage.toString(16)}`;
  }
  if (out.category === F75_CATEGORY.consumer) {
    return consumerName(out.usage) ?? `Media 0x${out.usage.toString(16)}`;
  }
  return out.packed;
}

/**
 * HID keyboard usages, Usage Page 0x07 (HID Usage Tables 1.4, §10). Only the
 * ranges the F75's factory tables actually use are listed; anything else falls
 * back to the raw usage rather than being mislabelled.
 */
function hidKeyboardName(usage: number): string | null {
  if (usage >= 0x04 && usage <= 0x1d) {
    return String.fromCharCode("A".charCodeAt(0) + (usage - 0x04));
  }
  if (usage >= 0x1e && usage <= 0x26) {
    return String(usage - 0x1d); // 1–9
  }
  const named: Record<number, string> = {
    0x27: "0",
    0x28: "Enter",
    0x29: "Esc",
    0x2a: "Bksp",
    0x2b: "Tab",
    0x2c: "Space",
  };
  return named[usage] ?? null;
}

/** HID Consumer page (0x0C) usages seen in the F75's factory FN1 table. */
function consumerName(usage: number): string | null {
  const named: Record<number, string> = {
    0xb5: "Next",
    0xb6: "Prev",
    0xcd: "Play",
    0xe2: "Mute",
    0xe9: "Vol +",
    0xea: "Vol −",
    0x18a: "Mail",
    0x223: "Home",
  };
  return named[usage] ?? null;
}

/**
 * What to print on a keycap.
 *
 * Base layer shows the OEM's own key name, which is the honest thing to show:
 * the factory base binding is given as a Windows VK code, and mapping VK →
 * HID usage is only needed to *write* a blob. Inventing that mapping now, for
 * display, would risk showing a binding the board does not actually have.
 */
export function f75KeyLabel(key: F75Key, layer: F75LayerId): string {
  if (layer === "base") return key.label;
  return key.fn1 ? describePacked(key.fn1) : UNBOUND;
}

/** Keys the firmware pins, which no tool including AULA's own can remap. */
export function isLocked(geometry: F75Geometry, slot: number): boolean {
  return geometry.lockedSlots.includes(slot);
}

/** Board size in key units, for callers that need it outside the SVG. */
export function boardSize(geometry: F75Geometry): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const k of geometry.keys) {
    if (!k.positioned || k.x === undefined) continue;
    w = Math.max(w, k.x + (k.w ?? 1));
    h = Math.max(h, (k.y ?? 0) + (k.h ?? 1));
  }
  return { w, h };
}
