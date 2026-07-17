# QMK-Flasher Worker Contract

This document is the shared contract between the parallel workers building
QMK-Flasher. The foundation (this commit) provides the scaffolding, fixtures,
schema, and stubbed IPC surface. Workers replace stub bodies — **not**
signatures, event names, or schema shapes — without coordinating first.

## Worker boundaries

| Worker | Owns (exact paths) | Scope |
|---|---|---|
| Foundation (done) | `docs/CONTRACT.md`, `fixtures/`, `src-tauri/src/layout/`, `src-tauri/src/commands.rs`, `src-tauri/src/events.rs`, `src/lib/types.ts` | Scaffold, schema, stubbed module bodies |
| Worker A | `src-tauri/src/oryx/`, `src-tauri/src/codegen/`, `src-tauri/src/build/` | Oryx seeding, keymap codegen, MSYS firmware build |
| Worker B | `src-tauri/src/flash/` | USB/DFU flashing |
| Worker C | `src/` (except `src/lib/types.ts`, which stays in lockstep with the Rust schema) | Real frontend |

Workers replace the bodies inside their modules; the public functions listed
below and everything in `commands.rs`/`events.rs`/`layout/` stay as-is unless
the contract is bumped.

### Module surface (what each worker implements)

- `oryx::seed_layout() -> Result<SeededLayout, String>` — produce the current
  layout (from Oryx / QMK sources). Stub: returns the fixture.
- `codegen::generate_keymap(&SeededLayout) -> Result<String, String>` —
  render `keymap.c` contents. Stub: returns the fixture file.
- `build::compile(keyboard, on_progress) -> Result<String, String>` — MSYS
  QMK build; returns the firmware image path; reports `FlashProgress` with
  stage `compiling` via the callback. Stub: canned ticks + fake path.
- `flash::flash(keyboard, firmware_path, on_progress) -> Result<FlashDone, String>`
  — USB/DFU flash of a built image; reports the remaining stages via the
  callback. Stub: canned sequence, no hardware.

Progress callbacks are `FnMut(FlashProgress)`; the command layer forwards
them to the webview as events, so worker modules never touch `AppHandle`.

Changing anything in the **Contract surface** below requires bumping
`SCHEMA_VERSION` (both sides), updating this document, and announcing via
`cos-coord note`.

## Contract surface

### Layout schema

Defined in **`src-tauri/src/layout/schema.rs`** (serde, source of truth) and
mirrored in **`src/lib/types.ts`** (zod). Current `SCHEMA_VERSION`: **1**.

`SeededLayout`:

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | int | Must equal `SCHEMA_VERSION` |
| `keyboard` | string | QMK keyboard name (e.g. `ws_together`) |
| `keymap` | string | QMK keymap name (e.g. `default`) |
| `layout_macro` | string | LAYOUT macro used in `keymap.c` |
| `key_count` | int | Keys per layer; every layer must match |
| `layers` | `Layer[]` | In `keymaps[]` order; `layers[i].index == i` |
| `source` | object | Repo-relative paths: `keymap_c`, `config_h`, `rules_mk` |
| `seeded_at` | string | RFC 3339 timestamp |

`Layer`: `{ index: int, name: string, keys: string[] }` — `keys` are raw QMK
keycode strings in LAYOUT-macro argument order (e.g. `KC_A`, `MO(_FN)`).

Validation beyond shape (`SeededLayout::validate()` / zod `superRefine`):
schema_version matches, ≥1 layer, every layer has exactly `key_count` keys,
layer indices are contiguous from 0.

### Commands (`src-tauri/src/commands.rs`)

Commands are a thin delegation layer over the worker modules — workers do not
edit this file.

| Command | Signature | Delegates to |
|---|---|---|
| `get_layout` | `() -> Result<SeededLayout, String>` | `oryx::seed_layout` |
| `save_layout` | `(layout: SeededLayout) -> Result<(), String>` | `codegen::generate_keymap` (renders, discards for now) |
| `compile_firmware` | `(keyboard: String) -> Result<String, String>` (firmware path) | `build::compile` |
| `flash_firmware` | `(keyboard: String) -> Result<(), String>` | `build::compile` then `flash::flash` (full pipeline), emits `flash:done` at the end |

Errors cross IPC as strings (the `Err` variant).

### Events (`src-tauri/src/events.rs`)

| Event | Payload | When |
|---|---|---|
| `flash:progress` | `{ stage, percent, message }` | During compile/flash |
| `flash:done` | `{ success, message }` | Once per flash attempt |

`stage` serializes as snake_case: `compiling`, `waiting_for_bootloader`,
`flashing`, `done`. `percent` is 0–100 within the current stage.

### Fixtures (`fixtures/ws_together/`)

A minimal 4×4 ortho pad (2 layers, 16 keys) used by all tests:

- `keymap.c`, `config.h`, `rules.mk` — QMK sources the seeder must parse
- `seeded_layout.json` — the exact `SeededLayout` the seeder must produce
  from them (byte-for-byte field equality, whitespace aside)

Worker A's acceptance tests: seeding yields a struct equal to the parsed
`seeded_layout.json`, and codegen from `seeded_layout.json` yields a
`keymap.c` that re-seeds to the same struct. Worker B flashes only images
produced by `build::compile`.

## Repo layout

```
fixtures/ws_together/     shared test fixture (see above)
docs/CONTRACT.md          this file
src-tauri/src/layout/     schema.rs — Rust schema (source of truth)
src-tauri/src/oryx/       Worker A: Oryx seeding (stub)
src-tauri/src/codegen/    Worker A: keymap codegen (stub)
src-tauri/src/build/      Worker A: MSYS firmware build (stub)
src-tauri/src/flash/      Worker B: USB/DFU flashing (stub)
src-tauri/src/commands.rs invoke surface (delegation layer — do not edit)
src-tauri/src/events.rs   event names + payloads (do not edit)
src/                      Worker C: frontend (placeholder)
src/lib/types.ts          zod mirror of schema + events (lockstep with Rust)
src/lib/types.test.ts     vitest: fixture ↔ schema
```

## Verification

- `npm run tauri dev` — opens the placeholder window (loads fixture via IPC)
- `cd src-tauri && cargo test` — Rust schema/stub tests
- `npm test` — vitest validates the fixture against the zod schema
