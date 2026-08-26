import { beforeEach, describe, expect, it } from "vitest";
import { suggestComboName } from "../lib/combos";
import { resetMockStore } from "../lib/ipc";
import { useLayoutStore } from "./layoutStore";

const store = () => useLayoutStore.getState();

describe("layoutStore — combo editor (mock IPC)", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({
      layout: null,
      savedJson: null,
      layouts: [],
      activeId: null,
      selectedLayer: 0,
      selectedKey: null,
      swapSource: null,
      comboEditor: null,
      error: null,
    });
    await store().load();
  });

  it("opens a draft outside the layout, so nothing half-built can be saved", () => {
    store().beginComboEdit(null);
    const before = store().layout!.combos.length;
    store().toggleComboDraftKey(10);
    expect(store().comboEditor?.combo.keys).toEqual([10]);
    expect(store().layout!.combos).toHaveLength(before);
    expect(store().isDirty()).toBe(false);
  });

  it("refuses to commit until there are two distinct keys and an action", () => {
    // These tests are about the editor's behaviour, not about how many combos
    // the shipped layout has — so both the count and the auto-assigned name
    // are read off the layout. The name comes from `suggestComboName` rather
    // than being spelled out, so the rule stays in one place.
    const before = store().layout!.combos.length;
    const name = suggestComboName(store().layout!);
    store().beginComboEdit(null);
    expect(store().comboDraftIssue()).toMatch(/at least 2/);
    expect(store().commitComboDraft()).toBe(false);

    store().toggleComboDraftKey(10);
    expect(store().commitComboDraft()).toBe(false);

    // Clicking the same key again removes it rather than duplicating it.
    store().toggleComboDraftKey(10);
    expect(store().comboEditor?.combo.keys).toEqual([]);

    store().toggleComboDraftKey(10);
    store().toggleComboDraftKey(11);
    expect(store().comboDraftIssue()).toMatch(/what the combo should do/);
    expect(store().commitComboDraft()).toBe(false);

    store().setComboDraftAction({ kind: "basic", code: "KC_ESCAPE" });
    expect(store().comboDraftIssue()).toBeNull();
    expect(store().commitComboDraft()).toBe(true);
    expect(store().comboEditor).toBeNull();
    expect(store().layout!.combos).toHaveLength(before + 1);
    expect(store().layout!.combos[before]).toEqual({
      name,
      keys: [10, 11],
      layer: 0,
      action: { kind: "basic", code: "KC_ESCAPE" },
    });
  });

  it("edits an existing combo in place", () => {
    const before = store().layout!.combos.length;
    const first = store().layout!.combos[0];
    store().beginComboEdit(0);
    // The draft opens on whatever combo is actually there.
    expect(store().comboEditor?.combo.name).toBe(first.name);
    expect(store().comboEditor?.combo.keys).toEqual(first.keys);
    store().updateComboDraft({ name: "Renamed" });
    expect(store().commitComboDraft()).toBe(true);
    expect(store().layout!.combos[0].name).toBe("Renamed");
    // Editing renames in place; it must not add or drop one.
    expect(store().layout!.combos).toHaveLength(before);
  });

  it("does not mutate the layout's own key array while drafting", () => {
    const original = [...store().layout!.combos[0].keys];
    store().beginComboEdit(0);
    store().toggleComboDraftKey(30);
    store().cancelComboEdit();
    expect(store().layout!.combos[0].keys).toEqual(original);
    expect(store().isDirty()).toBe(false);
  });

  it("follows the combo's layer, and re-points it when you change tabs", () => {
    // Whichever layer the first combo lives on, opening it goes there.
    const home = store().layout!.combos[0].layer;
    store().selectLayer(home === 2 ? 3 : 2);
    store().beginComboEdit(0);
    expect(store().selectedLayer).toBe(home);

    store().selectLayer(3);
    expect(store().comboEditor?.combo.layer).toBe(3);

    store().updateComboDraft({ layer: 1 });
    expect(store().selectedLayer).toBe(1);
  });

  it("derives settings.combos from content on delete and re-add", () => {
    const n = store().layout!.combos.length;
    expect(n).toBeGreaterThan(1);
    expect(store().layout!.settings.combos).toBe(true);

    // The flag tracks CONTENT: it must stay true while ANY combo remains,
    // whatever the layout shipped with, and flip only when the last one goes.
    while (store().layout!.combos.length > 1) {
      store().deleteCombo(0);
      expect(store().layout!.settings.combos).toBe(true);
    }
    store().deleteCombo(0);
    expect(store().layout!.combos).toHaveLength(0);
    expect(store().layout!.settings.combos).toBe(false);

    store().beginComboEdit(null);
    store().toggleComboDraftKey(1);
    store().toggleComboDraftKey(2);
    store().setComboDraftAction({ kind: "qkLock" });
    expect(store().commitComboDraft()).toBe(true);
    expect(store().layout!.settings.combos).toBe(true);
  });

  it("clears settings.combos when a layer takes its last combo with it", () => {
    // The claim is about the LAST combo going with its layer, so it only means
    // anything if layer 0 carries all of them — assert that rather than assume
    // it, so a default layout that spreads its combos fails loudly here
    // instead of quietly testing nothing.
    expect(store().layout!.combos.every((c) => c.layer === 0)).toBe(true);
    // Leaving the flag true would enable COMBO_ENABLE with no combo table.
    store().deleteLayer(0);
    expect(store().layout!.combos).toHaveLength(0);
    expect(store().layout!.settings.combos).toBe(false);
  });

  it("closes an editor whose index a delete would invalidate", () => {
    store().beginComboEdit(1);
    store().deleteCombo(0);
    expect(store().comboEditor).toBeNull();

    store().beginComboEdit(null); // a new combo has no index to invalidate
    store().deleteCombo(0);
    expect(store().comboEditor).not.toBeNull();
  });

  it("is mutually exclusive with swap mode", () => {
    store().beginComboEdit(null);
    store().beginSwap(4);
    expect(store().comboEditor).toBeNull();
    expect(store().swapSource).toBe(4);

    store().beginComboEdit(null);
    expect(store().swapSource).toBeNull();
  });

  it("survives a save round-trip through the backend", async () => {
    const before = store().layout!.combos.length;
    store().beginComboEdit(null);
    store().toggleComboDraftKey(40);
    store().toggleComboDraftKey(41);
    store().updateComboDraft({ name: "Tab" });
    store().setComboDraftAction({ kind: "basic", code: "KC_TAB" });
    store().commitComboDraft();
    expect(store().isDirty()).toBe(true);

    await store().save();
    expect(store().isDirty()).toBe(false);
    await store().load();
    expect(store().layout!.combos).toHaveLength(before + 1);
    expect(store().layout!.combos[before]).toEqual({
      name: "Tab",
      keys: [40, 41],
      layer: 0,
      action: { kind: "basic", code: "KC_TAB" },
    });
  });
});

describe("layoutStore — OS settings", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({ layout: null, savedJson: null, error: null });
    await store().load();
  });

  it("edits osDetection and osDefault, and ignores no-ops", () => {
    // Written against whatever the mock layout ships with, so that changing
    // the default layout's OS settings cannot break this test.
    const wasOn = store().layout!.settings.osDetection;
    const wasOs = store().layout!.settings.osDefault;
    const otherOs = wasOs === "windows" ? "mac" : "windows";

    // Setting a value to what it already is must not dirty the layout.
    store().setOsDetection(wasOn);
    expect(store().isDirty()).toBe(false);
    store().setOsDefault(wasOs);
    expect(store().isDirty()).toBe(false);

    store().setOsDetection(!wasOn);
    expect(store().layout!.settings.osDetection).toBe(!wasOn);
    store().setOsDefault(otherOs);
    expect(store().layout!.settings.osDefault).toBe(otherOs);
    expect(store().isDirty()).toBe(true);
  });

  it("round-trips both through the backend", async () => {
    const flipped = !store().layout!.settings.osDetection;
    const otherOs =
      store().layout!.settings.osDefault === "windows" ? "mac" : "windows";
    store().setOsDetection(flipped);
    store().setOsDefault(otherOs);
    await store().save();
    await store().load();
    expect(store().layout!.settings.osDetection).toBe(flipped);
    expect(store().layout!.settings.osDefault).toBe(otherOs);
  });
});

describe("layoutStore — macro and OS-macro keys", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({ layout: null, savedJson: null, error: null });
    await store().load();
  });

  it("leaves the seven seeded macros untouched when nothing is edited", async () => {
    const before = JSON.stringify(store().layout!.layers);
    store().selectLayer(0);
    store().selectKey(0);
    store().selectKey(null);
    expect(JSON.stringify(store().layout!.layers)).toBe(before);
    expect(store().isDirty()).toBe(false);
  });

  it("edits a macro in place and round-trips it", async () => {
    // "cd" lives at layer 3, key 45 in the seeded layout.
    store().selectLayer(3);
    store().selectKey(45);
    const before = store().layout!.layers[3].keys[45];
    expect(before.kind).toBe("macro");

    store().setKeyAction({
      kind: "macro",
      label: "cd",
      steps: [
        { code: "KC_C", delay: 100 },
        { code: "KC_D", delay: 100 },
        { code: "KC_SPACE", delay: 100 },
        { code: "KC_DOT", delay: 100 },
      ],
    });
    await store().save();
    await store().load();
    const after = store().layout!.layers[3].keys[45];
    expect(after.kind === "macro" && after.steps).toHaveLength(4);
    // Every other macro is byte-identical to what it was.
    const others = store().layout!.layers[3].keys.filter(
      (k, i) => k.kind === "macro" && i !== 45,
    );
    expect(others.map((k) => (k.kind === "macro" ? k.label : ""))).toEqual([
      "push",
      "pull",
      "fetch",
      "git",
      "vim",
    ]);
  });

  it("saves an osMacro and an osMode key", async () => {
    store().selectLayer(0);
    store().selectKey(5);
    store().setKeyAction({
      kind: "osMacro",
      label: "Desk →",
      mac: [{ code: "KC_RIGHT", mods: ["MOD_LCTL"] }],
      windows: [{ code: "KC_RIGHT", mods: ["MOD_LGUI", "MOD_LCTL"] }],
    });
    store().selectKey(6);
    store().setKeyAction({ kind: "osMode", action: "toggle" });

    await store().save();
    await store().load();
    expect(store().layout!.layers[0].keys[5]).toEqual({
      kind: "osMacro",
      label: "Desk →",
      mac: [{ code: "KC_RIGHT", mods: ["MOD_LCTL"] }],
      windows: [{ code: "KC_RIGHT", mods: ["MOD_LGUI", "MOD_LCTL"] }],
    });
    expect(store().layout!.layers[0].keys[6]).toEqual({
      kind: "osMode",
      action: "toggle",
    });
  });
});
