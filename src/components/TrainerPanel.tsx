/**
 * Trainer mode UI: the prompt, the running score, and the honest small print
 * about what the trainer cannot see.
 *
 * All of the decisions live in `lib/trainer.ts` and `state/trainerStore.ts`;
 * this file only renders them. The one thing it does compute is the idle
 * preview of the target pool, so the scope buttons can say up front how many
 * keys they would drill and how many they have to skip — that number is the
 * whole reason the exclusion rules exist, and hiding it until you press Start
 * would defeat the point.
 */
import { useMemo } from "react";
import { tapLabel } from "../lib/labels";
import {
  buildTargets,
  summarize,
  DRILL_SCOPES,
  EXCLUDE_REASON_TEXT,
  SCOPE_LABEL,
  weightFor,
  type ExcludedPosition,
  type KeyStat,
  type StatsMap,
} from "../lib/trainer";
import type { LayoutFile } from "../lib/types";
import { useLayoutStore } from "../state/layoutStore";
import { statsFor, useTrainerStore } from "../state/trainerStore";

/** "⌫ · L2" — enough to recognise a key in a list without the board. */
function keyName(layout: LayoutFile | null, layer: number, position: number): string {
  const action = layout?.layers[layer]?.keys[position];
  const label = action ? tapLabel(action) || "·" : "?";
  return `${label} · L${layer}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function ms(x: number | null): string {
  return x === null ? "—" : `${Math.round(x)} ms`;
}

/** Counts by reason, so the UI names the limit instead of hiding the keys. */
function groupReasons(excluded: ExcludedPosition[]): [string, number][] {
  const counts = new Map<ExcludedPosition["reason"], number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => [EXCLUDE_REASON_TEXT[reason], n]);
}

/** The keys the weighting will favour next, worst first. */
function weakest(
  stats: StatsMap,
  limit: number,
): { key: string; stat: KeyStat; weight: number }[] {
  return Object.entries(stats)
    .map(([key, stat]) => ({ key, stat, weight: weightFor(stat) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-zinc-600">
        {label}
      </span>
      <span className="font-mono text-sm text-zinc-200">{value}</span>
    </div>
  );
}

export default function TrainerPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);

  const scope = useTrainerStore((s) => s.scope);
  const setScope = useTrainerStore((s) => s.setScope);
  const reveal = useTrainerStore((s) => s.reveal);
  const setReveal = useTrainerStore((s) => s.setReveal);
  const running = useTrainerStore((s) => s.running);
  const prompt = useTrainerStore((s) => s.prompt);
  const target = useTrainerStore((s) => s.target);
  const answers = useTrainerStore((s) => s.answers);
  const last = useTrainerStore((s) => s.last);
  const summary = useTrainerStore((s) => s.summary);
  const sessionExcluded = useTrainerStore((s) => s.excluded);
  const byLayout = useTrainerStore((s) => s.byLayout);
  const layoutKey = useTrainerStore((s) => s.layoutKey);
  const start = useTrainerStore((s) => s.start);
  const stop = useTrainerStore((s) => s.stop);
  const skip = useTrainerStore((s) => s.skip);
  const resetStats = useTrainerStore((s) => s.resetStats);

  // Idle preview only — once a session starts the store owns the frozen pool.
  const preview = useMemo(
    () => (layout ? buildTargets(layout, scope, selectedLayer) : null),
    [layout, scope, selectedLayer],
  );
  const live = running ? summarize(answers) : null;
  const stats = statsFor({ byLayout, layoutKey });
  const excluded = running ? sessionExcluded : (preview?.excluded ?? []);

  if (!layout) {
    return <p className="text-xs text-zinc-600">Load a layout to train.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      {running && (
        <>
          <div className="rounded border border-fuchsia-800/60 bg-fuchsia-950/30 px-3 py-2">
            {prompt ? (
              <>
                <p className="text-sm font-medium text-fuchsia-100">
                  {prompt.instruction}
                </p>
                {prompt.note && (
                  <p className="mt-0.5 text-[10px] text-fuchsia-300/70">
                    {prompt.note}
                  </p>
                )}
                {target?.ambiguous && (
                  <p className="mt-0.5 text-[10px] text-amber-400/80">
                    Another key emits the same code — either one will be scored
                    correct.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-amber-300">
                Nothing in this scope can be observed. Pick another scope.
              </p>
            )}
          </div>

          <div className="flex items-end gap-4">
            <Stat label="hits" value={String(live?.hits ?? 0)} />
            <Stat label="misses" value={String(live?.misses ?? 0)} />
            <Stat label="accuracy" value={pct(live?.accuracy ?? 0)} />
            <Stat label="median" value={ms(live?.medianMs ?? null)} />
            {last && (
              <span
                className={`ml-auto font-mono text-xs ${
                  last.correct ? "text-green-400" : "text-red-400"
                }`}
              >
                {last.correct ? "✓" : `✗ got ${last.got ?? "—"}`}{" "}
                <span className="text-zinc-600">{Math.round(last.ms)} ms</span>
              </span>
            )}
          </div>
        </>
      )}

      {!running && summary && summary.attempts > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <h3 className="text-xs font-semibold text-zinc-300">Session over</h3>
          <div className="mt-1 flex items-end gap-4">
            <Stat label="answered" value={String(summary.attempts)} />
            <Stat label="accuracy" value={pct(summary.accuracy)} />
            <Stat label="median" value={ms(summary.medianMs)} />
          </div>
          {summary.worst.length > 0 && (
            <p className="mt-1 text-[10px] text-zinc-500">
              Missed most:{" "}
              {summary.worst
                .map(
                  (w) =>
                    `${keyName(layout, w.layer, w.position)} ×${w.misses}`,
                )
                .join(", ")}
            </p>
          )}
        </div>
      )}

      {!running && (
        <div className="flex flex-wrap items-center gap-1.5">
          {DRILL_SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                scope === s
                  ? "border-fuchsia-600 bg-fuchsia-900/40 text-fuchsia-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
          <span className="text-[10px] text-zinc-600">
            {preview?.targets.length ?? 0} keys
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {running ? (
          <>
            <button
              onClick={stop}
              className="rounded bg-fuchsia-800 px-2.5 py-1 text-xs font-medium text-fuchsia-50 hover:bg-fuchsia-700"
            >
              Stop
            </button>
            <button
              onClick={skip}
              disabled={!target}
              className="rounded px-2 py-1 text-xs text-zinc-400 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-40"
              title="Move on without scoring this prompt"
            >
              Skip
            </button>
          </>
        ) : (
          <button
            onClick={start}
            disabled={(preview?.targets.length ?? 0) === 0}
            className="rounded bg-fuchsia-800 px-2.5 py-1 text-xs font-medium text-fuchsia-50 enabled:hover:bg-fuchsia-700 disabled:opacity-40"
          >
            {summary && summary.attempts > 0 ? "Train again" : "Start"}
          </button>
        )}

        <label
          className="flex items-center gap-1 text-[10px] text-zinc-500"
          title="Highlight the target on the board and switch to its layer. Off makes it a pure recall drill."
        >
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="accent-fuchsia-600"
          />
          show target
        </label>

        {!running && Object.keys(stats).length > 0 && (
          <button
            onClick={resetStats}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            title="Forget this layout's practice history, so weighting starts over"
          >
            Reset history
          </button>
        )}
      </div>

      {!running && Object.keys(stats).length > 0 && (
        <p className="text-[10px] text-zinc-600">
          {Object.keys(stats).length} keys practised (kept across restarts) ·
          weakest:{" "}
          {weakest(stats, 3)
            .map((w) => {
              const [layer, position] = w.key.split(":").map(Number);
              return keyName(layout, layer, position);
            })
            .join(", ")}
        </p>
      )}

      {excluded.length > 0 && (
        <p className="text-[10px] text-amber-500/70">
          {excluded.length} key{excluded.length === 1 ? "" : "s"} left out —{" "}
          {groupReasons(excluded)
            .map(([text, n]) => `${n}: ${text}`)
            .join("; ")}
          .
        </p>
      )}
    </div>
  );
}
