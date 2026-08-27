import { useMemo, useState } from "react";
import {
  RGB_EFFECTS,
  compiledEffects,
  costs,
  effectFor,
  effectLabel,
  respondsTo,
} from "../lib/rgbEffects";
import { useLayoutStore } from "../state/layoutStore";
import {
  REACTIVE_FADE_MS_MAX,
  REACTIVE_FADE_MS_MIN,
  type LightingMode,
} from "../lib/types";

/**
 * RGB Matrix effects: which one boots, what it costs, and — the decision this
 * panel exists for — whether the effect or the per-layer ledmap gets the board.
 *
 * The mode choice is the whole reason this is a panel and not a dropdown. The
 * two painters cannot share the LEDs: the generated `rgb_matrix_indicators_user()`
 * repaints every LED from the ledmap *after* the active effect has drawn its
 * frame, so an animation under the ledmap is not dimmed or blended, it is
 * invisible. Presenting the effect list without saying that would let someone
 * pick Splash, flash the board, and see the same static colors as before.
 *
 * "Colours + tap" is the third answer, and it is here because the list below
 * cannot give it. Every one of QMK's reactive effects renders through
 * `effect_runner_reactive`, which paints each LED from the single global
 * `rgb_matrix_config.hsv` — pick one and the whole board becomes one colour,
 * layout gone. Reactive mode keeps the ledmap and modulates only brightness.
 *
 * "Apply these on every boot" is here rather than being silently on because it
 * has a real cost. Without it the settings on this panel are inert on any board
 * that has ever been used, since QMK writes the firmware defaults to EEPROM
 * only when EEPROM has no mode stored; with it, a mode reached with `RGB_MOD`
 * does not survive a replug. That is a trade, and the trade is stated where it
 * is made.
 *
 * The cost line is here for the same reason. Reactive effects are gated on
 * `RGB_MATRIX_KEYPRESSES`, which makes the matrix scan record every hit —
 * firmware size and scan time. The Moonlander image is already ~73 KB against a
 * limited flash budget, so that is a thing to be told before a build, not after
 * one stops fitting.
 */
export default function LightingPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const setLightingEnabled = useLayoutStore((s) => s.setLightingEnabled);
  const patchLighting = useLayoutStore((s) => s.patchLighting);
  const setBootEffect = useLayoutStore((s) => s.setBootEffect);
  const toggleExtraEffect = useLayoutStore((s) => s.toggleExtraEffect);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const lighting = layout?.settings.lighting ?? null;
  const cost = useMemo(() => (lighting ? costs(lighting) : null), [lighting]);

  if (!layout) return null;

  const boot = lighting ? effectFor(lighting.effect) : undefined;
  const knobs = lighting
    ? respondsTo(lighting.effect)
    : { hue: false, speed: false };
  const chosen = lighting ? compiledEffects(lighting) : [];
  // Reactive effects first: they are what someone opening this panel came for,
  // and burying them under forty gradients makes the feature look absent.
  const listed = showAll
    ? RGB_EFFECTS
    : RGB_EFFECTS.filter((e) => e.reactive || chosen.includes(e.qmk));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        title="Reactive and animated RGB Matrix effects"
      >
        <span aria-hidden>✨</span>
        {lighting ? effectLabel(lighting.effect) : "Effects"}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-[32rem] w-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <h3 className="text-sm font-semibold text-zinc-200">
            RGB Matrix effects
          </h3>

          <label className="mt-2 flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={lighting !== null}
              onChange={(e) => setLightingEnabled(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              Configure RGB Matrix in this layout
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                Off means the firmware says nothing about effects at all — the
                per-layer colours light the board and QMK's own defaults sit
                underneath, which is what an Oryx layout does.
              </span>
            </span>
          </label>

          {lighting && (
            <>
              {/* ---- The choice ---- */}
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  What lights the board
                </div>
                <div className="flex gap-1">
                  {(
                    [
                      ["ledmap", "Layer colours"],
                      ["reactive", "Colours + tap"],
                      ["effect", effectLabel(lighting.effect)],
                    ] as [LightingMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => patchLighting({ mode })}
                      aria-pressed={lighting.mode === mode}
                      className={`flex-1 truncate rounded px-2 py-1 text-xs ${
                        lighting.mode === mode
                          ? "bg-sky-700 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">
                  {lighting.mode === "ledmap" ? (
                    <>
                      The ledmap repaints every LED after the effect has drawn
                      its frame, so the effect below is compiled in but{" "}
                      <span className="text-zinc-200">not visible</span>. A
                      TOGGLE_LAYER_COLOR key stops the repaint and reveals it.
                    </>
                  ) : lighting.mode === "reactive" ? (
                    <>
                      Your colours still light the board and the key you strike{" "}
                      <span className="text-zinc-200">
                        brightens, then fades back
                      </span>
                      . None of the reactive effects below can do this — they
                      all paint the whole board from one colour, so picking one
                      replaces your layout with a single hue. This scales the
                      brightness of your own ledmap instead.
                    </>
                  ) : (
                    <>
                      The effect owns the LEDs. No ledmap is generated at all,
                      so this layout's{" "}
                      <span className="text-zinc-200">
                        per-layer and per-key colours will not reach the board
                      </span>
                      . They stay in the layout, and switching back restores
                      them.
                    </>
                  )}
                </p>
              </div>

              {/* ---- The reactive knobs ---- */}
              {lighting.mode === "reactive" && (
                <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Tap response
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="w-20 shrink-0">Tap boost</span>
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={lighting.reactiveBoost}
                      aria-label="Tap boost"
                      onChange={(e) =>
                        patchLighting({
                          reactiveBoost: Number(e.target.value),
                        })
                      }
                      className="flex-1 accent-sky-600"
                    />
                    <span className="w-12 shrink-0 text-right font-mono">
                      {Math.round((lighting.reactiveBoost / 255) * 100)}%
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="w-20 shrink-0">Fade</span>
                    <input
                      type="range"
                      min={REACTIVE_FADE_MS_MIN}
                      max={REACTIVE_FADE_MS_MAX}
                      step={10}
                      value={lighting.reactiveFadeMs}
                      aria-label="Fade"
                      onChange={(e) =>
                        patchLighting({
                          reactiveFadeMs: Number(e.target.value),
                        })
                      }
                      className="flex-1 accent-sky-600"
                    />
                    <span className="w-12 shrink-0 text-right font-mono">
                      {lighting.reactiveFadeMs}ms
                    </span>
                  </label>
                  <p className="text-[11px] leading-snug text-zinc-500">
                    A tap goes{" "}
                    <span className="text-zinc-300">up to your colour</span>, not
                    past it — the board's brightness ceiling is already the
                    peak — so the boost is how far an untouched key sits{" "}
                    <em>below</em> it. At 100% unstruck keys are dark and only
                    what you type is lit.
                    {lighting.reactiveBoost === 0 && (
                      <>
                        {" "}
                        <span className="text-amber-400">
                          At 0% nothing moves
                        </span>{" "}
                        — this is the static ledmap with the hit tracker still
                        compiled in.
                      </>
                    )}{" "}
                    The board remembers 8 hits at a time (QMK's
                    LED_HITS_TO_REMEMBER); type a 9th inside the fade window and
                    the oldest key drops back to rest early instead of finishing
                    its fade. The colours are never affected.
                  </p>
                </div>
              )}

              {/* ---- Cost ---- */}
              {cost && (
                <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] leading-snug text-zinc-400">
                  <span className="text-zinc-300">
                    {cost.compiled} effect{cost.compiled === 1 ? "" : "s"}{" "}
                    compiled in.
                  </span>{" "}
                  {cost.keypresses ? (
                    <>
                      <span className="text-amber-400">
                        RGB_MATRIX_KEYPRESSES is on
                      </span>{" "}
                      because{" "}
                      {cost.reactiveLedmap ? (
                        <>
                          the ledmap reacts to taps
                          {cost.reactiveEffects.length > 0 &&
                            ` (and ${cost.reactiveEffects.map(effectLabel).join(", ")} would need it anyway)`}
                        </>
                      ) : (
                        <>
                          {cost.reactiveEffects.map(effectLabel).join(", ")}{" "}
                          {cost.reactiveEffects.length === 1 ? "is" : "are"}{" "}
                          reactive
                        </>
                      )}
                      : the matrix scan now records which key was hit and when.
                      That costs firmware size and scan time on every scan,
                      whether or not anything reactive is running.
                    </>
                  ) : (
                    "No reactive effect is compiled in, so the matrix scan is unchanged."
                  )}
                  {cost.framebuffer && (
                    <>
                      {" "}
                      <span className="text-amber-400">
                        RGB_MATRIX_FRAMEBUFFER_EFFECTS is on
                      </span>{" "}
                      for{" "}
                      {cost.framebufferEffects.map(effectLabel).join(", ")} —
                      QMK keeps a per-LED buffer between frames. That costs RAM.
                    </>
                  )}
                </div>
              )}

              {/* ---- Colour and speed ---- */}
              <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Starting colour and speed
                </div>
                {(
                  [
                    ["hue", "Hue", knobs.hue],
                    ["sat", "Saturation", true],
                    ["val", "Brightness", true],
                    ["speed", "Speed", knobs.speed],
                  ] as const
                ).map(([field, label, live]) => (
                  <label
                    key={field}
                    className={`flex items-center gap-2 text-xs ${
                      live ? "text-zinc-300" : "text-zinc-600"
                    }`}
                    title={
                      live
                        ? undefined
                        : `${boot?.label ?? lighting.effect} does not read this`
                    }
                  >
                    <span className="w-20 shrink-0">{label}</span>
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={lighting[field]}
                      disabled={!live}
                      aria-label={label}
                      onChange={(e) =>
                        patchLighting({ [field]: Number(e.target.value) })
                      }
                      className="flex-1 accent-sky-600 disabled:opacity-40"
                    />
                    <span className="w-8 shrink-0 text-right font-mono">
                      {lighting[field]}
                    </span>
                  </label>
                ))}
                <p className="text-[11px] leading-snug text-zinc-500">
                  {!knobs.hue &&
                    `${boot?.label ?? lighting.effect} sets its own hue, so that slider is disabled rather than pretending. `}
                  Brightness also dims the layer colours: the generated
                  set_layer_color scales every ledmap colour by it. The board
                  has its own ceiling — the firmware clamps to it, so past that
                  point the slider stops making a difference.
                </p>

                <label className="flex items-start gap-2 pt-1 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={lighting.applyOnBoot}
                    onChange={(e) =>
                      patchLighting({ applyOnBoot: e.target.checked })
                    }
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    Apply these on every boot
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                      {lighting.applyOnBoot ? (
                        <>
                          The firmware restates them at startup. Without this
                          they are{" "}
                          <span className="text-zinc-300">
                            inert on any board that has been used before
                          </span>
                          : QMK writes the firmware's defaults to EEPROM only
                          when EEPROM holds no mode at all, so the board keeps
                          the hue and brightness it was last left on and a
                          stored mode index points at a different effect after
                          each flash.{" "}
                          <span className="text-amber-400">
                            The cost: a mode you cycle to with an RGB_MOD key
                            will not survive a replug.
                          </span>
                        </>
                      ) : (
                        <>
                          A mode you cycle to on the board survives a replug —
                          and everything above{" "}
                          <span className="text-amber-400">
                            only reaches a board whose EEPROM has been cleared
                          </span>
                          . Bind QK_CLEAR_EEPROM to a key if you leave this off.
                        </>
                      )}
                    </span>
                  </span>
                </label>
              </div>

              {/* ---- The effect set ---- */}
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Effects
                  </span>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    {showAll
                      ? "Show reactive only"
                      : `Show all ${RGB_EFFECTS.length}`}
                  </button>
                </div>
                <p className="mb-2 text-[11px] leading-snug text-zinc-500">
                  ● boots. ○ is also compiled in, so an RGB_MOD key can cycle to
                  it. Everything unticked is #undef'd out of the build — the
                  board's own keyboard.json would otherwise compile all 48 in.
                </p>
                <ul className="space-y-0.5">
                  {listed.map((e) => {
                    const isBoot = e.qmk === lighting.effect;
                    const isExtra = lighting.extraEffects.includes(e.qmk);
                    return (
                      <li key={e.qmk}>
                        <div
                          className={`flex items-start gap-2 rounded px-1.5 py-1 ${
                            isBoot || isExtra ? "bg-zinc-800/60" : ""
                          }`}
                        >
                          <button
                            onClick={() => setBootEffect(e.qmk)}
                            aria-label={`Boot into ${e.label}`}
                            aria-pressed={isBoot}
                            title="Boot into this effect"
                            className={`mt-0.5 shrink-0 text-xs ${
                              isBoot
                                ? "text-sky-400"
                                : "text-zinc-600 hover:text-zinc-300"
                            }`}
                          >
                            {isBoot ? "●" : "○"}
                          </button>
                          <button
                            onClick={() =>
                              isBoot ? undefined : toggleExtraEffect(e.qmk)
                            }
                            className="min-w-0 flex-1 text-left"
                            title={
                              isBoot
                                ? "The boot effect is always compiled in"
                                : isExtra
                                  ? "Remove from the build"
                                  : "Also compile in"
                            }
                          >
                            <span
                              className={`text-xs ${
                                isBoot || isExtra
                                  ? "text-zinc-100"
                                  : "text-zinc-400"
                              }`}
                            >
                              {e.label}
                            </span>
                            {e.reactive && (
                              <span className="ml-1.5 rounded bg-amber-900/60 px-1 py-px text-[10px] text-amber-300">
                                reactive
                              </span>
                            )}
                            {e.framebuffer && (
                              <span className="ml-1.5 rounded bg-amber-900/60 px-1 py-px text-[10px] text-amber-300">
                                framebuffer
                              </span>
                            )}
                            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                              {e.blurb}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

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
