/**
 * Macro step lists — the editing model shared by `macro` (one list) and
 * `osMacro` (one list per host OS).
 *
 * Every transform returns the INPUT array unchanged when the edit is a no-op
 * or out of range: the same identity contract `led.ts` uses, which
 * `layoutStore` keys off so a rejected edit never marks the layout dirty.
 *
 * For the same reason nothing here rebuilds a step it was not asked to
 * change, and edits are applied by spreading the existing object rather than
 * constructing a new one. A macro seeded from Oryx and left alone must
 * serialize back byte for byte — `isDirty()` compares JSON text, so even
 * reordering a step's keys would read as an edit.
 */
import { labelFor } from "./keycodes";
import { modsShort } from "./labels";
import type { KeyAction, MacroStep } from "./types";

/**
 * The inter-step delay Oryx emits, reused for steps added here so a macro
 * that gains a step stays uniform with the ones it arrived with.
 */
export const DEFAULT_STEP_DELAY = 100;

/** A fresh step, ready to have its keycode picked. */
export function newStep(code = "KC_A"): MacroStep {
  return { code, delay: DEFAULT_STEP_DELAY };
}

/** `steps` with `step` appended. */
export function appendStep(
  steps: readonly MacroStep[],
  step: MacroStep = newStep(),
): MacroStep[] {
  return [...steps, step];
}

/** `steps` without the one at `index` (unchanged if out of range). */
export function removeStep(
  steps: readonly MacroStep[],
  index: number,
): readonly MacroStep[] {
  if (index < 0 || index >= steps.length) return steps;
  return steps.filter((_, i) => i !== index);
}

/**
 * Move a step to another slot, sliding the ones in between. Reordering is the
 * whole point of an ordered step list, so it is a first-class operation rather
 * than remove+insert at the call site.
 */
export function moveStep(
  steps: readonly MacroStep[],
  from: number,
  to: number,
): readonly MacroStep[] {
  if (from === to) return steps;
  if (from < 0 || from >= steps.length) return steps;
  if (to < 0 || to >= steps.length) return steps;
  const next = steps.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move a step one slot earlier/later; a no-op at either end. */
export function nudgeStep(
  steps: readonly MacroStep[],
  index: number,
  delta: -1 | 1,
): readonly MacroStep[] {
  return moveStep(steps, index, index + delta);
}

/** Replace one step's keycode. */
export function setStepCode(
  steps: readonly MacroStep[],
  index: number,
  code: string,
): readonly MacroStep[] {
  const step = steps[index];
  if (!step || !code || step.code === code) return steps;
  return steps.map((s, i) => (i === index ? { ...s, code } : s));
}

/** A copy of `step` carrying `mods`, with the field dropped when empty. */
function withMods(step: MacroStep, mods: string[]): MacroStep {
  if (mods.length === 0) {
    const { mods: _dropped, ...rest } = step;
    return rest;
  }
  return { ...step, mods };
}

/** Add or remove one modifier on a step. */
export function toggleStepMod(
  steps: readonly MacroStep[],
  index: number,
  mod: string,
): readonly MacroStep[] {
  const step = steps[index];
  if (!step) return steps;
  const current = step.mods ?? [];
  const mods = current.includes(mod)
    ? current.filter((m) => m !== mod)
    : [...current, mod];
  return steps.map((s, i) => (i === index ? withMods(s, mods) : s));
}

/**
 * Set a step's delay, or drop it (null) so the firmware uses its default.
 * Negative and non-integer values are rejected rather than clamped — the
 * schema takes a non-negative integer and a silent clamp would hide a typo.
 */
export function setStepDelay(
  steps: readonly MacroStep[],
  index: number,
  delay: number | null,
): readonly MacroStep[] {
  const step = steps[index];
  if (!step) return steps;
  if (delay !== null && (!Number.isInteger(delay) || delay < 0)) return steps;
  if ((step.delay ?? null) === delay) return steps;
  return steps.map((s, i) => {
    if (i !== index) return s;
    if (delay === null) {
      const { delay: _dropped, ...rest } = s;
      return rest;
    }
    return { ...s, delay };
  });
}

// ---- Display ----

/** One step as a chord: "Ctrl+Shift+5". */
export function stepLabel(step: MacroStep): string {
  const base = labelFor(step.code);
  return step.mods?.length ? `${modsShort(step.mods)}+${base}` : base;
}

/** The whole list as a sentence-ish summary, elided past `max` steps. */
export function stepsSummary(steps: readonly MacroStep[], max = 6): string {
  if (steps.length === 0) return "—";
  const shown = steps.slice(0, max).map(stepLabel).join(" · ");
  return steps.length > max ? `${shown} · +${steps.length - max}` : shown;
}

// ---- Validation ----

/**
 * Why this `macro` cannot be saved, or null. The schema allows an empty label
 * (Oryx macros do not always carry one) but an empty step list makes a key
 * that does nothing, which is `none` written the long way.
 */
export function macroIssue(steps: readonly MacroStep[]): string | null {
  if (steps.length === 0) return "A macro needs at least one step.";
  return null;
}

/**
 * Why this `osMacro` cannot be saved, or null. Either half may be empty —
 * that means "this key does nothing on that OS" — but both empty is a
 * validation error in the Rust validator, so the editor refuses it first.
 * The label is required because it is the only keycap text the key has.
 */
export function osMacroIssue(
  label: string,
  mac: readonly MacroStep[],
  windows: readonly MacroStep[],
): string | null {
  if (!label.trim()) return "Give it a label — that is what the keycap shows.";
  if (mac.length === 0 && windows.length === 0) {
    return "At least one side needs a step; a key that does nothing on either machine is rejected.";
  }
  return null;
}

// ---- Reading an action back into the editor ----

/** The step list to open a macro editor on, for any starting action. */
export function stepsOf(action: KeyAction): MacroStep[] {
  if (action.kind === "macro") return action.steps.slice();
  // A basic key is the obvious seed for a one-step macro: you were looking at
  // it and decided it should send more than one thing.
  if (action.kind === "basic") {
    return [{ code: action.code, ...(action.mods ? { mods: action.mods } : {}) }];
  }
  return [];
}

/** A sensible starting label when turning some other action into a macro. */
export function labelOf(action: KeyAction): string {
  if (action.kind === "macro" || action.kind === "osMacro") return action.label;
  return "";
}
