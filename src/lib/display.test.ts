import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/seeded_layout.json";
import { keycapLabels } from "./display";
import { LayoutFileSchema, type KeyAction } from "./types";

const LAYERS = ["Base", "Symbols", "Nav"];

describe("keycap display modes", () => {
  it("basic key: raw code in advanced, character in friendly modes", () => {
    const a: KeyAction = { kind: "basic", code: "KC_A" };
    expect(keycapLabels(a, "advanced")).toEqual({ tap: "KC_A", hold: null });
    expect(keycapLabels(a, "mac")).toEqual({ tap: "A", hold: null });
    expect(keycapLabels(a, "windows")).toEqual({ tap: "A", hold: null });
  });

  it("mods-applied basic: wrapper token vs glyph+char", () => {
    const a: KeyAction = { kind: "basic", code: "KC_C", mods: ["MOD_LCTL"] };
    expect(keycapLabels(a, "advanced").tap).toBe("LCTL(KC_C)");
    expect(keycapLabels(a, "mac").tap).toBe("⌃C");
    expect(keycapLabels(a, "windows").tap).toBe("Ctrl+C");
  });

  it("mod-tap LGUI_T(KC_A): token in advanced, tap char + mod glyph in friendly", () => {
    const a: KeyAction = { kind: "modTap", mods: ["MOD_LGUI"], tap: "KC_A" };
    expect(keycapLabels(a, "advanced")).toEqual({
      tap: "LGUI_T(KC_A)",
      hold: null,
    });
    expect(keycapLabels(a, "mac")).toEqual({ tap: "A", hold: "⌘" });
    expect(keycapLabels(a, "windows")).toEqual({ tap: "A", hold: "Win" });
  });

  it("multi-mod mod-tap falls back to MT(...) in advanced", () => {
    const a: KeyAction = {
      kind: "modTap",
      mods: ["MOD_LCTL", "MOD_LSFT"],
      tap: "KC_ENTER",
    };
    expect(keycapLabels(a, "advanced").tap).toBe("MT(MOD_LCTL | MOD_LSFT, KC_ENTER)");
    expect(keycapLabels(a, "mac")).toEqual({ tap: "⏎", hold: "⌃⇧" });
    expect(keycapLabels(a, "windows")).toEqual({
      tap: "Enter",
      hold: "Ctrl+Shift",
    });
  });

  it("layer-tap: LT token vs tap char + layer name", () => {
    const a: KeyAction = { kind: "layerTap", layer: 2, tap: "KC_SPACE" };
    expect(keycapLabels(a, "advanced").tap).toBe("LT(2, KC_SPACE)");
    expect(keycapLabels(a, "mac", LAYERS)).toEqual({ tap: "␣", hold: "Nav" });
    expect(keycapLabels(a, "windows", LAYERS)).toEqual({
      tap: "Space",
      hold: "Nav",
    });
    // Falls back to L<n> when no name is available.
    expect(keycapLabels(a, "mac").hold).toBe("L2");
  });

  it("layer switch: MO(n) token vs layer name + action", () => {
    const a: KeyAction = { kind: "layerSwitch", action: "MO", layer: 1 };
    expect(keycapLabels(a, "advanced").tap).toBe("MO(1)");
    expect(keycapLabels(a, "mac", LAYERS)).toEqual({
      tap: "Symbols",
      hold: "MO",
    });
  });

  it("qkLock and specials: token vs friendly label", () => {
    expect(keycapLabels({ kind: "qkLock" }, "advanced").tap).toBe("QK_LOCK");
    expect(keycapLabels({ kind: "qkLock" }, "mac").tap).toBe("Lock");
    const boot: KeyAction = { kind: "special", code: "QK_BOOT" };
    expect(keycapLabels(boot, "advanced").tap).toBe("QK_BOOT");
    expect(keycapLabels(boot, "windows").tap).toBe("Boot");
  });

  it("modifier as a plain key: per-OS glyph/word", () => {
    const a: KeyAction = { kind: "basic", code: "KC_LEFT_GUI" };
    expect(keycapLabels(a, "advanced").tap).toBe("KC_LEFT_GUI");
    expect(keycapLabels(a, "mac").tap).toBe("⌘");
    expect(keycapLabels(a, "windows").tap).toBe("Win");
  });

  it("transparent and none look the same in every mode", () => {
    for (const m of ["advanced", "mac", "windows"] as const) {
      expect(keycapLabels({ kind: "transparent" }, m)).toEqual({
        tap: "▽",
        hold: null,
      });
      expect(keycapLabels({ kind: "none" }, m)).toEqual({ tap: "", hold: null });
    }
  });

  it("read-only kinds (tap-dance) render identically across modes", () => {
    const a: KeyAction = { kind: "tapDance", tap: "KC_BSPC", doubleTap: "KC_A" };
    const adv = keycapLabels(a, "advanced");
    expect(keycapLabels(a, "mac")).toEqual(adv);
    expect(keycapLabels(a, "windows")).toEqual(adv);
  });

  it("renders every key of the full fixture in all modes without throwing", () => {
    const layout = LayoutFileSchema.parse(fixture);
    const names = layout.layers.map((l) => l.title);
    for (const mode of ["advanced", "mac", "windows"] as const) {
      for (const layer of layout.layers) {
        for (const key of layer.keys) {
          expect(() => keycapLabels(key, mode, names)).not.toThrow();
        }
      }
    }
  });
});

// The `swapped` option is the FUNCTIONAL axis: it changes what the label says
// the key EMITS, whereas `mode` only changes what it is CALLED. See osSwap.ts.
describe("keycap labels with the OS swap on", () => {
  it("relabels a GUI-modified basic as Ctrl", () => {
    const a: KeyAction = { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] };
    expect(keycapLabels(a, "windows", [], { swapped: false }).tap).toBe(
      "Win+C",
    );
    expect(keycapLabels(a, "windows", [], { swapped: true }).tap).toBe("Ctrl+C");
    expect(keycapLabels(a, "mac", [], { swapped: true }).tap).toBe("⌃C");
  });

  it("relabels a Ctrl mod-tap's hold as Cmd", () => {
    const a: KeyAction = {
      kind: "modTap",
      mods: ["MOD_LCTL"],
      tap: "KC_GRAVE",
    };
    expect(keycapLabels(a, "mac", [], { swapped: false }).hold).toBe("⌃");
    expect(keycapLabels(a, "mac", [], { swapped: true }).hold).toBe("⌘");
  });

  it("relabels a bare GUI key, including in advanced mode", () => {
    const a: KeyAction = { kind: "basic", code: "KC_LEFT_GUI" };
    expect(keycapLabels(a, "advanced", [], { swapped: true }).tap).toBe(
      "KC_LEFT_CTRL",
    );
  });

  it("leaves dualFunc alone — the firmware does not swap it", () => {
    const a: KeyAction = {
      kind: "dualFunc",
      tap: { code: "KC_C", mods: ["MOD_LGUI"] },
      hold: { code: "KC_V", mods: ["MOD_LGUI"] },
    };
    expect(keycapLabels(a, "windows", [], { swapped: true })).toEqual(
      keycapLabels(a, "windows", [], { swapped: false }),
    );
  });

  it("defaults to unswapped when the option is omitted", () => {
    const a: KeyAction = { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] };
    expect(keycapLabels(a, "windows")).toEqual(
      keycapLabels(a, "windows", [], { swapped: false }),
    );
  });

  it("renders the full fixture swapped without throwing", () => {
    const layout = LayoutFileSchema.parse(fixture);
    const names = layout.layers.map((l) => l.title);
    for (const mode of ["advanced", "mac", "windows"] as const) {
      for (const layer of layout.layers) {
        for (const key of layer.keys) {
          expect(() =>
            keycapLabels(key, mode, names, { swapped: true }),
          ).not.toThrow();
        }
      }
    }
  });
});
