import { describe, expect, it } from "vitest";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import {
  addLayer,
  deleteLayer,
  findLayerReferences,
  referenceCount,
  remapActionLayer,
  shiftIndexAfterDelete,
  swapKeysInLayer,
  swapLayers,
  transposeIndex,
} from "./layers";
import {
  LayoutFileSchema,
  SCHEMA_VERSION,
  type KeyAction,
  type LayoutFile,
} from "./types";

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
    schemaVersion: SCHEMA_VERSION,
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
      osDetection: false,
      osDefault: "windows" as const,
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

describe("shiftIndexAfterDelete", () => {
  it("pulls everything above the hole down one and leaves the rest", () => {
    const s = shiftIndexAfterDelete(2);
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(1);
    expect(s(3)).toBe(2);
    expect(s(7)).toBe(6);
  });
});

describe("findLayerReferences", () => {
  it("finds keys, combo actions and combos living on the layer", () => {
    const l = tinyLayout();
    // Layer 3 is targeted by L0's LT(3), L3's own TT(3) and the combo's TG(3).
    const refs = findLayerReferences(l, 3);
    expect(refs.keys).toEqual([
      { layer: 0, key: 1 },
      { layer: 3, key: 0 },
    ]);
    expect(refs.comboActions).toEqual([0]);
    expect(refs.combosOnLayer).toEqual([]);
    expect(referenceCount(refs)).toBe(3);
  });

  it("counts a combo that lives on the layer, and doesn't double-count it", () => {
    const refs = findLayerReferences(tinyLayout(), 1);
    // The combo sits on layer 1; its action targets 3, so it's on-layer only.
    expect(refs.combosOnLayer).toEqual([0]);
    expect(refs.comboActions).toEqual([]);
    // MO(1) on L0 and TO(1) on L2.
    expect(refs.keys).toEqual([
      { layer: 0, key: 0 },
      { layer: 2, key: 0 },
    ]);
  });

  it("reports nothing for an unreferenced layer", () => {
    expect(referenceCount(findLayerReferences(tinyLayout(), 0))).toBe(0);
  });
});

describe("addLayer", () => {
  it("appends a transparent layer without disturbing existing references", () => {
    const l = tinyLayout();
    const out = addLayer(l);
    expect(out.layers).toHaveLength(5);
    const added = out.layers[4];
    expect(added.title).toBe("Layer 4");
    expect(added.keys).toHaveLength(l.layers[0].keys.length);
    expect(added.keys.every((k) => k.kind === "transparent")).toBe(true);
    // Appending can't change what any existing reference means.
    expect(out.layers.slice(0, 4)).toEqual(l.layers);
    expect(out.combos).toEqual(l.combos);
  });

  it("honors a supplied title and falls back when it's blank", () => {
    expect(addLayer(tinyLayout(), "Symbols").layers[4].title).toBe("Symbols");
    expect(addLayer(tinyLayout(), "   ").layers[4].title).toBe("Layer 4");
  });
});

describe("deleteLayer", () => {
  it("clears references to the removed layer and shifts the ones above it", () => {
    const out = deleteLayer(tinyLayout(), 1);

    expect(out.layers.map((l) => l.title)).toEqual(["L0", "L2", "L3"]);
    // MO(1) pointed at the deleted layer -> cleared.
    expect(out.layers[0].keys[0]).toEqual({ kind: "none" });
    // LT(3) survives but 3 is now 2.
    expect(out.layers[0].keys[1]).toMatchObject({ kind: "layerTap", layer: 2 });
    // Untouched key stays untouched.
    expect(out.layers[0].keys[2]).toEqual({ kind: "basic", code: "KC_B" });
    // TO(1) in the old L2 also pointed at the deleted layer.
    expect(out.layers[1].keys[0]).toEqual({ kind: "none" });
    // TT(3) in the old L3 shifts down to 2.
    expect(out.layers[2].keys[0]).toMatchObject({ kind: "layerSwitch", layer: 2 });
  });

  it("drops combos that lived on the removed layer", () => {
    // The tiny layout's only combo is active on layer 1 — it cannot outlive it.
    expect(deleteLayer(tinyLayout(), 1).combos).toEqual([]);
  });

  it("clears a combo action that pointed at the removed layer", () => {
    const out = deleteLayer(tinyLayout(), 3);
    expect(out.combos).toHaveLength(1);
    expect(out.combos[0].layer).toBe(1); // below the hole, unchanged
    expect(out.combos[0].action).toEqual({ kind: "none" });
  });

  it("refuses to remove the last layer, which the schema forbids", () => {
    const one = { ...tinyLayout(), layers: [tinyLayout().layers[0]], combos: [] };
    expect(deleteLayer(one, 0)).toBe(one);
  });

  it("is a no-op for an out-of-range index", () => {
    const l = tinyLayout();
    expect(deleteLayer(l, -1)).toBe(l);
    expect(deleteLayer(l, 99)).toBe(l);
  });

  it("leaves a schema-valid layout on the real fixture", () => {
    const l = fixture();
    const out = deleteLayer(l, l.layers.length - 1);
    expect(out.layers).toHaveLength(l.layers.length - 1);
    // The point of the exercise: no dangling layer index anywhere.
    expect(() => LayoutFileSchema.parse(out)).not.toThrow();
  });

  it("add then delete returns to the original layout", () => {
    const l = tinyLayout();
    expect(deleteLayer(addLayer(l), 4)).toEqual(l);
  });
});
