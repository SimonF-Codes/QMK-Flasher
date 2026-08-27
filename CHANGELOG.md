# Changelog

## Unreleased

### Lighting that reacts *and* keeps your colours

The last release gave the board QMK's key-reactive effects. Flashed, they did
exactly what QMK's source says they do and not at all what was asked for: the
board went reactive and every key went white, with the per-layer colours gone.
That is not a bug in the firmware — `effect_runner_reactive`
(`quantum/rgb_matrix/animations/runners/effect_runner_reactive.h`) renders
**every LED from the single global `rgb_matrix_config.hsv`**. All twelve
reactive effects go through it. None of them can ever show more than one colour,
so none of them could ever have been the feature.

**"Colours + tap"** (`lighting.mode: "reactive"`, schema **v5**) is the mode
that was actually asked for. The ledmap is emitted exactly as it is in static
mode and keeps every colour; one generated function, `qf_reactive_value()`,
scales each LED's `v` by how recently that LED was struck, read from QMK's
`g_last_hit_tracker`. `h` and `s` are never touched. The board still looks like
your layout; typing makes it respond.

**A tap goes up to your colour, not past it** — and that shapes the knob. The
brightest an LED can be is already its ledmap value scaled by the board's master
brightness, which the firmware clamps to the vendor's ceiling. So **Tap boost**
is how far an untouched key sits *below* its colour, and a hit restores it to
full over **Fade** milliseconds (50–5000, checked where the layout is loaded
because it is a divisor in the generated C). At 100% boost, unstruck keys are
dark and only what you type is lit.

**The board remembers eight hits.** `LED_HITS_TO_REMEMBER` is 8, so a ninth key
struck inside the fade window pushes the oldest out of QMK's buffer and that key
drops back to rest instead of finishing its fade. The panel says so. The colours
are never affected by it — they do not come from the tracker.

`RGB_MATRIX_KEYPRESSES` is now derived from the **mode** as well as the effect
set: `g_last_hit_tracker` is declared only under `RGB_MATRIX_KEYREACTIVE_ENABLED`,
so reactive mode needs the define even with nothing but static effects compiled
in. The generated `keymap.c` carries an `#error` in case the two ever disagree.

### The app's lighting settings now actually reach the board

Independent of the above, and the other half of why the flash came out white:
**every lighting setting in this app was inert on any board that had been used
before.** `rgb_matrix_init()` applies `RGB_MATRIX_DEFAULT_MODE/HUE/SAT/VAL/SPD`
only when EEPROM holds no mode at all —

```c
eeconfig_init_rgb_matrix();
if (!rgb_matrix_config.mode) {          // ONLY on a blank EEPROM
    eeconfig_update_rgb_matrix_default();
}
```

— so a board with a stored mode kept whatever hue, saturation and brightness it
was last left on and ignored the panel entirely. Worse: `#undef`-ing effects
shrinks the effect enum, so a *stored mode index* resolves to a different effect
after every flash. That is the whole explanation for "white, in a mode I did not
choose". It also silently pinned the ledmap's master brightness, since
`hsv_to_rgb_with_value()` reads `rgb_matrix_config.hsv.v` live rather than the
define.

**Apply these on every boot** (on by default) makes the firmware authoritative:
the generated `keyboard_post_init_user()` restates mode, hue, saturation,
brightness and speed with QMK's `_noeeprom` setters, after `rgb_matrix_enable()`
— which has to come first, because `rgb_matrix_sethsv_eeprom_helper` returns
having done nothing while the matrix is disabled.

**The trade-off is a checkbox, not a silent default.** With this on, a mode you
cycle to with an `RGB_MOD` key does not survive a replug. That is the right
behaviour for an app that owns the layout, and it is said where it is chosen.
`QK_CLEAR_EEPROM` (`EE_CLR`) joins the keycode catalog and the shipped demo
layout — it is the escape hatch for exactly this class of problem, and it costs
one key.

**What a user has to do to see this:** a fresh flash is enough. No EEPROM clear
is needed, on an existing board or a new one — that is the entire point of
applying the settings at boot rather than at EEPROM-init.

### `RGB_MATRIX_STARTUP_SPD` is gone, not documented

The app emitted `#define RGB_MATRIX_STARTUP_SPD` from `settings.rgbStartupSpeed`
because Oryx does, and the last release recorded that the macro does not exist
in `qmk_firmware` — the name is `RGB_MATRIX_DEFAULT_SPD` — and kept emitting it
anyway, for byte-parity with real Oryx output. A comment explaining that a knob
does nothing is not as good as the knob not being there. Both the define and the
setting are removed. Nothing ever read it, so this is the one change to the
generated firmware that is provably invisible to the board; a *rename* would not
have been, which is why it is a removal.
`shared/fixtures/reference_config.h` loses the same line and is now real Oryx
output minus exactly that one dead define.

**Sizes, measured.** Two real MSYS builds of `zsa/moonlander/revb`, the shipped
demo layout in each:

| Build | Bytes | vs. baseline |
|---|---|---|
| Before this change (demo layout in ledmap mode) | 61,924 | — |
| **The demo layout as it now ships** (reactive mode, settings applied at boot) | **62,072** | **+148** |

148 bytes buys the reactive modulation and the boot-time re-apply together.
`RGB_MATRIX_KEYPRESSES` was already on in the baseline — the demo layout has
compiled in a reactive effect since the last release — so this measures the new
code alone and not the tracking it needs.

**Schema v5**: `lighting` gains `reactiveBoost`, `reactiveFadeMs` and
`applyOnBoot`; `settings.rgbStartupSpeed` is removed. `migrate()` gained a v4→v5
arm. Layouts already on disk open unchanged, and one that configured lighting
gains `applyOnBoot: true` — which is the point of the version, since its stored
settings were the ones EEPROM was overruling.

### The demo Screenshot key works on both machines

The shipped layout’s `Screenshot` key was a plain macro sending `Ctrl+Shift+5`.
Macros bypass the Ctrl↔Cmd swap entirely — they go out through
`register_code16()`, which never reaches `mod_config()` — so it sent literal
`Ctrl+Shift+5` on both machines: not the Mac screenshot shortcut, and nothing
standard on Windows. It was the Tool Guide’s only OS warning.

It is now an OS macro built from the `shot-region` preset — `Cmd+Shift+4` on
Mac, `Win+Shift+S` on Windows — and the guide reclassifies it from
"bypassed — check this one" to OS-aware.

### Mirror a layer, and a key that reaches it

The Mirror layer — the one-handed layer whose left half carries the right
half's letters — was typed out by hand, and a hand-maintained mirror drifts
out of step with its base layer the first time the base layer changes. It is a
*derived* artifact, and there is no way to keep a derived artifact honest by
editing it.

**"Mirror layer"** in the layer bar generates one. Pick a source layer, pick a
destination (an existing layer, or a new one), and every key is reflected to
its counterpart on the other half of the board. The pairing comes out of
`shared/moonlander_geometry.json`: each key's centre is reflected about the
middle of the board's bounding box and matched to the nearest key. Nothing is
hardcoded, so the pairing cannot disagree with the geometry, and it is checked
against the coordinates rather than against a table.

**Three things deliberately do not swap sides**, and they are the actual design
of the feature. A mirror layer exists so that ONE hand can type the whole
board, which means everything you need in order to keep working has to stay
under the hand still on it:

- **Layer keys** (MO/TG/TO/TT/LT) — mirroring the key that turns Mirror off
  sends the way out to the hand holding the mouse.
- **Thumb clusters** — a thumb cluster is not the other one reflected, it is
  the same three keys under the same thumb, and the working hand keeps its
  space bar.
- **Bare modifiers** — Shift/Ctrl/Alt/GUI are held while another key is
  struck, so one hand needs both. Mod-taps still cross over: their tap half is
  a character, and characters are the point.

All three are on by default and each is a checkbox that explains itself.
Mirroring is its own inverse — run it twice and you are back where you started,
whatever the checkboxes say — because held-back positions are closed under the
pairing, which keeps the transform a permutation instead of a shredder.

**A Mirror key on the board.** Reaching the Mirror layer used to require one of
two chords and *leaving* it required forming a chord one-handed while mirrored.
The shipped demo layout now carries `TG(5)` on keys 34 and 35 — reflections of
each other, so one under each hand — on the **Media** layer, whose inner column
is already the board's complete layer-navigation column, and on the **Mirror**
layer itself, which turns it into a real toggle you can leave with one key.
Both combos still work.

It is on the **base layer** too, at key 34, which used to hold a
Backspace/Calculator tap dance. Backspace survives on the thumb; what goes is
the double-tap to Calculator. That position is `transparent` on most other
layers, so they inherit the toggle by fall-through and it becomes the Mirror
key nearly everywhere — and because the base layer carries it, regenerating
the Mirror layer from the base layer now brings the way out along with it
rather than wiping it.

### AULA F75: geometry and a read-only view

Simon asked for the F75 as a second board. It cannot be one: it runs
proprietary firmware on an 8051-class vendor MCU, has no QMK port, and its
bootloader does not speak DFU, so the codegen/build/flash pipeline has nothing
to target (`docs/research/aula-f75-feasibility.md`). What it *can* be is a
separate vendor-HID feature, and this is its first phase: **geometry and a
read-only view. No byte is sent to any device.**

`scripts/extract-f75-geometry.mjs` turns the OEM configurator's `KB.ini` into
our own geometry JSON. Nothing in it is invented — positions, sizes, matrix
indices and labels all come out of the file. The only derived quantity is the
pixel-to-key-unit scale, and it is *measured*: the vendor draws each key inset
inside its cell, so reading the rectangle directly makes the spacebar 5.79u
instead of 6.25u. Rows are clustered before the pitch is taken (the file
jitters row tops by a pixel), and the integer-pixel estimate is then fitted to
the quarter-unit grid keycaps are actually made on, because the raw estimate
accumulates error until Backspace runs a quarter-unit into Delete. An overlap
check refuses the whole output if two keycaps intersect — a board that cannot
physically exist is not written. Validated against all three real OEM variants.

The F75 is deliberately **not** in the keyboard registry and does not reuse
`LayoutFile`: it has two layers, a slot holds one HID usage with no tap/hold,
tap dance, combos or macros, and F1–F12 are pinned by the firmware where no
tool can remap them. It shares the key-grid math and nothing else — modelling
it as a Moonlander would imply capabilities the hardware lacks.

Its geometry is loaded at runtime rather than compiled in, because it derives
from a proprietary installer and that licensing question is still open. Each
user generates it from their own copy, and not having one is a normal state the
UI explains rather than an error.

### Lighting that reacts and moves

The LEDs have only ever been able to hold still: a colour per layer, a colour
per key, and nothing that answers a keystroke. QMK's RGB Matrix has shipped
forty-odd animations and a dozen key-reactive effects the whole time; the
firmware this app generates simply never asked for any of them. It does now.

`settings.lighting` picks the effects to compile in, which one the board boots
into, and its starting hue, saturation, brightness and speed. **Schema v4**:
the field is optional and absent by default, and absent means *this layout does
not configure RGB Matrix at all* — which is what a layout seeded from Oryx
means, and why one still generates exactly the `config.h` it did before.
`migrate()` gained a v3→v4 arm; layouts already on disk open unchanged.

**One board, two painters, and only one of them can win.** The generated
`rgb_matrix_indicators_user()` runs *after* the active effect has drawn its
frame and repaints every LED from the ledmap, so an effect under the per-layer
colours is not dimmed — it is invisible. That is a real constraint, not a
policy, so it is a choice rather than a silent winner: `ledmap` mode keeps
today's behaviour exactly (the effect is compiled in and a `TOGGLE_LAYER_COLOR`
key reveals it at runtime), and `effect` mode generates no ledmap at all. The
layer colours stay in the layout and come back when the mode does.

**The costs are said out loud, before the build.** Reactive effects live behind
`RGB_MATRIX_KEYPRESSES`, which makes the matrix scan record which key was hit
and when; the two framebuffer effects need a per-LED buffer kept between
frames. Both defines are *derived from the chosen effect set* rather than
stored — the same rule as `TAP_DANCE_ENABLE` and `COMBO_ENABLE`, and for the
same reason — so the panel's warning and the emitted define come from one
derivation and cannot disagree.

**Sizes, measured.** Five real MSYS builds of `zsa/moonlander/revb`, the demo
layout in each:

| Build | Bytes | vs. baseline |
|---|---|---|
| Before this feature (the board's own 48 effects, none reactive) | 73,820 | — |
| Breathing only, ledmap mode | 60,892 | −12,928 |
| Reactive (simple) only, ledmap mode | 61,248 | −12,572 |
| **The demo layout as it now ships** (3 effects, one reactive, ledmap mode) | **62,096** | **−11,724** |
| Same three effects, effect mode (no ledmap generated) | 59,980 | −13,840 |

Turning on tap-reactive lighting makes the firmware ~11.7 KB **smaller**, which
is the opposite of what the feature sounds like it should do. The reason is the
lever that makes reactive effects affordable in the first place: the
Moonlander's own `keyboard.json` enables 48 effects, and QMK `-include`s that
generated header *before* the keymap's `config.h`, so the generated file is the
last word and `#undef` genuinely removes one. Picking an explicit set trims 47
effects out of the image; against that, the reactive machinery costs 356 bytes
(compare the two single-effect rows, which differ only in whether the effect is
reactive). Without the trimming it would not be a bargain: the twelve reactive
effects are all already `ENABLE_`d, so `RGB_MATRIX_KEYPRESSES` compiles in all
twelve at once.

Three things in QMK's source turned out not to match how the feature was
described, and the code follows the source:

- **`RGB_MATRIX_STARTUP_SPD` does not exist.** The app has emitted it since the
  beginning as its one dynamic lighting knob, and it appears nowhere in
  `qmk_firmware` — the name is `RGB_MATRIX_DEFAULT_SPD`. `settings.rgbStartupSpeed`
  has therefore never reached the board. (It was kept for byte-parity with real
  Oryx output at the time; it has since been removed outright — see above.)
  `lighting.speed` is the knob that works.
- **Choosing effects is subtraction, not addition.** Every effect the board can
  run is already compiled in; the interesting act is removing the ones nobody
  asked for.
- **Hue and speed are not universal.** `SOLID_REACTIVE*` assigns its hue from
  the timer and throws the configured one away; `TYPING_HEATMAP` and
  `DIGITAL_RAIN` read neither hue nor speed. `shared/rgb_effects.json` records
  this per effect and the panel disables the sliders that would not move,
  instead of offering controls that quietly do nothing.

The demo layout now carries a live example — a reactive effect compiled in,
booting in ledmap mode so the board still looks like the layout being taught,
with the existing `TOGGLE_LAYER_COLOR` key as the switch that reveals it. The
tutorial gained a step that reads the whole thing back out of whatever layout
is open, including what it is costing.

### A demo layout that shows the whole app

A fresh install now starts on a layout that already uses every advanced
feature, so nothing has to be described in the abstract. An eighth layer,
**Demo**, carries one labelled, working example of each: a macro, twelve
OS-macro navigation presets, all four OS-mode keys, a tap dance, a
dual-function key, a mod-tap, a layer-tap, MO/TG/TO/TT side by side, Key Lock,
Caps Word, RGB and HSV keys, and per-key glows throughout. Two new combos join
Oryx's mirror pair: Escape+Delete toggles the Demo layer, `-`+`'` toggles Caps
Word. `TO(0)` on the right thumb leaves the layer.

The shipped layout is now a **separate asset** from the golden test fixture.
`shared/fixtures/seeded_layout.json` and `reference_keymap.c` exist to prove
that codegen reproduces real Oryx output byte for byte, and Oryx cannot emit OS
macros or OS-mode keys at all — enriching that fixture would have quietly
turned the parity test into a comparison against a file we wrote ourselves.
`shared/default_layout.json` is what installs; the fixture is frozen and its
parity test is unchanged. A test now fails the build if a kind Oryx cannot
produce appears in the fixture.

### Less of one person's machine

- The `qmk_firmware` default is `%USERPROFILE%\qmk_firmware` — where `qmk
  setup` clones — instead of a hard-coded home directory.
- `scripts/extract-geometry.mjs` has no default path: pass the `keyboard.json`,
  or set `QMK_FIRMWARE`. It exits with usage instead of guessing.
- The shared Cargo build cache across worktrees is now opt-in via
  `CARGO_TARGET_DIR`; `.cargo/config.toml` documents it rather than pinning an
  absolute path.

### Multi-key and multi-output keys

Combos and macros have always been *generated* — they arrived from the Oryx
seed and codegen reproduced them faithfully — but nothing in the app could
author one. Both are now first-class.

- **Macro editor** — create, edit and delete a one-key-many-keystrokes macro,
  with an ordered step list (keycode + modifiers + delay), reordering and a
  label. Macros seeded from Oryx open in place and round-trip unchanged.
- **Combo editor** — several keys pressed together produce one action. Build
  the trigger set by clicking the board, pick the layer it listens on and the
  action it fires. At least two distinct keys are required: a one-key combo is
  just a key, and a repeated index cannot fire.
- `COMBO_ENABLE`/`COMBO_COUNT` now derive from the layout's actual combos
  rather than a settings flag, so the two can no longer disagree.

### One key, two operating systems

Windows and macOS screen navigation are different sequences, not a modifier
substitution — Windows moves a virtual desktop with `Gui+Ctrl+Left/Right`,
macOS with `Ctrl+Left/Right`. The existing Ctrl<->Cmd swap cannot express that,
so a key now carries a separate sequence per OS and the board picks one at
press time.

- **OS macros** — one key, a Mac half and a Windows half. Either half may be
  empty, meaning the key does nothing on that OS.
- **12 navigation presets** across four groups — virtual desktops, window
  snap/tile, app and window switching, screenshot and lock — each filling both
  halves in one click. The Mac window-snap preset uses Rectangle/Magnet-style
  shortcuts and says so, since macOS has no native equivalent.
- **OS-mode keys** — `QF_OS_TOGG` / `QF_OS_MAC` / `QF_OS_WIN` / `QF_OS_AUTO`.
  Setting the mode drives both the Ctrl<->Cmd swap and which half of every OS
  macro fires, so there is one source of truth instead of two.
- **Host OS detection** — the board asks the host what it is at USB
  enumeration. Detection is authoritative, a manual OS key overrides it, and
  the override is dropped once detection reports a different OS — i.e. the
  board moved to another machine.
- The older `CG_TOGG`/`CG_SWAP`/`CG_NORM` keys still work; they move the swap
  only. Picking one used to produce a `basic` key the swap preview could not
  see — fixed.

### Tutorial mode

A guided tour of every feature, offered once on a fresh install and reopenable
from the header. Fifteen steps in an order that builds — a plain key, then
layers, tap-holds, macros, combos, the OS-aware keys, and finally Build &
Flash.

Each step points at a **real key in your own layout**, highlighted on the
board, because the steps are derived from the layout rather than hardcoded to
positions. Move a key and the tour follows it onto whatever layer it now lives
on. A feature your layout does not use yet still gets its step and explains
itself, so the tour is the same length every time and "step 7 of 15" means
something.

It shares its derivation with the Tool Guide, so the two cannot drift: the
guide is the reference, the tour is the tour.

### Tool Guide

A reference for every non-obvious key in the layout, **derived from the layout
itself** so it cannot go stale: macros with their full step sequence, combos
with the keys that trigger them, OS macros with both halves, dual-function
keys, tap dances, layer switches, Key Lock, lighting and system keys — each
with the layer and position it lives at.

Every key carrying Ctrl or Gui is classified by how the Ctrl<->Cmd swap
actually treats it, derived from the swap itself rather than declared:
`swapped`, `osAware`, `bypassed` (macros and dual-function keys, which the swap
never reaches), `balanced` (chords carrying both Ctrl and Gui, which QMK's XOR
guard leaves alone), and `control` for the keys that set the mode. A key
carrying a hard-coded chord the swap does not touch is flagged as a warning —
it is a shortcut for one OS only. Printable, for keeping beside the keyboard.

### Schema

Layout schema v3, additive over v2. Layouts written by an earlier build are
migrated on load, so nothing on disk needs touching.

## 0.2.0 — 2026-08-01

### LED tooling

Layer colors and per-key glows are editable in the app for the first time.
They previously arrived from the Oryx seed and were frozen — codegen rendered
them faithfully, but nothing in the UI could change them.

- **Layer base color** — the "LEDs" control in the layer tab bar sets the color
  a layer lights with, by picker or hex. Black is offered as its own "Turn off"
  action, because the firmware reads `h=s=v=0` as *off* rather than as a color.
- **Per-key override** — the key picker gains an LED section: set one key's
  color, or reset it to inherit the layer's base.
- **Tint layer keys by destination** — one click paints every MO/TG/TO/TT/LT key
  with the color of the layer it navigates to, so the board shows where each
  key leads.
- **Clear per-key overrides** — flattens a layer back to a single base color.
- **The board previews the ledmap.** Each key now shows the color the firmware
  will actually light it with: faded where it inherits the layer base, solid
  where it carries an explicit override.
- **Transparent-key warning.** A `transparent` key is lit by the top layer but
  types what a lower layer has there — the one thing the LED map cannot express.
  The key picker now names the layer the behavior really comes from.

### Live key view

Physical key presses highlight on the board and the keycodes the firmware emits
are logged, so a layout can be checked against the hardware without leaving the
app.

### Build speed

A typical layout edit now rebuilds in about **33s instead of ~240s**.

- `make SKIP_VERSION=yes` drops QMK's git-derived version step, which cost ~50s
  of git invocations per build on Windows and only changes the version string
  the firmware reports (binary size unaffected).
- Keymap sources are written only when their contents actually change. make
  keys off mtime, so unconditionally rewriting `config.h` / `rules.mk` was
  invalidating every object in the tree on every build. Most edits touch
  `keymap.c` alone, and `keymap.json` never changes at all.
- `-j` is deliberately absent: QMK's recursive submake ignores it (238s at
  `-j16` vs 239s serial).

### Fixes

- `ledmap.rs` sizes each row by the geometry rather than by the layer, and
  returns `InvalidLayout` instead of panicking on an out-of-range LED index.

## 0.1.0

Initial release: Oryx seeding, layout editing, version history, multi-layout
storage, Mac/Windows OS-mode switch, and the QMK build + DFU flash pipeline.
