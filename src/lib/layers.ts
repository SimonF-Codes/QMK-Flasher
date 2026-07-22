/**
 * Pure layout transforms for reordering keys and layers.
 *
 * Swapping two keys within a layer is trivial. Swapping two whole layers is
 * the delicate one: every layer-index reference across the ENTIRE layout must
 * be relabeled so the keymap behaves identically after the two layers trade
 * places. Layer references live in:
 *   - keys: layerSwitch (MO/TG/TO/TT) and layerTap (LT) both carry `layer`
 *   - combos: the `layer` the combo is active on, and its `action` (which can
 *     itself be a layerSwitch/layerTap)
 * (DF — default-layer — has no representation in the schema yet; if one is
 * added it must be threaded through `remapActionLayer` too.)
 */
import type { KeyAction, LayoutFile } from "./types";

/**
 * The transposition of two indices: maps a↔b and leaves every other index
 * unchanged. This is exactly the relabeling layer references need when layers
 * a and b swap positions — a reference that pointed at a must now point at b
 * (its content moved there) and vice versa.
 */
export function transposeIndex(a: number, b: number): (x: number) => number {
  return (x) => (x === a ? b : x === b ? a : x);
}

/** A copy of `action` with any layer-index reference passed through `remap`. */
export function remapActionLayer(
  action: KeyAction,
  remap: (x: number) => number,
): KeyAction {
  switch (action.kind) {
    case "layerSwitch": // MO / TG / TO / TT
    case "layerTap": // LT
      return { ...action, layer: remap(action.layer) };
    default:
      return action;
  }
}

/** Swap two keys within a single layer's key array (immutable, no-op if invalid). */
export function swapKeysInLayer(
  layout: LayoutFile,
  layerIndex: number,
  a: number,
  b: number,
): LayoutFile {
  const layer = layout.layers[layerIndex];
  if (!layer || a === b) return layout;
  if (a < 0 || b < 0 || a >= layer.keys.length || b >= layer.keys.length) {
    return layout;
  }
  const keys = layer.keys.slice();
  const tmp = keys[a];
  keys[a] = keys[b];
  keys[b] = tmp;
  const layers = layout.layers.map((l, i) =>
    i === layerIndex ? { ...l, keys } : l,
  );
  return { ...layout, layers };
}

/**
 * Swap two whole layers AND remap every layer-index reference so behavior is
 * preserved. We relabel all references with the a↔b transposition (across ALL
 * layers and combos, not just the two being swapped), then physically swap the
 * two layer slots. The relabel and the slot swap are independent: relabeling
 * fixes what references *point at*, the slot swap moves the content blocks.
 */
export function swapLayers(
  layout: LayoutFile,
  a: number,
  b: number,
): LayoutFile {
  if (a === b) return layout;
  if (
    a < 0 ||
    b < 0 ||
    a >= layout.layers.length ||
    b >= layout.layers.length
  ) {
    return layout;
  }
  const remap = transposeIndex(a, b);

  // Relabel layer references inside every key of every layer.
  const relabeled = layout.layers.map((layer) => ({
    ...layer,
    keys: layer.keys.map((k) => remapActionLayer(k, remap)),
  }));
  // Physically swap the two layer slots.
  const layers = relabeled.slice();
  const tmp = layers[a];
  layers[a] = layers[b];
  layers[b] = tmp;

  // Combos reference a layer to be active on, and fire an action that may
  // itself target a layer — remap both.
  const combos = layout.combos.map((c) => ({
    ...c,
    layer: remap(c.layer),
    action: remapActionLayer(c.action, remap),
  }));

  return { ...layout, layers, combos };
}
