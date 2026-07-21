/**
 * Typed IPC over the frozen contract in docs/CONTRACT.md.
 *
 * Mock mode (`VITE_MOCK=1`, or vitest): everything works in a plain browser
 * with no Rust side — load_layout serves the checked-in fixture and
 * start_flash_pipeline replays a canned event script (including a
 * several-second waitingForBootloader hold and an optional failure for the
 * error/retry path via `mockControls.failNextBuild`).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import fixtureJson from "../../shared/fixtures/seeded_layout.json";
import keyboardsJson from "../../shared/keyboards.json";
import geometryJson from "../../shared/moonlander_geometry.json";
import {
  AppErrorSchema,
  BuildLogSchema,
  DfuDeviceSchema,
  EVENT_BUILD_LOG,
  EVENT_DFU_DEVICE,
  EVENT_PIPELINE_STATE,
  GeometryFileSchema,
  KeyboardInfoSchema,
  LayoutFileSchema,
  LayoutSummarySchema,
  PipelineStateSchema,
  type AppConfig,
  type AppError,
  type BuildLog,
  type DfuDevice,
  type DfuDeviceInfo,
  type GeneratedSources,
  type GeometryFile,
  type KeyboardInfo,
  type LayoutFile,
  type LayoutSummary,
  type PipelinePhase,
  type PipelineState,
} from "./types";

export const MOCK: boolean = import.meta.env.VITE_MOCK === "1";

type Unsubscribe = () => void;

export interface Ipc {
  loadLayout(): Promise<LayoutFile>;
  saveLayout(layout: LayoutFile): Promise<void>;
  seedFromOryx(layoutId: string, force: boolean): Promise<LayoutFile>;
  // Multi-layout / multi-keyboard (operate on stored layouts by id).
  listLayouts(): Promise<LayoutSummary[]>;
  selectLayout(id: string): Promise<LayoutFile>;
  createLayout(name: string, keyboardId: string): Promise<LayoutSummary>;
  duplicateLayout(id: string, newName: string): Promise<LayoutSummary>;
  renameLayout(id: string, name: string): Promise<LayoutSummary>;
  deleteLayout(id: string): Promise<void>;
  listKeyboards(): Promise<KeyboardInfo[]>;
  getKeyboardGeometry(keyboardId: string): Promise<GeometryFile>;
  getGeometry(): Promise<GeometryFile>;
  getAppConfig(): Promise<AppConfig>;
  setAppConfig(cfg: AppConfig): Promise<void>;
  generateSources(layout: LayoutFile): Promise<GeneratedSources>;
  buildFirmware(): Promise<string>;
  startFlashPipeline(layout: LayoutFile): Promise<void>;
  cancelPipeline(): Promise<void>;
  listDfuDevices(): Promise<DfuDeviceInfo[]>;
  flashFirmware(binPath: string): Promise<void>;
  onPipelineState(cb: (s: PipelineState) => void): Unsubscribe;
  onBuildLog(cb: (l: BuildLog) => void): Unsubscribe;
  onDfuDevice(cb: (d: DfuDevice) => void): Unsubscribe;
}

/** Normalize anything a command rejects with into an AppError shape. */
export function toAppError(e: unknown): AppError {
  const parsed = AppErrorSchema.safeParse(e);
  if (parsed.success) return parsed.data;
  return {
    code: "InvalidLayout",
    message: e instanceof Error ? e.message : String(e),
    hint: null,
  };
}

// ---------------------------------------------------------------- real mode

function tauriEvent<T>(
  name: string,
  parse: (raw: unknown) => T,
): (cb: (v: T) => void) => Unsubscribe {
  return (cb) => {
    const un = listen(name, (e) => cb(parse(e.payload)));
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  };
}

const realIpc: Ipc = {
  loadLayout: () =>
    invoke("load_layout").then((r) => LayoutFileSchema.parse(r)),
  saveLayout: (layout) => invoke("save_layout", { layout }),
  seedFromOryx: (layoutId, force) =>
    invoke("seed_from_oryx", { layoutId, force }).then((r) =>
      LayoutFileSchema.parse(r),
    ),
  listLayouts: () =>
    invoke("list_layouts").then((r) =>
      z.array(LayoutSummarySchema).parse(r),
    ),
  selectLayout: (id) =>
    invoke("select_layout", { id }).then((r) => LayoutFileSchema.parse(r)),
  createLayout: (name, keyboardId) =>
    invoke("create_layout", { name, keyboardId }).then((r) =>
      LayoutSummarySchema.parse(r),
    ),
  duplicateLayout: (id, newName) =>
    invoke("duplicate_layout", { id, newName }).then((r) =>
      LayoutSummarySchema.parse(r),
    ),
  renameLayout: (id, name) =>
    invoke("rename_layout", { id, name }).then((r) =>
      LayoutSummarySchema.parse(r),
    ),
  deleteLayout: (id) => invoke("delete_layout", { id }),
  listKeyboards: () =>
    invoke("list_keyboards").then((r) => z.array(KeyboardInfoSchema).parse(r)),
  getKeyboardGeometry: (keyboardId) =>
    invoke("get_keyboard_geometry", { keyboardId }).then((r) =>
      GeometryFileSchema.parse(r),
    ),
  getGeometry: () =>
    invoke("get_geometry").then((r) => GeometryFileSchema.parse(r)),
  getAppConfig: () => invoke("get_app_config"),
  setAppConfig: (cfg) => invoke("set_app_config", { cfg }),
  generateSources: (layout) => invoke("generate_sources", { layout }),
  buildFirmware: () => invoke("build_firmware"),
  startFlashPipeline: (layout) => invoke("start_flash_pipeline", { layout }),
  cancelPipeline: () => invoke("cancel_pipeline"),
  listDfuDevices: () => invoke("list_dfu_devices"),
  flashFirmware: (binPath) => invoke("flash_firmware", { binPath }),
  onPipelineState: tauriEvent(EVENT_PIPELINE_STATE, (r) =>
    PipelineStateSchema.parse(r),
  ),
  onBuildLog: tauriEvent(EVENT_BUILD_LOG, (r) => BuildLogSchema.parse(r)),
  onDfuDevice: tauriEvent(EVENT_DFU_DEVICE, (r) => DfuDeviceSchema.parse(r)),
};

// ---------------------------------------------------------------- mock mode

/** Knobs for exercising UI paths that need backend failures. */
export const mockControls = {
  /** Next start_flash_pipeline fails during `building` (error/retry path). */
  failNextBuild: false,
};

const listeners = {
  pipelineState: new Set<(s: PipelineState) => void>(),
  buildLog: new Set<(l: BuildLog) => void>(),
  dfuDevice: new Set<(d: DfuDevice) => void>(),
};

function emitState(phase: PipelinePhase, extra?: Partial<PipelineState>) {
  const state: PipelineState = { phase, ...extra };
  listeners.pipelineState.forEach((cb) => cb(state));
}

function emitLog(line: string) {
  listeners.buildLog.forEach((cb) => cb({ line }));
}

function emitDfu(present: boolean) {
  listeners.dfuDevice.forEach((cb) => cb({ present }));
}

// The fixture will be regenerated by Worker A mid-flight — parse defensively
// so a bad interim state surfaces as a readable error, not a crash.
function mockLoad(): LayoutFile {
  const parsed = LayoutFileSchema.safeParse(fixtureJson);
  if (!parsed.success) {
    throw {
      code: "InvalidLayout",
      message: `mock fixture does not match schema: ${parsed.error.issues[0]?.message}`,
      hint: "shared/fixtures/seeded_layout.json may be mid-regeneration by Worker A.",
    } satisfies AppError;
  }
  return parsed.data;
}

const mockKeyboards: KeyboardInfo[] = z
  .array(KeyboardInfoSchema)
  .parse(keyboardsJson);

function invalidLayout(message: string): AppError {
  return { code: "InvalidLayout", message, hint: null };
}

/** Filename-safe slug — mirrors `store::slug` (Rust) exactly. */
function slug(name: string): string {
  let out = "";
  let dashPending = false;
  for (const c of name) {
    if (/[a-z0-9]/i.test(c)) {
      if (dashPending && out.length > 0) out += "-";
      dashPending = false;
      out += c.toLowerCase();
    } else {
      dashPending = true;
    }
  }
  return out === "" ? "layout" : out;
}

/** A blank all-transparent layout — mirrors `store::blank_layout` (Rust). */
function mockBlankLayout(name: string, kb: KeyboardInfo): LayoutFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    meta: {
      name,
      geometry: kb.id,
      seededFrom: {
        layoutId: "local",
        revisionHash: "local",
        qmkVersion: "n/a",
        seededAt: now,
      },
    },
    layers: [
      {
        title: "Layer",
        color: "#000000",
        keys: Array.from({ length: kb.keyCount }, () => ({
          kind: "transparent" as const,
        })),
      },
    ],
    combos: [],
    settings: {
      autoShift: false,
      capsWord: false,
      tapDance: false,
      combos: false,
      keyLock: true,
      oryx: true,
      rgbMatrixCustom: true,
      layerState8bit: true,
      serialNumber: `qmk-flasher/${kb.id}`,
      rgbStartupSpeed: 60,
    },
  };
}

/**
 * In-memory stand-in for the on-disk layout store (mock IPC only). Lazily
 * seeded from the fixture as the default active layout, matching the real
 * store's `DEFAULT_LAYOUT_ID` ("arrows-together").
 */
interface MockStore {
  layouts: Map<string, LayoutFile>;
  activeId: string;
}
let mock: MockStore | null = null;

function mockStore(): MockStore {
  if (!mock) {
    const fixture = mockLoad();
    const id = slug(fixture.meta.name); // "arrows-together"
    mock = { layouts: new Map([[id, fixture]]), activeId: id };
  }
  return mock;
}

/** A fresh unique id from a name — mirrors `store::new_id` (Rust). */
function mockNewId(store: MockStore, name: string): string {
  const base = slug(name);
  if (!store.layouts.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!store.layouts.has(candidate)) return candidate;
  }
}

function mockSummary(store: MockStore, id: string): LayoutSummary {
  const l = store.layouts.get(id);
  if (!l) throw invalidLayout(`no layout with id ${JSON.stringify(id)}`);
  return {
    id,
    name: l.meta.name,
    keyboard: l.meta.geometry,
    modifiedAt: new Date().toISOString(),
  };
}

/** Reset the mock store between tests (real IPC has no equivalent). */
export function resetMockStore(): void {
  mock = null;
}

const MOCK_BUILD_LOG = [
  "QMK Firmware 25.0",
  "Making zsa/moonlander/reva with keymap qmk_flasher",
  "avr-gcc … compiling keymap.c",
  "Compiling: keyboards/zsa/moonlander/moonlander.c   [OK]",
  "Compiling: quantum/quantum.c                       [OK]",
  "Compiling: quantum/process_keycode/process_key_lock.c [OK]",
  "Linking: .build/zsa_moonlander_reva_qmk_flasher.elf [OK]",
  "Creating binary load file for flashing: .build/zsa_moonlander_reva_qmk_flasher.bin [OK]",
  "Checking file size of zsa_moonlander_reva_qmk_flasher.bin  [OK]",
  " * The firmware size is fine - 213348/262144 (81%, 48796 bytes free)",
];

let pipelineRun = 0;

const sleep = (ms: number, run: number) =>
  new Promise<void>((resolve, reject) =>
    setTimeout(
      () => (run === pipelineRun ? resolve() : reject(new CancelledError())),
      ms,
    ),
  );

class CancelledError extends Error {
  constructor() {
    super("pipeline cancelled");
  }
}

async function mockPipeline(): Promise<void> {
  const run = ++pipelineRun;
  try {
    emitState("saving");
    await sleep(250, run);
    emitState("generating");
    await sleep(450, run);
    emitState("building");
    const failAt = mockControls.failNextBuild ? 6 : Infinity;
    for (let i = 0; i < MOCK_BUILD_LOG.length; i++) {
      if (i === failAt) {
        mockControls.failNextBuild = false;
        emitLog("quantum/quantum.c:412:5: error: unknown keycode 'KC_OOPS' (stub failure)");
        const err: AppError = {
          code: "BuildFailed",
          message: "firmware build failed: make exited with code 2 (stub)",
          hint: "Check the build log; toggle 'Fail next build' off and retry.",
        };
        emitState("error", { detail: err.message });
        throw err;
      }
      emitLog(MOCK_BUILD_LOG[i]);
      await sleep(180, run);
    }
    emitState("waitingForBootloader");
    emitDfu(false);
    await sleep(4000, run); // the user is reaching for the reset key
    emitDfu(true);
    await sleep(400, run);
    for (const progress of [0, 45, 100]) {
      emitState("erasing", { progress });
      await sleep(280, run);
    }
    for (const progress of [0, 20, 40, 60, 80, 100]) {
      emitState("flashing", {
        progress,
        detail: "writing 213348 bytes @ 0x08000000",
      });
      await sleep(240, run);
    }
    emitState("leaving");
    await sleep(350, run);
    emitDfu(false);
    emitState("done");
  } catch (e) {
    if (e instanceof CancelledError) {
      emitState("idle", { detail: "cancelled" });
      return;
    }
    throw e;
  }
}

const mockIpc: Ipc = {
  loadLayout: async () => {
    await new Promise((r) => setTimeout(r, 120));
    const s = mockStore();
    const l = s.layouts.get(s.activeId);
    if (!l) throw invalidLayout(`active layout ${JSON.stringify(s.activeId)} missing`);
    return structuredClone(l);
  },
  saveLayout: async (layout) => {
    console.log("[mock] save_layout", layout.meta.name);
    const s = mockStore();
    s.layouts.set(s.activeId, structuredClone(layout));
  },
  seedFromOryx: async (layoutId) => {
    console.log("[mock] seed_from_oryx", layoutId);
    // Re-seeds the ACTIVE layout, per the baseline semantics.
    const s = mockStore();
    const fixture = mockLoad();
    s.layouts.set(s.activeId, fixture);
    return structuredClone(fixture);
  },
  listLayouts: async () => {
    const s = mockStore();
    return [...s.layouts.keys()].sort().map((id) => mockSummary(s, id));
  },
  selectLayout: async (id) => {
    const s = mockStore();
    const l = s.layouts.get(id);
    if (!l) throw invalidLayout(`no layout with id ${JSON.stringify(id)}`);
    s.activeId = id;
    return structuredClone(l);
  },
  createLayout: async (name, keyboardId) => {
    const s = mockStore();
    const kb = mockKeyboards.find((k) => k.id === keyboardId);
    if (!kb) throw invalidLayout(`no keyboard with id ${JSON.stringify(keyboardId)}`);
    if (!kb.supported) {
      throw invalidLayout(`keyboard ${JSON.stringify(keyboardId)} is not supported yet`);
    }
    const id = mockNewId(s, name);
    s.layouts.set(id, mockBlankLayout(name, kb)); // does not change active
    return mockSummary(s, id);
  },
  duplicateLayout: async (id, newName) => {
    const s = mockStore();
    const src = s.layouts.get(id);
    if (!src) throw invalidLayout(`no layout with id ${JSON.stringify(id)}`);
    const copy = structuredClone(src);
    copy.meta.name = newName;
    const newId = mockNewId(s, newName);
    s.layouts.set(newId, copy);
    return mockSummary(s, newId);
  },
  renameLayout: async (id, name) => {
    const s = mockStore();
    const l = s.layouts.get(id);
    if (!l) throw invalidLayout(`no layout with id ${JSON.stringify(id)}`);
    l.meta.name = name; // id stays stable across renames
    return mockSummary(s, id);
  },
  deleteLayout: async (id) => {
    const s = mockStore();
    if (s.activeId === id) {
      throw invalidLayout(
        `layout ${JSON.stringify(id)} is active — select another layout before deleting it`,
      );
    }
    if (!s.layouts.has(id)) throw invalidLayout(`no layout with id ${JSON.stringify(id)}`);
    s.layouts.delete(id);
  },
  listKeyboards: async () => mockKeyboards.map((k) => ({ ...k })),
  getKeyboardGeometry: async (keyboardId) => {
    const kb = mockKeyboards.find((k) => k.id === keyboardId);
    if (!kb) throw invalidLayout(`no keyboard with id ${JSON.stringify(keyboardId)}`);
    // Only the Moonlander geometry ships today.
    return GeometryFileSchema.parse(geometryJson);
  },
  getGeometry: async () => GeometryFileSchema.parse(geometryJson),
  getAppConfig: async () => ({
    msysPath: "C:\\QMK_MSYS",
    qmkFirmwarePath: "C:\\Users\\fridl\\qmk_firmware",
    keymapName: "qmk_flasher",
  }),
  setAppConfig: async (cfg) => {
    console.log("[mock] set_app_config", cfg);
  },
  generateSources: async () => ({
    keymapC: "// mock keymap.c\n",
    rulesMk: "# mock rules.mk\n",
    configH: "// mock config.h\n",
  }),
  buildFirmware: async () => {
    MOCK_BUILD_LOG.forEach(emitLog);
    return "C:\\mock\\builds\\stub.bin";
  },
  startFlashPipeline: async (layout) => {
    console.log("[mock] start_flash_pipeline", layout.meta.name);
    await mockPipeline();
  },
  cancelPipeline: async () => {
    pipelineRun++; // invalidates all pending sleeps
    emitState("idle", { detail: "cancelled" });
  },
  listDfuDevices: async () => [],
  flashFirmware: async () => {
    await mockPipeline();
  },
  onPipelineState: (cb) => {
    listeners.pipelineState.add(cb);
    return () => listeners.pipelineState.delete(cb);
  },
  onBuildLog: (cb) => {
    listeners.buildLog.add(cb);
    return () => listeners.buildLog.delete(cb);
  },
  onDfuDevice: (cb) => {
    listeners.dfuDevice.add(cb);
    return () => listeners.dfuDevice.delete(cb);
  },
};

export const ipc: Ipc = MOCK ? mockIpc : realIpc;
