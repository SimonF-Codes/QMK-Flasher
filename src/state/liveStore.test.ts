import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEOMETRY } from "../lib/geometry";
import { mockControls, resetMockStore } from "../lib/ipc";
import type { KeyAction, Layer, LayoutFile } from "../lib/types";
import { useLayoutStore } from "./layoutStore";
import { AFTERGLOW_MS, EMIT_WINDOW_MS, LOG_LIMIT, useLiveStore } from "./liveStore";

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
  layerWith(
    { 1: { kind: "basic", code: "KC_A" }, 5: { kind: "layerSwitch", action: "MO", layer: 1 } },
    "base",
  ),
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

/**
 * Report a switch by board position, the way the firmware would — through its
 * real matrix coordinates, so the geometry lookup is part of every test.
 */
function report(position: number, pressed: boolean): void {
  const [row, col] = GEOMETRY.keys[position].matrix;
  useLiveStore.getState().keyReport({ row, col, pressed });
}

beforeEach(() => {
  useLiveStore.getState().releaseAll();
  useLiveStore.setState({
    enabled: true,
    // Monitor mode explicitly: these tests are about the monitor, and trainer
    // mode would route every press into a scoring session.
    mode: "monitor",
    status: "live",
    error: null,
    followLayer: true,
    pinnedLayer: null,
    activeLayer: 0,
    events: [],
    nextId: 1,
  });
});

afterEach(() => {
  vi.useRealTimers();
  mockControls.keyReportingUnavailable = false;
});

describe("liveStore press tracking", () => {
  it("lights the reported switch, resolved through the matrix", () => {
    installLayout();
    report(40, true);
    expect([...useLiveStore.getState().pressed]).toEqual([40]);
  });

  it("logs the switch, the layer, and what the layout says that key does", () => {
    installLayout();
    report(1, true);
    const [event] = useLiveStore.getState().events;

    const [row, col] = GEOMETRY.keys[1].matrix;
    expect(event.type).toBe("down");
    expect(event.row).toBe(row);
    expect(event.col).toBe(col);
    expect(event.position).toBe(1);
    expect(event.layer).toBe(0);
    expect(event.qmk).toBe("KC_A");
    // Nothing from the browser yet.
    expect(event.char).toBeNull();
  });

  it("logs a key the OS never sees, which is the whole point", () => {
    // MO(1) is consumed by the firmware: it emits no HID usage at all, so the
    // old browser-event path could not see it. The report can.
    installLayout();
    report(5, true);
    const [event] = useLiveStore.getState().events;
    expect(event.position).toBe(5);
    expect(event.qmk).toBeNull();
    expect(useLiveStore.getState().pressed.has(5)).toBe(true);
  });

  it("keeps an unmapped matrix cell in the log without lighting anything", () => {
    installLayout();
    useLiveStore.getState().keyReport({ row: 200, col: 200, pressed: true });
    const [event] = useLiveStore.getState().events;
    expect(event.position).toBeNull();
    expect(event.qmk).toBeNull();
    expect(useLiveStore.getState().pressed.size).toBe(0);
  });

  it("reads a transparent key as the layer it falls through to", () => {
    installLayout([
      layerWith({ 1: { kind: "basic", code: "KC_A" } }, "base"),
      layerWith({ 1: { kind: "transparent" } }, "clear"),
    ]);
    useLiveStore.setState({ activeLayer: 1 });
    report(1, true);
    expect(useLiveStore.getState().events[0].qmk).toBe("KC_A");
  });

  it("moves a released key to the afterglow set, then clears it", () => {
    vi.useFakeTimers();
    installLayout();

    report(1, true);
    report(1, false);

    expect(useLiveStore.getState().pressed.has(1)).toBe(false);
    expect(useLiveStore.getState().recent.has(1)).toBe(true);

    vi.advanceTimersByTime(AFTERGLOW_MS + 10);
    expect(useLiveStore.getState().recent.has(1)).toBe(false);
  });

  it("releaseAll drops press state", () => {
    installLayout();
    report(1, true);
    useLiveStore.getState().releaseAll();
    expect(useLiveStore.getState().pressed.size).toBe(0);
    expect(useLiveStore.getState().recent.size).toBe(0);
  });

  it("releases a key held across a layer change", () => {
    // Holding MO reports the switch on layer 0, then the layer it caused. The
    // release arrives stamped with the new layer — it must still clear the
    // highlight, which is keyed by position, not by layer.
    installLayout();
    report(5, true);
    useLiveStore.getState().layerReport({ layer: 1 });
    expect(useLiveStore.getState().pressed.has(5)).toBe(true);

    report(5, false);
    expect(useLiveStore.getState().pressed.has(5)).toBe(false);
    expect(useLiveStore.getState().events[0].layer).toBe(1);
  });

  it("caps the log and keeps the newest entry first", () => {
    installLayout();
    for (let i = 0; i < LOG_LIMIT + 25; i++) {
      report(1, true);
      report(1, false);
    }
    const { events } = useLiveStore.getState();
    expect(events).toHaveLength(LOG_LIMIT);
    // Newest first: ids descend.
    expect(events[0].id).toBeGreaterThan(events[1].id);
  });
});

describe("liveStore browser annotation", () => {
  it("attaches the character the OS received to the report that caused it", () => {
    installLayout();
    report(1, true);
    useLiveStore.getState().emitted({ code: "KeyA", key: "a", shiftKey: true });

    const [event] = useLiveStore.getState().events;
    expect(event.char).toBe("a");
    expect(event.emitted).toBe("KC_A");
    expect(event.mods).toEqual(["Shift"]);
    // Still exactly one entry — the browser annotates, it does not log.
    expect(useLiveStore.getState().events).toHaveLength(1);
  });

  it("ignores a keystroke with no recent report behind it", () => {
    // No fallback: a character arriving without a switch report is not a
    // keypress we are entitled to draw on the board.
    installLayout();
    useLiveStore.getState().emitted({ code: "KeyA", key: "a" });
    expect(useLiveStore.getState().events).toHaveLength(0);
    expect(useLiveStore.getState().pressed.size).toBe(0);
  });

  it("does not annotate a stale report", () => {
    vi.useFakeTimers();
    installLayout();
    report(1, true);
    vi.advanceTimersByTime(EMIT_WINDOW_MS + 50);
    useLiveStore.getState().emitted({ code: "KeyA", key: "a" });
    expect(useLiveStore.getState().events[0].char).toBeNull();
  });

  it("does not attach a character to a release", () => {
    installLayout();
    report(1, true);
    report(1, false);
    useLiveStore.getState().emitted({ code: "KeyA", key: "a" });
    expect(useLiveStore.getState().events[0].char).toBeNull();
  });

  it("ignores auto-repeat, which has no new switch behind it", () => {
    installLayout();
    report(1, true);
    useLiveStore.getState().emitted({ code: "KeyA", key: "a", repeat: true });
    expect(useLiveStore.getState().events[0].char).toBeNull();
  });
});

describe("liveStore layer follow", () => {
  it("follows the layer the board reports", () => {
    installLayout();
    expect(useLayoutStore.getState().selectedLayer).toBe(0);

    useLiveStore.getState().layerReport({ layer: 1 });

    expect(useLiveStore.getState().activeLayer).toBe(1);
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
  });

  it("stamps later presses with the reported layer", () => {
    installLayout();
    useLiveStore.getState().layerReport({ layer: 1 });
    report(2, true);
    expect(useLiveStore.getState().events[0].layer).toBe(1);
    expect(useLiveStore.getState().events[0].qmk).toBe("KC_B");
  });

  it("does not switch when follow is off", () => {
    installLayout();
    useLiveStore.setState({ followLayer: false });

    useLiveStore.getState().layerReport({ layer: 1 });

    expect(useLayoutStore.getState().selectedLayer).toBe(0);
    // The board's layer is still tracked, the view just doesn't move.
    expect(useLiveStore.getState().activeLayer).toBe(1);
  });

  it("does not switch while a layer is pinned", () => {
    installLayout();
    useLiveStore.getState().pinLayer(0);
    useLiveStore.getState().layerReport({ layer: 1 });
    expect(useLayoutStore.getState().selectedLayer).toBe(0);
  });

  it("resumes following after the pin is dropped", () => {
    installLayout();
    useLiveStore.getState().pinLayer(0);
    useLiveStore.getState().layerReport({ layer: 1 });
    expect(useLayoutStore.getState().selectedLayer).toBe(0);

    useLiveStore.getState().resumeFollow();
    useLiveStore.getState().layerReport({ layer: 1 });
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
  });

  it("clears the pin when follow is turned off and back on", () => {
    installLayout();
    useLiveStore.getState().pinLayer(2);
    useLiveStore.getState().setFollowLayer(false);
    expect(useLiveStore.getState().pinnedLayer).toBeNull();
  });

  it("ignores a layer the layout does not have", () => {
    // The board can be on a layer this layout has never heard of (it may be
    // running older firmware); following would show an empty board.
    installLayout();
    useLiveStore.getState().layerReport({ layer: 9 });
    expect(useLayoutStore.getState().selectedLayer).toBe(0);
    expect(useLiveStore.getState().activeLayer).toBe(9);
  });
});

describe("liveStore capture status", () => {
  it("reports waiting until the board says something, then live", async () => {
    installLayout();
    useLiveStore.setState({ status: "off" });
    await useLiveStore.getState().connect();
    expect(useLiveStore.getState().status).toBe("waiting");
    expect(useLiveStore.getState().error).toBeNull();

    report(1, true);
    expect(useLiveStore.getState().status).toBe("live");
  });

  it("surfaces why the channel could not be opened, with no fallback", async () => {
    installLayout();
    mockControls.keyReportingUnavailable = true;
    await useLiveStore.getState().connect();

    const { status, error } = useLiveStore.getState();
    expect(status).toBe("unavailable");
    expect(error?.code).toBe("KeyReportUnavailable");
    expect(error?.hint).toContain("Keymapp");

    // Typing still does nothing — there is deliberately no browser fallback.
    useLiveStore.getState().emitted({ code: "KeyA", key: "a" });
    expect(useLiveStore.getState().events).toHaveLength(0);
  });

  it("disconnect drops press state and goes back to off", async () => {
    installLayout();
    report(1, true);
    await useLiveStore.getState().disconnect();
    expect(useLiveStore.getState().status).toBe("off");
    expect(useLiveStore.getState().pressed.size).toBe(0);
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

  it("reports and layer follow never mark the layout dirty", () => {
    const before = useLayoutStore.getState().layout;
    expect(useLayoutStore.getState().isDirty()).toBe(false);

    const live = useLiveStore.getState();
    for (const position of [0, 5, 12, 30, 55, 71]) {
      report(position, true);
      report(position, false);
    }
    live.layerReport({ layer: 1 });
    live.setEnabled(false);
    live.setEnabled(true);

    // Same layout object reference, still clean.
    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});
