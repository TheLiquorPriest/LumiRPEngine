// Batch editing (DESIGN §7, §4.1): a list's selection changed at once. In GM mode each change is the
// GM edit op per entity, sent in chunks of EDIT_OPS_MAX, each chunk one edit with its own Undo, and
// the GM view's notice undoes all of it; in Build it is a JSON Patch on the draft. Every control
// starts on Choose…, so nothing applies by default. Each goes to a real backend and reads back.

import { describe, expect, test } from "bun:test";
import { bulkOps, chunks, draftPatch, fidelityGroups, mixCounts, sendInChunks, tierGroups } from "../../src/frontend/batch";
import { draftTargets } from "../../src/frontend/build/batch-sheet";
import { Button } from "../../src/frontend/components";
import { BLANK_CHOICES, batchChanges, bulkTargets, ChangeCard } from "../../src/frontend/gm/batch";
import { editNotice, noticeStands, sendEdits } from "../../src/frontend/gm/editor";
import { GroupPicks, SelectBar, type Selection } from "../../src/frontend/multi-select";
import { editRequest } from "../../src/frontend/requests";
import { FIDELITY_LABEL } from "../../src/packs/minds/ui/ops";
import { lorePinsOf } from "../../src/shared/lore";
import { MIND_TEXT_CAPS } from "../../src/shared/minds";
import type { EditOp, JsonPatchOp, ResultBodies } from "../../src/shared/protocol";
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

/** `lre.edit` as the GM view's editor asks it: the result's body, with the chip of the entry it wrote; null when refused. */
function request(rig: Rig, chatId: string): (ops: EditOp[]) => Promise<ResultBodies["lre.edit"] | null> {
  return async (ops) => {
    const m = await rig.send(editRequest(chatId, ops) as unknown as Record<string, unknown>);
    if (m.type !== "lre.result") return null;
    const body = rig.body(m);
    return { pending: body.pending === true, undo: typeof body.undo === "string" ? body.undo : null };
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
    const ops = bulkOps(bulkTargets({ gm }, people, change.kind), change);
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

  test("the notice a bulk change leaves holds the Undo of every edit it made, and that Undo takes it all back", async () => {
    const { rig, chatId } = await chat();
    const before = await gmView(rig, chatId);
    const ids = before.entities.filter((e) => !e.gone).map((e) => e.id).slice(0, 70);
    expect(ids.length).toBe(70);
    const ops = bulkOps(ids, { kind: "tier", tier: "supporting" });
    if (!ops) throw new Error("no ops");
    const sent = await sendEdits((send) => sendInChunks(ops, send), request(rig, chatId));
    expect([sent.applied, sent.of, sent.count]).toEqual([2, 2, 70]);
    const after = await gmView(rig, chatId);
    const notice = editNotice(sent.undo, after.edits);
    expect(notice.undo.length).toBe(2);
    expect(noticeStands(notice, after)).toBe(true);
    for (const chip of notice.undo) rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "undo" }));
    const undone = await gmView(rig, chatId);
    expect(ids.map((id) => undone.entities.find((e) => e.id === id)?.tier)).toEqual(ids.map((id) => before.entities.find((e) => e.id === id)?.tier));
    // Taken back, the edits are no longer in force, and the notice gives way.
    expect(noticeStands(notice, undone)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an edit that lands between an edit and the view loaded after it is never in the notice's Undo", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const [mine, other] = gm.minds.characters.slice(0, 2).map((c) => c.entity);
    if (!mine || !other) throw new Error("no characters");
    const pinOf = (view: GmView, who: string) => view.minds.characters.find((c) => c.entity === who)?.fidelity.pin.gm;
    const sent = await sendEdits(async (send) => ({ applied: (await send([{ op: "mind_pin", entity: mine, level: "near" }])) ? 1 : 0, of: 1 }), request(rig, chatId));
    // Something else lands before the GM view is loaded again (a minds run finishing in the background, a ✎ fix).
    rig.body(await rig.send(editRequest(chatId, [{ op: "mind_pin", entity: other, level: "far" }]) as unknown as Record<string, unknown>));
    const after = await gmView(rig, chatId);
    const notice = editNotice(sent.undo, after.edits);
    expect(notice.undo.length).toBe(1);
    for (const chip of notice.undo) rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "undo" }));
    const now = await gmView(rig, chatId);
    // The notice's Undo took back the GM's own edit; the one that landed meanwhile stands.
    expect([pinOf(now, mine), pinOf(now, other)]).toEqual([null, "far"]);
  });

  test("an edit on an earlier reply has no Undo in the GM view, as in the chat", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const someone = gm.minds.characters[0]?.entity;
    if (!someone) throw new Error("no characters");
    rig.body(await rig.send(editRequest(chatId, [{ op: "mind_pin", entity: someone, level: "near" }]) as unknown as Record<string, unknown>));
    expect((await gmView(rig, chatId)).edits[0]?.undo).toBe((await undoChips(rig, chatId)).at(-1) ?? "none");
    await rig.turn(chatId, "I head inside.", "The shop is quiet.");
    expect((await gmView(rig, chatId)).edits[0]?.undo).toBeNull();
  });

  test("every control starts on Choose…: Apply stays off until a value is picked, and for a value no one picked fits", () => {
    expect(Object.values(batchChanges(BLANK_CHOICES))).toEqual([null, null, null, null, null, null]);
    const choices = { ...BLANK_CHOICES, tier: "background", domain: "money" as const, level: "tier" as const, pin: "score" as const, approach: "mind" as const, to: "home" };
    const changes = batchChanges(choices);
    expect([changes.tier, changes.level, changes.pin, changes.intent, changes.move]).toEqual([
      { kind: "tier", tier: "background" },
      { kind: "level", domain: "money", level: null },
      { kind: "pin", level: null },
      // Blank text and "Their mind decides" chosen: clearing their intent is a choice, never the default.
      { kind: "intent", text: "", approach: null },
      { kind: "move", to: "home" },
    ]);
    expect(batchChanges({ ...BLANK_CHOICES, text: "x".repeat(MIND_TEXT_CAPS.gmIntent + 1) }).intent).toBeNull();
    const applied: unknown[] = [];
    const apply = (change: unknown) => applied.push(change);
    const card = (change: (typeof changes)["tier"], reach: number) => propsOf(ChangeCard({ title: "Tier", note: "", change, reach, now: null, busy: false, onApply: apply, children: null }), Button)[0] ?? {};
    expect(card(null, 5).disabled).toBe(true);
    expect(card(changes.tier, 0).disabled).toBe(true);
    const ready = card(changes.tier, 5);
    expect(ready.disabled).toBe(false);
    const onClick = ready.onClick;
    if (typeof onClick !== "function") throw new Error("no Apply");
    onClick();
    expect(applied).toEqual([changes.tier]);
  });

  test("a tier or a level reaches the people picked unless widened to everything picked; a mind change never reaches your own character", async () => {
    const { rig, chatId } = await chat();
    const gm = await gmView(rig, chatId);
    const you = gm.entities.find((e) => e.pov)?.id;
    const others = gm.minds.characters.slice(0, 2).map((c) => c.entity);
    const things = gm.entities.filter((e) => !e.person).slice(0, 3).map((e) => e.id);
    if (!you || others.length < 2 || things.length < 3) throw new Error("the starter is too small");
    const picked = [you, ...others, ...things];
    expect(bulkTargets({ gm }, picked, "tier").sort()).toEqual([you, ...others].sort());
    expect(bulkTargets({ gm }, picked, "level", true).sort()).toEqual([...picked].sort());
    expect(bulkTargets({ gm }, picked, "pin").sort()).toEqual([...others].sort());
    expect(bulkTargets({ gm }, picked, "intent").includes(you)).toBe(false);
  });

  test("a selection's mix counts each value, the most common first, the rest summed past the ones it names", () => {
    expect(mixCounts(["Leads", "Supporting", "Leads"])).toEqual({ shown: [{ label: "Leads", count: 2 }, { label: "Supporting", count: 1 }], rest: 0 });
    const capped = mixCounts(["a", "b", "b", "c", "d", "d", "d", "e"], 2);
    expect(capped.shown).toEqual([{ label: "d", count: 3 }, { label: "b", count: 2 }]);
    // Past the cap, the other values' people are counted together: a, c and e, one each.
    expect(capped.rest).toBe(3);
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
    const onPick = propsOf(bar, GroupPicks)[0]?.onPick;
    if (typeof onPick !== "function") throw new Error("no level picks");
    for (const group of groups) {
      onPick(group);
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
    const ops = bulkOps(bulkTargets({ gm }, people, change.kind), change);
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

  test("a tier, a level or a pin reaches the people picked unless widened to everything picked; places take every change", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const doc = await draftOf(rig, worldId);
    const people = Object.values(doc.entities).filter((e) => e.kind === "character").slice(0, 2).map((e) => e.id);
    const accounts = Object.values(doc.entities).filter((e) => e.kind === "account").slice(0, 2).map((e) => e.id);
    const places = Object.keys(doc.places).slice(0, 2);
    if (people.length < 2 || accounts.length < 2 || places.length < 2) throw new Error("the starter is too small");
    expect(draftTargets(doc, "entities", [...people, ...accounts], false)).toEqual(people);
    expect(draftTargets(doc, "entities", [...people, ...accounts], true)).toEqual([...people, ...accounts]);
    expect(draftTargets(doc, "places", places, false)).toEqual(places);
  });
});
