# Design proposal: multi-layout & multi-keyboard selector

Status: **draft for Alpha review** (Worker C, 2026-07-19). Nothing here is
implemented; contract changes route through Alpha per CONTRACT.md. Feature
request from Simon: a menu to select between multiple saved layouts and
multiple keyboard designs/targets.

Ownership per Alpha: Worker C = frontend selector UI; Worker A = backend
(multi-layout storage + multi-keyboard codegen/build). Worker B unaffected
(flash consumes a .bin path regardless of target).

## Goals

1. Keep several named layouts saved locally; switch between them in-app;
   edits/dirty state stay per-layout.
2. Support more than one keyboard design/target (e.g. Moonlander rev A now;
   Voyager or a future board later): per-keyboard geometry, LAYOUT macro,
   key count, build target, and DFU identity.
3. Zero regression for the current single-layout Moonlander flow — the app
   must still open straight into "Arrows Together" and Build & Flash.

## Non-goals (this iteration)

- Cloud sync, import/export UI beyond Oryx seeding, per-layout git history.
- Editing geometries in-app (geometry files are data shipped with the app).
- Cross-keyboard layout conversion (a layout is bound to one geometry id).

## Current state (main @ a560706)

- One layout at `%APPDATA%\qmk-flasher\layout.json`; `store::load()` falls
  back to the seeded fixture.
- `meta.geometry: String` already names the geometry id ("moonlander") —
  the per-layout keyboard binding already exists in the schema.
- Geometry is a single checked-in file (`shared/moonlander_geometry.json`);
  frontend parses it at module load (`src/lib/geometry.ts` const) and the
  zod/serde schemas hard-pin `keys.length == 72` via `MOONLANDER_KEY_COUNT`.
- Codegen/build hard-code `zsa/moonlander/reva` + keymap `qmk_flasher`;
  DFU identity hard-codes STM32 `0483:df11`.

## Proposed contract delta (needs SCHEMA_VERSION 3 + Alpha sign-off)

### Storage (Worker A)

```
%APPDATA%\qmk-flasher\
  layouts\<uuid>.json      # LayoutFile (schema v3), one per saved layout
  state.json               # { activeLayoutId }
  layout.json              # legacy v2 — migrated on first run to layouts\<uuid>.json
```

Migration: on startup, if `layouts\` is empty and `layout.json` exists,
move it in as a layout named by its `meta.name`, mark active. Keep the old
file as `layout.v2.bak`.

### Schema v3 (both mirrors + shared/layout.schema.json regen)

- `LayoutFile.meta` gains `id: string` (uuid, stable) — needed so the
  frontend can rename a layout without the name doubling as identity.
- `Layer.keys` length becomes **geometry-driven**, not a schema constant:
  serde/zod validate `keys.length == geometry(meta.geometry).keyCount`.
  (zod: `superRefine` against a geometry registry; serde: custom validate.)
- Everything else unchanged.

### Commands (proposal; final signatures are Alpha's call)

Replace the two singletons with id-parameterized versions plus enumeration:

```
list_layouts()                          -> LayoutSummary[]   // {id, name, geometry, updatedAt}
load_layout(id: Option<String>)         -> LayoutFile        // None = active layout (back-compat)
save_layout(layout)                     -> ()                // routes by layout.meta.id
create_layout(geometry: String, name)   -> LayoutFile        // blank or template
duplicate_layout(id, name)              -> LayoutFile
delete_layout(id)                       -> ()                // refuses to delete the active layout
set_active_layout(id)                   -> ()
list_keyboards()                        -> KeyboardInfo[]    // see below
get_geometry(id: Option<String>)        -> GeometryFile      // None = active layout's geometry
seed_from_oryx(layoutId, force)         -> LayoutFile        // gains: creates a NEW layout entry
```

`start_flash_pipeline(layout)` keeps its signature — the pipeline resolves
build target + DFU identity from `layout.meta.geometry` via the keyboard
registry (below). Worker B's `flash::` API is unchanged (bin path in,
events out); only `flash::mod` wait/open constants become parameters fed
by the registry (coordinate with B — small, mechanical).

### Keyboard registry (Worker A, new shared data)

`shared/keyboards.json` — one entry per supported target:

```json
{
  "id": "moonlander",
  "displayName": "ZSA Moonlander Mk I (rev A)",
  "geometryFile": "moonlander_geometry.json",
  "qmkTarget": "zsa/moonlander/reva",
  "layoutMacro": "LAYOUT_moonlander",
  "keymapName": "qmk_flasher",
  "dfu": { "vid": "0483", "pid": "df11", "kind": "dfuse" },
  "oryxGeometry": "moonlander"
}
```

Codegen/build read the entry instead of constants. Adding a keyboard =
adding a registry entry + a geometry json + codegen template coverage
(Worker A scope; the ZSA boards share the Oryx module system so Voyager is
mostly data).

### Events

Unchanged. (`pipeline-state`, `build-log`, `dfu-device` are target-neutral;
if we ever flash non-STM32 boards the dfu-device payload may want a
`keyboard` field — out of scope now.)

## Frontend design (Worker C scope)

### UI

Header gains a **layout switcher** (left of the app title block, Oryx-style):

- Dropdown button showing `meta.name` + a small keyboard chip (e.g.
  "Moonlander"). Click → menu listing all layouts grouped by keyboard,
  with: New layout… (picks keyboard from `list_keyboards`), Duplicate,
  Rename (inline), Delete (confirm; blocked for active), Seed from Oryx….
- Switching with unsaved edits prompts: Save / Discard / Cancel (same
  dirty-guard used by close).
- The keyboard identity of a layout is fixed at creation (shown, not
  editable) — conversion is a non-goal.

### State/store changes

- `layoutStore` gains `layouts: LayoutSummary[]`, `activeId`, and a
  `geometry: GeometryFile` loaded per active layout (replacing the
  module-level `GEOMETRY` const in `src/lib/geometry.ts`; `viewBox()` and
  `keyRect()` take the geometry as an argument).
- `Keyboard.tsx` renders from store geometry; `Key.tsx` unchanged.
- `KeyPicker` layer grids already derive counts from the loaded layout —
  no change. `MOONLANDER_KEY_COUNT` uses in `types.ts` become per-geometry
  refinement (part of the schema v3 mirror bump).
- Mock mode: mock `list_layouts`/`create_layout`/etc. over an in-memory
  map seeded with the fixture, so the whole selector is buildable and
  testable browser-only before Worker A lands storage.

### Phasing (frontend can start ahead of backend)

1. **Phase S1 — selector UI on mock IPC** (no contract dependency beyond
   the agreed shapes): dropdown, create/duplicate/rename/delete/switch,
   dirty-guard, vitest coverage. Ships dark behind the mock flag.
2. **Phase S2 — geometry-driven rendering**: de-const `GEOMETRY`, feed
   from store; still Moonlander-only data.
3. **Phase S3 — flip to real IPC** once Worker A lands storage + registry;
   Voyager (or any second board) becomes a data-only addition.

## Asks / open questions for Alpha & Worker A

1. Approve the command list + schema v3 delta above (or send back edits);
   C will then mirror `types.ts` in lockstep with A's `schema.rs` bump.
2. `seed_from_oryx` creating a new layout vs overwriting active — proposed:
   always create new (safer; delete is cheap).
3. Does `AppConfig.keymapName` move into the keyboard registry (proposed)
   or stay a global override?
4. Worker B: parameterizing DFU vid/pid/kind from the registry — OK as a
   follow-up, or does pass-2 hardening land constants somewhere specific?
5. Naming: "keyboard designs/targets" surfaced to Simon as just
   "Keyboard" (registry `displayName`) — any objection?

## Test plan (frontend)

- vitest: store switch semantics (dirty-guard, active persistence calls),
  selector menu actions against mock IPC, geometry-driven viewBox for a
  fake 4-key geometry (proves no 72-key assumptions remain).
- CDP smoke on the real app once S3 lands: create → edit → switch →
  switch back → save → build for the non-default target (no flash).
