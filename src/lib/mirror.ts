/**
 * Generating a mirrored layer: reflect every key across the board's vertical
 * centerline, so the hand you still have free reaches the other half's keys.
 *
 * This is a *positional* transform, and that is what makes it a different
 * problem from `layers.ts`. Swapping layers relabels what keys POINT AT (layer
 * indices) and leaves them where they are; mirroring moves keys BETWEEN
 * positions and leaves what they do untouched. The two never share code beyond
 * the immutable-layout house style — `swapKeysInLayer` is one transposition,
 * this is seventy-two of them at once.
 *
 * The pairing is derived from `shared/moonlander_geometry.json` and nothing
 * else. A hand-written index table would be a second, silent source of truth
 * for the board's shape: it cannot be checked against the geometry, it goes
 * stale when a geometry is edited, and it does not survive a second keyboard.
 * Reflecting coordinates has none of those problems and is a one-liner.
 */
import {
  GEOMETRY,
  boardBounds,
  keyCenter,
} from "./geometry";
import { entryFor } from "./keycodes";
import type { KeyAction, Layer, LayoutFile } from "./types";

// ---- The pairing, derived from geometry ----

/**
 * The x the board reflects about: the middle of its bounding box. Halfway
 * between the leftmost and rightmost keycap edges is the only definition that
 * needs no knowledge of which keys belong to which half.
 */
export const MIRROR_AXIS_X = (() => {
  const { minX, maxX } = boardBounds();
  return (minX + maxX) / 2;
})();

/**
 * How far a reflected center may miss its partner and still count as a match,
 * in key units. Generous enough for float noise and a slightly asymmetric
 * geometry, far tighter than the 1u key pitch so it can never grab a neighbour.
 */
const MATCH_TOLERANCE = 0.05;

/**
 * position → the position of its reflection, for every key on the board.
 *
 * Built by reflecting each key's center about `MIRROR_AXIS_X` and taking the
 * nearest key to the result. A key with no partner within tolerance maps to
 * ITSELF — the honest answer for a centerline key or an asymmetric board, and
 * one that keeps the map a valid permutation instead of a broken one.
 *
 * The map is then forced symmetric: if `map[map[i]] !== i` both ends fall back
 * to themselves. Nearest-neighbour matching is not symmetric in general, and
 * an asymmetric map would quietly duplicate one key and lose another. Symmetry
 * is what makes mirroring an involution, which is what makes it undoable.
 */
function buildMirrorMap(): number[] {
  const centers = GEOMETRY.keys.map(keyCenter);
  const map = centers.map(([cx, cy], i) => {
    const targetX = 2 * MIRROR_AXIS_X - cx;
    let best = i;
    let bestDistance = Infinity;
    centers.forEach(([ox, oy], j) => {
      const d = Math.hypot(ox - targetX, oy - cy);
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    });
    return bestDistance <= MATCH_TOLERANCE ? best : i;
  });
  return map.map((j, i) => (map[j] === i ? j : i));
}

export const MIRROR_MAP: readonly number[] = buildMirrorMap();

/** The position `index` reflects to, or `index` itself if it has no partner. */
export function mirrorPosition(index: number): number {
  return MIRROR_MAP[index] ?? index;
}

/**
 * The thumb-cluster positions, found as the group of keys detached from the
 * main block: sort the keys by center y, take the largest vertical gap, and if
 * that gap is wider than a key, everything below it is the thumb cluster.
 *
 * Derived rather than listed for the same reason the pairing is — and it is
 * the actual definition of a thumb cluster on a split board, not a proxy for
 * one. Returns empty for a board with no detached bottom group.
 */
export const THUMB_POSITIONS: ReadonlySet<number> = (() => {
  const ys = GEOMETRY.keys.map((k, i) => ({ i, y: keyCenter(k)[1] }));
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  let splitAt = -1;
  let widest = 0;
  for (let n = 1; n < sorted.length; n++) {
    const gap = sorted[n].y - sorted[n - 1].y;
    if (gap > widest) {
      widest = gap;
      splitAt = n;
    }
  }
  if (widest <= 1 || splitAt < 0) return new Set<number>();
  return new Set(sorted.slice(splitAt).map((k) => k.i));
})();

// ---- What should NOT be mirrored ----

/**
 * Which classes of key stay where they are instead of swapping sides.
 *
 * This, not the coordinate maths, is the design question. A mirror layer
 * exists so ONE hand can type the whole board: you hold your left hand where
 * it always sits, toggle Mirror, and the right half's letters appear under it.
 * Everything you need to keep working — the way out of the layer, your
 * modifiers, your space bar — must therefore stay under the hand that is still
 * on the board. Mirroring those away is the one failure mode that makes the
 * layer unusable rather than merely surprising, so all three default to on.
 */
export interface MirrorOptions {
  /**
   * Layer keys (MO/TG/TO/TT and LT) keep their position. Default on: the key
   * that toggles Mirror off has to be reachable by the hand you are using, and
   * if it swaps sides the layer becomes a trap you need two hands to leave.
   */
  keepLayerKeys: boolean;
  /**
   * The thumb cluster keeps its position. Default on: a thumb cluster is not
   * the other cluster reflected, it is the same three keys under the same
   * thumb, and the hand you are typing with cannot afford to lose its space
   * bar to the hand that is holding a mouse.
   */
  keepThumbs: boolean;
  /**
   * Keys that are nothing but a modifier keep their position. Default on:
   * Shift, Ctrl, Alt and GUI are held while another key is struck, so one hand
   * needs both, and unlike a letter a modifier has no counterpart worth
   * receiving in trade.
   *
   * Mod-taps are deliberately NOT covered — their tap half is a character, and
   * the character is the entire point of a mirror layer.
   */
  keepModifiers: boolean;
}

export const DEFAULT_MIRROR_OPTIONS: MirrorOptions = {
  keepLayerKeys: true,
  keepThumbs: true,
  keepModifiers: true,
};

/** A key whose whole job is being a modifier — per the keycode catalog. */
export function isModifierOnly(action: KeyAction): boolean {
  return (
    action.kind === "basic" &&
    !action.mods?.length &&
    entryFor(action.code)?.category === "modifier"
  );
}

/** A key that switches or taps into a layer (the set `layers.ts` remaps). */
export function isLayerKey(action: KeyAction): boolean {
  return action.kind === "layerSwitch" || action.kind === "layerTap";
}

function stays(
  action: KeyAction,
  position: number,
  options: MirrorOptions,
): boolean {
  if (options.keepLayerKeys && isLayerKey(action)) return true;
  if (options.keepThumbs && THUMB_POSITIONS.has(position)) return true;
  if (options.keepModifiers && isModifierOnly(action)) return true;
  return false;
}

// ---- The transform ----

/**
 * Where each position's content comes from: `perm[i]` is the source position
 * for destination `i`.
 *
 * A position stays put if it — OR its partner — is held back by the options.
 * Closing the held-back set under the pairing is not politeness, it is what
 * keeps this a permutation: pinning one end alone would leave both ends
 * sourcing from the same key and drop the other one on the floor.
 *
 * The result is a product of transpositions and fixed points, i.e. its own
 * inverse, so applying it twice is the identity. That is the round-trip.
 *
 * Returns the identity for a key array that is not this board's size, matching
 * the no-op-on-invalid-input convention in `layers.ts`.
 */
export function mirrorPermutation(
  keys: readonly KeyAction[],
  options: MirrorOptions = DEFAULT_MIRROR_OPTIONS,
): number[] {
  const identity = keys.map((_, i) => i);
  if (keys.length !== GEOMETRY.keys.length) return identity;

  const held = new Set<number>();
  keys.forEach((action, i) => {
    if (stays(action, i, options)) {
      held.add(i);
      held.add(mirrorPosition(i));
    }
  });
  return identity.map((i) => (held.has(i) ? i : mirrorPosition(i)));
}

/** How many positions actually change hands under `options`. */
export function mirroredKeyCount(
  keys: readonly KeyAction[],
  options: MirrorOptions = DEFAULT_MIRROR_OPTIONS,
): number {
  return mirrorPermutation(keys, options).filter((src, i) => src !== i).length;
}

/**
 * The key array reflected across the centerline.
 *
 * Actions move whole and unedited, per-key `glow` included — a mirrored key
 * should light the way the key it came from does, or the LED map stops
 * describing what your fingers find.
 */
export function mirrorKeys(
  keys: readonly KeyAction[],
  options: MirrorOptions = DEFAULT_MIRROR_OPTIONS,
): KeyAction[] {
  return mirrorPermutation(keys, options).map((src) => keys[src]);
}

/**
 * Write the mirror of layer `source` into layer `target`, keeping the target's
 * own title and color. `target === source` mirrors in place.
 *
 * Combos are deliberately untouched. A combo is a chord of physical positions,
 * and the two that reach this layout's Mirror layer are a matched pair — one
 * under each hand — precisely so either hand can fire one. Reflecting their
 * positions would swap the pair for itself and change nothing, or, for an
 * unpaired combo, move a chord out from under the hand that needs it.
 */
export function mirrorLayerInto(
  layout: LayoutFile,
  source: number,
  target: number,
  options: MirrorOptions = DEFAULT_MIRROR_OPTIONS,
): LayoutFile {
  const from = layout.layers[source];
  if (!from) return layout;
  if (target < 0 || target >= layout.layers.length) return layout;

  const keys = mirrorKeys(from.keys, options);
  const layers = layout.layers.map((layer, i) =>
    i === target ? { ...layer, keys } : layer,
  );
  return { ...layout, layers };
}

/**
 * Append the mirror of layer `source` as a new layer and return the layout.
 *
 * Appending, like `addLayer`, so every existing layer reference keeps meaning
 * what it did. Inherits the source layer's color so the pair reads as a pair.
 */
export function appendMirroredLayer(
  layout: LayoutFile,
  source: number,
  options: MirrorOptions = DEFAULT_MIRROR_OPTIONS,
  title?: string,
): LayoutFile {
  const from = layout.layers[source];
  if (!from) return layout;

  const layer: Layer = {
    title: title?.trim() || `${from.title} mirrored`,
    color: from.color,
    keys: mirrorKeys(from.keys, options),
  };
  return { ...layout, layers: [...layout.layers, layer] };
}
