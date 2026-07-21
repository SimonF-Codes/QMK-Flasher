import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "./layoutStore";

describe("layoutStore (mock IPC)", () => {
  beforeEach(async () => {
    useLayoutStore.setState({
      layout: null,
      savedJson: null,
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
