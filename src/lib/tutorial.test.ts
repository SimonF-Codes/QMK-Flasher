/**
 * The tour's derivation.
 *
 * The promise being pinned here is not the wording of any step — that will
 * change — but the two properties that make the tour worth building this way:
 * a step points at wherever the feature ACTUALLY is (move the key, the step
 * follows), and a step whose feature is absent says so instead of pointing at
 * an empty position.
 */
import { describe, expect, it } from "vitest";
import shippedRaw from "../../shared/default_layout.json";
import seededRaw from "../../shared/fixtures/seeded_layout.json";
import { buildToolGuide } from "./toolGuide";
import {
  TUTORIAL_LENGTH,
  TUTORIAL_TOPICS,
  buildTutorial,
  type TutorialTopicId,
} from "./tutorial";
import { LayoutFileSchema, MOONLANDER_KEY_COUNT, SCHEMA_VERSION } from "./types";
import type { Combo, KeyAction, LayoutFile, Settings } from "./types";

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
  osDetection: false,
  osDefault: "windows",
};

const BLANK: KeyAction = { kind: "transparent" };

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
        return hit ? hit.action : BLANK;
      }),
    })),
    combos: opts.combos ?? [],
    settings: { ...SETTINGS, ...opts.settings },
  };
}

/** A layout with no key that needs explaining, and nothing plain either. */
const EMPTY = layoutWith([]);

/** The Oryx golden fixture — no osMacro/osMode by construction. */
const seeded = LayoutFileSchema.parse(seededRaw);

/** What a fresh install materializes: the above plus the Demo layer. */
const shipped = LayoutFileSchema.parse(shippedRaw);

const MACRO: KeyAction = {
  kind: "macro",
  label: "Sign-off",
  steps: [{ code: "KC_S", delay: 100, mods: [] }],
};

const OS_MACRO: KeyAction = {
  kind: "osMacro",
  label: "End of line",
  mac: [{ code: "KC_RIGHT", delay: 0, mods: ["MOD_LGUI"] }],
  windows: [{ code: "KC_END", delay: 0, mods: [] }],
};

/** A lone Ctrl chord: the swap really does rewrite this one. */
const SWAPPED: KeyAction = {
  kind: "basic",
  code: "KC_C",
  mods: ["MOD_LCTL"],
};

const step = (l: LayoutFile | null, id: TutorialTopicId, names?: string[]) => {
  const found = buildTutorial(l, names).steps.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

// ---- Shape ----

describe("the tour's shape", () => {
  it("is the same length whatever the layout, so step numbers mean something", () => {
    for (const l of [seeded, EMPTY, null]) {
      const t = buildTutorial(l);
      expect(t.steps).toHaveLength(TUTORIAL_LENGTH);
      expect(t.steps.map((s) => s.number)).toEqual(
        Array.from({ length: TUTORIAL_LENGTH }, (_, i) => i + 1),
      );
      expect(t.steps.map((s) => s.id)).toEqual([...TUTORIAL_TOPICS]);
    }
  });

  it("orders the concepts so each one can lean on the last", () => {
    const at = (id: TutorialTopicId) => TUTORIAL_TOPICS.indexOf(id);
    expect(at("key")).toBeLessThan(at("layer"));
    expect(at("layer")).toBeLessThan(at("tapHold"));
    expect(at("tapHold")).toBeLessThan(at("tapDance"));
    expect(at("tapDance")).toBeLessThan(at("macro"));
    expect(at("macro")).toBeLessThan(at("combo"));
    // The OS-macro step's whole argument rests on the swap step's limits.
    expect(at("combo")).toBeLessThan(at("osSwap"));
    expect(at("osSwap")).toBeLessThan(at("osMacro"));
    expect(at("osMacro")).toBeLessThan(at("flash"));
    expect(at("flash")).toBe(TUTORIAL_LENGTH - 1);
  });

  it("every step teaches even with nothing to point at", () => {
    for (const s of buildTutorial(null).steps) {
      expect(s.why.length).toBeGreaterThan(40);
      expect(s.title).toBeTruthy();
    }
  });

  it("never carries an example and a missing note at the same time", () => {
    for (const l of [seeded, EMPTY, null]) {
      for (const s of buildTutorial(l).steps) {
        expect(s.example && s.missing).toBeFalsy();
      }
    }
  });
});

// ---- Derived from the layout, not written down ----

describe("pointing at real keys", () => {
  it("follows a key that moves rather than remembering where it was", () => {
    expect(step(layoutWith([{ index: 5, action: MACRO }]), "macro").example)
      .toMatchObject({ keys: [5], title: "Sign-off" });
    expect(step(layoutWith([{ index: 41, action: MACRO }]), "macro").example)
      .toMatchObject({ keys: [41], title: "Sign-off" });
  });

  it("follows a key onto another layer, and names that layer", () => {
    const l = layoutWith([{ layer: 1, index: 9, action: MACRO }], {
      layerTitles: ["Layer", "Symbols"],
    });
    expect(step(l, "macro").example).toMatchObject({
      layer: 1,
      layerName: "Layer 1 · Symbols",
      keys: [9],
    });
  });

  it("takes the guide's word for what a key is, so the two cannot drift", () => {
    const guide = buildToolGuide(seeded);
    const firstMacro = guide.groups.find((g) => g.id === "macro")!.entries[0];
    const example = step(seeded, "macro").example!;
    expect(example.entryId).toBe(firstMacro.id);
    expect(example.title).toBe(firstMacro.title);
    expect(example.summary).toBe(firstMacro.summary);
    expect(example.detail).toEqual(firstMacro.detail);
    expect(example.keys).toEqual([firstMacro.locations[0].index]);
  });

  it("honours the layer names the app passes in, exactly as the guide does", () => {
    const names = seeded.layers.map((_, i) => `Nav ${i}`);
    const example = step(seeded, "macro", names).example!;
    expect(example.layerName).toBe(`Layer ${example.layer} · Nav ${example.layer}`);
  });

  it("lights every trigger key of a combo, not just one", () => {
    const l = layoutWith([], {
      combos: [
        {
          name: "Escape pair",
          keys: [12, 13, 14],
          layer: 0,
          action: { kind: "basic", code: "KC_ESCAPE" },
        },
      ],
    });
    const example = step(l, "combo").example!;
    expect(example.keys).toEqual([12, 13, 14]);
    expect(example.title).toBe("Escape pair");
  });

  it("opens on a plain key the guide deliberately has no entry for", () => {
    const l = layoutWith([{ index: 30, action: { kind: "basic", code: "KC_A" } }]);
    expect(step(l, "key").example).toMatchObject({
      keys: [30],
      title: "A",
      token: "KC_A",
    });
    // A chord is not plain — it is exactly what the guide DOES file an entry
    // for, so it must not be offered as the ordinary key.
    expect(step(layoutWith([{ index: 30, action: SWAPPED }]), "key").example)
      .toBeNull();
  });

  it("counts the steps that found something", () => {
    expect(buildTutorial(null).examples).toBe(0);
    expect(buildTutorial(EMPTY).examples).toBe(0);
    expect(buildTutorial(seeded).examples).toBeGreaterThan(4);
  });
});

// ---- The layout a new user actually gets ----

describe("the shipped default layout", () => {
  it("gives every layout-derived step a live example", () => {
    // The Demo layer exists so the tour has something real to point at (see
    // `store::DEFAULT_LAYOUT`). This is the contract between that asset and
    // this file: if the layer ever loses a feature, the tour silently starts
    // saying "not in this layout" and only this test notices.
    const degraded = buildTutorial(shipped)
      .steps.filter((s) => !s.example && s.missing)
      .map((s) => s.id);
    expect(degraded).toEqual([]);
  });

  it("has a real OS macro to teach the OS-macro step from", () => {
    const s = step(shipped, "osMacro");
    expect(s.example!.os!.relation).toBe("osAware");
    // Both halves, and they are not the same shortcut — the whole argument.
    expect(s.example!.detail).toHaveLength(2);
    expect(s.example!.os!.mac).not.toBe(s.example!.os!.windows);
  });

  it("can reach the other OS, so the swap step is not describing theory", () => {
    const { os } = buildToolGuide(shipped);
    expect(os.reachable).toBe(true);
    expect(step(shipped, "osSwap").body.join(" ")).not.toContain(
      "No OS-mode key is assigned",
    );
  });
});

// ---- Degrading honestly ----

describe("a layout that does not use a feature", () => {
  it("says so instead of pointing at an empty position", () => {
    for (const l of [EMPTY, null]) {
      for (const id of [
        "key",
        "layer",
        "tapHold",
        "tapDance",
        "lock",
        "macro",
        "combo",
        "osSwap",
        "osMacro",
        "lighting",
      ] as const) {
        const s = step(l, id);
        expect(s.example).toBeNull();
        expect(s.missing).toBeTruthy();
      }
    }
  });

  /**
   * The effects step has no key to point at — RGB Matrix is configured in
   * settings, not bound to a position — so it must teach entirely from what the
   * layout's `lighting` actually says, and say something true when it says
   * nothing at all.
   */
  describe("the effects step", () => {
    it("describes an unconfigured layout as unconfigured, not as broken", () => {
      const body = step(EMPTY, "effects").body.join(" ");
      expect(body).toContain("does not configure RGB Matrix");
      expect(body).toContain("Oryx");
      // The constraint still gets explained, because it is what makes the
      // choice a choice.
      expect(body).toContain("invisible");
    });

    it("names the effects this layout compiles in, and which one boots", () => {
      const l = layoutWith([], {
        settings: {
          lighting: {
            mode: "ledmap",
            effect: "SOLID_REACTIVE_SIMPLE",
            extraEffects: ["BREATHING"],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactiveBoost: 160,
            reactiveFadeMs: 400,
            applyOnBoot: true,
          },
        },
      });
      const body = step(l, "effects").body.join(" ");
      expect(body).toContain("2 effects");
      expect(body).toContain("Reactive - simple");
      expect(body).toContain("Breathing");
      // Ledmap mode: the honest thing to say is that you cannot see it yet.
      expect(body).toContain("TOGGLE_LAYER_COLOR");
      // And the cost, because it is the surprise this feature must not spring.
      expect(body).toContain("RGB_MATRIX_KEYPRESSES");
    });

    it("says the layer colours are gone when the effect owns the board", () => {
      const l = layoutWith([], {
        settings: {
          lighting: {
            mode: "effect",
            effect: "BREATHING",
            extraEffects: [],
            hue: 0,
            sat: 255,
            val: 175,
            speed: 128,
            reactiveBoost: 160,
            reactiveFadeMs: 400,
            applyOnBoot: true,
          },
        },
      });
      const body = step(l, "effects").body.join(" ");
      expect(body).toContain("not generated into the firmware");
      // Nothing reactive here, so it must not claim a cost it is not paying.
      expect(body).not.toContain("RGB_MATRIX_KEYPRESSES");
      expect(body).toContain("matrix scan is untouched");
    });
  });

  it("tells a new user with no layout at all that there is nothing to point at", () => {
    expect(step(null, "welcome").body.join(" ")).toContain("No layout is open");
  });

  it("still explains the OS macro when the layout has none", () => {
    const s = step(EMPTY, "osMacro");
    expect(s.missing).toContain("no OS macros");
    expect(s.why).toContain("different NUMBER of modifiers");
  });

  it("says the board cannot reach the other OS when nothing switches it", () => {
    expect(step(seeded, "osSwap").body.join(" ")).toContain(
      "No OS-mode key is assigned",
    );
  });

  it("names the OS-mode key once the layout has one", () => {
    const l = layoutWith([
      { index: 3, action: { kind: "osMode", action: "toggle" } },
      { index: 4, action: SWAPPED },
    ]);
    expect(step(l, "osSwap").body.join(" ")).toContain("can reach Mac mode");
  });
});

// ---- The OS steps, which share a pool and must not borrow ----

describe("the OS steps", () => {
  it("leads the swap step with the key the swap silently fails to reach", () => {
    // The seeded layout's Screenshot macro spells a Mac shortcut with Ctrl,
    // and macros never reach mod_config() — the guide's `bypassed` warning.
    const s = step(seeded, "osSwap");
    expect(s.example!.title).toBe("Screenshot");
    expect(s.example!.os!.relation).toBe("bypassed");
    expect(s.example!.os!.warning).toBe(true);
    expect(s.body.join(" ")).toContain("Screenshot is the one to look at");
  });

  it("falls back to a genuinely swapped key when nothing is broken", () => {
    const s = step(layoutWith([{ index: 2, action: SWAPPED }]), "osSwap");
    expect(s.example!.os!.relation).toBe("swapped");
  });

  it("never lets the OS-macro step borrow the swap step's example", () => {
    const l = layoutWith([{ index: 2, action: SWAPPED }]);
    expect(step(l, "osSwap").example).not.toBeNull();
    expect(step(l, "osMacro").example).toBeNull();
    expect(step(l, "osMacro").missing).toContain("no OS macros");
  });

  it("shows both halves of a real OS macro, neither derived from the other", () => {
    const l = layoutWith([{ index: 60, action: OS_MACRO }]);
    const s = step(l, "osMacro");
    expect(s.example).toMatchObject({ keys: [60], title: "End of line" });
    expect(s.example!.os!.relation).toBe("osAware");
    expect(s.example!.detail).toEqual([
      "On Mac: Cmd+→",
      "On Windows: End",
    ]);
    expect(s.body.join(" ")).toContain("Both halves are listed below");
  });

  it("names the broken key as the thing an OS macro fixes", () => {
    expect(step(seeded, "osMacro").body.join(" ")).toContain(
      "Screenshot is this layout's example of the problem",
    );
  });

  it("explains why the swap cannot reach a macro at all", () => {
    const body = step(EMPTY, "osMacro").body.join(" ");
    expect(body).toContain("process_record_user");
    expect(body).toContain("never reaches a macro");
  });
});

// ---- The layout in front of you ----

describe("commentary about this layout", () => {
  it("counts what it found rather than asserting a number", () => {
    expect(step(seeded, "layer").body[0]).toBe(
      `This layout has 7 layers and ${
        buildToolGuide(seeded).groups.find((g) => g.id === "layer")!.entries
          .length
      } distinct layer keys to move between them.`,
    );
  });

  it("gets the singular right", () => {
    const l = layoutWith([{ index: 5, action: MACRO }]);
    expect(step(l, "macro").body[0]).toBe("1 macro is defined in this layout.");
  });

  it("names the layout it is describing", () => {
    expect(step(seeded, "welcome").body[0]).toContain(seeded.meta.name);
    expect(buildTutorial(seeded).layoutName).toBe(seeded.meta.name);
  });
});
