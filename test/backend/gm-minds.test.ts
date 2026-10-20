// The GM view's Minds tab against the backend (DESIGN §24.9): every control the tab sends, built by
// its own request helpers, goes through `lre.edit` and reads back from `lre.gm`; what it writes stays
// out of everything Play is pushed.

import { describe, expect, test } from "bun:test";
import { commitmentDraft, commitmentOp, deleteOp, noteDraft, noteOp, pinOp, planDraft, planOp, refreshOp, startPlanIn } from "../../src/packs/minds/ui/ops";
import { editRequest } from "../../src/frontend/requests";
import type { MindsGmCharacter, MindsGmView } from "../../src/shared/minds";
import type { EditOp } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

const SECRET_NOTE = "Saw the ledger hidden behind the boiler";

async function minds(rig: Rig, chatId: string): Promise<MindsGmView> {
  return rig.body(await rig.send({ type: "lre.gm", chatId })).minds as MindsGmView;
}

async function character(rig: Rig, chatId: string, entity: string): Promise<MindsGmCharacter> {
  const c = (await minds(rig, chatId)).characters.find((x) => x.entity === entity);
  if (!c) throw new Error(`no ${entity}`);
  return c;
}

async function edit(rig: Rig, chatId: string, op: EditOp | null): Promise<void> {
  if (!op) throw new Error("the form refused it");
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

describe("GM view → Minds round trip", () => {
  test("pin, refresh, and adding, editing and deleting notes, commitments and plans", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");

    const view = await minds(rig, chatId);
    expect(view.characters.length).toBeGreaterThan(1);
    const [who, other] = view.characters;
    if (!who || !other) throw new Error("no characters");
    const id = who.entity;

    await edit(rig, chatId, pinOp(id, "far"));
    let c = await character(rig, chatId, id);
    expect([c.fidelity.pin.gm, c.fidelity.level]).toEqual(["far", "far"]);
    await edit(rig, chatId, pinOp(id, null));
    expect((await character(rig, chatId, id)).fidelity.pin.gm).toBeNull();

    await edit(rig, chatId, refreshOp(id));
    expect((await character(rig, chatId, id)).refreshQueued).toBe(true);

    await edit(rig, chatId, noteOp(id, null, { text: SECRET_NOTE, salience: "4" }));
    c = await character(rig, chatId, id);
    const note = c.notes.find((n) => n.text === SECRET_NOTE);
    expect(note?.salience).toBe(4);
    await edit(rig, chatId, noteOp(id, note?.id ?? "", { ...noteDraft(note), salience: "2" }));
    expect((await character(rig, chatId, id)).notes.find((n) => n.id === note?.id)?.salience).toBe(2);

    await edit(rig, chatId, commitmentOp(id, null, { ...commitmentDraft(), kind: "debt", text: "Owes Sam forty dollars", with: [other.entity], due: view.now + 1440 }));
    c = await character(rig, chatId, id);
    const debt = c.commitments.find((x) => x.text === "Owes Sam forty dollars");
    expect([debt?.kind, debt?.with, debt?.due, debt?.status]).toEqual(["debt", [other.entity], view.now + 1440, "open"]);
    expect(debt?.withNames).toEqual([other.name]);
    await edit(rig, chatId, commitmentOp(id, debt?.id ?? "", { ...commitmentDraft(debt), status: "kept" }));
    expect((await character(rig, chatId, id)).commitments.find((x) => x.id === debt?.id)?.status).toBe("kept");

    const draft = startPlanIn({ ...planDraft(view.now), what: "Walk down to the marina", kind: "leisure", with: [other.entity], priority: 4 }, view.now, 3);
    await edit(rig, chatId, planOp(id, null, draft));
    c = await character(rig, chatId, id);
    const plan = c.plans.find((p) => p.what === "Walk down to the marina");
    expect([plan?.when, plan?.priority, plan?.source, plan?.with]).toEqual([{ from: view.now + 180, to: view.now + 240 }, 4, "gm", [other.entity]]);
    await edit(rig, chatId, planOp(id, plan?.id ?? "", { ...planDraft(view.now, plan), status: "dropped" }));
    expect((await character(rig, chatId, id)).plans.find((p) => p.id === plan?.id)?.status).toBe("dropped");

    // A GM's note is private: nothing Play is pushed carries it.
    for (const m of rig.host.sent) if (m.type === "lre.state.snapshot" || m.type === "lre.state.delta") expect(JSON.stringify(m)).not.toContain(SECRET_NOTE);

    await edit(rig, chatId, deleteOp(id, "note", note?.id ?? ""));
    await edit(rig, chatId, deleteOp(id, "commitment", debt?.id ?? ""));
    await edit(rig, chatId, deleteOp(id, "plan", plan?.id ?? ""));
    c = await character(rig, chatId, id);
    expect([c.notes.some((n) => n.id === note?.id), c.commitments.some((x) => x.id === debt?.id), c.plans.some((p) => p.id === plan?.id)]).toEqual([false, false, false]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the player's own character has no mind to pin", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as { entities: { id: string; pov: boolean }[]; minds: MindsGmView };
    const pov = gm.entities.find((e) => e.pov)?.id ?? "";
    expect(gm.minds.characters.some((c) => c.entity === pov)).toBe(false);
    const refused = await rig.send(editRequest(chatId, [pinOp(pov, "live")]) as unknown as Record<string, unknown>);
    expect(refused.type).toBe("lre.error");
  });

  test("a commitment or plan is with people only: naming a thing or a vehicle is refused", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const refused = await rig.send(editRequest(chatId, [commitmentOp("danny_okafor", null, { ...commitmentDraft(), kind: "debt", text: "Owes the truck a wash", with: ["pov_truck"] })].flatMap((op) => (op ? [op] : []))) as unknown as Record<string, unknown>);
    expect(refused.type).toBe("lre.error");
    expect(JSON.stringify(refused)).toContain("isn't a person");
    await edit(rig, chatId, commitmentOp("danny_okafor", null, { ...commitmentDraft(), kind: "debt", text: "Owes Priya a coffee", with: ["priya_nair"] }));
    expect((await character(rig, chatId, "danny_okafor")).commitments.map((c) => c.with)).toEqual([["priya_nair"]]);
  });
});
