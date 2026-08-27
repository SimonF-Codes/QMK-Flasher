/**
 * Smoke tests for the F75 grid, rendered to static markup via
 * `react-dom/server` — the same approach ToolGuidePanel uses, since the repo
 * has no DOM harness.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import geometryRaw from "../../shared/fixtures/f75_geometry_synthetic.json";
import { F75GeometrySchema } from "../lib/types";
import type { F75LayerId } from "../lib/f75";
import F75Keyboard from "./F75Keyboard";

const geo = F75GeometrySchema.parse(geometryRaw);

const render = (layer: F75LayerId = "base", selectedSlot: number | null = null) =>
  renderToStaticMarkup(
    <F75Keyboard
      geometry={geo}
      layer={layer}
      selectedSlot={selectedSlot}
      onSelect={() => {}}
    />,
  );

describe("F75Keyboard", () => {
  it("renders one cap per positioned key and none for the encoder", () => {
    const html = render();
    const caps = html.match(/<rect /g) ?? [];
    const positioned = geo.keys.filter((k) => k.positioned).length;
    expect(caps).toHaveLength(positioned);
    // The encoder is a real slot but has no rectangle to draw.
    expect(positioned).toBeLessThan(geo.keys.length);
    expect(html).not.toContain("Wheel");
  });

  it("labels caps with the OEM names on the base layer", () => {
    const html = render("base");
    expect(html).toContain("Esc");
    expect(html).toContain("CapsLock");
  });

  it("switches the caps to the FN1 bindings", () => {
    const html = render("fn1");
    // Esc's FN1 binding in the fixture is HID keyboard usage 0x04.
    expect(html).toContain(">A<");
  });

  it("marks firmware-locked keys and does not present them as editable", () => {
    const html = render();
    expect(html).toContain("locked by firmware");
    // One lock badge per locked slot.
    const badges = html.match(/🔒/g) ?? [];
    expect(badges).toHaveLength(geo.lockedSlots.length);
  });

  it("reflects the selected key", () => {
    const slot = geo.keys.find((k) => k.positioned)!.slot;
    expect(render("base", slot)).toContain('aria-pressed="true"');
    expect(render("base", null)).not.toContain('aria-pressed="true"');
  });

  it("sizes the viewBox to the board rather than a fixed guess", () => {
    const vb = /viewBox="([^"]+)"/.exec(render())![1].split(" ").map(Number);
    expect(vb).toHaveLength(4);
    expect(vb[2]).toBeGreaterThan(0);
    expect(vb[3]).toBeGreaterThan(0);
  });
});
