import { describe, expect, it } from "vitest";
import geometryRaw from "../../shared/fixtures/f75_geometry_synthetic.json";
import { F75GeometrySchema } from "./types";
import {
  boardSize,
  describePacked,
  F75_CATEGORY,
  F75_LAYERS,
  f75KeyLabel,
  isLocked,
  isUnbound,
} from "./f75";

const geo = F75GeometrySchema.parse(geometryRaw);
const key = (label: string) => geo.keys.find((k) => k.label === label)!;

describe("f75 geometry fixture", () => {
  it("parses the extractor's output against the shared schema", () => {
    expect(geo.keyCount).toBe(geo.keys.length);
    // Self-labelling: the fixture is authored, not vendor data.
    expect(geo.source).toContain("SYNTHETIC");
  });

  it("measures the board from positioned keys only", () => {
    // The encoder has no rectangle and must not contribute to the extents.
    const { w, h } = boardSize(geo);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
  });
});

describe("F75_LAYERS", () => {
  it("has exactly two layers, because the firmware has exactly two", () => {
    expect(F75_LAYERS.map((l) => l.id)).toEqual(["base", "fn1"]);
  });
});

describe("describePacked", () => {
  it("names HID keyboard usages", () => {
    expect(describePacked({ packed: "0x07000004", category: 0x07, usage: 0x04 })).toBe("A");
    expect(describePacked({ packed: "0x07000029", category: 0x07, usage: 0x29 })).toBe("Esc");
    expect(describePacked({ packed: "0x0700001e", category: 0x07, usage: 0x1e })).toBe("1");
  });

  it("names the consumer usages the factory tables use", () => {
    expect(describePacked({ packed: "0x020000e9", category: 0x02, usage: 0xe9 })).toBe("Vol +");
    expect(describePacked({ packed: "0x02000223", category: 0x02, usage: 0x223 })).toBe("Home");
  });

  it("shows the raw packed value for categories with no known meaning", () => {
    // Vendor and unclassified categories have no documented mapping. Inventing
    // a friendly name would be indistinguishable in the UI from a real one.
    expect(
      describePacked({ packed: "0x08030200", category: F75_CATEGORY.vendor, usage: 0x0200 }),
    ).toBe("0x08030200");
    expect(
      describePacked({ packed: "0x0004002b", category: F75_CATEGORY.unclassified, usage: 0x2b }),
    ).toBe("0x0004002b");
  });

  it("falls back to the raw usage for an unmapped keyboard usage", () => {
    expect(describePacked({ packed: "0x070000f0", category: 0x07, usage: 0xf0 })).toBe("HID 0xf0");
  });
});

describe("f75KeyLabel", () => {
  it("shows the OEM key name on the base layer", () => {
    // The factory base binding is a Windows VK; the VK -> HID mapping is only
    // needed to write a blob, so the label is the vendor's own name for it.
    expect(f75KeyLabel(key("Esc"), "base")).toBe("Esc");
    expect(f75KeyLabel(key("Backspace"), "base")).toBe("Backspace");
  });

  it("shows the FN1 binding on the FN1 layer", () => {
    expect(f75KeyLabel(key("Esc"), "fn1")).toBe("A");
    expect(f75KeyLabel(key("F1"), "fn1")).toBe("Home");
  });

  it("shows a dash where FN1 defines nothing", () => {
    expect(f75KeyLabel(key("Tab"), "fn1")).toBe("—");
  });
});

describe("isLocked", () => {
  it("reports the firmware-pinned function keys as locked", () => {
    expect(isLocked(geo, key("F1").slot)).toBe(true);
    expect(isLocked(geo, key("Esc").slot)).toBe(false);
  });
});

describe("unbound slots", () => {
  it("shows an all-zero output as unbound, not as a literal hex code", () => {
    // The protocol spells a disabled slot as page 0x00 / usage 0x00. Rendering
    // that as "0x00000000" reads like a real vendor code rather than an empty
    // key — which is how it first looked on the FN1 layer.
    const zero = { packed: "0x00000000", category: 0, usage: 0 };
    expect(isUnbound(zero)).toBe(true);
    expect(describePacked(zero)).toBe("—");
  });

  it("does not treat a real category-0 output as unbound", () => {
    const tab = { packed: "0x0004002b", category: 0, usage: 0x2b };
    expect(isUnbound(tab)).toBe(false);
    expect(describePacked(tab)).toBe("0x0004002b");
  });
});
