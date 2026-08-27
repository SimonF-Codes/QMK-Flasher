/**
 * Tests for scripts/extract-f75-geometry.mjs against the SYNTHETIC fixture in
 * shared/fixtures/f75_kb_synthetic.ini.
 *
 * The fixture is hand-authored, not vendor data — the real KB.ini comes out of
 * AULA's proprietary installer and is not in this repo (see the script header).
 * That means these tests pin the extractor's *behaviour* — the derivation, the
 * comment handling, the failure modes — rather than any real board's numbers.
 * The derivation was separately validated against all three real OEM variants;
 * that check is recorded in docs/research/aula-f75-remapper-plan.md.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "extract-f75-geometry.mjs");
const FIXTURE = join(__dirname, "..", "shared", "fixtures", "f75_kb_synthetic.ini");
const tmp = mkdtempSync(join(tmpdir(), "f75geo-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface F75Key {
  slot: number;
  label: string;
  positioned: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  vk?: number;
  hid?: { packed: string; category: number; usage: number };
  fn1?: { packed: string; category: number; usage: number };
}
interface F75Geometry {
  source: string;
  vid: string | null;
  pid: string | null;
  matrixLen: number | null;
  scale: { pitchPx: number; vPitchPx: number; hInsetPx: number; vInsetPx: number };
  lockedSlots: number[];
  keyCount: number;
  keys: F75Key[];
}

function run(iniPath: string, name: string): F75Geometry {
  const out = join(tmp, `${name}.json`);
  execFileSync(process.execPath, [SCRIPT, iniPath, "--out", out], {
    encoding: "utf8",
  });
  return JSON.parse(readFileSync(out, "utf8")) as F75Geometry;
}

function runExpectingFailure(contents: string, name: string): string {
  const ini = join(tmp, `${name}.ini`);
  writeFileSync(ini, contents);
  try {
    execFileSync(process.execPath, [SCRIPT, ini, "--out", join(tmp, `${name}.json`)], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e) {
    const err = e as { stderr?: string; status?: number };
    return err.stderr ?? "";
  }
  throw new Error("expected the extractor to fail, but it succeeded");
}

const geo = run(FIXTURE, "synthetic");
const bySlot = (s: number) => geo.keys.find((k) => k.slot === s)!;

describe("extract-f75-geometry", () => {
  it("reads every key, including the unpositioned encoder", () => {
    expect(geo.keyCount).toBe(10);
    expect(geo.keys.filter((k) => k.positioned)).toHaveLength(9);
  });

  it("labels keys from the comment above each line", () => {
    expect(bySlot(0).label).toBe("Esc");
    expect(bySlot(79).label).toBe("Backspace");
  });

  it("keeps the encoder as a slot but gives it no geometry", () => {
    const wheel = bySlot(84);
    expect(wheel.label).toBe("Wheel");
    expect(wheel.positioned).toBe(false);
    expect(wheel.x).toBeUndefined();
    // A zero-area rect must not be allowed to skew the derived scale.
    expect(geo.scale.pitchPx).toBeGreaterThan(30);
  });

  it("derives keycap widths from the inset, not the drawn pixels", () => {
    // The drawn rect is 25px on a ~39px pitch; a naive read gives 0.64u.
    expect(bySlot(0).w).toBe(1); // Esc, 1u
    expect(bySlot(79).w).toBe(2); // Backspace, 2u
    expect(bySlot(2).w).toBe(1.5); // Tab, 1.5u
    expect(bySlot(3).w).toBe(1.75); // CapsLock, 1.75u
  });

  it("places keys on the quarter-unit grid, absorbing OEM jitter", () => {
    expect(bySlot(12).x).toBe(2); // F1
    expect(bySlot(8).x).toBe(1.5); // Q, behind a 1.5u Tab
    expect(bySlot(9).x).toBe(1.75); // A, behind a 1.75u CapsLock
  });

  it("clusters a row whose tops differ by a pixel into one row", () => {
    // K4 is authored at y=80 while its row-mates are at 81.
    expect(bySlot(1).y).toBe(bySlot(7).y);
    expect(bySlot(7).y).toBe(1.25);
  });

  it("never lets two keycaps overlap", () => {
    const placed = geo.keys.filter((k) => k.positioned);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const ox = Math.min(a.x! + a.w!, b.x! + b.w!) - Math.max(a.x!, b.x!);
        const oy = Math.min(a.y! + a.h!, b.y! + b.h!) - Math.max(a.y!, b.y!);
        expect(ox > 1e-9 && oy > 1e-9).toBe(false);
      }
    }
  });

  it("ignores disabled `;`-prefixed lines", () => {
    // The fixture carries a commented-out alternate for A with vk 0xFF; the
    // live line's 0x41 must win. Reading disabled lines would silently produce
    // a wrong keymap, which is the whole reason this is pinned.
    expect(bySlot(9).vk).toBe(0x41);
  });

  it("keeps the raw packed value and does not invent a page byte", () => {
    // KB.ini's category is NOT the keybind blob's page byte — see the script.
    const esc = bySlot(0);
    expect(esc.fn1).toEqual({ packed: "0x07000004", category: 0x07, usage: 0x04 });
    // A consumer-page assignment keeps its full 16-bit usage (0x223 AC Home).
    expect(bySlot(12).fn1).toEqual({
      packed: "0x02000223",
      category: 0x02,
      usage: 0x223,
    });
    expect(esc.fn1).not.toHaveProperty("page");
  });

  it("reports F1-F12 as locked and cross-checks that against the labels", () => {
    expect(geo.lockedSlots).toEqual([12]);
  });

  it("carries the device ids through from [OPT]", () => {
    expect(geo.vid).toBe("0x258a");
    expect(geo.pid).toBe("0x010C");
    expect(geo.matrixLen).toBe(128);
  });

  it("refuses a file whose rectangles are not left,top,right,bottom", () => {
    const stderr = runExpectingFailure(
      `[KEY]\n;A\nK1=30,30,25,27, 0x02,0x41,0x00,0\n`,
      "badrect",
    );
    expect(stderr).toMatch(/not left,top,right,bottom/);
  });

  it("refuses a file with a duplicate matrix slot", () => {
    const stderr = runExpectingFailure(
      `[KEY]\n;A\nK1=30,30,55,57, 0x02,0x41,0x00,0\n;B\nK2=69,30,94,57, 0x02,0x42,0x00,0\n`,
      "dupslot",
    );
    expect(stderr).toMatch(/duplicate matrix slot 0/);
  });

  it("refuses an unknown marker rather than guessing its meaning", () => {
    const stderr = runExpectingFailure(
      `[KEY]\n;A\nK1=30,30,55,57, 0x05,0x41,0x00,0\n`,
      "badmarker",
    );
    expect(stderr).toMatch(/unknown marker 0x5/);
  });
});
