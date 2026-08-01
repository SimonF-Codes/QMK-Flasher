/**
 * Live view state (zustand): which positions are held down, a rolling log of
 * what the firmware emitted, the layer auto-follow policy, and which of the two
 * live modes is running.
 *
 * Live view has two modes over the same key plumbing. `monitor` is the original
 * one: it watches and logs, and asks nothing. `trainer` feeds every resolved
 * press to trainerStore, which prompts and scores. The capture, resolution and
 * press/afterglow rendering are identical in both — the mode only decides
 * whether anything is listening.
 *
 * Like displayStore, this is app-wide UI state and NOT part of any layout —
 * nothing here mutates the layout or touches dirty tracking. `enabled`,
 * `followLayer` and `mode` persist to localStorage; press state and the log are
 * in-memory only.
 *
 * It reads layoutStore (and calls selectLayer) so the whole press→match→follow
 * decision is one testable action rather than logic stranded in a component.
 * layoutStore does not know about this store, so there is no import cycle;
 * trainerStore likewise never imports back.
 */
import { create } from "zustand";
import {
  findLayerWithMatch,
  heldModifiers,
  qmkForEventCode,
} from "../lib/liveKeys";
import { useLayoutStore } from "./layoutStore";
import { useTrainerStore } from "./trainerStore";

const ENABLED_KEY = "qmk-flasher.liveEnabled";
const FOLLOW_KEY = "qmk-flasher.liveFollowLayer";
const MODE_KEY = "qmk-flasher.liveMode";

/** Watch and log (`monitor`) versus prompt and score (`trainer`). */
export type LiveMode = "monitor" | "trainer";

/** Cap on the event log; oldest entries fall off the end. */
export const LOG_LIMIT = 200;
/** How long a released key keeps glowing, so fast taps stay visible (ms). */
export const AFTERGLOW_MS = 220;

/** The subset of a KeyboardEvent we need — lets tests pass plain objects. */
export interface LiveKeyInput {
  code: string;
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface LiveEvent {
  id: number;
  at: number;
  type: "down" | "up";
  /** Raw KeyboardEvent.code. */
  code: string;
  /** The character actually produced (KeyboardEvent.key). */
  key: string;
  /** Resolved QMK keycode, or null when we don't recognize the code. */
  qmk: string | null;
  mods: string[];
  /** Board positions that emit this key on the matched layer. */
  positions: number[];
  /** Layer the match came from, or null when nothing matched. */
  layer: number | null;
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* localStorage unavailable (SSR / tests) — fall through to default */
  }
  return fallback;
}

function loadMode(): LiveMode {
  try {
    if (localStorage.getItem(MODE_KEY) === "trainer") return "trainer";
  } catch {
    /* localStorage unavailable (SSR / tests) — fall through to default */
  }
  return "monitor";
}

function persist(key: string, value: string | boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore persistence failures */
  }
}

interface LiveState {
  enabled: boolean;
  /** Which live mode is running. Trainer sessions only exist in `trainer`. */
  mode: LiveMode;
  /** Auto-switch the visible layer to wherever a pressed key was found. */
  followLayer: boolean;
  /**
   * Layer the user pinned by clicking a tab while live. Auto-follow is paused
   * while set — the manual override that guarantees the view matches reality
   * when inference guesses wrong.
   */
  pinnedLayer: number | null;
  /** Positions currently held down. */
  pressed: ReadonlySet<number>;
  /** Recently released positions, still glowing. */
  recent: ReadonlySet<number>;
  events: LiveEvent[];
  nextId: number;

  setEnabled(enabled: boolean): void;
  /** Switch live modes. Leaving `trainer` ends any running session. */
  setMode(mode: LiveMode): void;
  setFollowLayer(follow: boolean): void;
  /** Pin the visible layer (pauses auto-follow). */
  pinLayer(layer: number): void;
  /** Drop the pin and resume auto-follow. */
  resumeFollow(): void;
  keyDown(e: LiveKeyInput): void;
  keyUp(e: LiveKeyInput): void;
  /** Drop all press state — used on window blur so keys don't stick lit. */
  releaseAll(): void;
  clearLog(): void;
}

/** Timers clearing the afterglow, so disabling live view can cancel them. */
const glowTimers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelGlowTimers(): void {
  for (const t of glowTimers.values()) clearTimeout(t);
  glowTimers.clear();
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  enabled: loadBool(ENABLED_KEY, false),
  mode: loadMode(),
  followLayer: loadBool(FOLLOW_KEY, true),
  pinnedLayer: null,
  pressed: new Set<number>(),
  recent: new Set<number>(),
  events: [],
  nextId: 1,

  setEnabled(enabled) {
    persist(ENABLED_KEY, enabled);
    cancelGlowTimers();
    // Turning live view off stops key capture, so a trainer session would sit
    // there with a prompt nobody can answer — end it and keep the summary.
    if (!enabled) useTrainerStore.getState().stop();
    // Leaving live view drops transient state but keeps the log, so you can
    // still read what happened after toggling off.
    set({
      enabled,
      pressed: new Set<number>(),
      recent: new Set<number>(),
      pinnedLayer: null,
    });
  },

  setMode(mode) {
    persist(MODE_KEY, mode);
    if (mode !== "trainer") useTrainerStore.getState().stop();
    set({ mode });
  },

  setFollowLayer(follow) {
    persist(FOLLOW_KEY, follow);
    set({ followLayer: follow, pinnedLayer: follow ? get().pinnedLayer : null });
  },

  pinLayer(layer) {
    set({ pinnedLayer: layer });
  },

  resumeFollow() {
    set({ pinnedLayer: null });
  },

  keyDown(e) {
    const { layout, selectedLayer, selectLayer } = useLayoutStore.getState();
    const qmk = qmkForEventCode(e.code);
    const match =
      layout && qmk
        ? findLayerWithMatch(layout.layers, qmk, selectedLayer)
        : null;

    // Auto-follow: only move the view when the key isn't on the current layer,
    // follow is on, and the user hasn't pinned a layer.
    const { followLayer, pinnedLayer } = get();
    if (
      match &&
      match.layer !== selectedLayer &&
      followLayer &&
      pinnedLayer === null
    ) {
      selectLayer(match.layer);
    }

    const positions = match?.positions ?? [];
    const pressed = new Set(get().pressed);
    const recent = new Set(get().recent);
    for (const p of positions) {
      pressed.add(p);
      recent.delete(p);
      const t = glowTimers.get(p);
      if (t) {
        clearTimeout(t);
        glowTimers.delete(p);
      }
    }

    // Auto-repeat re-fires keydown; keep the highlight but don't flood the log.
    if (e.repeat) {
      set({ pressed, recent });
      return;
    }

    const id = get().nextId;
    const event: LiveEvent = {
      id,
      at: Date.now(),
      type: "down",
      code: e.code,
      key: e.key,
      qmk,
      mods: heldModifiers({
        ctrlKey: !!e.ctrlKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        metaKey: !!e.metaKey,
      }),
      positions,
      layer: match?.layer ?? null,
    };
    set({
      pressed,
      recent,
      nextId: id + 1,
      events: [event, ...get().events].slice(0, LOG_LIMIT),
    });

    // Trainer mode grades on key DOWN, not up: the reaction time we care about
    // ends when you commit to a key, and waiting for the release would let a
    // long hold look like slow recall. Repeats already returned above.
    if (get().mode === "trainer") useTrainerStore.getState().answer(qmk);
  },

  keyUp(e) {
    const { layout, selectedLayer } = useLayoutStore.getState();
    const qmk = qmkForEventCode(e.code);
    const match =
      layout && qmk
        ? findLayerWithMatch(layout.layers, qmk, selectedLayer)
        : null;
    const positions = match?.positions ?? [];

    const pressed = new Set(get().pressed);
    const recent = new Set(get().recent);
    for (const p of positions) {
      pressed.delete(p);
      recent.add(p);
      const prev = glowTimers.get(p);
      if (prev) clearTimeout(prev);
      glowTimers.set(
        p,
        setTimeout(() => {
          glowTimers.delete(p);
          const next = new Set(useLiveStore.getState().recent);
          if (next.delete(p)) useLiveStore.setState({ recent: next });
        }, AFTERGLOW_MS),
      );
    }

    const id = get().nextId;
    const event: LiveEvent = {
      id,
      at: Date.now(),
      type: "up",
      code: e.code,
      key: e.key,
      qmk,
      mods: heldModifiers({
        ctrlKey: !!e.ctrlKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        metaKey: !!e.metaKey,
      }),
      positions,
      layer: match?.layer ?? null,
    };
    set({
      pressed,
      recent,
      nextId: id + 1,
      events: [event, ...get().events].slice(0, LOG_LIMIT),
    });
  },

  releaseAll() {
    cancelGlowTimers();
    set({ pressed: new Set<number>(), recent: new Set<number>() });
  },

  clearLog() {
    set({ events: [] });
  },
}));
