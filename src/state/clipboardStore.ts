/**
 * Key clipboard (zustand): one copied KeyAction, pasteable onto any key.
 *
 * Like displayStore and liveStore this is app-wide UI state and NOT part of any
 * layout — the clipboard is never written to the layout file, and copying never
 * touches dirty tracking. Only the paste edits the layout, and it does so
 * through layoutStore.setKeyAction like every other key edit.
 *
 * It lives outside layoutStore on purpose. Every layer-level action there
 * (selectLayer, addLayer, deleteLayer, swapLayers) clears selectedKey and
 * swapSource, and the whole point of this feature is copying on one layer and
 * pasting on another — keeping the clipboard in its own store makes surviving a
 * layer switch structural instead of something to remember at each call site.
 *
 * In-memory only, like liveStore's press state: a clipboard that outlived a
 * restart would offer to paste an action from a layout you may no longer have
 * open.
 *
 * It reads layoutStore (and calls setKeyAction) so copy/paste is one testable
 * action rather than logic duplicated between the KeyPicker buttons and the
 * Ctrl+C / Ctrl+V shortcuts. layoutStore does not import this store back, so
 * there is no cycle.
 */
import { create } from "zustand";
import { withGlow } from "../lib/labels";
import type { KeyAction } from "../lib/types";
import { useLayoutStore } from "./layoutStore";

/**
 * Drop the glow before it goes on the clipboard: a glow is per-position LED
 * decoration, not part of what the key does, so carrying the source key's color
 * across the board would be a surprise edit nobody asked for. Paste then feeds
 * the glowless action to `withGlow(next, prev)`, which restores the
 * DESTINATION's glow — the position keeps looking like itself and only its
 * behavior changes.
 */
function withoutGlow(a: KeyAction): KeyAction {
  if (!a.glow) return a;
  const { glow: _glow, ...rest } = a;
  return rest;
}

interface ClipboardState {
  /** The copied action, glow stripped, or null when nothing is copied yet. */
  action: KeyAction | null;
  /**
   * Copy the selected key's action. Returns false (and copies nothing) when
   * there is no selection, so callers can tell whether they acted.
   */
  copySelectedKey(): boolean;
  /**
   * Replace the selected key's action with the clipboard's, keeping the
   * destination's glow. Returns false when the clipboard is empty or nothing
   * is selected.
   */
  pasteToSelectedKey(): boolean;
  /** Forget the copied action. */
  clear(): void;
}

export const useClipboardStore = create<ClipboardState>()((set, get) => ({
  action: null,

  copySelectedKey() {
    const { layout, selectedLayer, selectedKey } = useLayoutStore.getState();
    if (!layout || selectedKey === null) return false;
    const action = layout.layers[selectedLayer]?.keys[selectedKey];
    if (!action) return false;
    set({ action: withoutGlow(action) });
    return true;
  },

  pasteToSelectedKey() {
    const copied = get().action;
    if (!copied) return false;
    const { layout, selectedLayer, selectedKey, setKeyAction } =
      useLayoutStore.getState();
    if (!layout || selectedKey === null) return false;
    const current = layout.layers[selectedLayer]?.keys[selectedKey];
    if (!current) return false;
    // Through setKeyAction, not a hand-rolled layer edit: it is what keeps
    // settings.tapDance in sync with actual content, and pasting a tap-dance
    // key (or pasting over the last one) changes that content.
    setKeyAction(withGlow(copied, current));
    return true;
  },

  clear() {
    set({ action: null });
  },
}));
