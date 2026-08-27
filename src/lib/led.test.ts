import { describe, expect, it } from "vitest";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import {
  LED_OFF,
  clearLayerGlows,
  fallthroughSource,
  glowCount,
  glowLayerKeysByTarget,
  isHexColor,
  normalizeHex,
  resolveLayerLeds,
  resolveLedColor,
  setKeyGlow,
  setLayerColor,
  targetLayer,
  withKeyGlow,
} from "./led";
import {
  LayoutFileSchema,
  SCHEMA_VERSION,
  type KeyAction,
  type LayoutFile,
} from "./types";

const fixture = () => LayoutFileSchema.parse(fixtureJson);

/**
 * A tiny hand-checkable layout. Key 0 is a layer key on every layer, key 1 is
 * transparent on the upper layers so fall-through is testable, key 2 carries a
 * pre-existing glow.
 */
function tinyLayout(): LayoutFile {
  const mk = (kind: string, extra: object = {}): KeyAction =>
    ({ kind, ...extra }) as KeyAction;
  const layer = (title: string, color: string, keys: KeyAction[]) => ({
    title,
    color,
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
      layer("L0", "#ff0000", [
        mk("layerSwitch", { action: "MO", layer: 1 }),
        mk("basic", { code: "KC_A" }),
        mk("basic", { code: "KC_B", glow: "#abcdef" }),
      ]),
      layer("L1", "#00ff00", [
        mk("layerTap", { layer: 2, tap: "KC_C" }),
        mk("transparent"),
        mk("basic", { code: "KC_D" }),
      ]),
      layer("L2", "#0000ff", [
        mk("layerSwitch", { action: "TO", layer: 0 }),
        mk("transparent"),
        mk("transparent"),
      ]),
    ],
    combos: [],
    settings: {
      autoShift: false,
      capsWord: false,
      tapDance: false,
      combos: false,
      keyLock: true,
      oryx: true,
      rgbMatrixCustom: true,
      layerState8bit: true,
      serialNumber: "x",
      osDetection: false,
      osDefault: "windows" as const,
    },
  };
}

describe("hex handling", () => {
  it("accepts #rrggbb only", () => {
    expect(isHexColor("#00ff00")).toBe(true);
    expect(isHexColor("#0F0")).toBe(false);
    expect(isHexColor("00ff00")).toBe(false);
    expect(isHexColor("#00ff0")).toBe(false);
    expect(isHexColor("rgb(0,255,0)")).toBe(false);
  });

  it("normalizes case and whitespace, rejects the rest", () => {
    expect(normalizeHex("  #AABBCC ")).toBe("#aabbcc");
    expect(normalizeHex("#zzzzzz")).toBeNull();
  });
});

describe("resolveLedColor", () => {
  it("prefers the key glow over the layer base", () => {
    const l = tinyLayout();
    expect(resolveLedColor(l, 0, 1)).toBe("#ff0000"); // no glow → base
    expect(resolveLedColor(l, 0, 2)).toBe("#abcdef"); // glow wins
    expect(resolveLedColor(l, 1, 1)).toBe("#00ff00");
  });

  it("returns null out of range instead of throwing", () => {
    const l = tinyLayout();
    expect(resolveLedColor(l, 9, 0)).toBeNull();
    expect(resolveLedColor(l, 0, 99)).toBeNull();
  });

  it("resolveLayerLeds matches key-by-key resolution", () => {
    const l = tinyLayout();
    expect(resolveLayerLeds(l, 0)).toEqual(["#ff0000", "#ff0000", "#abcdef"]);
    expect(resolveLayerLeds(l, 9)).toEqual([]);
  });

  it("resolves every key of the real seeded fixture", () => {
    const l = fixture();
    l.layers.forEach((layer, li) => {
      const leds = resolveLayerLeds(l, li);
      expect(leds).toHaveLength(layer.keys.length);
      expect(leds.every(isHexColor)).toBe(true);
    });
  });
});

describe("fallthroughSource", () => {
  it("returns the layer itself for an opaque key", () => {
    expect(fallthroughSource(tinyLayout(), 1, 2)).toBe(1);
  });

  it("walks down past transparent keys", () => {
    const l = tinyLayout();
    // key 1: transparent on L2 and L1, basic on L0.
    expect(fallthroughSource(l, 2, 1)).toBe(0);
    // key 2: transparent on L2, basic on L1 — stops at the first opaque one.
    expect(fallthroughSource(l, 2, 2)).toBe(1);
  });

  it("is null when the key is transparent all the way down", () => {
    const l = tinyLayout();
    l.layers[0].keys[1] = { kind: "transparent" };
    expect(fallthroughSource(l, 2, 1)).toBeNull();
  });
});

describe("setLayerColor", () => {
  it("replaces one layer's base and leaves the others alone", () => {
    const before = tinyLayout();
    const after = setLayerColor(before, 1, "#123456");
    expect(after.layers[1].color).toBe("#123456");
    expect(after.layers[0]).toBe(before.layers[0]);
    expect(after.layers[2]).toBe(before.layers[2]);
    expect(before.layers[1].color).toBe("#00ff00"); // input untouched
  });

  it("normalizes the hex it stores", () => {
    expect(setLayerColor(tinyLayout(), 0, "#AABBCC").layers[0].color).toBe(
      "#aabbcc",
    );
  });

  it("is a no-op for a bad color or a missing layer", () => {
    const before = tinyLayout();
    expect(setLayerColor(before, 0, "nope")).toBe(before);
    expect(setLayerColor(before, 7, "#123456")).toBe(before);
  });

  it("accepts LED_OFF, which the firmware reads as off", () => {
    expect(setLayerColor(tinyLayout(), 0, LED_OFF).layers[0].color).toBe(
      "#000000",
    );
  });
});

describe("setKeyGlow", () => {
  it("sets a glow without disturbing the action", () => {
    const after = setKeyGlow(tinyLayout(), 0, 1, "#ff00ff");
    expect(after.layers[0].keys[1]).toEqual({
      kind: "basic",
      code: "KC_A",
      glow: "#ff00ff",
    });
  });

  it("clearing removes the key entirely rather than storing undefined", () => {
    const after = setKeyGlow(tinyLayout(), 0, 2, null);
    expect(after.layers[0].keys[2]).toEqual({ kind: "basic", code: "KC_B" });
    expect("glow" in after.layers[0].keys[2]).toBe(false);
    // Round-trips through the schema without an explicit-undefined artifact.
    expect(JSON.stringify(after.layers[0].keys[2])).not.toContain("glow");
  });

  it("falls back to the layer base once cleared", () => {
    const after = setKeyGlow(tinyLayout(), 0, 2, null);
    expect(resolveLedColor(after, 0, 2)).toBe("#ff0000");
  });

  it("is a no-op for a bad color or out-of-range index", () => {
    const before = tinyLayout();
    expect(setKeyGlow(before, 0, 0, "#gggggg")).toBe(before);
    expect(setKeyGlow(before, 0, 99, "#ff00ff")).toBe(before);
    expect(setKeyGlow(before, 9, 0, "#ff00ff")).toBe(before);
  });

  it("withKeyGlow preserves every other field", () => {
    const action: KeyAction = {
      kind: "layerTap",
      layer: 2,
      tap: "KC_C",
      glow: "#111111",
    };
    expect(withKeyGlow(action, "#222222")).toEqual({ ...action, glow: "#222222" });
    expect(withKeyGlow(action, null)).toEqual({
      kind: "layerTap",
      layer: 2,
      tap: "KC_C",
    });
  });
});

describe("clearLayerGlows", () => {
  it("flattens a layer to its base color", () => {
    const l = setKeyGlow(tinyLayout(), 0, 1, "#ff00ff");
    expect(glowCount(l, 0)).toBe(2);
    const flat = clearLayerGlows(l, 0);
    expect(glowCount(flat, 0)).toBe(0);
    expect(resolveLayerLeds(flat, 0)).toEqual(["#ff0000", "#ff0000", "#ff0000"]);
  });

  it("only touches the named layer", () => {
    const l = setKeyGlow(tinyLayout(), 1, 0, "#ff00ff");
    const flat = clearLayerGlows(l, 0);
    expect(flat.layers[1].keys[0].glow).toBe("#ff00ff");
  });

  it("is a no-op for a missing layer", () => {
    const before = tinyLayout();
    expect(clearLayerGlows(before, 9)).toBe(before);
  });
});

describe("glowLayerKeysByTarget", () => {
  it("reads the target layer off layer keys only", () => {
    expect(targetLayer({ kind: "layerSwitch", action: "MO", layer: 3 })).toBe(3);
    expect(targetLayer({ kind: "layerTap", layer: 1, tap: "KC_A" })).toBe(1);
    expect(targetLayer({ kind: "basic", code: "KC_A" })).toBeNull();
    expect(targetLayer({ kind: "transparent" })).toBeNull();
  });

  it("paints each layer key with the color of where it leads", () => {
    const after = glowLayerKeysByTarget(tinyLayout(), 0);
    // key 0 is MO(1) and L1 is green.
    expect(after.layers[0].keys[0].glow).toBe("#00ff00");
    // Non-layer keys are untouched, including the pre-existing glow.
    expect(after.layers[0].keys[1].glow).toBeUndefined();
    expect(after.layers[0].keys[2].glow).toBe("#abcdef");
  });

  it("follows the target's current color, not a snapshot", () => {
    const recolored = setLayerColor(tinyLayout(), 1, "#654321");
    expect(glowLayerKeysByTarget(recolored, 0).layers[0].keys[0].glow).toBe(
      "#654321",
    );
  });

  it("skips keys pointing at a layer that does not exist", () => {
    const l = tinyLayout();
    l.layers[0].keys[0] = { kind: "layerSwitch", action: "MO", layer: 9 };
    const after = glowLayerKeysByTarget(l, 0);
    expect(after.layers[0].keys[0].glow).toBeUndefined();
  });

  it("is a no-op for a missing layer", () => {
    const before = tinyLayout();
    expect(glowLayerKeysByTarget(before, 9)).toBe(before);
  });
});

/**
 * Every transform returns the INPUT object when it would change nothing. The
 * store leans on that identity to decide whether an edit dirties the layout,
 * so a redundant click must not light up the unsaved indicator.
 */
describe("no-change edits preserve identity", () => {
  it("setLayerColor with the color already in place", () => {
    const before = tinyLayout();
    expect(setLayerColor(before, 0, "#ff0000")).toBe(before);
    expect(setLayerColor(before, 0, "#FF0000")).toBe(before); // case-insensitive
  });

  it("setKeyGlow with the glow already in place", () => {
    const before = tinyLayout();
    expect(setKeyGlow(before, 0, 2, "#abcdef")).toBe(before);
  });

  it("setKeyGlow clearing a key that has no glow", () => {
    const before = tinyLayout();
    expect(setKeyGlow(before, 0, 1, null)).toBe(before);
  });

  it("clearLayerGlows on an already-flat layer", () => {
    const flat = clearLayerGlows(tinyLayout(), 0);
    expect(clearLayerGlows(flat, 0)).toBe(flat);
  });

  it("glowLayerKeysByTarget is idempotent", () => {
    const once = glowLayerKeysByTarget(tinyLayout(), 0);
    expect(glowLayerKeysByTarget(once, 0)).toBe(once);
  });
});
