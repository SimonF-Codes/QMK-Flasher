import { describe, expect, it } from "vitest";
import {
  HOME_OS,
  applySwap,
  authoredOs,
  canSwitchOs,
  findOsModeKeys,
  findOsSwitchKeys,
  hasOsSwitchKey,
  isOsSwitchCode,
  osForSwapState,
  swapCode,
  swapMods,
  swapStateAfter,
} from "./osSwap";
import { LayoutFileSchema, type KeyAction, type LayoutFile } from "./types";
import seeded from "../../shared/fixtures/seeded_layout.json";

describe("swapMods — parity with QMK mod_config (keycode_config.c:147)", () => {
  it("swaps a lone left Ctrl and a lone left GUI", () => {
    expect(swapMods(["MOD_LCTL"])).toEqual(["MOD_LGUI"]);
    expect(swapMods(["MOD_LGUI"])).toEqual(["MOD_LCTL"]);
  });

  it("swaps a lone right Ctrl and GUI, preserving handedness", () => {
    expect(swapMods(["MOD_RCTL"])).toEqual(["MOD_RGUI"]);
    expect(swapMods(["MOD_RGUI"])).toEqual(["MOD_RCTL"]);
  });

  it("leaves unrelated mods alone", () => {
    expect(swapMods(["MOD_LSFT", "MOD_LALT"])).toEqual([
      "MOD_LSFT",
      "MOD_LALT",
    ]);
  });

  it("swaps each independently when Ctrl and GUI are both present", () => {
    // QMK's guard is per-keycode; each MOD_* token here is its own 5-bit
    // value, so each flips on its own and the pair trades places.
    expect(swapMods(["MOD_LCTL", "MOD_LGUI"])).toEqual([
      "MOD_LGUI",
      "MOD_LCTL",
    ]);
  });

  it("is an involution — swapping twice returns the original", () => {
    for (const m of [
      ["MOD_LCTL"],
      ["MOD_RGUI"],
      ["MOD_LSFT", "MOD_LCTL"],
      ["MOD_LALT", "MOD_RCTL", "MOD_LSFT"],
    ]) {
      expect(swapMods(swapMods(m))).toEqual(m);
    }
  });

  it("passes through unknown tokens untouched", () => {
    expect(swapMods(["MOD_WAT"])).toEqual(["MOD_WAT"]);
  });
});

describe("swapCode", () => {
  it("trades bare Ctrl and GUI keycodes, long and short spellings", () => {
    expect(swapCode("KC_LEFT_GUI")).toBe("KC_LEFT_CTRL");
    expect(swapCode("KC_LEFT_CTRL")).toBe("KC_LEFT_GUI");
    expect(swapCode("KC_RGUI")).toBe("KC_RCTL");
  });

  it("leaves everything else alone", () => {
    expect(swapCode("KC_A")).toBe("KC_A");
    expect(swapCode("KC_LEFT_ALT")).toBe("KC_LEFT_ALT");
  });
});

describe("applySwap — only the kinds the firmware actually swaps", () => {
  it("swaps a basic key's mods", () => {
    const a: KeyAction = { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] };
    expect(applySwap(a)).toEqual({
      kind: "basic",
      code: "KC_C",
      mods: ["MOD_LCTL"],
    });
  });

  it("swaps a bare modifier basic key", () => {
    const a: KeyAction = { kind: "basic", code: "KC_LEFT_GUI" };
    expect(applySwap(a)).toEqual({ kind: "basic", code: "KC_LEFT_CTRL" });
  });

  it("swaps modTap mods", () => {
    const a: KeyAction = {
      kind: "modTap",
      mods: ["MOD_LCTL"],
      tap: "KC_GRAVE",
    };
    expect(applySwap(a)).toEqual({
      kind: "modTap",
      mods: ["MOD_LGUI"],
      tap: "KC_GRAVE",
    });
  });

  // The firmware compiles these to register_code16()/SEND_STRING() inside
  // process_record_user, which never call mod_config(). If we swapped them the
  // preview would claim behavior the board does not have.
  it("does NOT swap dualFunc — register_code16 bypasses mod_config", () => {
    const a: KeyAction = {
      kind: "dualFunc",
      tap: { code: "KC_C", mods: ["MOD_LGUI"] },
      hold: { code: "KC_V", mods: ["MOD_LCTL"] },
    };
    expect(applySwap(a)).toEqual(a);
  });

  it("does NOT swap macro — SEND_STRING bypasses mod_config", () => {
    const a: KeyAction = {
      kind: "macro",
      label: "m",
      steps: [{ code: "KC_5", mods: ["MOD_LCTL", "MOD_LSFT"] }],
    };
    expect(applySwap(a)).toEqual(a);
  });

  it("does NOT swap tapDance — same register_code16 path", () => {
    const a: KeyAction = { kind: "tapDance", tap: "KC_BSPC" };
    expect(applySwap(a)).toEqual(a);
  });

  it("leaves layerSwitch and qkLock untouched", () => {
    const ls: KeyAction = { kind: "layerSwitch", action: "TG", layer: 1 };
    expect(applySwap(ls)).toEqual(ls);
    const lock: KeyAction = { kind: "qkLock" };
    expect(applySwap(lock)).toEqual(lock);
  });
});

describe("OS-switch keycodes", () => {
  it("recognises the three CG_* codes and nothing else", () => {
    expect(isOsSwitchCode("CG_TOGG")).toBe(true);
    expect(isOsSwitchCode("CG_SWAP")).toBe(true);
    expect(isOsSwitchCode("CG_NORM")).toBe(true);
    expect(isOsSwitchCode("QK_LOCK")).toBe(false);
  });

  it("models toggle as relative and SWAP/NORM as absolute", () => {
    // process_magic.c:155 — negation
    expect(swapStateAfter("CG_TOGG", false)).toBe(true);
    expect(swapStateAfter("CG_TOGG", true)).toBe(false);
    // :92 and :138 — unconditional sets, so they are idempotent
    expect(swapStateAfter("CG_SWAP", false)).toBe(true);
    expect(swapStateAfter("CG_SWAP", true)).toBe(true);
    expect(swapStateAfter("CG_NORM", true)).toBe(false);
    expect(swapStateAfter("CG_NORM", false)).toBe(false);
  });

  it("names the OS from the swap state via HOME_OS", () => {
    expect(osForSwapState(false)).toBe(HOME_OS);
    expect(osForSwapState(true)).not.toBe(HOME_OS);
  });
});

describe("findOsSwitchKeys", () => {
  const base = LayoutFileSchema.parse(seeded) as LayoutFile;

  it("finds none in the seeded layout", () => {
    expect(findOsSwitchKeys(base)).toEqual([]);
    expect(hasOsSwitchKey(base)).toBe(false);
  });

  it("tolerates a null layout", () => {
    expect(findOsSwitchKeys(null)).toEqual([]);
    expect(hasOsSwitchKey(null)).toBe(false);
  });

  it("locates switch keys once placed", () => {
    const withKeys: LayoutFile = {
      ...base,
      layers: base.layers.map((l, li) =>
        li !== 0
          ? l
          : {
              ...l,
              keys: l.keys.map((k, ki) =>
                ki === 5
                  ? ({ kind: "special", code: "CG_TOGG" } as KeyAction)
                  : k,
              ),
            },
      ),
    };
    expect(findOsSwitchKeys(withKeys)).toEqual([
      { layer: 0, index: 5, code: "CG_TOGG" },
    ]);
    expect(hasOsSwitchKey(withKeys)).toBe(true);
  });
});

describe("reaching the swapped state (schema v3)", () => {
  const layout = LayoutFileSchema.parse(seeded);
  const bare: LayoutFile = {
    ...layout,
    layers: layout.layers.map((l) => ({
      ...l,
      keys: l.keys.map((k) =>
        k.kind === "special" && isOsSwitchCode(k.code)
          ? { kind: "none" as const }
          : k,
      ),
    })),
  };

  it("takes the authored OS from settings.osDefault, falling back to HOME_OS", () => {
    expect(authoredOs(layout)).toBe("windows");
    expect(
      authoredOs({
        ...layout,
        settings: { ...layout.settings, osDefault: "mac" },
      }),
    ).toBe("mac");
    expect(authoredOs(null)).toBe(HOME_OS);
  });

  it("resolves the previewed OS against the authored one", () => {
    expect(osForSwapState(false, "mac")).toBe("mac");
    expect(osForSwapState(true, "mac")).toBe("windows");
    expect(osForSwapState(true)).toBe("mac"); // HOME_OS is windows
  });

  it("counts a QF_OS_* key and host detection, not just CG_*", () => {
    expect(canSwitchOs(null)).toBe(false);
    expect(findOsModeKeys(bare)).toEqual([]);
    expect(canSwitchOs(bare)).toBe(false);

    const withMode: LayoutFile = {
      ...bare,
      layers: bare.layers.map((l, i) =>
        i === 0
          ? {
              ...l,
              keys: l.keys.map((k, j) =>
                j === 3 ? { kind: "osMode" as const, action: "toggle" as const } : k,
              ),
            }
          : l,
      ),
    };
    expect(findOsModeKeys(withMode)).toEqual([
      { layer: 0, index: 3, action: "toggle" },
    ]);
    expect(canSwitchOs(withMode)).toBe(true);

    const detected: LayoutFile = {
      ...bare,
      settings: { ...bare.settings, osDetection: true },
    };
    expect(canSwitchOs(detected)).toBe(true);
    // And the old route still counts: a CG_* key on its own.
    const withCg: LayoutFile = {
      ...bare,
      layers: bare.layers.map((l, i) =>
        i === 0
          ? {
              ...l,
              keys: l.keys.map((k, j) =>
                j === 4 ? { kind: "special" as const, code: "CG_TOGG" } : k,
              ),
            }
          : l,
      ),
    };
    expect(canSwitchOs(withCg)).toBe(true);
  });
});
