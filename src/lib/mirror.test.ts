import { describe, expect, it } from "vitest";
import defaultLayoutJson from "../../shared/default_layout.json";
import { GEOMETRY, keyCenter } from "./geometry";
import {
  DEFAULT_MIRROR_OPTIONS,
  MIRROR_AXIS_X,
  MIRROR_MAP,
  THUMB_POSITIONS,
  appendMirroredLayer,
  isLayerKey,
  isModifierOnly,
  mirrorKeys,
  mirrorLayerInto,
  mirrorPermutation,
  mirrorPosition,
  mirroredKeyCount,
  type MirrorOptions,
} from "./mirror";
import {
  LayoutFileSchema,
  MOONLANDER_KEY_COUNT,
  type KeyAction,
  type LayoutFile,
} from "./types";

const layout = (): LayoutFile => LayoutFileSchema.parse(defaultLayoutJson);

/** All three keep-options off: the pure geometric reflection. */
const MIRROR_EVERYTHING: MirrorOptions = {
  keepLayerKeys: false,
  keepThumbs: false,
  keepModifiers: false,
};

const basic = (code: string): KeyAction => ({ kind: "basic", code });

/** A full-width key array of distinct markers, so moves are traceable. */
function markerKeys(): KeyAction[] {
  return Array.from({ length: MOONLANDER_KEY_COUNT }, (_, i) =>
    basic(`K${i}`),
  );
}

describe("the pairing derived from geometry", () => {
  it("puts the axis halfway across the board", () => {
    // Keycap edges run 0 .. 17 in key units, so the centerline is 8.5. Stated
    // as a number because everything below depends on it being the real one.
    expect(MIRROR_AXIS_X).toBeCloseTo(8.5, 10);
  });

  it("pairs every one of the 72 keys — none is left over", () => {
    // The Moonlander is fully symmetric: 36 keys a side, no centerline key.
    // If this ever fails on a new geometry, unpaired keys map to themselves
    // and simply stay put; nothing breaks, the mirror just does less.
    expect(MIRROR_MAP).toHaveLength(MOONLANDER_KEY_COUNT);
    expect(MIRROR_MAP.filter((j, i) => j === i)).toHaveLength(0);
    expect(new Set(MIRROR_MAP).size).toBe(MOONLANDER_KEY_COUNT);
  });

  it("is an involution: the partner of my partner is me", () => {
    MIRROR_MAP.forEach((j, i) => expect(mirrorPosition(j)).toBe(i));
  });

  it("lands each partner where the reflection actually is", () => {
    // The property the whole file rests on, checked against the coordinates
    // rather than against a table someone typed.
    GEOMETRY.keys.forEach((k, i) => {
      const [cx, cy] = keyCenter(k);
      const [px, py] = keyCenter(GEOMETRY.keys[mirrorPosition(i)]);
      expect(px).toBeCloseTo(2 * MIRROR_AXIS_X - cx, 6);
      expect(py).toBeCloseTo(cy, 6);
    });
  });

  it("pairs same-size keys", () => {
    // A 2u key reflecting onto a 1u one would mean the geometry is asymmetric
    // and the pairing is guessing.
    GEOMETRY.keys.forEach((k, i) => {
      const partner = GEOMETRY.keys[mirrorPosition(i)];
      expect([partner.w, partner.h]).toEqual([k.w, k.h]);
    });
  });

  it("keeps the halves apart — no key pairs with its own side", () => {
    GEOMETRY.keys.forEach((k, i) => {
      const [cx] = keyCenter(k);
      const [px] = keyCenter(GEOMETRY.keys[mirrorPosition(i)]);
      expect(Math.sign(cx - MIRROR_AXIS_X)).toBe(
        -Math.sign(px - MIRROR_AXIS_X),
      );
    });
  });
});

describe("thumb cluster detection", () => {
  it("finds exactly the six thumb keys of the Moonlander", () => {
    // Derived from the gap below the main block, asserted against the board we
    // actually ship — the check that the derivation means what it claims.
    expect([...THUMB_POSITIONS].sort((a, b) => a - b)).toEqual([
      66, 67, 68, 69, 70, 71,
    ]);
  });

  it("is closed under the pairing", () => {
    // Reflection preserves y, so a thumb key's partner is another thumb key.
    // If it were not, `keepThumbs` would pin one end of a pair and not the
    // other, and the permutation would stop being one.
    THUMB_POSITIONS.forEach((i) =>
      expect(THUMB_POSITIONS.has(mirrorPosition(i))).toBe(true),
    );
  });
});

describe("key classification", () => {
  it("counts bare modifier keycodes and nothing else as modifier-only", () => {
    expect(isModifierOnly(basic("KC_LEFT_SHIFT"))).toBe(true);
    expect(isModifierOnly(basic("KC_RGUI"))).toBe(true); // alias resolves
    expect(isModifierOnly(basic("KC_HYPR"))).toBe(true);
    expect(isModifierOnly(basic("KC_A"))).toBe(false);
    // A mod-tap carries a character; that character is the point of mirroring.
    expect(
      isModifierOnly({ kind: "modTap", mods: ["MOD_LCTL"], tap: "KC_GRAVE" }),
    ).toBe(false);
    // LCTL(KC_C) is a chord, not a modifier sitting on its own.
    expect(isModifierOnly({ kind: "basic", code: "KC_C", mods: ["MOD_LCTL"] })).toBe(
      false,
    );
  });

  it("counts both flavours of layer key", () => {
    expect(isLayerKey({ kind: "layerSwitch", action: "TG", layer: 5 })).toBe(true);
    expect(isLayerKey({ kind: "layerTap", layer: 1, tap: "KC_SLASH" })).toBe(true);
    expect(isLayerKey(basic("KC_A"))).toBe(false);
  });
});

describe("mirrorKeys", () => {
  it("moves every key to its geometric partner when nothing is held back", () => {
    const keys = markerKeys();
    const out = mirrorKeys(keys, MIRROR_EVERYTHING);
    out.forEach((action, i) =>
      expect(action).toBe(keys[mirrorPosition(i)]),
    );
  });

  it("round-trips: mirroring twice returns the original", () => {
    const keys = layout().layers[0].keys;
    expect(mirrorKeys(mirrorKeys(keys, MIRROR_EVERYTHING), MIRROR_EVERYTHING)).toEqual(
      keys,
    );
  });

  it("round-trips with the default keep-options too", () => {
    // The interesting case: the held-back set is computed from the layer's own
    // keys, so it has to survive the first pass in order for the second to
    // undo it. It does, because a held key does not move and a moved key is
    // never one that would be held.
    const keys = layout().layers[0].keys;
    expect(mirrorKeys(mirrorKeys(keys))).toEqual(keys);
  });

  it("round-trips under every combination of the keep-options", () => {
    const keys = layout().layers[0].keys;
    for (const keepLayerKeys of [false, true]) {
      for (const keepThumbs of [false, true]) {
        for (const keepModifiers of [false, true]) {
          const opts = { keepLayerKeys, keepThumbs, keepModifiers };
          expect(mirrorKeys(mirrorKeys(keys, opts), opts)).toEqual(keys);
        }
      }
    }
  });

  it("loses nothing: the output is a permutation of the input", () => {
    // The failure this guards against is a key being duplicated onto both
    // halves while its partner falls off the board.
    const keys = layout().layers[0].keys;
    const perm = mirrorPermutation(keys);
    expect(new Set(perm).size).toBe(keys.length);
  });

  it("leaves a key array that is not this board's size alone", () => {
    const keys = [basic("KC_A"), basic("KC_B")];
    expect(mirrorKeys(keys)).toEqual(keys);
  });
});

describe("what does not get mirrored", () => {
  const base = () => layout().layers[0].keys;

  it("keeps layer keys where they are, and their partners with them", () => {
    const keys = base();
    const perm = mirrorPermutation(keys, {
      ...MIRROR_EVERYTHING,
      keepLayerKeys: true,
    });
    // Base layer 0: TO(3)/TO(4) at 6/7, TG(1)/TG(2) at 20/21 — two pairs of
    // layer keys facing each other across the centerline.
    [6, 7, 20, 21].forEach((i) => expect(perm[i]).toBe(i));
    // LT1 sits alone at 58; its partner at 61 (KC_RBRC) is pinned with it, or
    // the two would both source from 58.
    expect(perm[58]).toBe(58);
    expect(perm[mirrorPosition(58)]).toBe(mirrorPosition(58));
    // A letter is untouched by this option.
    expect(perm[15]).toBe(mirrorPosition(15));
  });

  it("keeps the thumb clusters under their own thumbs", () => {
    const perm = mirrorPermutation(base(), {
      ...MIRROR_EVERYTHING,
      keepThumbs: true,
    });
    THUMB_POSITIONS.forEach((i) => expect(perm[i]).toBe(i));
    expect(perm[0]).toBe(mirrorPosition(0));
  });

  it("keeps modifier keys under the hand that is still typing", () => {
    const keys = base();
    const perm = mirrorPermutation(keys, {
      ...MIRROR_EVERYTHING,
      keepModifiers: true,
    });
    // KC_LEFT_SHIFT at 42 and KC_LEFT_GUI at 56 are the base layer's bare
    // modifiers; each drags its partner along.
    expect(keys[42]).toEqual(basic("KC_LEFT_SHIFT"));
    expect(perm[42]).toBe(42);
    expect(perm[mirrorPosition(42)]).toBe(mirrorPosition(42));
    expect(perm[56]).toBe(56);
    // The mod-taps at 54/57 are characters on tap, so they still cross over.
    expect(perm[54]).toBe(mirrorPosition(54));
  });

  it("mirrors everything when the options are all off", () => {
    const keys = base();
    expect(mirroredKeyCount(keys, MIRROR_EVERYTHING)).toBe(MOONLANDER_KEY_COUNT);
    expect(mirroredKeyCount(keys, DEFAULT_MIRROR_OPTIONS)).toBeLessThan(
      MOONLANDER_KEY_COUNT,
    );
  });

  it("reports a count that matches what actually moved", () => {
    const keys = base();
    const out = mirrorKeys(keys);
    const moved = out.filter((a, i) => a !== keys[i]).length;
    // Counted by identity of the moved slots, not by value: two positions can
    // legitimately hold equal actions.
    const perm = mirrorPermutation(keys);
    expect(perm.filter((src, i) => src !== i).length).toBe(
      mirroredKeyCount(keys),
    );
    expect(moved).toBeLessThanOrEqual(mirroredKeyCount(keys));
  });
});

describe("mirrorLayerInto", () => {
  it("writes the mirror of one layer into another, keeping its identity", () => {
    const before = layout();
    const after = mirrorLayerInto(before, 0, 5);
    expect(after.layers[5].keys).toEqual(mirrorKeys(before.layers[0].keys));
    // The destination's own title and color are the user's, not the source's.
    expect(after.layers[5].title).toBe(before.layers[5].title);
    expect(after.layers[5].color).toBe(before.layers[5].color);
    // Nothing else moved.
    expect(after.layers[0]).toEqual(before.layers[0]);
    expect(after.combos).toEqual(before.combos);
  });

  it("regenerates the shipped Mirror layer into something still valid", () => {
    const after = mirrorLayerInto(layout(), 0, 5);
    expect(() => LayoutFileSchema.parse(after)).not.toThrow();
  });

  it("mirrors in place when source and target are the same layer", () => {
    const before = layout();
    const once = mirrorLayerInto(before, 0, 0);
    expect(once.layers[0].keys).toEqual(mirrorKeys(before.layers[0].keys));
    // And in place, twice, is a no-op — the undo path in the UI.
    expect(mirrorLayerInto(once, 0, 0)).toEqual(before);
  });

  it("leaves the layout untouched for an index that does not exist", () => {
    const before = layout();
    expect(mirrorLayerInto(before, 0, 99)).toBe(before);
    expect(mirrorLayerInto(before, 99, 0)).toBe(before);
    expect(mirrorLayerInto(before, 0, -1)).toBe(before);
  });

  it("does not move the Mirror combos", () => {
    // They are one chord per hand; reflecting the pair would swap it for
    // itself. See the note on mirrorLayerInto.
    const before = layout();
    const after = mirrorLayerInto(before, 0, 5);
    expect(after.combos.map((c) => c.keys)).toEqual(
      before.combos.map((c) => c.keys),
    );
  });
});

describe("appendMirroredLayer", () => {
  it("adds the mirror at the end so no layer reference shifts", () => {
    const before = layout();
    const after = appendMirroredLayer(before, 0);
    expect(after.layers).toHaveLength(before.layers.length + 1);
    expect(after.layers.slice(0, -1)).toEqual(before.layers);
    expect(after.layers.at(-1)!.keys).toEqual(mirrorKeys(before.layers[0].keys));
    expect(after.layers.at(-1)!.color).toBe(before.layers[0].color);
  });

  it("names itself after its source, or takes the name given", () => {
    const before = layout();
    expect(appendMirroredLayer(before, 4).layers.at(-1)!.title).toBe(
      "Media mirrored",
    );
    expect(appendMirroredLayer(before, 4, undefined, "  One-hand ").layers.at(-1)!
      .title).toBe("One-hand");
  });

  it("produces a layout the schema still accepts", () => {
    const after = appendMirroredLayer(layout(), 0);
    expect(() => LayoutFileSchema.parse(after)).not.toThrow();
  });

  it("leaves the layout untouched for a source that does not exist", () => {
    const before = layout();
    expect(appendMirroredLayer(before, 99)).toBe(before);
  });
});

describe("the shipped layout's Mirror toggle", () => {
  /** The Mirror layer index the combos have always targeted. */
  const MIRROR_LAYER = 5;
  const isTG5 = (a: KeyAction) =>
    a.kind === "layerSwitch" && a.action === "TG" && a.layer === MIRROR_LAYER;

  it("still has both one-handed combos", () => {
    // The toggle is an addition, not a replacement — muscle memory keeps working.
    const combos = layout().combos.filter((c) => isTG5(c.action));
    expect(combos.map((c) => c.name)).toEqual(["Mirror 1", "Mirror 2"]);
    expect(combos.map((c) => c.keys)).toEqual([
      [21, 7],
      [20, 6],
    ]);
  });

  it("reaches Mirror from a single key, not only from a chord", () => {
    const l = layout();
    const single = l.layers.flatMap((layer, li) =>
      layer.keys.flatMap((k, ki) => (isTG5(k) ? [{ li, ki }] : [])),
    );
    expect(single.length).toBeGreaterThan(0);
  });

  it("puts one under each hand, on both the way in and the way out", () => {
    const l = layout();
    // Keys 34 and 35 are each other's reflection, so the toggle exists on the
    // left half and the right half of the board. Present on the Media layer
    // (the way in, since every position on the base layer is taken) and on the
    // Mirror layer itself (the way out — leaving used to need the chord).
    expect(mirrorPosition(34)).toBe(35);
    [4, MIRROR_LAYER].forEach((li) => {
      expect(isTG5(l.layers[li].keys[34])).toBe(true);
      expect(isTG5(l.layers[li].keys[35])).toBe(true);
    });
  });

  it("glows in the Mirror layer's own color, like every other layer key", () => {
    const l = layout();
    const color = l.layers[MIRROR_LAYER].color;
    [4, MIRROR_LAYER].forEach((li) =>
      [34, 35].forEach((ki) =>
        expect(l.layers[li].keys[ki].glow).toBe(color),
      ),
    );
  });

  it("survives being regenerated from either layer", () => {
    // Layer keys stay put, so re-mirroring the Mirror layer in place leaves the
    // way out exactly where it was.
    const inPlace = mirrorLayerInto(layout(), MIRROR_LAYER, MIRROR_LAYER);
    expect(isTG5(inPlace.layers[MIRROR_LAYER].keys[34])).toBe(true);
    expect(isTG5(inPlace.layers[MIRROR_LAYER].keys[35])).toBe(true);

    // Regenerating from the BASE layer replaces all 72 keys, so the exit keys

    // are whatever layer 0 holds at those positions - pinning protects the

    // source's layer keys, not the destination's. Layer 0 carries the Mirror

    // toggle itself, so the way out comes along with the mirror rather than

    // being wiped by it. That is a property of the shipped layout, not of the

    // transform: put something else on layer 0 key 34 and this stops holding,

    // which is why the combos remain the guaranteed way out.

    const fromBase = mirrorLayerInto(layout(), 0, MIRROR_LAYER);

    expect(isTG5(fromBase.layers[MIRROR_LAYER].keys[34])).toBe(true);
  });
});
