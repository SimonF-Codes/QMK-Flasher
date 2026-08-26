/**
 * The tutorial: a guided tour of every feature the app has, DERIVED from the
 * layout that is loaded.
 *
 * The Tool Guide (`toolGuide.ts`) already walks the layout and classifies every
 * non-obvious key — macros with their steps, combos with their triggers, OS
 * macros with both halves, and the whole Ctrl↔Cmd analysis. That classification
 * was the hard part and it is tested, so the tour reuses it wholesale rather
 * than walking the layout again: two derivations of the same thing drift, and
 * the one that drifts is always the one nobody is looking at.
 *
 * So a step is not "explain macros, then point at key 41". A step is *find a
 * live example of feature X in this layout, point at wherever it turned out to
 * be, explain it*. Move the key and the tour follows it. Delete the feature and
 * the step says so — `example: null` plus an honest `missing` line — instead of
 * highlighting an empty position.
 *
 * Relationship to the guide: same derivation, opposite presentation. The guide
 * is the reference — everything, at once, printable. This is the tour — one
 * thing at a time, in an order that builds.
 *
 * The only thing here the guide cannot supply is the *plain* key the tour opens
 * on, because the guide deliberately excludes keys that explain themselves. It
 * is still found through the guide's own classifier (`groupFor` returning null
 * IS "this key needs no explanation"), not through a private idea of what plain
 * means.
 */
import { authoredOs, type FriendlyOs } from "./osSwap";
import { compiledEffects, costs, effectLabel } from "./rgbEffects";
import {
  OS_NAME,
  buildToolGuide,
  describeAction,
  describePosition,
  groupFor,
  layerName,
  type GuideGroupId,
  type OsAnalysis,
  type ToolGuide,
  type ToolGuideEntry,
} from "./toolGuide";
import type { LayoutFile } from "./types";

/** The tour, in order. Each id is stable — progress is stored against it. */
export type TutorialTopicId =
  | "welcome"
  | "key"
  | "layer"
  | "tapHold"
  | "tapDance"
  | "lock"
  | "macro"
  | "combo"
  | "osSwap"
  | "osMacro"
  | "lighting"
  | "effects"
  | "live"
  | "versions"
  | "guide"
  | "flash";

/**
 * The live example a step teaches from: one real key (or combo) in this
 * layout, with everything needed to point at it and describe it.
 */
export interface TutorialExample {
  /** The guide entry this came from, or "" for the plain-key step. */
  entryId: string;
  title: string;
  /** One line: what it does, on the authored OS. */
  summary: string;
  /** The spelled-out breakdown — macro steps, both OS halves, tap/hold. */
  detail: string[];
  /** The QMK token it compiles to. */
  token: string;
  layer: number;
  layerName: string;
  /** Physical description — "left half · thumb cluster". */
  position: string;
  /**
   * Positions to light up on the board. One for a key, the whole trigger set
   * for a combo. Never empty.
   */
  keys: number[];
  /** The guide's Ctrl↔Cmd analysis, when it had an opinion about this key. */
  os: OsAnalysis | null;
}

export interface TutorialStep {
  id: TutorialTopicId;
  /** 1-based, for "step 4 of 16". */
  number: number;
  title: string;
  /**
   * Why the feature exists. Stands entirely on its own — a step with no
   * example still teaches, it just cannot show you one of yours.
   */
  why: string;
  /** Derived commentary about *this* layout, and how to use the feature. */
  body: string[];
  /** Where the feature lives in the app chrome. */
  pointer: string | null;
  /** A real key in this layout, or null when the layout has no example. */
  example: TutorialExample | null;
  /** Said in place of the example when there is none. Null when never needed. */
  missing: string | null;
}

export interface Tutorial {
  layoutName: string;
  steps: TutorialStep[];
  /** How many steps found a live example — the tour's honesty score. */
  examples: number;
}

// ---- Helpers shared by the step definitions ----

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Entries the guide filed under a group, in the order it found them. */
function inGroup(guide: ToolGuide, group: GuideGroupId): ToolGuideEntry[] {
  return guide.groups.find((g) => g.id === group)?.entries ?? [];
}

/**
 * The key whose Ctrl/Cmd chord the swap silently fails to reach. This is the
 * finding the guide exists to surface and the reason OS macros exist, so both
 * the swap step and the OS-macro step want to name it. It is not confined to
 * one guide group — a bypassed macro is filed under Macros — which is why the
 * OS steps draw from `guide.os.entries` rather than from a group.
 */
function bypassWarning(guide: ToolGuide): ToolGuideEntry | null {
  return guide.os.entries.find((e) => e.os?.warning) ?? null;
}

// ---- Step definitions ----

interface TopicSpec {
  id: TutorialTopicId;
  title: string;
  why: string;
  pointer?: string;
  /** Where this step's example may come from. Absent means "no example". */
  candidates?: (guide: ToolGuide) => ToolGuideEntry[];
  /**
   * Preference among the candidates — highest wins, ties keep the earlier
   * (i.e. layout-order) entry. A score of 0 or less means "not what this step
   * is about": the OS steps share a candidate pool and must not borrow each
   * other's example, which would teach the wrong lesson twice.
   */
  prefer?: (e: ToolGuideEntry) => number;
  /** Said when no candidate qualifies. Required wherever `candidates` is set. */
  missing?: string;
  /** Extra lines derived from this layout, appended to the fixed body. */
  body?: (ctx: TopicContext) => (string | false | null | undefined)[];
}

interface TopicContext {
  layout: LayoutFile | null;
  guide: ToolGuide;
  /** The entry this step will teach from, if it found one. */
  entry: ToolGuideEntry | null;
}

const fromGroup = (group: GuideGroupId) => (g: ToolGuide) => inGroup(g, group);
const fromOsReport = (g: ToolGuide) => g.os.entries;

const TOPICS: readonly TopicSpec[] = [
  {
    id: "welcome",
    title: "What this app is for",
    why: "Oryx designs the layout; this app owns the firmware. It reads the layout you designed, writes it back out as QMK source, patches in the one thing Oryx has no keycode for — Key Lock — compiles it, and flashes the board.",
    pointer: "The layout menu, top left, is where layouts are opened and seeded.",
    body: (c) => [
      c.layout
        ? `Everything in this tour is read out of the layout that is open right now — ${c.layout.meta.name || "this layout"}, ${count(c.layout.layers.length, "layer")}, ${count(c.layout.combos.length, "combo")}. It is describing your keyboard, not a demo.`
        : "No layout is open yet, so this tour can only explain the features in the abstract. Open or seed a layout and the steps will start pointing at your own keys.",
      "Nothing in the tour changes anything. Leave whenever you like — it reopens from the header.",
    ],
  },
  {
    id: "key",
    title: "A key is a keycode",
    why: "The board does not send letters. It sends a keycode, and the host operating system decides what letter that is. That is what makes a layout portable, and it is also why the OS steps later in this tour are hard.",
    pointer: "Click any key on the board to edit it; the picker opens on the right.",
    missing:
      "Every key on this layout's first layer does something out of the ordinary, so there is no plain one to point at — which is unusual, and rather impressive.",
    body: () => [
      "Search the picker by name or by QMK token. Ctrl+C and Ctrl+V copy a whole key definition between positions, and ⇄ Swap with… trades two keys without going through the clipboard.",
      "Ctrl+S saves. Nothing reaches the board until you flash.",
    ],
  },
  {
    id: "layer",
    title: "Layers",
    why: "Seventy-two keys is not enough for a full keyboard, so a layer gives the same switches a second complete set of meanings. What separates the four layer keycodes is not where they take you but how long you stay: MO holds, TO goes and stays, TG toggles, TT does either depending on how you press it.",
    pointer: "The layer tabs above the board switch which layer you are editing.",
    candidates: fromGroup("layer"),
    prefer: (e) => (e.token.startsWith("MO(") ? 2 : 1),
    missing:
      "This layout has no layer-switch key, so its other layers cannot be reached from the board at all. Assign an MO, TG, TO or TT key from the picker's Layers section.",
    body: (c) => [
      `This layout has ${count(c.layout?.layers.length ?? 0, "layer")} and ${count(inGroup(c.guide, "layer").length, "distinct layer key")} to move between them.`,
      "A key left transparent falls through to the layer below, so a layer only has to define what it changes.",
      "Layers can be renamed, reordered and deleted from the tabs. Deleting one that other keys still switch to is refused rather than silently repointed.",
    ],
  },
  {
    id: "tapHold",
    title: "Tap / hold keys",
    why: "The keys you can reach without moving your hands are the valuable ones, and there are not many of them. A tap/hold key gives one switch two jobs — a character when you tap it, a modifier or a layer when you hold it — so Ctrl can live under a home-row finger instead of in the corner.",
    pointer:
      "The picker builds all three kinds: Mod-tap, Layer-tap and Dual-function.",
    candidates: fromGroup("tapHold"),
    prefer: (e) => (e.kind === "modTap" ? 2 : 1),
    missing:
      "No key in this layout has a hold behaviour yet. The picker's Mod-tap section turns any key into one.",
    body: (c) => [
      `${count(inGroup(c.guide, "tapHold").length, "key in this layout does", "distinct keys in this layout do")} something different on hold.`,
      "The cost is timing. Hold longer than the tapping term and you get the hold action, so a mod-tap under a fast finger will now and then send its tap when you meant to hold — which is why they belong on modifiers you press deliberately and not on the letters you type fastest.",
    ],
  },
  {
    id: "tapDance",
    title: "Tap dances",
    why: "The same idea moved into the time domain: instead of branching on how long you hold a key, a tap dance branches on how many times you tapped it. One key becomes tap, double-tap, hold, and tap-then-hold.",
    pointer: "The picker's tap-dance editor sets each branch and the tapping term.",
    candidates: fromGroup("tapDance"),
    missing:
      "This layout has no tap dance. They earn their place when a key already has an obvious tap meaning and you want a related second one — quote and double-quote, say — rather than an unrelated one.",
    body: () => [
      "The cost here is latency: the board cannot know a tap was single until the tapping term expires without a second one, so every branch you add makes the first one feel slower. Two branches is usually the honest limit.",
    ],
  },
  {
    id: "lock",
    title: "Key Lock",
    why: "This is the customization the whole app exists for. QK_LOCK holds down the next key you press until you press it again — a sticky Shift that also works on ordinary keys, so you can hold an arrow or a modifier without holding it. Oryx has no keycode for it. That is why this layout is compiled here instead of downloaded from Oryx.",
    pointer:
      "Assign it from the picker; the build step patches it into the generated keymap.",
    candidates: fromGroup("lock"),
    missing:
      "No Key Lock key is assigned in this layout. It is the one thing this app adds that Oryx cannot express, so a layout without it is a layout you could have downloaded from Oryx unchanged.",
    body: () => [
      "It is patched into the generated keymap at build time rather than stored in Oryx, so re-seeding from Oryx never loses it and Oryx never has to know about it.",
      "After a flash this is the key to test first: if Key Lock works, the patch survived the rebuild.",
    ],
  },
  {
    id: "macro",
    title: "Macros",
    why: "One key, a fixed sequence of keystrokes — a login, an emoji, a shortcut too long to remember. Each one is written into the generated firmware as a sequence sent from your own code.",
    pointer:
      "The picker's macro editor builds the step list; each step is a chord with an optional pause.",
    candidates: fromGroup("macro"),
    missing:
      "This layout has no macros yet. The picker's Macro section builds one out of any key.",
    body: (c) => [
      `${count(inGroup(c.guide, "macro").length, "macro is", "macros are")} defined in this layout.`,
      "Worth carrying into the OS steps ahead: a macro is sent from firmware code that runs after QMK has finished rewriting modifiers. That detail is invisible here and decisive two steps from now.",
    ],
  },
  {
    id: "combo",
    title: "Combos",
    why: "A combo fires when two or more keys you already have are pressed at the same time, so you gain a key without having to find a home for one. It belongs to a single layer, which keeps it from going off under your fingers on every other layer.",
    pointer:
      "Open a combo from the panel under the board; the board itself becomes the trigger picker.",
    candidates: fromGroup("combo"),
    missing:
      "This layout defines no combos. The combo panel under the board makes one: pick its trigger keys on the board, then say what the pair should send.",
    body: (c) => [
      `${count(c.layout?.combos.length ?? 0, "combo is", "combos are")} defined here.`,
      "Choose triggers that are awkward to press by accident and easy on purpose — two keys under one finger fire by mistake, two keys under different fingers do not.",
    ],
  },
  {
    id: "osSwap",
    title: "The Ctrl ↔ Cmd swap",
    why: "One board, two machines. QMK can swap Ctrl and Cmd at the modifier level, so a layout written for one operating system mostly works on the other without being rewritten. “Mostly” is doing a great deal of work in that sentence, and the next step is about the part it cannot do.",
    pointer:
      "The OS controls sit in the header: one previews the swapped board, the other decides how the board picks an OS.",
    candidates: fromOsReport,
    prefer: (e) =>
      e.os?.warning
        ? 4
        : e.os?.relation === "swapped"
          ? 3
          : e.os?.relation === "bypassed"
            ? 2
            : e.os?.relation === "osAware"
              ? 0.5
              : 1,
    missing:
      "No key in this layout carries Ctrl or Cmd, so the swap has nothing to move — and nothing to get wrong.",
    body: (c) => {
      const { os } = c.guide;
      const warn = bypassWarning(c.guide);
      return [
        os.reachable
          ? os.switches.length > 0
            ? // One key named in full, the rest counted. A tour shows you one
              // thing; the guide is where the whole list belongs.
              `This board can reach ${OS_NAME[os.otherOs]} mode: ${os.switches[0]}${
                os.switches.length > 1
                  ? `, and ${count(os.switches.length - 1, "other OS-mode key")}`
                  : ""
              }.`
            : `This board reaches ${OS_NAME[os.otherOs]} mode through host detection — it asks the machine what it is when it is plugged in.`
          : `No OS-mode key is assigned and host detection is off, so this board can only ever be in ${OS_NAME[os.authoredOs]} mode. Everything below is theory until you assign one.`,
        os.reachable &&
          os.detection &&
          "Host detection is on as well, so the board starts in whatever mode the machine reports and the keys above are the manual override.",
        "The swap has two limits that matter more than the feature does. It only moves a lone Ctrl or a lone Cmd, so a chord carrying both is left alone. And it only reaches keycodes that pass through QMK's modifier rewriting at all — macros, dual-function keys and tap dances are sent from firmware code that runs afterwards, so it never touches them.",
        os.counts.swapped > 0 &&
          `${count(os.counts.swapped, "key")} in this layout really ${os.counts.swapped === 1 ? "is" : "are"} rewritten in ${OS_NAME[os.otherOs]} mode.`,
        os.counts.bypassed > 0 &&
          `${count(os.counts.bypassed, "key")} ${os.counts.bypassed === 1 ? "carries" : "carry"} Ctrl or Cmd somewhere the swap cannot reach${warn ? `, and ${warn.title} is the one to look at — it spells a shortcut the swap was expected to fix, and will not.` : "."}`,
      ];
    },
  },
  {
    id: "osMacro",
    title: "OS macros — a key written twice",
    why: "The swap assumes the two systems run the same shortcut with a different modifier. For screen and window navigation that assumption is simply false. End of line is End on Windows and Cmd+→ on macOS. Locking the screen is Win+L against Ctrl+Cmd+Q. Next virtual desktop is Gui+Ctrl+→ against Ctrl+→ — a different NUMBER of modifiers, which no substitution can produce. These are different shortcuts, not one shortcut wearing a different modifier, and no amount of trading Ctrl for Cmd turns one into the other.",
    pointer:
      "The picker's OS-macro editor writes both halves, with a preset library for the shortcuts that differ.",
    candidates: fromOsReport,
    prefer: (e) => (e.os?.relation === "osAware" ? 2 : 0),
    missing:
      "This layout has no OS macros yet. Nothing is broken — it means every Ctrl/Cmd key here is relying on the swap, including any the swap cannot reach.",
    body: (c) => {
      const warn = bypassWarning(c.guide);
      return [
        "There is a second, sharper reason. A macro is sent with SEND_STRING() and register_code16() from process_record_user, which runs past the point where QMK rewrites modifiers — so the Ctrl↔Cmd swap never reaches a macro at all. A macro spelled with Ctrl stays Ctrl on both machines whether you meant it to or not.",
        "An OS macro answers both problems at once. You write the Mac half and the Windows half separately, and the board picks a half at press time from its current OS mode. It is correct on both machines by construction, and it does not depend on the swap — which is the point, because for a macro the swap was never going to arrive.",
        warn &&
          `${warn.title} is this layout's example of the problem: spelled as if the swap would fix it, sitting where the swap cannot reach. Rewriting it as an OS macro is the fix.`,
        c.entry
          ? "Both halves are listed below. Neither is derived from the other — that is what makes the key correct rather than lucky."
          : "One OS-mode key decides which half fires and which way the swap runs, so there is a single source of truth instead of two settings that can disagree.",
      ];
    },
  },
  {
    id: "lighting",
    title: "Per-key lighting",
    why: "The LEDs are part of the layout rather than a separate app: every layer has a base colour and any key can override it. Colour is how you find a layer's few live keys when the rest of the layer is transparent.",
    pointer:
      "The LED panel sits beside the layer tabs; a single key's glow is set in the picker.",
    candidates: fromGroup("lighting"),
    missing:
      "No key in this layout changes the lighting. Per-key colour still works — the LED panel sets a layer's base colour and the picker overrides individual keys.",
    body: () => [
      "The strip along the top of each keycap on the board shows what the firmware will actually light: solid where the key sets its own colour, faded where it inherits the layer's.",
    ],
  },
  {
    id: "effects",
    title: "Effects that move",
    why: "Everything in the last step is still. QMK's RGB Matrix also ships forty-odd animations, and a dozen of them react to typing — the key you strike flares and fades, or throws a ring across the board. They are already in the firmware source; what decides whether you get them is what the generated config.h says.",
    pointer: "The ✨ Effects panel, beside the LED panel above the board.",
    body: (c) => {
      const lighting = c.layout?.settings.lighting;
      if (!lighting) {
        return [
          "This layout does not configure RGB Matrix at all, which is what a layout seeded from Oryx looks like — Oryx has no way to express an effect, so the firmware says nothing about them and the layer colours are the whole story.",
          "Turning it on in the Effects panel changes nothing you can see until you also hand the LEDs over, so it is safe to look.",
          "Worth knowing before you do: the two cannot share the board. The generated indicator repaints every LED from your layer colours after the effect has drawn its frame, so an effect underneath them is not dimmed, it is invisible. The panel makes that a choice rather than a surprise.",
        ];
      }
      const chosen = compiledEffects(lighting);
      const cost = costs(lighting);
      return [
        `This layout compiles in ${count(chosen.length, "effect")} — ${chosen.map(effectLabel).join(", ")} — and boots into ${effectLabel(lighting.effect)}.`,
        lighting.mode === "ledmap"
          ? "It boots in layer-colour mode, so the board looks exactly as the last step described it and the effect is sitting underneath, invisible. A TOGGLE_LAYER_COLOR key stops the repaint and reveals it — that is the switch worth pressing once, to see what is already in your firmware."
          : "The effect owns the board, so this layout's per-layer and per-key colours are not generated into the firmware at all. They are still in the layout; switching back in the Effects panel brings them to the board again.",
        cost.keypresses
          ? `${cost.reactiveEffects.map(effectLabel).join(", ")} ${cost.reactiveEffects.length === 1 ? "is" : "are"} key-reactive, so the firmware compiles in RGB_MATRIX_KEYPRESSES and the matrix scan records which key was hit and when. That is a real cost in firmware size and scan time, paid on every scan whether or not the reactive effect is the one running — the panel says so before a build, rather than leaving it to a build that stops fitting.`
          : "Nothing here is key-reactive, so the matrix scan is untouched. The reactive effects are the ones marked in the panel; picking one is what turns that tracking on.",
        "The effects you did not pick are actively removed from the build. The Moonlander's own board definition turns on forty-eight of them, so an explicit set is how the reactive ones get paid for.",
      ];
    },
  },
  {
    id: "live",
    title: "Live view and the trainer",
    why: "The firmware reports every switch it sees over raw HID, so the app can show you what the board thinks you pressed and which layer it resolved on. That is the only way to tell a layout mistake from a typing mistake. The trainer turns the same channel into a drill: it names a key, you press it, and it weights what it asks next by what you keep getting wrong.",
    pointer:
      "The Live toggle in the header. It claims the same pairing Oryx and Keymapp use, so only one of the three can be connected at a time.",
    body: () => [
      "The browser is read alongside the board for the one thing the firmware cannot answer: what character the host actually received. It annotates the board's own report — it never stands in for it.",
    ],
  },
  {
    id: "versions",
    title: "Saving and version history",
    why: "Every save keeps the version before it, tagged with why it was written — an edit, a re-seed from Oryx, a flash. A layout you flashed and liked is therefore always recoverable, and that is what makes experimenting on the thing you type with survivable.",
    pointer:
      "Save is in the header (Ctrl+S); the history button beside it restores an earlier version.",
    body: () => [
      "Re-seeding from Oryx is a save like any other, so pulling a fresh revision never destroys the local edits it replaced.",
    ],
  },
  {
    id: "guide",
    title: "The Tool Guide",
    why: "This tour shows one thing at a time in an order that builds. The guide shows all of it at once — derived from the same layout by the same code — searchable, printable, and exportable as Markdown for the notes beside your desk. When you stop needing to be taught, the guide is the thing to keep open.",
    pointer: "📖 Guide in the header.",
    body: (c) => [
      c.guide.count > 0
        ? `It has ${count(c.guide.count, "entry", "entries")} for this layout across ${count(c.guide.groups.length, "section")}, including the modifier chords and system keys this tour did not stop on.`
        : "It has nothing to list for this layout yet: every key here explains itself.",
      "It leads with the Ctrl↔Cmd analysis, ordered so the keys most likely to be wrong come first.",
    ],
  },
  {
    id: "flash",
    title: "Build and flash",
    why: "The last step turns the layout back into firmware: it generates keymap.c, config.h and rules.mk, compiles them against QMK, waits for the board to enter its bootloader, and writes the result. This is the step Oryx cannot do for you, because the firmware Oryx would build is not the one you have just described.",
    pointer:
      "Build & Flash runs along the bottom of the window, with the compiler log.",
    body: () => [
      "The board has to be in DFU mode before it can be written to — press its reset button when the panel asks. The pipeline waits for it rather than failing.",
      "When it finishes, test the Key Lock key first: it is the part that was patched in, so it is the part that proves the firmware is yours.",
      "That is the whole app. The guide is in the header whenever you want the reference, and this tour reopens from the same place.",
    ],
  },
];

// ---- Deriving the examples ----

/** Turn a guide entry into the example a step points at. */
function exampleFrom(entry: ToolGuideEntry): TutorialExample {
  // The first location is the one to point at: the guide records them in
  // layout order, so it is the earliest place this exact key appears.
  const at = entry.locations[0];
  return {
    entryId: entry.id,
    title: entry.title,
    summary: entry.summary,
    detail: entry.detail,
    token: entry.token,
    layer: at.layer,
    layerName: at.layerName,
    position: at.position,
    keys: [...at.keys],
    os: entry.os,
  };
}

/** The best candidate for this step, or null when none qualifies. */
function pick(guide: ToolGuide, spec: TopicSpec): ToolGuideEntry | null {
  if (!spec.candidates) return null;
  const entries = spec
    .candidates(guide)
    .filter((e) => (e.locations[0]?.keys.length ?? 0) > 0);
  if (entries.length === 0) return null;

  const prefer = spec.prefer;
  if (!prefer) return entries[0];
  // Replace only on a STRICTLY better score, so ties keep the earlier entry
  // and the tour does not reshuffle itself between renders.
  const best = entries.reduce((a, b) => (prefer(b) > prefer(a) ? b : a));
  return prefer(best) > 0 ? best : null;
}

/**
 * The plain key the tour opens on. The guide excludes it by design, so it is
 * found through the guide's own classifier: `groupFor` returning null is
 * exactly "this key needs no explanation". Bounded to the first layer, which
 * is the one a new user is looking at.
 */
function plainKeyExample(
  layout: LayoutFile | null,
  authored: FriendlyOs,
  label: (n: number) => string,
): TutorialExample | null {
  const keys = layout?.layers[0]?.keys;
  if (!keys) return null;
  const index = keys.findIndex(
    (a) => a.kind === "basic" && groupFor(a) === null,
  );
  if (index < 0) return null;
  const action = keys[index];
  const summary = describeAction(action, authored, label);
  return {
    entryId: "",
    // "Sends A." is the sentence; "A" is the name. Both are wanted.
    title: summary.replace(/^Sends /, "").replace(/\.$/, ""),
    summary,
    detail: [],
    token: action.kind === "basic" ? action.code : action.kind,
    layer: 0,
    layerName: label(0),
    position: describePosition(index),
    keys: [index],
    os: null,
  };
}

// ---- Building the tour ----

/**
 * The whole tour for a layout. Every step is always present: a step whose
 * feature this layout does not use still explains the feature and says so,
 * which is the honest thing to show and keeps the numbering stable, so
 * "step 9 of 16" means the same thing to two people with different layouts.
 *
 * `layerNames` overrides the layers' own titles exactly as the guide takes
 * them, so the tour and the guide name a layer identically.
 */
export function buildTutorial(
  layout: LayoutFile | null,
  layerNames?: readonly string[],
): Tutorial {
  const guide = buildToolGuide(layout, layerNames);
  const authored = authoredOs(layout);
  const label = (n: number) => layerName(layout?.layers, layerNames, n);

  const steps = TOPICS.map((spec, i) => {
    const entry = spec.id === "key" ? null : pick(guide, spec);
    const example =
      spec.id === "key"
        ? plainKeyExample(layout, authored, label)
        : entry
          ? exampleFrom(entry)
          : null;
    const ctx: TopicContext = { layout, guide, entry };
    return {
      id: spec.id,
      number: i + 1,
      title: spec.title,
      why: spec.why,
      body: (spec.body?.(ctx) ?? []).filter((l): l is string => !!l),
      pointer: spec.pointer ?? null,
      example,
      missing: example ? null : (spec.missing ?? null),
    } satisfies TutorialStep;
  });

  return {
    layoutName: guide.layoutName,
    steps,
    examples: steps.filter((s) => s.example).length,
  };
}

/** How many steps the tour has, independent of any layout. */
export const TUTORIAL_LENGTH = TOPICS.length;

/** Every topic id, in tour order — for tests and for progress storage. */
export const TUTORIAL_TOPICS: readonly TutorialTopicId[] = TOPICS.map(
  (t) => t.id,
);
