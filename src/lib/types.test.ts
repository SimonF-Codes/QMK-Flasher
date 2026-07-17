import { describe, expect, it } from "vitest";

import fixture from "../../fixtures/ws_together/seeded_layout.json";
import { SeededLayoutSchema } from "./types";

describe("seeded_layout.json fixture", () => {
  it("matches the SeededLayout schema", () => {
    const layout = SeededLayoutSchema.parse(fixture);
    expect(layout.keyboard).toBe("ws_together");
    expect(layout.layers).toHaveLength(2);
    expect(layout.key_count).toBe(16);
  });

  it("rejects a layer with the wrong number of keys", () => {
    const bad = structuredClone(fixture);
    bad.layers[0].keys.pop();
    expect(() => SeededLayoutSchema.parse(bad)).toThrow(/expected key_count/);
  });

  it("rejects an unknown schema_version", () => {
    const bad = structuredClone(fixture) as Record<string, unknown>;
    bad.schema_version = 999;
    expect(() => SeededLayoutSchema.parse(bad)).toThrow();
  });
});
