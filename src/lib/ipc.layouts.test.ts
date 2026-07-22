import { beforeEach, describe, expect, it } from "vitest";
import { ipc, resetMockStore } from "./ipc";
import type { AppError } from "./types";

describe("mock multi-layout IPC (parity with the Rust store)", () => {
  beforeEach(() => resetMockStore());

  it("seeds one default layout from the fixture", async () => {
    const layouts = await ipc.listLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({
      id: "arrows-together",
      name: "Arrows Together",
      keyboard: "moonlander",
    });
    expect(typeof layouts[0].modifiedAt).toBe("string");
  });

  it("slugifies names and disambiguates collisions with a numeric suffix", async () => {
    const a = await ipc.createLayout("My Cool Layout!", "moonlander");
    expect(a.id).toBe("my-cool-layout");
    const b = await ipc.createLayout("My Cool Layout!", "moonlander");
    expect(b.id).toBe("my-cool-layout-2");
    // Non-alphanumeric-only name falls back to "layout".
    const c = await ipc.createLayout("!!!", "moonlander");
    expect(c.id).toBe("layout");
  });

  it("create does not change the active layout", async () => {
    await ipc.createLayout("Gaming", "moonlander");
    const active = await ipc.loadLayout();
    expect(active.meta.name).toBe("Arrows Together");
  });

  it("blank created layouts are valid and all-transparent", async () => {
    await ipc.createLayout("Gaming", "moonlander");
    const layout = await ipc.selectLayout("gaming");
    expect(layout.layers).toHaveLength(1);
    expect(layout.layers[0].keys).toHaveLength(72);
    expect(layout.layers[0].keys.every((k) => k.kind === "transparent")).toBe(
      true,
    );
    expect(layout.settings.tapDance).toBe(false);
    expect(layout.settings.keyLock).toBe(true);
  });

  it("select switches the active layout and returns it", async () => {
    await ipc.createLayout("Gaming", "moonlander");
    const l = await ipc.selectLayout("gaming");
    expect(l.meta.name).toBe("Gaming");
    expect((await ipc.loadLayout()).meta.name).toBe("Gaming");
  });

  it("rename keeps the id and changes only the name", async () => {
    const s = await ipc.renameLayout("arrows-together", "Main");
    expect(s.id).toBe("arrows-together");
    expect(s.name).toBe("Main");
  });

  it("duplicate copies content under a new id", async () => {
    const dup = await ipc.duplicateLayout("arrows-together", "Copy");
    expect(dup.id).toBe("copy");
    const copy = await ipc.selectLayout("copy");
    const orig = await ipc.selectLayout("arrows-together");
    expect(copy.layers).toEqual(orig.layers);
    expect(copy.meta.name).toBe("Copy");
  });

  it("refuses to delete the active layout, allows an inactive one", async () => {
    await ipc.createLayout("Gaming", "moonlander");
    // arrows-together is active.
    await expect(ipc.deleteLayout("arrows-together")).rejects.toMatchObject({
      code: "InvalidLayout",
    });
    await expect(ipc.deleteLayout("gaming")).resolves.toBeUndefined();
    expect((await ipc.listLayouts()).map((l) => l.id)).toEqual([
      "arrows-together",
    ]);
  });

  it("rejects unknown ids and unsupported keyboards", async () => {
    await expect(ipc.selectLayout("nope")).rejects.toMatchObject({
      code: "InvalidLayout",
    });
    await expect(
      ipc.createLayout("X", "voyager"),
    ).rejects.toMatchObject({ code: "InvalidLayout" });
  });

  it("lists keyboards and returns geometry for a known one", async () => {
    const kbs = await ipc.listKeyboards();
    expect(kbs.map((k) => k.id)).toContain("moonlander");
    const geo = await ipc.getKeyboardGeometry("moonlander");
    expect(geo.keyCount).toBe(72);
    expect(geo.keys).toHaveLength(72);
    await expect(
      ipc.getKeyboardGeometry("voyager"),
    ).rejects.toMatchObject({ code: "InvalidLayout" } satisfies Partial<AppError>);
  });
});
