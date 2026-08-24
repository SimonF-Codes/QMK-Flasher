/**
 * Combos — "several keys pressed together produce one action".
 *
 * Pure transforms over `layout.combos`, plus the well-formedness rules the
 * editor enforces so a combo can never reach the Rust validator broken.
 * Schema v3 requires at least two DISTINCT key indices: one key is not a
 * combo, and a repeated index can never fire (you cannot press one switch
 * twice at once).
 *
 * `settings.combos` is derived here rather than toggled by hand. A stale
 * `true` flag with no combos left enables COMBO_ENABLE without emitting a
 * `combo_t` table and breaks the build — the same class of bug that broke a
 * July build via `settings.tapDance`, which `layoutStore` fixed the same way.
 *
 * Transforms return the input layout unchanged when the edit is a no-op or
 * out of range, matching `led.ts` — `layoutStore` keys off that identity so a
 * rejected edit never marks the layout dirty.
 */
import type { Combo, LayoutFile } from "./types";

/** Schema v3: fewer than this many distinct trigger keys is not a combo. */
export const MIN_COMBO_KEYS = 2;

// ---- Well-formedness ----

/** Why this trigger set is unusable, or null. */
export function comboKeysIssue(keys: readonly number[]): string | null {
  const distinct = new Set(keys);
  if (distinct.size < keys.length) {
    return "A key can only appear once — the same switch cannot be pressed twice at once.";
  }
  if (distinct.size < MIN_COMBO_KEYS) {
    return `Pick at least ${MIN_COMBO_KEYS} keys — one key on its own is just that key.`;
  }
  return null;
}

/**
 * Why this combo cannot be saved, or null. `keyCount` is the layout's keys
 * per layer; indices are in LAYOUT-arg order like everything else.
 */
export function comboIssue(
  combo: Combo,
  layerCount: number,
  keyCount: number,
): string | null {
  if (!combo.name.trim()) return "Give the combo a name.";
  const keys = comboKeysIssue(combo.keys);
  if (keys) return keys;
  if (combo.keys.some((k) => k < 0 || k >= keyCount)) {
    return "A trigger key is outside this keyboard.";
  }
  if (combo.layer < 0 || combo.layer >= layerCount) {
    return "The combo listens on a layer that does not exist.";
  }
  if (combo.action.kind === "none" || combo.action.kind === "transparent") {
    return "Pick what the combo should do.";
  }
  return null;
}

export function isComboValid(
  combo: Combo,
  layerCount: number,
  keyCount: number,
): boolean {
  return comboIssue(combo, layerCount, keyCount) === null;
}

// ---- Building a trigger set ----

/**
 * Add or remove a key from a trigger set. Insertion order is kept rather than
 * sorted: the order carries no meaning to QMK, and re-sorting would rewrite
 * combos seeded from Oryx (whose sets are not in ascending order) the first
 * time anything else on the layout was touched.
 */
export function toggleComboKey(
  keys: readonly number[],
  position: number,
): number[] {
  return keys.includes(position)
    ? keys.filter((k) => k !== position)
    : [...keys, position];
}

/** A blank combo listening on `layer`, ready for the editor. */
export function newCombo(layer = 0, name = ""): Combo {
  return { name, keys: [], layer, action: { kind: "none" } };
}

/** "Combo 3" — the next unused default name. */
export function suggestComboName(layout: LayoutFile): string {
  const taken = new Set(layout.combos.map((c) => c.name));
  for (let n = layout.combos.length + 1; ; n++) {
    const name = `Combo ${n}`;
    if (!taken.has(name)) return name;
  }
}

// ---- settings.combos, derived from content ----

/** Whether the layout has any combo at all. */
export function usesCombos(layout: LayoutFile): boolean {
  return layout.combos.length > 0;
}

/**
 * `settings.combos` recomputed from actual combo content. Identity when the
 * flag is already right, so calling it on every combo edit is free and never
 * spuriously dirties a layout that merely has a stale flag on disk.
 */
export function withDerivedComboFlag(layout: LayoutFile): LayoutFile {
  const combos = usesCombos(layout);
  if (combos === layout.settings.combos) return layout;
  return { ...layout, settings: { ...layout.settings, combos } };
}

// ---- Mutations ----

export function addCombo(layout: LayoutFile, combo: Combo): LayoutFile {
  return withDerivedComboFlag({
    ...layout,
    combos: [...layout.combos, combo],
  });
}

export function updateCombo(
  layout: LayoutFile,
  index: number,
  combo: Combo,
): LayoutFile {
  if (index < 0 || index >= layout.combos.length) return layout;
  return withDerivedComboFlag({
    ...layout,
    combos: layout.combos.map((c, i) => (i === index ? combo : c)),
  });
}

export function deleteCombo(layout: LayoutFile, index: number): LayoutFile {
  if (index < 0 || index >= layout.combos.length) return layout;
  return withDerivedComboFlag({
    ...layout,
    combos: layout.combos.filter((_, i) => i !== index),
  });
}

// ---- Display ----

/** The combos that fire on a given layer, with their indices. */
export function combosOnLayer(
  layout: LayoutFile,
  layer: number,
): { index: number; combo: Combo }[] {
  const found: { index: number; combo: Combo }[] = [];
  layout.combos.forEach((combo, index) => {
    if (combo.layer === layer) found.push({ index, combo });
  });
  return found;
}

/** Every combo a key position takes part in, on any layer. */
export function combosUsingKey(
  layout: LayoutFile,
  position: number,
): { index: number; combo: Combo }[] {
  const found: { index: number; combo: Combo }[] = [];
  layout.combos.forEach((combo, index) => {
    if (combo.keys.includes(position)) found.push({ index, combo });
  });
  return found;
}
