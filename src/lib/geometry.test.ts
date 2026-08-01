import { describe, expect, it } from "vitest";
import { GEOMETRY, positionForMatrix } from "./geometry";

describe("positionForMatrix", () => {
  it("round-trips every key in the geometry", () => {
    // The whole point of the map: a firmware report is resolved by lookup, not
    // by guessing which position emits the code that arrived. If one switch is
    // missing here, that key silently never lights up.
    GEOMETRY.keys.forEach((k, i) => {
      expect(positionForMatrix(k.matrix[0], k.matrix[1])).toBe(i);
    });
  });

  it("covers all 72 positions with no two sharing a matrix cell", () => {
    const cells = new Set(GEOMETRY.keys.map((k) => `${k.matrix[0]},${k.matrix[1]}`));
    expect(cells.size).toBe(GEOMETRY.keys.length);
    expect(GEOMETRY.keys).toHaveLength(72);
  });

  it("is null for a cell the board has no switch in", () => {
    // Real: the Moonlander matrix is 12×6 but only 72 of those cells exist.
    expect(positionForMatrix(200, 200)).toBeNull();
    expect(positionForMatrix(-1, 0)).toBeNull();
  });
});
