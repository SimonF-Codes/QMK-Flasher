# Changelog

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
