import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/seeded_layout.json";
import {
  addCombo,
  comboIssue,
  comboKeysIssue,
  combosOnLayer,
  combosUsingKey,
  deleteCombo,
  isComboValid,
  MIN_COMBO_KEYS,
  newCombo,
  suggestComboName,
  toggleComboKey,
  updateCombo,
  usesCombos,
  withDerivedComboFlag,
} from "./combos";
import { LayoutFileSchema, type Combo, type LayoutFile } from "./types";

const base = () => LayoutFileSchema.parse(fixture) as LayoutFile;

const good: Combo = {
  name: "Esc",
  keys: [3, 4],
  layer: 0,
  action: { kind: "basic", code: "KC_ESCAPE" },
};

describe("combo well-formedness (schema v3)", () => {
  it("needs at least two DISTINCT keys", () => {
    expect(MIN_COMBO_KEYS).toBe(2);
    expect(comboKeysIssue([])).toMatch(/at least 2/);
    expect(comboKeysIssue([7])).toMatch(/at least 2/);
    expect(comboKeysIssue([7, 7])).toMatch(/only appear once/);
    expect(comboKeysIssue([7, 8])).toBeNull();
  });

  it("reports the first thing wrong with a whole combo", () => {
    expect(comboIssue({ ...good, name: " " }, 7, 72)).toMatch(/name/i);
    expect(comboIssue({ ...good, keys: [3] }, 7, 72)).toMatch(/at least 2/);
    expect(comboIssue({ ...good, keys: [3, 99] }, 7, 72)).toMatch(
      /outside this keyboard/,
    );
    expect(comboIssue({ ...good, layer: 9 }, 7, 72)).toMatch(/does not exist/);
    expect(
      comboIssue({ ...good, action: { kind: "none" } }, 7, 72),
    ).toMatch(/what the combo should do/);
    expect(comboIssue(good, 7, 72)).toBeNull();
    expect(isComboValid(good, 7, 72)).toBe(true);
  });
});

describe("building a trigger set", () => {
  it("toggles membership and keeps insertion order", () => {
    // Oryx's own combos are not in ascending order; re-sorting would rewrite
    // them the first time anything else was edited.
    expect(toggleComboKey([21, 7], 5)).toEqual([21, 7, 5]);
    expect(toggleComboKey([21, 7, 5], 7)).toEqual([21, 5]);
  });

  it("starts a new combo empty on the layer you are viewing", () => {
    expect(newCombo(3)).toEqual({
      name: "",
      keys: [],
      layer: 3,
      action: { kind: "none" },
    });
  });

  it("suggests a name that is not taken", () => {
    const layout = base();
    expect(suggestComboName(layout)).toBe("Combo 3");
    const clashed = addCombo(layout, { ...good, name: "Combo 3" });
    expect(suggestComboName(clashed)).toBe("Combo 4");
  });
});

describe("settings.combos is derived from content", () => {
  it("is left alone when it already matches", () => {
    const layout = base();
    expect(usesCombos(layout)).toBe(true);
    expect(layout.settings.combos).toBe(true);
    // Identity, so a merely-stale flag on disk never dirties the layout.
    expect(withDerivedComboFlag(layout)).toBe(layout);
  });

  it("clears when the last combo goes, and sets when the first arrives", () => {
    const layout = base();
    const one = deleteCombo(layout, 0);
    expect(one.settings.combos).toBe(true);
    const none = deleteCombo(one, 0);
    expect(none.combos).toHaveLength(0);
    expect(none.settings.combos).toBe(false);

    const again = addCombo(none, good);
    expect(again.settings.combos).toBe(true);
  });

  it("fixes a stale true flag as soon as a combo is edited", () => {
    const layout = base();
    const stale: LayoutFile = {
      ...layout,
      combos: [],
      settings: { ...layout.settings, combos: true },
    };
    expect(addCombo(stale, good).settings.combos).toBe(true);
    // The stale-flag bug: nothing left to enable COMBO_ENABLE for.
    expect(withDerivedComboFlag(stale).settings.combos).toBe(false);
  });
});

describe("mutations", () => {
  it("adds, updates and deletes by index", () => {
    const layout = base();
    const added = addCombo(layout, good);
    expect(added.combos).toHaveLength(3);
    expect(added.combos[2]).toEqual(good);

    const renamed = updateCombo(added, 2, { ...good, name: "Escape" });
    expect(renamed.combos[2].name).toBe("Escape");
    expect(renamed.combos[0]).toEqual(layout.combos[0]);

    const removed = deleteCombo(renamed, 0);
    expect(removed.combos.map((c) => c.name)).toEqual(["Mirror 2", "Escape"]);
  });

  it("returns the input layout for an out-of-range index", () => {
    const layout = base();
    expect(updateCombo(layout, 9, good)).toBe(layout);
    expect(deleteCombo(layout, -1)).toBe(layout);
    expect(deleteCombo(layout, 9)).toBe(layout);
  });

  it("leaves the seeded combos byte-identical when untouched", () => {
    const layout = base();
    const edited = addCombo(layout, good);
    expect(JSON.stringify(edited.combos.slice(0, 2))).toBe(
      JSON.stringify(layout.combos),
    );
  });
});

describe("lookups", () => {
  it("finds combos by layer and by participating key", () => {
    const layout = base();
    expect(combosOnLayer(layout, 0).map((c) => c.combo.name)).toEqual([
      "Mirror 1",
      "Mirror 2",
    ]);
    expect(combosOnLayer(layout, 5)).toEqual([]);
    expect(combosUsingKey(layout, 21).map((c) => c.index)).toEqual([0]);
    expect(combosUsingKey(layout, 6).map((c) => c.index)).toEqual([1]);
    expect(combosUsingKey(layout, 71)).toEqual([]);
  });
});
