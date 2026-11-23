/**
 * The Tool Guide: a printable reference to every non-obvious key in the
 * layout, DERIVED from the layout rather than written down.
 *
 * A hand-written guide rots the first time a key moves, so nothing here is
 * static: every entry is walked out of `LayoutFile` and carries the positions
 * it was found at. Plain unmodified `basic` keys are excluded — a key that
 * types `a` needs no guide entry.
 *
 * The OS analysis is the part that earns the file. A key is *swap-relevant*
 * when it carries Ctrl or Gui anywhere, but carrying them is not the same as
 * being swapped, and the difference is exactly what is worth showing:
 *
 *   - `control`  — the key SETS the OS mode (`osMode`, or a legacy `CG_*`).
 *   - `osAware`  — the key has a separate half per OS by construction
 *                  (`osMacro`); the two are listed side by side.
 *   - `swapped`  — the firmware rewrites its mods, so it really does mean
 *                  something else on the other OS. Shown before → after.
 *   - `bypassed` — it carries Ctrl/Gui but compiles to `register_code16()` /
 *                  `SEND_STRING()`, which never reach `mod_config()`. Same on
 *                  both machines whether you wanted that or not. This is the
 *                  `Screenshot` case: `LCTL+LSFT+KC_5` is the Mac shortcut
 *                  spelled as if the swap would reach it — it does not, so
 *                  the key is wrong on one of the two machines.
 *   - `balanced` — it carries BOTH Ctrl and Gui, and QMK's XOR guard
 *                  (`keycode_config.c:126`) leaves such a chord alone.
 *
 * The swap itself is never reimplemented here: `osSwap.applySwap` is the
 * single model of what the board does, and the relation above is *derived*
 * from whether applying it changes anything — so this file cannot drift from
 * the firmware's behavior independently of `osSwap.ts`.
 */
import { GEOMETRY } from "./geometry";
import { entryFor, longLabelFor } from "./keycodes";
import { isNavigatorCode } from "./navigator";
import { ALL_MODS, OS_MODE_KEYCODE, tapLabel } from "./labels";
import {
  HOME_OS,
  applySwap,
  isOsSwitchCode,
  swapCode,
  type FriendlyOs,
} from "./osSwap";
import type {
  Combo,
  KeyAction,
  LayoutFile,
  MacroStep,
  TapSpec,
} from "./types";

// ---- Naming things per OS ----

export const OS_NAME: Record<FriendlyOs, string> = {
  mac: "Mac",
  windows: "Windows",
};

/**
 * Modifier tokens spelled the way each OS spells them. Words, not glyphs:
 * this document gets printed, and ⌃⌥⌘ at 9pt on paper is not a reference.
 */
const MOD_NAME: Record<string, Record<FriendlyOs, string>> = {
  MOD_LCTL: { mac: "Ctrl", windows: "Ctrl" },
  MOD_LSFT: { mac: "Shift", windows: "Shift" },
  MOD_LALT: { mac: "Opt", windows: "Alt" },
  MOD_LGUI: { mac: "Cmd", windows: "Win" },
  MOD_RCTL: { mac: "RCtrl", windows: "RCtrl" },
  MOD_RSFT: { mac: "RShift", windows: "RShift" },
  MOD_RALT: { mac: "ROpt", windows: "RAlt" },
  MOD_RGUI: { mac: "RCmd", windows: "RWin" },
};

/** Bare modifier KEYCODES, same treatment (the catalog gives glyphs). */
const MOD_KEY_NAME: Record<string, Record<FriendlyOs, string>> = {
  KC_LEFT_CTRL: MOD_NAME.MOD_LCTL,
  KC_LEFT_SHIFT: MOD_NAME.MOD_LSFT,
  KC_LEFT_ALT: MOD_NAME.MOD_LALT,
  KC_LEFT_GUI: MOD_NAME.MOD_LGUI,
  KC_RIGHT_CTRL: MOD_NAME.MOD_RCTL,
  KC_RIGHT_SHIFT: MOD_NAME.MOD_RSFT,
  KC_RIGHT_ALT: MOD_NAME.MOD_RALT,
  KC_RIGHT_GUI: MOD_NAME.MOD_RGUI,
};

const MOD_ORDER = new Map(ALL_MODS.map((m, i) => [m as string, i]));

/**
 * Canonical mod order. `swapMods` maps token-by-token, so a Ctrl+Gui chord
 * comes back as Gui+Ctrl — the same set in the other order. Without sorting,
 * the OS diff below would report a difference that the board does not have.
 */
function sortMods(mods: readonly string[]): string[] {
  return [...mods].sort(
    (a, b) => (MOD_ORDER.get(a) ?? 99) - (MOD_ORDER.get(b) ?? 99),
  );
}

/** A single keycode, named for one OS. */
export function codeName(code: string, os: FriendlyOs): string {
  const e = entryFor(code);
  const qmk = e?.qmk ?? code;
  const asMod = MOD_KEY_NAME[qmk];
  if (asMod) return asMod[os];
  if (e) return (os === "mac" ? e.mac : e.windows) ?? e.label;
  return code.replace(/^KC_/, "");
}

/** A chord — mods plus a key — named for one OS: "Ctrl+Shift+5". */
export function chordName(
  code: string,
  mods: readonly string[] | undefined,
  os: FriendlyOs,
): string {
  const base = codeName(code, os);
  if (!mods?.length) return base;
  return [...sortMods(mods).map((m) => MOD_NAME[m]?.[os] ?? m), base].join("+");
}

const specName = (s: TapSpec | MacroStep, os: FriendlyOs) =>
  chordName(s.code, s.mods, os);

/** A macro's step list as one line: "P → U → S → H". */
function stepsLine(steps: readonly MacroStep[], os: FriendlyOs): string {
  if (steps.length === 0) return "nothing";
  return steps.map((s) => specName(s, os)).join(" → ");
}

// ---- Where a key lives ----

/**
 * A physical description of a board position, from the geometry rather than
 * the index — "key 8" means nothing beside a keyboard, "left half · row 1"
 * does. The Moonlander's halves are split by the x gap at 8.
 */
export function describePosition(index: number): string {
  const k = GEOMETRY.keys[index];
  if (!k) return `key ${index}`;
  const side = k.x < 8 ? "left half" : "right half";
  const row = k.y >= 4.3 ? "thumb cluster" : `row ${Math.floor(k.y) + 1}`;
  return `${side} · ${row}`;
}

export interface GuideLocation {
  layer: number;
  /** The layer's display name, already disambiguated by index. */
  layerName: string;
  /** LAYOUT-arg index, or null for a combo (it has no single position). */
  index: number | null;
  /** Physical description of the position, "" for a combo. */
  position: string;
  /**
   * Every LAYOUT-arg position this location occupies. One entry for an
   * ordinary key; a combo's whole trigger set for a combo. Carried so a
   * consumer that wants to point at the board (the tutorial highlights the
   * key it is talking about) does not have to walk the layout a second time
   * to rediscover what the guide already found.
   */
  keys: readonly number[];
}

/**
 * Layer titles in this layout are frequently all "Layer" (Oryx does not force
 * names), so the index always leads — same reasoning as `OsSwapToggle`.
 */
export function layerName(
  layers: readonly { title: string }[] | undefined,
  layerNames: readonly string[] | undefined,
  index: number,
): string {
  const title = (layerNames?.[index] ?? layers?.[index]?.title ?? "").trim();
  return title && title !== "Layer"
    ? `Layer ${index} · ${title}`
    : `Layer ${index}`;
}

// ---- Entries ----

export type GuideGroupId =
  | "os"
  | "macro"
  | "combo"
  | "tapHold"
  | "tapDance"
  | "layer"
  | "lock"
  | "chord"
  | "lighting"
  | "pointer"
  | "system";

export interface GuideGroupInfo {
  id: GuideGroupId;
  title: string;
  blurb: string;
}

/** Section order of the printed reference. */
export const GUIDE_GROUPS: readonly GuideGroupInfo[] = [
  {
    id: "os",
    title: "OS tooling",
    blurb:
      "Keys that switch the board between Mac and Windows, and keys that do something different on each.",
  },
  {
    id: "macro",
    title: "Macros",
    blurb: "One key, a fixed sequence of keystrokes.",
  },
  {
    id: "combo",
    title: "Combos",
    blurb: "Two or more keys pressed at the same time, on one layer.",
  },
  {
    id: "tapHold",
    title: "Tap / hold keys",
    blurb: "One key with a second job when you hold it instead of tapping it.",
  },
  {
    id: "tapDance",
    title: "Tap dances",
    blurb: "One key that counts your taps and branches on the count.",
  },
  {
    id: "layer",
    title: "Layer switches",
    blurb: "Keys that move the board between layers.",
  },
  {
    id: "lock",
    title: "Key Lock",
    blurb:
      "The customization this app exists for — Oryx cannot express it, so it is patched in at build time.",
  },
  {
    id: "chord",
    title: "Modifier chords",
    blurb: "Single keys that fire a whole modifier combination.",
  },
  {
    id: "lighting",
    title: "Lighting",
    blurb: "Keys that change the board's own LEDs.",
  },
  {
    id: "pointer",
    title: "Trackball",
    blurb:
      "Keys for the ZSA Navigator trackball: pointer speed, precision, and scrolling by rolling the ball.",
  },
  {
    id: "system",
    title: "System keys",
    blurb: "Board- and firmware-level keys, not characters.",
  },
] as const;

export type OsRelation =
  | "control"
  | "osAware"
  | "swapped"
  | "bypassed"
  | "balanced";

export const OS_RELATION_LABEL: Record<OsRelation, string> = {
  control: "Sets the OS mode",
  osAware: "OS-aware",
  swapped: "Swapped",
  bypassed: "Not swapped",
  balanced: "Unaffected chord",
};

export interface OsAnalysis {
  relation: OsRelation;
  /** What the key does on each machine, in that machine's own vocabulary. */
  mac: string;
  windows: string;
  /** Whether the board really SENDS something different — not just spells it. */
  differs: boolean;
  /**
   * True when `mac` and `windows` read differently but the keycode is
   * identical — the Gui key is called Cmd on one machine and Win on the other.
   * Without this the guide would report a swap the firmware never performs.
   */
  namingOnly: boolean;
  /** Why it behaves the way it does; the whole point for `bypassed`. */
  note: string;
  /** `bypassed` keys are very likely bugs — surfaced separately. */
  warning: boolean;
}

export interface ToolGuideEntry {
  /** Stable across renders; identical actions share one entry. */
  id: string;
  group: GuideGroupId;
  kind: KeyAction["kind"] | "combo";
  /** Short name — the macro's label, the combo's name, the chord. */
  title: string;
  /** One line: what it does, on the authored OS. */
  summary: string;
  /** Spelled-out steps / branches / triggers. */
  detail: string[];
  /** The QMK token this compiles to, for the advanced reader. */
  token: string;
  /** Every position this exact action was found at. */
  locations: GuideLocation[];
  /** Null when the key has nothing to do with the Ctrl↔Cmd swap. */
  os: OsAnalysis | null;
}

export interface ToolGuideGroup extends GuideGroupInfo {
  entries: ToolGuideEntry[];
}

export interface OsReport {
  /** The OS the layout's plain Ctrl/Gui mods were written against. */
  authoredOs: FriendlyOs;
  otherOs: FriendlyOs;
  /** Can the board actually get to the other mode? */
  reachable: boolean;
  /** How it is reached — the OS-mode keys, described. */
  switches: string[];
  /** Whether the firmware asks the host what it is at enumeration. */
  detection: boolean;
  counts: Record<OsRelation, number>;
  /** Every entry with an `os` analysis, in relation order. */
  entries: ToolGuideEntry[];
}

export interface ToolGuide {
  layoutName: string;
  /** Only non-empty groups. */
  groups: ToolGuideGroup[];
  os: OsReport;
  /** Total entries, across groups. */
  count: number;
}

// ---- Swap relevance ----

/** The four mod tokens the Ctrl↔Gui swap can touch. */
const SWAPPABLE_MODS = new Set([
  "MOD_LCTL",
  "MOD_RCTL",
  "MOD_LGUI",
  "MOD_RGUI",
]);

const modsCarry = (mods: readonly string[] | undefined) =>
  !!mods?.some((m) => SWAPPABLE_MODS.has(m));
/** True for the bare modifier keycodes that trade places (KC_LGUI ↔ KC_LCTL). */
const codeCarries = (code: string | undefined) =>
  !!code && swapCode(code) !== code;
const specCarries = (s: TapSpec | MacroStep | undefined) =>
  !!s && (codeCarries(s.code) || modsCarry(s.mods));

/**
 * Does this key carry Ctrl or Gui anywhere at all? Deliberately broader than
 * "is it swapped" — a key that carries them and is NOT swapped is the finding
 * worth printing.
 */
export function carriesSwappableMod(a: KeyAction): boolean {
  switch (a.kind) {
    case "basic":
      return codeCarries(a.code) || modsCarry(a.mods);
    case "modTap":
      return modsCarry(a.mods);
    case "dualFunc":
      return specCarries(a.tap) || specCarries(a.hold);
    case "macro":
      return a.steps.some(specCarries);
    case "osMacro":
      return true;
    case "tapDance":
      return [a.tap, a.hold, a.doubleTap, a.tapHold].some(codeCarries);
    default:
      return false;
  }
}

/**
 * The kinds `applySwap` — and therefore the firmware — actually rewrites.
 * Keep in step with the switch in `osSwap.applySwap`: everything else
 * compiles past `mod_config()`.
 */
const SWAP_AWARE_KINDS = new Set<KeyAction["kind"]>(["basic", "modTap"]);

// ---- Describing an action ----

const LAYER_SWITCH_VERB: Record<string, (l: string) => string> = {
  MO: (l) => `Hold for ${l}; releases when you let go.`,
  TG: (l) => `Toggles ${l} on and off.`,
  TO: (l) => `Switches to ${l} and stays there.`,
  TT: (l) => `Hold for ${l}; tap it several times in a row to lock it on.`,
};

const OS_MODE_SUMMARY: Record<string, string> = {
  toggle: "Flips the board between Mac and Windows mode.",
  mac: "Puts the board in Mac mode (overrides host detection).",
  windows: "Puts the board in Windows mode (overrides host detection).",
  auto: "Drops the manual override and follows host detection again.",
};

/** One line: what this action does, spelled for `os`. */
export function describeAction(
  a: KeyAction,
  os: FriendlyOs,
  layerLabel: (n: number) => string,
): string {
  switch (a.kind) {
    case "none":
      return "Does nothing.";
    case "transparent":
      return "Falls through to the layer below.";
    case "basic":
      return `Sends ${chordName(a.code, a.mods, os)}.`;
    case "layerSwitch":
      return (LAYER_SWITCH_VERB[a.action] ?? ((l: string) => `${a.action} ${l}`))(
        layerLabel(a.layer),
      );
    case "modTap":
      return `Tap for ${codeName(a.tap, os)}, hold for ${sortMods(a.mods)
        .map((m) => MOD_NAME[m]?.[os] ?? m)
        .join("+")}.`;
    case "layerTap":
      return `Tap for ${codeName(a.tap, os)}, hold for ${layerLabel(a.layer)}.`;
    case "dualFunc":
      return `Tap for ${specName(a.tap, os)}, hold for ${specName(a.hold, os)}.`;
    case "qkLock":
      return "Locks the next key you press down — it stays held until you press it again. Works with modifiers and with ordinary keys.";
    case "special":
      return `${longLabelFor(a.code)}.`;
    case "tapDance":
      return `Counts taps: ${[
        a.tap && `tap → ${codeName(a.tap, os)}`,
        a.hold && `hold → ${codeName(a.hold, os)}`,
        a.doubleTap && `double-tap → ${codeName(a.doubleTap, os)}`,
        a.tapHold && `tap then hold → ${codeName(a.tapHold, os)}`,
      ]
        .filter(Boolean)
        .join(", ")}.`;
    case "macro":
      return `Sends ${stepsLine(a.steps, os)}.`;
    case "rgb":
      return `${longLabelFor(a.code)}.`;
    case "rgbHsv":
      return `Sets the lighting to hue ${a.h}, saturation ${a.s}, brightness ${a.v}.`;
    case "osMacro":
      return `Sends ${stepsLine(os === "mac" ? a.mac : a.windows, os)} on ${OS_NAME[os]}.`;
    case "osMode":
      return OS_MODE_SUMMARY[a.action] ?? `Sets OS mode: ${a.action}.`;
  }
}

/** The spelled-out breakdown under the summary. */
function detailFor(
  a: KeyAction,
  os: FriendlyOs,
  layerLabel: (n: number) => string,
): string[] {
  switch (a.kind) {
    case "macro":
      return a.steps.map(
        (s, i) =>
          `${i + 1}. ${specName(s, os)}${s.delay ? ` · ${s.delay} ms pause` : ""}`,
      );
    case "osMacro":
      return [
        `On Mac: ${stepsLine(a.mac, "mac")}`,
        `On Windows: ${stepsLine(a.windows, "windows")}`,
      ];
    case "tapDance": {
      const lines = [
        a.tap && `Tap → ${codeName(a.tap, os)}`,
        a.hold && `Hold → ${codeName(a.hold, os)}`,
        a.doubleTap && `Double-tap → ${codeName(a.doubleTap, os)}`,
        a.tapHold && `Tap then hold → ${codeName(a.tapHold, os)}`,
      ].filter((l): l is string => !!l);
      if (a.tappingTerm) lines.push(`Tapping term: ${a.tappingTerm} ms`);
      return lines;
    }
    case "dualFunc":
      return [
        `Tap → ${specName(a.tap, os)}`,
        `Hold → ${specName(a.hold, os)}`,
      ];
    case "modTap":
      return [
        `Tap → ${codeName(a.tap, os)}`,
        `Hold → ${sortMods(a.mods)
          .map((m) => MOD_NAME[m]?.[os] ?? m)
          .join("+")}`,
      ];
    case "layerTap":
      return [
        `Tap → ${codeName(a.tap, os)}`,
        `Hold → ${layerLabel(a.layer)}`,
      ];
    default:
      return [];
  }
}

/** The short name an entry is filed under. */
function titleFor(
  a: KeyAction,
  os: FriendlyOs,
  layerLabel: (n: number) => string,
): string {
  switch (a.kind) {
    case "macro":
    case "osMacro":
      return a.label || "Macro";
    case "basic":
      return chordName(a.code, a.mods, os);
    case "modTap":
      return `${codeName(a.tap, os)} / hold ${sortMods(a.mods)
        .map((m) => MOD_NAME[m]?.[os] ?? m)
        .join("+")}`;
    case "layerTap":
      return `${codeName(a.tap, os)} / hold ${layerLabel(a.layer)}`;
    case "dualFunc":
      return `${specName(a.tap, os)} / hold ${specName(a.hold, os)}`;
    case "layerSwitch":
      return `${a.action} → ${layerLabel(a.layer)}`;
    case "qkLock":
      return "Key Lock";
    case "tapDance":
      return `Tap dance: ${a.tap ? codeName(a.tap, os) : "unnamed"}`;
    case "special":
    case "rgb":
      return longLabelFor(a.code);
    case "rgbHsv":
      return `Color ${a.h}/${a.s}/${a.v}`;
    case "osMode":
      return longLabelFor(OS_MODE_KEYCODE[a.action] ?? a.action);
    default:
      return tapLabel(a) || a.kind;
  }
}

/** The QMK token, spelled out enough to grep the generated keymap for. */
function tokenFor(a: KeyAction): string {
  switch (a.kind) {
    case "basic":
      return a.mods?.length
        ? sortMods(a.mods).reduceRight(
            (acc, m) => `${m.replace(/^MOD_/, "")}(${acc})`,
            a.code,
          )
        : a.code;
    case "modTap":
      return sortMods(a.mods).length === 1
        ? `${sortMods(a.mods)[0].replace(/^MOD_/, "")}_T(${a.tap})`
        : `MT(${sortMods(a.mods).join(" | ")}, ${a.tap})`;
    case "layerTap":
      return `LT(${a.layer}, ${a.tap})`;
    case "layerSwitch":
      return `${a.action}(${a.layer})`;
    case "qkLock":
      return "QK_LOCK";
    case "special":
    case "rgb":
      return a.code;
    case "rgbHsv":
      return `HSV_${a.h}_${a.s}_${a.v}`;
    case "macro":
      return "ST_MACRO_n";
    case "osMacro":
      return "OS_MACRO_n";
    case "osMode":
      return OS_MODE_KEYCODE[a.action] ?? a.action;
    case "tapDance":
      return "TD(n)";
    case "dualFunc":
      return "DUAL_FUNC_n";
    default:
      return a.kind;
  }
}

// ---- OS analysis ----

/**
 * A behavioral fingerprint: the action with every `mods` list in canonical
 * order. `swapMods` rewrites token by token, so a Ctrl+Gui chord comes back
 * as Gui+Ctrl — the same chord, reordered. Comparing raw JSON would call that
 * a swap; comparing fingerprints does not.
 */
function behaviorKey(a: KeyAction): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== "glow")
          .map(([k, val]) => [
            k,
            k === "mods" && Array.isArray(val)
              ? sortMods(val as string[])
              : canon(val),
          ]),
      );
    }
    return v;
  };
  return stable(canon(a));
}

/**
 * Does a swappable mod appear as a MODIFIER OF ANOTHER KEY, rather than as a
 * modifier key in its own right? That is the distinction between a hard-coded
 * shortcut (`Ctrl+Shift+5` — a Mac shortcut that will not work on Windows)
 * and a plain modifier key (a bare Gui, which each OS reads as its own Gui).
 * Only the former is a problem when the swap fails to reach it.
 */
function carriesSwappableChord(a: KeyAction): boolean {
  switch (a.kind) {
    case "basic":
    case "modTap":
      return modsCarry(a.mods);
    case "dualFunc":
      return modsCarry(a.tap.mods) || modsCarry(a.hold.mods);
    case "macro":
      return a.steps.some((s) => modsCarry(s.mods));
    default:
      return false;
  }
}

const NAMING_NOTE =
  " The two lines above are the same keycode under each platform's own name (Gui is Cmd on a Mac and Win on a PC) — not a difference in what the board sends.";

const BYPASS_NOTE: Partial<Record<KeyAction["kind"], string>> = {
  macro:
    "Macros are sent with SEND_STRING()/register_code16() from process_record_user, which runs past mod_config() — the Ctrl↔Cmd swap never reaches them. This key sends the same thing on both machines.",
  dualFunc:
    "Dual-function keys resolve through register_code16(), which bypasses mod_config() — the Ctrl↔Cmd swap does not reach them. This key sends the same thing on both machines.",
  tapDance:
    "Tap dances resolve through register_code16(), which bypasses mod_config() — the Ctrl↔Cmd swap does not reach them. This key sends the same thing on both machines.",
};

/**
 * How this key relates to the Ctrl↔Cmd swap, or null if it does not.
 *
 * `relation` is derived, not declared: whether the two OS descriptions differ
 * comes out of `applySwap`, so this cannot claim a swap the firmware does not
 * perform. `authored` is the OS the layout's plain mods were written against
 * (`settings.osDefault`), so the *other* OS is the swapped state.
 */
export function analyzeOs(
  a: KeyAction,
  authored: FriendlyOs,
  layerLabel: (n: number) => string,
): OsAnalysis | null {
  const other: FriendlyOs = authored === "windows" ? "mac" : "windows";
  const describeOn = (os: FriendlyOs) =>
    describeAction(os === authored ? a : applySwap(a), os, layerLabel);

  if (a.kind === "osMode" || (a.kind === "special" && isOsSwitchCode(a.code))) {
    const what = describeAction(a, authored, layerLabel);
    return {
      relation: "control",
      mac: what,
      windows: what,
      differs: false,
      namingOnly: false,
      note:
        a.kind === "osMode"
          ? "Sets one mode for both the Ctrl↔Cmd swap and which half of every OS macro fires, so there is one source of truth rather than two."
          : "Legacy CG_* key: it moves the Ctrl↔Cmd swap only, and does not select which half of an OS macro fires.",
      warning: false,
    };
  }

  if (a.kind === "osMacro") {
    const mac = describeAction(a, "mac", layerLabel);
    const windows = describeAction(a, "windows", layerLabel);
    return {
      relation: "osAware",
      mac,
      windows,
      differs: true,
      namingOnly: false,
      note: "Written per OS: the board picks a half at press time from its current OS mode. This key is correct on both machines by construction.",
      warning: false,
    };
  }

  if (!carriesSwappableMod(a)) return null;

  const mac = describeOn("mac");
  const windows = describeOn("windows");
  // Authoritative: does the FIRMWARE rewrite this key? The descriptions can
  // differ without it (Gui reads as Cmd on one machine, Win on the other).
  const rewritten = behaviorKey(applySwap(a)) !== behaviorKey(a);
  const namingOnly = !rewritten && mac !== windows;
  const suffix = namingOnly ? NAMING_NOTE : "";

  if (rewritten) {
    return {
      relation: "swapped",
      mac,
      windows,
      differs: true,
      namingOnly: false,
      note: `Written for ${OS_NAME[authored]}; the board rewrites the modifier in ${OS_NAME[other]} mode.`,
      warning: false,
    };
  }

  if (SWAP_AWARE_KINDS.has(a.kind)) {
    return {
      relation: "balanced",
      mac,
      windows,
      differs: false,
      namingOnly,
      note:
        "Carries both Ctrl and Gui, and QMK's swap only moves a lone Ctrl or a lone Gui (the XOR guard in mod_config) — so this chord is identical on both machines." +
        suffix,
      warning: false,
    };
  }

  return {
    relation: "bypassed",
    mac,
    windows,
    differs: false,
    namingOnly,
    note:
      (BYPASS_NOTE[a.kind] ??
        "This kind of key never reaches mod_config(), so the Ctrl↔Cmd swap does not touch it.") + suffix,
    // A bare Gui/Ctrl key that does not swap still lands on each platform's
    // own modifier, so it is merely inconsistent with its swapped neighbours.
    // A hard-coded CHORD that does not swap is a shortcut for one OS only —
    // that is the one worth shouting about.
    warning: carriesSwappableChord(a),
  };
}

// ---- Which keys are worth an entry ----

/** The group an action is filed under, or null if it needs no guide entry. */
export function groupFor(a: KeyAction): GuideGroupId | null {
  switch (a.kind) {
    case "none":
    case "transparent":
      return null;
    case "basic":
      // A key that types `a` explains itself; a chord (or a bare Ctrl/Gui,
      // which the swap moves) does not.
      return a.mods?.length || carriesSwappableMod(a) ? "chord" : null;
    case "osMacro":
    case "osMode":
      return "os";
    case "special":
      if (isOsSwitchCode(a.code)) return "os";
      return isNavigatorCode(a.code) ? "pointer" : "system";
    case "macro":
      return "macro";
    case "modTap":
    case "layerTap":
    case "dualFunc":
      return "tapHold";
    case "tapDance":
      return "tapDance";
    case "layerSwitch":
      return "layer";
    case "qkLock":
      return "lock";
    case "rgb":
    case "rgbHsv":
      return "lighting";
  }
}

/**
 * Order-independent stringify — the same action authored two different ways
 * (or round-tripped through zod) must produce the same key. A replacer array
 * cannot do this: it applies to nested objects too and would erase macro steps.
 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${k}:${stable(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Identity for deduplication: the same action at five positions is one entry. */
function actionKey(a: KeyAction): string {
  const { glow: _glow, ...rest } = a as KeyAction & { glow?: string };
  return stable(rest);
}

// ---- Building the guide ----

/** Display order of the OS report: the keys most likely to be wrong first. */
export const OS_RELATION_ORDER: readonly OsRelation[] = [
  "control",
  "osAware",
  "bypassed",
  "swapped",
  "balanced",
];

function comboDetail(
  combo: Combo,
  layout: LayoutFile,
  label: (n: number) => string,
): string[] {
  const keys = layout.layers[combo.layer]?.keys;
  const names = combo.keys.map((i) => {
    const cap = keys?.[i] ? tapLabel(keys[i]) : "";
    return cap ? `${cap} (key ${i})` : `key ${i}`;
  });
  return [
    `Press together on ${label(combo.layer)}: ${names.join(" + ")}`,
    ...combo.keys.map((i) => `${i} — ${describePosition(i)}`),
  ];
}

/** Appended to a trackball key's entry when the layout attaches no trackball. */
export const NO_TRACKBALL_NOTE =
  "No trackball is attached in this layout's settings, so this key does nothing until one is.";

/**
 * Walk the layout and produce the whole reference.
 *
 * `layerNames` overrides the layers' own titles (the UI keeps friendlier ones
 * than Oryx does); it is indexed by layer.
 */
export function buildToolGuide(
  layout: LayoutFile | null,
  layerNames?: readonly string[],
): ToolGuide {
  const empty: ToolGuide = {
    layoutName: "",
    groups: [],
    count: 0,
    os: {
      authoredOs: HOME_OS,
      otherOs: HOME_OS === "windows" ? "mac" : "windows",
      reachable: false,
      switches: [],
      detection: false,
      counts: {
        control: 0,
        osAware: 0,
        swapped: 0,
        bypassed: 0,
        balanced: 0,
      },
      entries: [],
    },
  };
  if (!layout) return empty;

  const authored: FriendlyOs = layout.settings?.osDefault ?? HOME_OS;
  const other: FriendlyOs = authored === "windows" ? "mac" : "windows";
  const label = (n: number) => layerName(layout.layers, layerNames, n);

  const byKey = new Map<string, ToolGuideEntry>();
  const order: string[] = [];

  const add = (
    a: KeyAction,
    group: GuideGroupId,
    location: GuideLocation,
    override?: Partial<Pick<ToolGuideEntry, "title" | "detail" | "kind">> & {
      /** Forces a distinct entry — combos are never merged with each other. */
      key?: string;
    },
  ) => {
    const key = override?.key ?? `${group}:${actionKey(a)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.locations.push(location);
      return;
    }
    const entry: ToolGuideEntry = {
      id: key,
      group,
      kind: override?.kind ?? a.kind,
      title: override?.title ?? titleFor(a, authored, label),
      summary: describeAction(a, authored, label),
      detail: override?.detail ?? detailFor(a, authored, label),
      token: tokenFor(a),
      locations: [location],
      os: analyzeOs(a, authored, label),
    };
    byKey.set(key, entry);
    order.push(key);
  };

  layout.layers.forEach((layer, li) =>
    layer.keys.forEach((action, ki) => {
      const group = groupFor(action);
      if (!group) return;
      add(action, group, {
        layer: li,
        layerName: label(li),
        index: ki,
        position: describePosition(ki),
        keys: [ki],
      });
    }),
  );

  // Combos are never merged: two combos can fire the same action from two
  // different key pairs, and the trigger is the interesting half.
  layout.combos.forEach((combo, ci) => {
    add(
      combo.action,
      "combo",
      {
        layer: combo.layer,
        layerName: label(combo.layer),
        index: null,
        position: "",
        keys: combo.keys,
      },
      {
        key: `combo:${ci}`,
        kind: "combo",
        title: combo.name || `Combo on ${label(combo.layer)}`,
        detail: comboDetail(combo, layout, label),
      },
    );
  });

  const all = order.map((k) => byKey.get(k)!);

  // The module's keys are ordinary keycodes (zsa/defaults declares them) and
  // compile with or without the trackball, so nothing stops a layout from
  // carrying them while no trackball is attached. Say so where they are read.
  if (!layout.settings?.navigatorTrackball) {
    for (const e of all) {
      if (e.group === "pointer") e.detail.push(NO_TRACKBALL_NOTE);
    }
  }
  const groups: ToolGuideGroup[] = GUIDE_GROUPS.map((g) => ({
    ...g,
    entries: all.filter((e) => e.group === g.id),
  })).filter((g) => g.entries.length > 0);

  const osEntries = all.filter((e) => e.os);
  const counts: Record<OsRelation, number> = {
    control: 0,
    osAware: 0,
    swapped: 0,
    bypassed: 0,
    balanced: 0,
  };
  for (const e of osEntries) counts[e.os!.relation] += 1;

  const switches = osEntries
    .filter((e) => e.os!.relation === "control")
    .flatMap((e) =>
      e.locations.map((l) => `${e.title} — ${l.layerName}, ${l.position}`),
    );

  return {
    layoutName: layout.meta?.name ?? "",
    groups,
    count: all.length,
    os: {
      authoredOs: authored,
      otherOs: other,
      reachable: switches.length > 0 || !!layout.settings?.osDetection,
      switches,
      detection: !!layout.settings?.osDetection,
      counts,
      entries: osEntries.sort(
        (a, b) =>
          OS_RELATION_ORDER.indexOf(a.os!.relation) -
          OS_RELATION_ORDER.indexOf(b.os!.relation),
      ),
    },
  };
}

// ---- Export ----

const where = (e: ToolGuideEntry) =>
  e.locations
    .map((l) =>
      l.index === null
        ? l.layerName
        : `${l.layerName}, key ${l.index} (${l.position})`,
    )
    .join("; ");

/** The whole guide as Markdown, for pasting into notes or a printout. */
export function toolGuideMarkdown(guide: ToolGuide): string {
  const out: string[] = [];
  out.push(`# Tool guide — ${guide.layoutName || "layout"}`);
  out.push("");
  out.push(
    `Derived from the layout, ${guide.count} ${guide.count === 1 ? "entry" : "entries"}. Authored for ${OS_NAME[guide.os.authoredOs]}.`,
  );
  out.push("");

  out.push("## Ctrl ↔ Cmd swap");
  out.push("");
  out.push(
    guide.os.reachable
      ? `The board can reach ${OS_NAME[guide.os.otherOs]} mode${
          guide.os.switches.length
            ? ` via: ${guide.os.switches.join("; ")}`
            : " via host detection"
        }.`
      : `No OS-mode key in this layout and host detection is off — the board can only ever be in ${OS_NAME[guide.os.authoredOs]} mode.`,
  );
  out.push("");
  for (const rel of OS_RELATION_ORDER) {
    const entries = guide.os.entries.filter((e) => e.os!.relation === rel);
    if (!entries.length) continue;
    out.push(`### ${OS_RELATION_LABEL[rel]} (${entries.length})`);
    out.push("");
    for (const e of entries) {
      out.push(`- **${e.title}** — ${where(e)}`);
      if (e.os!.mac !== e.os!.windows) {
        out.push(`  - Mac: ${e.os!.mac}`);
        out.push(`  - Windows: ${e.os!.windows}`);
      } else {
        out.push(`  - Both: ${e.os!.mac}`);
      }
      out.push(`  - ${e.os!.note}`);
    }
    out.push("");
  }

  for (const g of guide.groups) {
    out.push(`## ${g.title}`);
    out.push("");
    out.push(`_${g.blurb}_`);
    out.push("");
    for (const e of g.entries) {
      out.push(`### ${e.title}`);
      out.push("");
      out.push(e.summary);
      out.push("");
      for (const d of e.detail) out.push(`- ${d}`);
      if (e.detail.length) out.push("");
      out.push(`Where: ${where(e)}`);
      out.push("");
      out.push(`Compiles to: \`${e.token}\``);
      out.push("");
    }
  }

  return out.join("\n");
}
