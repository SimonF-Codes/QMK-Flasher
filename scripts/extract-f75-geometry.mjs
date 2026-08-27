#!/usr/bin/env node
// Extracts AULA F75 key geometry from the OEM configurator's KB.ini into
// f75_geometry.json — the F75 counterpart of extract-geometry.mjs.
//
//   node scripts/extract-f75-geometry.mjs <path-to-KB.ini> [--out <file>]
//
// Unlike the Moonlander's geometry, this output is NOT committed and NOT
// compiled into the binary. KB.ini comes out of AULA's proprietary Windows
// installer (extract it with `innoextract`; the layouts live at
// `app/Dev/kb/<variant>/KB.ini`), so whether its derived data may ship in this
// GPL repo is a licensing call that has not been made. Until it is, each user
// generates the file from their own installer and the app loads it at runtime.
// See docs/research/aula-f75-remapper-plan.md.
//
// NOTHING HERE IS INVENTED. Every position, size, matrix index and label is
// read out of KB.ini. The one derived quantity is the pixel→key-unit scale,
// and it is measured from the file's own numbers (see deriveScale) rather than
// assumed — if the file does not support the derivation the script fails
// instead of guessing.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--out");
const OUT =
  outFlag === -1
    ? defaultOut()
    : (argv[outFlag + 1] ?? die("--out needs a path"));
const INI = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");

if (!INI) {
  die(
    `usage: node scripts/extract-f75-geometry.mjs <path-to-KB.ini> [--out <file>]\n` +
      `\n` +
      `  KB.ini comes from the OEM AULA F75 Windows installer, unpacked with\n` +
      `  innoextract; the layouts are at app/Dev/kb/<variant>/KB.ini.\n` +
      `  Default --out: ${defaultOut()}`,
  );
}

function die(msg) {
  console.error(msg);
  process.exit(2);
}

function defaultOut() {
  // Same directory layout/store.rs persists to: %APPDATA%\qmk-flasher.
  const appdata = process.env.APPDATA;
  return appdata
    ? join(appdata, "qmk-flasher", "f75_geometry.json")
    : join("shared", "f75_geometry.json");
}

// ---- INI parsing -----------------------------------------------------------

// `;` starts a comment. This matters: KB.ini ships real-looking but DISABLED
// lines (`;KeyNotToSet=...`, a commented-out alternate `;K75=...`), and reading
// those as live data would produce a wrong keymap. Comments are dropped here,
// except that we keep the last one seen as the following key's label — the OEM
// file names each key in a comment directly above it.
function parseIni(text) {
  const sections = new Map();
  let current = null;
  let lastComment = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(";")) {
      lastComment = line.slice(1).trim();
      continue;
    }
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      current = sec[1].toUpperCase();
      if (!sections.has(current)) sections.set(current, []);
      lastComment = null;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1 || current === null) continue;
    sections.get(current).push({
      key: line.slice(0, eq).trim(),
      value: line.slice(eq + 1).trim(),
      label: lastComment,
    });
    lastComment = null;
  }
  return sections;
}

const text = readFileSync(INI, "utf8");
const sections = parseIni(text);

const opt = new Map(
  (sections.get("OPT") ?? []).map((e) => [e.key.toUpperCase(), e.value]),
);
const keyEntries = sections.get("KEY") ?? [];
const fnEntries = sections.get("FN1") ?? [];
if (keyEntries.length === 0) die(`no [KEY] section in ${INI}`);

// ---- [KEY] rows ------------------------------------------------------------

// Two shapes occur, and they are distinguished by the marker field, never by
// position — the F75 file ends with one entry of the second kind:
//
//   K1=30,30,55,57, 0x02,0x1B,0x00,0        marker 0x02 → Windows VK 0x1B
//   K81=0,0,0,0, 0x09,0x01,0x0700001D,84    marker 0x09 → packed HID output
//
// The four leading numbers are the on-screen rectangle. The OEM provenance
// note calls them "x,y,w,h"; THAT LABEL IS WRONG. They are left,top,right,
// bottom — K13=555,30,580,57 would otherwise be a 580-unit-wide F12. The
// assertion below re-checks this on every run rather than trusting the comment.
const VK_MARKER = 0x02;
const HID_MARKER = 0x09;

function num(s) {
  const t = s.trim();
  return t.toLowerCase().startsWith("0x") ? parseInt(t, 16) : parseInt(t, 10);
}

// KB.ini packs an output as 0xCC00UUUU — a CATEGORY in the high byte and a
// 16-bit value in the low half. Observed categories across the F75 file:
//
//   0x07  HID keyboard usages       (0x04='a' … 0x1A)
//   0x02  HID consumer usages       (0xB5 next, 0xCD play/pause, 0x223 AC Home)
//   0x08  vendor/special            (0x08030200, 0x08000001 … lighting etc.)
//   0x00  unclassified              (0x0004002B, 0x00080008)
//
// This category is AULA'S OWN NUMBERING AND IS NOT THE KEYBIND BLOB'S PAGE
// BYTE, and it is not a HID usage-page number either. The blob uses page byte
// 0x00 for HID page 0x07 and 0x02 for HID page 0x0C, so KB.ini 0x07 maps to
// blob 0x00 while KB.ini 0x02 maps to blob 0x02 — a mapping that happens to
// agree on one value and disagree on the other. Categories 0x08 and 0x00 have
// no known blob equivalent at all.
//
// So the raw `packed` value is kept as the authority and no page/usage pair is
// synthesised here. Collapsing these into a "page" field would bake in an
// equivalence that is only half true, and a half-true page byte is exactly the
// kind of thing that turns into a wrong write later.
function unpack(packed) {
  return {
    packed: `0x${(packed >>> 0).toString(16).padStart(8, "0")}`,
    category: (packed >>> 24) & 0xff,
    // Meaningful as a HID usage only for categories 0x07 and 0x02.
    usage: packed & 0xffff,
  };
}

const rows = [];
for (const e of keyEntries) {
  if (!/^K\d+$/i.test(e.key)) continue;
  const f = e.value.split(",").map((s) => s.trim());
  if (f.length < 8) die(`${e.key}: expected 8 fields, got ${f.length}`);
  const [x1, y1, x2, y2] = f.slice(0, 4).map(num);
  const marker = num(f[4]);
  const slot = num(f[7]);
  if (!Number.isInteger(slot)) die(`${e.key}: unreadable matrix index`);

  let vk = null;
  let hid = null;
  if (marker === VK_MARKER) {
    vk = num(f[5]);
  } else if (marker === HID_MARKER) {
    hid = unpack(num(f[6]));
  } else {
    die(`${e.key}: unknown marker 0x${marker.toString(16)}`);
  }

  rows.push({
    id: e.key,
    label: e.label,
    x1,
    y1,
    x2,
    y2,
    slot,
    vk,
    hid,
    // The F75 file ends with one 0,0,0,0 rectangle: a real slot with no
    // on-screen position, labelled "Wheel" — the encoder, which the OEM app
    // draws separately from the key grid. (Fn itself IS positioned, in the
    // bottom row.) Kept as a slot, excluded from the drawing and from the
    // scale derivation, where a zero-area rect would poison both.
    //
    // Only an ALL-ZERO rect means "no position". Deriving this from
    // `x2 > x1 && y2 > y1` instead would quietly reclassify a malformed or
    // inverted rectangle as an undrawn key and drop it from the board without
    // a word — so the two cases are separated here and the malformed one is
    // rejected below.
    positioned: !(x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0),
  });
}

// Structural validation runs BEFORE the geometry is derived: a duplicate slot
// or a malformed rectangle should be reported as what it is, not surface later
// as a confusing failure to derive a pitch.
const slotsSeen = new Set();
for (const r of rows) {
  if (r.positioned && (r.x2 <= r.x1 || r.y2 <= r.y1)) {
    die(`${r.id}: rectangle is not left,top,right,bottom — got ${r.x1},${r.y1},${r.x2},${r.y2}`);
  }
  if (slotsSeen.has(r.slot)) die(`duplicate matrix slot ${r.slot} (${r.id})`);
  slotsSeen.add(r.slot);
}

const drawn = rows.filter((r) => r.positioned);
if (drawn.length === 0) die("no positioned keys found");

// Keycaps are manufactured in quarter-unit widths; both the pitch fit and the
// final snapping rely on that, and the overlap check at the end verifies it.
const QUANTUM = 0.25;
const MAX_SNAP_ERROR = 0.15;

// ---- scale derivation ------------------------------------------------------

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// The OEM rectangles are INSET inside their grid cell: a 1u key is drawn 25px
// wide on a 39px pitch. So cell = drawn + (pitch - drawnWidthOf1u), and
// 1u = pitch. Both numbers are measured from the file:
//   - the most common drawn width IS the 1u key (most keys are 1u)
//   - the most common gap between adjacent keys in a row IS the pitch
// This is what makes space come out at 6.25u instead of 5.79u.
function deriveScale() {
  const w1 = mode(drawn.map((r) => r.x2 - r.x1));
  const h1 = mode(drawn.map((r) => r.y2 - r.y1));

  // Rows must be CLUSTERED, not grouped by exact y1: the OEM file places a
  // row's keys within a pixel or two of each other (119 and 120 both occur in
  // the Q row). Grouping on the raw value splits one row into several, and the
  // most common gap between "rows" then comes out as 1px instead of the pitch.
  // Tolerance is half a key height — real rows cannot be that close.
  const rowsOf = clusterBy(drawn.map((r) => r.y1), h1 / 2);
  const rowRep = new Map(); // raw y1 → the cluster's representative top
  for (const c of rowsOf) for (const v of c.values) rowRep.set(v, c.rep);

  const byRow = new Map();
  for (const r of drawn) {
    const rep = rowRep.get(r.y1);
    if (!byRow.has(rep)) byRow.set(rep, []);
    byRow.get(rep).push(r);
  }
  const steps = [];
  for (const list of byRow.values()) {
    list.sort((a, b) => a.x1 - b.x1);
    for (let i = 1; i < list.length; i++) {
      // Only 1u→next gaps measure the pitch; a wide key's step is a multiple.
      if (list[i - 1].x2 - list[i - 1].x1 === w1) {
        steps.push(list[i].x1 - list[i - 1].x1);
      }
    }
  }
  const seedPitch = mode(steps);
  if (!seedPitch || seedPitch <= 0) die("could not derive key pitch from [KEY] rows");

  const reps = rowsOf.map((c) => c.rep).sort((a, b) => a - b);
  const rowSteps = [];
  for (let i = 1; i < reps.length; i++) rowSteps.push(reps[i] - reps[i - 1]);
  const seedVPitch = mode(rowSteps);
  if (!seedVPitch || seedVPitch <= 0) die("could not derive row pitch from [KEY] rows");

  // The mode of adjacent gaps is only an integer-pixel ESTIMATE, and the true
  // pitch is fractional. Using the estimate, the error accumulates across the
  // board until two keys on opposite sides of it snap inconsistently and
  // overlap (Backspace ran 0.25u into Delete at pitch 38). So refine it: scan
  // for the pitch that puts every x and w closest to the 0.25u grid the
  // keycaps are actually manufactured on. Purely a fit to the file's own
  // numbers — it introduces no outside assumption beyond "keycaps are
  // quarter-unit sized", which the overlap check below then verifies.
  const fit = (lo, hi, offsets, sizes) => {
    let best = null;
    let bestErr = Infinity;
    for (let p = lo; p <= hi; p += 0.01) {
      const inset = p - (sizes.unit ?? 0);
      let err = 0;
      for (const v of offsets) err += gridErr(v / p) ** 2;
      for (const v of sizes.values) err += gridErr((v + inset) / p) ** 2;
      if (err < bestErr) {
        bestErr = err;
        best = p;
      }
    }
    return best;
  };
  const gridErr = (u) => {
    const s = Math.round(u / QUANTUM) * QUANTUM;
    return u - s;
  };

  const minX0 = Math.min(...drawn.map((r) => r.x1));
  const minY0 = Math.min(...rowsOf.map((c) => c.rep));
  const pitch = fit(
    seedPitch - 3,
    seedPitch + 3,
    drawn.map((r) => r.x1 - minX0),
    { unit: w1, values: drawn.map((r) => r.x2 - r.x1) },
  );
  const vPitch = fit(
    seedVPitch - 3,
    seedVPitch + 3,
    drawn.map((r) => rowRep.get(r.y1) - minY0),
    { unit: h1, values: drawn.map((r) => r.y2 - r.y1) },
  );

  return {
    pitch: Number(pitch.toFixed(3)),
    vPitch: Number(vPitch.toFixed(3)),
    hInset: Number((pitch - w1).toFixed(3)),
    vInset: Number((vPitch - h1).toFixed(3)),
    rowRep,
  };
}

/** Group near-equal numbers into clusters, each keyed by its smallest member. */
function clusterBy(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const clusters = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last.rep <= tol) last.values.push(v);
    else clusters.push({ rep: v, values: [v] });
  }
  return clusters;
}

const { pitch, vPitch, hInset, vInset, rowRep } = deriveScale();

const minX = Math.min(...drawn.map((r) => r.x1));
const minY = Math.min(...drawn.map((r) => r.y1));

// Keycap dimensions are quantised to quarter units, and the OEM coordinates
// carry a few px of hand-placement jitter. Snapping removes the jitter; the
// snap error is checked so that a file this model does NOT fit fails loudly
// instead of being silently distorted into a plausible-looking wrong board.
let worstSnap = 0;
let worstSnapAt = "";
function snap(u, what) {
  const s = Math.round(u / QUANTUM) * QUANTUM;
  const err = Math.abs(u - s);
  if (err > worstSnap) {
    worstSnap = err;
    worstSnapAt = what;
  }
  if (err > MAX_SNAP_ERROR) {
    die(
      `${what}: ${u.toFixed(3)}u is ${err.toFixed(3)}u off the ${QUANTUM}u grid ` +
        `— this KB.ini does not fit the derived scale (pitch ${pitch}px), refusing to guess`,
    );
  }
  return Number(s.toFixed(2));
}

const fn1 = new Map();
for (const e of fnEntries) {
  if (!/^K\d+$/i.test(e.key)) continue;
  const f = e.value.split(",").map((s) => s.trim());
  if (f.length < 3) continue;
  const packed = num(f[2]);
  if (!Number.isFinite(packed)) continue;
  fn1.set(e.key.toUpperCase(), unpack(packed));
}

const keys = rows.map((r) => {
  const out = {
    slot: r.slot,
    label: r.label ?? r.id,
    positioned: r.positioned,
  };
  if (r.positioned) {
    out.x = snap((r.x1 - minX) / pitch, `${r.id} x`);
    out.y = snap(((rowRep.get(r.y1) ?? r.y1) - minY) / vPitch, `${r.id} y`);
    out.w = snap((r.x2 - r.x1 + hInset) / pitch, `${r.id} w`);
    out.h = snap((r.y2 - r.y1 + vInset) / vPitch, `${r.id} h`);
  }
  if (r.vk !== null) out.vk = r.vk;
  if (r.hid) out.hid = r.hid;
  const fn = fn1.get(r.id.toUpperCase());
  if (fn) out.fn1 = fn;
  return out;
});

const seen = slotsSeen;

// Independent check on the whole derivation. Physical keycaps do not overlap,
// so if any pair of derived rectangles does, the pitch fit or the snapping is
// wrong and the output would be a plausible-looking but incorrect board. This
// is the guard that caught Backspace running 0.25u into Delete.
const placed = keys.filter((k) => k.positioned);
const overlaps = [];
for (let i = 0; i < placed.length; i++) {
  for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i];
    const b = placed[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 1e-9 && oy > 1e-9) {
      overlaps.push(`${a.label}(slot ${a.slot}) × ${b.label}(slot ${b.slot}) by ${ox}×${oy}u`);
    }
  }
}
if (overlaps.length) {
  die(
    `derived geometry has ${overlaps.length} overlapping key(s) — the scale fit is wrong, ` +
      `refusing to write a board that cannot be real:\n  ` +
      overlaps.slice(0, 8).join("\n  "),
  );
}

// Firmware-pinned F1–F12: not remappable by any tool including the vendor's
// own. Recorded here so the UI can show them as locked rather than offering an
// edit that the board will silently ignore. Cross-checked two ways — the
// documented slot list, and the fact that these are exactly the [KEY] rows
// whose labels are F1..F12.
const DOCUMENTED_LOCKED = [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78];
const byLabel = keys
  .filter((k) => /^F([1-9]|1[0-2])$/.test(k.label ?? ""))
  .map((k) => k.slot)
  .sort((a, b) => a - b);
const lockedSlots = DOCUMENTED_LOCKED.filter((s) => seen.has(s));
const agrees =
  byLabel.length === lockedSlots.length &&
  byLabel.every((s, i) => s === lockedSlots[i]);

const out = {
  source: `${opt.get("NAME") ?? "AULA F75"} (KB.ini)`,
  vid: opt.get("VID") ?? null,
  pid: opt.get("PID") ?? null,
  matrixLen: opt.has("MATRIXLEN") ? num(opt.get("MATRIXLEN")) : null,
  // How the pixel rectangles above were turned into key units, so the output
  // can be audited against the source file without re-reading this script.
  scale: { pitchPx: pitch, vPitchPx: vPitch, hInsetPx: hInset, vInsetPx: vInset },
  lockedSlots,
  keyCount: keys.length,
  keys,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log(`wrote ${OUT}`);
console.log(
  `  ${keys.length} keys (${drawn.length} positioned), ` +
    `scale ${pitch}x${vPitch}px/u insets ${hInset}/${vInset}px, worst snap ${worstSnap.toFixed(3)}u at ${worstSnapAt}`,
);
console.log(
  `  locked F1-F12 slots ${lockedSlots.join(",")} — ` +
    (agrees
      ? "label cross-check AGREES"
      : `label cross-check DISAGREES (labels say ${byLabel.join(",")}) — investigate before trusting`),
);
if (!agrees) process.exitCode = 1;
