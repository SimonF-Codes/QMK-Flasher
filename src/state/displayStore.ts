/**
 * Global keycap display-mode preference (Advanced / Mac / Windows).
 *
 * This is an app-wide UI preference, NOT part of any layout: it changes only
 * how keycaps are labeled, never the stored layout or emitted codes, so it
 * lives outside layoutStore and never touches dirty state. Persisted to
 * localStorage so it survives reloads; defaults to "advanced".
 */
import { create } from "zustand";
import { DISPLAY_MODES, type DisplayMode } from "../lib/display";

const STORAGE_KEY = "qmk-flasher.displayMode";
const SWAP_KEY = "qmk-flasher.osSwapPreview";

function loadMode(): DisplayMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (DISPLAY_MODES as readonly string[]).includes(v)) {
      return v as DisplayMode;
    }
  } catch {
    /* localStorage unavailable (SSR / tests) — fall through to default */
  }
  return "advanced";
}

function loadSwap(): boolean {
  try {
    return localStorage.getItem(SWAP_KEY) === "1";
  } catch {
    /* localStorage unavailable (SSR / tests) — fall through to default */
  }
  return false;
}

interface DisplayState {
  mode: DisplayMode;
  setMode(mode: DisplayMode): void;
  /**
   * Preview the board with Ctrl↔Cmd swapped. Distinct from `mode`: `mode` is
   * vocabulary (what a key is *called*), this is behavior (what it *emits*).
   * Also display-only — it never touches the layout or dirty state; the real
   * swap happens on the board via a CG_* key. See lib/osSwap.ts.
   */
  osSwapPreview: boolean;
  setOsSwapPreview(on: boolean): void;
}

export const useDisplayStore = create<DisplayState>()((set) => ({
  mode: loadMode(),
  setMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore persistence failures */
    }
    set({ mode });
  },
  osSwapPreview: loadSwap(),
  setOsSwapPreview(on) {
    try {
      localStorage.setItem(SWAP_KEY, on ? "1" : "0");
    } catch {
      /* ignore persistence failures */
    }
    set({ osSwapPreview: on });
  },
}));
