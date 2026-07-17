# QMK-Flasher

Tauri v2 desktop app for editing and flashing QMK keymaps.

- Frontend: React 19 + TypeScript + Vite (placeholder UI for now)
- Backend: Rust (Tauri v2), stubbed commands returning fixture data
- Shared contract between workers: [`docs/CONTRACT.md`](docs/CONTRACT.md)

## Development

```sh
npm install
npm run tauri dev   # run the app
npm test            # vitest (TS schema tests)
cd src-tauri && cargo test   # Rust schema/stub tests
```

Requires Node 22+, Rust (MSVC toolchain on Windows), and the platform
prerequisites from https://tauri.app/start/prerequisites/.
