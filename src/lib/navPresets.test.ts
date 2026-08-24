import { describe, expect, it } from "vitest";
import { entryFor } from "./keycodes";
import { stepLabel } from "./macros";
import {
  NAV_PRESET_GROUPS,
  NAV_PRESETS,
  presetSteps,
  presetsInGroup,
} from "./navPresets";
import { MacroStepSchema } from "./types";

describe("nav presets", () => {
  it("covers the four groups Simon asked for", () => {
    expect(NAV_PRESET_GROUPS.map((g) => g.id)).toEqual([
      "desktops",
      "snap",
      "switching",
      "capture",
    ]);
    for (const group of NAV_PRESET_GROUPS) {
      expect(presetsInGroup(group.id).length).toBeGreaterThan(0);
    }
  });

  it("gives every preset both OS halves and a unique id", () => {
    const ids = new Set<string>();
    for (const p of NAV_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.label.trim()).not.toBe("");
      expect(p.description.trim()).not.toBe("");
      expect(p.mac.length).toBeGreaterThan(0);
      expect(p.windows.length).toBeGreaterThan(0);
      expect(NAV_PRESET_GROUPS.some((g) => g.id === p.groupId)).toBe(true);
    }
  });

  it("uses only real keycodes, in schema-valid steps", () => {
    for (const p of NAV_PRESETS) {
      for (const step of [...p.mac, ...p.windows]) {
        expect(() => MacroStepSchema.parse(step)).not.toThrow();
        expect(entryFor(step.code), `${p.id}: ${step.code}`).toBeDefined();
      }
    }
  });

  it("differs between the two OSes — otherwise it would not need osMacro", () => {
    for (const p of NAV_PRESETS) {
      expect(
        JSON.stringify(p.mac),
        `${p.id} has identical halves`,
      ).not.toBe(JSON.stringify(p.windows));
    }
  });

  it("hands out copies, not the shared table's own arrays", () => {
    const p = NAV_PRESETS[0];
    const copy = presetSteps(p);
    expect(copy.mac).toEqual(p.mac);
    expect(copy.mac).not.toBe(p.mac);
    expect(copy.mac[0]).not.toBe(p.mac[0]);
  });

  it("says on the snap group that macOS needs third-party software", () => {
    const group = NAV_PRESET_GROUPS.find((g) => g.id === "snap")!;
    expect(group.description).toMatch(/Rectangle|Magnet/);
    for (const p of presetsInGroup("snap")) {
      expect(p.description, p.id).toMatch(/Rectangle|Magnet/);
      expect(p.description, p.id).toMatch(/no native equivalent/i);
    }
  });

  /**
   * The shortcuts themselves, spelled out. This is the table a reader can
   * check against Microsoft's and Apple's own docs without reading MOD_*
   * tokens — a wrong modifier here is a key that silently does the wrong
   * thing on one machine, which is exactly the bug osMacro exists to avoid.
   */
  it("spells out the verified chords", () => {
    const table = Object.fromEntries(
      NAV_PRESETS.map((p) => [
        p.id,
        {
          mac: p.mac.map(stepLabel).join(" · "),
          windows: p.windows.map(stepLabel).join(" · "),
        },
      ]),
    );
    expect(table).toEqual({
      // Windows: Win+Ctrl+arrow. macOS: Ctrl+arrow (Move left/right a space).
      "desktop-next": { mac: "Ctrl+→", windows: "Gui+Ctrl+→" },
      "desktop-prev": { mac: "Ctrl+←", windows: "Gui+Ctrl+←" },
      // Win+Tab is Task View; Ctrl+Up is Mission Control.
      "desktop-overview": { mac: "Ctrl+↑", windows: "Gui+Tab" },
      // Win+arrow snaps natively; Ctrl+Opt+arrow is Rectangle/Magnet.
      "snap-left": { mac: "Ctrl+Alt+←", windows: "Gui+←" },
      "snap-right": { mac: "Ctrl+Alt+→", windows: "Gui+→" },
      "snap-max": { mac: "Ctrl+Alt+Enter", windows: "Gui+↑" },
      // Alt+Tab / Cmd+Tab, and their shifted reverses.
      "app-next": { mac: "Gui+Tab", windows: "Alt+Tab" },
      "app-prev": { mac: "Gui+Shift+Tab", windows: "Alt+Shift+Tab" },
      // Cmd+` cycles one app's windows; Windows has no such thing, and
      // Alt+Esc (all windows, open order) is the nearest documented match.
      "window-cycle": { mac: "Gui+`", windows: "Alt+Esc" },
      // Win+Shift+S is the Snipping Tool; Cmd+Shift+4 is region capture.
      "shot-region": { mac: "Gui+Shift+4", windows: "Gui+Shift+S" },
      "shot-screen": { mac: "Gui+Shift+3", windows: "PrtSc" },
      // Win+L; Ctrl+Cmd+Q.
      lock: { mac: "Ctrl+Gui+Q", windows: "Gui+L" },
    });
  });
});
