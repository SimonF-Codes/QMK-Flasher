import { beforeEach, describe, expect, it } from "vitest";
import { resetMockStore } from "../lib/ipc";
import { mirrorKeys } from "../lib/mirror";
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

describe("layoutStore swap keys (mock IPC)", () => {
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
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("beginSwap enters swap mode anchored on a key; cancel leaves it", () => {
    const s = useLayoutStore.getState();
    s.beginSwap(4);
    expect(useLayoutStore.getState().swapSource).toBe(4);
    expect(useLayoutStore.getState().selectedKey).toBe(4);
    useLayoutStore.getState().cancelSwap();
    expect(useLayoutStore.getState().swapSource).toBeNull();
  });

  it("swapKeys exchanges two keys on the selected layer, dirties, and selects the target", () => {
    const s = useLayoutStore.getState();
    const before = s.layout!.layers[0].keys;
    const k0 = before[0];
    const k3 = before[3];
    expect(k0).not.toEqual(k3);

    s.beginSwap(0);
    useLayoutStore.getState().swapKeys(0, 3);

    const after = useLayoutStore.getState();
    expect(after.layout!.layers[0].keys[0]).toEqual(k3);
    expect(after.layout!.layers[0].keys[3]).toEqual(k0);
    expect(after.swapSource).toBeNull();
    expect(after.selectedKey).toBe(3);
    expect(after.isDirty()).toBe(true);
    // A different layer is untouched.
    expect(after.layout!.layers[1].keys[0]).toEqual(s.layout!.layers[1].keys[0]);
  });

  it("swapKeys onto the same position is a no-op that just leaves swap mode", () => {
    const s = useLayoutStore.getState();
    s.beginSwap(2);
    useLayoutStore.getState().swapKeys(2, 2);
    const after = useLayoutStore.getState();
    expect(after.swapSource).toBeNull();
    expect(after.isDirty()).toBe(false);
  });

  it("changing layer clears an in-progress swap", () => {
    const s = useLayoutStore.getState();
    s.beginSwap(0);
    s.selectLayer(1);
    expect(useLayoutStore.getState().swapSource).toBeNull();
  });

  it("swapped keys round-trip through save/load", async () => {
    const s = useLayoutStore.getState();
    const k0 = s.layout!.layers[0].keys[0];
    const k5 = s.layout!.layers[0].keys[5];
    s.swapKeys(0, 5);
    await useLayoutStore.getState().save();
    await useLayoutStore.getState().load();
    const after = useLayoutStore.getState();
    expect(after.layout!.layers[0].keys[0]).toEqual(k5);
    expect(after.layout!.layers[0].keys[5]).toEqual(k0);
  });
});

describe("layoutStore swap layers (mock IPC)", () => {
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
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("swaps layer content, remaps combo references, and dirties", () => {
    const s = useLayoutStore.getState();
    const layerOf = (c: { action: unknown }) =>
      (c.action as { layer?: number }).layer;

    // Whichever combos fire at 5 must come out firing at 2 and vice versa,
    // and every other combo must come out untouched. Taken from the layout
    // rather than assumed of it: the shipped default gained combos that fire
    // at neither layer, and "they all point at 5" was never the claim.
    const before = s.layout!.combos.map(layerOf);
    expect(before.filter((l) => l === 5).length).toBeGreaterThan(0);
    const l2Title = s.layout!.layers[2].title;
    const l5Title = s.layout!.layers[5].title;

    s.swapLayers(2, 5);

    const after = useLayoutStore.getState();
    expect(after.layout!.layers[2].title).toBe(l5Title);
    expect(after.layout!.layers[5].title).toBe(l2Title);
    expect(after.layout!.combos.map(layerOf)).toEqual(
      before.map((l) => (l === 5 ? 2 : l === 2 ? 5 : l)),
    );
    expect(after.isDirty()).toBe(true);
  });

  it("keeps the currently viewed layer's content selected across the swap", () => {
    const s = useLayoutStore.getState();
    s.selectLayer(5);
    useLayoutStore.getState().swapLayers(1, 5);
    // The content that was at layer 5 rode to index 1; selection follows.
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
    expect(useLayoutStore.getState().selectedKey).toBeNull();
  });

  it("is a no-op when swapping a layer with itself", () => {
    const s = useLayoutStore.getState();
    s.swapLayers(3, 3);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("swapped layers persist through save/load", async () => {
    const s = useLayoutStore.getState();
    const t1 = s.layout!.layers[1].title;
    const t4 = s.layout!.layers[4].title;
    s.swapLayers(1, 4);
    await useLayoutStore.getState().save();
    await useLayoutStore.getState().load();
    const reloaded = useLayoutStore.getState().layout!;
    expect(reloaded.layers[1].title).toBe(t4);
    expect(reloaded.layers[4].title).toBe(t1);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});

describe("layoutStore mirror layer (mock IPC)", () => {
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
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("writes the mirror of one layer over another and dirties", () => {
    const s = useLayoutStore.getState();
    const source = s.layout!.layers[0].keys;
    const title = s.layout!.layers[5].title;

    s.mirrorLayer(0, 5);

    const after = useLayoutStore.getState();
    expect(after.layout!.layers[5].keys).toEqual(mirrorKeys(source));
    // The destination keeps its own name — this regenerates content, not identity.
    expect(after.layout!.layers[5].title).toBe(title);
    expect(after.layout!.layers[0].keys).toEqual(source);
    expect(after.selectedLayer).toBe(5);
    expect(after.isDirty()).toBe(true);
  });

  it("appends a new layer when there is no destination", () => {
    const s = useLayoutStore.getState();
    const count = s.layout!.layers.length;
    s.mirrorLayer(0, null);

    const after = useLayoutStore.getState();
    expect(after.layout!.layers).toHaveLength(count + 1);
    expect(after.layout!.layers.at(-1)!.keys).toEqual(
      mirrorKeys(s.layout!.layers[0].keys),
    );
    // Appending leaves every existing layer reference meaning what it did, so
    // the combos must come out byte-identical.
    expect(after.layout!.combos).toEqual(s.layout!.combos);
    expect(after.selectedLayer).toBe(count);
  });

  it("mirroring a layer into itself twice restores it", () => {
    const s = useLayoutStore.getState();
    const before = s.layout!.layers[0].keys;
    s.mirrorLayer(0, 0);
    useLayoutStore.getState().mirrorLayer(0, 0);
    expect(useLayoutStore.getState().layout!.layers[0].keys).toEqual(before);
  });

  it("honours the keep-options it is handed", () => {
    const s = useLayoutStore.getState();
    const source = s.layout!.layers[0].keys;
    const all = { keepLayerKeys: false, keepThumbs: false, keepModifiers: false };
    s.mirrorLayer(0, 5, all);
    expect(useLayoutStore.getState().layout!.layers[5].keys).toEqual(
      mirrorKeys(source, all),
    );
  });

  it("re-derives settings.tapDance when the overwrite moves the last dance", () => {
    // Layer 6 has no tap dance; mirroring it over every layer that does would
    // leave TAP_DANCE_ENABLE on with no tap_dance_actions[] to go with it.
    const dances = () =>
      useLayoutStore
        .getState()
        .layout!.layers.flatMap((l) => l.keys)
        .filter((k) => k.kind === "tapDance").length;
    expect(dances()).toBeGreaterThan(0);
    const st = useLayoutStore.getState();
    st.layout!.layers.forEach((_, i) => {
      useLayoutStore.getState().mirrorLayer(6, i);
    });
    expect(dances()).toBe(0);
    expect(useLayoutStore.getState().layout!.settings.tapDance).toBe(false);
  });

  it("is a no-op for a layer index that does not exist", () => {
    const s = useLayoutStore.getState();
    s.mirrorLayer(0, 99);
    s.mirrorLayer(99, 0);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("a mirrored layer survives save/load", async () => {
    const s = useLayoutStore.getState();
    const expected = mirrorKeys(s.layout!.layers[0].keys);
    s.mirrorLayer(0, 5);
    await useLayoutStore.getState().save();
    await useLayoutStore.getState().load();
    expect(useLayoutStore.getState().layout!.layers[5].keys).toEqual(expected);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});

describe("layoutStore version history (mock IPC)", () => {
  beforeEach(async () => {
    resetMockStore();
    useLayoutStore.setState({
      layout: null,
      savedJson: null,
      layouts: [],
      activeId: null,
      versions: [],
      selectedLayer: 0,
      selectedKey: null,
      swapSource: null,
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("starts with no versions", () => {
    expect(useLayoutStore.getState().versions).toEqual([]);
  });

  it("saving records a 'save' version in the store", async () => {
    const s = useLayoutStore.getState();
    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    await useLayoutStore.getState().save();
    const versions = useLayoutStore.getState().versions;
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].reason).toBe("save");
  });

  it("snapshotNow adds a manual version with a label", async () => {
    await useLayoutStore.getState().snapshotNow("checkpoint");
    const versions = useLayoutStore.getState().versions;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: "manual", label: "checkpoint" });
  });

  it("restoreVersion restores content, clears dirty, and backs up the current first", async () => {
    const s = useLayoutStore.getState();
    const originalKey0 = s.layout!.layers[0].keys[0];

    // Snapshot the pristine layout, then edit + save so current differs.
    await useLayoutStore.getState().snapshotNow("pristine");
    const pristine = useLayoutStore
      .getState()
      .versions.find((v) => v.label === "pristine")!;
    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    await useLayoutStore.getState().save();
    expect(useLayoutStore.getState().layout!.layers[0].keys[0]).toEqual({
      kind: "basic",
      code: "KC_F13",
    });

    // Revert to the pristine snapshot.
    await useLayoutStore.getState().restoreVersion(pristine.versionId);
    const after = useLayoutStore.getState();
    expect(after.error).toBeNull();
    expect(after.layout!.layers[0].keys[0]).toEqual(originalKey0);
    expect(after.isDirty()).toBe(false); // restored == the new saved state
    expect(after.selectedKey).toBeNull();
    // The pre-restore backup is now in the list, so the revert is undoable.
    expect(after.versions.some((v) => v.reason === "preRestore")).toBe(true);
  });

  it("re-seeding records a preReseed backup", async () => {
    const s = useLayoutStore.getState();
    expect(s.layout?.meta.seededFrom.layoutId).toBe("rddD7");
    await useLayoutStore.getState().seedActiveFromOryx();
    expect(
      useLayoutStore.getState().versions.some((v) => v.reason === "preReseed"),
    ).toBe(true);
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

  it("seed re-seeds a layout that has an Oryx source", async () => {
    const s = useLayoutStore.getState();
    expect(s.layout?.meta.seededFrom.layoutId).toBe("rddD7"); // has a source
    // Dirty it, then seed should replace content and clear dirty.
    s.selectKey(0);
    s.setKeyAction({ kind: "basic", code: "KC_F13" });
    expect(useLayoutStore.getState().isDirty()).toBe(true);

    await useLayoutStore.getState().seedActiveFromOryx();
    const after = useLayoutStore.getState();
    expect(after.error).toBeNull();
    expect(after.isDirty()).toBe(false);
    expect(after.layout?.layers).toHaveLength(7);
  });

  it("seed refuses a layout with no Oryx source (local)", async () => {
    await useLayoutStore.getState().createLayout("Gaming", "moonlander");
    await useLayoutStore.getState().switchLayout("gaming");
    expect(
      useLayoutStore.getState().layout?.meta.seededFrom.layoutId,
    ).toBe("local");

    await useLayoutStore.getState().seedActiveFromOryx();
    const after = useLayoutStore.getState();
    expect(after.error?.code).toBe("OryxUnreachable");
    // Content untouched (still the blank single layer).
    expect(after.layout?.layers).toHaveLength(1);
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

describe("layoutStore LED colors (mock IPC)", () => {
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
      error: null,
    });
    await useLayoutStore.getState().load();
  });

  it("setting a layer color dirties and persists through save/load", async () => {
    useLayoutStore.getState().setLayerColor(1, "#123456");
    expect(useLayoutStore.getState().layout!.layers[1].color).toBe("#123456");
    expect(useLayoutStore.getState().isDirty()).toBe(true);

    await useLayoutStore.getState().save();
    await useLayoutStore.getState().load();
    expect(useLayoutStore.getState().layout!.layers[1].color).toBe("#123456");
  });

  it("re-picking the color already in place does not dirty the layout", () => {
    const current = useLayoutStore.getState().layout!.layers[0].color;
    useLayoutStore.getState().setLayerColor(0, current.toUpperCase());
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("a bad hex is rejected without dirtying", () => {
    useLayoutStore.getState().setLayerColor(0, "hotpink");
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("key glow applies to the selected key and resets back to the layer base", () => {
    const s = useLayoutStore.getState();
    s.selectLayer(0);
    s.selectKey(3);
    useLayoutStore.getState().setSelectedKeyGlow("#ff00ff");
    expect(useLayoutStore.getState().layout!.layers[0].keys[3].glow).toBe(
      "#ff00ff",
    );

    useLayoutStore.getState().setSelectedKeyGlow(null);
    expect(
      "glow" in useLayoutStore.getState().layout!.layers[0].keys[3],
    ).toBe(false);
  });

  it("key glow is a no-op with nothing selected", () => {
    useLayoutStore.getState().selectKey(null);
    useLayoutStore.getState().setSelectedKeyGlow("#ff00ff");
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("tinting by destination colors layer keys and clearing undoes it", () => {
    const s = useLayoutStore.getState();
    // The fixture's layer 0 has layer keys; find one and its target's color.
    const idx = s
      .layout!.layers[0].keys.findIndex(
        (k) => k.kind === "layerSwitch" || k.kind === "layerTap",
      );
    expect(idx).toBeGreaterThanOrEqual(0);
    const target = (
      s.layout!.layers[0].keys[idx] as { layer: number }
    ).layer;

    useLayoutStore.getState().glowLayerKeysByTarget(0);
    expect(useLayoutStore.getState().layout!.layers[0].keys[idx].glow).toBe(
      useLayoutStore.getState().layout!.layers[target].color,
    );

    useLayoutStore.getState().clearLayerGlows(0);
    expect(
      useLayoutStore.getState().layout!.layers[0].keys.some((k) => k.glow),
    ).toBe(false);
  });

  it("clearing glows on an already-flat layer does not dirty it", async () => {
    useLayoutStore.getState().clearLayerGlows(0);
    await useLayoutStore.getState().save();
    expect(useLayoutStore.getState().isDirty()).toBe(false);

    useLayoutStore.getState().clearLayerGlows(0);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});
