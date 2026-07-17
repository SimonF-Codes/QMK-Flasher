/**
 * TypeScript mirror of the layout schema and event payloads defined in
 * `src-tauri/src/layout/schema.rs` and `src-tauri/src/events.rs`.
 * See `docs/CONTRACT.md`.
 *
 * Any change here MUST stay in lockstep with the Rust side and bump
 * SCHEMA_VERSION in both places.
 */
import { z } from "zod";

/** Current version of the seeded-layout schema. */
export const SCHEMA_VERSION = 1;

export const LayerSchema = z.object({
  /** Position in the keymaps[] array. */
  index: z.number().int().nonnegative(),
  /** Layer enum name from keymap.c, e.g. "_BASE". */
  name: z.string().min(1),
  /** Keycodes in LAYOUT-macro argument order, e.g. "KC_A", "MO(_FN)". */
  keys: z.array(z.string().min(1)),
});

export const SourceFilesSchema = z.object({
  keymap_c: z.string().min(1),
  config_h: z.string().min(1),
  rules_mk: z.string().min(1),
});

export const SeededLayoutSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    /** QMK keyboard name, e.g. "ws_together". */
    keyboard: z.string().min(1),
    /** QMK keymap name, e.g. "default". */
    keymap: z.string().min(1),
    /** The LAYOUT macro used in keymap.c, e.g. "LAYOUT_ortho_4x4". */
    layout_macro: z.string().min(1),
    /** Number of keys per layer. */
    key_count: z.number().int().positive(),
    /** Layers in keymap.c order. */
    layers: z.array(LayerSchema).min(1),
    /** Repo-relative paths of the QMK sources this layout was seeded from. */
    source: SourceFilesSchema,
    /** RFC 3339 timestamp of when the seeder produced this file. */
    seeded_at: z.string().min(1),
  })
  .superRefine((layout, ctx) => {
    layout.layers.forEach((layer, i) => {
      if (layer.keys.length !== layout.key_count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", i, "keys"],
          message: `layer ${layer.name} has ${layer.keys.length} keys, expected key_count ${layout.key_count}`,
        });
      }
      if (layer.index !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", i, "index"],
          message: `layer ${layer.name} has index ${layer.index}, expected ${i}`,
        });
      }
    });
  });

export type Layer = z.infer<typeof LayerSchema>;
export type SourceFiles = z.infer<typeof SourceFilesSchema>;
export type SeededLayout = z.infer<typeof SeededLayoutSchema>;

// ---- Events (src-tauri/src/events.rs) ----

export const EVENT_FLASH_PROGRESS = "flash:progress";
export const EVENT_FLASH_DONE = "flash:done";

export const FlashStageSchema = z.enum([
  "compiling",
  "waiting_for_bootloader",
  "flashing",
  "done",
]);

export const FlashProgressSchema = z.object({
  stage: FlashStageSchema,
  /** 0–100 within the current stage. */
  percent: z.number().int().min(0).max(100),
  message: z.string(),
});

export const FlashDoneSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type FlashStage = z.infer<typeof FlashStageSchema>;
export type FlashProgress = z.infer<typeof FlashProgressSchema>;
export type FlashDone = z.infer<typeof FlashDoneSchema>;
