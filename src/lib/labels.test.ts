import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/seeded_layout.json";
import { badge, holdLabel, qmkToken, tapLabel, withGlow } from "./labels";
import { LayoutFileSchema } from "./types";

describe("labels", () => {
  it("renders keycap labels per kind", () => {
    expect(tapLabel({ kind: "basic", code: "KC_A" })).toBe("A");
    expect(tapLabel({ kind: "basic", code: "KC_5", mods: ["MOD_LCTL", "MOD_LSFT"] })).toBe("Ctrl+Shift+5");
    expect(tapLabel({ kind: "transparent" })).toBe("▽");
    expect(tapLabel({ kind: "qkLock" })).toBe("🔒");
    expect(tapLabel({ kind: "layerSwitch", action: "MO", layer: 2 })).toBe("MO 2");
  });

  it("renders hold labels for dual-role keys", () => {
    expect(holdLabel({ kind: "modTap", mods: ["MOD_RSFT"], tap: "KC_ENTER" })).toBe("RShift");
    expect(holdLabel({ kind: "layerTap", layer: 3, tap: "KC_SCLN" })).toBe("L3");
    expect(holdLabel({ kind: "basic", code: "KC_A" })).toBeNull();
  });

  it("badges read-only kinds", () => {
    expect(badge({ kind: "tapDance", tap: "KC_BSPC" })).toBe("TD");
    expect(badge({ kind: "macro", label: "push", steps: [] })).toBe("M");
    expect(badge({ kind: "rgbHsv", h: 1, s: 2, v: 3 })).toBe("RGB");
  });

  it("emits QMK tokens", () => {
    expect(qmkToken({ kind: "basic", code: "KC_5", mods: ["MOD_LCTL", "MOD_LSFT"] })).toBe("LCTL(LSFT(KC_5))");
    expect(qmkToken({ kind: "modTap", mods: ["MOD_RSFT"], tap: "KC_ENTER" })).toBe("MT(MOD_RSFT, KC_ENTER)");
    expect(qmkToken({ kind: "layerTap", layer: 1, tap: "KC_SLASH" })).toBe("LT(1, KC_SLASH)");
    expect(qmkToken({ kind: "layerSwitch", action: "TG", layer: 5 })).toBe("TG(5)");
  });

  it("renders every key of the full seeded fixture without throwing", () => {
    const layout = LayoutFileSchema.parse(fixture);
    expect(layout.layers.length).toBeGreaterThanOrEqual(7);
    for (const layer of layout.layers) {
      for (const key of layer.keys) {
        expect(() => {
          const tap = tapLabel(key);
          holdLabel(key);
          badge(key);
          qmkToken(key);
          // every visible kind must produce a non-empty keycap label
          if (key.kind !== "none") expect(tap).not.toBe("");
        }).not.toThrow();
      }
    }
  });

  it("carries glow across replacements", () => {
    const prev = { kind: "basic", code: "KC_A", glow: "#006b62" } as const;
    expect(withGlow({ kind: "qkLock" }, prev)).toEqual({ kind: "qkLock", glow: "#006b62" });
    const explicit = withGlow({ kind: "basic", code: "KC_B", glow: "#ffffff" }, prev);
    expect(explicit.glow).toBe("#ffffff");
  });
});
