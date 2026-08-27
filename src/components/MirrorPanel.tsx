import { useMemo, useState } from "react";
import {
  DEFAULT_MIRROR_OPTIONS,
  MIRROR_MAP,
  mirroredKeyCount,
  type MirrorOptions,
} from "../lib/mirror";
import { useLayoutStore } from "../state/layoutStore";

/**
 * "Mirror this layer": generate a one-handed mirror of a layer instead of
 * maintaining one by hand.
 *
 * The shipped Mirror layer was hand-typed, which is why it had drifted out of
 * step with the base layer — a mirror is a *derived* artifact and there is no
 * way to keep a derived artifact honest by editing it. Regenerating it takes
 * two clicks here.
 *
 * The three checkboxes are the real content of this panel. Reflecting all 72
 * keys is the obvious behavior and the wrong one: it carries the way OUT of the
 * layer, your modifiers and your space bar over to the hand that is not on the
 * board. They default to on and say why, because someone who turns one off
 * should know what they are turning off.
 */
export default function MirrorPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const mirrorLayer = useLayoutStore((s) => s.mirrorLayer);

  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(selectedLayer);
  /** Destination layer index, or "new" for an appended layer. */
  const [target, setTarget] = useState<number | "new">(selectedLayer);
  const [options, setOptions] = useState<MirrorOptions>(DEFAULT_MIRROR_OPTIONS);

  const sourceKeys = layout?.layers[source]?.keys;
  const moving = useMemo(
    () => (sourceKeys ? mirroredKeyCount(sourceKeys, options) : 0),
    [sourceKeys, options],
  );

  if (!layout) return null;

  const openPanel = () => {
    // Default to mirroring the layer you are looking at, in place: the common
    // case is "regenerate this", and the destination select covers the rest.
    setSource(selectedLayer);
    setTarget(selectedLayer);
    setOpen(true);
  };

  const run = () => {
    mirrorLayer(source, target === "new" ? null : target, options);
    setOpen(false);
  };

  const toggle = (key: keyof MirrorOptions) => (checked: boolean) =>
    setOptions((o) => ({ ...o, [key]: checked }));

  const layerLabel = (i: number) => `${i} · ${layout.layers[i].title}`;
  const total = MIRROR_MAP.length;
  const overwriting = target !== "new";

  const keep: { key: keyof MirrorOptions; label: string; why: string }[] = [
    {
      key: "keepLayerKeys",
      label: "Keep layer keys in place",
      why: "MO/TG/TO/TT/LT — so the way out of the layer stays under the hand you are using.",
    },
    {
      key: "keepThumbs",
      label: "Keep thumb clusters in place",
      why: "A thumb cluster is not the other one reflected; the hand still typing keeps its space bar.",
    },
    {
      key: "keepModifiers",
      label: "Keep modifiers in place",
      why: "Shift/Ctrl/Alt/GUI are held while another key is struck, so one hand needs both. Mod-taps still move — their tap is a character.",
    },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="rounded-md px-2.5 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        title="Generate a mirrored (one-handed) version of a layer"
      >
        ⇋ Mirror layer
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <p className="mb-2 text-xs text-zinc-400">
            Reflect every key to its counterpart on the other half, so one hand
            reaches the whole board. Pairing comes from the board geometry.
          </p>

          <div className="flex items-center gap-2">
            <select
              aria-label="Layer to mirror"
              value={source}
              onChange={(e) => setSource(Number(e.target.value))}
              className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
            >
              {layout.layers.map((_, i) => (
                <option key={i} value={i}>
                  {layerLabel(i)}
                </option>
              ))}
            </select>
            <span className="text-zinc-500" aria-hidden>
              →
            </span>
            <select
              aria-label="Layer to write the mirror into"
              value={target}
              onChange={(e) =>
                setTarget(
                  e.target.value === "new" ? "new" : Number(e.target.value),
                )
              }
              className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
            >
              <option value="new">+ New layer</option>
              {layout.layers.map((_, i) => (
                <option key={i} value={i}>
                  {layerLabel(i)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 space-y-2">
            {keep.map(({ key, label, why }) => (
              <label
                key={key}
                className="flex items-start gap-2 text-xs text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => toggle(key)(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  {label}
                  <span className="block text-zinc-500">{why}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="mt-3 text-xs text-zinc-400">
            {moving} of {total} keys change sides.
          </p>
          {overwriting && (
            // Say it plainly: this replaces every key on a layer the user may
            // have spent an evening on, and there is no per-key undo.
            <p className="mt-1 text-xs text-amber-300">
              Replaces all {total} keys of layer {layerLabel(target)}.
            </p>
          )}

          <div className="mt-3 flex justify-end gap-1">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={run}
              className="rounded bg-sky-700 px-2 py-1 text-xs text-sky-50 hover:bg-sky-600"
            >
              Mirror
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
