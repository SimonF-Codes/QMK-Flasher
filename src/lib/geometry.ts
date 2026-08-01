/**
 * Moonlander physical geometry, parsed once from the shared JSON, plus the
 * viewBox math for rendering it as SVG (thumb clusters are rotated), and the
 * matrix → LAYOUT-arg index lookup live key reports resolve through.
 */
import geometryJson from "../../shared/moonlander_geometry.json";
import { GeometryFileSchema, type GeometryKey } from "./types";

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

export function keyRect(k: GeometryKey): KeyRect {
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

/** Bounding box of all keys (rotation applied), with padding. */
export function viewBox(pad = 12): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of GEOMETRY.keys) {
    const x = k.x * U;
    const y = k.y * U;
    const w = k.w * U;
    const h = k.h * U;
    const corners: [number, number][] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
    for (let [px, py] of corners) {
      if (k.r) {
        [px, py] = rotate(px, py, (k.rx ?? k.x) * U, (k.ry ?? k.y) * U, k.r);
      }
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  return `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
}
