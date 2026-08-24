/**
 * The Tool Guide — a reference to every non-obvious key in the layout.
 *
 * Everything shown here is derived by `lib/toolGuide.ts` from the layout that
 * is passed in; the panel itself holds no knowledge of keycodes or the swap.
 * It takes props rather than reading the stores so it can be mounted anywhere
 * (a tab, a drawer, a modal) without the mounting site having to match.
 *
 * This is a document Simon wants BESIDE the keyboard, not only on screen, so
 * printing is a first-class path: a print stylesheet lifts the guide out of
 * the app chrome and renders it as black-on-white flowing pages, and the whole
 * thing exports as Markdown for pasting elsewhere.
 */
import { useMemo, useState } from "react";
import {
  OS_NAME,
  OS_RELATION_LABEL,
  OS_RELATION_ORDER,
  buildToolGuide,
  toolGuideMarkdown,
  type OsRelation,
  type ToolGuideEntry,
} from "../lib/toolGuide";
import type { LayoutFile } from "../lib/types";

export interface ToolGuidePanelProps {
  layout: LayoutFile | null;
  /** Friendlier layer titles than the layout carries, indexed by layer. */
  layerNames?: readonly string[];
  /** Rendered as a close control when the host puts the panel in a drawer. */
  onClose?: () => void;
}

/** The element the print stylesheet isolates. */
const PRINT_ROOT = "tool-guide-print";

const KIND_BADGE: Record<string, string> = {
  macro: "Macro",
  osMacro: "OS macro",
  osMode: "OS mode",
  combo: "Combo",
  modTap: "Mod-tap",
  layerTap: "Layer-tap",
  dualFunc: "Dual-func",
  tapDance: "Tap dance",
  layerSwitch: "Layer",
  qkLock: "Key Lock",
  basic: "Chord",
  special: "System",
  rgb: "RGB",
  rgbHsv: "RGB",
};

/** Relation → the chip's color. Only `bypassed` is an alarm. */
const RELATION_CHIP: Record<OsRelation, string> = {
  control: "border-sky-700 bg-sky-950 text-sky-200",
  osAware: "border-emerald-700 bg-emerald-950 text-emerald-200",
  swapped: "border-violet-700 bg-violet-950 text-violet-200",
  bypassed: "border-amber-600 bg-amber-950 text-amber-100",
  balanced: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

/** Everything an entry can be searched by, lowercased once. */
function haystack(e: ToolGuideEntry): string {
  return [
    e.title,
    e.summary,
    e.token,
    e.kind,
    ...e.detail,
    ...e.locations.map((l) => `${l.layerName} key ${l.index ?? ""} ${l.position}`),
    e.os ? `${e.os.relation} ${e.os.mac} ${e.os.windows} ${e.os.note}` : "",
  ]
    .join(" ")
    .toLowerCase();
}

function Where({ entry }: { entry: ToolGuideEntry }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entry.locations.map((l, i) => (
        <span
          key={i}
          className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 text-[11px] text-zinc-400"
        >
          {l.layerName}
          {l.index !== null && (
            <>
              {" · "}
              <span className="font-mono text-zinc-300">key {l.index}</span>
              {l.position && ` · ${l.position}`}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

function OsBlock({ os }: { os: NonNullable<ToolGuideEntry["os"]> }) {
  const split = os.mac !== os.windows;
  return (
    <div
      className={`tg-os mt-2 rounded border px-2.5 py-2 text-xs ${
        os.warning
          ? "border-amber-700/70 bg-amber-950/30"
          : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${RELATION_CHIP[os.relation]}`}
        >
          {OS_RELATION_LABEL[os.relation]}
        </span>
        {os.warning && (
          <span className="text-[11px] font-medium text-amber-300">
            Check this one
          </span>
        )}
        {os.namingOnly && (
          <span className="text-[11px] text-zinc-500">
            same keycode, different name
          </span>
        )}
      </div>

      {split ? (
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
          <dt className="text-zinc-500">On Mac</dt>
          <dd className="text-zinc-200">{os.mac}</dd>
          <dt className="text-zinc-500">On Windows</dt>
          <dd className="text-zinc-200">{os.windows}</dd>
        </dl>
      ) : (
        <p className="text-zinc-200">
          <span className="text-zinc-500">Both machines: </span>
          {os.mac}
        </p>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
        {os.note}
      </p>
    </div>
  );
}

function Entry({ entry }: { entry: ToolGuideEntry }) {
  // rgb/system entries name themselves — do not print the title twice.
  const redundant = entry.summary.replace(/\.$/, "") === entry.title;
  return (
    <article className="tg-entry rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-sm font-semibold text-zinc-100">{entry.title}</h4>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {KIND_BADGE[entry.kind] ?? entry.kind}
        </span>
        <code className="ml-auto font-mono text-[11px] text-zinc-500">
          {entry.token}
        </code>
      </header>

      {!redundant && (
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
          {entry.summary}
        </p>
      )}

      {entry.detail.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[13px] text-zinc-400">
          {entry.detail.map((d, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden className="text-zinc-600">
                ·
              </span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}

      {entry.os && <OsBlock os={entry.os} />}
      <Where entry={entry} />
    </article>
  );
}

export default function ToolGuidePanel({
  layout,
  layerNames,
  onClose,
}: ToolGuidePanelProps) {
  const [query, setQuery] = useState("");
  const [osOnly, setOsOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  const guide = useMemo(
    () => buildToolGuide(layout, layerNames),
    [layout, layerNames],
  );

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const index = new Map<string, string>();
    for (const g of guide.groups) for (const e of g.entries) index.set(e.id, haystack(e));
    return (e: ToolGuideEntry) =>
      (!q || (index.get(e.id) ?? haystack(e)).includes(q)) &&
      (!osOnly || !!e.os);
  }, [guide, q, osOnly]);

  const groups = guide.groups
    .map((g) => ({ ...g, entries: g.entries.filter(matches) }))
    .filter((g) => g.entries.length > 0);
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const osEntries = guide.os.entries.filter(matches);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toolGuideMarkdown(guide));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <style>{PRINT_CSS}</style>

      <header className="tg-noprint flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="mr-auto">
          <h2 className="text-base font-semibold text-zinc-100">Tool guide</h2>
          <p className="text-xs text-zinc-500">
            {guide.layoutName || "No layout"} ·{" "}
            {guide.count === 0
              ? "nothing to explain yet"
              : `${shown === guide.count ? guide.count : `${shown} of ${guide.count}`} ${
                  guide.count === 1 ? "entry" : "entries"
                }`}
            , derived from the layout
          </p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search keys, macros, layers…"
          spellCheck={false}
          aria-label="Search the tool guide"
          className="w-56 rounded-md bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none ring-1 ring-zinc-800 placeholder:text-zinc-600 focus:ring-zinc-600"
        />
        <button
          onClick={() => setOsOnly((v) => !v)}
          aria-pressed={osOnly}
          title="Show only the keys the Ctrl↔Cmd swap has an opinion about"
          className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
            osOnly
              ? "border-sky-700 bg-sky-900/50 text-sky-200"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          OS-affected only
        </button>
        <button
          onClick={copy}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          title="Copy the whole guide as Markdown"
        >
          {copied ? "Copied" : "Copy Markdown"}
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          title="Print the guide, or save it as a PDF"
        >
          Print
        </button>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close the tool guide"
            className="rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        )}
      </header>

      <div id={PRINT_ROOT} className="flex-1 overflow-y-auto px-4 py-4">
        <h1 className="tg-printonly">
          Tool guide — {guide.layoutName || "layout"}
        </h1>

        {!layout ? (
          <p className="text-sm text-zinc-500">
            No layout loaded, so there is nothing to explain yet.
          </p>
        ) : guide.count === 0 ? (
          <p className="text-sm text-zinc-500">
            Every key in this layout is an ordinary character key — nothing here
            needs a guide entry.
          </p>
        ) : (
          <>
            <OsSection guide={guide} entries={osEntries} filtered={!!q || osOnly} />

            {groups.length > 1 && (
              <nav className="tg-noprint mb-4 flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <a
                    key={g.id}
                    href={`#tg-${g.id}`}
                    className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  >
                    {g.title}
                    <span className="ml-1 text-zinc-600">{g.entries.length}</span>
                  </a>
                ))}
              </nav>
            )}

            {groups.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nothing matches “{query}”.
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.id} id={`tg-${g.id}`} className="tg-group mb-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                    {g.title}
                  </h3>
                  <p className="mb-2 text-xs text-zinc-500">{g.blurb}</p>
                  <div className="grid gap-2">
                    {g.entries.map((e) => (
                      <Entry key={e.id} entry={e} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The Ctrl↔Cmd section, which leads the document — it is the question the
 * guide was asked for. Keys are ordered so the ones most likely to be wrong
 * come first, and the banner says up front whether the board can even reach
 * the other mode: an analysis of a swap that cannot happen is a footnote, not
 * a headline.
 */
function OsSection({
  guide,
  entries,
  filtered,
}: {
  guide: ReturnType<typeof buildToolGuide>;
  entries: ToolGuideEntry[];
  filtered: boolean;
}) {
  const { os } = guide;
  const warnings = entries.filter((e) => e.os!.warning).length;

  return (
    <section id="tg-os-swap" className="tg-group mb-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Ctrl ↔ Cmd swap
      </h3>
      <p className="mb-2 text-xs text-zinc-500">
        This layout's plain Ctrl and Gui modifiers were written for{" "}
        <strong className="text-zinc-300">{OS_NAME[os.authoredOs]}</strong>.{" "}
        {os.reachable ? (
          <>
            The board can switch to {OS_NAME[os.otherOs]} mode
            {os.switches.length > 0 ? (
              <> with {os.switches.join("; ")}.</>
            ) : (
              <> when host detection recognises the machine.</>
            )}
          </>
        ) : (
          <>
            No OS-mode key is assigned and host detection is off, so the board
            can only ever be in {OS_NAME[os.authoredOs]} mode — the swap below
            is theory until you assign one.
          </>
        )}
      </p>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-500">
          {filtered
            ? "No OS-affected keys match the current filter."
            : "No key in this layout carries Ctrl or Gui, so the swap has nothing to change."}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {OS_RELATION_ORDER.filter((r) => os.counts[r] > 0).map((r) => (
              <span
                key={r}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${RELATION_CHIP[r]}`}
              >
                {OS_RELATION_LABEL[r]} · {os.counts[r]}
              </span>
            ))}
            {warnings > 0 && (
              <span className="rounded border border-amber-600 bg-amber-950 px-1.5 py-0.5 text-[11px] text-amber-100">
                {warnings} worth checking
              </span>
            )}
          </div>
          <div className="grid gap-2">
            {entries.map((e) => (
              <Entry key={`os-${e.id}`} entry={e} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Print isolation without touching the host page. `visibility` is used rather
 * than `display` deliberately: it inherits, so hiding `body *` and re-showing
 * the guide subtree keeps the guide's own layout intact wherever the host
 * mounted it (tab, drawer or modal), which `display: none` on ancestors would
 * destroy.
 */
const PRINT_CSS = `
.tg-printonly { display: none; }
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  #${PRINT_ROOT}, #${PRINT_ROOT} * { visibility: visible !important; }
  #${PRINT_ROOT} {
    position: absolute !important;
    left: 0 !important; top: 0 !important;
    width: 100% !important; height: auto !important; max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
  }
  #${PRINT_ROOT}, #${PRINT_ROOT} * {
    background: transparent !important;
    color: #000 !important;
    box-shadow: none !important;
    border-color: #c9c9c9 !important;
  }
  #${PRINT_ROOT} .tg-printonly {
    display: block;
    font-size: 18pt; font-weight: 700; margin: 0 0 10pt;
  }
  #${PRINT_ROOT} .tg-noprint { display: none !important; }
  #${PRINT_ROOT} .tg-entry { break-inside: avoid; page-break-inside: avoid; }
  #${PRINT_ROOT} .tg-group { break-inside: auto; margin-bottom: 10pt; }
  #${PRINT_ROOT} .tg-group h3 { break-after: avoid; page-break-after: avoid; }
  #${PRINT_ROOT} .tg-os { border-width: 1px !important; }
}
`;
