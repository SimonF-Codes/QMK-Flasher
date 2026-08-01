/**
 * Live view: mapping a browser keyboard event back onto a board position.
 *
 * By the time the webview sees a keypress, QMK has already translated the
 * physical switch into a HID usage — so `event.code` tells us which key was
 * *emitted*, not which switch was pressed. To light up the diagram we invert
 * the layout: resolve `event.code` to a QMK keycode, then find the positions in
 * a layer that emit it.
 *
 * Consequence worth remembering: keys QMK consumes internally (MO/TO/TG/TT,
 * QK_LOCK, RGB_*) never reach the OS at all, so they can never be matched here.
 * That is a property of where we tap the signal, not a bug — see
 * docs/CONTRACT.md and the live-view plan for the raw-HID alternative.
 */
import { entryFor } from "./keycodes";
import type { KeyAction, Layer } from "./types";

const letters = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => {
    const ch = String.fromCharCode(65 + i);
    return [`Key${ch}`, `KC_${ch}`];
  }),
);

// Digit1..Digit9 then Digit0 — QMK names the number row KC_1..KC_0.
const digits = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => {
    const n = (i + 1) % 10;
    return [`Digit${n}`, `KC_${n}`];
  }),
);

const fkeys = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, `KC_F${i + 1}`]),
);

const numpad = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, `KC_KP_${i}`]),
);

/**
 * `KeyboardEvent.code` → QMK keycode. Names here are the canonical long forms;
 * comparison goes through `canonicalCode` so a layout storing an alias
 * (KC_BSPC vs KC_BACKSPACE) still matches.
 */
export const CODE_TO_QMK: Readonly<Record<string, string>> = {
  ...letters,
  ...digits,
  ...fkeys,
  ...numpad,

  Minus: "KC_MINUS",
  Equal: "KC_EQUAL",
  BracketLeft: "KC_LEFT_BRACKET",
  BracketRight: "KC_RIGHT_BRACKET",
  Backslash: "KC_BACKSLASH",
  Semicolon: "KC_SEMICOLON",
  Quote: "KC_QUOTE",
  Backquote: "KC_GRAVE",
  Comma: "KC_COMMA",
  Period: "KC_DOT",
  Slash: "KC_SLASH",
  IntlBackslash: "KC_NONUS_BACKSLASH",

  Space: "KC_SPACE",
  Tab: "KC_TAB",
  Enter: "KC_ENTER",
  Backspace: "KC_BACKSPACE",
  Escape: "KC_ESCAPE",
  Delete: "KC_DELETE",
  Insert: "KC_INSERT",
  Home: "KC_HOME",
  End: "KC_END",
  PageUp: "KC_PAGE_UP",
  PageDown: "KC_PAGE_DOWN",
  CapsLock: "KC_CAPS_LOCK",

  ArrowUp: "KC_UP",
  ArrowDown: "KC_DOWN",
  ArrowLeft: "KC_LEFT",
  ArrowRight: "KC_RIGHT",

  ShiftLeft: "KC_LEFT_SHIFT",
  ShiftRight: "KC_RIGHT_SHIFT",
  ControlLeft: "KC_LEFT_CTRL",
  ControlRight: "KC_RIGHT_CTRL",
  AltLeft: "KC_LEFT_ALT",
  AltRight: "KC_RIGHT_ALT",
  MetaLeft: "KC_LEFT_GUI",
  MetaRight: "KC_RIGHT_GUI",

  NumpadAdd: "KC_KP_PLUS",
  NumpadSubtract: "KC_KP_MINUS",
  NumpadMultiply: "KC_KP_ASTERISK",
  NumpadDivide: "KC_KP_SLASH",
  NumpadDecimal: "KC_KP_DOT",
  NumpadEnter: "KC_KP_ENTER",
  NumLock: "KC_NUM_LOCK",

  PrintScreen: "KC_PRINT_SCREEN",
  ScrollLock: "KC_SCROLL_LOCK",
  Pause: "KC_PAUSE",
  ContextMenu: "KC_APPLICATION",
};

/**
 * Collapse a keycode to the catalog's canonical `qmk` name so aliases compare
 * equal (KC_BSPC === KC_BACKSPACE). Unknown codes pass through unchanged.
 */
export function canonicalCode(code: string): string {
  return entryFor(code)?.qmk ?? code;
}

/** The QMK keycode a browser `event.code` corresponds to, if we know it. */
export function qmkForEventCode(code: string): string | null {
  const mapped = CODE_TO_QMK[code];
  return mapped ? canonicalCode(mapped) : null;
}

/**
 * The keycode a position emits on a plain tap, or null when nothing reaches the
 * host (layer switches, QK_LOCK, RGB, macros — QMK handles those internally).
 *
 * Distinct from `labels.ts:qmkToken`, which builds a display token complete
 * with LCTL(...) wrappers; here we need the bare code to compare against.
 */
export function emittedTapCode(a: KeyAction): string | null {
  switch (a.kind) {
    case "basic":
      return canonicalCode(a.code);
    case "modTap":
    case "layerTap":
      return canonicalCode(a.tap);
    case "dualFunc":
      return canonicalCode(a.tap.code);
    case "tapDance":
      return a.tap ? canonicalCode(a.tap) : null;
    case "special":
      return canonicalCode(a.code);
    case "none":
    case "transparent":
    case "layerSwitch":
    case "qkLock":
    case "macro":
    case "rgb":
    case "rgbHsv":
      return null;
  }
}

/** Every position in `layer` that emits `qmk` (a layout can repeat a key). */
export function matchPositions(layer: Layer, qmk: string): number[] {
  const want = canonicalCode(qmk);
  const hits: number[] = [];
  layer.keys.forEach((action, i) => {
    if (emittedTapCode(action) === want) hits.push(i);
  });
  return hits;
}

export interface LayerMatch {
  layer: number;
  positions: number[];
}

/**
 * Find where `qmk` lives, preferring `preferred` (the layer on screen) so the
 * view only moves when the current layer genuinely can't produce the key.
 * Returns null when no layer emits it.
 */
export function findLayerWithMatch(
  layers: readonly Layer[],
  qmk: string,
  preferred: number,
): LayerMatch | null {
  const inPreferred = layers[preferred]
    ? matchPositions(layers[preferred], qmk)
    : [];
  if (inPreferred.length > 0) {
    return { layer: preferred, positions: inPreferred };
  }
  for (let i = 0; i < layers.length; i++) {
    if (i === preferred) continue;
    const hits = matchPositions(layers[i], qmk);
    if (hits.length > 0) return { layer: i, positions: hits };
  }
  return null;
}

/**
 * Modifiers held during an event, as display strings. The DOM only exposes
 * boolean flags, so left/right cannot be distinguished here — the log shows
 * "Ctrl", not "LCtrl".
 */
export function heldModifiers(e: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  if (e.metaKey) mods.push("Gui");
  return mods;
}
