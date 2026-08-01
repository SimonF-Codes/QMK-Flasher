/**
 * Where a key event landed: the live scratchpad, another editable field, or the
 * page.
 *
 * Shared by every global keyboard listener in the app — live capture must not
 * swallow what you type into a field, and the app shortcuts (Ctrl+S, Ctrl+C/V,
 * Esc-to-cancel) must not fire there either. It lives here rather than in
 * `App.tsx` so `BuildFlashPanel` can apply the same rule without importing its
 * own parent (a cycle) or growing a second, drifting copy of the check.
 */
export function targetKind(
  t: EventTarget | null,
): "scratchpad" | "field" | "page" {
  if (!(t instanceof HTMLElement)) return "page";
  if (t.hasAttribute("data-live-scratchpad")) return "scratchpad";
  if (t.isContentEditable) return "field";
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return "field";
  return "page";
}
