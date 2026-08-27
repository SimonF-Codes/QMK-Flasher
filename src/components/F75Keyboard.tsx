/**
 * The AULA F75 key grid — read-only.
 *
 * Shares the SVG grid math with the Moonlander board (`keyRect`, `viewBoxOf`,
 * `U`) and nothing else. It deliberately does NOT reuse `Key.tsx`: that
 * component renders a `KeyAction` with layers, tap/hold, combos, LED glow and
 * live/trainer/tutorial state, none of which the F75 has. A slot on this board
 * is one HID page + usage, and pretending otherwise is the same class of bug
 * as showing capabilities the hardware lacks.
 */
import { keyRect, U, viewBoxOf } from "../lib/geometry";
import { f75KeyLabel, type F75LayerId } from "../lib/f75";
import type { F75Geometry, F75Key } from "../lib/types";

interface Props {
  geometry: F75Geometry;
  layer: F75LayerId;
  selectedSlot: number | null;
  onSelect: (slot: number | null) => void;
}

export default function F75Keyboard({
  geometry,
  layer,
  selectedSlot,
  onSelect,
}: Props) {
  const placed = geometry.keys.filter(
    (k): k is F75Key & { x: number; y: number; w: number; h: number } =>
      k.positioned && k.x !== undefined,
  );
  const locked = new Set(geometry.lockedSlots);

  return (
    <svg
      viewBox={viewBoxOf(placed)}
      className="mx-auto block min-h-0 w-full max-w-5xl flex-1"
      role="group"
      aria-label={`AULA F75 ${layer === "base" ? "base" : "FN1"} layer keys`}
    >
      {placed.map((k) => {
        const rect = keyRect(k);
        const isLocked = locked.has(k.slot);
        const selected = selectedSlot === k.slot;
        const label = f75KeyLabel(k, layer);
        return (
          <g
            key={k.slot}
            role="button"
            tabIndex={0}
            aria-label={`${k.label}${isLocked ? ", locked by firmware" : ""}`}
            aria-pressed={selected}
            className="cursor-pointer focus:outline-none"
            onClick={() => onSelect(selected ? null : k.slot)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(selected ? null : k.slot);
              }
            }}
          >
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              rx={U * 0.09}
              className={
                selected
                  ? "fill-sky-500/30 stroke-sky-400"
                  : isLocked
                    ? "fill-neutral-800/60 stroke-neutral-700"
                    : "fill-neutral-800 stroke-neutral-600 hover:stroke-neutral-400"
              }
              strokeWidth={2}
            />
            <text
              x={rect.x + rect.w / 2}
              y={rect.y + rect.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              // Long names on a 1u cap have to shrink or they overflow it.
              fontSize={label.length > 6 ? U * 0.17 : U * 0.24}
              className={isLocked ? "fill-neutral-500" : "fill-neutral-200"}
            >
              {label}
            </text>
            {isLocked && (
              // The board ignores writes to F1–F12, so they are marked rather
              // than silently accepting an edit that will never take effect.
              <text
                x={rect.x + rect.w - U * 0.12}
                y={rect.y + U * 0.2}
                textAnchor="end"
                fontSize={U * 0.16}
                className="fill-amber-500/80"
                aria-hidden="true"
              >
                🔒
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
