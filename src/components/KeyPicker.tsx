import { useMemo, useState } from "react";
import { keycapLabels } from "../lib/display";
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
import { useClipboardStore } from "../state/clipboardStore";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";
import type {
  KeyAction,
  KeycodeEntry,
  LayerSwitchAction,
  OsModeAction,
} from "../lib/types";
import DualFunctionEditor from "./DualFunctionEditor";
import KeyGlowEditor from "./KeyGlowEditor";
import MacroEditor from "./MacroEditor";
import OsMacroEditor from "./OsMacroEditor";

const LAYER_ACTIONS: { action: LayerSwitchAction; hint: string }[] = [
  { action: "MO", hint: "momentary" },
  { action: "TG", hint: "toggle" },
  { action: "TO", hint: "switch to" },
  { action: "TT", hint: "tap-toggle" },
];

/**
 * The four QF_OS_* catalog entries are the schema's `osMode` kind, not
 * `special` codes: they drive both the Ctrl↔Cmd swap AND which half of every
 * osMacro fires, so the layout has to know that is what the key means. The
 * older CG_* keys in the same category stay `special` — they move the swap
 * only, and `osSwap.ts` still models them.
 */
const OS_MODE_BY_CODE: Record<string, OsModeAction> = {
  QF_OS_TOGG: "toggle",
  QF_OS_MAC: "mac",
  QF_OS_WIN: "windows",
  QF_OS_AUTO: "auto",
};

function actionForEntry(e: KeycodeEntry, prev: KeyAction): KeyAction {
  if (e.qmk === "KC_NO") return withGlow({ kind: "none" }, prev);
  if (e.qmk === "KC_TRANSPARENT") return withGlow({ kind: "transparent" }, prev);
  if (e.qmk === "QK_LOCK") return withGlow({ kind: "qkLock" }, prev);
  const osMode = OS_MODE_BY_CODE[e.qmk];
  if (osMode) return withGlow({ kind: "osMode", action: osMode }, prev);
  if (e.category === "rgb") return withGlow({ kind: "rgb", code: e.qmk }, prev);
  // Navigator keys are the trackball module's own custom keycodes (declared
  // by zsa/defaults), not HID usages: no mods, no tap half, emitted verbatim.
  if (
    e.category === "special" ||
    e.category === "osmode" ||
    e.category === "navigator"
  )
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
  const comboEditor = useLayoutStore((s) => s.comboEditor);
  const setKeyActionInLayout = useLayoutStore((s) => s.setKeyAction);
  const setComboDraftAction = useLayoutStore((s) => s.setComboDraftAction);
  const beginSwap = useLayoutStore((s) => s.beginSwap);
  const cancelSwap = useLayoutStore((s) => s.cancelSwap);
  const clipboard = useClipboardStore((s) => s.action);
  const copyKey = useClipboardStore((s) => s.copySelectedKey);
  const pasteKey = useClipboardStore((s) => s.pasteToSelectedKey);
  const mode = useDisplayStore((s) => s.mode);

  const [query, setQuery] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>("letter");
  const [dualOpen, setDualOpen] = useState(false);
  const [macroOpen, setMacroOpen] = useState(false);
  const [osMacroOpen, setOsMacroOpen] = useState(false);

  // While the combo editor is open the picker edits the COMBO's action rather
  // than a key's: same catalog, same editors, different destination. Reusing
  // it is the point — a combo fires an ordinary KeyAction, so it should be
  // picked the ordinary way.
  const editingCombo = comboEditor !== null;
  const setKeyAction = editingCombo ? setComboDraftAction : setKeyActionInLayout;
  const current = editingCombo
    ? comboEditor.combo.action
    : layout && selectedKey !== null
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

  if (!layout || !current) return null;
  if (!editingCombo && selectedKey === null) return null;
  /** Non-null exactly when the panel is editing a key rather than a combo. */
  const keyIndex = editingCombo ? null : selectedKey;

  const pick = (e: KeycodeEntry) => setKeyAction(actionForEntry(e, current));

  // Describe the clipboard with the same labeller the keycaps use, so what the
  // chip says matches what you'll see on the board after pasting.
  const clipLabel = (() => {
    if (!clipboard) return null;
    const { tap, hold } = keycapLabels(
      clipboard,
      mode,
      layout.layers.map((l) => l.title),
    );
    return [tap || "∅", hold].filter(Boolean).join(" / ");
  })();

  const modsEditable = current.kind === "basic";

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800 p-3">
      <header>
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          {editingCombo
            ? `Combo action · ${comboEditor.combo.name || "unnamed"}`
            : `Key ${selectedKey} · layer ${selectedLayer}`}
        </div>
        <div className="mt-1 rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-emerald-400">
          {qmkToken(current)}
        </div>
        {isReadOnly(current) && (
          <p className="mt-1 text-xs text-amber-400">
            Read-only (from Oryx) — picking a new code replaces it.
          </p>
        )}
      </header>

      {editingCombo && (
        <p className="rounded border border-sky-800/60 bg-sky-950/30 px-2 py-1.5 text-xs text-sky-200">
          Picking what the combo fires. Its trigger keys are chosen on the
          board, below.
        </p>
      )}

      {!editingCombo && swapSource !== null ? (
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
          {/* Swap, copy/paste and the LED override are all properties of a key
              POSITION. A combo has no position, so while its action is being
              picked these drop out and the panel is just the catalog. */}
          {!editingCombo && keyIndex !== null && (
            <>
              <button
                onClick={() => beginSwap(keyIndex)}
                className="rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                title="Swap this key's action with another key on this layer"
              >
                ⇄ Swap with…
              </button>

              {/* Copy/paste sits with Swap: all three move an action around the
                  board. Unlike Swap, the clipboard outlives the layer you copied
                  from, so the chip below says what it is holding. */}
              <section className="space-y-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => copyKey()}
                    className="flex-1 rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                    title="Copy this key's action (Ctrl+C)"
                  >
                    ⧉ Copy
                  </button>
                  <button
                    onClick={() => pasteKey()}
                    disabled={!clipboard}
                    className="flex-1 rounded bg-zinc-800 py-1.5 text-sm text-zinc-200 enabled:hover:bg-zinc-700 disabled:opacity-40"
                    title={
                      clipLabel
                        ? `Paste ${clipLabel} onto this key (Ctrl+V)`
                        : "Nothing copied yet (Ctrl+V)"
                    }
                  >
                    ⎗ Paste
                  </button>
                </div>
                {clipLabel ? (
                  <p className="text-xs text-zinc-500">
                    Clipboard:{" "}
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-200">
                      {clipLabel}
                    </span>{" "}
                    — pastes onto any key, on any layer.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-600">Clipboard empty.</p>
                )}
              </section>

              <KeyGlowEditor />
            </>
          )}

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
                  onApply={setKeyAction}
                  onClose={() => setDualOpen(false)}
                />
              </div>
            )}
          </section>

          <section>
            <button
              onClick={() => setMacroOpen((v) => !v)}
              className={`w-full rounded py-1.5 text-sm hover:bg-zinc-700 ${
                current.kind === "macro"
                  ? "bg-amber-900/50 text-amber-100"
                  : "bg-zinc-800 text-zinc-200"
              }`}
            >
              {current.kind === "macro" ? "Edit macro…" : "Macro (sequence)…"}
            </button>
            {macroOpen && (
              <div className="mt-2">
                <MacroEditor
                  current={current}
                  onApply={setKeyAction}
                  onClose={() => setMacroOpen(false)}
                />
              </div>
            )}
          </section>

          <section>
            <button
              onClick={() => setOsMacroOpen((v) => !v)}
              className={`w-full rounded py-1.5 text-sm hover:bg-zinc-700 ${
                current.kind === "osMacro"
                  ? "bg-amber-900/50 text-amber-100"
                  : "bg-zinc-800 text-zinc-200"
              }`}
              title="One key, a different sequence on Mac and on Windows"
            >
              {current.kind === "osMacro"
                ? "Edit OS macro…"
                : "OS macro (Mac / Windows)…"}
            </button>
            {osMacroOpen && (
              <div className="mt-2">
                <OsMacroEditor
                  current={current}
                  onApply={setKeyAction}
                  onClose={() => setOsMacroOpen(false)}
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
