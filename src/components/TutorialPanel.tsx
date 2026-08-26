/**
 * The guided tour — one feature at a time, pointing at a real key.
 *
 * It is an in-flow bar above Build & Flash rather than a drawer or a modal,
 * and that is the whole design. A step's job is to say "this key, right there"
 * while you look at the board; a panel that covers the board cannot do that.
 * Docking it into the column instead shrinks the board (the keyboard is an SVG
 * that scales) rather than hiding it, so the highlighted key stays visible for
 * every step, and nothing about the app is blocked while the tour is open.
 *
 * Everything shown is derived by `lib/tutorial.ts` from the loaded layout —
 * which in turn reuses the Tool Guide's classification, so the tour and the
 * guide can never disagree about what a key is. This file decides only how it
 * looks and how you move through it.
 *
 * `TutorialCard` and `TutorialInvite` take props and read no stores, so they
 * can be rendered anywhere and tested without a DOM.
 */
import { useEffect } from "react";
import { OS_NAME } from "../lib/toolGuide";
import type { TutorialStep } from "../lib/tutorial";
import { useLayoutStore } from "../state/layoutStore";
import { useTutorialStore } from "../state/tutorialStore";

// ---- The invitation ----

export interface TutorialInviteProps {
  onStart(): void;
  onDismiss(): void;
}

/**
 * Offered once, to a new user. A bar you can decline in one click rather than
 * a modal you have to escape: the tour is worth suggesting, not worth
 * interrupting someone for.
 */
export function TutorialInvite({ onStart, onDismiss }: TutorialInviteProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-violet-900/70 bg-violet-950/30 px-4 py-2.5">
      <span aria-hidden className="text-base">
        🧭
      </span>
      <p className="mr-auto text-sm text-violet-100">
        First time here?{" "}
        <span className="text-violet-300/80">
          Take a short tour of every feature, using the keys already in this
          layout as the examples.
        </span>
      </p>
      <button
        onClick={onStart}
        className="rounded-md border border-violet-600 bg-violet-900/60 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-800/60"
      >
        Start the tour
      </button>
      <button
        onClick={onDismiss}
        className="rounded-md px-2 py-1.5 text-xs text-violet-300/70 hover:bg-violet-900/40 hover:text-violet-100"
      >
        No thanks
      </button>
    </div>
  );
}

// ---- One step ----

export interface TutorialCardProps {
  step: TutorialStep;
  total: number;
  onBack(): void;
  onNext(): void;
  onClose(): void;
  onJump(index: number): void;
}

/** The example's Mac/Windows split — the payload of the OS-macro step. */
function OsSplit({ os }: { os: NonNullable<TutorialStep["example"]>["os"] }) {
  if (!os) return null;
  const split = os.mac !== os.windows;
  return (
    <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px] leading-relaxed">
      {split ? (
        <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-zinc-500">{OS_NAME.mac}</dt>
          <dd className="text-zinc-200">{os.mac}</dd>
          <dt className="text-zinc-500">{OS_NAME.windows}</dt>
          <dd className="text-zinc-200">{os.windows}</dd>
        </dl>
      ) : (
        <p className="text-zinc-200">
          <span className="text-zinc-500">Both machines: </span>
          {os.mac}
        </p>
      )}
      <p
        className={`mt-1 ${os.warning ? "text-amber-300" : "text-zinc-500"}`}
      >
        {os.note}
      </p>
    </div>
  );
}

/** What the step is pointing at, and where it is. */
function Example({ step }: { step: TutorialStep }) {
  const e = step.example;
  if (!e) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Nothing to point at
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
          {step.missing ??
            "This part of the app has no example inside the layout — it is a tool rather than a key."}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-violet-800/70 bg-violet-950/20 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-violet-400">
        {e.keys.length > 1 ? "Lit on the board" : "This key, on the board"}
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-100">{e.title}</p>
      <p className="text-[13px] leading-relaxed text-zinc-300">{e.summary}</p>

      {e.detail.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-zinc-400">
          {e.detail.map((d, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden className="text-zinc-600">
                ·
              </span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}

      <OsSplit os={e.os} />

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
        <span>{e.layerName}</span>
        {e.position && <span>· {e.position}</span>}
        <span className="font-mono text-zinc-400">
          {e.keys.length > 1
            ? `keys ${e.keys.join(" + ")}`
            : `key ${e.keys[0]}`}
        </span>
        <code className="ml-auto font-mono text-zinc-600">{e.token}</code>
      </p>
    </div>
  );
}

export function TutorialCard({
  step,
  total,
  onBack,
  onNext,
  onClose,
  onJump,
}: TutorialCardProps) {
  const first = step.number <= 1;
  const last = step.number >= total;

  return (
    <section
      aria-label="Tutorial"
      className="flex max-h-[42vh] shrink-0 flex-col border-t border-violet-900/70 bg-zinc-950"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 px-4 py-2">
        <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
          Tour
        </span>
        <h2 className="text-sm font-semibold text-zinc-100">{step.title}</h2>
        <span className="text-xs text-zinc-500">
          Step {step.number} of {total}
        </span>

        {/* Dots rather than a bar: the tour is short enough to jump around in,
            and being able to skip ahead is part of not trapping anyone. */}
        <div className="hidden items-center gap-1 sm:flex">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              onClick={() => onJump(i)}
              aria-label={`Go to step ${i + 1} of ${total}`}
              aria-current={i === step.number - 1}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === step.number - 1
                  ? "bg-violet-400"
                  : i < step.number - 1
                    ? "bg-violet-800"
                    : "bg-zinc-700 hover:bg-zinc-500"
              }`}
            />
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={onBack}
            disabled={first}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 enabled:hover:bg-zinc-800 disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={last ? onClose : onNext}
            className="rounded-md bg-violet-800 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-700"
          >
            {last ? "Finish" : "Next"}
          </button>
          <button
            onClick={onClose}
            aria-label="Leave the tour"
            title="Leave the tour (Esc)"
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3 md:grid-cols-[1.5fr_1fr]">
        <div>
          <p className="text-[13px] leading-relaxed text-zinc-200">{step.why}</p>
          {step.body.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-zinc-400">
              {step.body.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-violet-700">
                    ·
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
          {step.pointer && (
            <p className="mt-2 text-[12px] text-zinc-500">
              <span aria-hidden className="mr-1 text-violet-600">
                →
              </span>
              {step.pointer}
            </p>
          )}
        </div>

        <Example step={step} />
      </div>
    </section>
  );
}

// ---- Wiring ----

/**
 * The tour and its invitation, wired to the stores. Renders nothing at all
 * when the tour is closed and the user has already been offered it, so it
 * costs a returning user no space.
 */
export default function TutorialPanel() {
  const layout = useLayoutStore((s) => s.layout);
  const open = useTutorialStore((s) => s.open);
  const seen = useTutorialStore((s) => s.seen);
  const index = useTutorialStore((s) => s.index);
  const steps = useTutorialStore((s) => s.steps);
  const start = useTutorialStore((s) => s.start);
  const close = useTutorialStore((s) => s.close);
  const next = useTutorialStore((s) => s.next);
  const back = useTutorialStore((s) => s.back);
  const goTo = useTutorialStore((s) => s.goTo);
  const dismissOffer = useTutorialStore((s) => s.dismissOffer);
  const rebuild = useTutorialStore((s) => s.rebuild);

  // The tour describes the layout in front of you, so it follows the layout
  // rather than a snapshot of it: edit a key mid-tour, or load another layout,
  // and the steps are re-derived in place.
  useEffect(() => {
    rebuild();
  }, [layout, rebuild]);

  // Esc leaves, from anywhere that is not a text field. Bound on bubble so the
  // panels that use Esc to cancel their own editing (the combo editor, the
  // build panel) get it first and the tour is the last thing Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (open) {
    const step = steps[index];
    if (!step) return null;
    return (
      <TutorialCard
        step={step}
        total={steps.length}
        onBack={back}
        onNext={next}
        onClose={close}
        onJump={goTo}
      />
    );
  }

  // Offered only once there is a layout to point at — an invitation to a tour
  // whose every example would be "your layout has none of this" is not one.
  if (!seen && layout) {
    return <TutorialInvite onStart={start} onDismiss={dismissOffer} />;
  }
  return null;
}
