/**
 * What the Build & Flash panel's primary button should do right now.
 *
 * Cancelling a run works (`cancel_pipeline` fires the pipeline's `CancelToken`)
 * but used to be reachable only through a small button inside the
 * "waiting for bootloader" banner, so a stuck run read as a frozen app. The
 * primary button — the one the user just pressed and is still looking at — is
 * the escape hatch instead, which means it has to be honest about what
 * cancelling actually does in each phase.
 *
 * ## How cancellable each phase really is
 *
 * The backend's cancellation is cooperative: `CancelToken` is polled at
 * checkpoints, so "cancellable" is per phase, not global.
 *
 * | phase                  | effect of cancelling                              |
 * | ---------------------- | ------------------------------------------------- |
 * | `idle` (run starting)  | immediate — checked before `save`                 |
 * | `saving`, `generating` | immediate — checked between every pipeline step   |
 * | `building`             | **deferred** — see below                          |
 * | `waitingForBootloader` | immediate — token checked each 1 s bus poll       |
 * | `erasing`              | at the first firmware chunk (seconds)             |
 * | `flashing`             | immediate — token checked per chunk               |
 * | `leaving`              | not offered — the write is already committed      |
 *
 * `building` is the honest exception: `build::build_firmware` takes no
 * `CancelToken` at all. The QMK `make` subprocess is spawned by `build/msys.rs`
 * and is waited on to completion — 33 s for a no-op build, ~190 s for a full
 * one — so a cancel pressed during the build cannot stop it. It is not a no-op
 * either: the token is checked the moment `make` returns, and the run then
 * stops before the bootloader wait, so the board is never written. The button
 * says exactly that ("Cancel after build") rather than promising a stop it
 * cannot deliver, because a Cancel that silently does nothing would destroy
 * trust in the control this change exists to make visible.
 */
import type { PipelinePhase } from "./types";

/** How promptly a cancel request takes effect in a given phase. */
export type Cancellability = "immediate" | "deferred" | "none";

/**
 * Per-phase cancellability, as verified against the Rust pipeline. Phases
 * absent from the map are terminal (`done`, `error`) and never show a cancel.
 */
export const PHASE_CANCELLABILITY: Record<PipelinePhase, Cancellability> = {
  // A run whose first `pipeline-state` event has not arrived yet: the token
  // exists and is checked before `save`, so cancelling lands immediately.
  idle: "immediate",
  saving: "immediate",
  generating: "immediate",
  building: "deferred",
  waitingForBootloader: "immediate",
  erasing: "immediate",
  flashing: "immediate",
  // The firmware is written and the manifest issued; there is nothing left to
  // abort, and offering it would be a lie.
  leaving: "none",
  done: "none",
  error: "none",
};

export type PrimaryAction =
  | { kind: "start"; label: string; title: string; disabled: boolean }
  | { kind: "cancel"; label: string; title: string; deferred: boolean }
  | { kind: "busy"; label: string; title: string };

export interface PrimaryActionInput {
  /** A `startFlashPipeline` call is in flight. */
  running: boolean;
  phase: PipelinePhase;
  /** No layout loaded — there is nothing to build. */
  hasLayout: boolean;
  /** Cancel has already been requested for this run. */
  cancelRequested: boolean;
}

/**
 * Resolve the primary button. Exhaustive over the (running, phase) space so
 * the button is never simultaneously the only escape and disabled.
 */
export function primaryAction({
  running,
  phase,
  hasLayout,
  cancelRequested,
}: PrimaryActionInput): PrimaryAction {
  if (!running) {
    return {
      kind: "start",
      label: "Build & Flash",
      title: hasLayout
        ? "Save, generate, build and flash the current layout"
        : "Load a layout first",
      disabled: !hasLayout,
    };
  }

  const cancellability = PHASE_CANCELLABILITY[phase];

  if (cancelRequested) {
    // Don't re-offer a control that has already been pressed — and during a
    // build, say why nothing appears to happen for the next few minutes.
    return cancellability === "deferred"
      ? {
          kind: "busy",
          label: "Cancelling after build…",
          title:
            "The build cannot be interrupted; the run will stop as soon as make finishes, without flashing the board.",
        }
      : { kind: "busy", label: "Cancelling…", title: "Stopping the run" };
  }

  switch (cancellability) {
    case "immediate":
      return {
        kind: "cancel",
        label: "Cancel",
        title: "Stop this run (Esc)",
        deferred: false,
      };
    case "deferred":
      return {
        kind: "cancel",
        label: "Cancel after build",
        title:
          "make cannot be interrupted — the build finishes, then the run stops before the board is flashed (Esc)",
        deferred: true,
      };
    case "none":
      return {
        kind: "busy",
        label: phase === "leaving" ? "Finishing…" : "Running…",
        title:
          phase === "leaving"
            ? "The firmware is written and the board is restarting — too late to cancel"
            : "Finishing up",
      };
  }
}

/** Should Esc cancel right now? True only when the button offers a cancel. */
export function escCancels(action: PrimaryAction): boolean {
  return action.kind === "cancel";
}
