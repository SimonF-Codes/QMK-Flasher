/**
 * Tutorial session state (zustand): whether the tour is open, where you are in
 * it, and the one bit that has to outlive the process — whether this user has
 * ever been offered it.
 *
 * Shaped like `trainerStore`: app-wide UI state that reads `layoutStore` and
 * never writes to it beyond following a step to its layer, so there is no
 * import cycle and no path by which taking the tour can dirty a layout.
 * Persistence uses the same localStorage-in-a-try/catch shape, because tests
 * and any non-DOM host have no such object.
 *
 * Two deliberate decisions:
 *
 *   - Steps are rebuilt from the layout, not frozen at `start()`. The tour is
 *     a description of the layout in front of you; if you follow a step and
 *     edit a key, or DemoLayout's richer default lands mid-session, the tour
 *     should be describing what is there now. `rebuild()` is idempotent and
 *     keeps your place.
 *   - `seen` is set the moment the tour is offered OR started, never when it
 *     is finished. Nobody gets asked twice, and nobody has to reach the end to
 *     stop being asked — which is the difference between an invitation and a
 *     trap.
 */
import { create } from "zustand";
import {
  buildTutorial,
  type Tutorial,
  type TutorialStep,
} from "../lib/tutorial";
import { useLayoutStore } from "./layoutStore";

const SEEN_KEY = "qmk-flasher.tutorialSeen";

function loadSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "true";
  } catch {
    /* localStorage unavailable (SSR / tests) — treat as a new user */
  }
  return false;
}

function persistSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "true");
  } catch {
    /* ignore persistence failures — the tour still works, it just re-offers */
  }
}

function forgetSeen(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}

/** The tour for whatever layout is loaded right now. */
function currentTutorial(): Tutorial {
  const { layout } = useLayoutStore.getState();
  return buildTutorial(
    layout,
    layout?.layers.map((l) => l.title),
  );
}

interface TutorialState {
  open: boolean;
  /** 0-based position in `steps`. */
  index: number;
  /** Has this user been offered the tour before? Persisted. */
  seen: boolean;
  /** The steps of the tour, rebuilt from the layout. Empty while closed. */
  steps: TutorialStep[];

  /** Open at the beginning. Also marks the tour as offered. */
  start(): void;
  /** Leave. Always available — every exit from the tour goes through here. */
  close(): void;
  next(): void;
  back(): void;
  goTo(index: number): void;
  /** Decline the invitation without opening it. */
  dismissOffer(): void;
  /** Re-derive the steps from the current layout, keeping your place. */
  rebuild(): void;
  /** Make the app offer the tour again, as if to a new user. */
  forget(): void;
}

export const useTutorialStore = create<TutorialState>()((set, get) => ({
  open: false,
  index: 0,
  seen: loadSeen(),
  steps: [],

  start() {
    persistSeen();
    const steps = currentTutorial().steps;
    set({ open: true, seen: true, index: 0, steps });
    showStep(steps[0]);
  },

  close() {
    // `steps` is dropped so a closed tour holds no stale description of a
    // layout that may be edited or replaced before it is opened again.
    set({ open: false, index: 0, steps: [] });
  },

  next() {
    const { open, index, steps } = get();
    if (!open || index >= steps.length - 1) return;
    set({ index: index + 1 });
    showStep(steps[index + 1]);
  },

  back() {
    const { open, index, steps } = get();
    if (!open || index <= 0) return;
    set({ index: index - 1 });
    showStep(steps[index - 1]);
  },

  goTo(index) {
    const { open, steps } = get();
    if (!open || index < 0 || index >= steps.length) return;
    set({ index });
    showStep(steps[index]);
  },

  rebuild() {
    if (!get().open) return;
    const steps = currentTutorial().steps;
    // Clamp rather than reset: the step count only changes if the topic list
    // does, but a shorter tour must not strand the index past the end.
    const index = Math.min(get().index, Math.max(0, steps.length - 1));
    set({ steps, index });
    showStep(steps[index]);
  },

  dismissOffer() {
    persistSeen();
    set({ seen: true });
  },

  forget() {
    forgetSeen();
    set({ seen: false });
  },
}));

/**
 * Bring a step's example into view. The highlight lives on one layer, so a step
 * pointing at a key on a layer you are not looking at would point at nothing —
 * same reasoning as the trainer's `showTarget`.
 *
 * It moves the layer and nothing else: it never selects the key, because
 * selecting opens the picker over the thing the step is asking you to look at.
 */
function showStep(step: TutorialStep | undefined): void {
  if (!step?.example) return;
  const { selectedLayer, selectLayer } = useLayoutStore.getState();
  if (selectedLayer !== step.example.layer) selectLayer(step.example.layer);
}

/**
 * The positions the open tour wants lit on `layer`, for the board to draw.
 * Empty whenever the tour is closed, has no example, or is pointing at another
 * layer — so the board never has to know what a tutorial step is.
 */
export function tutorialHighlight(
  state: Pick<TutorialState, "open" | "index" | "steps">,
  layer: number,
): readonly number[] {
  if (!state.open) return NO_KEYS;
  const example = state.steps[state.index]?.example;
  if (!example || example.layer !== layer) return NO_KEYS;
  return example.keys;
}

/** Shared empty result — a fresh `[]` per call would thrash zustand selectors. */
const NO_KEYS: readonly number[] = [];
