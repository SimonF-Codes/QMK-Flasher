/**
 * The LED half of the layering logic: pure transforms over layer colors and
 * per-key glows, plus the resolution rule the firmware actually applies.
 *
 * What the generated firmware does (src-tauri/src/codegen/ledmap.rs and the
 * `ledmap_section` in keymap_c.rs): `rgb_matrix_indicators_user()` switches on
 * `biton32(layer_state)` — the HIGHEST active layer — and calls
 * `set_layer_color(n)`, which repaints every LED from `ledmap[n][led]`. Layer
 * n's row is its `color` as the base HSV for all keys, with per-key `glow`
 * overriding individual entries.
 *
 * Two consequences that matter when you edit colors:
 *  - Only the topmost active layer lights. Lower layers contribute nothing, so
 *    a layer's row has to be readable on its own.
 *  - A `transparent` key falls through to a lower layer BEHAVIORALLY but is
 *    still lit by the top layer's row, so its light does not tell you what it
 *    will type. `resolveLedColor` reports what the firmware shows;
 *    `fallthroughSource` reports where the behavior actually comes from.
 */
import type { KeyAction, LayoutFile } from "./types";

/** `#rrggbb`, the only color form the schema (and `hex_to_hsv`) accepts. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The firmware reads h=s=v=0 as "LED off" (`set_layer_color` special-cases it),
 * so pure black is unreachable as a color — it is the off switch.
 */
export const LED_OFF = "#000000";

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

/** Normalize to lowercase `#rrggbb` so compares and dirty-tracking are stable. */
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

/**
 * The color LED `keyIndex` shows while `layerIndex` is the active layer —
 * exactly `ledmap.rs`: the key's own `glow`, else the layer's base `color`.
 */
export function resolveLedColor(
  layout: LayoutFile,
  layerIndex: number,
  keyIndex: number,
): string | null {
  const layer = layout.layers[layerIndex];
  const key = layer?.keys[keyIndex];
  if (!layer || !key) return null;
  return key.glow ?? layer.color;
}

/** `resolveLedColor` for every key of a layer, in LAYOUT-arg order. */
export function resolveLayerLeds(
  layout: LayoutFile,
  layerIndex: number,
): string[] {
  const layer = layout.layers[layerIndex];
  if (!layer) return [];
  return layer.keys.map((k) => k.glow ?? layer.color);
}

/**
 * Which layer a key's behavior really comes from, following `transparent`
 * fall-through down toward layer 0 the way QMK resolves a keypress. Returns
 * `layerIndex` itself for an opaque key, and null if every layer below is
 * transparent too (QMK then emits nothing).
 *
 * This is the mismatch the LED map cannot express: the key lights with
 * `layerIndex`'s color but behaves like the layer this returns.
 */
export function fallthroughSource(
  layout: LayoutFile,
  layerIndex: number,
  keyIndex: number,
): number | null {
  for (let i = layerIndex; i >= 0; i--) {
    const key = layout.layers[i]?.keys[keyIndex];
    if (!key) return null;
    if (key.kind !== "transparent") return i;
  }
  return null;
}

/** How many keys on a layer carry a glow override. */
export function glowCount(layout: LayoutFile, layerIndex: number): number {
  const layer = layout.layers[layerIndex];
  if (!layer) return 0;
  return layer.keys.reduce((n, k) => (k.glow ? n + 1 : n), 0);
}

/** A copy of `layout` with one layer's base color replaced (no-op if invalid). */
export function setLayerColor(
  layout: LayoutFile,
  layerIndex: number,
  color: string,
): LayoutFile {
  const hex = normalizeHex(color);
  const layer = layout.layers[layerIndex];
  if (hex === null || !layer || layer.color === hex) return layout;
  const layers = layout.layers.map((l, i) =>
    i === layerIndex ? { ...l, color: hex } : l,
  );
  return { ...layout, layers };
}

/**
 * A copy of `action` with its glow set, or removed when `glow` is null.
 * Removing drops the key back to its layer's base color.
 */
export function withKeyGlow(action: KeyAction, glow: string | null): KeyAction {
  if (glow === null) {
    const { glow: _dropped, ...rest } = action;
    return rest as KeyAction;
  }
  const hex = normalizeHex(glow);
  return hex === null ? action : ({ ...action, glow: hex } as KeyAction);
}

/** A copy of `layout` with one key's glow set, or cleared when `glow` is null. */
export function setKeyGlow(
  layout: LayoutFile,
  layerIndex: number,
  keyIndex: number,
  glow: string | null,
): LayoutFile {
  const layer = layout.layers[layerIndex];
  const key = layer?.keys[keyIndex];
  if (!layer || !key) return layout;
  const hex = glow === null ? null : normalizeHex(glow);
  if (glow !== null && hex === null) return layout;
  if ((key.glow ?? null) === hex) return layout;
  const keys = layer.keys.map((k, i) =>
    i === keyIndex ? withKeyGlow(k, hex) : k,
  );
  const layers = layout.layers.map((l, i) =>
    i === layerIndex ? { ...l, keys } : l,
  );
  return { ...layout, layers };
}

/** Drop every glow override on a layer, leaving it a flat base color. */
export function clearLayerGlows(
  layout: LayoutFile,
  layerIndex: number,
): LayoutFile {
  const layer = layout.layers[layerIndex];
  if (!layer || !layer.keys.some((k) => k.glow)) return layout;
  const keys = layer.keys.map((k) => (k.glow ? withKeyGlow(k, null) : k));
  const layers = layout.layers.map((l, i) =>
    i === layerIndex ? { ...l, keys } : l,
  );
  return { ...layout, layers };
}

/** The layer a key navigates to, or null if it is not a layer key. */
export function targetLayer(action: KeyAction): number | null {
  return action.kind === "layerSwitch" || action.kind === "layerTap"
    ? action.layer
    : null;
}

/**
 * Glow every layer key (MO/TG/TO/TT/LT) on `layerIndex` with the color of the
 * layer it navigates to, so the board shows you where each key leads before
 * you press it. Keys pointing at a layer that no longer exists are skipped.
 */
export function glowLayerKeysByTarget(
  layout: LayoutFile,
  layerIndex: number,
): LayoutFile {
  const layer = layout.layers[layerIndex];
  if (!layer) return layout;
  let changed = false;
  const keys = layer.keys.map((k) => {
    const target = targetLayer(k);
    const color = target === null ? null : layout.layers[target]?.color;
    if (!color || k.glow === color) return k;
    changed = true;
    return withKeyGlow(k, color);
  });
  if (!changed) return layout;
  const layers = layout.layers.map((l, i) =>
    i === layerIndex ? { ...l, keys } : l,
  );
  return { ...layout, layers };
}
