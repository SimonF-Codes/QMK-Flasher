---
status: stable
---

# AULA F75 — QMK feasibility research

**Date:** 2026-08-27
**Question:** can the AULA F75 be added as a second supported keyboard alongside the Moonlander?
**Verdict: no.** The F75 cannot take QMK firmware from this app, and no amount of
registry/geometry work changes that. No feature code was written.

This document exists so the next person does not repeat the research.

## What the board actually runs

The AULA F75 (sold both directly by AULA and as the EPOMAKER x AULA F75 / F75 Max /
Pro / Ultra) ships **proprietary vendor firmware**. It is not QMK, not VIA, and not a
QMK-derived vendor fork. Configuration is done through a Windows-only AULA/EPOMAKER
driver that talks a bespoke HID protocol.

### It is not in QMK

- No `aula` and no `f75` keyboard exists in upstream `qmk/qmk_firmware`. Code search
  for `aula` in that repo returns two unrelated hits (`keyboards/gboards/butterstick/config.h`
  and a vendored `arduino-1.0.1/cores/arduino/Udp.h`); `f75` hits are other boards
  such as `herevoland/buff75`.
- `data/mappings/keyboard_aliases.hjson` contains no `aula`/`f75` entry, so it is not
  a renamed target either.
- GitHub repository search for `aula f75 qmk` returns **zero** repositories. There is
  no community port, maintained or abandoned.

Note: our local `C:\Users\fridl\qmk_firmware` is a trimmed checkout containing only
`keyboards/zsa/`, so its lack of an `aula` directory proves nothing by itself. The
statements above are against upstream.

### The MCU is an 8051 vendor part, not an architecture QMK targets

USB IDs taken from working reverse-engineering projects (not from spec sheets or
marketing copy):

| Variant / mode | VID:PID | Vendor |
| --- | --- | --- |
| F75, wired | `258A:010C` | Sino Wealth Electronic Ltd. |
| F75, 2.4 GHz dongle | `3554:FA09` | Compx/Bekan-class wireless dongle |
| F75 Max, wired | `0C45:800A` | Sonix Technology Co., Ltd. |

Both `258A` (SinoWealth) and `0C45` (SONiX) are 8051-core HID controller vendors.
QMK targets AVR and ARM; **SinoWealth parts are not supported by QMK at all**. The
only 8051 options are out-of-tree and unrelated to us:

- **SonixQMK** (`SonixQMK/qmk_firmware`, `sn32` branch) is a real fork for SONiX
  SN32F24x boards — but its compatible-keyboards list covers Ajazz, Akko, Aukey,
  GMMK, Keychron, Redragon, Womier, etc. **No AULA or EPOMAKER F75 entry.** A SONiX
  VID alone does not mean SonixQMK runs on it; the fork needs a per-board port.
- **SMK** (`carlossless/smk`) is a QMK-ish firmware for SinoWealth 8051 parts, and
  `sinowisp` / `sinowealth-kb-tool` can read and write flash over the ISP bootloader.
  Both are explicitly experimental, easy to brick a device with, and are a different
  firmware project — not something `qmk compile` produces.

An earlier web result claiming an **STM32F072CBT6** appeared in an AliExpress SEO
article that conflated the F75 with the AKKO TAC75 HE. It is not corroborated by any
teardown or by the observed USB IDs, and should be treated as wrong.

### What the community actually built for this board

This is the strongest structural signal. Every F75 project on GitHub is a
**reverse-engineered HID configurator or a Wine wrapper**, never a firmware port:

`cloudglides/aula-f75-linux-drivers`, `AmoabaKelvin/aula-f75-configurator`,
`not-ayan/openaula`, `cvsqwe/OpenAula`, `VitalyArt/Aula-F75-Max-Driver`,
`Nokkasiili/aula-f75-linux`, `Ghost-CR/F75_Initializer`,
`vinicenter/epomaker-aula-f75-linux-driver`, `xntebli/aula-f75-linux`, and others.

They drive the stock firmware at runtime via HID feature reports — e.g. 520-byte
feature report `0x06` with a 128-byte config region for wired, 20-byte output report
`0x13` for the dongle. **None of them replace firmware, and none mention QMK or VIA.**
If a QMK path existed, this is not the software people would be writing.

## Why this is fatal for our pipeline specifically

The app's contract is: generate QMK C → `qmk compile` → flash a DFU bootloader.

1. **No `qmkKeyboard` value exists.** There is nothing to put in the registry field;
   `qmk compile` has no target to build.
2. **No `LAYOUT_*` macro and no `keyboard.json`.** `scripts/extract-geometry.mjs`
   consumes a QMK `keyboard.json`; there is no such file for this board. Deriving
   geometry from photos or the vendor configurator would be **fabricated geometry** —
   explicitly out of bounds, and it would be unverifiable.
3. **Wrong flashing protocol.** `src-tauri/src/flash/` speaks DFU to `0483:df11`
   (STM32 ROM) or `3297:2003` (ZSA bootloader). The F75 exposes an 8051 ISP
   bootloader over vendor HID. That is not a parameter change — it is a second
   flasher backend, with real bricking risk on an undocumented board.
4. **Wireless makes it worse, not neutral.** The 2.4 GHz dongle is a separate USB
   device (`3554:FA09`) running its own link firmware. Even a hypothetical working
   board-side firmware would have to keep the vendor's proprietary pairing protocol,
   which is exactly what QMK does not implement.

## Would `supported: false` be a useful middle ground?

The brief correctly notes `supported: false` is a legitimate state — a board we can
edit layouts for but not yet flash. **It is still not appropriate here**, because the
blocker is upstream of flashing: we cannot obtain honest geometry. `supported: false`
means "we can lay this out, we just can't flash it yet". For the F75 we can do
neither. A registry entry would need a fabricated `qmkKeyboard`, a fabricated
`layoutMacro`, and a fabricated geometry file — three lies to express one truth.

If Simon wants the F75 in the app anyway, the honest shape is a **different feature**:
a WebHID/HID vendor-protocol remapper that drives the stock firmware, like the
community tools above. That shares essentially nothing with the QMK codegen/build/DFU
pipeline beyond the key-grid UI.

## Codebase audit: what a second keyboard would cost (for a board that IS QMK)

Recorded because it is useful independently of the F75.

### Already per-keyboard (registry-driven, no work needed)

- `shared/keyboards.json` + `src-tauri/src/keyboards.rs` — `id`, `name`,
  `qmkKeyboard`, `oryxGeometry`, `layoutMacro`, `keyCount`, `geometryFile`,
  `supported`, resolved by id; `LayoutFile.meta.geometry` stores the id.
- `src-tauri/src/codegen/mod.rs` derives the keymap output dir from `qmkKeyboard`.
- `src-tauri/src/codegen/config_h.rs` — the RGB brightness clamp is deliberately
  resolved in C against the board's own `RGB_MATRIX_MAXIMUM_BRIGHTNESS`, so it is
  already correct for a board we have never heard of.
- `src-tauri/src/codegen/ledmap.rs` — sized by `geo.keys.len()` and scatters by each
  key's `led` index, not by a 72 constant. Genuinely generic **except** that it calls
  the Moonlander-only `geometry::get()` instead of `geometry::get_for_keyboard()`.

### Hardcoded, genuinely per-keyboard, would need generalizing

- **`MOONLANDER_KEY_COUNT = 72`** — `src-tauri/src/layout/schema.rs:16` and
  `src/lib/types.ts:16`. Used as a hard Zod `.length()` on layer keys and geometry
  keys and as the combo index ceiling (`types.ts:123,128,254`), and enforced in
  `oryx/seed.rs:421`. This is a schema-level constraint that must become a lookup
  against the layout's own keyboard.
- **Geometry loading** — `src-tauri/src/geometry.rs` `include_str!`s
  `moonlander_geometry.json` and `get_for_keyboard()` match-arms only that filename;
  the frontend statically imports it at `src/lib/geometry.ts:6` and `src/lib/ipc.ts:25`.
- **`codegen/keymap_c.rs`** — emits the literal `LAYOUT_moonlander(` at :370, hard
  refuses `meta.geometry != "moonlander"` at :687, and its `ROWS` split
  (`[0..14, 14..28, 28..42, 42..54, 54..66, 66..72]`) plus the half-gap arg set
  `{7,21,35,48,60,69}` are Moonlander-shaped formatting.
- **`scripts/extract-geometry.mjs`** — `KEYBOARD_SUBPATH`, `LAYOUT_NAME` and the
  output path are constants. Parameterization job, not a rewrite.
- **`shared/default_layout.json`** — the demo layout is 8 layers × 72 keys,
  `meta.geometry: "moonlander"`. Per-keyboard by nature; a new board needs its own.
- **`src-tauri/src/flash/`** — DFU only, bootloader IDs `0483:df11` / `3297:2003`.
  Fine for any STM32 DFU board; a new protocol means a new backend.

### Moonlander-specific *by definition* — not a generalization target

- **`src-tauri/src/oryx/permute.rs`** — `ORYX_TO_LAYOUT: [usize; 72]` maps Oryx key
  order onto `LAYOUT_moonlander`. Oryx is ZSA-only. A non-ZSA board has no Oryx
  source, so it needs no permutation at all rather than a second table. The
  `oryxGeometry` registry field is likewise meaningless for non-ZSA boards.

## Sources

- [QMK firmware (upstream)](https://github.com/qmk/qmk_firmware) — no `aula`/`f75` keyboard
- [SonixQMK compatible keyboards](https://sonixqmk.github.io/SonixDocs/compatible_kb/) — no AULA/F75
- [carlossless/sinowisp (sinowealth-kb-tool)](https://github.com/carlossless/sinowealth-kb-tool)
- [carlossless/smk](https://github.com/carlossless/smk)
- [Ghost-CR/F75_Initializer](https://github.com/Ghost-CR/F75_Initializer) — F75 Max HID protocol, `0c45:800a`
- [cloudglides/aula-f75-linux-drivers](https://github.com/cloudglides/aula-f75-linux-drivers) — `258A:010C`, `3554:FA09`
- [AmoabaKelvin/aula-f75-configurator](https://github.com/AmoabaKelvin/aula-f75-configurator)
- [The USB ID Repository — 258a](https://usb-ids.gowdy.us/read/UD/258a), [0c45](https://usb-ids.gowdy.us/read/UD/0c45)
- [EPOMAKER x AULA F75 product page](https://epomaker.com/products/epomaker-aula-f75)
