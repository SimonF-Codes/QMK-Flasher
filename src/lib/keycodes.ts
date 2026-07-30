/**
 * The keycode catalog (shared/keycodes.json) — single source of truth for
 * UI labels ↔ QMK codes. Worker C is the sole editor of the JSON (additive).
 */
import { z } from "zod";
import raw from "../../shared/keycodes.json";
import { KeycodeEntrySchema, type KeycodeEntry } from "./types";

export const KEYCODES: KeycodeEntry[] = z.array(KeycodeEntrySchema).parse(raw);

/** qmk name AND every alias → entry. */
export const KEYCODE_BY_NAME: ReadonlyMap<string, KeycodeEntry> = new Map(
  KEYCODES.flatMap((e) => [e.qmk, ...e.aliases].map((n) => [n, e] as const)),
);

/** Accordion sections in display order. `special` renders as "System". */
export const CATEGORY_ORDER: { id: string; title: string }[] = [
  { id: "letter", title: "Letters" },
  { id: "digit", title: "Digits" },
  { id: "fkey", title: "Function keys" },
  { id: "punct", title: "Punctuation" },
  { id: "shifted", title: "Shifted symbols" },
  { id: "nav", title: "Navigation" },
  { id: "editing", title: "Editing" },
  { id: "keypad", title: "Keypad" },
  { id: "modifier", title: "Modifiers" },
  { id: "media", title: "Media" },
  { id: "mouse", title: "Mouse" },
  { id: "system", title: "System" },
  { id: "special", title: "System (QMK)" },
  { id: "osmode", title: "OS mode" },
  { id: "rgb", title: "RGB" },
];

export function entryFor(code: string): KeycodeEntry | undefined {
  return KEYCODE_BY_NAME.get(code);
}

/** Short keycap label for a raw QMK code; falls back to a trimmed code. */
export function labelFor(code: string): string {
  return entryFor(code)?.label ?? code.replace(/^KC_/, "");
}

export function longLabelFor(code: string): string {
  return entryFor(code)?.longLabel ?? code;
}

export function searchKeycodes(query: string): KeycodeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return KEYCODES.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.longLabel.toLowerCase().includes(q) ||
      e.qmk.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q)),
  );
}
