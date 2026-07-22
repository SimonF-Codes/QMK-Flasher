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

interface DisplayState {
  mode: DisplayMode;
  setMode(mode: DisplayMode): void;
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
}));
