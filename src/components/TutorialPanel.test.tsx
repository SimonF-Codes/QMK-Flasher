/**
 * Smoke tests for the tour's presentation, rendered to static markup.
 *
 * Same reasoning as `ToolGuidePanel.test.tsx`: the repo has no DOM harness and
 * a read-only walkthrough does not justify adding one, but "does it render,
 * and does the thing the step is about actually reach the page" is worth
 * pinning. `react-dom/server` is already a dependency.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import seededRaw from "../../shared/fixtures/seeded_layout.json";
import { buildTutorial, type TutorialTopicId } from "../lib/tutorial";
import { LayoutFileSchema } from "../lib/types";
import { TutorialCard, TutorialInvite } from "./TutorialPanel";

const seeded = LayoutFileSchema.parse(seededRaw);
const tour = buildTutorial(seeded);

const noop = () => {};

function renderStep(id: TutorialTopicId, layout = seeded) {
  const steps = buildTutorial(layout).steps;
  const step = steps.find((s) => s.id === id)!;
  return renderToStaticMarkup(
    <TutorialCard
      step={step}
      total={steps.length}
      onBack={noop}
      onNext={noop}
      onClose={noop}
      onJump={noop}
    />,
  );
}

describe("TutorialCard", () => {
  it("shows where you are and what the step is about", () => {
    const html = renderStep("welcome");
    expect(html).toContain("Step 1 of ");
    expect(html).toContain("What this app is for");
    expect(html).toContain("Key Lock");
  });

  it("points at the real key, by name and by position", () => {
    const html = renderStep("macro");
    const e = tour.steps.find((s) => s.id === "macro")!.example!;
    expect(html).toContain(e.title);
    expect(html).toContain(e.layerName);
    expect(html).toContain(`key ${e.keys[0]}`);
  });

  it("names every trigger of a combo rather than one of them", () => {
    const html = renderStep("combo");
    const e = tour.steps.find((s) => s.id === "combo")!.example!;
    expect(e.keys.length).toBeGreaterThan(1);
    expect(html).toContain(`keys ${e.keys.join(" + ")}`);
  });

  it("carries the OS-macro argument, both halves and the reason", () => {
    const html = renderStep("osSwap");
    expect(html).toContain("Screenshot");
    expect(html).toContain("mod_config()");
  });

  it("says what is missing instead of pointing at an empty position", () => {
    const blank = {
      ...seeded,
      layers: seeded.layers.map((l) => ({
        ...l,
        keys: l.keys.map(() => ({ kind: "transparent" as const })),
      })),
      combos: [],
    };
    const html = renderStep("osMacro", blank);
    expect(html).toContain("Not in this layout");
    expect(html).toContain("no OS macros");
  });

  it("offers a way out on every step", () => {
    for (const id of ["welcome", "osMacro", "flash"] as const) {
      expect(renderStep(id)).toContain("Leave the tour");
    }
  });

  it("finishes rather than offering a next step at the end", () => {
    expect(renderStep("flash")).toContain("Finish");
    expect(renderStep("welcome")).toContain("Next");
  });
});

describe("TutorialInvite", () => {
  it("offers the tour and a way to decline it", () => {
    const html = renderToStaticMarkup(
      <TutorialInvite onStart={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Start the tour");
    expect(html).toContain("No thanks");
  });
});
