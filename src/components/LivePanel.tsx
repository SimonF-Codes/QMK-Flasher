/**
 * Live view output: the left pane depends on the mode — a scratchpad you can
 * type into (monitor) or the drill (trainer) — beside a rolling log of what the
 * firmware actually emitted, which both modes share.
 *
 * The scratchpad is deliberately a real textarea — seeing the characters your
 * layout produces is the point, especially for symbols and dual-function keys.
 * App.tsx recognizes it by `data-live-scratchpad` and lets keystrokes through
 * instead of swallowing them.
 */
import { useLiveStore, type LiveEvent, type LiveMode } from "../state/liveStore";
import { useLayoutStore } from "../state/layoutStore";
import TrainerPanel from "./TrainerPanel";

const MODES: { id: LiveMode; label: string; title: string }[] = [
  {
    id: "monitor",
    label: "Monitor",
    title: "Watch and log what the firmware emits — asks nothing, scores nothing",
  },
  {
    id: "trainer",
    label: "Trainer",
    title: "Prompt for a key, score the answer, and drill the ones you get wrong",
  },
];

function clockTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Printable form of KeyboardEvent.key for the log ("Space" beats " "). */
function keyGlyph(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key;
  return key;
}

function LogRow({ e }: { e: LiveEvent }) {
  const matched = e.positions.length > 0;
  return (
    <li className="flex items-baseline gap-2 whitespace-nowrap px-2 py-0.5 font-mono text-[11px] odd:bg-zinc-900/40">
      <span className="text-zinc-600">{clockTime(e.at)}</span>
      <span className={e.type === "down" ? "text-green-400" : "text-zinc-500"}>
        {e.type === "down" ? "↓" : "↑"}
      </span>
      <span className="text-zinc-300">{e.code}</span>
      <span className="text-sky-300">{keyGlyph(e.key)}</span>
      <span className="text-zinc-400">{e.qmk ?? "—"}</span>
      {matched ? (
        <span className="text-zinc-500">
          L{e.layer} #{e.positions.join(",")}
        </span>
      ) : (
        <span className="text-amber-500/80">no match</span>
      )}
      {e.mods.length > 0 && (
        <span className="text-zinc-600">{e.mods.join("+")}</span>
      )}
    </li>
  );
}

export default function LivePanel() {
  const enabled = useLiveStore((s) => s.enabled);
  const mode = useLiveStore((s) => s.mode);
  const setMode = useLiveStore((s) => s.setMode);
  const events = useLiveStore((s) => s.events);
  const clearLog = useLiveStore((s) => s.clearLog);
  const followLayer = useLiveStore((s) => s.followLayer);
  const setFollowLayer = useLiveStore((s) => s.setFollowLayer);
  const pinnedLayer = useLiveStore((s) => s.pinnedLayer);
  const resumeFollow = useLiveStore((s) => s.resumeFollow);
  const layout = useLayoutStore((s) => s.layout);

  if (!enabled) return null;

  const layerTitle =
    pinnedLayer !== null ? layout?.layers[pinnedLayer]?.title : undefined;

  return (
    <section
      className={`mt-3 flex shrink-0 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 ${
        // The trainer stacks prompt + score + controls where the scratchpad is
        // one box, so it needs the extra rows.
        mode === "trainer" ? "h-64" : "h-52"
      }`}
      aria-label="Live view output"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex overflow-hidden rounded border border-zinc-700">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                title={m.title}
                className={`px-2 py-0.5 text-[11px] font-medium ${
                  mode === m.id
                    ? m.id === "trainer"
                      ? "bg-fuchsia-900/60 text-fuchsia-100"
                      : "bg-green-900/50 text-green-100"
                    : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-zinc-600">
            {mode === "trainer"
              ? "it prompts, you answer, it scores"
              : "type here to see what your layout produces"}
          </span>
        </div>
        {mode === "trainer" ? (
          <TrainerPanel />
        ) : (
          <textarea
            data-live-scratchpad
            spellCheck={false}
            placeholder="Type to test the layout…"
            className="min-h-0 flex-1 resize-none rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-100 outline-none focus:border-green-700"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-xs font-semibold text-zinc-300">Output log</h2>
          <span className="text-[10px] text-zinc-600">{events.length}</span>

          {pinnedLayer !== null ? (
            <button
              onClick={resumeFollow}
              className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-900"
              title="Auto-follow is paused because you picked a layer manually. Click to resume."
            >
              layer {pinnedLayer} pinned{layerTitle ? ` · ${layerTitle}` : ""} —
              resume
            </button>
          ) : (
            <label
              className="flex items-center gap-1 text-[10px] text-zinc-500"
              title="Switch the visible layer to wherever a pressed key was found"
            >
              <input
                type="checkbox"
                checked={followLayer}
                onChange={(e) => setFollowLayer(e.target.checked)}
                className="accent-green-600"
              />
              follow layer
            </label>
          )}

          <button
            onClick={clearLog}
            disabled={events.length === 0}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-zinc-400 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        <ol className="min-h-0 flex-1 overflow-auto rounded border border-zinc-800 bg-zinc-950">
          {events.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-zinc-600">
              Press a key. Layer switches, Key Lock and RGB keys are handled
              inside the firmware and never reach the OS, so they won't appear.
            </li>
          ) : (
            events.map((e) => <LogRow key={e.id} e={e} />)
          )}
        </ol>
      </div>
    </section>
  );
}
