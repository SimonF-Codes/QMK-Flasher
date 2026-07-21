import { beforeEach, describe, expect, it } from "vitest";
import { resetMockStore } from "../lib/ipc";
import { useLayoutStore } from "./layoutStore";

describe("layoutStore (mock IPC)", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({
      layout: null,
      savedJson: null,
      layouts: [],
      activeId: null,
      selectedLayer: 0,
      selectedKey: null,
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("loads the fixture and starts clean", () => {
    const s = useLayoutStore.getState();
    expect(s.layout?.meta.name).toBe("Arrows Together");
    expect(s.isDirty()).toBe(false);
  });

  it("editing a key marks dirty; saving clears it", async () => {
    const s = useLayoutStore.getState();
    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    expect(useLayoutStore.getState().isDirty()).toBe(true);
    expect(
      useLayoutStore.getState().layout?.layers[0].keys[0],
    ).toEqual({ kind: "basic", code: "KC_F13" });

    await useLayoutStore.getState().save();
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("save round-trips through the mock backend", async () => {
    const s = useLayoutStore.getState();
    s.selectKey(1);
    s.setKeyAction({ kind: "qkLock" });
    await useLayoutStore.getState().save();

    await useLayoutStore.getState().load();
    expect(useLayoutStore.getState().layout?.layers[0].keys[1]).toEqual({
      kind: "qkLock",
    });
  });

  it("renaming a layer marks dirty and only touches that layer", () => {
    const s = useLayoutStore.getState();
    s.renameLayer(1, "Symbols");
    const layout = useLayoutStore.getState().layout!;
    expect(layout.layers[1].title).toBe("Symbols");
    expect(layout.layers[0].title).not.toBe("Symbols");
    expect(useLayoutStore.getState().isDirty()).toBe(true);
  });

  it("recomputes settings.tapDance from content; last dance removed clears it", () => {
    const s = useLayoutStore.getState();
    const layout = s.layout!;
    // Fixture ships with tap-dance keys and settings.tapDance = true.
    const positions: Array<[number, number]> = [];
    layout.layers.forEach((layer, li) =>
      layer.keys.forEach((k, ki) => {
        if (k.kind === "tapDance") positions.push([li, ki]);
      }),
    );
    expect(positions.length).toBeGreaterThan(0);
    expect(layout.settings.tapDance).toBe(true);

    // Overwrite each dance key; the flag must stay true until the last removal.
    positions.forEach(([li, ki], i) => {
      const st = useLayoutStore.getState();
      st.selectLayer(li);
      st.selectKey(ki);
      st.setKeyAction({ kind: "basic", code: "KC_A" });
      const remaining = positions.length - (i + 1);
      expect(useLayoutStore.getState().layout!.settings.tapDance).toBe(
        remaining > 0,
      );
    });
    expect(useLayoutStore.getState().layout!.settings.tapDance).toBe(false);
  });

  it("adding a tap-dance key sets settings.tapDance true", () => {
    const s = useLayoutStore.getState();
    // Clear any existing dances first so we start from false.
    const layout = s.layout!;
    layout.layers.forEach((layer, li) =>
      layer.keys.forEach((k, ki) => {
        if (k.kind === "tapDance") {
          const st = useLayoutStore.getState();
          st.selectLayer(li);
          st.selectKey(ki);
          st.setKeyAction({ kind: "basic", code: "KC_A" });
        }
      }),
    );
    expect(useLayoutStore.getState().layout!.settings.tapDance).toBe(false);

    const st = useLayoutStore.getState();
    st.selectLayer(0);
    st.selectKey(0);
    st.setKeyAction({ kind: "tapDance", tap: "KC_A", doubleTap: "KC_B" });
    expect(useLayoutStore.getState().layout!.settings.tapDance).toBe(true);
  });

  it("edits only affect the selected layer", () => {
    const s = useLayoutStore.getState();
    s.selectLayer(1);
    s.selectKey(5);
    s.setKeyAction({ kind: "basic", code: "KC_Z" });
    const layout = useLayoutStore.getState().layout!;
    expect(layout.layers[1].keys[5]).toEqual({ kind: "basic", code: "KC_Z" });
    expect(layout.layers[0].keys[5]).toEqual({ kind: "basic", code: "KC_5" });
  });
});

describe("layoutStore multi-layout (mock IPC)", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({
      layout: null,
      savedJson: null,
      layouts: [],
      activeId: null,
      selectedLayer: 0,
      selectedKey: null,
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("load populates the layouts list and active id", () => {
    const s = useLayoutStore.getState();
    expect(s.layouts.map((l) => l.id)).toEqual(["arrows-together"]);
    expect(s.activeId).toBe("arrows-together");
    expect(s.layouts[0].name).toBe("Arrows Together");
    expect(s.layouts[0].keyboard).toBe("moonlander");
  });

  it("create adds a layout without switching the active one", async () => {
    const created = await useLayoutStore
      .getState()
      .createLayout("Gaming", "moonlander");
    expect(created?.id).toBe("gaming");
    const s = useLayoutStore.getState();
    expect(s.layouts.map((l) => l.id).sort()).toEqual([
      "arrows-together",
      "gaming",
    ]);
    expect(s.activeId).toBe("arrows-together"); // unchanged
  });

  it("switching with unsaved edits is blocked until resolved", async () => {
    const s = useLayoutStore.getState();
    await s.createLayout("Gaming", "moonlander");

    // Make the active layout dirty.
    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    expect(useLayoutStore.getState().isDirty()).toBe(true);

    // No resolution -> refuses, stays put.
    const blocked = await useLayoutStore.getState().switchLayout("gaming");
    expect(blocked).toBe(false);
    expect(useLayoutStore.getState().activeId).toBe("arrows-together");

    // Discard -> switches, edit is gone and the new layout is clean.
    const ok = await useLayoutStore
      .getState()
      .switchLayout("gaming", "discard");
    expect(ok).toBe(true);
    const after = useLayoutStore.getState();
    expect(after.activeId).toBe("gaming");
    expect(after.isDirty()).toBe(false);
    expect(after.layout?.meta.name).toBe("Gaming");
    expect(after.selectedKey).toBeNull();
  });

  it("switching with 'save' persists the edit before switching back", async () => {
    const s = useLayoutStore.getState();
    await s.createLayout("Gaming", "moonlander");

    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    await useLayoutStore.getState().switchLayout("gaming", "save");
    expect(useLayoutStore.getState().activeId).toBe("gaming");

    // The saved edit survived on the original layout.
    await useLayoutStore.getState().switchLayout("arrows-together");
    expect(
      useLayoutStore.getState().layout?.layers[0].keys[0],
    ).toEqual({ kind: "basic", code: "KC_F13" });
  });

  it("duplicate copies content under a fresh id without switching", async () => {
    const created = await useLayoutStore
      .getState()
      .duplicateLayout("arrows-together", "Arrows Together");
    // Name collides -> id gets a numeric suffix.
    expect(created?.id).toBe("arrows-together-2");
    const s = useLayoutStore.getState();
    expect(s.activeId).toBe("arrows-together"); // store doesn't auto-switch
    expect(s.layouts.map((l) => l.id).sort()).toEqual([
      "arrows-together",
      "arrows-together-2",
    ]);
    // The copy carries the original content.
    await useLayoutStore.getState().switchLayout("arrows-together-2");
    expect(useLayoutStore.getState().layout?.meta.name).toBe("Arrows Together");
  });

  it("rename updates the summary and the active layout name", async () => {
    await useLayoutStore.getState().renameLayout("arrows-together", "Main");
    const s = useLayoutStore.getState();
    expect(s.layouts[0].name).toBe("Main");
    expect(s.layout?.meta.name).toBe("Main");
    expect(s.activeId).toBe("arrows-together"); // id stable
    expect(s.isDirty()).toBe(false); // rename is not a pending edit
  });

  it("delete refuses the active layout but removes an inactive one", async () => {
    const s = useLayoutStore.getState();
    await s.createLayout("Gaming", "moonlander");

    await useLayoutStore.getState().deleteLayout("arrows-together");
    expect(useLayoutStore.getState().error?.code).toBe("InvalidLayout");
    expect(
      useLayoutStore.getState().layouts.map((l) => l.id),
    ).toContain("arrows-together");

    await useLayoutStore.getState().deleteLayout("gaming");
    expect(useLayoutStore.getState().error).toBeNull();
    expect(useLayoutStore.getState().layouts.map((l) => l.id)).toEqual([
      "arrows-together",
    ]);
  });
});
