import { useState } from "react";
import { OS_MODE_LABEL } from "../lib/labels";
import { findOsModeKeys } from "../lib/osSwap";
import { useLayoutStore } from "../state/layoutStore";
import type { OsTarget } from "../lib/types";

const OS_LABEL: Record<OsTarget, string> = { mac: "Mac", windows: "Windows" };

/**
 * `osDetection` / `osDefault`, plus the precedence rule in words.
 *
 * The rule is worth spelling out because three things can decide the board's
 * OS and they do not all last the same length of time: detection answers once
 * per connection, a manual key overrides it until you plug into a different
 * machine, and `osDefault` is what is assumed before anything has answered.
 * Getting that order wrong is how you end up with a keyboard that is briefly
 * the wrong OS every time you plug it in.
 */
export default function OsSettingsPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const setOsDetection = useLayoutStore((s) => s.setOsDetection);
  const setOsDefault = useLayoutStore((s) => s.setOsDefault);
  const [open, setOpen] = useState(false);

  if (!layout) return null;
  const { osDetection, osDefault } = layout.settings;
  const modeKeys = findOsModeKeys(layout);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        title="How the board decides which OS it is talking to"
      >
        <span aria-hidden>🖥</span>
        <span>
          {osDetection ? "Detect" : OS_LABEL[osDefault]}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <h3 className="text-sm font-semibold text-zinc-200">OS mode</h3>

          <label className="mt-2 flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={osDetection}
              onChange={(e) => setOsDetection(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              Detect the host
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Compiles in OS_DETECTION_ENABLE, so the board asks each machine
                what it is when you plug in.
              </span>
            </span>
          </label>

          <div className="mt-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Assume when unknown
            </div>
            <div className="flex gap-1">
              {(["windows", "mac"] as OsTarget[]).map((os) => (
                <button
                  key={os}
                  onClick={() => setOsDefault(os)}
                  aria-pressed={osDefault === os}
                  className={`flex-1 rounded px-2 py-1 text-xs ${
                    osDefault === os
                      ? "bg-sky-700 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {OS_LABEL[os]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">
              Also what this layout's plain Ctrl/Gui modifiers were written
              against, so it decides which way the Ctrl↔Cmd swap runs.
            </p>
          </div>

          <div className="mt-3 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Who wins
            </div>
            <ol className="list-inside list-decimal space-y-1 text-[11px] leading-snug text-zinc-400">
              <li>
                <span className="text-zinc-200">Detection wins on connect.</span>{" "}
                Whatever the host says it is, that is what the board becomes.
              </li>
              <li>
                <span className="text-zinc-200">
                  A manual OS key overrides it.
                </span>{" "}
                Press {OS_MODE_LABEL.mac} or {OS_MODE_LABEL.windows} and the
                board stays there, detection notwithstanding.
              </li>
              <li>
                <span className="text-zinc-200">
                  Moving machines drops the override.
                </span>{" "}
                When detection reports a <em>different</em> OS than last time,
                your manual choice is forgotten — it was about the old machine.{" "}
                {OS_MODE_LABEL.auto} drops it on demand.
              </li>
            </ol>
            <p className="mt-2 text-[11px] text-zinc-500">
              With detection off there is nothing to override:{" "}
              {OS_LABEL[osDefault]} until an OS key says otherwise.
            </p>
          </div>

          <div className="mt-3 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
            {modeKeys.length === 0 ? (
              <>
                No OS-mode key in this layout — assign one from the key picker's
                “OS mode” section to switch by hand.
              </>
            ) : (
              <>
                OS keys:{" "}
                {modeKeys
                  .map(
                    (k) =>
                      `${OS_MODE_LABEL[k.action] ?? k.action} (layer ${k.layer}, key ${k.index})`,
                  )
                  .join(", ")}
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
