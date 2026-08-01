/**
 * Bootloader presence, folded from the backend's `dfu-device` events.
 *
 * An app-lifetime USB watcher (`flash::watcher::spawn`, started from
 * `lib.rs`) polls the bus every second and emits `dfu-device { present }` on
 * every presence edge of a known bootloader. The frontend already had
 * `ipc.onDfuDevice`, but nothing subscribed to it — so the app detected the
 * board entering DFU and threw the signal away, leaving a "Waiting for
 * bootloader" banner that read identically whether the board had been seen or
 * not. That sameness is what made a stalled wait feel like a hang.
 *
 * The state is deliberately app-lifetime rather than per-run, because the
 * watcher is: it reports edges, not levels, so a board already in DFU emits its
 * `Appeared` edge about a second after launch and nothing further. Resetting
 * this on each run would throw that away and show "not seen" for a board that
 * demonstrably was.
 *
 * ## Honesty rule
 *
 * `present` is only ever reached from a real `dfu-device` event carrying
 * `present: true`. Nothing here infers detection from a phase, a timer or a
 * hope. `unknown` and `gone` are distinct for the same reason: `gone` means the
 * board was observed on the bus and then left, which is diagnostic; `unknown`
 * means no bootloader has been seen at all, which is the state a board that
 * never enters DFU stays in — and that has to remain visible, not be papered
 * over.
 */
import type { PipelinePhase } from "./types";

export type BootloaderStatus =
  /** No `dfu-device` event with `present: true` has ever arrived. */
  | "unknown"
  /** A bootloader is on the bus right now. */
  | "present"
  /** A bootloader was on the bus and has since left. */
  | "gone";

export interface BootloaderState {
  status: BootloaderStatus;
  /**
   * Bumped on every real status change. The UI keys its "detected" notice off
   * this, so the notice is tied to an actual transition rather than to a render.
   */
  seq: number;
}

export const initialBootloaderState: BootloaderState = {
  status: "unknown",
  seq: 0,
};

/**
 * Fold one `dfu-device` event. Repeats that carry no new information leave the
 * state (and `seq`) untouched, so nothing re-announces on a duplicate event.
 *
 * Note the `unknown` + `present: false` case: the mock pipeline and a real
 * disconnect-before-connect both produce it, and it must *not* become `gone` —
 * a board that was never there did not leave.
 */
export function reduceDfuDevice(
  prev: BootloaderState,
  present: boolean,
): BootloaderState {
  const next: BootloaderStatus = present
    ? "present"
    : prev.status === "unknown"
      ? "unknown"
      : "gone";
  if (next === prev.status) return prev;
  return { status: next, seq: prev.seq + 1 };
}

/**
 * Scope the *historical* half of the state to the run that is starting.
 *
 * `present` is a statement about the bus right now — a board already sitting in
 * DFU when you press Build & Flash is still sitting there — so it survives.
 * `gone` is a past edge, and its meaning is run-relative: after a successful
 * flash the board leaves the bus, and carrying that into the next run made the
 * wait banner announce "the bootloader left the bus before flashing could
 * start" about a departure that happened during the *previous* run. Dropping it
 * back to `unknown` says the true thing instead: nothing has been seen yet this
 * run.
 */
export function beginRun(state: BootloaderState): BootloaderState {
  if (state.status !== "gone") return state;
  return { status: "unknown", seq: state.seq + 1 };
}

export interface BootloaderNotice {
  text: string;
  tone: "good" | "warn";
}

/**
 * The explicit, transition-driven message for the current status — the thing
 * the user asked to "bubble up" when detection succeeds. `null` while nothing
 * has been observed, because there is nothing truthful to say yet.
 */
export function bootloaderNotice(
  state: BootloaderState,
): BootloaderNotice | null {
  switch (state.status) {
    case "present":
      return { text: "Bootloader detected on the USB bus.", tone: "good" };
    case "gone":
      return { text: "Bootloader left the USB bus.", tone: "warn" };
    case "unknown":
      return null;
  }
}

/**
 * The notice actually worth showing, given what the pipeline is doing.
 *
 * Presence is always worth surfacing — a board sitting in DFU is useful to know
 * about even before a run starts. Departure is only surfaced when it is
 * *diagnostic*: the board dropping off the bus mid-run is information the user
 * needs, but the same event during `leaving`/`done` is just the board rebooting
 * into the firmware that was successfully written, and flagging that as a
 * warning would turn a successful flash into a false alarm.
 */
export function visibleNotice(
  state: BootloaderState,
  phase: PipelinePhase,
  running: boolean,
): BootloaderNotice | null {
  const notice = bootloaderNotice(state);
  if (notice === null) return null;
  if (state.status === "gone") {
    const expectedReboot = phase === "leaving" || phase === "done";
    if (!running || expectedReboot) return null;
  }
  return notice;
}

/**
 * The waiting banner's text. The whole point of the change: "still waiting" and
 * "the board is here" must not look the same.
 */
export function waitingBannerText(status: BootloaderStatus): string {
  switch (status) {
    case "present":
      return "Bootloader detected — starting the flash.";
    case "gone":
      return "The bootloader left the bus before flashing could start — press the reset key again.";
    case "unknown":
      return "Waiting for bootloader — press the reset key, or paperclip the reset button next to the left thumb cluster.";
  }
}

/**
 * After a cancelled run, a board left sitting in DFU is a confusing state
 * worth explaining. Only claimed when a real `present: true` event is the most
 * recent thing we heard — a guess here would be worse than silence.
 */
export function strandedInBootloader(state: BootloaderState): boolean {
  return state.status === "present";
}
