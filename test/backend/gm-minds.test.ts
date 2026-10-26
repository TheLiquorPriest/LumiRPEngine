// The GM view's Minds tab against the backend (DESIGN §24.9): every control the tab sends, built by
// its own request helpers, goes through `lre.edit` and reads back from `lre.gm`; what it writes stays
// out of everything Play is pushed.

import { describe, expect, test } from "bun:test";
import { commitmentDraft, commitmentOp, deleteOp, intentOp, noteDraft, noteOp, pinOp, planDraft, planOp, refreshOp, startPlanIn } from "../../src/packs/minds/ui/ops";
import { editRequest, timelapseRequest } from "../../src/frontend/requests";
import { toChain } from "../../src/backend/ledger-io";
import { journalOf } from "../../src/packs/economy/core/journal";
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

async function undoLatest(rig: Rig, chatId: string): Promise<void> {
  const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!undo) throw new Error("no Undo chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
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

  test("an intent is set, changed and cleared from its page, each with its Undo; swipes keep it, and Play never sees it", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");
    const AIM = "AIM-MARK: get Priya to sell him the boat before the auction";
    const intent = async () => (await character(rig, chatId, "danny_okafor")).intent;
    expect(await intent()).toBeNull();

    await edit(rig, chatId, intentOp("danny_okafor", { text: AIM, approach: "proactive" }));
    expect(await intent()).toEqual({ text: AIM, approach: "proactive" });
    await edit(rig, chatId, intentOp("danny_okafor", { text: "Keep his head down at the shop", approach: "reactive" }));
    expect(await intent()).toEqual({ text: "Keep his head down at the shop", approach: "reactive" });
    await undoLatest(rig, chatId);
    expect(await intent()).toEqual({ text: AIM, approach: "proactive" });
    // Over its cap the form refuses it.
    expect(intentOp("danny_okafor", { text: "x".repeat(601), approach: null })).toBeNull();

    // A swipe keeps it, Re-narrate and Re-run alike, as it keeps a pin.
    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The street wakes slowly.");
    expect(await intent()).toEqual({ text: AIM, approach: "proactive" });
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "A third morning.");
    expect(await intent()).toEqual({ text: AIM, approach: "proactive" });

    // Nothing Play is pushed carries it.
    for (const m of rig.host.sent) if (m.type === "lre.state.snapshot" || m.type === "lre.state.delta") expect(JSON.stringify(m)).not.toContain("AIM-MARK");
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain("AIM-MARK");

    // Blank text and no approach clear it; Undo brings it back.
    await edit(rig, chatId, intentOp("danny_okafor", { text: "  ", approach: null }));
    expect(await intent()).toBeNull();
    await undoLatest(rig, chatId);
    expect(await intent()).toEqual({ text: AIM, approach: "proactive" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a pay plan the GM makes with an amount, then edits, is paid at its time from the planner to the person it's with", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = await minds(rig, chatId);
    const draft = startPlanIn({ ...planDraft(view.now), what: "Pay Priya back for the ferry", kind: "pay", with: ["priya_nair"], cents: 2500 }, view.now, 1);
    // The form refuses a pay plan with no amount, or no one to hand it to.
    expect(planOp("danny_okafor", null, { ...draft, cents: null })).toBeNull();
    expect(planOp("danny_okafor", null, { ...draft, with: [] })).toBeNull();
    await edit(rig, chatId, planOp("danny_okafor", null, draft));
    let plan = (await character(rig, chatId, "danny_okafor")).plans.find((p) => p.kind === "pay");
    expect([plan?.cents, plan?.with, plan?.status]).toEqual([2500, ["priya_nair"], "open"]);
    // Editing it from its own draft keeps the amount unless the GM changes it.
    await edit(rig, chatId, planOp("danny_okafor", plan?.id ?? "", { ...planDraft(view.now, plan), priority: 4 }));
    expect((await character(rig, chatId, "danny_okafor")).plans.find((p) => p.id === plan?.id)?.cents).toBe(2500);
    await edit(rig, chatId, planOp("danny_okafor", plan?.id ?? "", { ...planDraft(view.now, plan), cents: 3000 }));
    plan = (await character(rig, chatId, "danny_okafor")).plans.find((p) => p.id === plan?.id);
    expect(plan?.cents).toBe(3000);

    const palette = (await rig.rt.view(chatId, rig.host.userId)).palette?.timelapse;
    if (!palette) throw new Error("no Timelapse");
    rig.body(await rig.send({ ...timelapseRequest(palette, { type: "duration", minutes: 3 * 60 }, {}, chatId), now: true }));
    await rig.host.settle();
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Time passes.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    if (!core) throw new Error("no ledger");
    const { state } = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
    const flow = `plan:danny_okafor:${plan?.id}`;
    expect(journalOf(state, "acct_danny_checking").filter((j) => j.flow === flow).map((j) => j.cents)).toEqual([-3000]);
    expect(journalOf(state, "acct_priya_checking").filter((j) => j.flow === flow).map((j) => j.cents)).toEqual([3000]);
    expect((await character(rig, chatId, "danny_okafor")).plans.find((p) => p.id === plan?.id)?.status).toBe("done");
  });
});

describe("the Minds tab reads what the next turn reads", () => {
  test("once a reply follows a reply, the message before them no longer counts toward who matters now", async () => {
    /** Marcus's fidelity once `said` got a reply and a second reply followed it, Send with nothing typed. */
    const after = async (said: string) => {
      const rig = new Rig({ shipped: true });
      const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
      const chatId = rig.host.createChat("Morning.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      await rig.turn(chatId, said, "The street wakes up around you.");
      const reply = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(reply, "A bus rolls past.");
      return (await character(rig, chatId, "marcus_delgado")).fidelity;
    };
    // Neither reply names him, and the next turn reads no message of the player's.
    expect(await after("I ask about Marcus Delgado's shop.")).toEqual(await after("I wait on the porch."));
  });
});
