/**
 * What the *browser* can tell us about a keypress: which HID usage arrived, and
 * therefore what character the OS received.
 *
 * This used to be the whole live view, and it had to invert the layout to guess
 * which switch produced a code. It no longer does: the firmware reports the
 * switch and the active layer directly (`src-tauri/src/keyreport`, forwarded as
 * `key-report`/`layer-report`), so position and layer are looked up exactly in
 * `geometry.ts:positionForMatrix`. The inference — `findLayerWithMatch` and
 * friends — is gone with it.
 *
 * What survives is the half the firmware cannot answer. The board says which
 * switch closed; only the OS knows what came out the other end, which is what
 * the scratchpad is for and what makes a layout-vs-board mismatch visible in
 * the log.
 */
import { fallthroughSource } from "./led";
import { entryFor } from "./keycodes";
import type { KeyAction, LayoutFile } from "./types";

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
    // Both send whole sequences (or nothing) through process_record_user,
    // so no single code identifies them on the wire.
    case "osMacro":
    case "osMode":
      return null;
  }
}

/**
 * The action a switch really performs when `layer` is on top, following
 * `transparent` fall-through the way QMK does. Null when nothing is assigned
 * anywhere below either.
 *
 * The board reports only its topmost layer, which is the same thing the LED
 * map resolves against — hence the shared `fallthroughSource`.
 */
export function resolvedAction(
  layout: LayoutFile,
  layer: number,
  position: number,
): KeyAction | null {
  const source = fallthroughSource(layout, layer, position);
  if (source === null) return null;
  return layout.layers[source]?.keys[position] ?? null;
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
