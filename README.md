# QMK-Flasher

A Tauri v2 desktop app that replaces the Oryx → patch → build → Keymapp loop
for the ZSA Moonlander: edit your layout visually, then build and flash the
firmware in one click over USB DFU.

- **Visual layout editor** — layers, keycodes, mod-taps, dual-function keys,
  per-key LED colors.
- **Macros and combos** — author them in the app: one key that types a
  sequence, or several keys pressed together that fire one action.
- **OS-aware keys** — one key carrying a separate sequence per host OS, since
  Windows and macOS screen navigation are different shortcuts rather than a
  modifier substitution. The board detects the host at USB enumeration and
  picks a half at press time.
- **Build & flash in-app** — generates `keymap.c`/`rules.mk`/`config.h`, runs
  the real QMK build, and flashes over DFU (`0483:df11` and ZSA `3297:2003`)
  without leaving the window.
- **Tool Guide** — a printable reference for every non-obvious key in your
  layout, derived from the layout itself, including how the Ctrl↔Cmd swap
  actually treats each one.

Stack: React 19 + TypeScript + Vite on the front, Rust (Tauri v2) behind.
The shared contract between the two is [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Development

```sh
npm install
npm run tauri dev   # run the app
npm test            # vitest (TS schema tests)
cd src-tauri && cargo test   # Rust schema/stub tests
```

Requires Node 22+, Rust (MSVC toolchain on Windows), and the platform
prerequisites from https://tauri.app/start/prerequisites/.

## License

GPL-2.0-or-later. Copyright (C) 2026 Simon Fridlyand. See [LICENSE](LICENSE).

This is a tool for [QMK firmware](https://github.com/qmk/qmk_firmware) and
carries material derived from it (Moonlander geometry, keycode names, the
Oryx reference keymap used as a golden test fixture). QMK is GPL-2.0, which
is why this project is too. Full attribution is in [NOTICE](NOTICE).
