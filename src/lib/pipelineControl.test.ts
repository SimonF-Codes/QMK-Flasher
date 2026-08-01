import { describe, expect, it } from "vitest";
import {
  escCancels,
  PHASE_CANCELLABILITY,
  primaryAction,
  type PrimaryActionInput,
} from "./pipelineControl";
import { PipelinePhaseSchema, type PipelinePhase } from "./types";

const ALL_PHASES = PipelinePhaseSchema.options as readonly PipelinePhase[];

function action(over: Partial<PrimaryActionInput> = {}) {
  return primaryAction({
    running: true,
    phase: "saving",
    hasLayout: true,
    cancelRequested: false,
    ...over,
  });
}

describe("primaryAction", () => {
  it("starts a run when nothing is in flight", () => {
    const a = action({ running: false, phase: "idle" });
    expect(a).toMatchObject({ kind: "start", label: "Build & Flash", disabled: false });
  });

  it("disables the start button with no layout loaded", () => {
    expect(action({ running: false, phase: "idle", hasLayout: false })).toMatchObject({
      kind: "start",
      disabled: true,
    });
  });

  it("keeps the start button enabled after a run ends, even with no layout change", () => {
    // Post-cancel the backend emits idle/"cancelled"; the button must return to
    // being pressable rather than sticking on a busy label.
    expect(action({ running: false, phase: "idle" })).toMatchObject({ kind: "start" });
    expect(action({ running: false, phase: "done" })).toMatchObject({ kind: "start" });
    expect(action({ running: false, phase: "error" })).toMatchObject({ kind: "start" });
  });

  it("offers an immediate cancel in every promptly-cancellable phase", () => {
    for (const phase of [
      "idle",
      "saving",
      "generating",
      "waitingForBootloader",
      "erasing",
      "flashing",
    ] as const) {
      expect(action({ phase }), phase).toMatchObject({
        kind: "cancel",
        label: "Cancel",
        deferred: false,
      });
    }
  });

  it("tells the truth during a build: make cannot be interrupted", () => {
    const a = action({ phase: "building" });
    expect(a).toMatchObject({ kind: "cancel", label: "Cancel after build", deferred: true });
    // The tooltip must explain the deferral, not just restate the label.
    expect(a.title).toMatch(/cannot be interrupted/);
    expect(a.title).toMatch(/before the board is flashed/);
  });

  it("does not offer a cancel once the firmware is committed", () => {
    const a = action({ phase: "leaving" });
    expect(a).toMatchObject({ kind: "busy", label: "Finishing…" });
    expect(escCancels(a)).toBe(false);
  });

  it("stops re-offering cancel once it has been requested", () => {
    expect(action({ phase: "flashing", cancelRequested: true })).toMatchObject({
      kind: "busy",
      label: "Cancelling…",
    });
  });

  it("explains the wait when a cancel is requested mid-build", () => {
    const a = action({ phase: "building", cancelRequested: true });
    expect(a).toMatchObject({ kind: "busy", label: "Cancelling after build…" });
    expect(a.title).toMatch(/without flashing the board/);
  });

  it("never shows a disabled button as the only escape while running", () => {
    // The original bug: the primary button sat greyed out reading "Running…"
    // while the sole Cancel hid in a banner. Every running phase must now
    // either offer a cancel or say why it cannot.
    for (const phase of ALL_PHASES) {
      const a = action({ phase });
      expect(a.kind, phase).not.toBe("start");
      if (a.kind === "busy") {
        expect(a.title.length, phase).toBeGreaterThan(0);
      }
    }
  });

  it("guards Esc to exactly the phases that offer a cancel", () => {
    for (const phase of ALL_PHASES) {
      expect(escCancels(action({ phase })), phase).toBe(
        PHASE_CANCELLABILITY[phase] !== "none",
      );
      // A second Esc after one has landed must not re-fire.
      expect(escCancels(action({ phase, cancelRequested: true })), phase).toBe(false);
    }
    // Never while idle and not running — Esc must not fire cancel_pipeline at rest.
    expect(escCancels(action({ running: false, phase: "idle" }))).toBe(false);
  });
});

describe("PHASE_CANCELLABILITY", () => {
  it("covers every phase in the contract", () => {
    for (const phase of ALL_PHASES) {
      expect(PHASE_CANCELLABILITY[phase], phase).toBeDefined();
    }
    expect(Object.keys(PHASE_CANCELLABILITY).sort()).toEqual([...ALL_PHASES].sort());
  });

  it("marks building deferred — the one phase the Rust side cannot abort", () => {
    // build::build_firmware takes no CancelToken; the make subprocess is waited
    // on to completion. If that ever changes, this expectation should change
    // with it — and the button label along with it.
    expect(PHASE_CANCELLABILITY.building).toBe("deferred");
  });
});
