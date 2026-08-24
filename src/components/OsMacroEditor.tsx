import { useState } from "react";
import { withGlow } from "../lib/labels";
import { osMacroIssue, stepsOf, stepsSummary } from "../lib/macros";
import {
  NAV_PRESET_GROUPS,
  presetSteps,
  presetsInGroup,
  type NavPreset,
} from "../lib/navPresets";
import type { KeyAction, MacroStep } from "../lib/types";
import MacroStepList from "./MacroStepList";

/** The preset groups, collapsed; each preset fills both halves in one click. */
function PresetLibrary({ onPick }: { onPick(preset: NavPreset): void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {NAV_PRESET_GROUPS.map((group) => {
        const open = openGroup === group.id;
        const presets = presetsInGroup(group.id);
        return (
          <div key={group.id} className="rounded border border-zinc-800">
            <button
              onClick={() => setOpenGroup(open ? null : group.id)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <span>{group.title}</span>
              <span className="text-zinc-600">{open ? "−" : "+"}</span>
            </button>
            {open && (
              <div className="space-y-1 border-t border-zinc-800 p-2">
                <p className="text-[11px] text-zinc-500">{group.description}</p>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => onPick(preset)}
                    className="w-full rounded bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-sky-800"
                    title="Fills both sides and the label in one click"
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Editor for an `osMacro` key: two independent step lists, one per host OS,
 * with the board choosing at press time from its OS mode.
 *
 * The two halves are edited separately because the point of the key is that
 * they DIFFER — Windows wants Gui+Ctrl+→ for the next virtual desktop where
 * macOS wants Ctrl+→, a different number of modifiers, which no Ctrl↔Cmd swap
 * can produce. Either half may be left empty ("does nothing on that OS"); both
 * empty is refused here rather than by a failed save.
 */
export default function OsMacroEditor({
  current,
  onApply,
  onClose,
}: {
  current: KeyAction;
  /** Where the result goes — a key, or the combo draft when that is open. */
  onApply(action: KeyAction): void;
  onClose(): void;
}) {
  const [label, setLabel] = useState(() =>
    current.kind === "osMacro" ? current.label : "",
  );
  // Seeding both halves from a plain macro/basic key is the common way in:
  // you had a chord that works on one machine and want the other one too.
  const [mac, setMac] = useState<readonly MacroStep[]>(() =>
    current.kind === "osMacro" ? current.mac.slice() : stepsOf(current),
  );
  const [windows, setWindows] = useState<readonly MacroStep[]>(() =>
    current.kind === "osMacro" ? current.windows.slice() : stepsOf(current),
  );

  const issue = osMacroIssue(label, mac, windows);

  const applyPreset = (preset: NavPreset) => {
    const { mac: macSteps, windows: winSteps } = presetSteps(preset);
    setLabel(preset.label);
    setMac(macSteps);
    setWindows(winSteps);
  };

  const apply = () => {
    if (issue) return;
    onApply(
      withGlow(
        {
          kind: "osMacro",
          label,
          mac: mac.slice(),
          windows: windows.slice(),
        },
        current,
      ),
    );
    onClose();
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">OS macro</h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          Close
        </button>
      </div>

      <p className="text-[11px] leading-snug text-zinc-500">
        One key, a different sequence per machine. The board picks by its OS
        mode — set that with a QF_OS_* key or host detection.
      </p>

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Presets
        </div>
        <PresetLibrary onPick={applyPreset} />
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Label
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Desk →"
          className="w-full rounded bg-zinc-900 px-2 py-1 text-sm outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
        />
      </label>

      {/* Stacked rather than columns: the key picker is 320px wide, and two
          step lists side by side there would be unreadable. The headings and
          the summary line keep the pairing obvious. */}
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Mac
            </span>
            <span className="truncate pl-2 text-[11px] text-zinc-600">
              {stepsSummary(mac)}
            </span>
          </div>
          <MacroStepList
            steps={mac}
            onChange={setMac}
            emptyHint="Empty — this key does nothing on a Mac."
          />
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Windows
            </span>
            <span className="truncate pl-2 text-[11px] text-zinc-600">
              {stepsSummary(windows)}
            </span>
          </div>
          <MacroStepList
            steps={windows}
            onChange={setWindows}
            emptyHint="Empty — this key does nothing on Windows."
          />
        </div>
      </div>

      {issue && <p className="text-xs text-amber-400">{issue}</p>}

      <div className="flex gap-2">
        <button
          disabled={!!issue}
          onClick={apply}
          className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white enabled:hover:bg-sky-500 disabled:opacity-40"
        >
          Apply
        </button>
        {current.kind === "osMacro" && (
          <button
            onClick={() => {
              onApply(withGlow({ kind: "none" }, current));
              onClose();
            }}
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-red-900/60 hover:text-red-200"
            title="Clear this key"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
