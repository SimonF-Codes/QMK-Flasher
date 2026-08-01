import { useEffect } from "react";
import BuildFlashPanel from "./components/BuildFlashPanel";
import DisplayModeToggle from "./components/DisplayModeToggle";
import Keyboard from "./components/Keyboard";
import KeyPicker from "./components/KeyPicker";
import LayerTabs from "./components/LayerTabs";
import LayoutMenu from "./components/LayoutMenu";
import LivePanel from "./components/LivePanel";
import LiveToggle from "./components/LiveToggle";
import OsSwapToggle from "./components/OsSwapToggle";
import VersionHistoryPanel from "./components/VersionHistoryPanel";
import { targetKind } from "./lib/focus";
import { ipc, MOCK } from "./lib/ipc";
import { useClipboardStore } from "./state/clipboardStore";
import { useLayoutStore } from "./state/layoutStore";
import { useLiveStore } from "./state/liveStore";

export default function App() {
  const layout = useLayoutStore((s) => s.layout);
  const loading = useLayoutStore((s) => s.loading);
  const saving = useLayoutStore((s) => s.saving);
  const error = useLayoutStore((s) => s.error);
  const load = useLayoutStore((s) => s.load);
  const save = useLayoutStore((s) => s.save);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const dirty = useLayoutStore((s) => s.isDirty)();
  const liveEnabled = useLiveStore((s) => s.enabled);

  useEffect(() => {
    void load();
  }, [load]);

  // Live view: the board itself reports every switch and its active layer over
  // raw HID. The pairing is held only while live view is on — it sets the same
  // flag ZSA Keymapp and Oryx use, so keeping it open would contend with them.
  useEffect(() => {
    if (!liveEnabled) return;
    const live = useLiveStore.getState();
    const unKey = ipc.onKeyReport((r) => useLiveStore.getState().keyReport(r));
    const unLayer = ipc.onLayerReport((r) =>
      useLiveStore.getState().layerReport(r),
    );
    void live.connect();
    return () => {
      unKey();
      unLayer();
      void useLiveStore.getState().disconnect();
    };
  }, [liveEnabled]);

  // The browser is read for the one thing the firmware cannot answer: what
  // character the OS actually received. It annotates the report that caused it
  // — it never drives the highlight, and there is no fallback to it.
  useEffect(() => {
    if (!liveEnabled) return;

    const onDown = (e: KeyboardEvent) => {
      const where = targetKind(e.target);
      // Never interfere with the keycode search box or the rename inputs.
      if (where === "field") return;
      useLiveStore.getState().emitted(e);
      // Swallow test keystrokes so they don't trip app shortcuts — but let the
      // scratchpad receive characters, and let Ctrl/Cmd combos through so
      // Ctrl+S still saves.
      if (where !== "scratchpad" && !e.ctrlKey && !e.metaKey) e.preventDefault();
    };

    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
  }, [liveEnabled]);

  // Ctrl+S saves, Ctrl+C / Ctrl+V copy and paste the selected key; warn before
  // closing with unsaved edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (key !== "c" && key !== "v") return;
      // Never steal copy/paste from the keycode search box, the rename inputs
      // or the live scratchpad — there Ctrl+C/V mean text, not keys.
      if (targetKind(e.target) !== "page") return;
      const clip = useClipboardStore.getState();
      const acted =
        key === "c" ? clip.copySelectedKey() : clip.pasteToSelectedKey();
      // Only swallow the event when we actually did something, so with no key
      // selected (or an empty clipboard) the browser's own copy still works.
      if (acted) e.preventDefault();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useLayoutStore.getState().isDirty()) e.preventDefault();
    };
    // Capture phase: live view's keydown listener runs on bubble and may
    // auto-follow to another layer (which clears selectedKey). Copying on
    // capture means the shortcut acts on the key you were actually looking at.
    // Live already lets Ctrl/Cmd combos through without preventDefault, so the
    // two listeners don't otherwise fight.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save]);

  return (
    <div className="flex h-screen flex-col">
      {/* Wraps rather than overflowing. Three features (live view, LED tooling,
          OS-mode switch) each added header controls independently; together they
          stopped fitting the 800px default window, and without `flex-wrap` the
          row overflowed and scrolled the whole page sideways. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="shrink-0 text-base font-semibold tracking-tight">
          QMK Flasher
        </h1>
        <LayoutMenu />
        {layout && (
          // Truncate instead of forcing width: the Oryx id is the longest and
          // least important thing in the row.
          <span className="min-w-0 truncate text-xs text-zinc-500">
            Oryx {layout.meta.seededFrom.layoutId}/
            {layout.meta.seededFrom.revisionHash}
          </span>
        )}
        {MOCK && (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            mock
          </span>
        )}
        {/* shrink-0 keeps the controls at full size; when the row runs out of
            space this group wraps to its own line instead of being squeezed. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <VersionHistoryPanel />
          <LiveToggle />
          <DisplayModeToggle />
          {/* Divider: what keys are CALLED (left) vs what they EMIT (right). */}
          <span className="h-4 w-px bg-zinc-700" aria-hidden />
          <OsSwapToggle />
          {dirty && (
            <span className="text-xs text-amber-400" title="Unsaved changes">
              ● unsaved
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 enabled:hover:bg-zinc-700 disabled:opacity-40"
            title="Ctrl+S"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-200">
          {error.message}
          {error.hint && (
            <span className="ml-2 text-xs text-red-300/80">{error.hint}</span>
          )}
        </div>
      )}

      <LayerTabs />

      <main className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col p-4">
          {loading && <p className="text-sm text-zinc-500">Loading layout…</p>}
          {!loading && !layout && !error && (
            <p className="text-sm text-zinc-500">No layout.</p>
          )}
          <Keyboard />
          {layout && selectedKey === null && !liveEnabled && (
            <p className="mt-2 text-center text-xs text-zinc-600">
              Click a key to edit it.
            </p>
          )}
          <LivePanel />
        </section>
        <KeyPicker />
      </main>

      <BuildFlashPanel />
    </div>
  );
}
