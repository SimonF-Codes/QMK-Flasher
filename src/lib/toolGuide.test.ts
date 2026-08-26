import { describe, expect, it } from "vitest";
import seededRaw from "../../shared/fixtures/seeded_layout.json";
import {
  analyzeOs,
  buildToolGuide,
  carriesSwappableMod,
  chordName,
  describePosition,
  groupFor,
  toolGuideMarkdown,
} from "./toolGuide";
import { LayoutFileSchema, MOONLANDER_KEY_COUNT, SCHEMA_VERSION } from "./types";
import type { KeyAction, LayoutFile, Combo, Settings } from "./types";

// ---- Fixtures ----

const SETTINGS: Settings = {
  autoShift: false,
  capsWord: false,
  tapDance: true,
  combos: true,
  keyLock: true,
  oryx: true,
  rgbMatrixCustom: true,
  layerState8bit: false,
  serialNumber: "test",
  rgbStartupSpeed: 60,
  osDetection: false,
  osDefault: "windows",
};

/** A layout with `keys` placed at the front of layer 0, rest transparent. */
function layoutWith(
  placements: { layer?: number; index: number; action: KeyAction }[],
  opts: {
    layerTitles?: string[];
    combos?: Combo[];
    settings?: Partial<Settings>;
  } = {},
): LayoutFile {
  const titles = opts.layerTitles ?? ["Layer"];
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: "Test layout",
      geometry: "moonlander",
      seededFrom: {
        layoutId: "x",
        revisionHash: "y",
        qmkVersion: "z",
        seededAt: "2026-08-24T00:00:00Z",
      },
    },
    layers: titles.map((title, li) => ({
      title,
      color: "#101010",
      keys: Array.from({ length: MOONLANDER_KEY_COUNT }, (_, ki) => {
        const hit = placements.find(
          (p) => (p.layer ?? 0) === li && p.index === ki,
        );
        return hit ? hit.action : ({ kind: "transparent" } as KeyAction);
      }),
    })),
    combos: opts.combos ?? [],
    settings: { ...SETTINGS, ...opts.settings },
  };
}

const one = (action: KeyAction, index = 0) => layoutWith([{ index, action }]);

/** The real Screenshot macro, verbatim from the seeded layout. */
const SCREENSHOT: KeyAction = {
  kind: "macro",
  label: "Screenshot",
  steps: [{ code: "KC_5", delay: 100, mods: ["MOD_LCTL", "MOD_LSFT"] }],
};

const layerLabel = (n: number) => `Layer ${n}`;

// ---- Swap relevance ----

describe("carriesSwappableMod", () => {
  it("finds Ctrl/Gui on a basic key's mods", () => {
    expect(
      carriesSwappableMod({ kind: "basic", code: "KC_C", mods: ["MOD_LCTL"] }),
    ).toBe(true);
    expect(
      carriesSwappableMod({ kind: "basic", code: "KC_C", mods: ["MOD_RGUI"] }),
    ).toBe(true);
  });

  it("finds a BARE modifier keycode, which the swap also moves", () => {
    expect(carriesSwappableMod({ kind: "basic", code: "KC_LEFT_GUI" })).toBe(
      true,
    );
    // Aliases resolve through the same table.
    expect(carriesSwappableMod({ kind: "basic", code: "KC_LCTL" })).toBe(true);
  });

  it("finds them on a modTap", () => {
    expect(
      carriesSwappableMod({
        kind: "modTap",
        mods: ["MOD_LCTL"],
        tap: "KC_ESCAPE",
      }),
    ).toBe(true);
  });

  it("finds them in EITHER half of a dualFunc", () => {
    expect(
      carriesSwappableMod({
        kind: "dualFunc",
        tap: { code: "KC_A" },
        hold: { code: "KC_B", mods: ["MOD_LGUI"] },
      }),
    ).toBe(true);
    expect(
      carriesSwappableMod({
        kind: "dualFunc",
        tap: { code: "KC_A", mods: ["MOD_LCTL"] },
        hold: { code: "KC_B" },
      }),
    ).toBe(true);
  });

  it("finds them in ANY macro step", () => {
    expect(carriesSwappableMod(SCREENSHOT)).toBe(true);
    expect(
      carriesSwappableMod({
        kind: "macro",
        label: "late",
        steps: [{ code: "KC_A" }, { code: "KC_V", mods: ["MOD_LGUI"] }],
      }),
    ).toBe(true);
  });

  it("finds them in ANY tapDance branch", () => {
    expect(
      carriesSwappableMod({ kind: "tapDance", tapHold: "KC_LEFT_CTRL" }),
    ).toBe(true);
    expect(
      carriesSwappableMod({ kind: "tapDance", doubleTap: "KC_RIGHT_GUI" }),
    ).toBe(true);
  });

  it("ignores keys with no Ctrl or Gui anywhere", () => {
    expect(carriesSwappableMod({ kind: "basic", code: "KC_A" })).toBe(false);
    // Shift and Alt are untouched by the Ctrl↔Gui swap.
    expect(
      carriesSwappableMod({
        kind: "basic",
        code: "KC_A",
        mods: ["MOD_LSFT", "MOD_LALT"],
      }),
    ).toBe(false);
    expect(
      carriesSwappableMod({ kind: "tapDance", tap: "KC_BSPC" }),
    ).toBe(false);
    expect(carriesSwappableMod({ kind: "qkLock" })).toBe(false);
  });
});

// ---- The OS classification ----

describe("analyzeOs", () => {
  it("classifies a swapped chord and shows both sides", () => {
    const os = analyzeOs(
      { kind: "basic", code: "KC_C", mods: ["MOD_LCTL"] },
      "windows",
      layerLabel,
    );
    expect(os?.relation).toBe("swapped");
    expect(os?.differs).toBe(true);
    expect(os?.windows).toContain("Ctrl+C");
    expect(os?.mac).toContain("Cmd+C");
    expect(os?.warning).toBe(false);
  });

  it("runs the swap the other way for a Mac-authored layout", () => {
    const os = analyzeOs(
      { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] },
      "mac",
      layerLabel,
    );
    expect(os?.relation).toBe("swapped");
    // Authored on Mac as Cmd+C; Windows mode turns the lone Gui into Ctrl.
    expect(os?.mac).toContain("Cmd+C");
    expect(os?.windows).toContain("Ctrl+C");
  });

  it("swaps a bare modifier keycode", () => {
    const os = analyzeOs(
      { kind: "basic", code: "KC_LEFT_GUI" },
      "windows",
      layerLabel,
    );
    expect(os?.relation).toBe("swapped");
    expect(os?.windows).toContain("Win");
    expect(os?.mac).toContain("Ctrl");
  });

  it("swaps a modTap's hold modifier", () => {
    const os = analyzeOs(
      { kind: "modTap", mods: ["MOD_RCTL"], tap: "KC_ESCAPE" },
      "windows",
      layerLabel,
    );
    expect(os?.relation).toBe("swapped");
    expect(os?.windows).toContain("RCtrl");
    expect(os?.mac).toContain("RCmd");
  });

  it("marks a macro as NOT swapped — the Screenshot case", () => {
    const os = analyzeOs(SCREENSHOT, "windows", layerLabel);
    expect(os?.relation).toBe("bypassed");
    // The whole point: identical on both machines, so it cannot be right on
    // both. LCTL+LSFT+KC_5 is the Mac shortcut spelled as if the swap reached
    // it — the firmware never applies mod_config() to SEND_STRING macros.
    expect(os?.mac).toBe(os?.windows);
    expect(os?.mac).toContain("Ctrl+Shift+5");
    expect(os?.differs).toBe(false);
    expect(os?.warning).toBe(true);
    expect(os?.note).toMatch(/mod_config/);
  });

  it("marks dualFunc and tapDance as NOT swapped for the same reason", () => {
    const df = analyzeOs(
      {
        kind: "dualFunc",
        tap: { code: "KC_C", mods: ["MOD_LCTL"] },
        hold: { code: "KC_V", mods: ["MOD_LCTL"] },
      },
      "windows",
      layerLabel,
    );
    expect(df?.relation).toBe("bypassed");
    expect(df?.mac).toBe(df?.windows);
    expect(df?.warning).toBe(true);

    const td = analyzeOs(
      { kind: "tapDance", tap: "KC_LEFT_GUI", tapHold: "KC_LEFT_CTRL" },
      "windows",
      layerLabel,
    );
    // A tap dance resolves through register_code16 too, so `applySwap` leaves
    // it alone and the board sends the same keycode on both machines.
    expect(td?.relation).toBe("bypassed");
    expect(td?.differs).toBe(false);
    // But its branches are BARE modifiers, and each platform names the Gui key
    // differently. The description differs; the behavior does not — reporting
    // that as a swap would be a lie about the firmware.
    expect(td?.namingOnly).toBe(true);
    expect(td?.mac).toContain("Cmd");
    expect(td?.windows).toContain("Win");
    expect(td?.note).toMatch(/same keycode/i);
    // A bare modifier still lands on each platform's own modifier, so it is
    // not the broken-shortcut case the warning is reserved for.
    expect(td?.warning).toBe(false);
  });

  it("leaves a Ctrl+Gui chord alone — QMK's XOR guard", () => {
    const os = analyzeOs(
      { kind: "basic", code: "KC_RIGHT", mods: ["MOD_LCTL", "MOD_LGUI"] },
      "windows",
      layerLabel,
    );
    // `swapMods` rewrites token by token, so the chord comes back reordered.
    // Reordered is not changed — the classification must compare behavior.
    expect(os?.relation).toBe("balanced");
    expect(os?.differs).toBe(false);
    expect(os?.warning).toBe(false);
    expect(os?.note).toMatch(/XOR|lone/i);
  });

  it("marks osMode and legacy CG_* keys as controls, not as swapped keys", () => {
    for (const a of [
      { kind: "osMode", action: "toggle" } as KeyAction,
      { kind: "special", code: "CG_TOGG" } as KeyAction,
    ]) {
      const os = analyzeOs(a, "windows", layerLabel);
      expect(os?.relation).toBe("control");
      expect(os?.differs).toBe(false);
      expect(os?.warning).toBe(false);
    }
    // The distinction between the two IS the note.
    expect(
      analyzeOs({ kind: "special", code: "CG_TOGG" }, "windows", layerLabel)
        ?.note,
    ).toMatch(/swap only/i);
  });

  it("marks an osMacro as OS-aware and lists both halves", () => {
    const os = analyzeOs(
      {
        kind: "osMacro",
        label: "Desktop right",
        mac: [{ code: "KC_RIGHT", mods: ["MOD_LCTL"] }],
        windows: [{ code: "KC_RIGHT", mods: ["MOD_LGUI", "MOD_LCTL"] }],
      },
      "windows",
      layerLabel,
    );
    expect(os?.relation).toBe("osAware");
    expect(os?.differs).toBe(true);
    expect(os?.warning).toBe(false);
    expect(os?.mac).toContain("Ctrl+→");
    expect(os?.windows).toContain("Ctrl+Win+→");
  });

  it("says 'nothing' for an empty half of an osMacro", () => {
    const os = analyzeOs(
      { kind: "osMacro", label: "Mac only", mac: [{ code: "KC_A" }], windows: [] },
      "windows",
      layerLabel,
    );
    expect(os?.relation).toBe("osAware");
    expect(os?.windows).toMatch(/nothing/i);
  });

  it("returns null for keys the swap has nothing to do with", () => {
    expect(analyzeOs({ kind: "basic", code: "KC_A" }, "windows", layerLabel))
      .toBeNull();
    expect(analyzeOs({ kind: "qkLock" }, "windows", layerLabel)).toBeNull();
    expect(
      analyzeOs({ kind: "special", code: "QK_BOOT" }, "windows", layerLabel),
    ).toBeNull();
    expect(
      analyzeOs({ kind: "layerSwitch", action: "MO", layer: 2 }, "windows", layerLabel),
    ).toBeNull();
  });
});

// ---- Naming ----

describe("chordName", () => {
  it("spells Gui the way each OS spells it", () => {
    expect(chordName("KC_C", ["MOD_LGUI"], "mac")).toBe("Cmd+C");
    expect(chordName("KC_C", ["MOD_LGUI"], "windows")).toBe("Win+C");
  });

  it("orders mods canonically so the OS diff is not fooled by order", () => {
    expect(chordName("KC_5", ["MOD_LSFT", "MOD_LCTL"], "windows")).toBe(
      "Ctrl+Shift+5",
    );
    expect(chordName("KC_5", ["MOD_LCTL", "MOD_LSFT"], "windows")).toBe(
      "Ctrl+Shift+5",
    );
  });

  it("names a bare key with no mods", () => {
    expect(chordName("KC_A", undefined, "windows")).toBe("A");
  });
});

describe("describePosition", () => {
  it("describes a board position physically, not by index", () => {
    expect(describePosition(0)).toMatch(/left half · row 1/);
    expect(describePosition(8)).toMatch(/right half · row 1/);
    expect(describePosition(69)).toMatch(/thumb cluster/);
  });

  it("falls back for an index the geometry does not have", () => {
    expect(describePosition(999)).toBe("key 999");
  });
});

// ---- What earns an entry ----

describe("groupFor", () => {
  it("skips keys that explain themselves", () => {
    expect(groupFor({ kind: "basic", code: "KC_A" })).toBeNull();
    expect(groupFor({ kind: "transparent" })).toBeNull();
    expect(groupFor({ kind: "none" })).toBeNull();
  });

  it("keeps chords and bare Ctrl/Gui keys", () => {
    expect(groupFor({ kind: "basic", code: "KC_C", mods: ["MOD_LSFT"] })).toBe(
      "chord",
    );
    // Plain, but the swap moves it — so it needs saying.
    expect(groupFor({ kind: "basic", code: "KC_LEFT_GUI" })).toBe("chord");
  });

  it("files OS keys together regardless of kind", () => {
    expect(groupFor({ kind: "osMode", action: "mac" })).toBe("os");
    expect(groupFor({ kind: "osMacro", label: "x", mac: [], windows: [] })).toBe(
      "os",
    );
    expect(groupFor({ kind: "special", code: "CG_TOGG" })).toBe("os");
    expect(groupFor({ kind: "special", code: "QK_BOOT" })).toBe("system");
  });
});

// ---- The whole guide ----

describe("buildToolGuide", () => {
  it("degrades to an empty guide with no layout", () => {
    const g = buildToolGuide(null);
    expect(g.groups).toEqual([]);
    expect(g.count).toBe(0);
    expect(g.os.entries).toEqual([]);
    expect(g.os.reachable).toBe(false);
  });

  it("omits empty groups", () => {
    const g = buildToolGuide(one({ kind: "qkLock" }));
    expect(g.groups.map((x) => x.id)).toEqual(["lock"]);
  });

  it("merges an identical action at several positions into one entry", () => {
    const action: KeyAction = { kind: "layerSwitch", action: "MO", layer: 2 };
    const g = buildToolGuide(
      layoutWith(
        [
          { layer: 0, index: 5, action },
          { layer: 0, index: 6, action: { ...action, glow: "#ff0000" } },
          { layer: 1, index: 5, action },
        ],
        { layerTitles: ["Base", "Symbols"] },
      ),
    );
    const layer = g.groups.find((x) => x.id === "layer")!;
    expect(layer.entries).toHaveLength(1);
    // Glow is a lighting concern, not a behavior — it must not split the entry.
    expect(layer.entries[0].locations).toHaveLength(3);
    expect(layer.entries[0].locations[2]).toMatchObject({ layer: 1, index: 5 });
  });

  it("does not merge macros that differ only inside their steps", () => {
    const g = buildToolGuide(
      layoutWith([
        {
          index: 0,
          action: { kind: "macro", label: "m", steps: [{ code: "KC_A" }] },
        },
        {
          index: 1,
          action: { kind: "macro", label: "m", steps: [{ code: "KC_B" }] },
        },
      ]),
    );
    expect(g.groups.find((x) => x.id === "macro")!.entries).toHaveLength(2);
  });

  it("spells out a macro's full step sequence", () => {
    const g = buildToolGuide(
      layoutWith([
        {
          index: 0,
          action: {
            kind: "macro",
            label: "git",
            steps: [
              { code: "KC_G", delay: 100 },
              { code: "KC_I", delay: 100 },
              { code: "KC_T" },
            ],
          },
        },
      ]),
    );
    const e = g.groups[0].entries[0];
    expect(e.title).toBe("git");
    expect(e.summary).toBe("Sends G → I → T.");
    expect(e.detail).toEqual(["1. G · 100 ms pause", "2. I · 100 ms pause", "3. T"]);
  });

  it("names the keys a combo is triggered by, and the layer it listens on", () => {
    const g = buildToolGuide(
      layoutWith(
        [
          { layer: 1, index: 20, action: { kind: "basic", code: "KC_J" } },
          { layer: 1, index: 21, action: { kind: "basic", code: "KC_K" } },
        ],
        {
          layerTitles: ["Base", "Symbols"],
          combos: [
            {
              name: "Escape",
              keys: [20, 21],
              layer: 1,
              action: { kind: "basic", code: "KC_ESCAPE" },
            },
          ],
        },
      ),
    );
    const e = g.groups.find((x) => x.id === "combo")!.entries[0];
    expect(e.title).toBe("Escape");
    expect(e.detail[0]).toBe(
      "Press together on Layer 1 · Symbols: J (key 20) + K (key 21)",
    );
    expect(e.locations[0]).toMatchObject({ layer: 1, index: null });
  });

  it("keeps two combos with the same action apart", () => {
    const action: KeyAction = { kind: "layerSwitch", action: "TG", layer: 1 };
    const g = buildToolGuide(
      layoutWith([], {
        layerTitles: ["Base", "Mirror"],
        combos: [
          { name: "Mirror 1", keys: [6, 7], layer: 0, action },
          { name: "Mirror 2", keys: [20, 21], layer: 0, action },
        ],
      }),
    );
    expect(g.groups.find((x) => x.id === "combo")!.entries).toHaveLength(2);
  });

  it("leads layer names with the index, and only adds a real title", () => {
    const g = buildToolGuide(
      layoutWith([{ layer: 1, index: 0, action: { kind: "qkLock" } }], {
        layerTitles: ["Layer", "Media"],
      }),
    );
    expect(g.groups[0].entries[0].locations[0].layerName).toBe("Layer 1 · Media");

    const plain = buildToolGuide(
      layoutWith([{ index: 0, action: { kind: "qkLock" } }]),
    );
    expect(plain.groups[0].entries[0].locations[0].layerName).toBe("Layer 0");
  });

  it("prefers the layerNames argument over the layers' own titles", () => {
    const g = buildToolGuide(
      layoutWith([{ index: 0, action: { kind: "qkLock" } }], {
        layerTitles: ["Stale"],
      }),
      ["Base"],
    );
    expect(g.groups[0].entries[0].locations[0].layerName).toBe("Layer 0 · Base");
  });

  it("reports the layout as stuck in one OS when nothing can switch it", () => {
    const g = buildToolGuide(one(SCREENSHOT));
    expect(g.os.authoredOs).toBe("windows");
    expect(g.os.otherOs).toBe("mac");
    expect(g.os.reachable).toBe(false);
    expect(g.os.switches).toEqual([]);
    expect(g.os.counts).toMatchObject({ control: 0, osAware: 0, bypassed: 1 });
  });

  it("reports how the other OS is reached once a switch key exists", () => {
    const g = buildToolGuide(
      layoutWith([
        { index: 3, action: { kind: "osMode", action: "toggle" } },
        { index: 4, action: SCREENSHOT },
      ]),
      ["Base"],
    );
    expect(g.os.reachable).toBe(true);
    expect(g.os.switches).toHaveLength(1);
    expect(g.os.switches[0]).toContain("Layer 0 · Base");
    expect(g.os.counts.control).toBe(1);
  });

  it("counts host detection as a way to reach the other OS", () => {
    const g = buildToolGuide(
      layoutWith([{ index: 0, action: SCREENSHOT }], {
        settings: { osDetection: true },
      }),
    );
    expect(g.os.reachable).toBe(true);
    expect(g.os.detection).toBe(true);
    expect(g.os.switches).toEqual([]);
  });

  it("follows settings.osDefault rather than assuming Windows", () => {
    const g = buildToolGuide(
      layoutWith([
        { index: 0, action: { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] } },
      ]),
    );
    expect(g.os.authoredOs).toBe("windows");

    const mac = buildToolGuide(
      layoutWith(
        [
          {
            index: 0,
            action: { kind: "basic", code: "KC_C", mods: ["MOD_LGUI"] },
          },
        ],
        { settings: { osDefault: "mac" } },
      ),
    );
    expect(mac.os.authoredOs).toBe("mac");
    // Authored on Mac, the Cmd stays Cmd on Mac and becomes Ctrl on Windows.
    expect(mac.os.entries[0].os!.mac).toContain("Cmd+C");
    expect(mac.os.entries[0].os!.windows).toContain("Ctrl+C");
  });

  it("orders the OS report so the keys that are wrong come first", () => {
    const g = buildToolGuide(
      layoutWith([
        {
          index: 0,
          action: { kind: "basic", code: "KC_C", mods: ["MOD_LCTL"] },
        },
        { index: 1, action: SCREENSHOT },
        { index: 2, action: { kind: "osMode", action: "toggle" } },
      ]),
    );
    expect(g.os.entries.map((e) => e.os!.relation)).toEqual([
      "control",
      "bypassed",
      "swapped",
    ]);
  });

  it("has nothing to say about OS mode for a layout with none of it", () => {
    const g = buildToolGuide(one({ kind: "qkLock" }));
    expect(g.os.entries).toEqual([]);
    expect(g.os.counts).toEqual({
      control: 0,
      osAware: 0,
      swapped: 0,
      bypassed: 0,
      balanced: 0,
    });
  });
});

// ---- Export ----

describe("toolGuideMarkdown", () => {
  it("writes the swap section, the warning and the group sections", () => {
    const md = toolGuideMarkdown(
      buildToolGuide(
        layoutWith([
          { index: 0, action: SCREENSHOT },
          { index: 1, action: { kind: "osMode", action: "toggle" } },
        ]),
        ["Base"],
      ),
    );
    expect(md).toContain("# Tool guide — Test layout");
    expect(md).toContain("## Ctrl ↔ Cmd swap");
    expect(md).toContain("### Not swapped (1)");
    expect(md).toContain("Both: Sends Ctrl+Shift+5.");
    expect(md).toContain("## OS tooling");
    expect(md).toContain("## Macros");
    expect(md).toContain("key 0 (left half · row 1)");
  });

  it("says so when the board can never leave its home OS", () => {
    const md = toolGuideMarkdown(buildToolGuide(one(SCREENSHOT)));
    expect(md).toMatch(/No OS-mode key in this layout/);
  });

  it("survives an empty guide", () => {
    expect(toolGuideMarkdown(buildToolGuide(null))).toContain("# Tool guide");
  });
});

// ---- Against the real layout ----

describe("the seeded Arrows Together layout", () => {
  const layout = LayoutFileSchema.parse(seededRaw);
  const guide = buildToolGuide(layout);

  it("produces a guide with every group the layout actually uses", () => {
    expect(guide.count).toBeGreaterThan(40);
    expect(guide.groups.map((g) => g.id)).toEqual([
      "macro",
      "combo",
      "tapHold",
      "tapDance",
      "layer",
      "lock",
      "chord",
      "lighting",
      "system",
    ]);
  });

  it("flags Screenshot as the one key the swap will not reach", () => {
    const shot = guide.os.entries.find((e) => e.title === "Screenshot");
    expect(shot).toBeDefined();
    expect(shot!.os!.relation).toBe("bypassed");
    expect(shot!.os!.warning).toBe(true);
    expect(shot!.locations[0]).toMatchObject({ layer: 4, index: 8 });
    expect(shot!.locations[0].layerName).toBe("Layer 4 · Media");
  });

  it("finds the bare Gui key and the Ctrl mod-taps as swapped", () => {
    const swapped = guide.os.entries.filter(
      (e) => e.os!.relation === "swapped",
    );
    expect(swapped.length).toBeGreaterThanOrEqual(5);
    for (const e of swapped) expect(e.os!.differs).toBe(true);
    expect(swapped.some((e) => e.token === "KC_LEFT_GUI")).toBe(true);
    expect(swapped.some((e) => e.token === "LCTL_T(KC_ESCAPE)")).toBe(true);
  });

  it("does not claim the Gui tap dance changes on a Mac", () => {
    // It sends KC_LEFT_GUI on both machines; only the NAME differs. Calling
    // that a swap would put a key in Simon's "affected" list that the board
    // never touches — the exact mistake this classification exists to avoid.
    const td = guide.os.entries.find((e) => e.title.startsWith("Tap dance"));
    expect(td!.os!.relation).toBe("bypassed");
    expect(td!.os!.differs).toBe(false);
    expect(td!.os!.namingOnly).toBe(true);
  });

  it("raises exactly one warning, and it is Screenshot", () => {
    const warned = guide.os.entries.filter((e) => e.os!.warning);
    expect(warned.map((e) => e.title)).toEqual(["Screenshot"]);
  });

  it("finds the Key Lock key — the reason this app exists", () => {
    const lock = guide.groups.find((g) => g.id === "lock")!;
    expect(lock.entries).toHaveLength(1);
    expect(lock.entries[0].token).toBe("QK_LOCK");
  });

  it("has no OS-mode keys yet, and says so rather than breaking", () => {
    expect(guide.os.counts.control).toBe(0);
    expect(guide.os.counts.osAware).toBe(0);
    expect(guide.os.reachable).toBe(false);
    expect(guide.groups.some((g) => g.id === "os")).toBe(false);
  });
});
