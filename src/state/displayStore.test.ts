import { beforeEach, describe, expect, it } from "vitest";
import { resetMockStore } from "../lib/ipc";
import { useDisplayStore } from "./displayStore";
import { useLayoutStore } from "./layoutStore";

describe("displayStore", () => {
  beforeEach(async () => {
    useDisplayStore.setState({ mode: "advanced", osSwapPreview: false });
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

  it("defaults to advanced and switches modes", () => {
    expect(useDisplayStore.getState().mode).toBe("advanced");
    useDisplayStore.getState().setMode("mac");
    expect(useDisplayStore.getState().mode).toBe("mac");
    useDisplayStore.getState().setMode("windows");
    expect(useDisplayStore.getState().mode).toBe("windows");
  });

  it("changing display mode never marks the layout dirty", () => {
    const before = useLayoutStore.getState().layout;
    expect(useLayoutStore.getState().isDirty()).toBe(false);

    useDisplayStore.getState().setMode("mac");
    useDisplayStore.getState().setMode("windows");

    // The layout object is untouched (same reference) and still clean.
    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("defaults the OS swap preview off and toggles it", () => {
    expect(useDisplayStore.getState().osSwapPreview).toBe(false);
    useDisplayStore.getState().setOsSwapPreview(true);
    expect(useDisplayStore.getState().osSwapPreview).toBe(true);
    useDisplayStore.getState().setOsSwapPreview(false);
    expect(useDisplayStore.getState().osSwapPreview).toBe(false);
  });

  it("the OS swap preview never marks the layout dirty either", () => {
    const before = useLayoutStore.getState().layout;
    useDisplayStore.getState().setOsSwapPreview(true);
    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("the swap preview is independent of the label mode", () => {
    useDisplayStore.getState().setOsSwapPreview(true);
    useDisplayStore.getState().setMode("mac");
    expect(useDisplayStore.getState().osSwapPreview).toBe(true);
    useDisplayStore.getState().setMode("advanced");
    expect(useDisplayStore.getState().osSwapPreview).toBe(true);
  });
});
