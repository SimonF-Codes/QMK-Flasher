/**
 * Version-history panel: a header button that opens a modal listing the active
 * layout's saved versions (newest first) with friendly reason labels, a Revert
 * action (confirmed; the backend snapshots the current first so revert is
 * itself undoable), and an explicit "Save snapshot" (manual) button.
 */
import { useState } from "react";
import type { VersionReason } from "../lib/types";
import { useLayoutStore } from "../state/layoutStore";

const REASON_LABEL: Record<VersionReason, string> = {
  save: "Auto-saved",
  preReseed: "Before re-seed",
  preRestore: "Before revert",
  manual: "Manual snapshot",
};

const REASON_HINT: Record<VersionReason, string> = {
  save: "Snapshot taken automatically when the layout was saved.",
  preReseed: "Backup taken automatically before a re-seed from Oryx.",
  preRestore: "Backup taken automatically before a revert (so it's undoable).",
  manual: "Snapshot you took manually.",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function VersionHistoryPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const versions = useLayoutStore((s) => s.versions);
  const loading = useLayoutStore((s) => s.loading);
  const refreshVersions = useLayoutStore((s) => s.refreshVersions);
  const restoreVersion = useLayoutStore((s) => s.restoreVersion);
  const snapshotNow = useLayoutStore((s) => s.snapshotNow);

  const [open, setOpen] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  if (!layout) return null;

  const openPanel = () => {
    setOpen(true);
    setConfirmRevert(null);
    void refreshVersions();
  };

  const doRevert = async (versionId: string) => {
    setConfirmRevert(null);
    await restoreVersion(versionId);
  };

  const doSnapshot = async () => {
    const label = labelDraft.trim();
    setLabelDraft("");
    await snapshotNow(label || undefined);
  };

  return (
    <>
      <button
        onClick={openPanel}
        className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
        title="Browse and restore saved versions of this layout"
      >
        🕘 History
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-100">
                Version history
              </h2>
              <span className="text-xs text-zinc-500">{layout.meta.name}</span>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSnapshot();
                }}
                placeholder="Optional label…"
                className="min-w-0 flex-1 rounded bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
              />
              <button
                onClick={() => void doSnapshot()}
                className="shrink-0 rounded bg-sky-700 px-3 py-1 text-xs font-medium text-sky-50 hover:bg-sky-600"
                title="Save a snapshot of the current layout now"
              >
                Save snapshot
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {versions.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">
                  {loading
                    ? "Loading…"
                    : "No saved versions yet. Save the layout or take a snapshot."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {versions.map((v) => (
                    <li
                      key={v.versionId}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-sm text-zinc-100"
                            title={REASON_HINT[v.reason]}
                          >
                            {REASON_LABEL[v.reason]}
                          </span>
                          {v.label && (
                            <span className="truncate rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                              {v.label}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatTime(v.createdAt)}
                        </div>
                      </div>

                      {confirmRevert === v.versionId ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs">
                          <span className="text-zinc-400">Revert?</span>
                          <button
                            onClick={() => void doRevert(v.versionId)}
                            className="rounded bg-amber-800 px-1.5 py-0.5 text-amber-100 hover:bg-amber-700"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmRevert(null)}
                            className="rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-200 hover:bg-zinc-600"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRevert(v.versionId)}
                          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                          title="Restore this version (current is backed up first)"
                        >
                          Revert
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
              Reverting saves a backup of the current layout first, so you can
              undo it.
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
