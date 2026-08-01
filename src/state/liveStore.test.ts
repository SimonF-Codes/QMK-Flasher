import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockStore } from "../lib/ipc";
import type { KeyAction, Layer, LayoutFile } from "../lib/types";
import { useLayoutStore } from "./layoutStore";
import { AFTERGLOW_MS, LOG_LIMIT, useLiveStore } from "./liveStore";

function layerWith(overrides: Record<number, KeyAction>, title: string): Layer {
  const keys: KeyAction[] = Array.from({ length: 72 }, () => ({
    kind: "none" as const,
  }));
  for (const [i, a] of Object.entries(overrides)) keys[Number(i)] = a;
  return { title, color: "#112233", keys };
}

/** A deterministic layout so position assertions don't depend on the fixture. */
function makeLayout(layers: Layer[]): LayoutFile {
  return {
    schemaVersion: 2,
    meta: {
      name: "test",
      geometry: "moonlander",
      seededFrom: {
        layoutId: "x",
        revisionHash: "y",
        qmkVersion: "z",
        seededAt: "2026-01-01T00:00:00Z",
      },
    },
    layers,
    combos: [],
    settings: {
      autoShift: false,
      capsWord: false,
      tapDance: false,
      combos: false,
      keyLock: true,
      oryx: false,
      rgbMatrixCustom: false,
      layerState8bit: false,
      serialNumber: "",
      rgbStartupSpeed: 0,
    },
  };
}

const THREE_LAYERS = [
  layerWith({ 1: { kind: "basic", code: "KC_A" } }, "base"),
  layerWith({ 2: { kind: "basic", code: "KC_B" } }, "one"),
  layerWith({ 3: { kind: "basic", code: "KC_A" } }, "two"),
];

/** Install a synthetic layout as the clean, saved state. */
function installLayout(layers: Layer[] = THREE_LAYERS): LayoutFile {
  const layout = makeLayout(layers);
  useLayoutStore.setState({
    layout,
    savedJson: JSON.stringify(layout),
    selectedLayer: 0,
    selectedKey: null,
    swapSource: null,
    error: null,
  });
  return layout;
}

beforeEach(() => {
  useLiveStore.getState().releaseAll();
  useLiveStore.setState({
    enabled: true,
    followLayer: true,
    pinnedLayer: null,
    events: [],
    nextId: 1,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("liveStore press tracking", () => {
  it("lights up every position that emits the pressed key", () => {
    installLayout([
      layerWith(
        { 3: { kind: "basic", code: "KC_TAB" }, 40: { kind: "basic", code: "KC_TAB" } },
        "base",
      ),
    ]);

    useLiveStore.getState().keyDown({ code: "Tab", key: "Tab" });

    expect([...useLiveStore.getState().pressed].sort((a, b) => a - b)).toEqual([
      3, 40,
    ]);
  });

  it("logs the emitted code, character and matched positions", () => {
    installLayout();

    useLiveStore.getState().keyDown({ code: "KeyA", key: "a", shiftKey: false });
    const [event] = useLiveStore.getState().events;

    expect(event.type).toBe("down");
    expect(event.code).toBe("KeyA");
    expect(event.key).toBe("a");
    expect(event.qmk).toBe("KC_A");
    expect(event.positions).toEqual([1]);
    expect(event.layer).toBe(0);
  });

  it("records held modifiers", () => {
    installLayout();
    useLiveStore
      .getState()
      .keyDown({ code: "KeyA", key: "A", shiftKey: true, ctrlKey: true });
    expect(useLiveStore.getState().events[0].mods).toEqual(["Ctrl", "Shift"]);
  });

  it("marks an unmapped code as unmatched instead of guessing", () => {
    installLayout();
    useLiveStore.getState().keyDown({ code: "Fn", key: "Fn" });
    const [event] = useLiveStore.getState().events;
    expect(event.qmk).toBeNull();
    expect(event.positions).toEqual([]);
    expect(event.layer).toBeNull();
  });

  it("keeps the highlight on auto-repeat without flooding the log", () => {
    installLayout();
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a", repeat: true });
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a", repeat: true });

    expect(useLiveStore.getState().events).toHaveLength(1);
    expect(useLiveStore.getState().pressed.has(1)).toBe(true);
  });

  it("moves a released key to the afterglow set, then clears it", () => {
    vi.useFakeTimers();
    installLayout();

    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    useLiveStore.getState().keyUp({ code: "KeyA", key: "a" });

    expect(useLiveStore.getState().pressed.has(1)).toBe(false);
    expect(useLiveStore.getState().recent.has(1)).toBe(true);

    vi.advanceTimersByTime(AFTERGLOW_MS + 10);
    expect(useLiveStore.getState().recent.has(1)).toBe(false);
  });

  it("releaseAll drops press state (window blur)", () => {
    installLayout();
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    useLiveStore.getState().releaseAll();
    expect(useLiveStore.getState().pressed.size).toBe(0);
    expect(useLiveStore.getState().recent.size).toBe(0);
  });

  it("caps the log and keeps the newest entry first", () => {
    installLayout();
    for (let i = 0; i < LOG_LIMIT + 25; i++) {
      useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
      useLiveStore.getState().keyUp({ code: "KeyA", key: "a" });
    }
    const { events } = useLiveStore.getState();
    expect(events).toHaveLength(LOG_LIMIT);
    // Newest first: ids descend.
    expect(events[0].id).toBeGreaterThan(events[1].id);
  });
});

describe("liveStore layer auto-follow", () => {
  it("switches to the layer holding the pressed key", () => {
    installLayout();
    expect(useLayoutStore.getState().selectedLayer).toBe(0);

    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });

    expect(useLayoutStore.getState().selectedLayer).toBe(1);
    expect(useLiveStore.getState().events[0].layer).toBe(1);
  });

  it("stays put when the current layer already emits the key", () => {
    installLayout();
    useLayoutStore.setState({ selectedLayer: 2 });

    // KC_A is on layers 0 and 2; viewing 2 must not jump to 0.
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

    expect(useLayoutStore.getState().selectedLayer).toBe(2);
    expect(useLiveStore.getState().events[0].positions).toEqual([3]);
  });

  it("does not switch when follow is off", () => {
    installLayout();
    useLiveStore.setState({ followLayer: false });

    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });

    expect(useLayoutStore.getState().selectedLayer).toBe(0);
    // The match is still reported, the view just doesn't move.
    expect(useLiveStore.getState().events[0].layer).toBe(1);
  });

  it("does not switch while a layer is pinned", () => {
    installLayout();
    useLiveStore.getState().pinLayer(0);

    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });

    expect(useLayoutStore.getState().selectedLayer).toBe(0);
  });

  it("resumes following after the pin is dropped", () => {
    installLayout();
    useLiveStore.getState().pinLayer(0);
    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });
    expect(useLayoutStore.getState().selectedLayer).toBe(0);

    useLiveStore.getState().resumeFollow();
    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
  });

  it("clears the pin when follow is turned off and back on", () => {
    installLayout();
    useLiveStore.getState().pinLayer(2);
    useLiveStore.getState().setFollowLayer(false);
    expect(useLiveStore.getState().pinnedLayer).toBeNull();
  });
});

describe("liveStore never touches the layout", () => {
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

  it("pressing keys and auto-following never marks the layout dirty", () => {
    const before = useLayoutStore.getState().layout;
    expect(useLayoutStore.getState().isDirty()).toBe(false);

    const live = useLiveStore.getState();
    for (const code of ["KeyA", "KeyS", "KeyD", "Space", "Enter", "ArrowUp"]) {
      live.keyDown({ code, key: code });
      live.keyUp({ code, key: code });
    }
    live.setEnabled(false);
    live.setEnabled(true);

    // Same layout object reference, still clean.
    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});
