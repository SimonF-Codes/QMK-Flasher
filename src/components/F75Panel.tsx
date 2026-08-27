/**
 * AULA F75 panel — Phase 1: geometry + read-only view.
 *
 * This panel cannot change anything. The F75 is configured over a proprietary
 * HID protocol, and no byte has been sent to a device by any code path here.
 * See docs/research/aula-f75-remapper-plan.md for what the write path needs
 * before it exists.
 */
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { describePacked, F75_LAYERS, type F75LayerId } from "../lib/f75";
import type { F75GeometryState, F75Key } from "../lib/types";
import F75Keyboard from "./F75Keyboard";

export default function F75Panel() {
  const [state, setState] = useState<F75GeometryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<F75LayerId>("base");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    ipc
      .getF75Geometry()
      .then((s) => live && setState(s))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-red-400">Could not read F75 geometry: {error}</p>
      </Shell>
    );
  }
  if (!state) {
    return (
      <Shell>
        <p className="text-sm text-neutral-400">Loading…</p>
      </Shell>
    );
  }

  if (state.state === "missing") {
    return (
      <Shell>
        <div className="max-w-2xl space-y-3 text-sm text-neutral-300">
          <p>
            No F75 geometry yet. Unlike the Moonlander&apos;s — which comes from
            QMK&apos;s own <code>keyboard.json</code> and ships with the app —
            the F75&apos;s key layout has to be read out of AULA&apos;s Windows
            installer, so it is generated on your machine rather than bundled.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-400">
            <li>
              Unpack the AULA F75 installer with <code>innoextract</code>.
            </li>
            <li>
              Find the layout at <code>app/Dev/kb/&lt;variant&gt;/KB.ini</code>.
            </li>
            <li>
              Run{" "}
              <code>node scripts/extract-f75-geometry.mjs &lt;path-to-KB.ini&gt;</code>
            </li>
          </ol>
          <p className="text-neutral-500">
            It will be written to <code className="break-all">{state.path}</code>.
          </p>
        </div>
      </Shell>
    );
  }

  const geo = state.geometry;
  const selected = geo.keys.find((k) => k.slot === selectedSlot) ?? null;

  return (
    <Shell>
      <div className="mb-3 flex items-center gap-2">
        {F75_LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLayer(l.id)}
            className={`rounded px-3 py-1 text-sm ${
              layer === l.id
                ? "bg-sky-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
            aria-pressed={layer === l.id}
          >
            {l.title}
          </button>
        ))}
        <span className="ml-auto text-xs text-neutral-500">
          {geo.source} · {geo.vid ?? "?"}:{geo.pid ?? "?"} · read-only
        </span>
      </div>

      <F75Keyboard
        geometry={geo}
        layer={layer}
        selectedSlot={selectedSlot}
        onSelect={setSelectedSlot}
      />

      <KeyDetail geometry={geo} selected={selected} />

      <p className="mt-3 text-xs text-neutral-500">
        Read-only. This board has two layers and each key holds a single HID
        usage — no tap/hold, tap dance, combos or macros. F1–F12 are pinned by
        the firmware and cannot be remapped by any tool, including AULA&apos;s.
      </p>
    </Shell>
  );
}

function KeyDetail({
  geometry,
  selected,
}: {
  geometry: { lockedSlots: number[] };
  selected: F75Key | null;
}) {
  if (!selected) {
    return (
      <p className="mt-3 text-sm text-neutral-500">
        Select a key to see what the factory tables bind it to.
      </p>
    );
  }
  const locked = geometry.lockedSlots.includes(selected.slot);
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-neutral-500">Key</dt>
      <dd className="text-neutral-200">
        {selected.label}
        {locked && <span className="ml-2 text-amber-500">locked by firmware</span>}
        {!selected.positioned && (
          <span className="ml-2 text-neutral-500">(not on the key grid)</span>
        )}
      </dd>
      <dt className="text-neutral-500">Slot</dt>
      <dd className="text-neutral-200">{selected.slot}</dd>
      {selected.vk !== undefined && (
        <>
          <dt className="text-neutral-500">Factory base</dt>
          {/* Shown as the VK the OEM file gives. The VK -> HID usage mapping is
              only needed to WRITE a blob, so it is not invented here. */}
          <dd className="text-neutral-200">
            Windows VK 0x{selected.vk.toString(16).toUpperCase()}
          </dd>
        </>
      )}
      {selected.hid && (
        <>
          <dt className="text-neutral-500">Factory output</dt>
          <dd className="text-neutral-200">
            {describePacked(selected.hid)}{" "}
            <span className="text-neutral-500">({selected.hid.packed})</span>
          </dd>
        </>
      )}
      {selected.fn1 && (
        <>
          <dt className="text-neutral-500">Factory FN1</dt>
          <dd className="text-neutral-200">
            {describePacked(selected.fn1)}{" "}
            <span className="text-neutral-500">({selected.fn1.packed})</span>
          </dd>
        </>
      )}
    </dl>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col p-4" aria-label="AULA F75">
      {children}
    </section>
  );
}
