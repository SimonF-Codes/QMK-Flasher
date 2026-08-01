import { useState } from "react";
import { useLayoutStore } from "../state/layoutStore";
import { useLiveStore } from "../state/liveStore";

export default function LayerTabs() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectLayer = useLayoutStore((s) => s.selectLayer);
  const liveEnabled = useLiveStore((s) => s.enabled);
  const pinLayer = useLiveStore((s) => s.pinLayer);
  const renameLayer = useLayoutStore((s) => s.renameLayer);
  const swapLayers = useLayoutStore((s) => s.swapLayers);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapA, setSwapA] = useState(0);
  const [swapB, setSwapB] = useState(1);

  if (!layout) return null;

  const commit = (i: number) => {
    const title = draft.trim();
    if (title) renameLayer(i, title);
    setEditing(null);
  };

  const layerLabel = (i: number) => `${i} · ${layout.layers[i].title}`;

  // Picking a layer by hand while live view is on pins it, pausing auto-follow.
  // Layer keys (MO/TO/TG/TT) are handled inside the firmware and never reach
  // the OS, so inference can't see them — this is the manual override that
  // lets you force the view to match what the board is actually doing.
  const onLayerClick = (i: number) => {
    selectLayer(i);
    if (liveEnabled) pinLayer(i);
  };

  const openSwap = () => {
    setSwapA(selectedLayer);
    setSwapB(selectedLayer === 0 ? 1 : 0);
    setSwapOpen(true);
  };

  const doSwap = () => {
    if (swapA !== swapB) swapLayers(swapA, swapB);
    setSwapOpen(false);
  };

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-4 py-2">
      {layout.layers.map((layer, i) => (
        <button
          key={i}
          onClick={() => onLayerClick(i)}
          onDoubleClick={() => {
            setEditing(i);
            setDraft(layer.title);
          }}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            i === selectedLayer
              ? "bg-zinc-700 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
          title="Double-click to rename"
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: layer.color }}
          />
          {editing === i ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(i);
                if (e.key === "Escape") setEditing(null);
              }}
              className="w-24 rounded bg-zinc-900 px-1 text-zinc-100 outline-none ring-1 ring-sky-500"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span>
              {i} · {layer.title}
            </span>
          )}
        </button>
      ))}

      {layout.layers.length >= 2 && (
        <div className="relative ml-2">
          <button
            onClick={() => (swapOpen ? setSwapOpen(false) : openSwap())}
            className="rounded-md px-2.5 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Swap two whole layers"
          >
            ⇄ Swap layers
          </button>

          {swapOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
              <p className="mb-2 text-xs text-zinc-400">
                Swap two layers. All layer references (MO/LT/TG/TO/TT and combos)
                are remapped so behavior is preserved.
              </p>
              <div className="flex items-center gap-2">
                <select
                  aria-label="First layer to swap"
                  value={swapA}
                  onChange={(e) => setSwapA(Number(e.target.value))}
                  className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
                >
                  {layout.layers.map((_, i) => (
                    <option key={i} value={i}>
                      {layerLabel(i)}
                    </option>
                  ))}
                </select>
                <span className="text-zinc-500">⇄</span>
                <select
                  aria-label="Second layer to swap"
                  value={swapB}
                  onChange={(e) => setSwapB(Number(e.target.value))}
                  className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
                >
                  {layout.layers.map((_, i) => (
                    <option key={i} value={i}>
                      {layerLabel(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 flex justify-end gap-1">
                <button
                  onClick={() => setSwapOpen(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={doSwap}
                  disabled={swapA === swapB}
                  className="rounded bg-sky-700 px-2 py-1 text-xs text-sky-50 enabled:hover:bg-sky-600 disabled:opacity-40"
                >
                  Swap
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
