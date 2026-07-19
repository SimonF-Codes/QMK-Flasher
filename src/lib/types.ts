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
export const SCHEMA_VERSION = 2;
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

// ---- Keyboard registry (shared/keyboards.json, src-tauri/src/keyboards.rs) ----

export const KeyboardInfoSchema = z.object({
  /** Registry id; LayoutFile.meta.geometry stores this. */
  id: z.string().min(1),
  /** Display name, e.g. "ZSA Moonlander". */
  name: z.string().min(1),
  /** QMK keyboard path in the make target, e.g. "zsa/moonlander/reva". */
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

export type BuildLog = z.infer<typeof BuildLogSchema>;
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema>;
export type DfuDevice = z.infer<typeof DfuDeviceSchema>;

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
});

export type KeycodeEntry = z.infer<typeof KeycodeEntrySchema>;
