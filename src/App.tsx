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
import { MOCK } from "./lib/ipc";
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

  // Live view: feed real key events to liveStore so the board lights up.
  // Only active while live mode is on, so normal editing is untouched.
  useEffect(() => {
    if (!liveEnabled) return;

    /** Where the event landed: the scratchpad, another editable field, or the page. */
    const targetKind = (t: EventTarget | null): "scratchpad" | "field" | "page" => {
      if (!(t instanceof HTMLElement)) return "page";
      if (t.hasAttribute("data-live-scratchpad")) return "scratchpad";
      if (t.isContentEditable) return "field";
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return "field";
      return "page";
    };

    const onDown = (e: KeyboardEvent) => {
      const where = targetKind(e.target);
      // Never interfere with the keycode search box or the rename inputs.
      if (where === "field") return;
      useLiveStore.getState().keyDown(e);
      // Swallow test keystrokes so they don't trip app shortcuts — but let the
      // scratchpad receive characters, and let Ctrl/Cmd combos through so
      // Ctrl+S still saves.
      if (where !== "scratchpad" && !e.ctrlKey && !e.metaKey) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (targetKind(e.target) === "field") return;
      useLiveStore.getState().keyUp(e);
    };
    // Alt-tabbing while holding a key would otherwise leave it stuck lit.
    const onBlur = () => useLiveStore.getState().releaseAll();

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [liveEnabled]);

  // Ctrl+S saves; warn before closing with unsaved edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useLayoutStore.getState().isDirty()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
        <h1 className="text-base font-semibold tracking-tight">QMK Flasher</h1>
        <LayoutMenu />
        {layout && (
          <span className="text-xs text-zinc-500">
            Oryx {layout.meta.seededFrom.layoutId}/
            {layout.meta.seededFrom.revisionHash}
          </span>
        )}
        {MOCK && (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            mock
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
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
