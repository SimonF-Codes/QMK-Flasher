/**
 * Preset library for `osMacro` keys — the window/desktop management shortcuts
 * that differ between macOS and Windows badly enough that one keycode cannot
 * serve both.
 *
 * Why these are literal per-OS step lists and not a mod substitution: the
 * board's Ctrl↔Cmd swap only relabels lone Ctrl/GUI modifiers, and it does not
 * touch macros at all — they compile to `register_code16()` inside
 * `process_record_user`, which bypasses `mod_config()` (see `osSwap.ts`). Even
 * if it did, "next virtual desktop" is `Gui+Ctrl+→` on Windows and `Ctrl+→` on
 * macOS: a different NUMBER of modifiers, which no substitution can produce.
 * So every step below is written exactly as the host OS wants to receive it —
 * `MOD_LGUI` means the physical Cmd/Win modifier on both halves.
 *
 * The steps carry no `delay`: each is a single chord, so there is nothing to
 * space out. (Multi-step lists made by hand in the macro editor default to
 * Oryx's 100 ms — see `macros.ts`.)
 *
 * Sources checked against the OS vendors' own shortcut documentation, and the
 * two third-party Mac window managers named in `snap`'s description; where
 * an OS simply has no equivalent, the description says so rather than the
 * preset quietly shipping an approximation.
 */
import type { MacroStep } from "./types";

export interface NavPresetGroup {
  id: string;
  title: string;
  /** Shown once above the group's presets. */
  description: string;
}

export interface NavPreset {
  id: string;
  groupId: string;
  /** Becomes the osMacro's label, i.e. the keycap text. Keep it short. */
  label: string;
  /** Per-preset caveats — read this before trusting a shortcut. */
  description: string;
  mac: MacroStep[];
  windows: MacroStep[];
}

export const NAV_PRESET_GROUPS: NavPresetGroup[] = [
  {
    id: "desktops",
    title: "Virtual desktops",
    description:
      "Both systems have this natively, with different modifiers — the case osMacro exists for.",
  },
  {
    id: "snap",
    title: "Window snap / tile",
    description:
      "Windows snaps natively. macOS does NOT: the Mac halves below are the defaults of Rectangle and Magnet, so these keys do nothing on a Mac without one of those installed.",
  },
  {
    id: "switching",
    title: "App + window switching",
    description:
      "A macro taps the chord and releases it, so these step one app/window rather than holding the switcher open to scroll through it.",
  },
  {
    id: "capture",
    title: "Screenshot + lock",
    description:
      "The group that makes the case for this feature: Simon's Screenshot macro is the Mac chord, so it does nothing useful on Windows today.",
  },
];

/** `MOD_LGUI` is the physical Cmd (Mac) / Win (Windows) key on both halves. */
const GUI = "MOD_LGUI";
const CTRL = "MOD_LCTL";
const ALT = "MOD_LALT";
const SHIFT = "MOD_LSFT";

const chord = (code: string, ...mods: string[]): MacroStep =>
  mods.length ? { code, mods } : { code };

export const NAV_PRESETS: NavPreset[] = [
  // ---- Virtual desktops ----
  {
    id: "desktop-next",
    groupId: "desktops",
    label: "Desk →",
    description:
      "Next virtual desktop. Windows: Win+Ctrl+→. macOS: Ctrl+→ (Move right a space).",
    mac: [chord("KC_RIGHT", CTRL)],
    windows: [chord("KC_RIGHT", GUI, CTRL)],
  },
  {
    id: "desktop-prev",
    groupId: "desktops",
    label: "Desk ←",
    description:
      "Previous virtual desktop. Windows: Win+Ctrl+←. macOS: Ctrl+← (Move left a space).",
    mac: [chord("KC_LEFT", CTRL)],
    windows: [chord("KC_LEFT", GUI, CTRL)],
  },
  {
    id: "desktop-overview",
    groupId: "desktops",
    label: "Desks",
    description:
      "Show every desktop at once. Windows: Win+Tab (Task View). macOS: Ctrl+↑ (Mission Control).",
    mac: [chord("KC_UP", CTRL)],
    windows: [chord("KC_TAB", GUI)],
  },

  // ---- Window snap / tile ----
  {
    id: "snap-left",
    groupId: "snap",
    label: "Snap ←",
    description:
      "Windows: Win+← snaps the window to the left half. macOS has no native equivalent — Ctrl+Opt+← is the Rectangle/Magnet default and needs one of them running.",
    mac: [chord("KC_LEFT", CTRL, ALT)],
    windows: [chord("KC_LEFT", GUI)],
  },
  {
    id: "snap-right",
    groupId: "snap",
    label: "Snap →",
    description:
      "Windows: Win+→ snaps the window to the right half. macOS has no native equivalent — Ctrl+Opt+→ is the Rectangle/Magnet default and needs one of them running.",
    mac: [chord("KC_RIGHT", CTRL, ALT)],
    windows: [chord("KC_RIGHT", GUI)],
  },
  {
    id: "snap-max",
    groupId: "snap",
    label: "Snap ↑",
    description:
      "Windows: Win+↑ maximizes. macOS has no native equivalent — Ctrl+Opt+Return is the Rectangle/Magnet 'maximize' default and needs one of them running. (Native Mac full-screen is Ctrl+Cmd+F, which is a different thing: it hides the menu bar and makes its own space.)",
    mac: [chord("KC_ENTER", CTRL, ALT)],
    windows: [chord("KC_UP", GUI)],
  },

  // ---- App + window switching ----
  {
    id: "app-next",
    groupId: "switching",
    label: "App →",
    description:
      "Switch to the previously used app. Windows: Alt+Tab. macOS: Cmd+Tab.",
    mac: [chord("KC_TAB", GUI)],
    windows: [chord("KC_TAB", ALT)],
  },
  {
    id: "app-prev",
    groupId: "switching",
    label: "App ←",
    description:
      "Step the switcher backwards. Windows: Alt+Shift+Tab. macOS: Cmd+Shift+Tab.",
    mac: [chord("KC_TAB", GUI, SHIFT)],
    windows: [chord("KC_TAB", ALT, SHIFT)],
  },
  {
    id: "window-cycle",
    groupId: "switching",
    label: "Win →",
    description:
      "macOS: Cmd+` cycles the windows of the front app. Windows has no same-app cycler — Alt+Esc is the closest thing and steps through ALL windows in the order they were opened, so the two halves are not exactly equivalent.",
    mac: [chord("KC_GRAVE", GUI)],
    windows: [chord("KC_ESCAPE", ALT)],
  },

  // ---- Screenshot + lock ----
  {
    id: "shot-region",
    groupId: "capture",
    label: "Snip",
    description:
      "Screenshot a selected region. Windows: Win+Shift+S (Snipping Tool overlay). macOS: Cmd+Shift+4.",
    mac: [chord("KC_4", GUI, SHIFT)],
    windows: [chord("KC_S", GUI, SHIFT)],
  },
  {
    id: "shot-screen",
    groupId: "capture",
    label: "Shot",
    description:
      "Screenshot the whole screen. Windows: PrintScreen (to the clipboard). macOS: Cmd+Shift+3 (to a file on the desktop).",
    mac: [chord("KC_3", GUI, SHIFT)],
    windows: [chord("KC_PRINT_SCREEN")],
  },
  {
    id: "lock",
    groupId: "capture",
    label: "Lock",
    description:
      "Lock the screen. Windows: Win+L. macOS: Ctrl+Cmd+Q.",
    mac: [chord("KC_Q", CTRL, GUI)],
    windows: [chord("KC_L", GUI)],
  },
];

export function presetsInGroup(groupId: string): NavPreset[] {
  return NAV_PRESETS.filter((p) => p.groupId === groupId);
}

/**
 * A preset's step lists, copied. Applying a preset must not hand the editor
 * the shared table's own arrays — the next edit would mutate every key that
 * had ever used the preset.
 */
export function presetSteps(preset: NavPreset): {
  mac: MacroStep[];
  windows: MacroStep[];
} {
  return {
    mac: preset.mac.map((s) => ({ ...s })),
    windows: preset.windows.map((s) => ({ ...s })),
  };
}
