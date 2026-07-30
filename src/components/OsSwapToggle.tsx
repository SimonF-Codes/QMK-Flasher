/**
 * OS-mode swap preview — the functional counterpart to DisplayModeToggle.
 *
 * DisplayModeToggle changes what a key is CALLED (⌘C vs Win+C, same keycode).
 * This changes what the preview says a key EMITS, modelling the board's
 * Ctrl↔Cmd swap. The two are deliberately separate controls because they are
 * separate things — and this one is bridged to reality: it stays disabled
 * until the layout actually contains a CG_* key, since without one the board
 * can never enter the swapped state.
 */
import { osForSwapState, findOsSwitchKeys } from "../lib/osSwap";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";

const OS_LABEL = { mac: "Mac", windows: "Windows" } as const;

export default function OsSwapToggle() {
  const layout = useLayoutStore((s) => s.layout);
  const swapped = useDisplayStore((s) => s.osSwapPreview);
  const setSwapped = useDisplayStore((s) => s.setOsSwapPreview);

  const switchKeys = findOsSwitchKeys(layout);
  const enabled = switchKeys.length > 0;
  const current = osForSwapState(enabled && swapped);

  // Lead with the index: layer titles are frequently all "Layer", so the
  // title alone would not identify which layer to press.
  const where = switchKeys
    .map((k) => {
      const t = layout?.layers[k.layer]?.title?.trim();
      const name = t && t !== "Layer" ? ` ${t}` : "";
      return `${k.code} on layer ${k.layer}${name}`;
    })
    .join(", ");

  const title = enabled
    ? `Previewing the board as ${OS_LABEL[current]}. Switch it on the keyboard with: ${where}`
    : "No OS-switch key in this layout — assign CG_TOGG (OS mode section) to a key to enable this preview.";

  return (
    <button
      onClick={() => enabled && setSwapped(!swapped)}
      disabled={!enabled}
      aria-pressed={enabled && swapped}
      title={title}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
        enabled
          ? swapped
            ? "border-sky-700 bg-sky-900/50 text-sky-200 hover:bg-sky-900/70"
            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          : "cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-600"
      }`}
    >
      <span aria-hidden>⌃⇄⌘</span>
      <span>{enabled ? OS_LABEL[current] : "No OS key"}</span>
    </button>
  );
}
