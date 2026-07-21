/**
 * Segmented control for the keycap display mode (Advanced / Mac / Windows).
 * Display-only: switching modes re-labels keycaps and never touches the layout.
 */
import {
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  type DisplayMode,
} from "../lib/display";
import { useDisplayStore } from "../state/displayStore";

export default function DisplayModeToggle() {
  const mode = useDisplayStore((s) => s.mode);
  const setMode = useDisplayStore((s) => s.setMode);

  return (
    <div
      className="flex overflow-hidden rounded-md border border-zinc-700"
      role="group"
      aria-label="Keycap display mode"
      title="How keycaps are labeled (display only — does not change the layout)"
    >
      {DISPLAY_MODES.map((m: DisplayMode) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            mode === m
              ? "bg-zinc-700 text-zinc-50"
              : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          {DISPLAY_MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
