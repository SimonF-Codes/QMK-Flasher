import { useState } from "react";
import {
  fallthroughSource,
  isHexColor,
  resolveLedColor,
} from "../lib/led";
import { useLayoutStore } from "../state/layoutStore";

/**
 * Per-key LED override for the selected key. A key with no override inherits
 * its layer's base color, so the two states are "same as layer" and "custom".
 */
export default function KeyGlowEditor() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const setSelectedKeyGlow = useLayoutStore((s) => s.setSelectedKeyGlow);
  const [draft, setDraft] = useState("");

  if (!layout || selectedKey === null) return null;
  const layer = layout.layers[selectedLayer];
  const key = layer?.keys[selectedKey];
  if (!layer || !key) return null;

  const resolved = resolveLedColor(layout, selectedLayer, selectedKey) ?? layer.color;
  const custom = key.glow !== undefined;

  // A transparent key is lit by THIS layer but behaves like a lower one — the
  // one case where the LED map cannot tell the truth about the key.
  const source =
    key.kind === "transparent"
      ? fallthroughSource(layout, selectedLayer, selectedKey)
      : selectedLayer;

  const commitDraft = () => {
    if (isHexColor(draft)) setSelectedKeyGlow(draft);
    setDraft("");
  };

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          LED
        </span>
        <span className="text-[11px] text-zinc-600">
          {custom ? "custom" : "same as layer"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Key LED color"
          value={resolved}
          onChange={(e) => setSelectedKeyGlow(e.target.value)}
          className="h-7 w-10 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-950"
        />
        <input
          aria-label="Key LED color hex"
          value={draft || resolved}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setDraft("");
          }}
          spellCheck={false}
          className={`w-24 rounded bg-zinc-950 px-2 py-1 font-mono text-xs outline-none ring-1 ${
            draft && !isHexColor(draft)
              ? "text-red-300 ring-red-700"
              : "text-zinc-100 ring-zinc-700"
          }`}
        />
        <button
          onClick={() => setSelectedKeyGlow(null)}
          disabled={!custom}
          className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-40"
          title="Drop the override and inherit the layer's base color"
        >
          Reset
        </button>
      </div>

      {key.kind === "transparent" && (
        <p className="mt-1 text-[11px] text-amber-400/90">
          {source === null
            ? "Transparent all the way down — lit by this layer but types nothing."
            : `Lit by layer ${selectedLayer}, but types what layer ${source} has here.`}
        </p>
      )}
    </section>
  );
}
