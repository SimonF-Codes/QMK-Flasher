/**
 * App-wide layout state (zustand): the loaded layout, selection, edits,
 * dirty tracking (deep compare vs last-saved), and save.
 */
import { create } from "zustand";
import { ipc, toAppError } from "../lib/ipc";
import type { AppError, KeyAction, Layer, LayoutFile } from "../lib/types";

/** True iff any key across all layers is a tap-dance action. */
function layersUseTapDance(layers: Layer[]): boolean {
  return layers.some((layer) => layer.keys.some((k) => k.kind === "tapDance"));
}

interface LayoutState {
  layout: LayoutFile | null;
  /** Serialized form of the last loaded/saved layout, for dirty compare. */
  savedJson: string | null;
  selectedLayer: number;
  selectedKey: number | null;
  loading: boolean;
  saving: boolean;
  error: AppError | null;

  load(): Promise<void>;
  save(): Promise<void>;
  selectLayer(index: number): void;
  selectKey(index: number | null): void;
  setKeyAction(action: KeyAction): void;
  renameLayer(index: number, title: string): void;
  isDirty(): boolean;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  layout: null,
  savedJson: null,
  selectedLayer: 0,
  selectedKey: null,
  loading: false,
  saving: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const layout = await ipc.loadLayout();
      set({
        layout,
        savedJson: JSON.stringify(layout),
        selectedLayer: 0,
        selectedKey: null,
        loading: false,
      });
    } catch (e) {
      set({ error: toAppError(e), loading: false });
    }
  },

  async save() {
    const { layout } = get();
    if (!layout) return;
    set({ saving: true, error: null });
    try {
      await ipc.saveLayout(layout);
      set({ savedJson: JSON.stringify(layout), saving: false });
    } catch (e) {
      set({ error: toAppError(e), saving: false });
    }
  },

  selectLayer(index) {
    set({ selectedLayer: index, selectedKey: null });
  },

  selectKey(index) {
    set({ selectedKey: index });
  },

  setKeyAction(action) {
    const { layout, selectedLayer, selectedKey } = get();
    if (!layout || selectedKey === null) return;
    const layers = layout.layers.map((layer, li) =>
      li === selectedLayer
        ? {
            ...layer,
            keys: layer.keys.map((k, ki) => (ki === selectedKey ? action : k)),
          }
        : layer,
    );
    // Keep settings.tapDance in sync with actual content so removing the last
    // tap-dance key clears the flag (a stale-true flag broke TAP_DANCE_ENABLE
    // codegen). Only touch settings when the derived value actually changes.
    const tapDance = layersUseTapDance(layers);
    const settings =
      tapDance === layout.settings.tapDance
        ? layout.settings
        : { ...layout.settings, tapDance };
    set({ layout: { ...layout, layers, settings } });
  },

  renameLayer(index, title) {
    const { layout } = get();
    if (!layout) return;
    const layers = layout.layers.map((layer, li) =>
      li === index ? { ...layer, title } : layer,
    );
    set({ layout: { ...layout, layers } });
  },

  isDirty() {
    const { layout, savedJson } = get();
    if (!layout || savedJson === null) return false;
    return JSON.stringify(layout) !== savedJson;
  },
}));
