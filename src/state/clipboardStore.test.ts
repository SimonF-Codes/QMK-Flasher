import { beforeEach, describe, expect, it } from "vitest";
import { resetMockStore } from "../lib/ipc";
import { useClipboardStore } from "./clipboardStore";
import { useLayoutStore } from "./layoutStore";

const clip = () => useClipboardStore.getState();
const layoutState = () => useLayoutStore.getState();
const keyAt = (layer: number, key: number) =>
  layoutState().layout!.layers[layer].keys[key];

describe("clipboardStore", () => {
  beforeEach(async () => {
    useClipboardStore.setState({ action: null });
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

  it("copies the selected key's action", () => {
    layoutState().selectKey(0);
    expect(clip().copySelectedKey()).toBe(true);
    expect(clip().action).toEqual(keyAt(0, 0));
  });

  it("copying never marks the layout dirty", () => {
    const before = layoutState().layout;
    expect(layoutState().isDirty()).toBe(false);

    layoutState().selectKey(0);
    clip().copySelectedKey();
    layoutState().selectKey(5);
    clip().copySelectedKey();

    // The layout object is untouched (same reference) and still clean.
    expect(layoutState().layout).toBe(before);
    expect(layoutState().isDirty()).toBe(false);
  });

  it("the clipboard is never written into the layout", async () => {
    layoutState().selectKey(0);
    clip().copySelectedKey();
    await layoutState().save();
    await layoutState().load();
    // A round trip through the backend brings back nothing extra…
    expect(layoutState().isDirty()).toBe(false);
    // …and the clipboard is not a field on the layout file.
    expect(JSON.stringify(layoutState().layout)).not.toContain("clipboard");
  });

  it("pastes the copied action onto another key and marks dirty", () => {
    layoutState().selectKey(0);
    const source = keyAt(0, 0);
    clip().copySelectedKey();

    layoutState().selectKey(1);
    expect(keyAt(0, 1)).not.toEqual(source);
    expect(clip().pasteToSelectedKey()).toBe(true);

    expect(keyAt(0, 1)).toEqual(source);
    expect(keyAt(0, 0)).toEqual(source); // copy, not move
    expect(layoutState().isDirty()).toBe(true);
  });

  it("survives a layer switch: copy on layer 0, paste on layer 2", () => {
    layoutState().selectLayer(0);
    layoutState().selectKey(0);
    const source = keyAt(0, 0);
    clip().copySelectedKey();

    // selectLayer deliberately clears selectedKey and swapSource — the
    // clipboard must not go with them.
    layoutState().selectLayer(2);
    expect(layoutState().selectedKey).toBeNull();
    expect(layoutState().swapSource).toBeNull();
    expect(clip().action).toEqual(source);

    layoutState().selectKey(0);
    expect(keyAt(2, 0)).not.toEqual(source);
    expect(clip().pasteToSelectedKey()).toBe(true);

    expect(keyAt(2, 0)).toEqual(source);
    expect(clip().action).toEqual(source); // still there for the next paste
  });

  it("keeps the destination's glow, not the source's", () => {
    layoutState().selectLayer(0);
    layoutState().selectKey(0);
    layoutState().setSelectedKeyGlow("#111111");
    clip().copySelectedKey();
    // Glow is per-position decoration, so it never rides along on the clipboard.
    expect(clip().action).not.toHaveProperty("glow");

    layoutState().selectLayer(2);
    layoutState().selectKey(0);
    layoutState().setSelectedKeyGlow("#222222");
    clip().pasteToSelectedKey();

    expect(keyAt(2, 0)).toEqual({ ...keyAt(0, 0), glow: "#222222" });
  });

  it("leaves an unglowed destination unglowed", () => {
    layoutState().selectKey(0);
    layoutState().setSelectedKeyGlow("#111111");
    clip().copySelectedKey();

    layoutState().selectLayer(5); // the one layer with no per-key glows
    layoutState().selectKey(0);
    clip().pasteToSelectedKey();

    expect(keyAt(5, 0)).not.toHaveProperty("glow");
  });

  it("pasting goes through setKeyAction, so settings.tapDance stays in sync", () => {
    // Found rather than hardcoded: which position holds a tap dance is a
    // property of the shipped layout, and this test is about paste keeping
    // settings.tapDance in sync - not about where the key happens to sit.
    const source = layoutState().layout!.layers[0].keys.findIndex(
      (k) => k.kind === "tapDance",
    );
    expect(source).toBeGreaterThanOrEqual(0);
    layoutState().selectKey(source);
    clip().copySelectedKey();

    layoutState().selectLayer(5); // no tap-dance keys of its own
    layoutState().selectKey(0);
    clip().pasteToSelectedKey();

    expect(keyAt(5, 0).kind).toBe("tapDance");
    expect(layoutState().layout!.settings.tapDance).toBe(true);
  });

  it("does nothing with no key selected or an empty clipboard", () => {
    const before = layoutState().layout;

    layoutState().selectKey(null);
    expect(clip().copySelectedKey()).toBe(false);
    expect(clip().action).toBeNull();
    expect(clip().pasteToSelectedKey()).toBe(false);

    layoutState().selectKey(0);
    expect(clip().pasteToSelectedKey()).toBe(false); // nothing copied yet

    expect(layoutState().layout).toBe(before);
    expect(layoutState().isDirty()).toBe(false);
  });

  it("clears on request", () => {
    layoutState().selectKey(0);
    clip().copySelectedKey();
    expect(clip().action).not.toBeNull();
    clip().clear();
    expect(clip().action).toBeNull();
    expect(clip().pasteToSelectedKey()).toBe(false);
  });
});
