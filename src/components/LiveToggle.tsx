/**
 * Header toggle for the live key view. Like DisplayModeToggle this is a pure UI
 * preference — turning it on never touches the layout or its dirty state.
 */
import { useLiveStore } from "../state/liveStore";

export default function LiveToggle() {
  const enabled = useLiveStore((s) => s.enabled);
  const setEnabled = useLiveStore((s) => s.setEnabled);

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      aria-pressed={enabled}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
        enabled
          ? "border-green-600 bg-green-900/40 text-green-200 hover:bg-green-900/60"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
      title="Live view: highlight keys as you press them and log what the firmware emits (display only — never changes the layout)"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          enabled ? "bg-green-400" : "bg-zinc-600"
        }`}
      />
      Live
    </button>
  );
}
