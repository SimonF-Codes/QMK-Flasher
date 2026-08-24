import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/seeded_layout.json";
import {
  appendStep,
  labelOf,
  macroIssue,
  moveStep,
  newStep,
  nudgeStep,
  osMacroIssue,
  removeStep,
  setStepCode,
  setStepDelay,
  stepLabel,
  stepsOf,
  stepsSummary,
  toggleStepMod,
} from "./macros";
import { LayoutFileSchema, type MacroStep } from "./types";

const push: MacroStep[] = [
  { code: "KC_P", delay: 100 },
  { code: "KC_U", delay: 100 },
  { code: "KC_S", delay: 100 },
  { code: "KC_H", delay: 100 },
];

describe("macro steps", () => {
  it("reorders without disturbing the other steps", () => {
    expect(moveStep(push, 0, 3).map((s) => s.code)).toEqual([
      "KC_U",
      "KC_S",
      "KC_H",
      "KC_P",
    ]);
    expect(nudgeStep(push, 1, -1).map((s) => s.code)).toEqual([
      "KC_U",
      "KC_P",
      "KC_S",
      "KC_H",
    ]);
  });

  it("returns the input array for every no-op or out-of-range edit", () => {
    expect(moveStep(push, 1, 1)).toBe(push);
    expect(moveStep(push, -1, 0)).toBe(push);
    expect(moveStep(push, 0, 9)).toBe(push);
    expect(nudgeStep(push, 0, -1)).toBe(push);
    expect(nudgeStep(push, 3, 1)).toBe(push);
    expect(removeStep(push, 9)).toBe(push);
    expect(setStepCode(push, 0, "KC_P")).toBe(push);
    expect(setStepCode(push, 9, "KC_A")).toBe(push);
    expect(setStepDelay(push, 0, 100)).toBe(push);
    expect(toggleStepMod(push, 9, "MOD_LCTL")).toBe(push);
  });

  it("rejects a negative or fractional delay rather than clamping it", () => {
    expect(setStepDelay(push, 0, -1)).toBe(push);
    expect(setStepDelay(push, 0, 12.5)).toBe(push);
    expect(setStepDelay(push, 0, 0)[0].delay).toBe(0);
  });

  it("drops the delay field entirely when cleared", () => {
    const cleared = setStepDelay(push, 0, null);
    expect(cleared[0]).toEqual({ code: "KC_P" });
    expect("delay" in cleared[0]).toBe(false);
  });

  it("drops the mods field when the last modifier is removed", () => {
    const withMod = toggleStepMod(push, 0, "MOD_LCTL");
    expect(withMod[0].mods).toEqual(["MOD_LCTL"]);
    const without = toggleStepMod(withMod, 0, "MOD_LCTL");
    expect(without[0]).toEqual({ code: "KC_P", delay: 100 });
    expect("mods" in without[0]).toBe(false);
  });

  it("keeps JSON key order stable across an edit", () => {
    // isDirty() compares serialized text, so a re-spelled step would read as
    // an edit even when nothing about it changed.
    const step: MacroStep = { code: "KC_5", delay: 100, mods: ["MOD_LCTL"] };
    const edited = setStepCode([step], 0, "KC_6");
    expect(JSON.stringify(edited[0])).toBe(
      '{"code":"KC_6","delay":100,"mods":["MOD_LCTL"]}',
    );
  });

  it("labels a step as the chord it sends", () => {
    expect(stepLabel({ code: "KC_5", mods: ["MOD_LCTL", "MOD_LSFT"] })).toBe(
      "Ctrl+Shift+5",
    );
    expect(stepLabel({ code: "KC_P" })).toBe("P");
    expect(stepsSummary(push)).toBe("P · U · S · H");
    expect(stepsSummary([])).toBe("—");
    expect(stepsSummary(push, 2)).toBe("P · U · +2");
  });

  it("appends a step carrying Oryx's delay", () => {
    const next = appendStep(push);
    expect(next).toHaveLength(5);
    expect(next[4]).toEqual({ code: "KC_A", delay: 100 });
    expect(newStep("KC_B").code).toBe("KC_B");
  });
});

describe("macro validation", () => {
  it("refuses a macro with no steps", () => {
    expect(macroIssue([])).toMatch(/at least one step/i);
    expect(macroIssue(push)).toBeNull();
  });

  it("refuses an osMacro with no label, or empty on both sides", () => {
    expect(osMacroIssue("", push, push)).toMatch(/label/i);
    expect(osMacroIssue("  ", push, push)).toMatch(/label/i);
    expect(osMacroIssue("Desk", [], [])).toMatch(/at least one side/i);
    // One empty side is legitimate: "does nothing on that OS".
    expect(osMacroIssue("Desk", push, [])).toBeNull();
    expect(osMacroIssue("Desk", [], push)).toBeNull();
  });
});

describe("seeding an editor from an existing action", () => {
  it("opens a macro on its own steps and label", () => {
    const action = {
      kind: "macro" as const,
      label: "push",
      steps: push,
    };
    expect(stepsOf(action)).toEqual(push);
    expect(stepsOf(action)).not.toBe(push); // a copy, not the layout's array
    expect(labelOf(action)).toBe("push");
  });

  it("seeds from a basic key, keeping its mods", () => {
    expect(stepsOf({ kind: "basic", code: "KC_5", mods: ["MOD_LCTL"] })).toEqual(
      [{ code: "KC_5", mods: ["MOD_LCTL"] }],
    );
    expect(stepsOf({ kind: "basic", code: "KC_A" })).toEqual([
      { code: "KC_A" },
    ]);
    expect(stepsOf({ kind: "qkLock" })).toEqual([]);
    expect(labelOf({ kind: "qkLock" })).toBe("");
  });
});

describe("the real layout's macros", () => {
  const layout = LayoutFileSchema.parse(fixture);
  const macros = layout.layers.flatMap((l) =>
    l.keys.filter((k) => k.kind === "macro"),
  );

  it("has the seven Simon uses", () => {
    expect(macros.map((m) => (m.kind === "macro" ? m.label : ""))).toEqual([
      "push",
      "pull",
      "fetch",
      "git",
      "cd",
      "vim",
      "Screenshot",
    ]);
  });

  it("round-trips every one byte-identically when untouched", () => {
    for (const macro of macros) {
      if (macro.kind !== "macro") continue;
      // Opening an editor on a macro and applying nothing must reproduce it.
      const reopened = {
        kind: "macro" as const,
        label: labelOf(macro),
        steps: stepsOf(macro),
        ...(macro.glow ? { glow: macro.glow } : {}),
      };
      expect(JSON.stringify(reopened)).toBe(JSON.stringify(macro));
    }
  });

  it("shows why Screenshot needs an osMacro", () => {
    const shot = macros.find((m) => m.kind === "macro" && m.label === "Screenshot");
    expect(shot?.kind === "macro" && shot.steps).toEqual([
      { code: "KC_5", delay: 100, mods: ["MOD_LCTL", "MOD_LSFT"] },
    ]);
    // Ctrl+Shift+5 is the Mac screen-recording chord surviving the Ctrl<->Cmd
    // swap; on Windows it is nothing. That is the case osMacro exists for.
    expect(stepLabel({ code: "KC_5", mods: ["MOD_LCTL", "MOD_LSFT"] })).toBe(
      "Ctrl+Shift+5",
    );
  });
});
