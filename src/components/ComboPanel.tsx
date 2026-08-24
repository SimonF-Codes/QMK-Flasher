import { MIN_COMBO_KEYS } from "../lib/combos";
import { keycapLabels } from "../lib/display";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";
import type { Combo } from "../lib/types";

/**
 * Combos — "several keys pressed together produce one action".
 *
 * The trigger set is built by clicking the board: while the editor is open the
 * keyboard is a multi-select rather than a single selection, and the layer
 * tabs re-point the combo instead of navigating away from it. The action is
 * picked with the ordinary KeyPicker, which switches to the draft while this
 * is open.
 *
 * The ≥2-distinct-keys rule of schema v3 is enforced here, on the Save button,
 * rather than by letting the layout reach the Rust validator broken — you can
 * never get a half-built combo into `layout.combos` at all, because the draft
 * lives outside it until it is valid.
 */
export default function ComboPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const editor = useLayoutStore((s) => s.comboEditor);
  const beginComboEdit = useLayoutStore((s) => s.beginComboEdit);
  const cancelComboEdit = useLayoutStore((s) => s.cancelComboEdit);
  const updateComboDraft = useLayoutStore((s) => s.updateComboDraft);
  const toggleComboDraftKey = useLayoutStore((s) => s.toggleComboDraftKey);
  const commitComboDraft = useLayoutStore((s) => s.commitComboDraft);
  const deleteCombo = useLayoutStore((s) => s.deleteCombo);
  const issue = useLayoutStore((s) => s.comboDraftIssue)();
  const mode = useDisplayStore((s) => s.mode);

  if (!layout) return null;

  const layerNames = layout.layers.map((l) => l.title);
  const describe = (combo: Combo) => {
    const { tap, hold } = keycapLabels(combo.action, mode, layerNames);
    return [tap || "∅", hold].filter(Boolean).join(" / ");
  };
  const layerLabel = (i: number) => `${i} · ${layout.layers[i]?.title ?? "?"}`;

  return (
    <section className="mt-2 rounded-lg border border-zinc-800">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Combos
        </h2>
        <span className="text-[11px] text-zinc-600">
          {layout.combos.length === 0
            ? "none"
            : `${layout.combos.length} · settings.combos ${
                layout.settings.combos ? "on" : "off"
              }`}
        </span>
        <button
          onClick={() => beginComboEdit(null)}
          disabled={editor !== null}
          className="ml-auto rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 enabled:hover:bg-zinc-700 disabled:opacity-40"
        >
          + Combo
        </button>
      </header>

      {editor ? (
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <input
              value={editor.combo.name}
              onChange={(e) => updateComboDraft({ name: e.target.value })}
              placeholder="Name"
              aria-label="Combo name"
              className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-sm outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
            />
            <select
              aria-label="Layer the combo listens on"
              value={editor.combo.layer}
              onChange={(e) =>
                updateComboDraft({ layer: Number(e.target.value) })
              }
              className="rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
            >
              {layout.layers.map((_, i) => (
                <option key={i} value={i}>
                  {layerLabel(i)}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded border border-sky-800/60 bg-sky-950/30 px-2 py-1.5">
            <p className="text-xs text-sky-200">
              Click keys on the board to add them to the trigger set — at least{" "}
              {MIN_COMBO_KEYS}, and they fire only on layer{" "}
              {editor.combo.layer}.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {editor.combo.keys.length === 0 ? (
                <span className="text-[11px] text-zinc-500">
                  No keys picked yet.
                </span>
              ) : (
                editor.combo.keys.map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleComboDraftKey(k)}
                    title="Remove from the trigger set"
                    className="rounded bg-sky-900 px-1.5 py-0.5 font-mono text-[11px] text-sky-100 hover:bg-red-900/70 hover:text-red-100"
                  >
                    {k} ×
                  </button>
                ))
              )}
            </div>
          </div>

          <p className="text-xs text-zinc-400">
            Fires:{" "}
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-100">
              {describe(editor.combo)}
            </span>{" "}
            <span className="text-zinc-600">— pick it in the key picker →</span>
          </p>

          {issue && <p className="text-xs text-amber-400">{issue}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => commitComboDraft()}
              disabled={!!issue}
              className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white enabled:hover:bg-sky-500 disabled:opacity-40"
            >
              {editor.index === null ? "Add combo" : "Save combo"}
            </button>
            <button
              onClick={() => cancelComboEdit()}
              className="rounded px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : layout.combos.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-600">
          No combos. A combo turns several keys pressed together into one
          action.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {layout.combos.map((combo, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                {combo.name || `Combo ${i + 1}`}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                {combo.keys.join("+")}
              </span>
              <span className="shrink-0 text-zinc-600">
                L{combo.layer} → {describe(combo)}
              </span>
              <button
                onClick={() => beginComboEdit(i)}
                className="shrink-0 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Edit
              </button>
              <button
                onClick={() => deleteCombo(i)}
                aria-label={`Delete combo ${combo.name || i + 1}`}
                className="shrink-0 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-red-900/60 hover:text-red-200"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
