/**
 * Trainer mode: choosing what to ask for, deciding whether the answer is even
 * observable, scoring it, and weighting the next question toward weak keys.
 *
 * Pure — no store, no React, no clock and no randomness of its own (callers
 * pass `now` / `rng`), so every decision here is testable.
 *
 * The load-bearing constraint is the one liveKeys.ts opens with: we observe the
 * board through `KeyboardEvent`, i.e. AFTER QMK has finished with the press. A
 * key the firmware consumes (MO/TG/TO/TT, QK_LOCK, RGB_*, macros) emits nothing
 * to the OS, so "did you press it?" is a question this trainer physically
 * cannot answer. Marking such a key wrong because we cannot see it would be a
 * lie, so every position is classified up front into one of three buckets:
 *
 *   direct   — the key emits a code; press it, we see it.
 *   witness  — a MOMENTARY layer key (MO / TT / LT). We cannot see the switch,
 *              but we can see its consequence: hold it and press a key that
 *              emits something different on the layer it activates. That second
 *              press is the proof the switch happened.
 *   excluded — everything else, carrying a reason the UI shows verbatim.
 *
 * TG/TO are excluded on purpose even though they are layer keys: they LATCH.
 * Scoring one would leave the board parked on another layer with no event to
 * tell us it came back, so every later prompt in the session would be graded
 * against the wrong reality.
 *
 * What we still cannot rule out, in either mode: two positions that emit the
 * same code are indistinguishable to us. Those targets are flagged `ambiguous`
 * and the UI says so rather than pretending the answer was unique.
 */
import { tapLabel } from "./labels";
import { targetLayer } from "./led";
import { canonicalCode, emittedTapCode } from "./liveKeys";
import type { Layer, LayoutFile } from "./types";

/** What the user chose to drill. */
export type DrillScope = "currentLayer" | "allLayers" | "layerKeys";

export const DRILL_SCOPES: readonly DrillScope[] = [
  "currentLayer",
  "allLayers",
  "layerKeys",
];

export const SCOPE_LABEL: Readonly<Record<DrillScope, string>> = {
  currentLayer: "Current layer",
  allLayers: "All layers",
  layerKeys: "Layer keys",
};

/**
 * The layer that is active when nothing is held. Witness selection compares
 * against it because that is the state the user answers a prompt from — if a
 * witness press produces the same code with and without the layer key held,
 * the press proves nothing.
 */
export const BASE_LAYER = 0;

/** How the trainer will observe the answer. */
export type TargetMode = "direct" | "witness";

/** Why a position cannot be drilled at all. */
export type ExcludeReason = "empty" | "silent" | "latching" | "noWitness";

export const EXCLUDE_REASON_TEXT: Readonly<Record<ExcludeReason, string>> = {
  empty: "nothing assigned",
  silent: "the firmware consumes it — nothing reaches the OS",
  latching: "TG/TO latch the board onto another layer, which we can't see undone",
  noWitness: "no key on the target layer emits anything the base layer can't",
};

export interface Witness {
  /** Layer the witness key lives on — the one the target key activates. */
  layer: number;
  position: number;
  /** The code that position emits while `layer` is active. */
  code: string;
}

export interface TrainerTarget {
  /** Layer the prompted key lives on. */
  layer: number;
  /** Position in LAYOUT-arg order. */
  position: number;
  mode: TargetMode;
  /** The QMK code that counts as a correct answer. */
  expect: string;
  /** Set for `witness` mode: the key to press while holding the target. */
  witness: Witness | null;
  /**
   * Some other position in the layout also emits `expect`, so a correct-looking
   * answer might have come from the wrong key. We cannot tell them apart.
   */
  ambiguous: boolean;
}

export interface ExcludedPosition {
  layer: number;
  position: number;
  reason: ExcludeReason;
}

export type Classified =
  | { ok: true; target: TrainerTarget }
  | { ok: false; excluded: ExcludedPosition };

/** Stats are keyed by layer+position within one layout. */
export function statKey(layer: number, position: number): string {
  return `${layer}:${position}`;
}

/** Convenience for the common "does this target match that one" test. */
export function sameTarget(
  a: { layer: number; position: number } | null | undefined,
  b: { layer: number; position: number } | null | undefined,
): boolean {
  return !!a && !!b && a.layer === b.layer && a.position === b.position;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** How many positions on `layer` emit `code` on a plain tap. */
function layerEmitCount(layer: Layer | undefined, code: string): number {
  if (!layer) return 0;
  return layer.keys.reduce(
    (n, action) => (emittedTapCode(action) === code ? n + 1 : n),
    0,
  );
}

/** Every position across the whole layout that emits `code` on a plain tap. */
function emitterCount(layout: LayoutFile, code: string): number {
  return layout.layers.reduce((n, l) => n + layerEmitCount(l, code), 0);
}

/**
 * A key on `layer` whose press proves `layer` was active.
 *
 * Preference order matters. The strong witness emits something no key on the
 * base layer emits at all, so the code cannot be produced any other way. The
 * weak witness only differs from what the SAME position emits on the base
 * layer — it still catches the user who presses the right position without
 * holding the layer key, which is the mistake worth drilling, but a user
 * pressing a different key that happens to emit the same code would slip
 * through. Weak witnesses are reported so the caller can flag them.
 */
export function findWitness(
  layout: LayoutFile,
  layerIndex: number,
): { witness: Witness; strong: boolean } | null {
  const layer = layout.layers[layerIndex];
  if (!layer || layerIndex === BASE_LAYER) return null;
  const base = layout.layers[BASE_LAYER];

  let weak: Witness | null = null;
  for (let i = 0; i < layer.keys.length; i++) {
    // `transparent` and the silent kinds both come back null here — neither can
    // prove anything, the first because it emits whatever the lower layer would
    // have emitted anyway.
    const code = emittedTapCode(layer.keys[i]);
    if (code === null) continue;
    if (base && emittedTapCode(base.keys[i]) === code) continue;
    const witness: Witness = { layer: layerIndex, position: i, code };
    if (layerEmitCount(base, code) === 0) return { witness, strong: true };
    weak ??= witness;
  }
  return weak ? { witness: weak, strong: false } : null;
}

/**
 * Decide whether a position can be drilled, and how.
 *
 * `asLayerKey` forces a layer key to be drilled as a layer key: an LT() is
 * directly observable by its tap, but when the session is drilling layer
 * navigation the thing being tested is the hold, not the tap.
 */
export function classifyPosition(
  layout: LayoutFile,
  layer: number,
  position: number,
  asLayerKey = false,
): Classified {
  const action = layout.layers[layer]?.keys[position];
  const excluded = (reason: ExcludeReason): Classified => ({
    ok: false,
    excluded: { layer, position, reason },
  });
  if (!action) return excluded("empty");
  if (action.kind === "none" || action.kind === "transparent") {
    return excluded("empty");
  }

  const emitted = emittedTapCode(action);
  const goesTo = targetLayer(action);
  const wantsWitness = goesTo !== null && (asLayerKey || emitted === null);

  if (wantsWitness) {
    if (
      action.kind === "layerSwitch" &&
      (action.action === "TG" || action.action === "TO")
    ) {
      return excluded("latching");
    }
    const found = findWitness(layout, goesTo);
    if (!found) return excluded("noWitness");
    return {
      ok: true,
      target: {
        layer,
        position,
        mode: "witness",
        expect: found.witness.code,
        witness: found.witness,
        ambiguous: !found.strong,
      },
    };
  }

  if (emitted === null) return excluded("silent");
  return {
    ok: true,
    target: {
      layer,
      position,
      mode: "direct",
      expect: emitted,
      witness: null,
      ambiguous: emitterCount(layout, emitted) > 1,
    },
  };
}

export interface TargetPool {
  targets: TrainerTarget[];
  excluded: ExcludedPosition[];
}

/**
 * Everything the chosen scope wants to drill, split into what we can observe
 * and what we cannot. Both halves are returned — the excluded list is the
 * honest half of the UI, not debris.
 */
export function buildTargets(
  layout: LayoutFile,
  scope: DrillScope,
  currentLayer: number,
): TargetPool {
  const targets: TrainerTarget[] = [];
  const excluded: ExcludedPosition[] = [];
  const take = (layer: number, position: number, asLayerKey: boolean) => {
    const c = classifyPosition(layout, layer, position, asLayerKey);
    // An empty position is not a limitation worth reporting — a layer full of
    // KC_NO would otherwise drown the "here's what we can't see" list.
    if (c.ok) targets.push(c.target);
    else if (c.excluded.reason !== "empty") excluded.push(c.excluded);
  };

  if (scope === "currentLayer") {
    const layer = layout.layers[currentLayer];
    if (layer) {
      layer.keys.forEach((_, i) => take(currentLayer, i, false));
    }
    return { targets, excluded };
  }

  layout.layers.forEach((layer, li) => {
    layer.keys.forEach((action, i) => {
      if (scope === "layerKeys") {
        if (targetLayer(action) !== null) take(li, i, true);
      } else {
        take(li, i, false);
      }
    });
  });
  return { targets, excluded };
}

// ---------------------------------------------------------------------------
// Per-key stats and difficulty weighting
// ---------------------------------------------------------------------------

/** How many recent attempts feed the weighting. Older ones age out entirely. */
export const STAT_WINDOW = 10;
/** Reaction time at or below which a key counts as fully mastered (ms). */
export const FAST_MS = 400;
/** Reaction time at or above which a key counts as fully slow (ms). */
export const SLOW_MS = 2000;

const MISS_WEIGHT = 6;
const SLOW_WEIGHT = 2;
/**
 * What we assume about a key we have never asked for. Sitting at the midpoint
 * puts unseen keys above mastered ones (so a session covers new ground) and
 * below repeatedly-missed ones (so weak keys still win).
 */
const UNSEEN = 0.5;

export interface KeyStat {
  /** Lifetime counts, for display. */
  attempts: number;
  hits: number;
  /** Outcomes of the last STAT_WINDOW attempts, oldest first (1 = correct). */
  window: number[];
  /** Reaction times (ms) of the last STAT_WINDOW correct answers, oldest first. */
  times: number[];
  /** When this key was last answered (epoch ms). */
  lastAt: number;
}

export type StatsMap = Readonly<Record<string, KeyStat>>;

export function emptyStat(): KeyStat {
  return { attempts: 0, hits: 0, window: [], times: [], lastAt: 0 };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * How badly a key needs practice, as a selection weight ≥ 1.
 *
 * Both inputs are windowed, so a key you used to miss stops being punished once
 * you get it right ten times running. A perfect, fast key bottoms out at 1 —
 * never zero, because dropping mastered keys entirely turns a drill into a list
 * of things you already failed at and stops rehearsing what you know.
 */
export function weightFor(stat: KeyStat | undefined): number {
  const answered = stat?.window.length ?? 0;
  const missRate =
    stat && answered > 0
      ? 1 - stat.window.reduce((a, b) => a + b, 0) / answered
      : UNSEEN;
  const med = stat ? median(stat.times) : null;
  const slowness =
    med === null ? UNSEEN : clamp01((med - FAST_MS) / (SLOW_MS - FAST_MS));
  return 1 + MISS_WEIGHT * missRate + SLOW_WEIGHT * slowness;
}

/** Append to a window, dropping the oldest entry past STAT_WINDOW. */
function pushWindow(values: readonly number[], value: number): number[] {
  const next = [...values, value];
  return next.length > STAT_WINDOW ? next.slice(next.length - STAT_WINDOW) : next;
}

/** A copy of `stats` with one answer folded in. */
export function recordAnswer(
  stats: StatsMap,
  key: string,
  correct: boolean,
  ms: number,
  now: number = Date.now(),
): StatsMap {
  const prev = stats[key] ?? emptyStat();
  return {
    ...stats,
    [key]: {
      attempts: prev.attempts + 1,
      hits: prev.hits + (correct ? 1 : 0),
      window: pushWindow(prev.window, correct ? 1 : 0),
      // Only correct answers time anything meaningful — a miss measures how
      // long it took to be wrong, which says nothing about recall speed.
      times: correct ? pushWindow(prev.times, ms) : prev.times,
      lastAt: now,
    },
  };
}

/**
 * Pick the next prompt, weighted toward weak keys.
 *
 * `avoid` is the target just answered: asking for it twice in a row drills the
 * short-term memory of the prompt rather than the key, so it is skipped unless
 * it is the only thing left.
 */
export function pickTarget(
  targets: readonly TrainerTarget[],
  stats: StatsMap,
  rng: () => number = Math.random,
  avoid?: { layer: number; position: number } | null,
): TrainerTarget | null {
  if (targets.length === 0) return null;
  const pool = avoid ? targets.filter((t) => !sameTarget(t, avoid)) : targets;
  const from = pool.length > 0 ? pool : targets;

  const weights = from.map((t) => weightFor(stats[statKey(t.layer, t.position)]));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < from.length; i++) {
    r -= weights[i];
    if (r < 0) return from[i];
  }
  // rng() === 1, or float drift ate the remainder.
  return from[from.length - 1];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface Answer {
  key: string;
  layer: number;
  position: number;
  correct: boolean;
  /** Milliseconds from the prompt appearing to the key resolving. */
  ms: number;
  expected: string;
  /** The code we actually saw, or null when the press resolved to nothing. */
  got: string | null;
}

/** Did `got` answer `target`? Aliases are collapsed before comparing. */
export function grade(target: TrainerTarget, got: string | null): boolean {
  return got !== null && canonicalCode(got) === target.expect;
}

export interface SessionSummary {
  attempts: number;
  hits: number;
  misses: number;
  /** 0–1, and 0 when nothing was attempted. */
  accuracy: number;
  /** Median reaction time over correct answers; null when there are none. */
  medianMs: number | null;
  /** The keys that cost the most this session, worst first. */
  worst: { key: string; layer: number; position: number; misses: number }[];
}

/** How many entries the end-of-session "worst keys" list shows. */
export const WORST_LIMIT = 5;

export function summarize(answers: readonly Answer[]): SessionSummary {
  const hits = answers.filter((a) => a.correct);
  const missesByKey = new Map<string, SessionSummary["worst"][number]>();
  for (const a of answers) {
    if (a.correct) continue;
    const entry = missesByKey.get(a.key) ?? {
      key: a.key,
      layer: a.layer,
      position: a.position,
      misses: 0,
    };
    entry.misses++;
    missesByKey.set(a.key, entry);
  }
  return {
    attempts: answers.length,
    hits: hits.length,
    misses: answers.length - hits.length,
    accuracy: answers.length === 0 ? 0 : hits.length / answers.length,
    medianMs: median(hits.map((a) => a.ms)),
    worst: [...missesByKey.values()]
      .sort((a, b) => b.misses - a.misses)
      .slice(0, WORST_LIMIT),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Stats are stored per layout id: a position means nothing across layouts, so
 * merging them would weight the drill from a keymap you no longer use.
 */
export type StatsByLayout = Readonly<Record<string, StatsMap>>;

/** Bumped only if the stored shape changes; older blobs are dropped, not migrated. */
export const STATS_VERSION = 1;

function isKeyStat(v: unknown): v is KeyStat {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  const numbers = (x: unknown) =>
    Array.isArray(x) && x.every((n) => typeof n === "number" && isFinite(n));
  return (
    typeof s.attempts === "number" &&
    typeof s.hits === "number" &&
    typeof s.lastAt === "number" &&
    numbers(s.window) &&
    numbers(s.times)
  );
}

/**
 * Read a persisted stats blob, keeping only entries that still parse.
 *
 * Deliberately total: this is localStorage, which a user can edit and a failed
 * write can truncate. Losing practice history is a nuisance; refusing to open
 * the trainer because of it would be worse, so anything unrecognizable is
 * silently dropped.
 */
export function parseStats(raw: string | null): StatsByLayout {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const file = parsed as { version?: unknown; byLayout?: unknown };
  if (file.version !== STATS_VERSION) return {};
  if (typeof file.byLayout !== "object" || file.byLayout === null) return {};

  const out: Record<string, Record<string, KeyStat>> = {};
  for (const [layoutId, stats] of Object.entries(
    file.byLayout as Record<string, unknown>,
  )) {
    if (typeof stats !== "object" || stats === null) continue;
    const kept: Record<string, KeyStat> = {};
    for (const [key, stat] of Object.entries(stats as Record<string, unknown>)) {
      if (isKeyStat(stat)) kept[key] = stat;
    }
    if (Object.keys(kept).length > 0) out[layoutId] = kept;
  }
  return out;
}

export function serializeStats(byLayout: StatsByLayout): string {
  return JSON.stringify({ version: STATS_VERSION, byLayout });
}

// ---------------------------------------------------------------------------
// Prompt text
// ---------------------------------------------------------------------------

export interface Prompt {
  /** Keycap label of the key being asked for. */
  label: string;
  /** "layer 2 · Symbols" — where it lives. */
  where: string;
  instruction: string;
  /** How the answer is observed, when that isn't obvious. Null for direct. */
  note: string | null;
}

function layerName(layout: LayoutFile, index: number): string {
  const title = layout.layers[index]?.title;
  return title ? `layer ${index} · ${title}` : `layer ${index}`;
}

/** The wording shown to the user for a target. Pure; no store access. */
export function promptFor(layout: LayoutFile, target: TrainerTarget): Prompt {
  const action = layout.layers[target.layer]?.keys[target.position];
  const label = action ? tapLabel(action) || "(blank)" : "(missing)";
  const where = layerName(layout, target.layer);

  if (target.mode === "witness" && target.witness) {
    const w = target.witness;
    const wAction = layout.layers[w.layer]?.keys[w.position];
    const wLabel = wAction ? tapLabel(wAction) || "(blank)" : "(missing)";
    return {
      label,
      where,
      instruction: `Hold ${label} on ${where}, then press ${wLabel}`,
      note:
        `Layer keys never reach the OS, so this is scored by its consequence: ` +
        `${wLabel} arriving as ${layerName(layout, w.layer)}'s key.`,
    };
  }

  return {
    label,
    where,
    instruction: `Press ${label} on ${where}`,
    note: null,
  };
}
