import { describe, expect, it } from "vitest";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import { KEYCODES } from "./keycodes";
import {
  DEFAULT_NAVIGATOR_TRACKBALL,
  findNavigatorKeys,
  isExactRotation,
  isNavigatorCode,
  normalizeRotation,
  patchNavigatorTrackball,
  rotatedUp,
  setNavigatorTrackball,
  upLandsAt,
} from "./navigator";
import { LayoutFileSchema, NavigatorTrackballSchema } from "./types";

const fixture = () => LayoutFileSchema.parse(fixtureJson);

/** The ten keycodes `process_record_navigator_trackball` handles. */
const MODULE_KEYS = [
  "NAVIGATOR_INC_CPI",
  "NAVIGATOR_DEC_CPI",
  "NAVIGATOR_TURBO",
  "TOGGLE_TURBO",
  "NAVIGATOR_AIM",
  "TOGGLE_AIM",
  "DRAG_SCROLL",
  "TOGGLE_SCROLL",
  "TOGGLE_SCROLL_VERTICAL",
  "NAVIGATOR_CLEAR_SPEED",
];

describe("the schema", () => {
  it("an empty object is the module's own defaults", () => {
    expect(DEFAULT_NAVIGATOR_TRACKBALL).toEqual({
      rotation: 0,
      cpi: 40,
      scrollDivider: 10,
      scrollAcceleration: 1.5,
      scrollMaxSpeed: 8,
      scrollInvertX: false,
      scrollInvertY: false,
      turboMultiplier: 3,
      aimDivider: 3,
    });
  });

  it("enforces the module's CPI ceiling and tick", () => {
    const ok = (cpi: number) => NavigatorTrackballSchema.safeParse({ cpi }).success;
    expect(ok(125)).toBe(true);
    expect(ok(5)).toBe(true);
    expect(ok(130)).toBe(false);
    expect(ok(0)).toBe(false);
    expect(ok(42)).toBe(false);
  });

  it("rotation is raw degrees, 0–359", () => {
    const ok = (rotation: number) =>
      NavigatorTrackballSchema.safeParse({ rotation }).success;
    expect(ok(0)).toBe(true);
    expect(ok(359)).toBe(true);
    expect(ok(360)).toBe(false);
    expect(ok(-1)).toBe(false);
    expect(ok(12.5)).toBe(false);
  });

  it("refuses a zero divisor", () => {
    for (const k of ["scrollDivider", "aimDivider", "turboMultiplier"]) {
      expect(NavigatorTrackballSchema.safeParse({ [k]: 0 }).success).toBe(false);
    }
  });

  it("a layout without the setting stays without it", () => {
    const layout = fixture();
    expect("navigatorTrackball" in layout.settings).toBe(false);
  });
});

describe("transforms", () => {
  it("turning it on and off is identity on a no-op", () => {
    const layout = fixture();
    expect(setNavigatorTrackball(layout, null)).toBe(layout);
    const on = setNavigatorTrackball(layout, DEFAULT_NAVIGATOR_TRACKBALL);
    expect(on).not.toBe(layout);
    expect(on.settings.navigatorTrackball).toEqual(DEFAULT_NAVIGATOR_TRACKBALL);
    expect(setNavigatorTrackball(on, { ...DEFAULT_NAVIGATOR_TRACKBALL })).toBe(on);
  });

  it("off removes the key rather than leaving it undefined", () => {
    const on = setNavigatorTrackball(fixture(), DEFAULT_NAVIGATOR_TRACKBALL);
    const off = setNavigatorTrackball(on, null);
    expect("navigatorTrackball" in off.settings).toBe(false);
    expect(JSON.stringify(off)).toBe(JSON.stringify(fixture()));
  });

  it("patching does nothing while the trackball is off", () => {
    const layout = fixture();
    expect(patchNavigatorTrackball(layout, { rotation: 90 })).toBe(layout);
  });

  it("patching changes one knob and keeps the rest", () => {
    const on = setNavigatorTrackball(fixture(), DEFAULT_NAVIGATOR_TRACKBALL);
    const turned = patchNavigatorTrackball(on, { rotation: 45 });
    expect(turned.settings.navigatorTrackball).toEqual({
      ...DEFAULT_NAVIGATOR_TRACKBALL,
      rotation: 45,
    });
    expect(patchNavigatorTrackball(turned, { rotation: 45 })).toBe(turned);
  });
});

describe("rotation preview", () => {
  it("matches the module's own quarter-turn swaps", () => {
    // navigator.c: 90 → x = -y, y = x. A roll reported as up (0, -1) goes right.
    expect(rotatedUp(0)).toEqual({ x: 0, y: -1 });
    expect(rotatedUp(90)).toEqual({ x: 1, y: 0 });
    expect(rotatedUp(180)).toEqual({ x: 0, y: 1 });
    expect(rotatedUp(270)).toEqual({ x: -1, y: 0 });
  });

  it("turns clockwise for the angles in between", () => {
    const v = rotatedUp(45);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("normalizes the way the module's % 360 does", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
  });

  it("says where up lands, and hedges between the eighths", () => {
    expect(upLandsAt(0)).toBe("up");
    expect(upLandsAt(90)).toBe("right");
    expect(upLandsAt(225)).toBe("down and left");
    expect(upLandsAt(100)).toBe("roughly right");
  });

  it("knows which angles the module rotates exactly", () => {
    expect(isExactRotation(180)).toBe(true);
    expect(isExactRotation(30)).toBe(false);
  });
});

describe("keycodes", () => {
  it("all ten module keys are in the catalog, under their own category", () => {
    for (const code of MODULE_KEYS) expect(isNavigatorCode(code)).toBe(true);
    const filed = KEYCODES.filter((e) => e.category === "navigator").map((e) => e.qmk);
    expect(filed.sort()).toEqual([...MODULE_KEYS].sort());
  });

  it("every one says what it does in words, not just 'Aim' or 'Turbo'", () => {
    for (const e of KEYCODES.filter((k) => k.category === "navigator")) {
      expect(e.longLabel.startsWith("Trackball:")).toBe(true);
      expect(e.longLabel.length).toBeGreaterThan(e.label.length + 15);
    }
  });

  it("the module's short aliases resolve too", () => {
    expect(isNavigatorCode("NV_DSCR")).toBe(true);
    expect(isNavigatorCode("KC_MS_BTN1")).toBe(false);
  });

  it("finds the module's keys in a layout", () => {
    const layout = fixture();
    expect(findNavigatorKeys(layout)).toEqual([]);
    layout.layers[1].keys[3] = { kind: "special", code: "DRAG_SCROLL" };
    expect(findNavigatorKeys(layout)).toEqual([
      { layer: 1, index: 3, code: "DRAG_SCROLL" },
    ]);
  });
});
