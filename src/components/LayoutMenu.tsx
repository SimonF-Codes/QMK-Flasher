/**
 * Header layout switcher (Oryx-style): a dropdown that lists every stored
 * layout grouped by keyboard and lets you switch / create / duplicate /
 * rename / delete / re-seed. Switching away from unsaved edits prompts
 * Save / Discard / Cancel (the same dirty-guard used on close).
 */
import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import type { KeyboardInfo, LayoutSummary } from "../lib/types";
import { useLayoutStore } from "../state/layoutStore";

export default function LayoutMenu() {
  const layout = useLayoutStore((s) => s.layout);
  const layouts = useLayoutStore((s) => s.layouts);
  const activeId = useLayoutStore((s) => s.activeId);
  const switchLayout = useLayoutStore((s) => s.switchLayout);
  const createLayout = useLayoutStore((s) => s.createLayout);
  const duplicateLayout = useLayoutStore((s) => s.duplicateLayout);
  const renameLayout = useLayoutStore((s) => s.renameLayout);
  const deleteLayout = useLayoutStore((s) => s.deleteLayout);
  const seedActiveFromOryx = useLayoutStore((s) => s.seedActiveFromOryx);

  const [open, setOpen] = useState(false);
  const [keyboards, setKeyboards] = useState<KeyboardInfo[]>([]);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKb, setNewKb] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipc.listKeyboards().then(setKeyboards).catch(() => {});
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!layout) return null;

  const kbName = (id: string) =>
    keyboards.find((k) => k.id === id)?.name ?? id;

  const closeMenu = () => {
    setOpen(false);
    setRenaming(null);
    setConfirmDelete(null);
    setConfirmSeed(false);
    setShowNew(false);
  };

  // Switch, honoring the dirty-guard: if unsaved, stage a confirm dialog.
  const requestSwitch = async (id: string) => {
    if (id === activeId) {
      closeMenu();
      return;
    }
    const switched = await switchLayout(id);
    if (switched) closeMenu();
    else setPendingSwitch(id); // dirty — ask what to do
  };

  const resolvePending = async (choice: "save" | "discard" | "cancel") => {
    const id = pendingSwitch;
    setPendingSwitch(null);
    if (!id || choice === "cancel") return;
    const ok = await switchLayout(id, choice);
    if (ok) closeMenu();
  };

  const commitRename = async (id: string) => {
    const name = renameDraft.trim();
    setRenaming(null);
    if (name && name !== layouts.find((l) => l.id === id)?.name) {
      await renameLayout(id, name);
    }
  };

  const doDuplicate = async (s: LayoutSummary) => {
    const created = await duplicateLayout(s.id, `${s.name} copy`);
    if (created) await requestSwitch(created.id);
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name || !newKb) return;
    const created = await createLayout(name, newKb);
    setShowNew(false);
    setNewName("");
    if (created) await requestSwitch(created.id);
  };

  // Only layouts seeded from Oryx have a hashId to re-seed from.
  const oryxSource = layout.meta.seededFrom.layoutId;
  const canSeed = !!oryxSource && oryxSource !== "local";

  const doSeed = async () => {
    setConfirmSeed(false);
    await seedActiveFromOryx(); // surfaces errors via the store's error bar
    closeMenu();
  };

  // Group summaries by keyboard for the menu body.
  const groups = new Map<string, LayoutSummary[]>();
  for (const s of layouts) {
    const arr = groups.get(s.keyboard) ?? [];
    arr.push(s);
    groups.set(s.keyboard, arr);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md bg-zinc-800 px-2.5 py-1 text-sm text-zinc-100 hover:bg-zinc-700"
        title="Switch layout"
      >
        <span className="font-medium">{layout.meta.name}</span>
        <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
          {kbName(layout.meta.geometry)}
        </span>
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {[...groups.entries()].map(([kb, items]) => (
            <div key={kb}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {kbName(kb)}
              </div>
              {items.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1 px-2 py-1 text-sm ${
                      isActive ? "bg-zinc-800/60" : "hover:bg-zinc-800"
                    }`}
                  >
                    {renaming === s.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void commitRename(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(s.id);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        className="min-w-0 flex-1 rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-100 outline-none ring-1 ring-sky-500"
                      />
                    ) : (
                      <button
                        onClick={() => void requestSwitch(s.id)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={isActive ? "Active layout" : "Switch to this layout"}
                      >
                        {isActive && <span className="text-sky-400">● </span>}
                        {s.name}
                      </button>
                    )}

                    {confirmDelete === s.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <span className="text-zinc-400">Delete?</span>
                        <button
                          onClick={() => {
                            setConfirmDelete(null);
                            void deleteLayout(s.id);
                          }}
                          className="rounded bg-red-800 px-1.5 py-0.5 text-red-100 hover:bg-red-700"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-200 hover:bg-zinc-600"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      renaming !== s.id && (
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <IconBtn
                            label="Duplicate"
                            onClick={() => void doDuplicate(s)}
                          >
                            ⧉
                          </IconBtn>
                          <IconBtn
                            label="Rename"
                            onClick={() => {
                              setRenaming(s.id);
                              setRenameDraft(s.name);
                            }}
                          >
                            ✎
                          </IconBtn>
                          <IconBtn
                            label={
                              isActive
                                ? "Can't delete the active layout"
                                : "Delete"
                            }
                            disabled={isActive}
                            onClick={() => setConfirmDelete(s.id)}
                          >
                            🗑
                          </IconBtn>
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className="my-1 border-t border-zinc-800" />

          {showNew ? (
            <div className="px-2 py-1.5">
              <input
                autoFocus
                placeholder="New layout name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doCreate();
                  if (e.key === "Escape") setShowNew(false);
                }}
                className="mb-1.5 w-full rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
              />
              <select
                value={newKb}
                onChange={(e) => setNewKb(e.target.value)}
                className="mb-1.5 w-full rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700"
              >
                <option value="" disabled>
                  Choose a keyboard…
                </option>
                {keyboards.map((k) => (
                  <option key={k.id} value={k.id} disabled={!k.supported}>
                    {k.name}
                    {k.supported ? "" : " (coming soon)"}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setShowNew(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void doCreate()}
                  disabled={!newName.trim() || !newKb}
                  className="rounded bg-sky-700 px-2 py-1 text-xs text-sky-50 enabled:hover:bg-sky-600 disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuAction
                onClick={() => {
                  setShowNew(true);
                  setNewKb(keyboards.find((k) => k.supported)?.id ?? "");
                }}
              >
                + New layout…
              </MenuAction>
              <MenuAction
                onClick={() => setConfirmSeed(true)}
                disabled={!canSeed}
                title={
                  canSeed
                    ? `Re-seed from Oryx ${oryxSource}`
                    : "This layout wasn't seeded from Oryx"
                }
              >
                ↻ Seed active from Oryx…
              </MenuAction>
            </>
          )}
        </div>
      )}

      {confirmSeed && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-lg border border-amber-700/60 bg-zinc-900 p-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-amber-300">
              Re-seed “{layout.meta.name}” from Oryx?
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              This replaces the whole layout with the current Oryx version.
              Any changes to this layout may be overwritten.
            </p>
            <p className="mt-2 text-xs text-zinc-400">
              A backup version is saved first, so you can revert from{" "}
              <span className="font-medium text-zinc-300">History</span>{" "}
              afterward.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmSeed(false)}
                className="rounded bg-sky-700 px-3 py-1.5 text-sm text-sky-50 hover:bg-sky-600"
              >
                Cancel
              </button>
              <button
                onClick={() => void doSeed()}
                className="rounded bg-amber-800 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-700"
              >
                Re-seed
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingSwitch && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <p className="text-sm text-zinc-200">
              You have unsaved changes to{" "}
              <span className="font-medium">{layout.meta.name}</span>.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => void resolvePending("cancel")}
                className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void resolvePending("discard")}
                className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-600"
              >
                Discard
              </button>
              <button
                onClick={() => void resolvePending("save")}
                className="rounded bg-sky-700 px-3 py-1.5 text-sm text-sky-50 hover:bg-sky-600"
              >
                Save &amp; switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded px-1 py-0.5 text-xs text-zinc-400 enabled:hover:bg-zinc-700 enabled:hover:text-zinc-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function MenuAction({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="block w-full px-3 py-1.5 text-left text-sm text-zinc-300 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
