import { badge } from "../lib/labels";
import { keycapLabels, type DisplayMode } from "../lib/display";
import { keyRect } from "../lib/geometry";
import type { GeometryKey, KeyAction } from "../lib/types";

interface KeyProps {
  geo: GeometryKey;
  action: KeyAction;
  selected: boolean;
  /** This key is the anchor of an in-progress "swap with…". */
  swapSource?: boolean;
  /** A swap is in progress (this key is a candidate target). */
  swapTargeting?: boolean;
  /** Live view: this position is held down right now. */
  pressed?: boolean;
  /** Live view: released a moment ago, still glowing so fast taps register. */
  recent?: boolean;
  mode: DisplayMode;
  /**
   * Label this key as the board behaves with Ctrl↔Cmd swapped (OS mode).
   * Unrelated to swapSource/swapTargeting above, which are key-POSITION swaps.
   */
  osSwapped?: boolean;
  layerNames: readonly string[];
  onSelect(): void;
}

function fontSize(label: string, w: number): number {
  const base = label.length <= 2 ? 15 : label.length <= 4 ? 12 : 10;
  return Math.min(base, (w / Math.max(label.length, 1)) * 1.7);
}

export default function Key({
  geo,
  action,
  selected,
  swapSource = false,
  swapTargeting = false,
  pressed = false,
  recent = false,
  mode,
  osSwapped = false,
  layerNames,
  onSelect,
}: KeyProps) {
  const r = keyRect(geo);
  const { tap, hold } = keycapLabels(action, mode, layerNames, {
    swapped: osSwapped,
  });
  const b = badge(action);
  const transparent = action.kind === "transparent" || action.kind === "none";

  // Swap mode wins (it's a modal interaction), then live press state, then the
  // edit selection — so a key you're holding stays visible while editing.
  const rectClass = swapSource
    ? "fill-amber-900 stroke-amber-400"
    : swapTargeting
      ? "fill-zinc-800 stroke-amber-500/60 hover:fill-amber-900/40"
      : pressed
        ? "fill-green-600 stroke-green-300"
        : recent
          ? "fill-green-900 stroke-green-500/70"
          : selected
            ? "fill-sky-900 stroke-sky-400"
            : "fill-zinc-800 stroke-zinc-700 hover:fill-zinc-700";

  return (
    <g
      transform={r.transform}
      onClick={onSelect}
      className="cursor-pointer select-none"
      data-key-index={geo.led}
    >
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={6}
        className={rectClass}
        strokeWidth={selected || swapSource || pressed ? 2 : 1}
      />
      {action.glow && (
        <rect
          x={r.x + 4}
          y={r.y + 3}
          width={r.w - 8}
          height={3}
          rx={1.5}
          fill={action.glow}
        />
      )}
      <text
        x={r.x + r.w / 2}
        y={r.y + r.h / 2 + (hold ? -1 : 2)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={fontSize(tap, r.w)}
        className={transparent ? "fill-zinc-600" : "fill-zinc-100"}
      >
        {tap}
      </text>
      {hold && (
        <text
          x={r.x + r.w / 2}
          y={r.y + r.h - 6}
          textAnchor="middle"
          fontSize={8.5}
          className="fill-sky-300"
        >
          {hold}
        </text>
      )}
      {b && (
        <text
          x={r.x + r.w - 4}
          y={r.y + 11}
          textAnchor="end"
          fontSize={8}
          className="fill-amber-400"
        >
          {b}
        </text>
      )}
    </g>
  );
}
