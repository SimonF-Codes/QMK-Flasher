import { useMemo, useState } from "react";
import { ALL_MODS, modsShort, qmkToken, withGlow } from "../lib/labels";
import { useLayoutStore } from "../state/layoutStore";
import type { KeyAction } from "../lib/types";
import KeycodeSearch from "./KeycodeSearch";

type HoldMode = "mods" | "layer" | "keycode";

/** Tap + hold pickers; emits modTap / layerTap / dualFunc per the hold choice. */
export default function DualFunctionEditor({
  current,
  onApply,
  onClose,
}: {
  current: KeyAction;
  /** Where the result goes — a key, or the combo draft when that is open. */
  onApply(action: KeyAction): void;
  onClose(): void;
}) {
  const layout = useLayoutStore((s) => s.layout);

  const [tap, setTap] = useState(() => {
    if (current.kind === "modTap" || current.kind === "layerTap") return current.tap;
    if (current.kind === "dualFunc") return current.tap.code;
    if (current.kind === "basic") return current.code;
    return "KC_A";
  });
  const [holdMode, setHoldMode] = useState<HoldMode>(() => {
    if (current.kind === "layerTap") return "layer";
    if (current.kind === "dualFunc") return "keycode";
    return "mods";
  });
  const [mods, setMods] = useState<string[]>(() =>
    current.kind === "modTap" ? current.mods : ["MOD_LCTL"],
  );
  const [holdLayer, setHoldLayer] = useState(() =>
    current.kind === "layerTap" ? current.layer : 1,
  );
  const [holdCode, setHoldCode] = useState(() =>
    current.kind === "dualFunc" ? current.hold.code : "KC_LEFT",
  );

  const layerCount = layout?.layers.length ?? 1;

  const result: KeyAction | null = useMemo(() => {
    if (holdMode === "mods") {
      if (mods.length === 0) return null;
      return { kind: "modTap", mods, tap };
    }
    if (holdMode === "layer") {
      return { kind: "layerTap", layer: holdLayer, tap };
    }
    return { kind: "dualFunc", tap: { code: tap }, hold: { code: holdCode } };
  }, [holdMode, mods, tap, holdLayer, holdCode]);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Dual function</h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          Close
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tap
        </div>
        <KeycodeSearch value={tap} onPick={setTap} />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Hold
        </div>
        <div className="mb-2 flex gap-1">
          {(
            [
              ["mods", "Modifiers"],
              ["layer", "Layer"],
              ["keycode", "Keycode"],
            ] as [HoldMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setHoldMode(mode)}
              className={`rounded px-2 py-1 text-xs ${
                holdMode === mode
                  ? "bg-sky-700 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {holdMode === "mods" && (
          <div className="flex flex-wrap gap-1">
            {ALL_MODS.map((m) => (
              <label
                key={m}
                className={`cursor-pointer rounded px-2 py-1 text-xs ${
                  mods.includes(m)
                    ? "bg-sky-800 text-sky-100"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={mods.includes(m)}
                  onChange={(e) =>
                    setMods((prev) =>
                      e.target.checked
                        ? [...prev, m]
                        : prev.filter((x) => x !== m),
                    )
                  }
                />
                {modsShort([m])}
              </label>
            ))}
          </div>
        )}

        {holdMode === "layer" && (
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: layerCount }, (_, i) => (
              <button
                key={i}
                onClick={() => setHoldLayer(i)}
                className={`rounded px-2.5 py-1 text-xs ${
                  holdLayer === i
                    ? "bg-sky-700 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                L{i}
              </button>
            ))}
          </div>
        )}

        {holdMode === "keycode" && (
          <KeycodeSearch value={holdCode} onPick={setHoldCode} />
        )}
      </div>

      <div className="rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-emerald-400">
        {result ? qmkToken(result) : "— pick at least one modifier —"}
      </div>

      <button
        disabled={!result}
        onClick={() => {
          if (result) {
            onApply(withGlow(result, current));
            onClose();
          }
        }}
        className="w-full rounded bg-sky-600 py-1.5 text-sm font-medium text-white enabled:hover:bg-sky-500 disabled:opacity-40"
      >
        Apply
      </button>
    </div>
  );
}
