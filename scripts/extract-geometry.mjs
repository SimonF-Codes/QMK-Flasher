#!/usr/bin/env node
// Extracts Moonlander key geometry + LED map from QMK's keyboard.json into
// shared/moonlander_geometry.json. Re-run after a qmk_firmware update:
//   node scripts/extract-geometry.mjs [path-to-keyboard.json]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEYBOARD_JSON =
  process.argv[2] ??
  "C:/Users/fridl/qmk_firmware/keyboards/zsa/moonlander/revb/keyboard.json";
const LAYOUT_NAME = "LAYOUT_moonlander";

const kb = JSON.parse(readFileSync(KEYBOARD_JSON, "utf8"));

// LAYOUT_moonlander is an alias (layout_aliases) for LAYOUT in revb.
const resolved = kb.layout_aliases?.[LAYOUT_NAME] ?? LAYOUT_NAME;
const layout = kb.layouts?.[resolved]?.layout;
if (!layout) {
  throw new Error(`layouts.${resolved}.layout not found in ${KEYBOARD_JSON}`);
}

const ledByMatrix = new Map(
  (kb.rgb_matrix?.layout ?? []).map((led, i) => [String(led.matrix), i]),
);

const keys = layout.map((k, i) => {
  const led = ledByMatrix.get(String(k.matrix));
  if (led === undefined) {
    throw new Error(`no LED for key ${i} (matrix ${k.matrix})`);
  }
  return {
    x: k.x,
    y: k.y,
    w: k.w ?? 1,
    h: k.h ?? 1,
    ...(k.r !== undefined && { r: k.r }),
    ...(k.rx !== undefined && { rx: k.rx }),
    ...(k.ry !== undefined && { ry: k.ry }),
    matrix: k.matrix,
    led,
  };
});

const out = {
  keyboard: "zsa/moonlander/revb",
  layoutMacro: LAYOUT_NAME,
  keyCount: keys.length,
  keys,
};

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "shared",
  "moonlander_geometry.json",
);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${outPath} (${keys.length} keys)`);
