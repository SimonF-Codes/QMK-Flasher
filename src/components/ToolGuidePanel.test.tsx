/**
 * Smoke tests for the panel, rendered to static markup.
 *
 * The repo has no DOM test harness, and adding one to exercise a read-only
 * reference panel is not worth the dependency — but "does it render at all,
 * and does the finding that matters actually reach the page" is worth pinning,
 * so these go through `react-dom/server`, which is already a dependency.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import seededRaw from "../../shared/fixtures/seeded_layout.json";
import ToolGuidePanel from "./ToolGuidePanel";
import { LayoutFileSchema, MOONLANDER_KEY_COUNT } from "../lib/types";
import type { KeyAction, LayoutFile } from "../lib/types";

const seeded = LayoutFileSchema.parse(seededRaw);

const render = (layout: LayoutFile | null, layerNames?: string[]) =>
  renderToStaticMarkup(
    <ToolGuidePanel layout={layout} layerNames={layerNames} />,
  );

/** The seeded layout with one key replaced, for the OS-key cases. */
function withKey(action: KeyAction, index = 3): LayoutFile {
  const keys = seeded.layers[0].keys.slice();
  keys[index] = action;
  return {
    ...seeded,
    layers: [{ ...seeded.layers[0], keys }, ...seeded.layers.slice(1)],
  };
}

describe("ToolGuidePanel", () => {
  it("renders the real layout without blowing up", () => {
    const html = render(seeded);
    expect(html).toContain("Tool guide");
    expect(html).toContain("Ctrl ↔ Cmd swap");
    expect(html).toContain("Macros");
    expect(html).toContain("Key Lock");
  });

  it("surfaces the Screenshot finding, not just the macro", () => {
    const html = render(seeded);
    expect(html).toContain("Screenshot");
    expect(html).toContain("Check this one");
    expect(html).toContain("Ctrl+Shift+5");
  });

  it("says the board cannot reach the other OS when nothing switches it", () => {
    expect(render(seeded)).toContain("No OS-mode key is assigned");
  });

  it("degrades gracefully with no layout at all", () => {
    const html = render(null);
    expect(html).toContain("No layout loaded");
    expect(html).not.toContain("Ctrl ↔ Cmd swap");
  });

  it("degrades gracefully when nothing needs explaining", () => {
    const blank: LayoutFile = {
      ...seeded,
      combos: [],
      layers: [
        {
          title: "Base",
          color: "#101010",
          keys: Array.from(
            { length: MOONLANDER_KEY_COUNT },
            () => ({ kind: "basic", code: "KC_A" }) as KeyAction,
          ),
        },
      ],
    };
    expect(render(blank)).toContain("nothing here");
  });

  it("renders an osMode key and reports how the swap is reached", () => {
    const html = render(withKey({ kind: "osMode", action: "toggle" }), [
      "Base",
    ]);
    expect(html).toContain("OS tooling");
    expect(html).toContain("Sets the OS mode");
    expect(html).toContain("The board can switch to Mac mode");
    expect(html).toContain("Layer 0 · Base");
  });

  it("renders an osMacro's two halves side by side", () => {
    const html = render(
      withKey({
        kind: "osMacro",
        label: "Desktop right",
        mac: [{ code: "KC_RIGHT", mods: ["MOD_LCTL"] }],
        windows: [{ code: "KC_RIGHT", mods: ["MOD_LGUI", "MOD_LCTL"] }],
      }),
    );
    expect(html).toContain("Desktop right");
    expect(html).toContain("On Mac");
    expect(html).toContain("On Windows");
    expect(html).toContain("OS-aware");
  });

  it("carries a print stylesheet that isolates the guide", () => {
    const html = render(seeded);
    expect(html).toContain('id="tool-guide-print"');
    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
  });

  it("shows a close control only when the host provides one", () => {
    expect(render(seeded)).not.toContain("Close the tool guide");
    expect(
      renderToStaticMarkup(
        <ToolGuidePanel layout={seeded} onClose={() => {}} />,
      ),
    ).toContain("Close the tool guide");
  });
});
