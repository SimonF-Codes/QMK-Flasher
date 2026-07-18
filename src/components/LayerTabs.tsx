import { useState } from "react";
import { useLayoutStore } from "../state/layoutStore";

export default function LayerTabs() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectLayer = useLayoutStore((s) => s.selectLayer);
  const renameLayer = useLayoutStore((s) => s.renameLayer);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  if (!layout) return null;

  const commit = (i: number) => {
    const title = draft.trim();
    if (title) renameLayer(i, title);
    setEditing(null);
  };

  return (
    <nav className="flex flex-wrap gap-1 border-b border-zinc-800 px-4 py-2">
      {layout.layers.map((layer, i) => (
        <button
          key={i}
          onClick={() => selectLayer(i)}
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
    </nav>
  );
}
