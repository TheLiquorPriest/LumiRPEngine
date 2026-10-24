// Batch editing (DESIGN §7, §4.1): a list's selection changed at once. In GM mode each change is the
// GM edit op per entity, sent in chunks of EDIT_OPS_MAX, each chunk one edit with its own Undo; in
// Build it is a JSON Patch on the draft. Each goes to a real backend and reads back.

import { describe, expect, test } from "bun:test";
import { bulkOps, chunks, draftPatch, fidelityGroups, sendInChunks, tierGroups } from "../../src/frontend/batch";
import { bulkTargets } from "../../src/frontend/gm/batch";
import { SelectBar, type Selection } from "../../src/frontend/multi-select";
import { editRequest } from "../../src/frontend/requests";
import { FIDELITY_LABEL } from "../../src/packs/minds/ui/ops";
import { lorePinsOf } from "../../src/shared/lore";
import type { EditOp, JsonPatchOp } from "../../src/shared/protocol";
import { EDIT_OPS_MAX } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { propsOf } from "../support/tree";

async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");
  return { rig, chatId };
}

async function gmView(rig: Rig, chatId: string): Promise<GmView> {
  return rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
}

/** The GM view's edit as GM mode sends it: one `lre.edit`, true when it applied; every request it sent is kept. */
function editor(rig: Rig, chatId: string, sent: EditOp[][]): (ops: EditOp[]) => Promise<boolean> {
  return async (ops) => {
    sent.push(ops);
    const m = await rig.send(editRequest(chatId, ops) as unknown as Record<string, unknown>);
    return m.type === "lre.result";
  };
}

async function undoChips(rig: Rig, chatId: string): Promise<string[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").map((c) => c.id);
}

describe("GM batch edits", () => {
  test("three people picked and given a tier are three ops in one edit, with one Undo that takes all three back", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const people = gm.minds.characters.map((c) => c.entity).filter((id) => gm.entities.find((e) => e.id === id)?.tier !== "background").slice(0, 3);
    expect(people.length).toBe(3);
    const tierOf = async (): Promise<string[]> => {
      const now = await gmView(rig, chatId);
      return people.map((id) => now.entities.find((e) => e.id === id)?.tier ?? "");
    };
    const before = await tierOf();
    const chipsBefore = await undoChips(rig, chatId);
    const sent: EditOp[][] = [];
    const change = { kind: "tier", tier: "background" } as const;
    const ops = bulkOps(bulkTargets({ gm }, people, change), change);
    if (!ops) throw new Error("no ops");
    expect(await sendInChunks(ops, editor(rig, chatId, sent))).toEqual({ applied: 1, of: 1 });
    expect(sent.map((s) => s.length)).toEqual([3]);
    expect(await tierOf()).toEqual(["background", "background", "background"]);
    const chips = await undoChips(rig, chatId);
    expect(chips.length).toBe(chipsBefore.length + 1);
    // The one Undo takes back the whole edit.
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chips.at(-1) ?? "", choice: "undo" }));
    expect(await tierOf()).toEqual(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("seventy picked go as two edits, 64 and 6 ops, each with its own Undo", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const ids = gm.entities.filter((e) => !e.gone).map((e) => e.id).slice(0, 70);
    expect(ids.length).toBe(70);
    const chipsBefore = await undoChips(rig, chatId);
    const sent: EditOp[][] = [];
    const ops = bulkOps(ids, { kind: "tier", tier: "supporting" });
    if (!ops) throw new Error("no ops");
    expect(chunks(ops).map((c) => c.length)).toEqual([EDIT_OPS_MAX, 70 - EDIT_OPS_MAX]);
    expect(await sendInChunks(ops, editor(rig, chatId, sent))).toEqual({ applied: 2, of: 2 });
    expect(sent.map((s) => s.length)).toEqual([64, 6]);
    expect((await undoChips(rig, chatId)).length).toBe(chipsBefore.length + 2);
    const after = await gmView(rig, chatId);
    expect(ids.every((id) => after.entities.find((e) => e.id === id)?.tier === "supporting")).toBe(true);
  });

  test("a chunk refused stops the batch: the chunks before it stay applied, the rest are never sent", async () => {
    const sent: number[] = [];
    const result = await sendInChunks(Array.from({ length: 150 }, (_, i) => i), async (chunk) => (sent.push(chunk.length), sent.length < 2));
    expect([result, sent]).toEqual([{ applied: 1, of: 3 }, [64, 64]]);
  });

  test("Select a level picks exactly the characters at that level, whatever was picked before", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const groups = fidelityGroups(gm.minds.characters, FIDELITY_LABEL);
    expect(groups.length).toBeGreaterThan(0);
    let picked: readonly string[] = ["someone_else"];
    const selection: Selection = { on: true, ids: picked, start: () => undefined, stop: () => undefined, toggle: () => undefined, set: (ids) => (picked = ids) };
    const bar = SelectBar({ label: "Change the selected", selection, all: gm.entities.map((e) => e.id), shown: [], groups, groupLabel: "Select a level" });
    const pick = propsOf(bar, "select").find((p) => p["aria-label"] === "Select a level");
    const onChange = pick?.onChange;
    if (typeof onChange !== "function") throw new Error("no level picker");
    for (const group of groups) {
      onChange({ currentTarget: { value: group.id } });
      const want = gm.minds.characters.filter((c) => c.fidelity.level === group.id).map((c) => c.entity);
      expect([group.id, [...picked].sort()]).toEqual([group.id, [...want].sort()]);
    }
  });

  test("a bulk move sends a move op per person, and each one moves", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const people = gm.minds.characters.slice(0, 2).map((c) => c.entity);
    const to = gm.places.find((p) => people.every((id) => gm.entities.find((e) => e.id === id)?.place !== p.id))?.id;
    if (!to || people.length < 2) throw new Error("nowhere to move them");
    const sent: EditOp[][] = [];
    const change = { kind: "move", to } as const;
    const ops = bulkOps(bulkTargets({ gm }, people, change), change);
    if (!ops) throw new Error("no ops");
    expect(await sendInChunks(ops, editor(rig, chatId, sent))).toEqual({ applied: 1, of: 1 });
    expect(sent).toEqual([people.map((entity) => ({ op: "move", entity, to }))]);
    const after = await gmView(rig, chatId);
    expect(people.map((id) => after.entities.find((e) => e.id === id)?.place)).toEqual([to, to]);
  });
});

describe("Build batch changes", () => {
  async function draftOf(rig: Rig, worldId: string): Promise<WorldDoc> {
    return rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "get" })).draft as WorldDoc;
  }

  async function patch(rig: Rig, worldId: string, ops: JsonPatchOp[]): Promise<WorldDoc> {
    return rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "patch", ops })).draft as WorldDoc;
  }

  test("a tier set on the selected entities lands in the draft, and only theirs changes", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const doc = await draftOf(rig, worldId);
    const principal = tierGroups(doc).find((g) => g.id === "principal");
    if (!principal) throw new Error("no principal tier");
    const picked = principal.ids.slice(0, 3);
    const others = Object.values(doc.entities).filter((e) => !picked.includes(e.id));
    const ops = draftPatch(doc, "entities", picked, { kind: "tier", tier: "supporting" });
    expect(ops.length).toBe(3);
    await patch(rig, worldId, ops);
    const after = await draftOf(rig, worldId);
    expect(picked.map((id) => after.entities[id]?.tier)).toEqual(["supporting", "supporting", "supporting"]);
    expect(others.map((e) => after.entities[e.id]?.tier)).toEqual(others.map((e) => e.tier));
    // Picking them again changes nothing, so nothing is written.
    expect(draftPatch(after, "entities", picked, { kind: "tier", tier: "supporting" })).toEqual([]);
  });

  test("a level override, a scene type and a lore pin land in the draft for each one picked", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const doc = await draftOf(rig, worldId);
    const people = Object.values(doc.entities).filter((e) => e.kind === "character").slice(0, 2).map((e) => e.id);
    const places = Object.values(doc.places).filter((p) => p.map === undefined).slice(0, 2).map((p) => p.id);
    const lore = Object.keys(doc.lore)[0];
    if (people.length < 2 || places.length < 2 || !lore) throw new Error("the starter is too small");
    let after = await patch(rig, worldId, draftPatch(doc, "entities", people, { kind: "level", domain: "money", level: 1 }));
    expect(people.map((id) => after.entities[id]?.levels?.money)).toEqual([1, 1]);
    after = await patch(rig, worldId, draftPatch(after, "entities", people, { kind: "level", domain: "money", level: null }));
    expect(people.map((id) => after.entities[id]?.levels?.money)).toEqual([undefined, undefined]);
    after = await patch(rig, worldId, draftPatch(after, "places", places, { kind: "sceneType", sceneType: "quiet" }));
    expect(places.map((id) => after.places[id]?.sceneType)).toEqual(["quiet", "quiet"]);
    after = await patch(rig, worldId, draftPatch(after, "entities", people, { kind: "pin", pin: { lore } }));
    expect(people.map((id) => lorePinsOf(after).characters[id]?.some((p) => "lore" in p && p.lore === lore))).toEqual([true, true]);
  });
});
