import { describe, expect, it } from "vitest";
import {
  canonicalCode,
  emittedTapCode,
  findLayerWithMatch,
  heldModifiers,
  matchPositions,
  qmkForEventCode,
} from "./liveKeys";
import type { KeyAction, Layer } from "./types";

/** A layer of `none` keys with the given positions overridden. */
function layerWith(
  overrides: Record<number, KeyAction>,
  title = "L",
): Layer {
  const keys: KeyAction[] = Array.from({ length: 72 }, () => ({
    kind: "none" as const,
  }));
  for (const [i, a] of Object.entries(overrides)) keys[Number(i)] = a;
  return { title, color: "#112233", keys };
}

describe("qmkForEventCode", () => {
  it("maps letters, digits and function keys", () => {
    expect(qmkForEventCode("KeyA")).toBe("KC_A");
    expect(qmkForEventCode("KeyZ")).toBe("KC_Z");
    expect(qmkForEventCode("Digit1")).toBe("KC_1");
    expect(qmkForEventCode("Digit0")).toBe("KC_0");
    expect(qmkForEventCode("F13")).toBe("KC_F13");
  });

  it("maps punctuation and named keys", () => {
    expect(qmkForEventCode("Semicolon")).toBe(canonicalCode("KC_SEMICOLON"));
    expect(qmkForEventCode("Quote")).toBe(canonicalCode("KC_QUOTE"));
    expect(qmkForEventCode("Space")).toBe(canonicalCode("KC_SPACE"));
    expect(qmkForEventCode("ArrowUp")).toBe(canonicalCode("KC_UP"));
  });

  it("returns null for codes we don't map", () => {
    expect(qmkForEventCode("Fn")).toBeNull();
    expect(qmkForEventCode("")).toBeNull();
  });
});

describe("canonicalCode", () => {
  it("collapses aliases to one name so comparisons work", () => {
    // KC_BSPC / KC_BACKSPACE are the same key under different names; whichever
    // the catalog calls canonical, both must land on it.
    expect(canonicalCode("KC_BSPC")).toBe(canonicalCode("KC_BACKSPACE"));
  });

  it("passes unknown codes through untouched", () => {
    expect(canonicalCode("NOT_A_KEYCODE")).toBe("NOT_A_KEYCODE");
  });
});

describe("emittedTapCode", () => {
  it("reads the emitted code out of tap-carrying kinds", () => {
    expect(emittedTapCode({ kind: "basic", code: "KC_A" })).toBe("KC_A");
    expect(
      emittedTapCode({ kind: "modTap", mods: ["MOD_LCTL"], tap: "KC_B" }),
    ).toBe("KC_B");
    expect(emittedTapCode({ kind: "layerTap", layer: 2, tap: "KC_C" })).toBe(
      "KC_C",
    );
    expect(
      emittedTapCode({
        kind: "dualFunc",
        tap: { code: "KC_D" },
        hold: { code: "KC_E" },
      }),
    ).toBe("KC_D");
    expect(emittedTapCode({ kind: "tapDance", tap: "KC_F" })).toBe("KC_F");
  });

  it("returns null for kinds the firmware consumes internally", () => {
    // These never reach the OS, which is why they can't light up in live view.
    expect(emittedTapCode({ kind: "layerSwitch", action: "MO", layer: 2 })).toBeNull();
    expect(emittedTapCode({ kind: "qkLock" })).toBeNull();
    expect(emittedTapCode({ kind: "rgb", code: "RGB_TOG" })).toBeNull();
    expect(emittedTapCode({ kind: "rgbHsv", h: 1, s: 2, v: 3 })).toBeNull();
    expect(emittedTapCode({ kind: "macro", label: "m", steps: [] })).toBeNull();
    expect(emittedTapCode({ kind: "none" })).toBeNull();
    expect(emittedTapCode({ kind: "transparent" })).toBeNull();
  });

  it("has no tap code for a tap-dance without a tap half", () => {
    expect(emittedTapCode({ kind: "tapDance", hold: "KC_G" })).toBeNull();
  });
});

describe("matchPositions", () => {
  it("finds every position emitting the code, not just the first", () => {
    const layer = layerWith({
      3: { kind: "basic", code: "KC_TAB" },
      40: { kind: "basic", code: "KC_TAB" },
      7: { kind: "basic", code: "KC_A" },
    });
    expect(matchPositions(layer, "KC_TAB")).toEqual([3, 40]);
    expect(matchPositions(layer, "KC_A")).toEqual([7]);
  });

  it("matches through aliases", () => {
    const layer = layerWith({ 5: { kind: "basic", code: "KC_BSPC" } });
    expect(matchPositions(layer, "KC_BACKSPACE")).toEqual([5]);
  });

  it("returns empty when nothing emits it", () => {
    expect(matchPositions(layerWith({}), "KC_A")).toEqual([]);
  });
});

describe("findLayerWithMatch", () => {
  const layers = [
    layerWith({ 1: { kind: "basic", code: "KC_A" } }, "base"),
    layerWith({ 2: { kind: "basic", code: "KC_B" } }, "one"),
    layerWith({ 3: { kind: "basic", code: "KC_A" } }, "two"),
  ];

  it("prefers the layer already on screen when it matches", () => {
    // KC_A exists on layers 0 and 2 — viewing 2 must not yank us to 0.
    expect(findLayerWithMatch(layers, "KC_A", 2)).toEqual({
      layer: 2,
      positions: [3],
    });
    expect(findLayerWithMatch(layers, "KC_A", 0)).toEqual({
      layer: 0,
      positions: [1],
    });
  });

  it("falls back to the first other layer that matches", () => {
    expect(findLayerWithMatch(layers, "KC_B", 0)).toEqual({
      layer: 1,
      positions: [2],
    });
  });

  it("returns null when no layer emits the code", () => {
    expect(findLayerWithMatch(layers, "KC_Z", 0)).toBeNull();
  });

  it("tolerates an out-of-range preferred layer", () => {
    expect(findLayerWithMatch(layers, "KC_B", 99)).toEqual({
      layer: 1,
      positions: [2],
    });
  });
});

describe("heldModifiers", () => {
  it("lists held modifiers in a stable order", () => {
    expect(
      heldModifiers({
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: true,
      }),
    ).toEqual(["Ctrl", "Shift", "Gui"]);
  });

  it("is empty when nothing is held", () => {
    expect(
      heldModifiers({
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toEqual([]);
  });
});
