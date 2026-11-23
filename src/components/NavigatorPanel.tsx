import { useState } from "react";
import { longLabelFor } from "../lib/keycodes";
import {
  findNavigatorKeys,
  isExactRotation,
  normalizeRotation,
  rotatedUp,
  upLandsAt,
} from "../lib/navigator";
import {
  NAVIGATOR_CPI_MAX,
  NAVIGATOR_CPI_MIN,
  NAVIGATOR_CPI_TICK,
  NAVIGATOR_FACTOR_MAX,
  NAVIGATOR_SCROLL_ACCELERATION_MAX,
  NAVIGATOR_SCROLL_DIVIDER_MAX,
  NAVIGATOR_SCROLL_MAX_SPEED_MAX,
  NAVIGATOR_SCROLL_MAX_SPEED_MIN,
  type NavigatorTrackball,
} from "../lib/types";
import { useLayoutStore } from "../state/layoutStore";

/** Clamp to [min, max] and snap to `step` — a field can never hold a value
 *  the schema would refuse at save time. */
function fit(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const snapped = Math.round(v / step) * step;
  // Floating steps (0.1) leave 1.2000000000000002 behind; trim it.
  const clean = Number(snapped.toFixed(step < 1 ? 2 : 0));
  return Math.min(max, Math.max(min, clean));
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
}) {
  // A draft while typing, committed (clamped and snapped) on blur or Enter:
  // clamping per keystroke would turn the "6" of "60" into 5 before the "0".
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(v)) onChange(fit(v, min, max, step));
  };
  return (
    <label className="mt-2 block text-sm text-zinc-300">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <input
          type="number"
          value={draft ?? value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-right text-xs text-zinc-200"
        />
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
        {hint}
      </span>
    </label>
  );
}

/**
 * The arrow is the roll that moves the pointer straight up at 0°, drawn where
 * the module will now send it. The faint arrow is where it went before.
 */
function RotationPreview({ deg }: { deg: number }) {
  const v = rotatedUp(deg);
  const r = 26;
  return (
    <svg
      viewBox="-40 -40 80 80"
      className="h-20 w-20 shrink-0"
      role="img"
      aria-label={`A roll that moved the pointer up now moves it ${upLandsAt(deg)}`}
    >
      <circle r="34" className="fill-zinc-950 stroke-zinc-700" strokeWidth="1.5" />
      <line x1="0" y1="0" x2="0" y2={-r} className="stroke-zinc-700" strokeWidth="2" />
      <line
        x1="0"
        y1="0"
        x2={v.x * r}
        y2={v.y * r}
        className="stroke-sky-400"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={v.x * r} cy={v.y * r} r="4" className="fill-sky-400" />
      <circle r="3" className="fill-zinc-500" />
    </svg>
  );
}

/**
 * `settings.navigatorTrackball`: whether a ZSA Navigator trackball is attached,
 * which way it is mounted, and how the pointer and drag-scroll feel.
 *
 * Rotation leads because it is the knob that changes with every printed
 * shell, and the one a wrong value makes most obviously wrong. It is raw
 * degrees by decision — the module's own `NAVIGATOR_TRACKBALL_ROTATION` — with
 * a preview of where "up" lands rather than named presets.
 *
 * This panel never edits the keymap. Clicks are the ordinary Mouse keys (the
 * Moonlander builds with mousekeys on), and the module's own keys are placed
 * from the key picker like any other.
 */
export default function NavigatorPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const setEnabled = useLayoutStore((s) => s.setNavigatorEnabled);
  const patch = useLayoutStore((s) => s.patchNavigator);
  const [open, setOpen] = useState(false);

  if (!layout) return null;
  const nav = layout.settings.navigatorTrackball;
  const keys = findNavigatorKeys(layout);
  const set = (p: Partial<NavigatorTrackball>) => patch(p);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        title="ZSA Navigator trackball: attach, rotation, pointer speed"
      >
        <span aria-hidden>🖲</span>
        <span>{nav ? `Trackball ${nav.rotation}°` : "No trackball"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <h3 className="text-sm font-semibold text-zinc-200">
            Navigator trackball
          </h3>

          <label className="mt-2 flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={!!nav}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              A trackball is attached
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Compiles in ZSA's zsa/navigator_trackball module, which brings
                its own pointing-device driver and I2C. Off, the firmware is
                exactly what it was without it.
              </span>
            </span>
          </label>

          {nav && (
            <>
              <div className="mt-3 border-t border-zinc-800 pt-2">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Rotation
                </div>
                <div className="flex items-center gap-3">
                  <RotationPreview deg={nav.rotation} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          set({ rotation: normalizeRotation(nav.rotation - 90) })
                        }
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
                        title="Rotate 90° counter-clockwise"
                      >
                        ↺90
                      </button>
                      <input
                        type="number"
                        value={nav.rotation}
                        min={0}
                        max={359}
                        step={1}
                        onChange={(e) =>
                          set({ rotation: normalizeRotation(Number(e.target.value) || 0) })
                        }
                        className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-right text-xs text-zinc-200"
                        aria-label="Rotation in degrees"
                      />
                      <span className="text-xs text-zinc-500">°</span>
                      <button
                        onClick={() =>
                          set({ rotation: normalizeRotation(nav.rotation + 90) })
                        }
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
                        title="Rotate 90° clockwise"
                      >
                        ↻90
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={nav.rotation}
                      onChange={(e) => set({ rotation: Number(e.target.value) })}
                      className="mt-1 w-full"
                      aria-label="Rotation slider"
                    />
                  </div>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                  A roll that moved the pointer <span className="text-zinc-300">up</span>{" "}
                  at 0° now moves it{" "}
                  <span className="text-sky-300">{upLandsAt(nav.rotation)}</span>{" "}
                  — the module turns motion clockwise by this many degrees.{" "}
                  {isExactRotation(nav.rotation)
                    ? "A quarter turn is an exact axis swap."
                    : "Off the quarter turns it is a float rotation, fixed at compile time."}{" "}
                  Note which number goes with which shell; a reflash applies it.
                </p>
              </div>

              <div className="mt-3 border-t border-zinc-800 pt-2">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Pointer
                </div>
                <NumberField
                  label="Speed (CPI)"
                  hint={`Where the board boots. The CPI keys step by ${NAVIGATOR_CPI_TICK}; the module caps it at ${NAVIGATOR_CPI_MAX}.`}
                  value={nav.cpi}
                  min={NAVIGATOR_CPI_MIN}
                  max={NAVIGATOR_CPI_MAX}
                  step={NAVIGATOR_CPI_TICK}
                  onChange={(cpi) => set({ cpi })}
                />
                <NumberField
                  label="Turbo ×"
                  hint="Holding or toggling Turbo multiplies motion by this."
                  value={nav.turboMultiplier}
                  min={1}
                  max={NAVIGATOR_FACTOR_MAX}
                  step={1}
                  onChange={(turboMultiplier) => set({ turboMultiplier })}
                />
                <NumberField
                  label="Aim ÷"
                  hint="Holding or toggling Aim divides motion by this, for precision."
                  value={nav.aimDivider}
                  min={1}
                  max={NAVIGATOR_FACTOR_MAX}
                  step={1}
                  onChange={(aimDivider) => set({ aimDivider })}
                />
              </div>

              <div className="mt-3 border-t border-zinc-800 pt-2">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Drag scroll
                </div>
                <NumberField
                  label="Divider"
                  hint="Ball travel per scroll step. Lower scrolls faster."
                  value={nav.scrollDivider}
                  min={1}
                  max={NAVIGATOR_SCROLL_DIVIDER_MAX}
                  step={1}
                  onChange={(scrollDivider) => set({ scrollDivider })}
                />
                <NumberField
                  label="Acceleration"
                  hint="How much a fast flick speeds scrolling up."
                  value={nav.scrollAcceleration}
                  min={0}
                  max={NAVIGATOR_SCROLL_ACCELERATION_MAX}
                  step={0.1}
                  onChange={(scrollAcceleration) => set({ scrollAcceleration })}
                />
                <NumberField
                  label="Max speed"
                  hint="The most one scroll report can move."
                  value={nav.scrollMaxSpeed}
                  min={NAVIGATOR_SCROLL_MAX_SPEED_MIN}
                  max={NAVIGATOR_SCROLL_MAX_SPEED_MAX}
                  step={0.5}
                  onChange={(scrollMaxSpeed) => set({ scrollMaxSpeed })}
                />
                <div className="mt-2 flex gap-4 text-sm text-zinc-300">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={nav.scrollInvertX}
                      onChange={(e) => set({ scrollInvertX: e.target.checked })}
                    />
                    Invert sideways
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={nav.scrollInvertY}
                      onChange={(e) => set({ scrollInvertY: e.target.checked })}
                    />
                    Invert vertical
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="mt-3 border-t border-zinc-800 pt-2 text-[11px] leading-snug text-zinc-500">
            {keys.length === 0 ? (
              <>
                No trackball keys in this layout. Clicks are the ordinary Mouse
                keys (Btn1…); Turbo, Aim and drag scroll are in the key picker's
                “Navigator trackball” section.
              </>
            ) : (
              <>
                {!nav && (
                  <span className="mb-1 block text-amber-400">
                    These keys do nothing until a trackball is attached.
                  </span>
                )}
                Trackball keys:{" "}
                {keys
                  .map((k) => `${longLabelFor(k.code).replace(/^Trackball: /, "")} (layer ${k.layer}, key ${k.index})`)
                  .join("; ")}
              </>
            )}
          </div>

          <div className="mt-3 flex justify-end border-t border-zinc-800 pt-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
