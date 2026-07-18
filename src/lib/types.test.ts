import { describe, expect, it } from "vitest";

import fixture from "../../shared/fixtures/seeded_layout.json";
import geometry from "../../shared/moonlander_geometry.json";
import keycodes from "../../shared/keycodes.json";
import {
  GeometryFileSchema,
  KeycodeEntrySchema,
  LayoutFileSchema,
  MOONLANDER_KEY_COUNT,
  type KeyAction,
} from "./types";
import { z } from "zod";

describe("shared/fixtures/seeded_layout.json", () => {
  it("matches the LayoutFile schema", () => {
    const layout = LayoutFileSchema.parse(fixture);
    expect(layout.meta.seededFrom.layoutId).toBe("rddD7");
    expect(layout.layers.length).toBeGreaterThanOrEqual(2);
    for (const layer of layout.layers) {
      expect(layer.keys).toHaveLength(MOONLANDER_KEY_COUNT);
    }
    expect(layout.settings.keyLock).toBe(true);
    expect(layout.combos).toHaveLength(2);
  });

  it("covers the core KeyAction kinds", () => {
    const layout = LayoutFileSchema.parse(fixture);
    const kinds = new Set(
      layout.layers.flatMap((l) => l.keys.map((k) => k.kind)),
    );
    for (const kind of [
      "basic",
      "layerSwitch",
      "modTap",
      "layerTap",
      "dualFunc",
      "qkLock",
      "tapDance",
      "rgbHsv",
      "transparent",
    ]) {
      expect(kinds, `fixture should contain kind ${kind}`).toContain(kind);
    }
  });

  it("rejects a layer with the wrong number of keys", () => {
    const bad = structuredClone(fixture);
    bad.layers[0].keys.pop();
    expect(() => LayoutFileSchema.parse(bad)).toThrow();
  });

  it("rejects keyLock: false", () => {
    const bad = structuredClone(fixture) as { settings: { keyLock: boolean } };
    bad.settings.keyLock = false;
    expect(() => LayoutFileSchema.parse(bad)).toThrow();
  });

  it("rejects a combo referencing a missing layer", () => {
    const bad = structuredClone(fixture);
    bad.combos[0].layer = 99;
    expect(() => LayoutFileSchema.parse(bad)).toThrow(/references layer/);
  });

  it("rejects an unknown schemaVersion", () => {
    const bad = structuredClone(fixture) as Record<string, unknown>;
    bad.schemaVersion = 1;
    expect(() => LayoutFileSchema.parse(bad)).toThrow();
  });
});

describe("shared/moonlander_geometry.json", () => {
  it("matches the Geometry schema with 72 keys and unique LEDs", () => {
    const geo = GeometryFileSchema.parse(geometry);
    expect(geo.keyCount).toBe(MOONLANDER_KEY_COUNT);
    const leds = new Set(geo.keys.map((k) => k.led));
    expect(leds.size).toBe(MOONLANDER_KEY_COUNT);
  });
});

describe("shared/keycodes.json", () => {
  const entries = z.array(KeycodeEntrySchema).parse(keycodes);
  const known = new Set(entries.flatMap((e) => [e.qmk, ...e.aliases]));

  it("has unique names and aliases", () => {
    const all = entries.flatMap((e) => [e.qmk, ...e.aliases]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("covers every keycode referenced by the fixture", () => {
    const layout = LayoutFileSchema.parse(fixture);
    const codes = new Set<string>();
    const collect = (k: KeyAction) => {
      if ("code" in k) codes.add(k.code);
      if (k.kind === "modTap" || k.kind === "layerTap") codes.add(k.tap);
      if (k.kind === "dualFunc") {
        codes.add(k.tap.code);
        codes.add(k.hold.code);
      }
      if (k.kind === "tapDance") {
        for (const c of [k.tap, k.hold, k.doubleTap, k.tapHold]) {
          if (c) codes.add(c);
        }
      }
      if (k.kind === "macro") for (const s of k.steps) codes.add(s.code);
    };
    layout.layers.forEach((l) => l.keys.forEach(collect));
    layout.combos.forEach((c) => collect(c.action));
    const missing = [...codes].filter((c) => !known.has(c));
    expect(missing).toEqual([]);
  });
});
