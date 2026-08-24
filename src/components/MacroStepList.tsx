import { useState } from "react";
import { labelFor } from "../lib/keycodes";
import { ALL_MODS, modsShort } from "../lib/labels";
import {
  appendStep,
  DEFAULT_STEP_DELAY,
  newStep,
  nudgeStep,
  removeStep,
  setStepCode,
  setStepDelay,
  toggleStepMod,
} from "../lib/macros";
import type { MacroStep } from "../lib/types";
import KeycodeSearch from "./KeycodeSearch";

/**
 * An ordered macro step list: keycode + modifiers + delay per step, with
 * reordering. Shared by the macro editor (one list) and the OS macro editor
 * (one per OS), so the two halves of an osMacro are edited identically.
 *
 * Only one step's detail is expanded at a time — a seven-step macro with every
 * modifier grid open is unreadable, and the collapsed rows already say what
 * each step sends.
 */
export default function MacroStepList({
  steps,
  onChange,
  emptyHint = "No steps yet.",
}: {
  steps: readonly MacroStep[];
  onChange(steps: readonly MacroStep[]): void;
  emptyHint?: string;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const add = () => {
    onChange(appendStep(steps, newStep()));
    setExpanded(steps.length);
  };

  return (
    <div className="space-y-1">
      {steps.length === 0 && (
        <p className="rounded border border-dashed border-zinc-700 px-2 py-3 text-center text-xs text-zinc-500">
          {emptyHint}
        </p>
      )}

      {steps.map((step, i) => {
        const open = expanded === i;
        return (
          <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center gap-1 px-1.5 py-1">
              <span className="w-4 shrink-0 text-right text-[11px] text-zinc-600">
                {i + 1}
              </span>
              <button
                onClick={() => setExpanded(open ? null : i)}
                className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                title={`${step.code}${step.delay === undefined ? "" : ` · ${step.delay} ms`}`}
              >
                {!!step.mods?.length && (
                  <span className="text-sky-300">{modsShort(step.mods)}+</span>
                )}
                {labelFor(step.code)}
              </button>
              <button
                onClick={() => onChange(nudgeStep(steps, i, -1))}
                disabled={i === 0}
                aria-label={`Move step ${i + 1} earlier`}
                className="rounded px-1 text-xs text-zinc-500 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => onChange(nudgeStep(steps, i, 1))}
                disabled={i === steps.length - 1}
                aria-label={`Move step ${i + 1} later`}
                className="rounded px-1 text-xs text-zinc-500 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  onChange(removeStep(steps, i));
                  setExpanded(null);
                }}
                aria-label={`Remove step ${i + 1}`}
                className="rounded px-1 text-xs text-zinc-500 hover:bg-red-900/60 hover:text-red-200"
              >
                ×
              </button>
            </div>

            {open && (
              <div className="space-y-2 border-t border-zinc-800 p-2">
                <KeycodeSearch
                  value={step.code}
                  onPick={(code) => onChange(setStepCode(steps, i, code))}
                  limit={8}
                />

                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
                    Held with it
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ALL_MODS.map((m) => {
                      const active = !!step.mods?.includes(m);
                      return (
                        <label
                          key={m}
                          className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] ${
                            active
                              ? "bg-sky-800 text-sky-100"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={active}
                            onChange={() => onChange(toggleStepMod(steps, i, m))}
                          />
                          {modsShort([m])}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <span className="shrink-0">Delay after (ms)</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={step.delay ?? ""}
                    placeholder="none"
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      onChange(
                        setStepDelay(
                          steps,
                          i,
                          raw === "" ? null : Number(raw),
                        ),
                      );
                    }}
                    className="w-20 rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-xs text-zinc-100 outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
                  />
                  <span className="text-zinc-600">
                    blank = none; Oryx uses {DEFAULT_STEP_DELAY}
                  </span>
                </label>
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={add}
        className="w-full rounded bg-zinc-800 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
      >
        + Step
      </button>
    </div>
  );
}
