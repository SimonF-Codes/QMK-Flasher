/**
 * Trainer mode: choosing what to ask for, scoring the answer, and weighting the
 * next question toward weak keys.
 *
 * Pure — no store, no React, no clock and no randomness of its own (callers
 * pass `now` / `rng`), so every decision here is testable.
 *
 * This used to be built around a constraint that no longer exists. Answers were
 * read through `KeyboardEvent`, i.e. AFTER QMK had finished with the press, so
 * every key the firmware consumes (MO/TG/TO/TT, QK_LOCK, RGB_*, macros) was
 * invisible; the trainer classified positions into `direct` / `witness` /
 * `excluded` so it could refuse to grade what it could not see rather than lie
 * about it. The firmware now reports every switch by matrix position and
 * reports the active layer, so the blind spots those buckets described are
 * gone. A target is a **position on a layer**, an answer is the switch the
 * board says you closed, and QK_LOCK is as gradable as the letter A.
 *
 * The intent behind that machinery outlives the machinery, because one honest
 * limit remains: a prompt names a position on a layer, and reaching that layer
 * takes presses of its own. Those presses are **navigation, not answers** — a
 * report that arrives while the board is on some other layer is not scored
 * either way, and the UI says so. Grading it would punish the user for the
 * route rather than the destination; ignoring it silently would leave them
 * wondering why a press did nothing.
 *
 * What is no longer needed, and why: ambiguity (two positions emitting the same
 * code were indistinguishable — positions never are), witnesses (a layer key's
 * consequence had to stand in for the key; now the key itself is reported), and
 * the latching refusal for TG/TO (a latched board used to be unobservable; the
 * board now says which layer it is on).
 */
import { tapLabel } from "./labels";
import { targetLayer } from "./led";
import type { LayoutFile } from "./types";

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

/** The layer that is active when nothing is held. */
export const BASE_LAYER = 0;

export interface TrainerTarget {
  /** Layer the prompted key lives on. */
  layer: number;
  /** Position in LAYOUT-arg order. */
  position: number;
}

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
// Target selection
// ---------------------------------------------------------------------------

/**
 * Can this position be asked for at all?
 *
 * The only thing left that cannot is a position with nothing to name. `none`
 * has no key, and `transparent` is the layer below wearing this layer's hat —
 * prompting for it would be prompting for a different key at a different
 * address. Everything else is a switch the board reports, so it is fair game:
 * layer keys, QK_LOCK and RGB keys included.
 */
export function isDrillable(
  layout: LayoutFile,
  layer: number,
  position: number,
): boolean {
  const action = layout.layers[layer]?.keys[position];
  if (!action) return false;
  return action.kind !== "none" && action.kind !== "transparent";
}

/** Everything the chosen scope wants to drill. */
export function buildTargets(
  layout: LayoutFile,
  scope: DrillScope,
  currentLayer: number,
): TrainerTarget[] {
  const targets: TrainerTarget[] = [];
  const take = (layer: number, position: number) => {
    if (isDrillable(layout, layer, position)) targets.push({ layer, position });
  };

  if (scope === "currentLayer") {
    const layer = layout.layers[currentLayer];
    if (layer) layer.keys.forEach((_, i) => take(currentLayer, i));
    return targets;
  }

  layout.layers.forEach((layer, li) => {
    layer.keys.forEach((action, i) => {
      if (scope !== "layerKeys" || targetLayer(action) !== null) take(li, i);
    });
  });
  return targets;
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
  /** Milliseconds from the prompt appearing to the key report arriving. */
  ms: number;
  /** The position the board says was pressed. */
  got: number;
}

/**
 * Did pressing `position` answer `target`?
 *
 * Position only — the caller has already established that the board was on the
 * target's layer, and a switch is a switch. There is nothing to canonicalize
 * and nothing to be ambiguous about.
 */
export function grade(target: TrainerTarget, position: number): boolean {
  return position === target.position;
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
  /** The one thing about scoring that isn't obvious. Null when there isn't one. */
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

  return {
    label,
    where,
    instruction: `Press ${label} on ${where}`,
    // Getting to a layer costs presses of its own, and those are not answers.
    // Saying so beats letting the user wonder why they did nothing.
    note:
      target.layer === BASE_LAYER
        ? null
        : `Reach ${where} first — presses made on another layer count as ` +
          `navigation and aren't scored.`,
  };
}
