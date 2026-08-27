# QMK-Flasher Worker Contract

Shared contract between the parallel workers building QMK-Flasher — a Tauri
v2 desktop app that edits Simon's Moonlander layout ("Arrows Together", Oryx
`rddD7`) and builds + flashes it with the Key Lock customization
(`KC_MEH`→`QK_LOCK`) that Oryx cannot express. The authoritative plan
(`tender-honking-platypus.md`) lives outside the repo, in the author's
planning notes.

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

## Layout schema (v5)

Source of truth: **`src-tauri/src/layout/schema.rs`** (serde). Mirrors:
**`src/lib/types.ts`** (zod), **`shared/layout.schema.json`** (generated —
regenerate with `REGEN_SCHEMA=1 cargo test json_schema`; a test fails if
stale). `SCHEMA_VERSION` = **5**. All JSON is camelCase.

```
LayoutFile { schemaVersion, meta { name, geometry,
             seededFrom { layoutId, revisionHash, qmkVersion, seededAt } },
             layers: Layer[], combos: Combo[], settings }
Layer      { title, color: "#rrggbb", keys: KeyAction[72] }   // LAYOUT-arg order
Combo      { name, keys: number[] /* LAYOUT-arg indices */, layer, action: KeyAction }
settings   { autoShift, capsWord, tapDance, combos, keyLock: true (always),
             oryx, rgbMatrixCustom, layerState8bit, serialNumber,
             osDetection, osDefault, lighting? }
```

Every version so far has been **additive or a pure removal**: every field added
since v1 is `serde(default)` / zod-`optional`, so serde has already filled it in
by the time `migrate()` runs, and v5's one removal (`rgbStartupSpeed`) is a field
serde now simply ignores — so each arm only moves the version stamp. The arms
are written as a **ladder** rather than a match — v2 walks 2→3→4→5 — so the
first non-trivial step lands in the right order.
`v2_layout_migrates_to_current_schema`, `v3_…` and
`v4_layout_migrates_and_its_lighting_starts_reaching_the_board` are the pattern
to copy.

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
| `special` | `code` | QK_BOOT, QK_CLEAR_EEPROM, CW_TOGG, AS_*, AU/MU_*, TOGGLE_LAYER_COLOR |
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

### RGB Matrix effects (added 2026-08-26, additive)

Reactive and animated lighting, via `settings.lighting` — **optional**, absent
by default. Absent means *this layout does not configure RGB Matrix at all*,
which is what every Oryx-seeded layout means and what keeps the generated
`config.h` byte-identical to `shared/fixtures/reference_config.h`. It is not
the same as "an effect set to nothing".

```
lighting? { mode: "ledmap" | "effect" | "reactive",
            effect: string,            // RGB_MATRIX_DEFAULT_MODE
            extraEffects: string[],    // also compiled in, for RGB_MOD
            hue, sat, val, speed: u8,  // RGB_MATRIX_DEFAULT_{HUE,SAT,VAL,SPD}
            reactiveBoost: u8,         // QF_REACTIVE_BOOST   (reactive mode)
            reactiveFadeMs: u16,       // QF_REACTIVE_FADE_MS (reactive mode)
            applyOnBoot: bool }        // restate all of the above at boot
```

`effect` / `extraEffects` name QMK effects from **`shared/rgb_effects.json`**
(mirrors: `src-tauri/src/rgb_effects.rs` serde + `types.ts` zod). Each entry is
`{qmk, label, blurb, reactive, framebuffer, hue, speed, alwaysCompiled}`, read
out of `quantum/rgb_matrix/animations/*.h`: `qmk` is the suffix shared by the
effect's `RGB_MATRIX_EFFECT(NAME)` declaration, its `ENABLE_RGB_MATRIX_NAME`
switch and its `RGB_MATRIX_NAME` mode constant. `validate()` rejects a name the
catalog does not have, because codegen pastes it straight into both.

**The two painters cannot share the board.** The generated
`rgb_matrix_indicators_user()` runs *after* the active effect has drawn its
frame and `set_layer_color()` overwrites every LED, so under the ledmap an
effect is not dimmed — it is invisible. `mode` therefore decides, rather than
one silently winning:

- `ledmap` — today's behavior exactly. The effect is compiled in and
  configured; ZSA's `TOGGLE_LAYER_COLOR` (`keyboard_config.disable_layer_led`)
  stops the repaint at runtime and reveals it. `keymap.c` is byte-identical to
  what a layout with no `lighting` generates.
- `effect` — `ledmap[]`, `set_layer_color`, `rgb_matrix_indicators_user` and
  `hsv_to_rgb_with_value` are **not emitted**. The layer/key colors stay in the
  layout and come back when the mode does. `codegen::keymap_c::emits_ledmap`
  is the predicate; `src/lib/rgbEffects.ts#paintedBy` mirrors it.
- `reactive` — a **ledmap** mode (added 2026-08-27): the same table, the same
  repaint, with each LED's `v` scaled by how recently it was struck. See below.

### Reactive brightness over the ledmap (added 2026-08-27)

**None of QMK's twelve reactive effects can do this, and that is why the mode
exists.** Every one of them renders through `effect_runner_reactive`
(`quantum/rgb_matrix/animations/runners/effect_runner_reactive.h`), which paints
each LED from the single global `rgb_matrix_config.hsv` — one hue and one
saturation for the whole board. Selecting one replaces a layout's per-key colors
with one color; that is what "reactive, but every key white" is.

`mode: "reactive"` emits the ledmap exactly as `ledmap` does and adds one
function, `qf_reactive_value(led, v)`, called from `set_layer_color()` between
the black-is-off test and `hsv_to_rgb_with_value()`. Only `v` moves — `h` and
`s` come from the ledmap untouched.

The source of truth is `g_last_hit_tracker` (`rgb_matrix.h:284`, declared only
under `RGB_MATRIX_KEYREACTIVE_ENABLED`): `count` live entries appended
oldest-first, each with the struck LED's `index` and `tick`, **milliseconds**
since the hit (`rgb_task_timers` adds `sync_timer_elapsed32` deltas). The
generated search runs backwards and stops at the first entry for the LED, so it
reads the most recent hit.

- **A tap cannot go above the layout's color.** The peak an LED can reach is
  already `hsv.v` scaled by `rgb_matrix_config.hsv.v`, which the board clamps to
  its own ceiling. So `reactiveBoost` is how far an untouched key sits *below*
  its color and a hit restores it to full: `level` runs from `255 - BOOST` at
  rest to `255` at the strike, linear over `reactiveFadeMs`. `boost: 0` is the
  static ledmap; `255` leaves unstruck keys dark.
- **`LED_HITS_TO_REMEMBER` is 8, and the overflow is visible.** Strike a ninth
  key while eight are still inside the fade window and
  `rgb_matrix_handle_key_event` shifts the oldest entry out of the buffer; that
  key drops straight back to rest instead of finishing its fade. Colors are
  never affected — they do not come from the tracker.
- **`{0,0,0}` stays off.** The modulation is applied after the off test, so a
  key the ledmap turns off stays off however hard it is struck.
- **`reactiveFadeMs` is bounded to 50..=5000** (`REACTIVE_FADE_MS_RANGE` in
  Rust, `REACTIVE_FADE_MS_{MIN,MAX}` in `types.ts`) and checked by `validate()`.
  It is a divisor in the generated C, and QMK's ticks are `uint16_t` ms.
- **`RGB_MATRIX_KEYPRESSES` is derived from the MODE as well as the effect set.**
  `Lighting::needs_keypresses` returns true for `mode == Reactive` regardless of
  which effects are compiled in, because the tracker does not exist without it.
  `costs()` in `rgbEffects.ts` mirrors this and reports `reactiveLedmap`
  separately so the panel can name the right reason. The generated keymap.c also
  carries an `#error` if the two ever disagree.

### The app's settings reaching the board: `applyOnBoot` (added 2026-08-27)

`RGB_MATRIX_DEFAULT_MODE/HUE/SAT/VAL/SPD` are applied by `rgb_matrix_init()`
**only when EEPROM holds no mode at all** — `eeconfig_init_rgb_matrix(); if
(!rgb_matrix_config.mode) eeconfig_update_rgb_matrix_default();`. On any board
that has been used before, every one of them is ignored and the board keeps the
hue, saturation, brightness and effect it was last left on. Worse, `#undef`-ing
effects shrinks the effect enum, so a stored mode *index* resolves to a
different effect after each flash. This also silently pinned the ledmap's master
brightness, since `hsv_to_rgb_with_value()` reads `rgb_matrix_config.hsv.v` live.

`applyOnBoot` (default **true**) makes the firmware authoritative: the generated
`keyboard_post_init_user()` calls `rgb_matrix_mode_noeeprom`,
`rgb_matrix_sethsv_noeeprom` and `rgb_matrix_set_speed_noeeprom` — all real,
in `rgb_matrix.c` — after `rgb_matrix_enable()`. **The ordering is load-bearing:**
`rgb_matrix_sethsv_eeprom_helper` returns having done nothing while the matrix
is disabled, so enabling must come first.

**The trade-off is stated in `LightingPanel`, not hidden:** with this on, a mode
cycled to with `RGB_MOD` on the board does not survive a replug. That is the
right default for an app that owns the layout, and it is a checkbox.

`keyboard_post_init_user` is emitted by exactly one of four places —
`ledmap_section`, `effect_section`, `os_section`, or `render` itself for a layout
that configures lighting but carries no ledmap — and all four build the body
through `keymap_c::post_init`, so they cannot drift.

`QK_CLEAR_EEPROM` (alias `EE_CLR`) is in `shared/keycodes.json` and bound in the
shipped demo layout. It is the escape hatch for a board whose stored settings
have gone wrong, and it costs one key.

**Derived, never stored** (same rule as `TAP_DANCE_ENABLE` / `COMBO_ENABLE`):
`RGB_MATRIX_KEYPRESSES` iff some compiled-in effect is `reactive`,
`RGB_MATRIX_FRAMEBUFFER_EFFECTS` iff some is `framebuffer`. A stored flag would
drift into compiling an effect that can never render, or paying scan time for
nothing. `Lighting::needs_keypresses` / `needs_framebuffer` in Rust,
`costs()` in `rgbEffects.ts` — the UI's warning and the emitted define come
from the same derivation.

**The effect set is trimmed with `#undef`, and that is load-bearing.** The
Moonlander's `keyboard.json` already `ENABLE_`s 48 effects into the generated
`info_config.h`, which the build `-include`s *before* the keymap's `config.h`
(`build_keyboard.mk:430` vs `:508`, ordered into `-include` flags by
`common_rules.mk:275`). So the keymap file is the last word: `#undef` genuinely
removes an effect. This matters because the twelve reactive effects are all
already `ENABLE_`d and are compiled out only for want of
`RGB_MATRIX_KEYPRESSES` — turning that on unlocks all twelve at once. Trimming
is how it is paid for, and it pays for far more than that: see the measured
sizes in `CHANGELOG.md`. `SOLID_COLOR` is never `#undef`ed or `#define`d — it
is the one effect QMK compiles in unguarded (`solid_color_anim.h:1`) and the
floor everything else leans on.

**`RGB_MATRIX_STARTUP_SPD` is gone, and so is `settings.rgbStartupSpeed`**
(removed 2026-08-27, schema v5). It appears nowhere in `qmk_firmware`; the real
name is `RGB_MATRIX_DEFAULT_SPD`, so the value never reached a board and the
line read as the app's one dynamic lighting knob while doing nothing. It was
kept for Oryx byte-parity; that is no longer a good enough reason for a define
that lies. Removing it is the only change to the generated firmware that is
provably invisible to the board, which is why the fix is a removal and not a
rename — renaming it would change what every existing layout's board does.
`shared/fixtures/reference_config.h` drops the same line and is therefore real
Oryx output minus exactly that one dead define. `lighting.speed` is the knob
that works.

`lighting.val` is also the ledmap's master brightness: the generated
`hsv_to_rgb_with_value()` scales every ledmap color by `rgb_matrix_config.hsv.v`,
so it dims every mode. Note that it reads that value **live**, not from the
define — which is precisely why it needed `applyOnBoot` to mean anything on a
used board.

Editing follows the `led.ts` contract — every transform in `rgbEffects.ts`
(`setLighting`, `patchLighting`, `setBootEffect`, `toggleExtraEffect`) returns
the **input layout unchanged** on a no-op, and `layoutStore` keys off that
identity for dirty tracking. UI: `LightingPanel` in the layer tab bar, beside
`LedPanel`.

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

### Live key reports (added 2026-08-01)

Live view and the trainer read the board through the firmware, not the webview.
`src-tauri/src/keyreport` opens QMK's raw-HID channel (usage page 0xFF60 /
usage 0x61, ZSA's Oryx protocol, already compiled in), pairs, and decodes; the
command layer forwards it as `key-report` / `layer-report`. No firmware change
and no reflash. `start_key_reporting` / `stop_key_reporting` bracket it, so the
pairing flag is held only while live view is on and Keymapp/Oryx can have the
channel the rest of the time.

Why this matters: `pre_process_record_oryx` fires *before* the keycode is
consumed, so keys QMK never sends to the OS — `MO`/`TO`/`TG`/`TT`, `QK_LOCK`,
`RGB_*` — are reported too, and `layer_state_set_oryx` makes layer state ground
truth instead of inference.

Frontend consequences:

- **Positions are looked up, not inferred.** `geometry.ts:positionForMatrix`
  maps `matrix: [row, col]` → LAYOUT-arg index from
  `shared/moonlander_geometry.json`. The old `findLayerWithMatch` /
  `matchPositions` inversion of the layout is gone.
- **The layer comes from the board.** `liveStore.activeLayer` follows
  `layer-report`; auto-follow obeys it rather than guessing. The manual layer
  pin is kept — it is now a preference, not a correction.
- **No fallback.** If the channel cannot be opened, `liveStore.status` goes
  `unavailable` with the `KeyReportUnavailable` error and the panel says so
  (with a Retry). It never quietly reverts to browser key events; a source badge
  shows `firmware` / `waiting` / `no reports`.
- **`liveKeys.ts` keeps the browser half only.** The firmware answers "which
  switch, which layer"; `KeyboardEvent` answers "what character came out", which
  `liveStore.emitted()` attaches to the report that caused it (within
  `EMIT_WINDOW_MS`) and the scratchpad shows directly.

### Trainer mode (added 2026-08-01, frontend-only)

**No schema or command changes.** Live Key View has two modes over the same
capture path: `monitor` (watch and log, ask nothing) and `trainer` (prompt for a
key, score the answer, weight the next prompt toward weak keys).
`liveStore.mode` picks between them; monitoring stays reachable at all times.

Pure logic is `src/lib/trainer.ts` (target selection, weighting, scoring,
summaries, stats (de)serialization); `src/state/trainerStore.ts` holds a session
together and persists.

**A target is a position on a layer, and an answer is a switch.** Grading is by
position, exactly: `grade(target, position)`. The `direct` / `witness` /
`excluded` classification that used to live here existed only because keys the
firmware consumes were invisible through `KeyboardEvent` — with reports they are
not, so `MO`/`TG`/`TO`/`TT` and `QK_LOCK` are ordinary targets, witnesses are
gone, and `ambiguous` is gone (two positions can emit the same code; they are
never the same switch).

The one limit that remains, and the UI says it in the prompt: **presses made
while the board is on another layer are navigation, not answers**, and are not
scored either way. The only positions that cannot be drilled at all are `none`
and `transparent` — nothing to name.

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

### Tutorial mode (added 2026-08-26, frontend-only)

A guided tour of every feature, offered once to a new user and reopenable from
the header afterwards. Fifteen topics in a fixed order — `welcome`, `key`,
`layer`, `tapHold`, `tapDance`, `lock`, `macro`, `combo`, `osSwap`, `osMacro`,
`lighting`, `live`, `versions`, `guide`, `flash` — each building on the last
rather than following the order the layout happens to be in.

**Steps are derived from the layout, not hardcoded.** `src/lib/tutorial.ts`
builds each step by asking `toolGuide.ts` for a live example of the feature in
the current layout, so a step points at a real key wherever that key currently
is. Move a key and the tour follows it, including onto another layer, which it
names. This is also why the tutorial and the Tool Guide cannot drift: they are
one derivation with two presentations — the guide is the reference (everything
at once, printable), the tour is the tour (one thing at a time, in order).

Invariants worth keeping, each pinned by a test in `tutorial.test.ts`:

- The tour is **the same length whatever the layout**, so "step 7 of 16" means
  something. A feature the layout lacks still gets its step and explains
  itself; it just says so instead of pointing.
- A step **never carries both an example and a missing-note**.
- A step **never renders empty** — every topic teaches something with nothing
  to point at.

`the_demo_layout_has_a_live_example_of_every_advanced_kind` (Rust) is the other
half of that contract: without it the shipped layout could quietly lose a
feature and the tour would start saying "not in this layout" with nothing else
noticing.

`tutorialStore.ts` persists a `seen` flag to `localStorage`, set the moment the
tour is **offered or started** — never when finished. Nobody is asked twice,
and nobody has to reach the end to stop being asked.

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

## OS tooling (v3)

Schema v3 is additive over v2. `LayoutFile::migrate()` (called from the single
`parse_and_validate` funnel in `layout/store.rs`) stamps a v2 file up to v3;
the two new `Settings` fields are `serde(default)`, so serde has already
filled them in by the time it runs. A layout written by an older build keeps
opening — that path is pinned by `v2_layout_migrates_to_current_schema`.

### One key, two operating systems

```ts
{ kind: "osMacro", label: "Desktop right",
  mac:     [{ code: "KC_RIGHT", mods: ["MOD_LCTL"] }],
  windows: [{ code: "KC_RIGHT", mods: ["MOD_LGUI", "MOD_LCTL"] }] }
```

The board holds an **OS mode** and picks a half at press time, so one physical
key does the right thing on either machine — the two lists are unrelated
sequences, not a mod substitution, which is why the existing Ctrl↔Cmd swap
cannot express them (Windows uses `Gui+Ctrl+←/→` for virtual desktops, macOS
uses `Ctrl+←/→`). Either list may be empty, meaning "this key does nothing on
that OS"; both empty is a validation error.

`{ kind: "osMode", action: "toggle" | "mac" | "windows" | "auto" }` sets that
mode, generating `QF_OS_TOGG` / `QF_OS_MAC` / `QF_OS_WIN` / `QF_OS_AUTO`
(all four are in `shared/keycodes.json`, category `osmode`). Setting the mode
drives **both** the Ctrl↔Cmd swap and which half of every `osMacro` fires, so
there is one source of truth rather than two things to keep in sync. The older
`CG_TOGG`/`CG_SWAP`/`CG_NORM` keys still parse and still work; they move the
swap only, and `src/lib/osSwap.ts` continues to model them.

### Settings

- `osDetection` (default `false`) — emits `OS_DETECTION_ENABLE` so the board
  asks the host what it is at USB enumeration.
- `osDefault` (default `"windows"`) — the OS assumed before detection answers
  and whenever detection is off. It is also the OS the layout's plain Ctrl/Gui
  mods were authored against, so it decides which way the swap runs. Windows is
  the default because Arrows Together is Windows-authored (see `osSwap.ts`
  `HOME_OS`, which this field supersedes).

Agreed precedence: **detection is authoritative, a manual `osMode` key
overrides it, and the override is dropped when detection reports a *different*
OS than last time** (i.e. you moved to another machine). `"auto"` drops the
override on demand.

### Combos

`Combo.keys` must now hold **at least two distinct** key indices — a one-key
"combo" is just a key, and a repeated index cannot fire. Both are validation
errors. This is what makes the combo editor's output well-formed by
construction.

### How it reaches the firmware

`qf_os_mac` is the board's OS mode and the single source of truth for it: it
drives both the Ctrl<->Cmd swap and which half of every `OS_MACRO_n` fires, so
the two cannot disagree. `settings.osDefault` is emitted as
`#define QF_OS_DEFAULT_MAC` and the swap runs exactly when the current mode
differs from it — the direction is derived from the define rather than baked
into the generated code, so flipping the setting changes that one line.

`QF_OS_*` keys are emitted only when the layout actually binds one, and an
`osMacro` with one empty side generates correctly ("does nothing on that OS").

**The `OS_MACRO_n` `SEND_STRING`s are deliberately not wrapped to suspend the
swap**, because the swap never reaches them. `mod_config()`/`keycode_config()`,
where `keymap_config.swap_lctl_lgui` is applied, are called **only** from
`quantum/keymap_common.c` — the keycode->action path (`QK_MODS`, one-shot,
layer-mod, mod-tap). `register_code16` (`quantum/quantum.c:126`) does not call
them, and neither does the `register_code()`/`tap_code()` trio `SEND_STRING`
runs on. So macro modifiers are emitted literally on both machines and are
never re-swapped. The same fact means a plain `macro` or `dualFunc` carrying
Ctrl/Gui is **not** swapped either — which is exactly why `osMacro` exists, and
what the Tool Guide flags as `bypassed`.

`OS_DETECTION_SINGLE_REPORT` is deliberately left **undefined**:
`quantum/os_detection.c` suppresses every report after the first when it is set
(`if (!first_report) return;`), and the agreed precedence rule — drop the
manual override when detection reports a *different* OS — depends on that later
report arriving.

### Combos are counted, not flagged

`COMBO_ENABLE` and `COMBO_COUNT` derive from `layout.combos.len()`, not from
`settings.combos`, so adding or removing a combo can never desync the build.
`settings.combos` is now unused by codegen — the same status as
`settings.tapDance`, and for the same reason (a stale flag broke a build in
July).

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
| `start_key_reporting` | `() -> ()` | `keyreport::start`; streams `key-report`/`layer-report` |
| `stop_key_reporting` | `() -> ()` | `keyreport::stop` (idempotent) |
| `get_f75_geometry` | `() -> F75GeometryState` | `f75::geometry::load`; `{state:"missing"}` is a normal answer, not an error — see **AULA F75** |

## Events (`src-tauri/src/events.rs`)

The v1 `flash:progress`/`flash:done` events are **gone** (replaced, no
aliases — nothing shipped against them).

| Event | Payload | When |
|---|---|---|
| `build-log` | `{line}` | Each MSYS make output line during `building` |
| `pipeline-state` | `{phase, detail?, progress?}` | Every phase transition |
| `dfu-device` | `{present}` | Bootloader (0483:df11 or 3297:2003) appears/disappears |
| `key-report` | `{row, col, pressed}` | A physical switch changed state, while key reporting is on |
| `layer-report` | `{layer}` | The board's topmost active layer changed |

`phase` ∈ `idle | saving | generating | building | waitingForBootloader |
erasing | flashing | leaving | done | error`. `progress` is 0–100 within the
phase. Phase `error` carries the message in `detail` (the command also
returns the `AppError`).

`key-report`/`layer-report` are **two events, not one**, deliberately: a layer
is a *level* that persists until it changes, a keypress is an *edge*. The board
reports them separately too — `pre_process_record_oryx` fires the switch before
`layer_state_set_oryx` fires the layer it caused. `row`/`col` are matrix
coordinates; `shared/moonlander_geometry.json` maps them to LAYOUT-arg indices
(`src/lib/geometry.ts:positionForMatrix`).

## Mirroring a layer (`src/lib/mirror.ts`)

Frontend-only, like `layers.ts` — no Rust counterpart, since a mirrored layer
is an ordinary `LayoutFile` by the time it is saved.

**The pairing is derived, never listed.** `MIRROR_MAP[i]` is built by
reflecting key `i`'s centre (rotation applied) about `MIRROR_AXIS_X`, the
middle of the board's bounding box, and taking the nearest key within 0.05u. A
key with no partner maps to *itself*, and the map is forced symmetric — if
`map[map[i]] !== i`, both ends fall back to themselves. A hand-written index
table would be a second source of truth for the board's shape that no test can
check against the geometry; this one is checked against the coordinates.
`THUMB_POSITIONS` is derived the same way: the group of keys below the widest
vertical gap, when that gap exceeds one key unit.

**Mirroring is an involution.** The permutation is a product of transpositions
and fixed points, so applying it twice is the identity — that is the undo, and
it holds for every combination of `MirrorOptions`. Two things keep it true:
positions held back by the options are closed under the pairing (pinning one
end alone would make both ends source from the same key and drop the other),
and the held-back set is computed from actions, which the transform preserves.

**`MirrorOptions` is the design, not the coordinate maths.** `keepLayerKeys`,
`keepThumbs` and `keepModifiers` all default to true, because a mirror layer
exists so one hand can type the whole board: the way out of the layer, the
modifiers and the space bar must stay under the hand still on it. Mod-taps are
deliberately outside `keepModifiers` — their tap half is a character.

**Combos are not mirrored.** A combo is a chord of physical positions, and the
two that reach the Mirror layer are a matched pair, one under each hand;
reflecting them would swap the pair for itself. `mirrorLayerInto` and
`appendMirroredLayer` therefore return `{...layout, layers}` and leave
`combos` identical.

Note that this is a *positional* transform, and so is not the same problem as
`layers.ts`: `swapLayers` relabels what keys **point at** and leaves them
where they are; mirroring moves keys **between positions** and leaves what they
do untouched.

## Errors (`src-tauri/src/error.rs`)

One `AppError` enum, serialized `{code, message, hint}` (`hint` nullable):
`OryxUnreachable, PermutationMismatch, CodegenUnsupportedKey, BuildFailed,
DfuNotFound, DfuAccessDenied, DfuVerifyFailed` (per plan) + `InvalidLayout`
(foundation addition — load/save/config validation failures need a code) +
`KeyReportUnavailable` (the raw-HID channel could not be opened; since live
view has no browser-events fallback, this has to be sayable).

## Shared data (`shared/`)

### The golden pair and the shipped default are two different things

`shared/fixtures/*` is **test material**. It exists to prove that the seeder
and the code generator reproduce real, third-party Oryx output byte for byte,
and that proof is only worth something while the reference files are output we
did not write. `shared/default_layout.json` is **the product**: what a fresh
install materializes, and the material the tutorial teaches from.

They started as the same bytes and are now allowed to diverge. Nothing may be
added to the fixture that Oryx itself cannot emit — `osMacro` and `osMode` are
the standing examples, and `the_golden_fixture_stays_free_of_kinds_oryx_cannot_emit`
fails the build if one appears there. Demo content goes in the default layout,
whose generated sources are checked for internal consistency
(`the_shipped_demo_layout_generates_consistent_sources`) but deliberately not
for parity: there is no Oryx rendering of it to compare against.

- **`fixtures/reference_{keymap.c,rules.mk,config.h}`** — copies of the real
  `arrows_together` sources (today's flashed firmware). Golden spec: Worker
  A's codegen must reproduce `reference_keymap.c` byte-identically modulo
  whitespace (QK_LOCK included). Never edit; re-copy from qmk_firmware only.
- **`fixtures/oryx_rddD7_QzpBEp.json`** — live Oryx GraphQL snapshot
  (7 layers × 72 keys + 2 combos, fetched 2026-07-17). Seeder unit tests run
  against this, offline.
- **`fixtures/seeded_layout.json`** — expected seeder output for that
  snapshot, all 7 layers, regenerated by Worker A (`seeded_layout_fixture_up_to_date`
  keeps it honest). Glow positions were cross-checked through the permutation
  table. Frozen in the sense above: additive features do not belong here.
- **`default_layout.json`** — the shipped default layout, and the only thing
  `store::ensure_initialized` writes on a fresh install (`store::DEFAULT_LAYOUT`,
  materialized as `arrows-together`). Same `LayoutFile` schema, same seven
  Oryx-seeded layers, plus an eighth layer titled **Demo** carrying one live,
  labelled example of every advanced key kind — macro, osMacro, osMode, tap
  dance, dual-function, mod-tap, layer-tap, all four of MO/TG/TO/TT, Key Lock,
  RGB and HSV keys, per-key glows — and two combos beyond Oryx's mirror pair.
  The tutorial derives its steps from what it can find in a layout, so
  `the_demo_layout_has_a_live_example_of_every_advanced_kind` pins the list;
  `the_demo_layer_is_reachable_from_the_base_layer` pins that the Demo layer
  can be entered (an Escape+Delete combo) and left (`TO(0)`, right thumb).
  The **Mirror** layer (5) is reachable by the two Oryx combos *and* by `TG(5)`
  on keys 34/35 — a mirror-image pair, so one per hand — of the **Media** layer
  (the way in; every position on the base layer is taken) and of the Mirror
  layer itself (the way out). `the shipped layout's Mirror toggle` in
  `src/lib/mirror.test.ts` pins both, and pins that the combos survive.
  Combo triggers are compared by keycode rather than by position in QMK, so a
  combo here must be a chord nobody types by accident — which is why Caps Word
  sits on `-`+`'` and not on the more obvious Shift+Tab.
- **`keycodes.json`** — 218 entries `{qmk, aliases, label, longLabel,
  category, tappable, modsApplicable}`; single source of truth for UI labels
  ↔ QMK codes; Rust validates emitted codes against it (Worker A). Covers
  every keycode in `reference_keymap.c`. Worker C owns/expands it post-fork.
- **`moonlander_geometry.json`** — 72 keys (x/y/w/h/r/rx/ry, matrix, led) in
  LAYOUT-arg order, generated by `scripts/extract-geometry.mjs` from QMK's
  `revb/keyboard.json`. Regenerate, don't hand-edit. It is the source of truth
  for two derivations, not one: matrix cell → LAYOUT index
  (`geometry.ts:positionForMatrix`) and **key → its mirror-image key**
  (`mirror.ts:MIRROR_MAP`) — see *Mirroring a layer* below.
- **`rgb_effects.json`** — 50 entries `{qmk, label, blurb, reactive,
  framebuffer, hue, speed, alwaysCompiled}` in QMK's own enum order
  (`rgb_matrix_effects.inc`), i.e. the order `RGB_MOD` cycles through. Read out
  of `quantum/rgb_matrix/animations/*.h`; `settings.lighting` names entries from
  here and `validate()` rejects anything else. `hue`/`speed` are per-effect
  because they really are: `SOLID_REACTIVE*` assigns `hsv.h` from the timer and
  discards the configured hue, `TYPING_HEATMAP` and `DIGITAL_RAIN` read neither,
  and the panel greys out a slider that would do nothing rather than showing one
  that lies. To re-derive after a QMK bump, grep the animation headers for
  `RGB_MATRIX_EFFECT(` (the set), `RGB_MATRIX_KEYREACTIVE_ENABLED` /
  `RGB_MATRIX_FRAMEBUFFER_EFFECTS` (the gates), and a bare `hsv.h =` assignment
  with no `hsv.h` on the right (hue discarded).
- **`layout.schema.json`** — JSON Schema generated from schema.rs.

## Build/infra notes

- A fresh git worktree otherwise recompiles every dependency, so one shared
  build cache across the repo and its worktrees is worth several minutes each.
  Where that cache lives is machine-local, so it is set with the
  `CARGO_TARGET_DIR` environment variable rather than an absolute
  `build.target-dir` in `.cargo/config.toml` — which now only documents it.
  (The shared cache started as a OneDrive workaround; the repo moved to a
  local disk on 2026-07-30 and it was kept deliberately.) `node_modules` is
  gitignored as usual.
- The firmware build runs `make SKIP_VERSION=yes <target>` and codegen writes
  keymap sources only when their content actually changed. Both are build-time
  measures, not correctness ones: on this machine a full rebuild is ~240s, and
  a keymap.c-only change with SKIP_VERSION is ~33s. QMK's recursive submake
  ignores `-j`, so parallelism is not available.
- `make` is **skipped entirely** when nothing changed. `build/stamp.rs` records
  `%APPDATA%\qmk-flasher\builds\last-build.json` after each successful build —
  SHA-256 of the four generated sources, the QMK keyboard target, the keymap
  name and the `.bin` — and `build_firmware` reuses that `.bin` when the stamp
  matches and the file is still there (measured: 25.5s → 3.4ms). The stamp is
  blind to the `qmk_firmware` checkout itself, so a QMK update or an edit under
  the keyboard's own directory will not be noticed; `QMK_FLASHER_FORCE_REBUILD=1`
  (or deleting the stamp file) forces a build. `build_firmware`'s frozen
  `() -> String` signature is unchanged. A reuse is always announced on
  `build-log`, so "built" and "reused" are distinguishable in the UI.
- The `arrows_together` keymap dir in qmk_firmware is never written to — it
  is the known-good recovery reference. Codegen emits into
  `keymaps/qmk_flasher/` (see `AppConfig.keymapName`; `arrows_together` is
  rejected as a target).
- Toolchain on the development machine: rustup stable-msvc 1.97.1, VS Build
  Tools 2022, Node 22, QMK MSYS at `C:\QMK_MSYS`, qmk_firmware under the user
  profile. Both paths are settings (`AppConfig.msysPath`,
  `AppConfig.qmkFirmwarePath`); the qmk_firmware default is
  `%USERPROFILE%\qmk_firmware`, where `qmk setup` clones. `scripts/extract-geometry.mjs`
  has no default at all — pass the `keyboard.json` path, or set `QMK_FIRMWARE`.

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

### AULA F75 (added 2026-08-27, additive — Phase 1, read-only)

The F75 is **not** in `shared/keyboards.json`, and that is deliberate. The
keyboard registry means "a board the QMK codegen/build/flash pipeline can
target"; the F75 cannot run QMK at all (proprietary firmware on an 8051-class
vendor MCU, no upstream port, no DFU bootloader — see
`docs/research/aula-f75-feasibility.md`). A registry entry would require
inventing a `qmkKeyboard`, a `layoutMacro` and a geometry file for a board that
has none, so it is a **sibling feature** instead, sharing only the key-grid
math (`keyRect` / `viewBoxOf` / `U` in `src/lib/geometry.ts`).

It deliberately does not reuse `LayoutFile` or `Key.tsx` either: the F75 has
two layers (base + FN1) and a slot holds one HID page + usage — no tap/hold,
tap dance, combos, macros or Key Lock. Rendering it through the Moonlander's
model would imply capabilities the hardware does not have.

**Geometry is loaded at runtime, not compiled in.** The Moonlander's geometry
comes from QMK's own `keyboard.json`, which is GPL like this repo;
the F75's comes from AULA's proprietary Windows installer, so whether its
derived data may ship here is an open licensing question. Until that is
decided, `scripts/extract-f75-geometry.mjs` turns a user's own
`app/Dev/kb/<variant>/KB.ini` into `%APPDATA%\qmk-flasher\f75_geometry.json`,
and `f75::geometry::load()` reads it from there. **Missing is a normal state,
not an error** (`F75GeometryState = {state: "missing", path} | {state:
"loaded", geometry}`), and the UI explains how to generate it. Mirrors:
`src-tauri/src/f75/geometry.rs` (serde) + `types.ts` (zod). Command:
`get_f75_geometry`.

**The extractor derives, it does not assume.** The OEM rectangles are
`left,top,right,bottom` (the vendor's own provenance note calls them
`x,y,w,h`; that label is wrong) and are *inset* inside their grid cell, so a
key's width is `(drawn + inset) / pitch`. Pitch and inset are measured from the
file, then fitted to the quarter-unit grid keycaps are made on, because the
integer-pixel estimate accumulates error across the board. An **overlap check
rejects the output outright** if any two derived keycaps intersect.

**KB.ini's packed outputs keep their raw value.** `0xCC00UUUU`'s high byte is
AULA's own category (0x07 keyboard, 0x02 consumer, 0x08 vendor, 0x00
unclassified). That is *not* the keybind blob's page byte — the blob uses 0x00
for HID page 0x07 and 0x02 for HID page 0x0C, so the two agree on one value and
disagree on another, and two categories have no blob equivalent at all. No page
byte is synthesised; `packed` is the authority.

**Nothing here touches a USB device.** Phase 1 is geometry and a read-only
view. Note for the phase after it: the documented way to *read* the board's
config is a **SET-then-GET** — a request feature report is sent before the
response is read — so even reading the F75 puts bytes on the wire and is gated
behind the same sign-off as a write.
