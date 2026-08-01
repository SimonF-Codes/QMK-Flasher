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
layer, every layer exactly `keyCount` keys for the layout's keyboard (from
`shared/keyboards.json`; `meta.geometry` is the keyboard id — 72 for the
Moonlander, the only board today), `settings.keyLock === true`, colors/glows
are `#rrggbb`, combo layer/key indices in range.

### LED layering (per-layer colors + per-key glows)

The LED map is a second, parallel expression of the layer stack. Rendered by
`src-tauri/src/codegen/ledmap.rs` into the `ledmap[][RGB_MATRIX_LED_COUNT][3]`
block, with the surrounding firmware emitted by `ledmap_section` in
`keymap_c.rs`. Only present when `settings.rgbMatrixCustom` is true.

Resolution rule, in both the firmware and the UI: **a key lights with its own
`glow`, else with its layer's `color`.** `Layer.color` is the base HSV for all
of the layer's LEDs; `KeyAction.glow` overrides one. Colors are `#rrggbb` and
go through `hex_to_hsv` (`oryx/seed.rs`), which matches Oryx's own conversion.
`#000000` is not a color — `set_layer_color` reads `h=s=v=0` as **LED off**.

Two properties fall out of how the generated `rgb_matrix_indicators_user()`
works, and both are load-bearing when editing colors:

- It switches on `biton32(layer_state)` — the **topmost active layer** — and
  repaints every LED from that one row. Lower layers contribute nothing, so
  each layer's row has to be readable on its own.
- A `transparent` key falls through to a lower layer **behaviorally** but is
  still lit by the top layer's row. Its light does not tell you what it types.
  `fallthroughSource` (`src/lib/led.ts`) reports where the behavior comes from;
  `resolveLedColor` reports what the firmware shows.

`ledmap.rs` scatters argument order → **LED order** via `geometry.keys[arg].led`
(the two are a non-trivial permutation), and sizes each row by the geometry, not
by the layer.

**Editing** (added 2026-08-01). `src/lib/led.ts` holds the pure transforms —
`setLayerColor`, `setKeyGlow`, `clearLayerGlows`, `glowLayerKeysByTarget`,
`resolveLedColor`/`resolveLayerLeds`, `fallthroughSource`. Each returns the
**input object unchanged** when the edit is a no-op (bad hex, out-of-range
index, or a value already in place); `layoutStore` keys off that identity so a
redundant edit never marks the layout dirty. UI: `LedPanel` (layer base color +
bulk operations) in the layer tab bar, `KeyGlowEditor` (per-key override) in
the key picker, and `Keyboard` passes each key its resolved color so the board
previews the ledmap — inherited colors render faded, explicit glows solid.

### Multi-layout storage + keyboard registry (added 2026-07-19, additive)

`%APPDATA%\qmk-flasher\layouts\<id>.json` holds one LayoutFile per saved
layout (`id` = filename slug, stable across renames); `state.json` holds
`{activeLayoutId}`. The legacy single `layout.json` auto-migrates to
`layouts/arrows-together.json` on first access, and a fresh install
materializes the seeded fixture there — the store always has ≥1 layout and a
valid active id. `load_layout`/`save_layout`/`seed_from_oryx`/
`generate_sources`/`build_firmware`/`start_flash_pipeline` all operate on the
**active** layout.

`shared/keyboards.json` is the keyboard target registry
(`KeyboardInfo {id, name, qmkKeyboard, oryxGeometry, layoutMacro, keyCount,
geometryFile, supported}`); mirrors: `keyboards.rs` (serde) + `types.ts`
(zod). Only the Moonlander is `supported` today — seed/codegen/build refuse
other ids with `CodegenUnsupportedKey`; adding a board requires its geometry
JSON, an Oryx→LAYOUT permutation table, and generalizing codegen's
Moonlander-shaped rendering. `LayoutSummary {id, name, keyboard, modifiedAt}`
mirrors in `types.ts`.

**Key order**: keys and combo indices are stored in **LAYOUT_moonlander
argument order**; the seeder applies the Oryx→LAYOUT permutation exactly once
at seed time (full table in the plan's Discovery findings).

### OS mode / Ctrl↔Cmd swap (added 2026-07-30, additive)

**No schema or command changes** — the feature is three catalog entries plus
frontend logic. `CG_NORM` / `CG_TOGG` / `CG_SWAP` (category `osmode` in
`keycodes.json`) are ordinary `special` KeyActions; codegen emits them
verbatim and `rules.mk` is unchanged because QMK defaults `MAGIC_ENABLE ?=
yes` (`builddefs/generic_features.mk:17`). They set the board's Ctrl↔GUI swap
— `CG_TOGG` negates it, `CG_SWAP`/`CG_NORM` set it absolutely
(`process_magic.c:155/92/138`) — and it persists in EEPROM (`:190`).

`src/lib/osSwap.ts` mirrors QMK's `mod_config()` (`keycode_config.c:126`),
including its XOR guard, so the UI can preview post-swap behavior. It
deliberately does **not** swap `dualFunc` / `macro` / `tapDance`: those
compile to `register_code16()` / `SEND_STRING()` inside `process_record_user`,
which bypass `mod_config()`. `HOME_OS` in that file is the single place the
"which swap state is Mac" assumption lives.

The swap is **board-global**, not per-layer. `QK_LOCK` cannot participate in a
tap dance (`QK_LOCK = 0x7C59`; `register_code16` only handles basic keycodes
and never reaches `process_key_lock`), so OS-mode keys must occupy their own
key positions.

### Trainer mode (added 2026-08-01, frontend-only)

**No schema, command, event or Rust changes.** Live Key View now has two modes
over the same capture path: `monitor` (the original — watch and log, ask
nothing) and `trainer` (prompt for a key, score the answer, weight the next
prompt toward weak keys). `liveStore.mode` picks between them; monitoring stays
reachable at all times.

Pure logic is `src/lib/trainer.ts` (target classification, witness selection,
weighting, scoring, summaries, stats (de)serialization); `src/state/
trainerStore.ts` holds a session together and persists.

**What the trainer cannot see, and what it does about it.** The constraint at
the top of `liveKeys.ts` applies in full: we observe the board through
`KeyboardEvent`, i.e. after QMK is done with the press, so keys the firmware
consumes emit nothing. Every position is classified up front, and the UI names
the count and reason for everything it left out rather than silently marking
unseen keys wrong:

| bucket | which keys | how it is scored |
|---|---|---|
| `direct` | anything with an emitted tap code (`basic`, `modTap`, `layerTap` tap, `dualFunc` tap, `tapDance` tap, `special`) | the emitted code must match |
| `witness` | **momentary** layer keys — `MO`, `TT`, and `LT` when drilling layer navigation | hold the key and press a *witness* on the layer it activates; the witness's code arriving is the proof |
| excluded `silent` | `qkLock`, `rgb`, `rgbHsv`, `macro`, tap-dance without a tap | not scored — nothing reaches the OS |
| excluded `latching` | `TG`, `TO` | not scored — they park the board on another layer with no observable return, which would corrupt every later prompt in the session |
| excluded `noWitness` | a momentary layer key whose target layer emits nothing the base layer can't | not scored (e.g. the seeded layout's `LT(3)`: layer 3 is only macros and `TO` keys) |
| excluded `empty` | `none`, `transparent` | nothing to ask for; not reported |

A witness is **strong** when its code appears nowhere on the base layer (layer
0, `BASE_LAYER`) and **weak** when it merely differs from what the same position
emits there. Weak witnesses, and any direct target whose code is emitted by more
than one position in the layout, are flagged `ambiguous` and the UI says the
answer could have come from another key. Two positions emitting the same code
are genuinely indistinguishable from where we tap the signal.

**Persisted shape** (localStorage only — nothing on disk, nothing over IPC):

| key | value |
|---|---|
| `qmk-flasher.liveMode` | `"monitor" \| "trainer"` |
| `qmk-flasher.trainerScope` | `"currentLayer" \| "allLayers" \| "layerKeys"` |
| `qmk-flasher.trainerReveal` | `"true" \| "false"` — highlight the target on the board |
| `qmk-flasher.trainerStats` | `{version: 1, byLayout: {[layoutId]: {[`layer:position`]: KeyStat}}}` |

```
KeyStat { attempts, hits,          // lifetime, for display
          window: number[],        // last 10 outcomes, 1 = correct
          times: number[],         // last 10 correct reaction times (ms)
          lastAt }                 // epoch ms
```

Stats are bucketed **per layout id** because a position means nothing across
layouts. `version` is not migrated: an unrecognized version, and any individual
entry that fails its shape check, is dropped and practice history starts over
(`parseStats` is deliberately total — losing history is a nuisance, refusing to
open the trainer is worse). Weighting reads `window`/`times` only, so it decays:
a key you used to miss stops being favoured after ten clean answers.

### Layout version history (added 2026-07-21, additive)

Additive — **no existing signature changes**, `SCHEMA_VERSION` unchanged
(`LayoutFile` shape is untouched). Every layout keeps a history of prior
versions so the user can browse and revert; revert is itself undoable.

Snapshots live under `%APPDATA%\qmk-flasher\versions\<id>\<versionId>.json`,
one file per version = a `LayoutVersionSummary` header flattened alongside a
full `LayoutFile` copy under `layout`. `<versionId>` is a sortable timestamp
id (`YYYYMMDD-HHMMSS-mmm`, with a `-N` suffix on same-millisecond
collisions). All versions are kept in v1 (a per-layout cap/prune is a
documented follow-up). Existing layouts start with empty history — no
migration; the current layout stays exactly where it is (`layouts\<id>.json`).

```
LayoutVersionSummary { versionId, createdAt (ISO8601),
                       reason: "save"|"preReseed"|"preRestore"|"manual",
                       label? }
```
mirrors: `store.rs` (serde, `VersionReason` + `LayoutVersionSummary`) +
`types.ts` (zod).

Auto-snapshot behavior on existing commands (signatures unchanged):
- `save_layout` writes the active layout, then snapshots reason `save`,
  **deduped** — skipped when byte-identical to the newest existing version.
- `seed_from_oryx` snapshots the current active layout reason `preReseed`
  **before** overwriting it (only after fetch/build/cross-check succeed — a
  failed reseed that never overwrites leaves no snapshot). The pipeline's
  internal `store::save` and other paths do **not** auto-snapshot.
- `restore_layout_version` snapshots the current reason `preRestore` first,
  then overwrites the current with the chosen version and returns it.

## Commands (`src-tauri/src/commands.rs`)

All results are `Result<T, AppError>` unless noted; errors cross IPC as
`{code, message, hint}`.

| Command | Signature | Delegates to |
|---|---|---|
| `load_layout` | `() -> LayoutFile` | `layout::store::load` (the **active** layout) |
| `save_layout` | `(layout) -> ()` | `layout::store::save_with_history` (writes the active layout + auto-snapshots) |
| `seed_from_oryx` | `(layout_id, force) -> LayoutFile` | `oryx::seed_from_oryx` (re-seeds the active layout) |
| `get_geometry` | `() -> GeometryFile` | `geometry::get` (Moonlander; see `get_keyboard_geometry`) |
| `list_layouts` | `() -> LayoutSummary[]` | `layout::store::list_layouts` |
| `select_layout` | `(id) -> LayoutFile` | sets the active layout and returns it |
| `create_layout` | `(name, keyboard_id) -> LayoutSummary` | blank layout; does not change the active |
| `duplicate_layout` | `(id, new_name) -> LayoutSummary` | copy under a fresh id |
| `rename_layout` | `(id, name) -> LayoutSummary` | display name only; id stays |
| `delete_layout` | `(id) -> ()` | refuses the active layout |
| `list_layout_versions` | `(layout_id) -> LayoutVersionSummary[]` | version history, newest first |
| `restore_layout_version` | `(layout_id, version_id) -> LayoutFile` | snapshots current (`preRestore`), then restores |
| `snapshot_layout` | `(layout_id, reason, label?) -> LayoutVersionSummary` | explicit snapshot; `reason` must be `"manual"` |
| `list_keyboards` | `() -> KeyboardInfo[]` (infallible) | `keyboards::all` (shared/keyboards.json) |
| `get_keyboard_geometry` | `(keyboard_id) -> GeometryFile` | `geometry::get_for_keyboard` |
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
| `dfu-device` | `{present}` | Bootloader (0483:df11 or 3297:2003) appears/disappears |

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
- **`keycodes.json`** — 218 entries `{qmk, aliases, label, longLabel,
  category, tappable, modsApplicable}`; single source of truth for UI labels
  ↔ QMK codes; Rust validates emitted codes against it (Worker A). Covers
  every keycode in `reference_keymap.c`. Worker C owns/expands it post-fork.
- **`moonlander_geometry.json`** — 72 keys (x/y/w/h/r/rx/ry, matrix, led) in
  LAYOUT-arg order, generated by `scripts/extract-geometry.mjs` from QMK's
  `revb/keyboard.json`. Regenerate, don't hand-edit.
- **`layout.schema.json`** — JSON Schema generated from schema.rs.

## Build/infra notes

- `.cargo/config.toml` pins `target-dir` to
  `C:/Users/fridl/.cargo-targets/qmk-flasher`, shared by the repo and every
  worktree so a fresh worktree reuses the cache. (Originally a OneDrive
  workaround; the repo moved to `C:\dev` on 2026-07-30 and the shared target
  dir was kept deliberately.) `node_modules` is gitignored as usual.
- The firmware build runs `make SKIP_VERSION=yes <target>` and codegen writes
  keymap sources only when their content actually changed. Both are build-time
  measures, not correctness ones: on this machine a full rebuild is ~240s, and
  a keymap.c-only change with SKIP_VERSION is ~33s. QMK's recursive submake
  ignores `-j`, so parallelism is not available.
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
