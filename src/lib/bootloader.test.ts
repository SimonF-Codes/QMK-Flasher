import { describe, expect, it } from "vitest";
import {
  bootloaderNotice,
  initialBootloaderState,
  reduceDfuDevice,
  strandedInBootloader,
  visibleNotice,
  waitingBannerText,
  type BootloaderState,
} from "./bootloader";

/** Fold a sequence of `dfu-device` payloads from the initial state. */
function fold(...events: boolean[]): BootloaderState {
  return events.reduce(reduceDfuDevice, initialBootloaderState);
}

describe("reduceDfuDevice", () => {
  it("starts out having seen nothing", () => {
    expect(initialBootloaderState).toEqual({ status: "unknown", seq: 0 });
    expect(bootloaderNotice(initialBootloaderState)).toBeNull();
  });

  it("only reports detection on a real present:true event", () => {
    expect(fold(true).status).toBe("present");
    expect(bootloaderNotice(fold(true))).toEqual({
      text: "Bootloader detected on the USB bus.",
      tone: "good",
    });
  });

  it("does not turn an absence into a departure", () => {
    // The mock pipeline emits present:false when the wait starts, and a real
    // board that never enters DFU only ever produces this. Claiming the
    // bootloader "left" would be inventing an event that did not happen.
    const s = fold(false, false);
    expect(s.status).toBe("unknown");
    expect(s.seq).toBe(0);
    expect(bootloaderNotice(s)).toBeNull();
  });

  it("reports disappearance once the board has actually been seen", () => {
    const s = fold(true, false);
    expect(s.status).toBe("gone");
    expect(bootloaderNotice(s)).toEqual({
      text: "Bootloader left the USB bus.",
      tone: "warn",
    });
  });

  it("bumps seq on every real transition and only on those", () => {
    expect(fold(true).seq).toBe(1);
    expect(fold(true, true, true).seq).toBe(1);
    expect(fold(true, false).seq).toBe(2);
    expect(fold(true, false, false).seq).toBe(2);
    expect(fold(true, false, true).seq).toBe(3);
  });

  it("returns the identical object when nothing changed", () => {
    // Cheap render guard: a duplicate event must not re-announce detection.
    const s = fold(true);
    expect(reduceDfuDevice(s, true)).toBe(s);
  });

  it("survives a full arrive → flash → reboot cycle", () => {
    const s = fold(false, true, false);
    expect(s.status).toBe("gone");
  });
});

describe("waitingBannerText", () => {
  it("distinguishes waiting from detected — the actual bug", () => {
    const unknown = waitingBannerText("unknown");
    const present = waitingBannerText("present");
    const gone = waitingBannerText("gone");
    expect(new Set([unknown, present, gone]).size).toBe(3);
    expect(unknown).toMatch(/press the reset key/i);
    expect(present).toMatch(/detected/i);
    expect(gone).toMatch(/left the bus/i);
  });
});

describe("visibleNotice", () => {
  const present = fold(true);
  const gone = fold(true, false);

  it("always surfaces a detected bootloader, run or no run", () => {
    expect(visibleNotice(present, "waitingForBootloader", true)?.tone).toBe("good");
    expect(visibleNotice(present, "idle", false)?.tone).toBe("good");
  });

  it("surfaces a mid-run disappearance as diagnostic", () => {
    expect(visibleNotice(gone, "flashing", true)?.tone).toBe("warn");
    expect(visibleNotice(gone, "waitingForBootloader", true)?.tone).toBe("warn");
  });

  it("does not cry wolf when the board reboots after a good flash", () => {
    // `leaving`/`done` departure IS the success path — the board is restarting
    // into the firmware just written.
    expect(visibleNotice(gone, "leaving", true)).toBeNull();
    expect(visibleNotice(gone, "done", true)).toBeNull();
    expect(visibleNotice(gone, "done", false)).toBeNull();
  });

  it("drops a stale departure notice once the run is over", () => {
    expect(visibleNotice(gone, "idle", false)).toBeNull();
  });

  it("stays silent when nothing has been observed", () => {
    expect(visibleNotice(initialBootloaderState, "waitingForBootloader", true)).toBeNull();
  });
});

describe("strandedInBootloader", () => {
  it("is claimed only while a bootloader is actually on the bus", () => {
    expect(strandedInBootloader(initialBootloaderState)).toBe(false);
    expect(strandedInBootloader(fold(true))).toBe(true);
    expect(strandedInBootloader(fold(true, false))).toBe(false);
  });
});
