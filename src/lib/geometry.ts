/**
 * Moonlander physical geometry, parsed once from the shared JSON, plus the
 * viewBox math for rendering it as SVG (thumb clusters are rotated), and the
 * matrix → LAYOUT-arg index lookup live key reports resolve through.
 */
import geometryJson from "../../shared/moonlander_geometry.json";
import { GeometryFileSchema } from "./types";

export const GEOMETRY = GeometryFileSchema.parse(geometryJson);

/**
 * `"row,col"` → LAYOUT-arg index, built once from the geometry.
 *
 * Every geometry key carries its `matrix: [row, col]`, so a firmware key report
 * resolves to a board position by lookup — no inference from what the key
 * emits, and no ambiguity when two positions emit the same code.
 */
const MATRIX_INDEX: ReadonlyMap<string, number> = new Map(
  GEOMETRY.keys.map((k, i) => [`${k.matrix[0]},${k.matrix[1]}`, i]),
);

/**
 * The board position a matrix coordinate belongs to, or null if the geometry
 * has no such switch. Null is not an error — the firmware reports the whole
 * matrix and a keyboard can have holes in it.
 */
export function positionForMatrix(row: number, col: number): number | null {
  return MATRIX_INDEX.get(`${row},${col}`) ?? null;
}

/** SVG units per key unit. */
export const U = 56;
/** Gap between keycaps, in SVG units. */
export const KEY_GAP = 4;

export interface KeyRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Full SVG transform for the rotated thumb-cluster keys, or undefined. */
  transform?: string;
}

/**
 * The minimum a key needs for the grid math: a placed, optionally rotated box
 * in key units. Structural on purpose — the AULA F75's geometry is a different
 * shape from the Moonlander's (no matrix, no LED, different provenance) but
 * lays out on the same grid, so it shares this and nothing else.
 */
export interface PlacedKey {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  rx?: number;
  ry?: number;
}

export function keyRect(k: PlacedKey): KeyRect {
  const rect: KeyRect = {
    x: k.x * U + KEY_GAP / 2,
    y: k.y * U + KEY_GAP / 2,
    w: k.w * U - KEY_GAP,
    h: k.h * U - KEY_GAP,
  };
  if (k.r) {
    const cx = (k.rx ?? k.x) * U;
    const cy = (k.ry ?? k.y) * U;
    rect.transform = `rotate(${k.r} ${cx} ${cy})`;
  }
  return rect;
}

function rotate(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number,
): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [
    cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
}

/** The four corners of a key in key units, rotation applied. */
function corners(k: PlacedKey): [number, number][] {
  const pts: [number, number][] = [
    [k.x, k.y],
    [k.x + k.w, k.y],
    [k.x, k.y + k.h],
    [k.x + k.w, k.y + k.h],
  ];
  if (!k.r) return pts;
  const { r, rx, ry, x, y } = k;
  return pts.map(([px, py]) => rotate(px, py, rx ?? x, ry ?? y, r));
}

/**
 * The middle of a keycap in key units, rotation applied.
 *
 * Key units, not SVG units: this is board space, which is the frame anything
 * reasoning about *where a key physically sits* wants — see `mirror.ts`, which
 * pairs keys by reflecting their centers. Rendering scales by `U` afterwards.
 */
export function keyCenter(k: PlacedKey): [number, number] {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  return k.r ? rotate(cx, cy, k.rx ?? k.x, k.ry ?? k.y, k.r) : [cx, cy];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned bounding box of any placed key set, in key units, rotation
 * applied. Takes `PlacedKey` rather than the Moonlander's own key type so the
 * F75 grid — a different geometry on the same layout math — can share it.
 */
export function boundsOf(keys: readonly PlacedKey[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of keys) {
    for (const [px, py] of corners(k)) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned bounding box of the Moonlander's keys, in key units. */
export function boardBounds(): Bounds {
  return boundsOf(GEOMETRY.keys);
}

/**
 * Bounding box of any placed key set (rotation applied), with padding, in
 * SVG units.
 *
 * Scaling the key-unit bounds by `U` is exact, not an approximation: `U` is a
 * uniform scale about the origin, and rotating-then-scaling equals
 * scaling-then-rotating about the scaled center.
 */
export function viewBoxOf(keys: readonly PlacedKey[], pad = 12): string {
  const { minX, minY, maxX, maxY } = boundsOf(keys);
  const x = minX * U;
  const y = minY * U;
  const w = (maxX - minX) * U;
  const h = (maxY - minY) * U;
  return `${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}`;
}

/** Bounding box of the Moonlander's keys (rotation applied), with padding. */
export function viewBox(pad = 12): string {
  return viewBoxOf(GEOMETRY.keys, pad);
}
