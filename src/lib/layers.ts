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
import type { KeyAction, Layer, LayoutFile } from "./types";

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

// ---- Adding and removing layers ----

/** Layer-tab colors, cycled for new layers so they stay visually distinct. */
const LAYER_COLORS = [
  "#7c3aed",
  "#22c55e",
  "#3b82f6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#a855f7",
  "#f59e0b",
] as const;

/**
 * Does this action point at `layer`? Only layerSwitch/layerTap carry an index,
 * which is the same set `remapActionLayer` handles — keep the two in step.
 */
export function actionTargetsLayer(action: KeyAction, layer: number): boolean {
  return (
    (action.kind === "layerSwitch" || action.kind === "layerTap") &&
    action.layer === layer
  );
}

/** Where a layer is referenced from, for the "this will clear N keys" warning. */
export interface LayerReferences {
  /** `{layer, key}` positions whose action targets the layer. */
  keys: { layer: number; key: number }[];
  /** Indices of combos whose action targets the layer. */
  comboActions: number[];
  /** Indices of combos that are active ON the layer — they cannot survive it. */
  combosOnLayer: number[];
}

/** Total count, for the confirmation copy. */
export function referenceCount(refs: LayerReferences): number {
  return (
    refs.keys.length + refs.comboActions.length + refs.combosOnLayer.length
  );
}

/** Everything that would break if `layer` disappeared. */
export function findLayerReferences(
  layout: LayoutFile,
  layer: number,
): LayerReferences {
  const keys: { layer: number; key: number }[] = [];
  layout.layers.forEach((l, li) => {
    l.keys.forEach((action, ki) => {
      if (actionTargetsLayer(action, layer)) keys.push({ layer: li, key: ki });
    });
  });
  const comboActions: number[] = [];
  const combosOnLayer: number[] = [];
  layout.combos.forEach((c, i) => {
    if (c.layer === layer) combosOnLayer.push(i);
    else if (actionTargetsLayer(c.action, layer)) comboActions.push(i);
  });
  return { keys, comboActions, combosOnLayer };
}

/**
 * Relabeling for a delete: everything above the removed slot shifts down one.
 * References TO the removed layer are cleared before this runs, so the index
 * itself is never passed through here.
 */
export function shiftIndexAfterDelete(deleted: number): (x: number) => number {
  return (x) => (x > deleted ? x - 1 : x);
}

/**
 * Append a layer of transparent keys. Appending is deliberate: a new highest
 * index leaves every existing reference meaning exactly what it did, so nothing
 * needs remapping. Reorder afterwards with `swapLayers` if you want it earlier.
 *
 * Transparent (not `none`) is the QMK-idiomatic default — unassigned positions
 * fall through to the layer below instead of going dead.
 */
export function addLayer(layout: LayoutFile, title?: string): LayoutFile {
  const keyCount = layout.layers[0]?.keys.length ?? 0;
  const index = layout.layers.length;
  const layer: Layer = {
    title: title?.trim() || `Layer ${index}`,
    color: LAYER_COLORS[index % LAYER_COLORS.length],
    keys: Array.from({ length: keyCount }, () => ({
      kind: "transparent" as const,
    })),
  };
  return { ...layout, layers: [...layout.layers, layer] };
}

/**
 * Remove a layer, clearing anything that pointed at it and shifting the
 * references above it down one.
 *
 * Keys targeting the removed layer become `none` rather than dangling — the
 * caller is expected to have confirmed, since this edits keys the user did not
 * touch directly (see `findLayerReferences`). Combos active ON the removed
 * layer are dropped entirely: a combo cannot live on a layer that no longer
 * exists. Refuses to remove the last layer, which the schema forbids.
 */
export function deleteLayer(layout: LayoutFile, index: number): LayoutFile {
  if (index < 0 || index >= layout.layers.length) return layout;
  if (layout.layers.length <= 1) return layout;

  const shift = shiftIndexAfterDelete(index);
  const clearOrShift = (action: KeyAction): KeyAction =>
    actionTargetsLayer(action, index)
      ? { kind: "none", ...(action.glow ? { glow: action.glow } : {}) }
      : remapActionLayer(action, shift);

  const layers = layout.layers
    .map((l) => ({ ...l, keys: l.keys.map(clearOrShift) }))
    .filter((_, i) => i !== index);

  const combos = layout.combos
    .filter((c) => c.layer !== index)
    .map((c) => ({
      ...c,
      layer: shift(c.layer),
      action: clearOrShift(c.action),
    }));

  return { ...layout, layers, combos };
}
