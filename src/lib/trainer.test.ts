import { describe, expect, it } from "vitest";
import {
  buildTargets,
  classifyPosition,
  emptyStat,
  findWitness,
  grade,
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
    schemaVersion: 2,
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
      rgbStartupSpeed: 0,
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

function targetAt(
  layout: LayoutFile,
  layer: number,
  position: number,
  asLayerKey = false,
): TrainerTarget {
  const c = classifyPosition(layout, layer, position, asLayerKey);
  if (!c.ok) throw new Error(`expected a target, got ${c.excluded.reason}`);
  return c.target;
}

describe("classifyPosition", () => {
  it("reads a plain key as directly observable", () => {
    const t = targetAt(LAYOUT, 0, 0);
    expect(t.mode).toBe("direct");
    expect(t.expect).toBe("KC_A");
    expect(t.ambiguous).toBe(false);
  });

  it("skips positions with nothing on them", () => {
    const c = classifyPosition(LAYOUT, 0, 71);
    expect(c).toEqual({
      ok: false,
      excluded: { layer: 0, position: 71, reason: "empty" },
    });
  });

  it("excludes keys the firmware consumes, naming the reason", () => {
    // QK_LOCK never reaches the OS — the same blind spot liveKeys.ts documents.
    const c = classifyPosition(LAYOUT, 0, 7);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.excluded.reason).toBe("silent");
  });

  it("excludes TG/TO because they latch the board onto another layer", () => {
    const c = classifyPosition(LAYOUT, 0, 6);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.excluded.reason).toBe("latching");
  });

  it("drills MO through a witness key on the layer it activates", () => {
    const t = targetAt(LAYOUT, 0, 5);
    expect(t.mode).toBe("witness");
    // KC_Z is the first key on layer 1 the base layer cannot produce.
    expect(t.witness).toEqual({ layer: 1, position: 10, code: "KC_Z" });
    expect(t.expect).toBe("KC_Z");
    expect(t.ambiguous).toBe(false);
  });

  it("drills LT by its tap normally, and by its hold when drilling layer keys", () => {
    expect(targetAt(LAYOUT, 0, 8)).toMatchObject({
      mode: "direct",
      expect: "KC_SPACE",
    });
    expect(targetAt(LAYOUT, 0, 8, true)).toMatchObject({
      mode: "witness",
      expect: "KC_Z",
    });
  });

  it("flags a target another position can also answer", () => {
    const dup = makeLayout([
      layerWith({ 0: { kind: "basic", code: "KC_A" }, 3: { kind: "basic", code: "KC_A" } }),
    ]);
    expect(targetAt(dup, 0, 0).ambiguous).toBe(true);
  });

  it("counts duplicates across layers — the other one is still pressable", () => {
    const dup = makeLayout([
      layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base"),
      layerWith({ 9: { kind: "basic", code: "KC_A" } }, "other"),
    ]);
    expect(targetAt(dup, 0, 0).ambiguous).toBe(true);
    expect(targetAt(dup, 1, 9).ambiguous).toBe(true);
  });
});

describe("findWitness", () => {
  it("prefers a key the base layer cannot produce at all", () => {
    expect(findWitness(LAYOUT, 1)).toEqual({
      witness: { layer: 1, position: 10, code: "KC_Z" },
      strong: true,
    });
  });

  it("falls back to a weak witness and says it is weak", () => {
    // Layer 1's only distinctive key is A at a different position: pressing it
    // without holding the layer key gives B, so the drill still works — but the
    // user could also have pressed the base layer's own A.
    const weakish = makeLayout([
      layerWith(
        { 0: { kind: "basic", code: "KC_A" }, 1: { kind: "basic", code: "KC_B" } },
        "base",
      ),
      layerWith({ 1: { kind: "basic", code: "KC_A" } }, "nav"),
    ]);
    expect(findWitness(weakish, 1)).toEqual({
      witness: { layer: 1, position: 1, code: "KC_A" },
      strong: false,
    });
  });

  it("has no witness when the layer emits nothing the base layer doesn't", () => {
    const useless = makeLayout([
      layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base"),
      layerWith({ 0: { kind: "basic", code: "KC_A" } }, "same"),
    ]);
    expect(findWitness(useless, 1)).toBeNull();
  });

  it("ignores transparent keys, which emit the lower layer's code anyway", () => {
    const seeThrough = makeLayout([
      layerWith({ 0: { kind: "basic", code: "KC_A" } }, "base"),
      layerWith({ 0: { kind: "transparent" } }, "clear"),
    ]);
    expect(findWitness(seeThrough, 1)).toBeNull();
  });

  it("never witnesses the base layer against itself", () => {
    expect(findWitness(LAYOUT, 0)).toBeNull();
  });
});

describe("buildTargets", () => {
  it("scopes to the visible layer", () => {
    const { targets } = buildTargets(LAYOUT, "currentLayer", 1);
    expect(targets.map((t) => t.position)).toEqual([10, 11]);
  });

  it("spans every layer when asked to", () => {
    const { targets } = buildTargets(LAYOUT, "allLayers", 0);
    expect(targets.filter((t) => t.layer === 1)).toHaveLength(2);
    expect(targets.some((t) => t.layer === 0 && t.position === 0)).toBe(true);
  });

  it("layerKeys drills only navigation keys, as holds", () => {
    const { targets } = buildTargets(LAYOUT, "layerKeys", 0);
    // MO(1) at 5 and LT(1) at 8 — TG(1) at 6 latches and is left out.
    expect(targets.map((t) => t.position)).toEqual([5, 8]);
    expect(targets.every((t) => t.mode === "witness")).toBe(true);
  });

  it("reports what it left out, but not bare empty positions", () => {
    const { excluded } = buildTargets(LAYOUT, "allLayers", 0);
    expect(excluded.some((e) => e.reason === "empty")).toBe(false);
    expect(excluded).toEqual(
      expect.arrayContaining([
        { layer: 0, position: 6, reason: "latching" },
        { layer: 0, position: 7, reason: "silent" },
      ]),
    );
  });

  it("has nothing to drill on a layer that is out of range", () => {
    expect(buildTargets(LAYOUT, "currentLayer", 99).targets).toEqual([]);
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
  const a: TrainerTarget = {
    layer: 0,
    position: 1,
    mode: "direct",
    expect: "KC_A",
    witness: null,
    ambiguous: false,
  };
  const b: TrainerTarget = { ...a, position: 2, expect: "KC_B" };

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
  const target = targetAt(LAYOUT, 0, 0);

  it("accepts the expected code, through aliases", () => {
    expect(grade(target, "KC_A")).toBe(true);
    const bspc = targetAt(makeLayout([layerWith({ 0: { kind: "basic", code: "KC_BSPC" } })]), 0, 0);
    expect(grade(bspc, "KC_BACKSPACE")).toBe(true);
  });

  it("rejects anything else, including nothing at all", () => {
    expect(grade(target, "KC_B")).toBe(false);
    expect(grade(target, null)).toBe(false);
  });

  it("scores a layer key by its witness, not by the layer key itself", () => {
    const mo = targetAt(LAYOUT, 0, 5);
    expect(grade(mo, "KC_Z")).toBe(true);
    // Pressing the same position without holding MO gives the base layer's
    // key, which is exactly the mistake being drilled.
    expect(grade(mo, "KC_A")).toBe(false);
  });
});

describe("summarize", () => {
  const answer = (over: Partial<Answer>): Answer => ({
    key: "0:1",
    layer: 0,
    position: 1,
    correct: true,
    ms: 500,
    expected: "KC_A",
    got: "KC_A",
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
    const p = promptFor(LAYOUT, targetAt(LAYOUT, 0, 0));
    expect(p.instruction).toBe("Press A on layer 0 · base");
    expect(p.note).toBeNull();
  });

  it("spells out the hold-and-press protocol, and why", () => {
    const p = promptFor(LAYOUT, targetAt(LAYOUT, 0, 5));
    expect(p.instruction).toBe("Hold MO 1 on layer 0 · base, then press Z");
    expect(p.note).toContain("never reach the OS");
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
