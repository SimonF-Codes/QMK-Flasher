/**
 * App-wide layout state (zustand): the loaded layout, selection, edits,
 * dirty tracking (deep compare vs last-saved), and save.
 */
import { create } from "zustand";
import { ipc, toAppError } from "../lib/ipc";
import {
  clearLayerGlows as clearLayerGlowsInLayout,
  glowLayerKeysByTarget as glowLayerKeysByTargetInLayout,
  setKeyGlow,
  setLayerColor as setLayerColorInLayout,
} from "../lib/led";
import {
  addLayer as addLayerToLayout,
  deleteLayer as deleteLayerFromLayout,
  findLayerReferences,
  referenceCount,
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
  LayoutVersionSummary,
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
  /** Version history for the active layout (newest first). */
  versions: LayoutVersionSummary[];
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
  /** Reload the active layout's version history into `versions`. */
  refreshVersions(): Promise<void>;
  /** Restore a prior version (backend snapshots the current first). */
  restoreVersion(versionId: string): Promise<void>;
  /** Take an explicit manual snapshot of the active layout. */
  snapshotNow(label?: string): Promise<void>;
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
  /** Append a transparent layer and select it. */
  addLayer(title?: string): void;
  /**
   * How many keys/combos would be cleared by deleting `index` — drives the
   * confirmation, since the delete edits keys the user did not touch.
   */
  layerReferenceCount(index: number): number;
  /**
   * Delete a layer, clearing references to it and shifting the ones above down.
   * No-op on the last remaining layer (the schema requires at least one).
   */
  deleteLayer(index: number): void;
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
  /** Set a layer's base LED color (the ledmap base HSV for all its keys). */
  setLayerColor(index: number, color: string): void;
  /**
   * Set the selected key's per-key LED override, or clear it (null) so the key
   * falls back to its layer's base color. No-op with no key selected.
   */
  setSelectedKeyGlow(glow: string | null): void;
  /** Drop every per-key override on a layer, flattening it to its base color. */
  clearLayerGlows(index: number): void;
  /**
   * Glow every layer key (MO/TG/TO/TT/LT) on a layer with the color of the
   * layer it navigates to, so the board shows where each key leads.
   */
  glowLayerKeysByTarget(index: number): void;
  isDirty(): boolean;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  layout: null,
  savedJson: null,
  layouts: [],
  activeId: null,
  versions: [],
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
      await get().refreshVersions();
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
      await get().refreshVersions(); // save auto-snapshots a version
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

  async refreshVersions() {
    const id = get().activeId;
    if (!id) {
      set({ versions: [] });
      return;
    }
    try {
      set({ versions: await ipc.listLayoutVersions(id) });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async restoreVersion(versionId) {
    const id = get().activeId;
    if (!id) return;
    set({ error: null, loading: true });
    try {
      const layout = await ipc.restoreLayoutVersion(id, versionId);
      set({
        layout,
        savedJson: JSON.stringify(layout), // restored == the new saved state
        selectedLayer: 0,
        selectedKey: null,
        swapSource: null,
        loading: false,
      });
      await get().refreshVersions(); // the pre-restore backup is now listed
    } catch (e) {
      set({ error: toAppError(e), loading: false });
    }
  },

  async snapshotNow(label) {
    const id = get().activeId;
    if (!id) return;
    set({ error: null });
    try {
      await ipc.snapshotLayout(id, "manual", label);
      await get().refreshVersions();
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
        versions: [],
      });
      await get().refreshVersions();
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
      await get().refreshVersions(); // reseed auto-snapshots a preReseed backup
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

  addLayer(title) {
    const { layout } = get();
    if (!layout) return;
    const next = addLayerToLayout(layout, title);
    // Jump to the new layer — you added it to put something in it.
    set({
      layout: next,
      selectedLayer: next.layers.length - 1,
      selectedKey: null,
      swapSource: null,
    });
  },

  layerReferenceCount(index) {
    const { layout } = get();
    if (!layout) return 0;
    return referenceCount(findLayerReferences(layout, index));
  },

  deleteLayer(index) {
    const { layout, selectedLayer } = get();
    if (!layout || layout.layers.length <= 1) return;
    if (index < 0 || index >= layout.layers.length) return;

    const next = deleteLayerFromLayout(layout, index);
    // Deleting can drop the last tap-dance key, and leaving the flag true
    // enables TAP_DANCE_ENABLE without emitting tap_dance_actions[], which
    // breaks the build — same reasoning as setKeyAction.
    const tapDance = layersUseTapDance(next.layers);
    const settings =
      tapDance === next.settings.tapDance
        ? next.settings
        : { ...next.settings, tapDance };

    // Keep a valid selection: deleting at or before the viewed layer shifts it.
    const selected =
      selectedLayer > index
        ? selectedLayer - 1
        : Math.min(selectedLayer, next.layers.length - 1);

    set({
      layout: { ...next, settings },
      selectedLayer: selected,
      selectedKey: null,
      swapSource: null,
    });
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

  setLayerColor(index, color) {
    const { layout } = get();
    if (!layout) return;
    // The lib transforms return the SAME object when the edit is invalid (bad
    // hex, index out of range). Bailing on identity keeps a rejected edit from
    // marking the layout dirty.
    const next = setLayerColorInLayout(layout, index, color);
    if (next !== layout) set({ layout: next });
  },

  setSelectedKeyGlow(glow) {
    const { layout, selectedLayer, selectedKey } = get();
    if (!layout || selectedKey === null) return;
    const next = setKeyGlow(layout, selectedLayer, selectedKey, glow);
    if (next !== layout) set({ layout: next });
  },

  clearLayerGlows(index) {
    const { layout } = get();
    if (!layout) return;
    const next = clearLayerGlowsInLayout(layout, index);
    if (next !== layout) set({ layout: next });
  },

  glowLayerKeysByTarget(index) {
    const { layout } = get();
    if (!layout) return;
    const next = glowLayerKeysByTargetInLayout(layout, index);
    if (next !== layout) set({ layout: next });
  },

  isDirty() {
    const { layout, savedJson } = get();
    if (!layout || savedJson === null) return false;
    return JSON.stringify(layout) !== savedJson;
  },
}));
