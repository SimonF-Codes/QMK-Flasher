import { useEffect, useRef, useState } from "react";
import { ipc, MOCK, mockControls, toAppError } from "../lib/ipc";
import { useLayoutStore } from "../state/layoutStore";
import type { AppError, PipelineState } from "../lib/types";

const STEPS = [
  { label: "Save", phases: ["saving"] },
  { label: "Generate", phases: ["generating"] },
  { label: "Build", phases: ["building"] },
  { label: "Bootloader", phases: ["waitingForBootloader"] },
  { label: "Flash", phases: ["erasing", "flashing", "leaving"] },
  { label: "Done", phases: ["done"] },
] as const;

function stepIndex(phase: string): number {
  return STEPS.findIndex((s) => (s.phases as readonly string[]).includes(phase));
}

export default function BuildFlashPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const un1 = ipc.onPipelineState(setState);
    const un2 = ipc.onBuildLog((l) => setLog((prev) => [...prev, l.line]));
    return () => {
      un1();
      un2();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const start = async () => {
    if (!layout) return;
    setError(null);
    setLog([]);
    setLogOpen(true);
    setRunning(true);
    mockControls.failNextBuild = failNext;
    try {
      await ipc.startFlashPipeline(layout);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => {
    void ipc.cancelPipeline();
  };

  const activeStep = stepIndex(state.phase);
  const failed = state.phase === "error" || error !== null;
  const waiting = state.phase === "waitingForBootloader";
  const showProgress =
    state.progress !== undefined &&
    (state.phase === "erasing" || state.phase === "flashing");

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex items-center gap-4">
        <button
          onClick={start}
          disabled={running || !layout}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
        >
          {running ? "Running…" : "Build & Flash"}
        </button>

        <ol className="flex flex-1 items-center gap-1 text-xs">
          {STEPS.map((step, i) => {
            const done =
              state.phase === "done"
                ? i <= activeStep
                : activeStep > i && !failed;
            const active = i === activeStep;
            return (
              <li key={step.label} className="flex items-center gap-1">
                {i > 0 && <span className="h-px w-4 bg-zinc-700" />}
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    active && failed
                      ? "bg-red-900 text-red-200"
                      : active
                        ? "bg-sky-800 text-sky-100"
                        : done
                          ? "bg-emerald-900 text-emerald-200"
                          : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        {MOCK && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={failNext}
              onChange={(e) => setFailNext(e.target.checked)}
            />
            Fail next build (mock)
          </label>
        )}

        <button
          onClick={() => setLogOpen((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          {logOpen ? "Hide log" : `Show log (${log.length})`}
        </button>
      </div>

      {waiting && (
        <div className="mt-2 flex items-center gap-3 rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2 text-sm text-sky-200">
          <span className="animate-pulse">●</span>
          Waiting for bootloader — press the reset key, or paperclip the reset
          button next to the left thumb cluster.
          <button
            onClick={cancel}
            className="ml-auto rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Cancel
          </button>
        </div>
      )}

      {showProgress && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <span className="w-24 text-right text-xs text-zinc-400">
            {state.phase} {state.progress}%
          </span>
        </div>
      )}

      {failed && (
        <div className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm">
          <p className="text-red-200">
            {error?.message ?? state.detail ?? "Pipeline failed"}
          </p>
          {error?.hint && <p className="mt-1 text-xs text-red-300/80">{error.hint}</p>}
          <button
            onClick={start}
            className="mt-2 rounded bg-red-800 px-3 py-1 text-xs font-medium text-red-100 hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {state.phase === "done" && !running && (
        <p className="mt-2 text-sm text-emerald-400">
          Flash complete — the board should be back. Test the Key Lock key.
        </p>
      )}

      {logOpen && (
        <pre
          ref={logRef}
          className="mt-2 max-h-40 overflow-y-auto rounded bg-black/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-300"
        >
          {log.join("\n") || "— no output yet —"}
        </pre>
      )}
    </footer>
  );
}
