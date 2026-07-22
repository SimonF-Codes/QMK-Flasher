import { beforeEach, describe, expect, it } from "vitest";
import { ipc, resetMockStore } from "./ipc";

const ID = "arrows-together";

/** Deep-clone the active layout and tweak one key so a save is non-identical. */
async function editedActive(code: string) {
  const l = await ipc.loadLayout();
  l.layers[0].keys[0] = { kind: "basic", code };
  return l;
}

describe("mock version-history IPC (parity with the Rust store)", () => {
  beforeEach(() => resetMockStore());

  it("a fresh layout has no versions", async () => {
    expect(await ipc.listLayoutVersions(ID)).toEqual([]);
  });

  it("save_layout auto-snapshots reason 'save', deduped byte-identically", async () => {
    const l = await ipc.loadLayout();
    await ipc.saveLayout(l);
    let versions = await ipc.listLayoutVersions(ID);
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("save");

    // Saving the identical layout again is a no-op (dedup vs newest).
    await ipc.saveLayout(l);
    versions = await ipc.listLayoutVersions(ID);
    expect(versions).toHaveLength(1);

    // A changed save adds a new version.
    await ipc.saveLayout(await editedActive("KC_F13"));
    versions = await ipc.listLayoutVersions(ID);
    expect(versions).toHaveLength(2);
    expect(versions.every((v) => v.reason === "save")).toBe(true);
  });

  it("snapshot_layout adds a manual version with an optional label", async () => {
    const summary = await ipc.snapshotLayout(ID, "manual", "before gaming edits");
    expect(summary.reason).toBe("manual");
    expect(summary.label).toBe("before gaming edits");
    const versions = await ipc.listLayoutVersions(ID);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      reason: "manual",
      label: "before gaming edits",
    });
    expect(typeof versions[0].versionId).toBe("string");
    expect(typeof versions[0].createdAt).toBe("string");
  });

  it("snapshot_layout rejects any non-manual reason", async () => {
    await expect(ipc.snapshotLayout(ID, "save")).rejects.toMatchObject({
      code: "InvalidLayout",
    });
  });

  it("lists newest first", async () => {
    await ipc.snapshotLayout(ID, "manual", "one");
    await ipc.snapshotLayout(ID, "manual", "two");
    await ipc.snapshotLayout(ID, "manual", "three");
    const versions = await ipc.listLayoutVersions(ID);
    expect(versions.map((v) => v.label)).toEqual(["three", "two", "one"]);
  });

  it("restore snapshots the current (preRestore) then restores the chosen layout", async () => {
    // v-original: snapshot the pristine fixture.
    const original = await ipc.loadLayout();
    const originalKey0 = original.layers[0].keys[0];
    const snap = await ipc.snapshotLayout(ID, "manual", "pristine");

    // Edit + save so the active layout differs from the snapshot.
    await ipc.saveLayout(await editedActive("KC_F13"));
    expect((await ipc.loadLayout()).layers[0].keys[0]).toEqual({
      kind: "basic",
      code: "KC_F13",
    });

    // Restore the pristine snapshot.
    const restored = await ipc.restoreLayoutVersion(ID, snap.versionId);
    expect(restored.layers[0].keys[0]).toEqual(originalKey0);
    expect((await ipc.loadLayout()).layers[0].keys[0]).toEqual(originalKey0);

    // The current (edited) layout was backed up as preRestore before the swap.
    const versions = await ipc.listLayoutVersions(ID);
    expect(versions.some((v) => v.reason === "preRestore")).toBe(true);
  });

  it("restore rejects an unknown version id", async () => {
    await expect(
      ipc.restoreLayoutVersion(ID, "nope"),
    ).rejects.toMatchObject({ code: "InvalidLayout" });
  });

  it("seed_from_oryx snapshots the current layout as preReseed before overwriting", async () => {
    // Dirty + save so there's a distinct current to back up.
    await ipc.saveLayout(await editedActive("KC_F13"));
    const before = await ipc.listLayoutVersions(ID);

    await ipc.seedFromOryx("rddD7", true);
    const after = await ipc.listLayoutVersions(ID);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((v) => v.reason === "preReseed")).toBe(true);
  });
});
