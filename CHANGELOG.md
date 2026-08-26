# Changelog

## Unreleased

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
  has therefore never reached the board. The line is still emitted verbatim,
  because it is part of the byte-for-byte parity with real Oryx output that the
  golden fixture exists to prove, and `config_h.rs` now says so where it is
  written. `lighting.speed` is the knob that works.
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
