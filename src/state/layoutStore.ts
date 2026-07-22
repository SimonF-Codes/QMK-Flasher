/**
 * App-wide layout state (zustand): the loaded layout, selection, edits,
 * dirty tracking (deep compare vs last-saved), and save.
 */
import { create } from "zustand";
import { ipc, toAppError } from "../lib/ipc";
import {
  swapKeysInLayer,
  swapLayers as swapLayersInLayout,
  transposeIndex,
} from "../lib/layers";
import type {
  AppError,
  KeyAction,
  Layer,
  LayoutFile,
  LayoutSummary,
} from "../lib/types";

/** True iff any key across all layers is a tap-dance action. */
function layersUseTapDance(layers: Layer[]): boolean {
  return layers.some((layer) => layer.keys.some((k) => k.kind === "tapDance"));
}

/**
 * Best-effort id for the loaded active layout. The contract has no
 * "which id is active" getter (meta.id is deferred to a later rev), so we
 * match the loaded file against the summaries by name + keyboard, falling
 * back to the first summary. Unambiguous for today's single-default store.
 */
function matchActiveId(
  layouts: LayoutSummary[],
  layout: LayoutFile,
): string | null {
  const hit = layouts.find(
    (s) => s.name === layout.meta.name && s.keyboard === layout.meta.geometry,
  );
  return hit?.id ?? layouts[0]?.id ?? null;
}

/** How to resolve unsaved edits when switching away from a dirty layout. */
export type DirtyResolution = "save" | "discard";

interface LayoutState {
  layout: LayoutFile | null;
  /** Serialized form of the last loaded/saved layout, for dirty compare. */
  savedJson: string | null;
  /** All stored layouts (summaries) for the selector menu. */
  layouts: LayoutSummary[];
  /** Id of the active layout (the one `layout` holds). */
  activeId: string | null;
  selectedLayer: number;
  selectedKey: number | null;
  /**
   * When set, the UI is in "swap with…" mode: the next key clicked on the
   * keyboard is swapped with this position (within the selected layer).
   */
  swapSource: number | null;
  loading: boolean;
  saving: boolean;
  error: AppError | null;

  load(): Promise<void>;
  save(): Promise<void>;
  refreshLayouts(): Promise<void>;
  /**
   * Switch the active layout. Returns false without switching if the current
   * layout has unsaved edits and no `resolution` is given (the caller should
   * prompt, then call again with "save" or "discard").
   */
  switchLayout(id: string, resolution?: DirtyResolution): Promise<boolean>;
  createLayout(name: string, keyboardId: string): Promise<LayoutSummary | null>;
  duplicateLayout(id: string, newName: string): Promise<LayoutSummary | null>;
  renameLayout(id: string, name: string): Promise<void>;
  deleteLayout(id: string): Promise<void>;
  /** Re-seed the active layout from its Oryx source (meta.seededFrom.layoutId). */
  seedActiveFromOryx(): Promise<void>;
  selectLayer(index: number): void;
  selectKey(index: number | null): void;
  setKeyAction(action: KeyAction): void;
  renameLayer(index: number, title: string): void;
  /** Enter "swap with…" mode, anchored on the given key in the selected layer. */
  beginSwap(source: number): void;
  /** Leave "swap with…" mode without swapping. */
  cancelSwap(): void;
  /**
   * Swap two keys within the selected layer and mark dirty. Leaves swap mode
   * and moves the selection to the target position. No-op if a === b.
   */
  swapKeys(a: number, b: number): void;
  /**
   * Swap two whole layers, remapping every layer-index reference (MO/LT/TG/TO/
   * TT + combos) so behavior is preserved. Marks dirty and keeps the currently
   * viewed layer's content selected.
   */
  swapLayers(a: number, b: number): void;
  isDirty(): boolean;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  layout: null,
  savedJson: null,
  layouts: [],
  activeId: null,
  selectedLayer: 0,
  selectedKey: null,
  swapSource: null,
  loading: false,
  saving: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const [layout, layouts] = await Promise.all([
        ipc.loadLayout(),
        ipc.listLayouts(),
      ]);
      set({
        layout,
        layouts,
        activeId: matchActiveId(layouts, layout),
        savedJson: JSON.stringify(layout),
        selectedLayer: 0,
        selectedKey: null,
        swapSource: null,
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
      await get().refreshLayouts(); // modifiedAt / name may have moved
    } catch (e) {
      set({ error: toAppError(e), saving: false });
    }
  },

  async refreshLayouts() {
    try {
      set({ layouts: await ipc.listLayouts() });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async switchLayout(id, resolution) {
    if (id === get().activeId) return true;
    if (get().isDirty() && !resolution) return false;
    set({ error: null });
    try {
      if (resolution === "save") await get().save();
      const layout = await ipc.selectLayout(id);
      const layouts = await ipc.listLayouts();
      set({
        layout,
        layouts,
        activeId: id,
        savedJson: JSON.stringify(layout),
        selectedLayer: 0,
        selectedKey: null,
        swapSource: null,
      });
      return true;
    } catch (e) {
      set({ error: toAppError(e) });
      return false;
    }
  },

  async createLayout(name, keyboardId) {
    set({ error: null });
    try {
      const summary = await ipc.createLayout(name, keyboardId);
      await get().refreshLayouts();
      return summary;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async duplicateLayout(id, newName) {
    set({ error: null });
    try {
      const summary = await ipc.duplicateLayout(id, newName);
      await get().refreshLayouts();
      return summary;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async renameLayout(id, name) {
    set({ error: null });
    try {
      await ipc.renameLayout(id, name);
      await get().refreshLayouts();
      // Keep the in-memory active layout's name in sync without clobbering
      // other unsaved edits (rename only touches the name field on disk).
      if (id === get().activeId) {
        const cur = get().layout;
        if (cur) set({ layout: { ...cur, meta: { ...cur.meta, name } } });
        const saved = get().savedJson;
        if (saved) {
          const parsed = JSON.parse(saved) as LayoutFile;
          parsed.meta.name = name;
          set({ savedJson: JSON.stringify(parsed) });
        }
      }
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async deleteLayout(id) {
    set({ error: null });
    try {
      await ipc.deleteLayout(id);
      await get().refreshLayouts();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async seedActiveFromOryx() {
    const layout = get().layout;
    if (!layout) return;
    // seed_from_oryx takes the ORYX hashId, not the local store id.
    const oryxId = layout.meta.seededFrom.layoutId;
    if (!oryxId || oryxId === "local") {
      set({
        error: {
          code: "OryxUnreachable",
          message: "This layout has no Oryx source to re-seed from.",
          hint: "Only layouts created by seeding from Oryx can be re-seeded.",
        },
      });
      return;
    }
    set({ error: null, loading: true });
    try {
      // force=true: re-fetch from Oryx and overwrite. With force=false the
      // backend short-circuits to the already-saved layout (a no-op re-seed).
      const seeded = await ipc.seedFromOryx(oryxId, true);
      set({
        layout: seeded,
        savedJson: JSON.stringify(seeded),
        selectedLayer: 0,
        selectedKey: null,
        swapSource: null,
        loading: false,
      });
      await get().refreshLayouts();
    } catch (e) {
      set({ error: toAppError(e), loading: false });
    }
  },

  selectLayer(index) {
    set({ selectedLayer: index, selectedKey: null, swapSource: null });
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

  beginSwap(source) {
    set({ swapSource: source, selectedKey: source });
  },

  cancelSwap() {
    set({ swapSource: null });
  },

  swapKeys(a, b) {
    const { layout, selectedLayer } = get();
    if (!layout || a === b) {
      set({ swapSource: null });
      return;
    }
    const next = swapKeysInLayer(layout, selectedLayer, a, b);
    // Swapping within one layer never changes the multiset of key kinds, so
    // settings.tapDance is unaffected — no need to recompute it here.
    set({ layout: next, swapSource: null, selectedKey: b });
  },

  swapLayers(a, b) {
    const { layout, selectedLayer } = get();
    if (!layout || a === b) return;
    if (a < 0 || b < 0 || a >= layout.layers.length || b >= layout.layers.length) {
      return;
    }
    const next = swapLayersInLayout(layout, a, b);
    // Keep the currently viewed layer's content in view: its slot moved via the
    // same a↔b transposition used to remap references.
    const selectedLayerNext = transposeIndex(a, b)(selectedLayer);
    set({
      layout: next,
      selectedLayer: selectedLayerNext,
      selectedKey: null,
      swapSource: null,
    });
  },

  isDirty() {
    const { layout, savedJson } = get();
    if (!layout || savedJson === null) return false;
    return JSON.stringify(layout) !== savedJson;
  },
}));
