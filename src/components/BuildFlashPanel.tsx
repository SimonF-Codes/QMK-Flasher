import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialBootloaderState,
  reduceDfuDevice,
  strandedInBootloader,
  visibleNotice,
  waitingBannerText,
} from "../lib/bootloader";
import { targetKind } from "../lib/focus";
import { ipc, MOCK, mockControls, toAppError } from "../lib/ipc";
import { escCancels, primaryAction } from "../lib/pipelineControl";
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

/** Keep the log bounded so a chatty build can't grow renders without limit. */
const MAX_LOG_LINES = 2000;

export default function BuildFlashPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const [running, setRunning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [dfu, setDfu] = useState(initialBootloaderState);
  const [error, setError] = useState<AppError | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // Real builds emit log lines in fast bursts; a setState per line froze the
  // webview. Buffer and flush on an interval, keeping only the newest lines.
  const logBufRef = useRef<string[]>([]);
  useEffect(() => {
    const un1 = ipc.onPipelineState(setState);
    const un2 = ipc.onBuildLog((l) => {
      logBufRef.current.push(l.line);
    });
    // The app-lifetime USB watcher has always emitted these; until now nothing
    // listened, so bootloader detection was discarded and the waiting banner
    // looked the same whether the board had been seen or not.
    const un3 = ipc.onDfuDevice((d) =>
      setDfu((prev) => reduceDfuDevice(prev, d.present)),
    );
    const flush = setInterval(() => {
      if (logBufRef.current.length === 0) return;
      const chunk = logBufRef.current;
      logBufRef.current = [];
      setLog((prev) => [...prev, ...chunk].slice(-MAX_LOG_LINES));
    }, 120);
    return () => {
      un1();
      un2();
      un3();
      clearInterval(flush);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const start = async () => {
    if (!layout) return;
    setError(null);
    setCancelRequested(false);
    logBufRef.current = [];
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

  const cancel = useCallback(() => {
    setCancelRequested(true);
    void ipc.cancelPipeline();
  }, []);

  // "error"/"idle" map to no step; keep the failed step highlighted on error.
  const lastStepRef = useRef(0);
  const currentStep = stepIndex(state.phase);
  if (currentStep >= 0) lastStepRef.current = currentStep;
  const failed = state.phase === "error" || error !== null;
  const activeStep =
    currentStep >= 0 ? currentStep : failed ? lastStepRef.current : -1;
  const waiting = state.phase === "waitingForBootloader";
  const showProgress =
    state.progress !== undefined &&
    (state.phase === "erasing" || state.phase === "flashing");

  const action = primaryAction({
    running,
    phase: state.phase,
    hasLayout: layout !== null,
    cancelRequested,
  });
  const escAborts = escCancels(action);

  // Esc is the second escape hatch, for when the pointer isn't already on the
  // button. Only bound while a cancel is actually on offer, so it never fires
  // `cancel_pipeline` at rest, and never in a text field — `targetKind` is the
  // same guard Ctrl+S and Ctrl+C/V use. Capture phase for the same reason they
  // use it: live view's bubble-phase listener may preventDefault first.
  useEffect(() => {
    if (!escAborts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (targetKind(e.target) !== "page") return;
      e.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [escAborts, cancel]);

  // Red for a cancel that stops the run now, amber for one that only takes
  // effect after the build — both unmistakably not the green start state.
  const primaryTone =
    action.kind === "start"
      ? "bg-emerald-600 enabled:hover:bg-emerald-500"
      : action.kind === "busy"
        ? "bg-zinc-700"
        : action.deferred
          ? "bg-amber-600 hover:bg-amber-500"
          : "bg-red-600 hover:bg-red-500";

  const notice = visibleNotice(dfu, state.phase, running);
  const cancelledRun =
    !running && state.phase === "idle" && state.detail === "cancelled";

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex items-center gap-4">
        <button
          onClick={() => {
            if (action.kind === "start") void start();
            else if (action.kind === "cancel") cancel();
          }}
          disabled={
            action.kind === "busy" ||
            (action.kind === "start" && action.disabled)
          }
          title={action.title}
          className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${primaryTone}`}
        >
          {action.label}
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

      {/* Keyed on the transition counter so each real presence edge mounts a
          fresh element — the notice appears rather than quietly recolouring. */}
      {notice && (
        <p
          key={dfu.seq}
          role="status"
          className={`mt-2 rounded-md border px-3 py-1.5 text-sm ${
            notice.tone === "good"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              : "border-amber-800 bg-amber-950/40 text-amber-200"
          }`}
        >
          {notice.text}
        </p>
      )}

      {waiting && (
        <div
          className={`mt-2 flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
            dfu.status === "present"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              : "border-sky-800 bg-sky-950/40 text-sky-200"
          }`}
        >
          <span className={dfu.status === "present" ? "" : "animate-pulse"}>
            ●
          </span>
          {waitingBannerText(dfu.status)}
          <button
            onClick={cancel}
            disabled={cancelRequested}
            className="ml-auto rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 enabled:hover:bg-zinc-700 disabled:opacity-40"
          >
            {cancelRequested ? "Cancelling…" : "Cancel"}
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

      {cancelledRun && (
        <p className="mt-2 text-sm text-zinc-400">
          Cancelled.
          {/* Only said when a real `dfu-device` event says the bootloader is on
              the bus right now — otherwise the board's state is unknown to us
              and guessing would be worse than saying nothing. */}
          {strandedInBootloader(dfu) &&
            " The board is still in the bootloader — press reset to return to" +
              " your firmware, or run Build & Flash again to finish flashing."}
        </p>
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
