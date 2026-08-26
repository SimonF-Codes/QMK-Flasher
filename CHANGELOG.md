# Changelog

## Unreleased

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
