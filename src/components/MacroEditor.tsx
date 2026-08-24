import { useState } from "react";
import { withGlow } from "../lib/labels";
import { labelOf, macroIssue, stepsOf } from "../lib/macros";
import type { KeyAction, MacroStep } from "../lib/types";
import MacroStepList from "./MacroStepList";

/**
 * Editor for a single-list `macro` key — a label plus an ordered step list.
 *
 * Macros used to arrive only from Oryx and were marked read-only, so the only
 * way to change one was to replace the key. They are first-class here: the
 * seven in Simon's layout open, edit and re-save through this without the
 * untouched ones changing on disk (`macros.ts` never rebuilds a step it was
 * not asked to change).
 *
 * Edits are held in local draft state and applied on Apply rather than
 * live-written to the layout: a macro mid-edit is routinely invalid (no steps
 * yet) and typing a label one character at a time would fill the version
 * history with noise.
 */
export default function MacroEditor({
  current,
  onApply,
  onClose,
}: {
  current: KeyAction;
  /** Where the result goes — a key, or the combo draft when that is open. */
  onApply(action: KeyAction): void;
  onClose(): void;
}) {
  const [label, setLabel] = useState(() => labelOf(current));
  const [steps, setSteps] = useState<readonly MacroStep[]>(() =>
    stepsOf(current),
  );

  const issue = macroIssue(steps);

  const apply = () => {
    if (issue) return;
    onApply(
      withGlow({ kind: "macro", label, steps: steps.slice() }, current),
    );
    onClose();
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Macro</h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          Close
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Label
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. push"
          className="w-full rounded bg-zinc-900 px-2 py-1 text-sm outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
        />
        <span className="mt-1 block text-[11px] text-zinc-600">
          Shown on the keycap. Optional — Oryx macros do not always have one.
        </span>
      </label>

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Steps
        </div>
        <MacroStepList
          steps={steps}
          onChange={setSteps}
          emptyHint="No steps yet — add one to say what this key types."
        />
      </div>

      {issue ? (
        <p className="text-xs text-amber-400">{issue}</p>
      ) : (
        <p className="text-[11px] text-zinc-600">
          Steps fire in order, each with its own delay after it.
        </p>
      )}

      <div className="flex gap-2">
        <button
          disabled={!!issue}
          onClick={apply}
          className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white enabled:hover:bg-sky-500 disabled:opacity-40"
        >
          Apply
        </button>
        {current.kind === "macro" && (
          // Deleting a macro means the key stops doing anything — there is no
          // separate macro table to remove it from, the key IS the macro.
          <button
            onClick={() => {
              onApply(withGlow({ kind: "none" }, current));
              onClose();
            }}
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-red-900/60 hover:text-red-200"
            title="Clear this key (the macro only exists here)"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
