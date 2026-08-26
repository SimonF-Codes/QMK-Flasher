/**
 * TypeScript mirror of the Rust contract types:
 *   - layout schema   src-tauri/src/layout/schema.rs
 *   - events          src-tauri/src/events.rs
 *   - errors          src-tauri/src/error.rs
 *   - geometry        src-tauri/src/geometry.rs
 *   - app config      src-tauri/src/appcfg.rs
 * See docs/CONTRACT.md. Any change MUST stay in lockstep with the Rust side
 * and bump SCHEMA_VERSION in both places.
 */
import { z } from "zod";

/** Current version of the layout-file schema. */
export const SCHEMA_VERSION = 4;
/** Keys per layer in LAYOUT_moonlander argument order. */
export const MOONLANDER_KEY_COUNT = 72;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");
const glow = hexColor.optional();

export const TapSpecSchema = z.object({
  code: z.string().min(1),
  mods: z.array(z.string().min(1)).optional(),
});

export const MacroStepSchema = z.object({
  code: z.string().min(1),
  delay: z.number().int().nonnegative().optional(),
  mods: z.array(z.string().min(1)).optional(),
});

export const LayerSwitchActionSchema = z.enum(["MO", "TG", "TO", "TT"]);

/** Which OS a layout is written for / the board is currently in. */
export const OsTargetSchema = z.enum(["mac", "windows"]);
export type OsTarget = z.infer<typeof OsTargetSchema>;

/** What an `osMode` key does to the board’s OS mode. */
export const OsModeActionSchema = z.enum(["toggle", "mac", "windows", "auto"]);
export type OsModeAction = z.infer<typeof OsModeActionSchema>;

export const KeyActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none"), glow }),
  z.object({ kind: z.literal("transparent"), glow }),
  z.object({
    kind: z.literal("basic"),
    code: z.string().min(1),
    mods: z.array(z.string().min(1)).optional(),
    glow,
  }),
  z.object({
    kind: z.literal("layerSwitch"),
    action: LayerSwitchActionSchema,
    layer: z.number().int().nonnegative(),
    glow,
  }),
  z.object({
    kind: z.literal("modTap"),
    mods: z.array(z.string().min(1)).min(1),
    tap: z.string().min(1),
    glow,
  }),
  z.object({
    kind: z.literal("layerTap"),
    layer: z.number().int().nonnegative(),
    tap: z.string().min(1),
    glow,
  }),
  z.object({
    kind: z.literal("dualFunc"),
    tap: TapSpecSchema,
    hold: TapSpecSchema,
    glow,
  }),
  z.object({ kind: z.literal("qkLock"), glow }),
  z.object({ kind: z.literal("special"), code: z.string().min(1), glow }),
  z.object({
    kind: z.literal("tapDance"),
    tap: z.string().min(1).optional(),
    hold: z.string().min(1).optional(),
    doubleTap: z.string().min(1).optional(),
    tapHold: z.string().min(1).optional(),
    tappingTerm: z.number().int().positive().optional(),
    glow,
  }),
  z.object({
    kind: z.literal("macro"),
    label: z.string(),
    steps: z.array(MacroStepSchema),
    glow,
  }),
  z.object({ kind: z.literal("rgb"), code: z.string().min(1), glow }),
  z.object({
    kind: z.literal("rgbHsv"),
    h: z.number().int().min(0).max(255),
    s: z.number().int().min(0).max(255),
    v: z.number().int().min(0).max(255),
    glow,
  }),
  /**
   * One key, a different step list per host OS — the board picks at press
   * time from its current OS mode. An empty list means "do nothing on that
   * OS"; both empty is rejected by the Rust validator.
   */
  z.object({
    kind: z.literal("osMacro"),
    label: z.string().min(1),
    mac: z.array(MacroStepSchema),
    windows: z.array(MacroStepSchema),
    glow,
  }),
  /** Sets the board’s OS mode (Ctrl↔Cmd swap + which osMacro half fires). */
  z.object({
    kind: z.literal("osMode"),
    action: OsModeActionSchema,
    glow,
  }),
]);

export const LayerSchema = z.object({
  title: z.string(),
  color: hexColor,
  keys: z.array(KeyActionSchema).length(MOONLANDER_KEY_COUNT),
});

export const ComboSchema = z.object({
  name: z.string(),
  keys: z.array(z.number().int().min(0).max(MOONLANDER_KEY_COUNT - 1)),
  layer: z.number().int().nonnegative(),
  action: KeyActionSchema,
});

/**
 * Which painter owns the LEDs. Not a preference — the generated
 * `rgb_matrix_indicators_user()` repaints every LED from the ledmap *after*
 * the active effect has drawn its frame, so with the ledmap emitted no
 * animation is ever visible. The layout picks rather than one silently winning.
 */
export const LightingModeSchema = z.enum(["ledmap", "effect"]);
export type LightingMode = z.infer<typeof LightingModeSchema>;

const byte = z.number().int().min(0).max(255);

/**
 * RGB Matrix configuration: the effects compiled in, which one boots, and the
 * HSV/speed the board starts at. Names are QMK's own — see
 * `shared/rgb_effects.json`.
 *
 * `RGB_MATRIX_KEYPRESSES` and `RGB_MATRIX_FRAMEBUFFER_EFFECTS` are deliberately
 * absent: they are DERIVED from the effect set by codegen (and by
 * `src/lib/rgbEffects.ts` for the UI's cost warning), the same way
 * `TAP_DANCE_ENABLE` is derived from the layout's actual tap dances. A stored
 * flag drifts from the thing it describes.
 */
export const LightingSchema = z.object({
  mode: LightingModeSchema,
  /** RGB_MATRIX_DEFAULT_MODE — the effect the board boots into. */
  effect: z.string().min(1),
  /** Also compiled in, so RGB_MOD can reach them. Each one costs flash. */
  extraEffects: z.array(z.string().min(1)).default([]),
  hue: byte,
  sat: byte,
  val: byte,
  speed: byte,
});

export type Lighting = z.infer<typeof LightingSchema>;

export const SettingsSchema = z.object({
  autoShift: z.boolean(),
  capsWord: z.boolean(),
  tapDance: z.boolean(),
  combos: z.boolean(),
  /** Always true — Key Lock is the point of this app. */
  keyLock: z.literal(true),
  oryx: z.boolean(),
  rgbMatrixCustom: z.boolean(),
  layerState8bit: z.boolean(),
  serialNumber: z.string(),
  rgbStartupSpeed: z.number().int().nonnegative(),
  /** OS_DETECTION_ENABLE — board asks the host what it is at enumeration. */
  osDetection: z.boolean().default(false),
  /** OS assumed before detection answers, and what plain Ctrl/Gui mods mean. */
  osDefault: OsTargetSchema.default("windows"),
  /**
   * Reactive / animated RGB Matrix lighting, or absent for "this layout does
   * not configure RGB Matrix at all" — which is what every Oryx-seeded layout
   * means, and what keeps codegen emitting the exact config.h Oryx would.
   */
  lighting: LightingSchema.optional(),
});

export const SeededFromSchema = z.object({
  layoutId: z.string().min(1),
  revisionHash: z.string().min(1),
  qmkVersion: z.string().min(1),
  seededAt: z.string().min(1),
});

export const MetaSchema = z.object({
  name: z.string(),
  geometry: z.string().min(1),
  seededFrom: SeededFromSchema,
});

export const LayoutFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    meta: MetaSchema,
    layers: z.array(LayerSchema).min(1),
    combos: z.array(ComboSchema),
    settings: SettingsSchema,
  })
  .superRefine((layout, ctx) => {
    layout.combos.forEach((combo, i) => {
      if (combo.layer >= layout.layers.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["combos", i, "layer"],
          message: `combo ${combo.name} references layer ${combo.layer} but only ${layout.layers.length} layers exist`,
        });
      }
    });
  });

export type TapSpec = z.infer<typeof TapSpecSchema>;
export type MacroStep = z.infer<typeof MacroStepSchema>;
export type LayerSwitchAction = z.infer<typeof LayerSwitchActionSchema>;
export type KeyAction = z.infer<typeof KeyActionSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Combo = z.infer<typeof ComboSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type LayoutFile = z.infer<typeof LayoutFileSchema>;

// ---- Geometry (shared/moonlander_geometry.json) ----

export const GeometryKeySchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  r: z.number().optional(),
  rx: z.number().optional(),
  ry: z.number().optional(),
  matrix: z.tuple([z.number().int(), z.number().int()]),
  led: z.number().int().nonnegative(),
});

export const GeometryFileSchema = z.object({
  keyboard: z.string(),
  layoutMacro: z.string(),
  keyCount: z.number().int().positive(),
  keys: z.array(GeometryKeySchema).length(MOONLANDER_KEY_COUNT),
});

export type GeometryKey = z.infer<typeof GeometryKeySchema>;
export type GeometryFile = z.infer<typeof GeometryFileSchema>;

// ---- Multi-layout storage (src-tauri/src/layout/store.rs) ----

export const LayoutSummarySchema = z.object({
  /** Filename slug, stable across renames. */
  id: z.string().min(1),
  /** Display name (meta.name). */
  name: z.string(),
  /** Keyboard id (meta.geometry). */
  keyboard: z.string().min(1),
  /** RFC 3339 file modification time. */
  modifiedAt: z.string(),
});

export type LayoutSummary = z.infer<typeof LayoutSummarySchema>;

// ---- Layout version history (src-tauri/src/layout/store.rs) ----

/** Why a layout version snapshot was taken. */
export const VersionReasonSchema = z.enum([
  /** Auto-snapshot after a save_layout. */
  "save",
  /** Auto-snapshot of the current before a reseed overwrites it. */
  "preReseed",
  /** Auto-snapshot of the current before a restore overwrites it. */
  "preRestore",
  /** Explicit user-requested snapshot via snapshot_layout. */
  "manual",
]);

export const LayoutVersionSummarySchema = z.object({
  /** Sortable id, e.g. "20260721-143000-123". */
  versionId: z.string().min(1),
  /** RFC 3339 (ISO 8601) creation time. */
  createdAt: z.string().min(1),
  reason: VersionReasonSchema,
  /** Optional human note (only set for manual snapshots today). */
  label: z.string().optional(),
});

export type VersionReason = z.infer<typeof VersionReasonSchema>;
export type LayoutVersionSummary = z.infer<typeof LayoutVersionSummarySchema>;

// ---- Keyboard registry (shared/keyboards.json, src-tauri/src/keyboards.rs) ----

export const KeyboardInfoSchema = z.object({
  /** Registry id; LayoutFile.meta.geometry stores this. */
  id: z.string().min(1),
  /** Display name, e.g. "ZSA Moonlander". */
  name: z.string().min(1),
  /** QMK keyboard path in the make target, e.g. "zsa/moonlander/revb". */
  qmkKeyboard: z.string().min(1),
  /** Geometry string for the Oryx GraphQL query. */
  oryxGeometry: z.string().min(1),
  layoutMacro: z.string().min(1),
  keyCount: z.number().int().positive(),
  /** Geometry JSON under shared/. */
  geometryFile: z.string().min(1),
  /** False = listed in the UI but seed/codegen/build refuse it. */
  supported: z.boolean(),
});

export type KeyboardInfo = z.infer<typeof KeyboardInfoSchema>;

// ---- App config (src-tauri/src/appcfg.rs) ----

export const AppConfigSchema = z.object({
  msysPath: z.string().min(1),
  qmkFirmwarePath: z.string().min(1),
  keymapName: z.string().min(1),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---- Generated sources (src-tauri/src/codegen/mod.rs) ----

export const GeneratedSourcesSchema = z.object({
  keymapC: z.string(),
  rulesMk: z.string(),
  configH: z.string(),
});

export type GeneratedSources = z.infer<typeof GeneratedSourcesSchema>;

// ---- Events (src-tauri/src/events.rs) ----

export const EVENT_BUILD_LOG = "build-log";
export const EVENT_PIPELINE_STATE = "pipeline-state";
export const EVENT_DFU_DEVICE = "dfu-device";
export const EVENT_KEY_REPORT = "key-report";
export const EVENT_LAYER_REPORT = "layer-report";

export const BuildLogSchema = z.object({ line: z.string() });

export const PipelinePhaseSchema = z.enum([
  "idle",
  "saving",
  "generating",
  "building",
  "waitingForBootloader",
  "erasing",
  "flashing",
  "leaving",
  "done",
  "error",
]);

export const PipelineStateSchema = z.object({
  phase: PipelinePhaseSchema,
  detail: z.string().optional(),
  /** 0–100 within the current phase, where meaningful. */
  progress: z.number().int().min(0).max(100).optional(),
});

export const DfuDeviceSchema = z.object({ present: z.boolean() });

/**
 * Live key reports straight from the firmware (`src-tauri/src/keyreport`).
 * Two events rather than one: a layer is a level that persists, a keypress is
 * an edge, and the board reports them separately — the switch first, then the
 * layer that switch caused.
 */
export const KeyReportSchema = z.object({
  row: z.number().int().min(0).max(255),
  col: z.number().int().min(0).max(255),
  pressed: z.boolean(),
});

export const LayerReportSchema = z.object({
  layer: z.number().int().min(0).max(255),
});

export type BuildLog = z.infer<typeof BuildLogSchema>;
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema>;
export type DfuDevice = z.infer<typeof DfuDeviceSchema>;
export type KeyReport = z.infer<typeof KeyReportSchema>;
export type LayerReport = z.infer<typeof LayerReportSchema>;

// ---- DFU device listing (src-tauri/src/flash/mod.rs) ----

export const DfuDeviceInfoSchema = z.object({
  vid: z.number().int(),
  pid: z.number().int(),
  serial: z.string().optional(),
});

export type DfuDeviceInfo = z.infer<typeof DfuDeviceInfoSchema>;

// ---- Errors (src-tauri/src/error.rs) ----

export const AppErrorCodeSchema = z.enum([
  "OryxUnreachable",
  "PermutationMismatch",
  "CodegenUnsupportedKey",
  "BuildFailed",
  "DfuNotFound",
  "DfuAccessDenied",
  "DfuVerifyFailed",
  "InvalidLayout",
  "KeyReportUnavailable",
]);

export const AppErrorSchema = z.object({
  code: AppErrorCodeSchema,
  message: z.string(),
  hint: z.string().nullable(),
});

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;
export type AppError = z.infer<typeof AppErrorSchema>;

// ---- Keycode catalog (shared/keycodes.json) ----

export const KeycodeEntrySchema = z.object({
  qmk: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  label: z.string(),
  longLabel: z.string(),
  category: z.string().min(1),
  /** Valid as the tap half of modTap / layerTap / tapDance. */
  tappable: z.boolean(),
  /** Valid inside LCTL()-style mod wrappers. */
  modsApplicable: z.boolean(),
  /** Friendly keycap label in Mac display mode (glyphs like ⌘⏎). Optional. */
  mac: z.string().optional(),
  /** Friendly keycap label in Windows display mode. Optional. */
  windows: z.string().optional(),
});

export type KeycodeEntry = z.infer<typeof KeycodeEntrySchema>;

// ---- RGB Matrix effect catalog (shared/rgb_effects.json) ----

/**
 * One QMK RGB Matrix effect. Mirrors `src-tauri/src/rgb_effects.rs`; the data
 * is read out of `quantum/rgb_matrix/animations/*.h`, so `qmk` is the suffix
 * shared by the effect's `RGB_MATRIX_EFFECT(NAME)` declaration, its
 * `ENABLE_RGB_MATRIX_NAME` compile switch and its `RGB_MATRIX_NAME` mode
 * constant.
 */
export const RgbEffectSchema = z.object({
  /** QMK's name, unprefixed — e.g. "SOLID_REACTIVE_SIMPLE". */
  qmk: z.string().min(1),
  label: z.string().min(1),
  blurb: z.string().min(1),
  /** Needs RGB_MATRIX_KEYPRESSES; compiled out entirely without it. */
  reactive: z.boolean(),
  /** Needs RGB_MATRIX_FRAMEBUFFER_EFFECTS. */
  framebuffer: z.boolean(),
  /** The configured hue changes what this effect draws. */
  hue: z.boolean(),
  /** The configured speed changes what this effect draws. */
  speed: z.boolean(),
  /** Compiled in unconditionally — no ENABLE_RGB_MATRIX_* switch exists. */
  alwaysCompiled: z.boolean(),
});

export type RgbEffect = z.infer<typeof RgbEffectSchema>;
