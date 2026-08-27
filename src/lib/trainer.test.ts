import { describe, expect, it } from "vitest";
import {
  buildTargets,
  emptyStat,
  grade,
  isDrillable,
  median,
  parseStats,
  pickTarget,
  promptFor,
  recordAnswer,
  serializeStats,
  statKey,
  STAT_WINDOW,
  summarize,
  weightFor,
  type Answer,
  type KeyStat,
  type StatsMap,
  type TrainerTarget,
} from "./trainer";
import { SCHEMA_VERSION } from "./types";
import type { KeyAction, Layer, LayoutFile } from "./types";

/** A layer of `none` keys with the given positions overridden. */
function layerWith(overrides: Record<number, KeyAction>, title = "L"): Layer {
  const keys: KeyAction[] = Array.from({ length: 72 }, () => ({
    kind: "none" as const,
  }));
  for (const [i, a] of Object.entries(overrides)) keys[Number(i)] = a;
  return { title, color: "#112233", keys };
}

function makeLayout(layers: Layer[]): LayoutFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: "test",
      geometry: "moonlander",
      seededFrom: {
        layoutId: "x",
        revisionHash: "y",
        qmkVersion: "z",
        seededAt: "2026-01-01T00:00:00Z",
      },
    },
    layers,
    combos: [],
    settings: {
      autoShift: false,
      capsWord: false,
      tapDance: false,
      combos: false,
      keyLock: true,
      oryx: false,
      rgbMatrixCustom: false,
      layerState8bit: false,
      serialNumber: "",
      osDetection: false,
      osDefault: "windows" as const,
    },
  };
}

/**
 * Base layer holds A and B; layer 1 is reached by MO(1) at position 5 and has
 * keys the base layer cannot produce (Z at 10, Home at 11).
 */
const LAYOUT = makeLayout([
  layerWith(
    {
      0: { kind: "basic", code: "KC_A" },
      1: { kind: "basic", code: "KC_B" },
      5: { kind: "layerSwitch", action: "MO", layer: 1 },
      6: { kind: "layerSwitch", action: "TG", layer: 1 },
      7: { kind: "qkLock" },
      8: { kind: "layerTap", layer: 1, tap: "KC_SPACE" },
    },
    "base",
  ),
  layerWith(
    {
      10: { kind: "basic", code: "KC_Z" },
      11: { kind: "basic", code: "KC_HOME" },
    },
    "nav",
  ),
]);

const targetAt = (layer: number, position: number): TrainerTarget => ({
  layer,
  position,
});

describe("isDrillable", () => {
  it("takes any position with a key on it", () => {
    expect(isDrillable(LAYOUT, 0, 0)).toBe(true); // a plain letter
    expect(isDrillable(LAYOUT, 0, 8)).toBe(true); // LT()
  });

  it("takes the keys the OS never sees — the firmware reports them", () => {
    // QK_LOCK, MO and TG used to be unaskable because nothing reached the OS.
    // The board reports the switch itself, so they are ordinary targets now.
    expect(isDrillable(LAYOUT, 0, 7)).toBe(true); // QK_LOCK
    expect(isDrillable(LAYOUT, 0, 5)).toBe(true); // MO(1)
    expect(isDrillable(LAYOUT, 0, 6)).toBe(true); // TG(1), latching
  });

  it("refuses positions with nothing to name", () => {
    expect(isDrillable(LAYOUT, 0, 71)).toBe(false); // KC_NO
    expect(isDrillable(LAYOUT, 99, 0)).toBe(false); // no such layer
    const clear = makeLayout([
      layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base"),
      layerWith({ 0: { kind: "transparent" } }, "clear"),
    ]);
    // Transparent is the layer below wearing this layer's hat — asking for it
    // would be asking for a different key at a different address.
    expect(isDrillable(clear, 1, 0)).toBe(false);
  });
});

describe("buildTargets", () => {
  it("scopes to the visible layer", () => {
    expect(buildTargets(LAYOUT, "currentLayer", 1).map((t) => t.position)).toEqual([
      10, 11,
    ]);
  });

  it("spans every layer when asked to", () => {
    const targets = buildTargets(LAYOUT, "allLayers", 0);
    expect(targets.filter((t) => t.layer === 1)).toHaveLength(2);
    expect(targets.filter((t) => t.layer === 0).map((t) => t.position)).toEqual([
      0, 1, 5, 6, 7, 8,
    ]);
  });

  it("layerKeys drills navigation keys, latching ones included", () => {
    // MO(1) at 5, TG(1) at 6, LT(1) at 8. TG used to be left out because a
    // latched board was unobservable; layer-report says where the board is.
    expect(buildTargets(LAYOUT, "layerKeys", 0).map((t) => t.position)).toEqual([
      5, 6, 8,
    ]);
  });

  it("has nothing to drill on a layer that is out of range", () => {
    expect(buildTargets(LAYOUT, "currentLayer", 99)).toEqual([]);
  });
});

describe("weightFor", () => {
  const stat = (over: Partial<KeyStat>): KeyStat => ({ ...emptyStat(), ...over });

  it("favours a missed key over a mastered one", () => {
    const missed = stat({ attempts: 4, hits: 0, window: [0, 0, 0, 0] });
    const mastered = stat({ attempts: 4, hits: 4, window: [1, 1, 1, 1], times: [200, 250] });
    expect(weightFor(missed)).toBeGreaterThan(weightFor(mastered));
  });

  it("favours a slow key over a fast one at the same accuracy", () => {
    const slow = stat({ attempts: 3, hits: 3, window: [1, 1, 1], times: [1900, 2100, 2000] });
    const fast = stat({ attempts: 3, hits: 3, window: [1, 1, 1], times: [300, 350, 320] });
    expect(weightFor(slow)).toBeGreaterThan(weightFor(fast));
  });

  it("puts an unseen key between mastered and repeatedly missed", () => {
    const missed = stat({ attempts: 3, hits: 0, window: [0, 0, 0] });
    const mastered = stat({ attempts: 3, hits: 3, window: [1, 1, 1], times: [300] });
    expect(weightFor(undefined)).toBeGreaterThan(weightFor(mastered));
    expect(weightFor(undefined)).toBeLessThan(weightFor(missed));
  });

  it("never drops a mastered key to zero weight — you still rehearse it", () => {
    const perfect = stat({ attempts: 10, hits: 10, window: Array(10).fill(1), times: [100] });
    expect(weightFor(perfect)).toBe(1);
  });

  it("forgets old misses once the window fills with hits", () => {
    let stats: StatsMap = {};
    for (let i = 0; i < 5; i++) stats = recordAnswer(stats, "k", false, 3000, i);
    const afterMisses = weightFor(stats["k"]);
    for (let i = 0; i < STAT_WINDOW; i++) {
      stats = recordAnswer(stats, "k", true, 200, 100 + i);
    }
    expect(weightFor(stats["k"])).toBeLessThan(afterMisses);
    expect(weightFor(stats["k"])).toBe(1);
  });
});

describe("pickTarget", () => {
  const a: TrainerTarget = { layer: 0, position: 1 };
  const b: TrainerTarget = { layer: 0, position: 2 };

  /** Deterministic: rng returns exactly this fraction of the weight total. */
  const at = (fraction: number) => () => fraction;

  it("returns null with nothing to pick from", () => {
    expect(pickTarget([], {})).toBeNull();
  });

  it("gives the weak key a bigger slice of the range than the strong one", () => {
    const stats: StatsMap = {
      [statKey(0, 1)]: { attempts: 3, hits: 3, window: [1, 1, 1], times: [200], lastAt: 0 },
      [statKey(0, 2)]: { attempts: 3, hits: 0, window: [0, 0, 0], times: [], lastAt: 0 },
    };
    // weights are 1 (a, mastered) and 8 (b, always missed): a owns only the
    // first ninth of the range.
    expect(pickTarget([a, b], stats, at(0.05))).toBe(a);
    expect(pickTarget([a, b], stats, at(0.2))).toBe(b);
    expect(pickTarget([a, b], stats, at(0.99))).toBe(b);
  });

  it("actually draws weak keys more often over many picks", () => {
    const stats: StatsMap = {
      [statKey(0, 1)]: { attempts: 5, hits: 5, window: [1, 1, 1, 1, 1], times: [200], lastAt: 0 },
      [statKey(0, 2)]: { attempts: 5, hits: 0, window: [0, 0, 0, 0, 0], times: [], lastAt: 0 },
    };
    // Deterministic sweep across the whole range instead of a real RNG, so the
    // test cannot flake.
    let weak = 0;
    for (let i = 0; i < 100; i++) {
      if (pickTarget([a, b], stats, at(i / 100)) === b) weak++;
    }
    expect(weak).toBeGreaterThan(70);
  });

  it("does not ask for the same key twice in a row", () => {
    for (let i = 0; i < 20; i++) {
      expect(pickTarget([a, b], {}, at(i / 20), a)).toBe(b);
    }
  });

  it("repeats anyway when it is the only target left", () => {
    expect(pickTarget([a], {}, at(0.5), a)).toBe(a);
  });

  it("stays in range when rng returns 1", () => {
    expect(pickTarget([a, b], {}, () => 1)).toBe(b);
  });
});

describe("recordAnswer", () => {
  it("counts lifetime attempts and windows the recent ones", () => {
    let stats: StatsMap = {};
    for (let i = 0; i < STAT_WINDOW + 3; i++) {
      stats = recordAnswer(stats, "k", true, 100 + i, i);
    }
    expect(stats["k"].attempts).toBe(STAT_WINDOW + 3);
    expect(stats["k"].hits).toBe(STAT_WINDOW + 3);
    expect(stats["k"].window).toHaveLength(STAT_WINDOW);
    expect(stats["k"].times).toHaveLength(STAT_WINDOW);
    // Oldest fell off the front.
    expect(stats["k"].times[0]).toBe(103);
  });

  it("times only correct answers — a miss measures nothing useful", () => {
    let stats = recordAnswer({}, "k", false, 5000, 1);
    expect(stats["k"].times).toEqual([]);
    stats = recordAnswer(stats, "k", true, 400, 2);
    expect(stats["k"].times).toEqual([400]);
    expect(stats["k"].attempts).toBe(2);
    expect(stats["k"].hits).toBe(1);
  });

  it("leaves the input map untouched", () => {
    const before: StatsMap = {};
    recordAnswer(before, "k", true, 100, 1);
    expect(before).toEqual({});
  });
});

describe("grade", () => {
  it("accepts the switch the target names, and nothing else", () => {
    const target = targetAt(0, 5);
    expect(grade(target, 5)).toBe(true);
    expect(grade(target, 6)).toBe(false);
  });

  it("scores a layer key like any other — the board reports the switch", () => {
    // MO(1) emits nothing to the OS, which used to make this unscorable.
    expect(grade(targetAt(0, 5), 5)).toBe(true);
  });
});

describe("summarize", () => {
  const answer = (over: Partial<Answer>): Answer => ({
    key: "0:1",
    layer: 0,
    position: 1,
    correct: true,
    ms: 500,
    got: 1,
    ...over,
  });

  it("is empty and not-a-division-by-zero with no answers", () => {
    expect(summarize([])).toMatchObject({
      attempts: 0,
      accuracy: 0,
      medianMs: null,
      worst: [],
    });
  });

  it("takes the median over correct answers only", () => {
    const s = summarize([
      answer({ ms: 100 }),
      answer({ ms: 300 }),
      answer({ ms: 9000, correct: false }),
    ]);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.medianMs).toBe(200);
    expect(s.misses).toBe(1);
  });

  it("ranks the keys missed most, worst first", () => {
    const s = summarize([
      answer({ key: "0:1", correct: false }),
      answer({ key: "0:2", correct: false }),
      answer({ key: "0:2", position: 2, correct: false }),
      answer({ key: "0:3", correct: true }),
    ]);
    expect(s.worst[0]).toMatchObject({ key: "0:2", misses: 2 });
    expect(s.worst.map((w) => w.key)).not.toContain("0:3");
  });
});

describe("median", () => {
  it("averages the middle pair on an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("takes the middle on an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  it("is null on nothing", () => {
    expect(median([])).toBeNull();
  });
});

describe("promptFor", () => {
  it("names the key and its layer", () => {
    const p = promptFor(LAYOUT, targetAt(0, 0));
    expect(p.instruction).toBe("Press A on layer 0 · base");
    expect(p.note).toBeNull();
  });

  it("names a layer key by its own label, not by a stand-in", () => {
    expect(promptFor(LAYOUT, targetAt(0, 5)).instruction).toBe(
      "Press MO 1 on layer 0 · base",
    );
  });

  it("warns that getting to another layer is navigation, not an answer", () => {
    const p = promptFor(LAYOUT, targetAt(1, 10));
    expect(p.instruction).toBe("Press Z on layer 1 · nav");
    expect(p.note).toContain("aren't scored");
  });
});

describe("stats persistence", () => {
  const stats = recordAnswer({}, "0:1", true, 250, 1234);

  it("round-trips through the stored form", () => {
    expect(parseStats(serializeStats({ mine: stats }))).toEqual({ mine: stats });
  });

  it("starts fresh rather than throwing on junk", () => {
    expect(parseStats(null)).toEqual({});
    expect(parseStats("")).toEqual({});
    expect(parseStats("{not json")).toEqual({});
    expect(parseStats("[]")).toEqual({});
    expect(parseStats(JSON.stringify({ version: 99, byLayout: { a: stats } }))).toEqual({});
  });

  it("drops individual entries it cannot read but keeps the rest", () => {
    const raw = JSON.stringify({
      version: 1,
      byLayout: {
        mine: { "0:1": stats["0:1"], "0:2": { attempts: "lots" } },
        broken: "nope",
      },
    });
    expect(parseStats(raw)).toEqual({ mine: { "0:1": stats["0:1"] } });
  });
});
