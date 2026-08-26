import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEOMETRY } from "../lib/geometry";
import { resetMockStore } from "../lib/ipc";
import { targetLayer } from "../lib/led";
import { serializeStats, statKey, type StatsMap } from "../lib/trainer";
import type { KeyAction, Layer, LayoutFile } from "../lib/types";
import { useLayoutStore } from "./layoutStore";
import { useLiveStore } from "./liveStore";
import { useTrainerStore } from "./trainerStore";

function layerWith(overrides: Record<number, KeyAction>, title: string): Layer {
  const keys: KeyAction[] = Array.from({ length: 72 }, () => ({
    kind: "none" as const,
  }));
  for (const [i, a] of Object.entries(overrides)) keys[Number(i)] = a;
  return { title, color: "#112233", keys };
}

function makeLayout(layers: Layer[]): LayoutFile {
  return {
    schemaVersion: 3,
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
      osDetection: false,
      osDefault: "windows" as const,
    },
  };
}

/** One drillable key, so the prompt is deterministic without stubbing rng. */
const ONE_KEY = [layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base")];

/**
 * Two layers, with the keys the old trainer could not see: MO(1) emits nothing
 * and QK_LOCK emits nothing, yet both are ordinary targets now.
 */
const TWO_LAYERS = [
  layerWith(
    {
      0: { kind: "basic", code: "KC_A" },
      1: { kind: "basic", code: "KC_B" },
      5: { kind: "layerSwitch", action: "MO", layer: 1 },
      7: { kind: "qkLock" },
    },
    "base",
  ),
  layerWith({ 10: { kind: "basic", code: "KC_Z" } }, "nav"),
];

function installLayout(layers: Layer[] = ONE_KEY): LayoutFile {
  const layout = makeLayout(layers);
  useLayoutStore.setState({
    layout,
    savedJson: JSON.stringify(layout),
    activeId: "test-layout",
    selectedLayer: 0,
    selectedKey: null,
    swapSource: null,
    error: null,
  });
  return layout;
}

/** Report a switch by board position, through its real matrix coordinates. */
function report(position: number, pressed = true): void {
  const [row, col] = GEOMETRY.keys[position].matrix;
  useLiveStore.getState().keyReport({ row, col, pressed });
}

/** Minimal localStorage so persistence can be exercised in the node env. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

beforeEach(() => {
  useTrainerStore.setState({
    scope: "currentLayer",
    reveal: true,
    running: false,
    byLayout: {},
    layoutKey: null,
    targets: [],
    target: null,
    prompt: null,
    promptedAt: 0,
    answers: [],
    last: null,
    summary: null,
  });
  useLiveStore.setState({
    enabled: true,
    mode: "trainer",
    status: "live",
    activeLayer: 0,
    events: [],
    nextId: 1,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("trainer session", () => {
  it("does nothing without a layout to drill", () => {
    useLayoutStore.setState({ layout: null });
    useTrainerStore.getState().start();
    expect(useTrainerStore.getState().running).toBe(false);
  });

  it("prompts for a key and names where it lives", () => {
    installLayout();
    useTrainerStore.getState().start();

    const { running, target, prompt } = useTrainerStore.getState();
    expect(running).toBe(true);
    expect(target).toEqual({ layer: 0, position: 0 });
    expect(prompt?.instruction).toBe("Press A on layer 0 · base");
  });

  it("scores a correct answer and records the reaction time", () => {
    vi.useFakeTimers();
    installLayout();
    useTrainerStore.getState().start();
    vi.advanceTimersByTime(420);

    report(0);

    const { answers, byLayout, layoutKey } = useTrainerStore.getState();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ correct: true, ms: 420, got: 0 });
    const stats = byLayout[layoutKey!];
    expect(stats[statKey(0, 0)]).toMatchObject({ attempts: 1, hits: 1, times: [420] });
  });

  it("scores a wrong key as a miss and says which switch arrived", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    useTrainerStore.setState({
      target: { layer: 0, position: 0 },
      promptedAt: Date.now(),
    });

    report(1);

    expect(useTrainerStore.getState().last).toMatchObject({
      correct: false,
      position: 0,
      got: 1,
    });
  });

  it("scores a layer key directly — the firmware reports the switch", () => {
    // MO(1) sends nothing to the OS. The old trainer had to score it through a
    // witness press on the layer it activated; the report is the switch itself.
    installLayout(TWO_LAYERS);
    useTrainerStore.setState({ scope: "layerKeys" });
    useTrainerStore.getState().start();

    const { target, prompt } = useTrainerStore.getState();
    expect(target).toEqual({ layer: 0, position: 5 });
    expect(prompt?.instruction).toBe("Press MO 1 on layer 0 · base");

    report(5);
    expect(useTrainerStore.getState().answers[0]).toMatchObject({
      correct: true,
      got: 5,
    });
  });

  it("scores QK_LOCK, which reaches the OS never and the trainer always", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    useTrainerStore.setState({
      target: { layer: 0, position: 7 },
      promptedAt: Date.now(),
    });

    report(7);
    expect(useTrainerStore.getState().answers[0].correct).toBe(true);
  });

  it("treats presses on another layer as navigation, not answers", () => {
    // The prompt is on layer 1; reaching it costs a press on layer 0. Grading
    // that press would score the route instead of the destination.
    installLayout(TWO_LAYERS);
    useTrainerStore.setState({ scope: "allLayers" });
    useTrainerStore.getState().start();
    useTrainerStore.setState({
      target: { layer: 1, position: 10 },
      promptedAt: Date.now(),
    });

    report(5); // the MO key, on layer 0
    expect(useTrainerStore.getState().answers).toEqual([]);

    useLiveStore.getState().layerReport({ layer: 1 });
    report(10);
    expect(useTrainerStore.getState().answers).toHaveLength(1);
    expect(useTrainerStore.getState().answers[0].correct).toBe(true);
  });

  it("does not score the release, only the press", () => {
    // Reaction time ends when you commit to a key; a long hold is not slow
    // recall, and grading the up edge would double every answer.
    installLayout();
    useTrainerStore.getState().start();
    report(0, true);
    report(0, false);
    expect(useTrainerStore.getState().answers).toHaveLength(1);
  });

  it("advances to a new prompt instead of asking twice in a row", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    const first = useTrainerStore.getState().target!;

    report(first.position);

    const second = useTrainerStore.getState().target!;
    expect(second.position).not.toBe(first.position);
  });

  it("skips without scoring", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    const first = useTrainerStore.getState().target!;

    useTrainerStore.getState().skip();

    expect(useTrainerStore.getState().answers).toEqual([]);
    expect(useTrainerStore.getState().target!.position).not.toBe(first.position);
  });

  it("ignores presses before the session starts and after it stops", () => {
    installLayout();
    report(0);
    expect(useTrainerStore.getState().answers).toEqual([]);

    useTrainerStore.getState().start();
    useTrainerStore.getState().stop();
    report(0);
    expect(useTrainerStore.getState().answers).toEqual([]);
  });

  it("summarizes on stop", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    useTrainerStore.setState({
      target: { layer: 0, position: 0 },
      promptedAt: Date.now(),
    });
    report(0); // correct
    useTrainerStore.setState({
      target: { layer: 0, position: 0 },
      promptedAt: Date.now(),
    });
    report(1); // wrong
    useTrainerStore.getState().stop();

    expect(useTrainerStore.getState().summary).toMatchObject({
      attempts: 2,
      hits: 1,
      misses: 1,
      accuracy: 0.5,
    });
    expect(useTrainerStore.getState().target).toBeNull();
  });

  it("freezes its targets so a mid-session edit can't change the question", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    const before = useTrainerStore.getState().targets.length;

    useLayoutStore.getState().selectKey(20);
    useLayoutStore.getState().setKeyAction({ kind: "basic", code: "KC_Q" });

    expect(useTrainerStore.getState().targets).toHaveLength(before);
  });
});

describe("trainer and live mode", () => {
  it("scores nothing while live view is only monitoring", () => {
    installLayout();
    useTrainerStore.getState().start();
    useLiveStore.setState({ mode: "monitor" });

    report(0);

    expect(useTrainerStore.getState().answers).toEqual([]);
  });

  it("ends the session when the mode switches back to monitoring", () => {
    installLayout();
    useTrainerStore.getState().start();
    useLiveStore.getState().setMode("monitor");

    expect(useTrainerStore.getState().running).toBe(false);
    expect(useTrainerStore.getState().summary).not.toBeNull();
  });

  it("ends the session when live view is turned off", () => {
    installLayout();
    useTrainerStore.getState().start();
    useLiveStore.getState().setEnabled(false);

    expect(useTrainerStore.getState().running).toBe(false);
  });

  it("still logs the press in trainer mode — monitoring is not lost", () => {
    installLayout();
    useLiveStore.setState({ events: [], nextId: 1 });
    useTrainerStore.getState().start();
    report(0);

    expect(useLiveStore.getState().events[0]).toMatchObject({
      qmk: "KC_A",
      position: 0,
    });
  });
});

describe("revealing the target", () => {
  it("switches the visible layer to the target's, so the highlight shows", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.setState({ scope: "allLayers", reveal: true });
    useTrainerStore.getState().start();
    const target = useTrainerStore.getState().target!;
    expect(useLayoutStore.getState().selectedLayer).toBe(target.layer);
  });

  it("leaves the view alone when the target is hidden", () => {
    installLayout(TWO_LAYERS);
    useLayoutStore.getState().selectLayer(1);
    useTrainerStore.setState({ scope: "allLayers", reveal: false });
    useTrainerStore.getState().start();
    // Scope is all layers, so the pick may well be on layer 0 — either way the
    // view must not move on its own.
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
  });
});

describe("trainer persistence", () => {
  it("writes practice history through to storage", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    installLayout();
    useTrainerStore.getState().start();
    report(0);

    const raw = store.getItem("qmk-flasher.trainerStats");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).byLayout["test-layout"][statKey(0, 0)].hits).toBe(1);
  });

  it("reloads that history on a fresh start of the app", async () => {
    const stats: StatsMap = {
      [statKey(0, 0)]: { attempts: 4, hits: 1, window: [0, 0, 1, 0], times: [900], lastAt: 5 },
    };
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        "qmk-flasher.trainerStats": serializeStats({ "test-layout": stats }),
        "qmk-flasher.trainerScope": "allLayers",
        "qmk-flasher.trainerReveal": "false",
      }),
    );

    // A new module registry is the closest thing to restarting the app.
    vi.resetModules();
    const fresh = await import("./trainerStore");
    const state = fresh.useTrainerStore.getState();

    expect(state.byLayout).toEqual({ "test-layout": stats });
    expect(state.scope).toBe("allLayers");
    expect(state.reveal).toBe(false);
  });

  it("starts clean when storage holds something unreadable", async () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "qmk-flasher.trainerStats": "{ truncated" }),
    );
    vi.resetModules();
    const fresh = await import("./trainerStore");

    expect(fresh.useTrainerStore.getState().byLayout).toEqual({});
  });

  it("survives storage being unavailable entirely", () => {
    // No localStorage at all (this file's default): a session still runs, it
    // just forgets afterwards.
    installLayout();
    useTrainerStore.getState().start();
    expect(() => report(0)).not.toThrow();
    expect(useTrainerStore.getState().answers).toHaveLength(1);
  });

  it("resetStats forgets only the active layout", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    installLayout();
    useTrainerStore.setState({
      byLayout: { "test-layout": { "0:0": { attempts: 1, hits: 1, window: [1], times: [10], lastAt: 1 } }, other: {} },
      layoutKey: "test-layout",
    });

    useTrainerStore.getState().resetStats();

    expect(useTrainerStore.getState().byLayout).toEqual({ other: {} });
  });
});

describe("trainer never touches the layout", () => {
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

  it("a whole drill leaves the real layout clean", () => {
    const before = useLayoutStore.getState().layout;
    expect(useLayoutStore.getState().isDirty()).toBe(false);

    useTrainerStore.setState({ scope: "allLayers" });
    useTrainerStore.getState().start();
    expect(useTrainerStore.getState().targets.length).toBeGreaterThan(0);

    for (const position of [0, 5, 12, 30, 55, 71]) {
      report(position, true);
      report(position, false);
    }
    useTrainerStore.getState().stop();

    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("drills every layer key on the real layout, latching ones included", () => {
    useTrainerStore.setState({ scope: "layerKeys" });
    useTrainerStore.getState().start();
    const { targets } = useTrainerStore.getState();

    // Every key that targets a layer used to be refused, or reduced to one
    // drillable witness; each is a plain target now. Counted off the layout
    // through the scope's own predicate, so a layout that grows another layer
    // key cannot silently shrink the drill and still pass.
    const layout = useLayoutStore.getState().layout!;
    const expected = layout.layers.flatMap((l, li) =>
      l.keys.flatMap((k, i) =>
        targetLayer(k) !== null ? [{ layer: li, position: i }] : [],
      ),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toHaveLength(expected.length);
    for (const at of expected) expect(targets).toContainEqual(at);

    // The specific regression: layer-taps count too, not just layer switches.
    const taps = layout.layers.flatMap((l, li) =>
      l.keys.flatMap((k, i) =>
        k.kind === "layerTap" ? [{ layer: li, position: i }] : [],
      ),
    );
    expect(taps.length).toBeGreaterThan(0);
    for (const at of taps) expect(targets).toContainEqual(at);
  });

  it("drills the real layout's silent keys too — nothing is left out for being invisible", () => {
    useTrainerStore.setState({ scope: "allLayers" });
    useTrainerStore.getState().start();
    const { targets } = useTrainerStore.getState();

    expect(targets.length).toBeGreaterThan(200);
    // QK_LOCK is the key this whole app exists for, and it is now drillable.
    const layout = useLayoutStore.getState().layout!;
    const lock = layout.layers.flatMap((l, li) =>
      l.keys.map((k, i) => (k.kind === "qkLock" ? { layer: li, position: i } : null)),
    );
    for (const at of lock) if (at) expect(targets).toContainEqual(at);
  });
});
