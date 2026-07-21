import { useEffect } from "react";
import BuildFlashPanel from "./components/BuildFlashPanel";
import Keyboard from "./components/Keyboard";
import KeyPicker from "./components/KeyPicker";
import LayerTabs from "./components/LayerTabs";
import LayoutMenu from "./components/LayoutMenu";
import { MOCK } from "./lib/ipc";
import { useLayoutStore } from "./state/layoutStore";

export default function App() {
  const layout = useLayoutStore((s) => s.layout);
  const loading = useLayoutStore((s) => s.loading);
  const saving = useLayoutStore((s) => s.saving);
  const error = useLayoutStore((s) => s.error);
  const load = useLayoutStore((s) => s.load);
  const save = useLayoutStore((s) => s.save);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const dirty = useLayoutStore((s) => s.isDirty)();

  useEffect(() => {
    void load();
  }, [load]);

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
          {layout && selectedKey === null && (
            <p className="mt-2 text-center text-xs text-zinc-600">
              Click a key to edit it.
            </p>
          )}
        </section>
        <KeyPicker />
      </main>

      <BuildFlashPanel />
    </div>
  );
}
