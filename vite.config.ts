/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  test: {
    // Tests always run against the mock IPC layer.
    env: { VITE_MOCK: "1" },
    // Worker worktrees live under .claude-worktrees/ INSIDE the repo, each a
    // full checkout of some branch. Without this, `vitest run` collects every
     // one of them: 330 files and 5814 tests instead of this checkout’s 33,
    // so the number says nothing about the branch you are on and a stale
    // worktree can fail a suite that is actually green.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude-worktrees/**"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
