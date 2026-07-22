import { useMemo, useState } from "react";
import {
  CATEGORY_ORDER,
  KEYCODES,
  searchKeycodes,
} from "../lib/keycodes";
import {
  ALL_MODS,
  isReadOnly,
  modsShort,
  qmkToken,
  withGlow,
} from "../lib/labels";
import { useLayoutStore } from "../state/layoutStore";
import type { KeyAction, KeycodeEntry, LayerSwitchAction } from "../lib/types";
import DualFunctionEditor from "./DualFunctionEditor";

const LAYER_ACTIONS: { action: LayerSwitchAction; hint: string }[] = [
  { action: "MO", hint: "momentary" },
  { action: "TG", hint: "toggle" },
  { action: "TO", hint: "switch to" },
  { action: "TT", hint: "tap-toggle" },
];

function actionForEntry(e: KeycodeEntry, prev: KeyAction): KeyAction {
  if (e.qmk === "KC_NO") return withGlow({ kind: "none" }, prev);
  if (e.qmk === "KC_TRANSPARENT") return withGlow({ kind: "transparent" }, prev);
  if (e.qmk === "QK_LOCK") return withGlow({ kind: "qkLock" }, prev);
  if (e.category === "rgb") return withGlow({ kind: "rgb", code: e.qmk }, prev);
  if (e.category === "special")
    return withGlow({ kind: "special", code: e.qmk }, prev);
  return withGlow({ kind: "basic", code: e.qmk }, prev);
}

function KeycodeButton({
  entry,
  onPick,
}: {
  entry: KeycodeEntry;
  onPick(e: KeycodeEntry): void;
}) {
  return (
    <button
      onClick={() => onPick(entry)}
      title={`${entry.longLabel} (${entry.qmk})`}
      className="min-w-9 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 hover:bg-sky-700"
    >
      {entry.label || "∅"}
    </button>
  );
}

export default function KeyPicker() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const swapSource = useLayoutStore((s) => s.swapSource);
  const setKeyAction = useLayoutStore((s) => s.setKeyAction);
  const beginSwap = useLayoutStore((s) => s.beginSwap);
  const cancelSwap = useLayoutStore((s) => s.cancelSwap);

  const [query, setQuery] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>("letter");
  const [dualOpen, setDualOpen] = useState(false);

  const current =
    layout && selectedKey !== null
      ? layout.layers[selectedLayer]?.keys[selectedKey]
      : null;

  const results = useMemo(() => searchKeycodes(query).slice(0, 30), [query]);
  const byCategory = useMemo(() => {
    const m = new Map<string, KeycodeEntry[]>();
    for (const e of KEYCODES) {
      const list = m.get(e.category) ?? [];
      list.push(e);
      m.set(e.category, list);
    }
    return m;
  }, []);

  if (!layout || selectedKey === null || !current) return null;

  const pick = (e: KeycodeEntry) => setKeyAction(actionForEntry(e, current));

  const modsEditable = current.kind === "basic";

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800 p-3">
      <header>
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          Key {selectedKey} · layer {selectedLayer}
        </div>
        <div className="mt-1 rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-emerald-400">
          {qmkToken(current)}
        </div>
        {isReadOnly(current) && (
          <p className="mt-1 text-xs text-amber-400">
            Read-only in v1 (from Oryx) — picking a new code replaces it.
          </p>
        )}
      </header>

      {swapSource !== null ? (
        <section className="rounded border border-amber-500/50 bg-amber-950/30 p-3">
          <p className="text-sm text-amber-200">
            Swapping key <span className="font-semibold">{swapSource}</span> —
            click another key to swap it with.
          </p>
          <button
            onClick={() => cancelSwap()}
            className="mt-2 w-full rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Cancel swap
          </button>
        </section>
      ) : (
        <>
          <button
            onClick={() => beginSwap(selectedKey)}
            className="rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
            title="Swap this key's action with another key on this layer"
          >
            ⇄ Swap with…
          </button>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all keycodes…"
            className="w-full rounded bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
          />

          {query ? (
        <div className="flex flex-wrap gap-1">
          {results.map((e) => (
            <KeycodeButton key={e.qmk} entry={e} onPick={pick} />
          ))}
          {results.length === 0 && (
            <p className="text-xs text-zinc-500">No matches.</p>
          )}
        </div>
      ) : (
        <>
          {modsEditable && (
            <section>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Modifiers on tap
              </div>
              <div className="flex flex-wrap gap-1">
                {ALL_MODS.map((m) => {
                  const active =
                    current.kind === "basic" && current.mods?.includes(m);
                  return (
                    <label
                      key={m}
                      className={`cursor-pointer rounded px-2 py-1 text-xs ${
                        active
                          ? "bg-sky-800 text-sky-100"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={!!active}
                        onChange={(e) => {
                          if (current.kind !== "basic") return;
                          const prev = current.mods ?? [];
                          const mods = e.target.checked
                            ? [...prev, m]
                            : prev.filter((x) => x !== m);
                          setKeyAction({
                            ...current,
                            mods: mods.length ? mods : undefined,
                          });
                        }}
                      />
                      {modsShort([m])}
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Layers
            </div>
            <div className="space-y-1">
              {LAYER_ACTIONS.map(({ action, hint }) => (
                <div key={action} className="flex items-center gap-1">
                  <span
                    className="w-8 text-xs text-zinc-500"
                    title={hint}
                  >
                    {action}
                  </span>
                  {layout.layers.map((_, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        setKeyAction(
                          withGlow(
                            { kind: "layerSwitch", action, layer: i },
                            current,
                          ),
                        )
                      }
                      className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-sky-700"
                    >
                      {i}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <button
              onClick={() => setDualOpen((v) => !v)}
              className="w-full rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              Dual function (tap / hold)…
            </button>
            {dualOpen && (
              <div className="mt-2">
                <DualFunctionEditor
                  current={current}
                  onClose={() => setDualOpen(false)}
                />
              </div>
            )}
          </section>

          <section className="space-y-1">
            {CATEGORY_ORDER.map(({ id, title }) => {
              const entries = byCategory.get(id);
              if (!entries?.length) return null;
              const open = openCategory === id;
              return (
                <div key={id} className="rounded border border-zinc-800">
                  <button
                    onClick={() => setOpenCategory(open ? null : id)}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    <span>{title}</span>
                    <span className="text-xs text-zinc-600">
                      {open ? "−" : "+"}
                    </span>
                  </button>
                  {open && (
                    <div className="flex flex-wrap gap-1 p-2">
                      {entries.map((e) => (
                        <KeycodeButton key={e.qmk} entry={e} onPick={pick} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}
        </>
      )}
    </aside>
  );
}
