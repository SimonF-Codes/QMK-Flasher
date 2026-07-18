# QMK-Flasher Worker Contract

Shared contract between the parallel workers building QMK-Flasher — a Tauri
v2 desktop app that edits Simon's Moonlander layout ("Arrows Together", Oryx
`rddD7`) and builds + flashes it with the Key Lock customization
(`KC_MEH`→`QK_LOCK`) that Oryx cannot express. Authoritative plan:
`C:\Users\fridl\.claude\plans\tender-honking-platypus.md`.

**FROZEN after Phase 0:** everything under "Contract surface" below —
`commands.rs`, `events.rs`, `error.rs`, `layout/schema.rs`, `src/lib/types.ts`,
`shared/*`. Changes go to main first (schema bump + both mirrors + this doc),
workers rebase.

## Worker boundaries

| Worker | Owns (exact paths) | Scope |
|---|---|---|
| Foundation (done) | `docs/CONTRACT.md`, `shared/`, `scripts/`, `src-tauri/src/{layout/,commands.rs,events.rs,error.rs,geometry.rs,appcfg.rs}` | Scaffold, schema, contract, stubbed module bodies |
| Worker A | `src-tauri/src/oryx/`, `src-tauri/src/codegen/`, `src-tauri/src/build/` | Oryx seeding, QMK codegen, MSYS build |
| Worker B | `src-tauri/src/flash/` | USB watching + DFU flashing (+ pipeline hardening) |
| Worker C | `src/` (except `src/lib/types.ts` — lockstep mirror) | Real frontend; sole editor of `shared/keycodes.json` after fork |

Worker modules expose plain functions taking `FnMut` callbacks for
progress/logs — they never touch `AppHandle`; the command layer forwards
callbacks to the webview as events. Keep that pattern.

## Layout schema (v2)

Source of truth: **`src-tauri/src/layout/schema.rs`** (serde). Mirrors:
**`src/lib/types.ts`** (zod), **`shared/layout.schema.json`** (generated —
regenerate with `REGEN_SCHEMA=1 cargo test json_schema`; a test fails if
stale). `SCHEMA_VERSION` = **2**. All JSON is camelCase.

```
LayoutFile { schemaVersion, meta { name, geometry,
             seededFrom { layoutId, revisionHash, qmkVersion, seededAt } },
             layers: Layer[], combos: Combo[], settings }
Layer      { title, color: "#rrggbb", keys: KeyAction[72] }   // LAYOUT-arg order
Combo      { name, keys: number[] /* LAYOUT-arg indices */, layer, action: KeyAction }
settings   { autoShift, capsWord, tapDance, combos, keyLock: true (always),
             oryx, rgbMatrixCustom, layerState8bit, serialNumber, rgbStartupSpeed }
```

`KeyAction` is a tagged union on `kind`, every variant with optional
`glow: "#rrggbb"`:

| kind | payload | notes |
|---|---|---|
| `none` | — | KC_NO |
| `transparent` | — | KC_TRANSPARENT |
| `basic` | `code, mods?: string[]` | mods are `MOD_*` tokens, e.g. `["MOD_LCTL"]` |
| `layerSwitch` | `action: "MO"\|"TG"\|"TO"\|"TT", layer` | |
| `modTap` | `mods: string[], tap` | MT() |
| `layerTap` | `layer, tap` | LT() |
| `dualFunc` | `tap: {code, mods?}, hold: {code, mods?}` | Oryx DUAL_FUNC_n |
| `qkLock` | — | the Key Lock key |
| `special` | `code` | QK_BOOT, CW_TOGG, AS_*, AU/MU_*, TOGGLE_LAYER_COLOR |
| `tapDance` | `tap?, hold?, doubleTap?, tapHold?, tappingTerm?` | v1 read-only |
| `macro` | `label, steps: [{code, delay?, mods?}]` | v1 read-only |
| `rgb` | `code` | RGB_TOG etc., v1 read-only |
| `rgbHsv` | `h, s, v` (0–255) | Oryx HSV_h_s_v key, v1 read-only |

Validation beyond shape (Rust `validate()` / zod): schemaVersion matches, ≥1
layer, every layer exactly 72 keys, `settings.keyLock === true`, colors/glows
are `#rrggbb`, combo layer/key indices in range.

**Key order**: keys and combo indices are stored in **LAYOUT_moonlander
argument order**; the seeder applies the Oryx→LAYOUT permutation exactly once
at seed time (full table in the plan's Discovery findings).

## Commands (`src-tauri/src/commands.rs`)

All results are `Result<T, AppError>` unless noted; errors cross IPC as
`{code, message, hint}`.

| Command | Signature | Delegates to |
|---|---|---|
| `load_layout` | `() -> LayoutFile` | `layout::store::load` |
| `save_layout` | `(layout) -> ()` | `layout::store::save` |
| `seed_from_oryx` | `(layout_id, force) -> LayoutFile` | `oryx::seed_from_oryx` |
| `get_geometry` | `() -> GeometryFile` | `geometry::get` |
| `get_app_config` | `() -> AppConfig` (infallible) | `appcfg::get` |
| `set_app_config` | `(cfg) -> ()` | `appcfg::set` |
| `generate_sources` | `(layout) -> {keymapC, rulesMk, configH}` | `codegen::generate` |
| `build_firmware` | `() -> String` (.bin path) | `build::build_firmware` |
| `start_flash_pipeline` | `(layout) -> ()` | save → generate → build → flash |
| `cancel_pipeline` | `() -> ()` | `flash::cancel` |
| `list_dfu_devices` | `() -> DfuDeviceInfo[]` | `flash::list_dfu_devices` |
| `flash_firmware` | `(bin_path) -> ()` | `flash::flash_firmware` (no rebuild) |

## Events (`src-tauri/src/events.rs`)

The v1 `flash:progress`/`flash:done` events are **gone** (replaced, no
aliases — nothing shipped against them).

| Event | Payload | When |
|---|---|---|
| `build-log` | `{line}` | Each MSYS make output line during `building` |
| `pipeline-state` | `{phase, detail?, progress?}` | Every phase transition |
| `dfu-device` | `{present}` | Bootloader (0483:df11) appears/disappears |

`phase` ∈ `idle | saving | generating | building | waitingForBootloader |
erasing | flashing | leaving | done | error`. `progress` is 0–100 within the
phase. Phase `error` carries the message in `detail` (the command also
returns the `AppError`).

## Errors (`src-tauri/src/error.rs`)

One `AppError` enum, serialized `{code, message, hint}` (`hint` nullable):
`OryxUnreachable, PermutationMismatch, CodegenUnsupportedKey, BuildFailed,
DfuNotFound, DfuAccessDenied, DfuVerifyFailed` (per plan) + `InvalidLayout`
(foundation addition — load/save/config validation failures need a code).

## Shared data (`shared/`)

- **`fixtures/reference_{keymap.c,rules.mk,config.h}`** — copies of the real
  `arrows_together` sources (today's flashed firmware). Golden spec: Worker
  A's codegen must reproduce `reference_keymap.c` byte-identically modulo
  whitespace (QK_LOCK included). Never edit; re-copy from qmk_firmware only.
- **`fixtures/oryx_rddD7_QzpBEp.json`** — live Oryx GraphQL snapshot
  (7 layers × 72 keys + 2 combos, fetched 2026-07-17). Seeder unit tests run
  against this, offline.
- **`fixtures/seeded_layout.json`** — expected seeder output. **PARTIAL**:
  layers 0–1 of 7 hand-derived (see its `_note`); Worker A regenerates the
  full file and removes the note. Glow positions in it were cross-checked
  through the permutation table.
- **`keycodes.json`** — 212 entries `{qmk, aliases, label, longLabel,
  category, tappable, modsApplicable}`; single source of truth for UI labels
  ↔ QMK codes; Rust validates emitted codes against it (Worker A). Covers
  every keycode in `reference_keymap.c`. Worker C owns/expands it post-fork.
- **`moonlander_geometry.json`** — 72 keys (x/y/w/h/r/rx/ry, matrix, led) in
  LAYOUT-arg order, generated by `scripts/extract-geometry.mjs` from QMK's
  `reva/keyboard.json`. Regenerate, don't hand-edit.
- **`layout.schema.json`** — JSON Schema generated from schema.rs.

## Build/infra notes

- `.cargo/config.toml` pins `target-dir` to
  `C:/Users/fridl/.cargo-targets/qmk-flasher` (repo is under OneDrive; keeps
  target/ out of sync). `node_modules` is gitignored as usual.
- The `arrows_together` keymap dir in qmk_firmware is never written to — it
  is the known-good recovery reference. Codegen emits into
  `keymaps/qmk_flasher/` (see `AppConfig.keymapName`; `arrows_together` is
  rejected as a target).
- Toolchain on this machine: rustup stable-msvc 1.97.1, VS Build Tools 2022,
  Node 22, QMK MSYS at `C:\QMK_MSYS`, qmk_firmware at
  `C:\Users\fridl\qmk_firmware`.

## Verification

- Phase 0: `npm run tauri dev` opens the placeholder window (loads the
  fixture over IPC); `cd src-tauri && cargo test` green; `npm test` (vitest)
  validates fixture + geometry + keycodes against the zod mirrors; `npx tsc
  --noEmit` clean.
- Worker A: seeder tests over the Oryx snapshot (mapping rules, permutation,
  MEH-count=1, combo translation); golden codegen test vs
  `reference_keymap.c` (diffs via `similar`).
- Worker B: safe E2E first flashes the existing known-good arrows_together
  .bin (zero behavior change).
