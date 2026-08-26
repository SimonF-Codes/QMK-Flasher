/**
 * Tour session state.
 *
 * The properties worth pinning are the ones that keep it from being a trap:
 * it is offered exactly once, closing always works, the ends do not run off,
 * and it follows a step onto that step's layer without touching the layout.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TUTORIAL_LENGTH } from "../lib/tutorial";
import type { KeyAction, Layer, LayoutFile } from "../lib/types";
import { useLayoutStore } from "./layoutStore";
import { tutorialHighlight, useTutorialStore } from "./tutorialStore";

const SEEN_KEY = "qmk-flasher.tutorialSeen";

function layerWith(overrides: Record<number, KeyAction>, title: string): Layer {
  const keys: KeyAction[] = Array.from({ length: 72 }, () => ({
    kind: "transparent" as const,
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

const MACRO: KeyAction = {
  kind: "macro",
  label: "Sign-off",
  steps: [{ code: "KC_S", delay: 100, mods: [] }],
};

/** The only macro sits on layer 1, so following it has to change layers. */
const TWO_LAYERS = [
  layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base"),
  layerWith({ 20: MACRO }, "symbols"),
];

function installLayout(layers: Layer[] = TWO_LAYERS): LayoutFile {
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

const store = () => useTutorialStore.getState();

/** Walk to the step that has an example, whichever number it turned out to be. */
function goToExampleStep(): number {
  const i = store().steps.findIndex((s) => s.example);
  store().goTo(i);
  return i;
}

beforeEach(() => {
  useTutorialStore.setState({ open: false, index: 0, seen: false, steps: [] });
  installLayout();
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("opening and leaving", () => {
  it("starts at the beginning with the whole tour built", () => {
    store().start();
    expect(store().open).toBe(true);
    expect(store().index).toBe(0);
    expect(store().steps).toHaveLength(TUTORIAL_LENGTH);
  });

  it("closes from anywhere, and keeps nothing behind", () => {
    store().start();
    store().goTo(6);
    store().close();
    expect(store()).toMatchObject({ open: false, index: 0, steps: [] });
  });

  it("does nothing on next/back/goTo while closed", () => {
    store().next();
    store().back();
    store().goTo(3);
    expect(store()).toMatchObject({ open: false, index: 0 });
  });
});

describe("moving through it", () => {
  beforeEach(() => store().start());

  it("advances and returns", () => {
    store().next();
    store().next();
    expect(store().index).toBe(2);
    store().back();
    expect(store().index).toBe(1);
  });

  it("stops at both ends instead of running off", () => {
    store().back();
    expect(store().index).toBe(0);
    store().goTo(TUTORIAL_LENGTH - 1);
    store().next();
    expect(store().index).toBe(TUTORIAL_LENGTH - 1);
  });

  it("refuses a jump outside the tour", () => {
    store().goTo(-1);
    expect(store().index).toBe(0);
    store().goTo(TUTORIAL_LENGTH);
    expect(store().index).toBe(0);
  });
});

describe("following a step to its key", () => {
  it("switches to the layer the example lives on", () => {
    store().start();
    expect(useLayoutStore.getState().selectedLayer).toBe(0);
    const i = store().steps.findIndex((s) => s.example?.layer === 1);
    expect(i).toBeGreaterThan(-1);
    store().goTo(i);
    expect(useLayoutStore.getState().selectedLayer).toBe(1);
  });

  it("never selects the key, which would open the picker over it", () => {
    store().start();
    goToExampleStep();
    expect(useLayoutStore.getState().selectedKey).toBeNull();
  });

  it("leaves the layout untouched", () => {
    const before = JSON.stringify(useLayoutStore.getState().layout);
    store().start();
    for (let i = 0; i < TUTORIAL_LENGTH; i++) store().next();
    store().close();
    expect(JSON.stringify(useLayoutStore.getState().layout)).toBe(before);
    expect(useLayoutStore.getState().isDirty()).toBe(false);
  });
});

describe("the highlight the board draws", () => {
  it("is the example's keys, on the example's layer only", () => {
    store().start();
    const i = store().steps.findIndex((s) => s.example?.layer === 1);
    store().goTo(i);
    expect(tutorialHighlight(store(), 1)).toEqual([20]);
    expect(tutorialHighlight(store(), 0)).toEqual([]);
  });

  it("is empty while the tour is closed", () => {
    expect(tutorialHighlight(store(), 0)).toEqual([]);
  });

  it("is empty, not stale, on a step with nothing to point at", () => {
    store().start();
    const i = store().steps.findIndex((s) => !s.example);
    store().goTo(i);
    expect(tutorialHighlight(store(), 0)).toEqual([]);
    expect(tutorialHighlight(store(), 1)).toEqual([]);
  });

  it("returns the same array each time, so the board does not re-render", () => {
    expect(tutorialHighlight(store(), 0)).toBe(tutorialHighlight(store(), 3));
  });
});

describe("rebuilding under a changing layout", () => {
  it("re-derives the steps and keeps your place", () => {
    store().start();
    const i = goToExampleStep();
    installLayout([layerWith({ 5: MACRO }, "base")]);
    store().rebuild();
    expect(store().index).toBe(i);
    expect(store().steps).toHaveLength(TUTORIAL_LENGTH);
    expect(store().steps.find((s) => s.id === "macro")!.example).toMatchObject({
      keys: [5],
    });
  });

  it("does nothing while closed, so a closed tour cannot go stale", () => {
    store().rebuild();
    expect(store().steps).toEqual([]);
  });
});

describe("being offered exactly once", () => {
  it("remembers that it was started", () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    store().start();
    expect(store().seen).toBe(true);
    expect(storage.data.get(SEEN_KEY)).toBe("true");
  });

  it("remembers a declined invitation without opening anything", () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    store().dismissOffer();
    expect(store()).toMatchObject({ seen: true, open: false });
    expect(storage.data.get(SEEN_KEY)).toBe("true");
  });

  it("stops being seen when the user asks to be offered it again", () => {
    const storage = fakeStorage({ [SEEN_KEY]: "true" });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    useTutorialStore.setState({ seen: true });
    store().forget();
    expect(store().seen).toBe(false);
    expect(storage.data.has(SEEN_KEY)).toBe(false);
  });

  it("works with no localStorage at all — it just re-offers", () => {
    expect(() => store().start()).not.toThrow();
    expect(store().open).toBe(true);
  });
});
