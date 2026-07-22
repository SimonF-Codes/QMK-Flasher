import { describe, expect, it } from "vitest";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import {
  remapActionLayer,
  swapKeysInLayer,
  swapLayers,
  transposeIndex,
} from "./layers";
import { LayoutFileSchema, type KeyAction, type LayoutFile } from "./types";

const fixture = () => LayoutFileSchema.parse(fixtureJson);

/** Build a tiny hand-checkable layout (schema length isn't enforced here). */
function tinyLayout(): LayoutFile {
  const mk = (kind: string, extra: object): KeyAction =>
    ({ kind, ...extra }) as KeyAction;
  const layer = (title: string, keys: KeyAction[]) => ({
    title,
    color: "#112233",
    keys,
  });
  return {
    schemaVersion: 2,
    meta: {
      name: "T",
      geometry: "moonlander",
      seededFrom: {
        layoutId: "local",
        revisionHash: "local",
        qmkVersion: "n/a",
        seededAt: "now",
      },
    },
    layers: [
      layer("L0", [
        mk("layerSwitch", { action: "MO", layer: 1 }),
        mk("layerTap", { layer: 3, tap: "KC_A" }),
        mk("basic", { code: "KC_B" }),
      ]),
      layer("L1", [mk("layerSwitch", { action: "TG", layer: 2 })]),
      layer("L2", [mk("layerSwitch", { action: "TO", layer: 1 })]),
      layer("L3", [mk("layerSwitch", { action: "TT", layer: 3 })]),
    ],
    combos: [
      {
        name: "c",
        keys: [0, 1],
        layer: 1,
        action: mk("layerSwitch", { action: "TG", layer: 3 }),
      },
    ],
    settings: {
      autoShift: false,
      capsWord: false,
      tapDance: false,
      combos: true,
      keyLock: true,
      oryx: true,
      rgbMatrixCustom: true,
      layerState8bit: true,
      serialNumber: "s",
      rgbStartupSpeed: 60,
    },
  } as LayoutFile;
}

describe("transposeIndex", () => {
  const t = transposeIndex(1, 3);
  it("swaps the two indices and leaves the rest", () => {
    expect(t(1)).toBe(3);
    expect(t(3)).toBe(1);
    expect(t(0)).toBe(0);
    expect(t(2)).toBe(2);
    expect(t(9)).toBe(9);
  });
});

describe("remapActionLayer", () => {
  const t = transposeIndex(1, 3);
  it("remaps layerSwitch and layerTap layer fields", () => {
    expect(remapActionLayer({ kind: "layerSwitch", action: "MO", layer: 1 }, t)).toEqual(
      { kind: "layerSwitch", action: "MO", layer: 3 },
    );
    expect(remapActionLayer({ kind: "layerTap", layer: 3, tap: "KC_A" }, t)).toEqual(
      { kind: "layerTap", layer: 1, tap: "KC_A" },
    );
  });
  it("leaves actions without a layer reference untouched", () => {
    const basic: KeyAction = { kind: "basic", code: "KC_B" };
    expect(remapActionLayer(basic, t)).toBe(basic);
    const lock: KeyAction = { kind: "qkLock" };
    expect(remapActionLayer(lock, t)).toBe(lock);
  });
});

describe("swapKeysInLayer", () => {
  it("swaps two keys in the given layer and leaves others alone", () => {
    const l = tinyLayout();
    const out = swapKeysInLayer(l, 0, 0, 2);
    expect(out.layers[0].keys[0]).toEqual({ kind: "basic", code: "KC_B" });
    expect(out.layers[0].keys[2]).toEqual({
      kind: "layerSwitch",
      action: "MO",
      layer: 1,
    });
    // Other layers untouched, and the input is not mutated.
    expect(out.layers[1]).toBe(l.layers[1]);
    expect(l.layers[0].keys[0]).toEqual({
      kind: "layerSwitch",
      action: "MO",
      layer: 1,
    });
  });
  it("is a no-op for a === b or out-of-range indices", () => {
    const l = tinyLayout();
    expect(swapKeysInLayer(l, 0, 1, 1)).toBe(l);
    expect(swapKeysInLayer(l, 0, 0, 99)).toBe(l);
    expect(swapKeysInLayer(l, 9, 0, 1)).toBe(l);
  });
});

describe("swapLayers — reference remap (the critical one)", () => {
  it("swaps positions AND remaps every layer-index reference", () => {
    const l = tinyLayout();
    const out = swapLayers(l, 1, 3);

    // Physical positions swapped: content that was L1 is now at index 3,
    // content that was L3 is now at index 1 (titles ride along with content).
    expect(out.layers[1].title).toBe("L3");
    expect(out.layers[3].title).toBe("L1");
    expect(out.layers[0].title).toBe("L0");
    expect(out.layers[2].title).toBe("L2");

    // L0's references: MO(1)->MO(3), LT(3)->LT(1); the basic key is untouched.
    expect(out.layers[0].keys[0]).toEqual({
      kind: "layerSwitch",
      action: "MO",
      layer: 3,
    });
    expect(out.layers[0].keys[1]).toEqual({
      kind: "layerTap",
      layer: 1,
      tap: "KC_A",
    });
    expect(out.layers[0].keys[2]).toEqual({ kind: "basic", code: "KC_B" });

    // L2 (unmoved) referenced layer 1 -> now 3.
    expect(out.layers[2].keys[0]).toEqual({
      kind: "layerSwitch",
      action: "TO",
      layer: 3,
    });

    // Old-L1 content (now at index 3) referenced layer 2 -> stays 2.
    expect(out.layers[3].keys[0]).toEqual({
      kind: "layerSwitch",
      action: "TG",
      layer: 2,
    });

    // Old-L3 content (now at index 1) self-referenced layer 3 -> now 1.
    expect(out.layers[1].keys[0]).toEqual({
      kind: "layerSwitch",
      action: "TT",
      layer: 1,
    });

    // Combo: its `layer` (1->3) and its action target (3->1) both remap.
    expect(out.combos[0].layer).toBe(3);
    expect(out.combos[0].action).toEqual({
      kind: "layerSwitch",
      action: "TG",
      layer: 1,
    });
  });

  it("does not mutate the input layout", () => {
    const l = tinyLayout();
    const snapshot = JSON.stringify(l);
    swapLayers(l, 1, 3);
    expect(JSON.stringify(l)).toBe(snapshot);
  });

  it("is a no-op for a === b or out-of-range indices", () => {
    const l = tinyLayout();
    expect(swapLayers(l, 2, 2)).toBe(l);
    expect(swapLayers(l, 0, 99)).toBe(l);
  });

  it("swapping the same pair twice is the identity (round-trips the fixture)", () => {
    const l = fixture();
    const once = swapLayers(l, 1, 5);
    const twice = swapLayers(once, 1, 5);
    expect(twice).toEqual(l);
    // And the single swap actually changed something (guards a trivial pass).
    expect(once).not.toEqual(l);
  });

  it("remaps combo actions in the real fixture (combos target layer 5)", () => {
    const l = fixture();
    // Fixture combos fire TG(5); swapping 5<->2 must retarget them to 2.
    expect(l.combos.every((c) => (c.action as { layer?: number }).layer === 5)).toBe(
      true,
    );
    const out = swapLayers(l, 2, 5);
    expect(
      out.combos.every((c) => (c.action as { layer?: number }).layer === 2),
    ).toBe(true);
    // Result still validates against the schema (combo.layer bounds etc.).
    expect(() => LayoutFileSchema.parse(out)).not.toThrow();
  });
});
