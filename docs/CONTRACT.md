# QMK-Flasher Worker Contract

This document is the shared contract between the parallel workers building
QMK-Flasher. The foundation (this commit) provides the scaffolding, fixtures,
schema, and stubbed IPC surface. Workers replace stub bodies — **not**
signatures, event names, or schema shapes — without coordinating first.

## Worker boundaries

| Worker | Owns | Replaces |
|---|---|---|
| Foundation (done) | Scaffold, fixtures, schema, stubs, this doc | — |
| Worker A — Seeder | Parsing QMK sources (`keymap.c`/`config.h`/`rules.mk`) into a `SeededLayout` | Body of `get_layout` |
| Worker B — Codegen | Turning an edited `SeededLayout` back into QMK sources | Body of `save_layout` |
| Worker C — Flashing + UI | Compile/flash pipeline and the real frontend | Body of `flash_firmware`, all of `src/App.tsx`+ |

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

| Command | Signature | Stub behavior |
|---|---|---|
| `get_layout` | `() -> Result<SeededLayout, String>` | Returns the embedded `fixtures/ws_together/seeded_layout.json` |
| `save_layout` | `(layout: SeededLayout) -> Result<(), String>` | Validates, discards |
| `flash_firmware` | `(keyboard: String) -> Result<(), String>` | Emits a canned progress sequence, touches no hardware |

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

Worker A's acceptance test: seeding the three QMK files yields a struct equal
to the parsed `seeded_layout.json`. Worker B's: codegen from
`seeded_layout.json` yields a `keymap.c` that re-seeds to the same struct.

## Repo layout

```
fixtures/ws_together/     shared test fixture (see above)
docs/CONTRACT.md          this file
src-tauri/src/layout/     schema.rs — Rust schema (source of truth)
src-tauri/src/commands.rs invoke surface (stubs)
src-tauri/src/events.rs   event names + payloads (stubs)
src/lib/types.ts          zod mirror of schema + events
src/lib/types.test.ts     vitest: fixture ↔ schema
```

## Verification

- `npm run tauri dev` — opens the placeholder window (loads fixture via IPC)
- `cd src-tauri && cargo test` — Rust schema/stub tests
- `npm test` — vitest validates the fixture against the zod schema
