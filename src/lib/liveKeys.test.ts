import { describe, expect, it } from "vitest";
import {
  canonicalCode,
  emittedTapCode,
  heldModifiers,
  qmkForEventCode,
  resolvedAction,
} from "./liveKeys";
import type { KeyAction, Layer, LayoutFile } from "./types";

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

describe("resolvedAction", () => {
  function makeLayout(layers: Layer[]): LayoutFile {
    return {
      schemaVersion: 2,
      meta: {
        name: "test",
        geometry: "moonlander",
        seededFrom: {
          layoutId: "x",
          revisionHash: "y",
          qmkVersion: "z",
          seededAt: "2026-01-01T00:00:00Z",
        },
      },
      layers,
      combos: [],
      settings: {
        autoShift: false,
        capsWord: false,
        tapDance: false,
        combos: false,
        keyLock: true,
        oryx: false,
        rgbMatrixCustom: false,
        layerState8bit: false,
        serialNumber: "",
        rgbStartupSpeed: 0,
      },
    };
  }

  const layout = makeLayout([
    layerWith({ 0: { kind: "basic", code: "KC_A" }, 1: { kind: "qkLock" } }, "base"),
    layerWith({ 0: { kind: "transparent" }, 1: { kind: "basic", code: "KC_Z" } }, "up"),
  ]);

  it("takes the key on the reported layer when it has one", () => {
    expect(resolvedAction(layout, 1, 1)).toEqual({ kind: "basic", code: "KC_Z" });
  });

  it("follows transparent down, the way the board does", () => {
    // The switch is on layer 1 but behaves as layer 0's A — the log has to say
    // what the key does, not what its own cell contains.
    expect(resolvedAction(layout, 1, 0)).toEqual({ kind: "basic", code: "KC_A" });
  });

  it("is null when nothing is assigned all the way down", () => {
    expect(resolvedAction(layout, 1, 40)).toEqual({ kind: "none" });
    expect(resolvedAction(layout, 99, 0)).toBeNull();
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
