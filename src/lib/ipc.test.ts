import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, mockControls } from "./ipc";
import type { PipelinePhase } from "./types";

async function runPipeline(): Promise<{
  phases: PipelinePhase[];
  logs: string[];
  error: unknown;
}> {
  const phases: PipelinePhase[] = [];
  const logs: string[] = [];
  const un1 = ipc.onPipelineState((s) => phases.push(s.phase));
  const un2 = ipc.onBuildLog((l) => logs.push(l.line));
  const layoutP = ipc.loadLayout(); // mock load has its own timer
  await vi.advanceTimersByTimeAsync(200);
  const layout = await layoutP;
  let error: unknown = null;
  const p = ipc.startFlashPipeline(layout).catch((e) => {
    error = e;
  });
  await vi.runAllTimersAsync();
  await p;
  un1();
  un2();
  return { phases, logs, error };
}

describe("mock flash pipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockControls.failNextBuild = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the full canned pipeline in order", async () => {
    const { phases, logs, error } = await runPipeline();
    expect(error).toBeNull();
    const unique = phases.filter((p, i) => phases[i - 1] !== p);
    expect(unique).toEqual([
      "saving",
      "generating",
      "building",
      "waitingForBootloader",
      "erasing",
      "flashing",
      "leaving",
      "done",
    ]);
    expect(logs.length).toBeGreaterThanOrEqual(8);
    expect(logs.at(-1)).toContain("firmware size is fine");
  });

  it("fails during building when failNextBuild is set, then succeeds on retry", async () => {
    mockControls.failNextBuild = true;
    const first = await runPipeline();
    expect(first.phases).toContain("error");
    expect(first.phases).not.toContain("done");
    expect(first.error).toMatchObject({ code: "BuildFailed" });
    expect((first.error as { hint: string }).hint).toBeTruthy();

    // The flag auto-clears — the retry goes through.
    const second = await runPipeline();
    expect(second.error).toBeNull();
    expect(second.phases.at(-1)).toBe("done");
  });

  it("cancel during the run returns the pipeline to idle", async () => {
    const phases: PipelinePhase[] = [];
    const un = ipc.onPipelineState((s) => phases.push(s.phase));
    const layoutP = ipc.loadLayout();
    await vi.advanceTimersByTimeAsync(200);
    const layout = await layoutP;
    const p = ipc.startFlashPipeline(layout).catch(() => {});
    await vi.advanceTimersByTimeAsync(300); // somewhere in saving/generating
    await ipc.cancelPipeline();
    await vi.runAllTimersAsync();
    await p;
    un();
    expect(phases.at(-1)).toBe("idle");
    expect(phases).not.toContain("done");
  });
});

describe("mock key reporting", () => {
  afterEach(() => {
    mockControls.keyReportingUnavailable = false;
  });

  it("delivers key and layer reports to subscribers until they unsubscribe", async () => {
    const keys: unknown[] = [];
    const layers: unknown[] = [];
    const unK = ipc.onKeyReport((k) => keys.push(k));
    const unL = ipc.onLayerReport((l) => layers.push(l));

    await ipc.startKeyReporting();
    mockControls.report(1, 6, true);
    mockControls.reportLayer(2);
    mockControls.report(1, 6, false);

    expect(keys).toEqual([
      { row: 1, col: 6, pressed: true },
      { row: 1, col: 6, pressed: false },
    ]);
    expect(layers).toEqual([{ layer: 2 }]);

    unK();
    unL();
    mockControls.report(0, 0, true);
    expect(keys).toHaveLength(2);
    await ipc.stopKeyReporting();
  });

  it("reports an unopenable channel as KeyReportUnavailable with a hint", async () => {
    mockControls.keyReportingUnavailable = true;
    const error = await ipc.startKeyReporting().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "KeyReportUnavailable" });
    expect((error as { hint: string }).hint).toContain("Keymapp");
  });
});
