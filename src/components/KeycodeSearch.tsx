import { useState } from "react";
import { labelFor, searchKeycodes } from "../lib/keycodes";
import type { KeycodeEntry } from "../lib/types";

/**
 * A one-field keycode chooser: type, click a result, done. Used wherever a
 * single code is being set inside a larger editor (dual function's tap/hold
 * halves, a macro step) as opposed to KeyPicker's full browsable catalog.
 */
export default function KeycodeSearch({
  value,
  onPick,
  filter = (e) => e.tappable,
  placeholder = "Search keycode…",
  limit = 12,
  showCurrent = true,
}: {
  /** The code currently set, shown above the field. */
  value?: string;
  onPick(code: string): void;
  /** Which catalog entries are offered; defaults to tappable codes. */
  filter?(entry: KeycodeEntry): boolean;
  placeholder?: string;
  limit?: number;
  showCurrent?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Not memoized on purpose: `searchKeycodes` short-circuits to [] on an empty
  // query, and `filter` is usually an inline arrow, so a memo keyed on it
  // would recompute every render anyway.
  const results = searchKeycodes(query).filter(filter).slice(0, limit);

  return (
    <div>
      {showCurrent && value && (
        <div className="mb-1 text-xs text-zinc-400">
          Current: <span className="text-zinc-200">{labelFor(value)}</span> (
          {value})
        </div>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded bg-zinc-900 px-2 py-1 text-sm outline-none ring-1 ring-zinc-700 focus:ring-sky-500"
      />
      {results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-700 bg-zinc-900">
          {results.map((e) => (
            <li key={e.qmk}>
              <button
                className="flex w-full justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-zinc-700"
                onClick={() => {
                  onPick(e.qmk);
                  setQuery("");
                }}
              >
                <span className="truncate">{e.longLabel}</span>
                <span className="shrink-0 text-zinc-500">{e.qmk}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
