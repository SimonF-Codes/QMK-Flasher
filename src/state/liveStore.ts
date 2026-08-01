/**
 * Live view state (zustand): which switches are held down, which layer the
 * board is on, a rolling log of what happened, and which of the two live modes
 * is running.
 *
 * The source of truth is the firmware. `key-report` gives a matrix position for
 * every switch — including the ones QMK consumes and never sends to the OS
 * (MO/TO/TG/TT, QK_LOCK, RGB_*) — and `layer-report` gives the active layer as
 * fact rather than inference. Positions come from `positionForMatrix`, an exact
 * lookup, so nothing here guesses which key produced what.
 *
 * There is **no fallback to browser key events**. If reports are not arriving,
 * the panel says so; silently degrading to a view that cannot see half the
 * board would be worse than saying it is off. The browser is still read for the
 * one thing the firmware cannot answer — the character the OS actually received
 * — which `emitted()` attaches to the report that caused it.
 *
 * Like displayStore, this is app-wide UI state and NOT part of any layout —
 * nothing here mutates the layout or touches dirty tracking. `enabled`,
 * `followLayer` and `mode` persist to localStorage; press state and the log are
 * in-memory only.
 *
 * It reads layoutStore (and calls selectLayer) so the whole report→follow
 * decision is one testable action rather than logic stranded in a component.
 * layoutStore does not know about this store, so there is no import cycle;
 * trainerStore likewise never imports back.
 */
import { create } from "zustand";
import { positionForMatrix } from "../lib/geometry";
import { ipc, toAppError } from "../lib/ipc";
import {
  emittedTapCode,
  heldModifiers,
  qmkForEventCode,
  resolvedAction,
} from "../lib/liveKeys";
import type { AppError, KeyReport, LayerReport } from "../lib/types";
import { useLayoutStore } from "./layoutStore";
import { useTrainerStore } from "./trainerStore";

const ENABLED_KEY = "qmk-flasher.liveEnabled";
const FOLLOW_KEY = "qmk-flasher.liveFollowLayer";
const MODE_KEY = "qmk-flasher.liveMode";

/** Watch and log (`monitor`) versus prompt and score (`trainer`). */
export type LiveMode = "monitor" | "trainer";

/**
 * Where the capture stands. `waiting` means the channel opened but the board
 * has not said anything yet — press a key and it becomes `live`.
 */
export type LiveStatus =
  | "off"
  | "connecting"
  | "waiting"
  | "live"
  | "unavailable";

/** Cap on the event log; oldest entries fall off the end. */
export const LOG_LIMIT = 200;
/** How long a released key keeps glowing, so fast taps stay visible (ms). */
export const AFTERGLOW_MS = 220;
/**
 * How long after a key report a browser keystroke still counts as its output.
 * The firmware reports the switch *before* QMK sends the HID usage, so the
 * character always follows its report — within a frame or two, never before.
 */
export const EMIT_WINDOW_MS = 250;

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
  /** Matrix coordinates exactly as the firmware reported them. */
  row: number;
  col: number;
  /** Board position, or null when the geometry has no switch there. */
  position: number | null;
  /** The board's active layer when the switch was reported. */
  layer: number;
  /** What the layout on screen says that switch does on that layer. */
  qmk: string | null;
  /** QMK code the OS actually received, once the browser reports it. */
  emitted: string | null;
  /** The character produced (KeyboardEvent.key), or null if none arrived. */
  char: string | null;
  mods: string[];
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
  status: LiveStatus;
  /** Why the channel could not be opened. Set only with status `unavailable`. */
  error: AppError | null;
  /** Auto-switch the visible layer to the one the board reports. */
  followLayer: boolean;
  /**
   * Layer the user pinned by clicking a tab while live. Auto-follow is paused
   * while set — useful for studying one layer while typing on another.
   */
  pinnedLayer: number | null;
  /** The board's topmost active layer, as last reported. */
  activeLayer: number;
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
  /** Open the raw-HID channel. Sets `unavailable` + `error` if it can't. */
  connect(): Promise<void>;
  /** Release the channel back to Keymapp/Oryx and drop press state. */
  disconnect(): Promise<void>;
  /** A switch changed state, straight from the firmware. */
  keyReport(r: KeyReport): void;
  /** The board changed layer, straight from the firmware. */
  layerReport(r: LayerReport): void;
  /** Attach the character the OS received to the report that produced it. */
  emitted(e: LiveKeyInput): void;
  /** Drop all press state — used when the channel goes away mid-hold. */
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
  status: "off",
  error: null,
  followLayer: loadBool(FOLLOW_KEY, true),
  pinnedLayer: null,
  activeLayer: 0,
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

  async connect() {
    set({ status: "connecting", error: null });
    try {
      await ipc.startKeyReporting();
      // Nothing has been heard from the board yet — say that rather than
      // claiming a live view that has shown nothing.
      set({ status: "waiting", error: null });
    } catch (e) {
      set({ status: "unavailable", error: toAppError(e) });
    }
  },

  async disconnect() {
    cancelGlowTimers();
    set({
      status: "off",
      error: null,
      pressed: new Set<number>(),
      recent: new Set<number>(),
    });
    try {
      await ipc.stopKeyReporting();
    } catch {
      /* stopping is best-effort — the listener exits on its own read tick */
    }
  },

  keyReport({ row, col, pressed: down }) {
    const position = positionForMatrix(row, col);
    const layer = get().activeLayer;

    const pressed = new Set(get().pressed);
    const recent = new Set(get().recent);
    if (position !== null) {
      const prev = glowTimers.get(position);
      if (prev) {
        clearTimeout(prev);
        glowTimers.delete(position);
      }
      if (down) {
        pressed.add(position);
        recent.delete(position);
      } else {
        pressed.delete(position);
        recent.add(position);
        glowTimers.set(
          position,
          setTimeout(() => {
            glowTimers.delete(position);
            const next = new Set(useLiveStore.getState().recent);
            if (next.delete(position)) useLiveStore.setState({ recent: next });
          }, AFTERGLOW_MS),
        );
      }
    }

    const { layout } = useLayoutStore.getState();
    const action =
      layout && position !== null ? resolvedAction(layout, layer, position) : null;

    const id = get().nextId;
    const event: LiveEvent = {
      id,
      at: Date.now(),
      type: down ? "down" : "up",
      row,
      col,
      position,
      layer,
      qmk: action ? emittedTapCode(action) : null,
      emitted: null,
      char: null,
      mods: [],
    };
    set({
      // The first report is the proof the channel really works.
      status: "live",
      pressed,
      recent,
      nextId: id + 1,
      events: [event, ...get().events].slice(0, LOG_LIMIT),
    });

    // Trainer mode grades on key DOWN, not up: the reaction time we care about
    // ends when you commit to a key, and waiting for the release would let a
    // long hold look like slow recall.
    if (down && position !== null && get().mode === "trainer") {
      useTrainerStore.getState().answer(layer, position);
    }
  },

  layerReport({ layer }) {
    const { layout, selectedLayer, selectLayer } = useLayoutStore.getState();
    set({ status: "live", activeLayer: layer });

    // Auto-follow: the board says where it is, so this only has to obey.
    const { followLayer, pinnedLayer } = get();
    const exists = !!layout?.layers[layer];
    if (exists && followLayer && pinnedLayer === null && layer !== selectedLayer) {
      selectLayer(layer);
    }
  },

  emitted(e) {
    // Auto-repeat re-fires keydown with no new switch report behind it.
    if (e.repeat) return;
    const events = get().events;
    const head = events[0];
    if (!head || head.type !== "down" || head.char !== null) return;
    if (Date.now() - head.at > EMIT_WINDOW_MS) return;
    const annotated: LiveEvent = {
      ...head,
      emitted: qmkForEventCode(e.code),
      char: e.key,
      mods: heldModifiers({
        ctrlKey: !!e.ctrlKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        metaKey: !!e.metaKey,
      }),
    };
    set({ events: [annotated, ...events.slice(1)] });
  },

  releaseAll() {
    cancelGlowTimers();
    set({ pressed: new Set<number>(), recent: new Set<number>() });
  },

  clearLog() {
    set({ events: [] });
  },
}));
