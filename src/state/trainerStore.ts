/**
 * Trainer session state (zustand): the current prompt, this session's answers,
 * and the per-key history that decides what gets asked next.
 *
 * Like liveStore this is app-wide UI state and NOT part of any layout — it
 * never mutates the layout or touches dirty tracking. All the decisions live in
 * `lib/trainer.ts`; this file only holds them together, reads layoutStore, and
 * persists.
 *
 * Persistence follows liveStore's `loadBool`/`persist` shape: localStorage,
 * wrapped in try/catch because tests and any non-DOM host have no such object.
 * Per-key history is the one thing that MUST survive a restart — the difficulty
 * weighting is meaningless if every launch starts from "never seen this key".
 *
 * It reads layoutStore (and calls selectLayer while revealing a target) but
 * layoutStore does not know about this store, so there is no import cycle.
 */
import { create } from "zustand";
import {
  buildTargets,
  grade,
  pickTarget,
  promptFor,
  recordAnswer,
  parseStats,
  serializeStats,
  statKey,
  summarize,
  type Answer,
  type DrillScope,
  type Prompt,
  type SessionSummary,
  type StatsByLayout,
  type StatsMap,
  type TrainerTarget,
} from "../lib/trainer";
import { useLayoutStore } from "./layoutStore";

const STATS_KEY = "qmk-flasher.trainerStats";
const SCOPE_KEY = "qmk-flasher.trainerScope";
const REVEAL_KEY = "qmk-flasher.trainerReveal";

const SCOPES: readonly string[] = ["currentLayer", "allLayers", "layerKeys"];

function loadStats(): StatsByLayout {
  try {
    return parseStats(localStorage.getItem(STATS_KEY));
  } catch {
    /* localStorage unavailable (SSR / tests) — start with no history */
  }
  return {};
}

function loadScope(): DrillScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    if (v && SCOPES.includes(v)) return v as DrillScope;
  } catch {
    /* localStorage unavailable (SSR / tests) — fall through to default */
  }
  return "currentLayer";
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

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore persistence failures */
  }
}

/**
 * Which bucket of stats belongs to the loaded layout. `activeId` is the real
 * id; the name is a fallback for the case layoutStore could not match a summary
 * (see its `matchActiveId`) — better a stable-ish key than throwing history
 * from different layouts into one pile.
 */
function activeLayoutKey(): string | null {
  const { activeId, layout } = useLayoutStore.getState();
  return activeId ?? layout?.meta.name ?? null;
}

interface TrainerState {
  scope: DrillScope;
  /**
   * Show the target on the board (and switch to its layer so it is visible).
   * Off turns the drill into pure recall: the prompt still names the key and
   * its layer, but you have to find the position yourself.
   */
  reveal: boolean;
  running: boolean;
  /** Stats for every layout drilled so far, keyed by layout id. */
  byLayout: StatsByLayout;
  /** Layout the running session belongs to; also the key into `byLayout`. */
  layoutKey: string | null;
  /**
   * Targets are frozen when the session starts, so editing the layout
   * mid-drill cannot silently change what a prompt means.
   */
  targets: TrainerTarget[];
  target: TrainerTarget | null;
  prompt: Prompt | null;
  /** When the current prompt appeared (epoch ms) — the reaction-time origin. */
  promptedAt: number;
  answers: Answer[];
  /** The answer just given, for immediate feedback. */
  last: Answer | null;
  /** Set when a session ends; cleared when the next one starts. */
  summary: SessionSummary | null;

  setScope(scope: DrillScope): void;
  setReveal(reveal: boolean): void;
  start(): void;
  stop(): void;
  /** Move on without scoring — for a prompt you consider unanswerable. */
  skip(): void;
  /** Wipe the active layout's history. Difficulty weighting starts over. */
  resetStats(): void;
  /**
   * Score a switch the board reported. Called by liveStore on key DOWN, with
   * the layer the board was on and the position it resolved to.
   */
  answer(layer: number, position: number, now?: number): void;
}

/** Shared empty bucket — a fresh `{}` per call would thrash zustand selectors. */
const EMPTY_STATS: StatsMap = {};

/** The stats bucket for the layout a session is (or would be) running against. */
export function statsFor(state: {
  byLayout: StatsByLayout;
  layoutKey: string | null;
}): StatsMap {
  return (state.layoutKey && state.byLayout[state.layoutKey]) || EMPTY_STATS;
}

export const useTrainerStore = create<TrainerState>()((set, get) => ({
  scope: loadScope(),
  reveal: loadBool(REVEAL_KEY, true),
  running: false,
  byLayout: loadStats(),
  layoutKey: null,
  targets: [],
  target: null,
  prompt: null,
  promptedAt: 0,
  answers: [],
  last: null,
  summary: null,

  setScope(scope) {
    persist(SCOPE_KEY, scope);
    set({ scope });
  },

  setReveal(reveal) {
    persist(REVEAL_KEY, String(reveal));
    set({ reveal });
    const { running, target } = get();
    if (reveal && running && target) showTarget(target);
  },

  start() {
    const { layout, selectedLayer } = useLayoutStore.getState();
    if (!layout) return;
    const layoutKey = activeLayoutKey();
    const targets = buildTargets(layout, get().scope, selectedLayer);

    const stats = statsFor({ byLayout: get().byLayout, layoutKey });
    const target = pickTarget(targets, stats);
    set({
      running: true,
      layoutKey,
      targets,
      target,
      prompt: target ? promptFor(layout, target) : null,
      promptedAt: Date.now(),
      answers: [],
      last: null,
      summary: null,
    });
    if (target && get().reveal) showTarget(target);
  },

  stop() {
    if (!get().running) return;
    set({
      running: false,
      target: null,
      prompt: null,
      summary: summarize(get().answers),
    });
  },

  skip() {
    const { running, target } = get();
    if (!running || !target) return;
    set(nextPrompt(get(), target));
    revealCurrent(get());
  },

  resetStats() {
    const layoutKey = get().layoutKey ?? activeLayoutKey();
    if (!layoutKey) return;
    const { [layoutKey]: _dropped, ...rest } = get().byLayout;
    persist(STATS_KEY, serializeStats(rest));
    set({ byLayout: rest, layoutKey });
  },

  answer(layer, position, now = Date.now()) {
    const { running, target, promptedAt, layoutKey } = get();
    if (!running || !target) return;
    // Presses made on another layer are how you GET to the target's layer, not
    // attempts at it. Scoring them would grade the route instead of the
    // destination; the prompt says as much (see promptFor's note).
    if (layer !== target.layer) return;

    const correct = grade(target, position);
    const key = statKey(target.layer, target.position);
    const record: Answer = {
      key,
      layer: target.layer,
      position: target.position,
      correct,
      ms: Math.max(0, now - promptedAt),
      got: position,
    };

    const bucket = statsFor({ byLayout: get().byLayout, layoutKey });
    const byLayout = layoutKey
      ? { ...get().byLayout, [layoutKey]: recordAnswer(bucket, key, correct, record.ms, now) }
      : get().byLayout;
    persist(STATS_KEY, serializeStats(byLayout));

    set({ byLayout, answers: [...get().answers, record], last: record });
    set(nextPrompt(get(), target));
    revealCurrent(get());
  },
}));

/**
 * Bring the target into view. Only meaningful while `reveal` is on: the
 * highlight lives on one layer, so revealing a target on a layer you aren't
 * looking at would show you nothing at all.
 */
function showTarget(target: TrainerTarget): void {
  const { selectedLayer, selectLayer } = useLayoutStore.getState();
  if (selectedLayer !== target.layer) selectLayer(target.layer);
}

function revealCurrent(state: TrainerState): void {
  if (state.reveal && state.target) showTarget(state.target);
}

/** The next prompt, avoiding an immediate repeat of `previous`. */
function nextPrompt(
  state: TrainerState,
  previous: TrainerTarget,
): Partial<TrainerState> {
  const { targets, byLayout, layoutKey } = state;
  const layout = useLayoutStore.getState().layout;
  const next = pickTarget(
    targets,
    statsFor({ byLayout, layoutKey }),
    Math.random,
    previous,
  );
  return {
    target: next,
    prompt: next && layout ? promptFor(layout, next) : null,
    promptedAt: Date.now(),
  };
}
