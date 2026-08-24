/**
 * OS-mode swap preview — the functional counterpart to DisplayModeToggle.
 *
 * DisplayModeToggle changes what a key is CALLED (⌘C vs Win+C, same keycode).
 * This changes what the preview says a key EMITS, modelling the board's
 * Ctrl↔Cmd swap. The two are deliberately separate controls because they are
 * separate things — and this one is bridged to reality: it stays disabled
 * until the board can actually reach the swapped state, since otherwise the
 * keycaps would show behavior you cannot produce.
 *
 * Since schema v3 there are three ways to reach it — a `CG_*` key, a
 * `QF_OS_*` key, or host detection — and which OS is "unswapped" comes from
 * `settings.osDefault` rather than a constant. Both live in `osSwap.ts`.
 */
import {
  authoredOs,
  canSwitchOs,
  findOsModeKeys,
  findOsSwitchKeys,
  osForSwapState,
} from "../lib/osSwap";
import { OS_MODE_LABEL } from "../lib/labels";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";

const OS_LABEL = { mac: "Mac", windows: "Windows" } as const;

export default function OsSwapToggle() {
  const layout = useLayoutStore((s) => s.layout);
  const swapped = useDisplayStore((s) => s.osSwapPreview);
  const setSwapped = useDisplayStore((s) => s.setOsSwapPreview);

  const enabled = canSwitchOs(layout);
  const current = osForSwapState(enabled && swapped, authoredOs(layout));

  // Lead with the index: layer titles are frequently all "Layer", so the
  // title alone would not identify which layer to press.
  const where = (layer: number, label: string) => {
    const t = layout?.layers[layer]?.title?.trim();
    const name = t && t !== "Layer" ? ` ${t}` : "";
    return `${label} on layer ${layer}${name}`;
  };
  const routes = [
    ...findOsSwitchKeys(layout).map((k) => where(k.layer, k.code)),
    ...findOsModeKeys(layout).map((k) =>
      where(k.layer, OS_MODE_LABEL[k.action] ?? k.action),
    ),
    ...(layout?.settings.osDetection ? ["host detection at plug-in"] : []),
  ].join(", ");

  const title = enabled
    ? `Previewing the board as ${OS_LABEL[current]}. It switches with: ${routes}`
    : "The board can never leave this OS — assign a QF_OS_* or CG_* key, or turn on host detection, to enable this preview.";

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
