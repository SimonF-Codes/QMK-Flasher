import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMockStore } from "../lib/ipc";
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

/** One drillable key, so the prompt is deterministic without stubbing rng. */
const ONE_KEY = [layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base")];

/** Two drillable keys plus an MO(1) that can only be seen through a witness. */
const TWO_LAYERS = [
  layerWith(
    {
      0: { kind: "basic", code: "KC_A" },
      1: { kind: "basic", code: "KC_B" },
      5: { kind: "layerSwitch", action: "MO", layer: 1 },
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
    excluded: [],
    target: null,
    prompt: null,
    promptedAt: 0,
    answers: [],
    last: null,
    summary: null,
  });
  useLiveStore.setState({ enabled: true, mode: "trainer" });
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
    expect(target).toMatchObject({ layer: 0, position: 0, expect: "KC_A" });
    expect(prompt?.instruction).toBe("Press A on layer 0 · base");
  });

  it("scores a correct answer and records the reaction time", () => {
    vi.useFakeTimers();
    installLayout();
    useTrainerStore.getState().start();
    vi.advanceTimersByTime(420);

    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

    const { answers, byLayout, layoutKey } = useTrainerStore.getState();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ correct: true, ms: 420, got: "KC_A" });
    const stats = byLayout[layoutKey!];
    expect(stats[statKey(0, 0)]).toMatchObject({ attempts: 1, hits: 1, times: [420] });
  });

  it("scores a wrong key as a miss and says what arrived", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    // Force the prompt so the assertion doesn't depend on the weighted draw.
    const target = useTrainerStore
      .getState()
      .targets.find((t) => t.position === 0)!;
    useTrainerStore.setState({ target, promptedAt: Date.now() });

    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });

    const { last } = useTrainerStore.getState();
    expect(last).toMatchObject({ correct: false, expected: "KC_A", got: "KC_B" });
  });

  it("ignores a press it cannot resolve rather than calling it wrong", () => {
    installLayout();
    useTrainerStore.getState().start();

    // "Fn" maps to no QMK code — the same blind spot the log reports as
    // "no match". Scoring it would blame the user for our own limit.
    useLiveStore.getState().keyDown({ code: "Fn", key: "Fn" });

    expect(useTrainerStore.getState().answers).toEqual([]);
  });

  it("scores a layer key by its witness press", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.setState({ scope: "layerKeys" });
    useTrainerStore.getState().start();

    const { target, prompt } = useTrainerStore.getState();
    expect(target).toMatchObject({ layer: 0, position: 5, mode: "witness" });
    expect(prompt?.note).toContain("never reach the OS");

    // Holding MO(1) emits nothing, so the only event is the witness press.
    useLiveStore.getState().keyDown({ code: "KeyZ", key: "z" });
    expect(useTrainerStore.getState().answers[0].correct).toBe(true);
  });

  it("advances to a new prompt instead of asking twice in a row", () => {
    installLayout(TWO_LAYERS);
    useTrainerStore.getState().start();
    const first = useTrainerStore.getState().target!;

    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

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
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    expect(useTrainerStore.getState().answers).toEqual([]);

    useTrainerStore.getState().start();
    useTrainerStore.getState().stop();
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    expect(useTrainerStore.getState().answers).toEqual([]);
  });

  it("summarizes on stop", () => {
    installLayout();
    useTrainerStore.getState().start();
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });
    useLiveStore.getState().keyDown({ code: "KeyB", key: "b" });
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

    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

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
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

    expect(useLiveStore.getState().events[0]).toMatchObject({
      qmk: "KC_A",
      positions: [0],
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
    useLiveStore.getState().keyDown({ code: "KeyA", key: "a" });

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
    expect(() =>
      useLiveStore.getState().keyDown({ code: "KeyA", key: "a" }),
    ).not.toThrow();
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

    for (const code of ["KeyA", "KeyS", "KeyD", "Space", "Enter", "ArrowUp"]) {
      useLiveStore.getState().keyDown({ code, key: code });
      useLiveStore.getState().keyUp({ code, key: code });
    }
    useTrainerStore.getState().stop();

    expect(useLayoutStore.getState().layout).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });

  it("drills the real layout's layer keys through witnesses, and skips latchers", () => {
    useTrainerStore.setState({ scope: "layerKeys" });
    useTrainerStore.getState().start();
    const { targets, excluded } = useTrainerStore.getState();

    // The seeded layout's only momentary layer keys are its two LT()s, and its
    // 18 TO/TG keys latch and are refused.
    expect(excluded.filter((e) => e.reason === "latching")).toHaveLength(18);
    // Only one LT is drillable: LT(3) at position 40 leads to a layer built
    // entirely from macros and TO keys, none of which reach the OS, so there is
    // nothing to press that would prove the layer was active.
    expect(targets).toEqual([
      expect.objectContaining({ layer: 0, position: 58, mode: "witness" }),
    ]);
    expect(excluded).toContainEqual({
      layer: 0,
      position: 40,
      reason: "noWitness",
    });
  });

  it("drills the real layout's ordinary keys and admits the silent ones", () => {
    useTrainerStore.setState({ scope: "allLayers" });
    useTrainerStore.getState().start();
    const { targets, excluded } = useTrainerStore.getState();

    expect(targets.length).toBeGreaterThan(200);
    // QK_LOCK, the RGB keys and the macros are exactly what we cannot observe.
    expect(excluded.filter((e) => e.reason === "silent").length).toBeGreaterThan(0);
    expect(excluded.every((e) => e.reason !== "empty")).toBe(true);
  });
});
