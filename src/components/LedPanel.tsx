import { useState } from "react";
import { LED_OFF, glowCount, isHexColor } from "../lib/led";
import { useLayoutStore } from "../state/layoutStore";

/**
 * Layer-level LED tooling: the base color every key on the layer lights with,
 * plus the two bulk operations over per-key overrides. Per-key overrides
 * themselves are edited in KeyPicker, next to the key they belong to.
 */
export default function LedPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const setLayerColor = useLayoutStore((s) => s.setLayerColor);
  const clearLayerGlows = useLayoutStore((s) => s.clearLayerGlows);
  const glowLayerKeysByTarget = useLayoutStore((s) => s.glowLayerKeysByTarget);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  if (!layout) return null;
  const layer = layout.layers[selectedLayer];
  if (!layer) return null;

  const overrides = glowCount(layout, selectedLayer);
  // The <input type="color"> can't express "off", and the firmware reads
  // h=s=v=0 as off rather than as a color — so surface it as its own control.
  const off = layer.color.toLowerCase() === LED_OFF;

  const commitDraft = () => {
    if (isHexColor(draft)) setLayerColor(selectedLayer, draft);
    setDraft("");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        title="Edit this layer's LED colors"
      >
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-600"
          style={{ background: layer.color }}
        />
        LEDs
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <p className="mb-2 text-xs text-zinc-400">
            Layer {selectedLayer} lights with this color while it is the top
            active layer. Individual keys can override it (
            {overrides === 0 ? "none do" : `${overrides} do`}).
          </p>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="color"
              aria-label="Layer base color"
              value={off ? "#000000" : layer.color}
              onChange={(e) => setLayerColor(selectedLayer, e.target.value)}
              className="h-7 w-10 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-950"
            />
            <input
              aria-label="Layer base color hex"
              value={draft || layer.color}
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
              onClick={() => setLayerColor(selectedLayer, LED_OFF)}
              disabled={off}
              className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-40"
              title="Black is read as 'LED off' by the firmware, not as a color"
            >
              {off ? "Off" : "Turn off"}
            </button>
          </label>

          <div className="mt-3 space-y-1 border-t border-zinc-800 pt-3">
            <button
              onClick={() => glowLayerKeysByTarget(selectedLayer)}
              className="w-full rounded bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-700"
              title="MO / TG / TO / TT / LT keys take the color of the layer they lead to"
            >
              Tint layer keys by destination
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Every MO/TG/TO/TT/LT key takes its target layer's color.
              </span>
            </button>
            <button
              onClick={() => clearLayerGlows(selectedLayer)}
              disabled={overrides === 0}
              className="w-full rounded bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-200 enabled:hover:bg-zinc-700 disabled:opacity-40"
            >
              Clear {overrides} per-key override{overrides === 1 ? "" : "s"}
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Flattens the layer back to one base color.
              </span>
            </button>
          </div>

          <div className="mt-3 flex justify-end border-t border-zinc-800 pt-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
