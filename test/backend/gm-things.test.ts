// GM → Things (ITEMS-SPEC §10.2, §7.5, §6.2, §12 Phase 3, lane G) on Port Alder through the backend:
// Tidy up's audit of a chat's things, each kind of finding with the GM edit that fixes it and that
// edit's Undo, its bought fridge read from a ledger an earlier build recorded
// (`gm-things-fridge-58b2ac44.json`: the build at 58b2ac44 put every purchase on its payer), the
// other kinds from reads an older build could have recorded; Leave it, kept beside the chat, and
// the findings a run shows; a thing's page with why it is had, where it rests, its history and the
// grants of it, a loan's end among them; and Keep in the world, which copies the things and places
// the chat made in play into its world's draft.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeLedger, encodeLedger, journalPath, toChain } from "../../src/backend/ledger-io";
import type { Journal, LedgerEvent, MessageLedger } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
import type { GmThingExtras, KeepResult, MadeInPlay, TidyRun } from "../../src/shared/thing-gm";
import type { ThingPage } from "../../src/shared/thing-view";
import type { WorldDoc } from "../../src/shared/world";
import type { WorldState } from "../../src/engine/state";
import { Rig } from "../support/rig";

const RECORDED = JSON.parse(readFileSync(join(import.meta.dir, "gm-things-fridge-58b2ac44.json"), "utf8")) as { events: LedgerEvent[] };
/** The fridge the recorded purchase made. */
const FRIDGE = "item:81d6cb7cf8df";

/** A Port Alder chat after one turn, its world's id with it. */
async function portAlder(rig: Rig): Promise<{ chatId: string; worldId: string }> {
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I head out to the market.", "You drive to Alder Market.");
  return { chatId, worldId };
}

/**
 * The reply's read as an earlier build recorded it: `events` after the turn's own, in the head
 * reply's record, on its message and in the chat's journal alike (the journal's copy is the one a
 * fold reads, and the one written back over the message's).
 */
async function recordRead(rig: Rig, chatId: string, events: readonly LedgerEvent[]): Promise<void> {
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  const ledger = structuredClone(decodeLedger(head.bag)) as MessageLedger | null;
  const rec = ledger?.swipes[String(head.swipeId)];
  if (!ledger || !rec) throw new Error("no record");
  rec.events.push(...structuredClone(events as LedgerEvent[]));
  head.bag = encodeLedger(head.bag, ledger);
  const user = rig.host.userId;
  const journal = JSON.parse((await rig.host.storage.read(journalPath(chatId), user)) ?? "null") as Journal | null;
  const held = journal?.messages[head.id]?.ledger.swipes[String(head.swipeId)];
  if (!journal || !held) throw new Error("no journaled record");
  held.events.push(...structuredClone(events as LedgerEvent[]));
  await rig.host.storage.write(journalPath(chatId), JSON.stringify(journal), user);
}

/** A Port Alder chat whose first reply's read an earlier build recorded with `events` after its own, opened again by this build. */
async function oldChat(events: readonly LedgerEvent[]): Promise<{ rig: Rig; chatId: string; worldId: string }> {
  const first = new Rig({ shipped: true });
  const chat = await portAlder(first);
  await recordRead(first, chat.chatId, events);
  // The chat opened again by this build: what the old one recorded folds as it was recorded.
  return { rig: first.restart(), ...chat };
}

async function headState(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  if (!render) throw new Error("no state");
  return render;
}

/** A GM → Things read of the chat's head. */
async function things(rig: Rig, chatId: string, read: Record<string, unknown>): Promise<Record<string, unknown>> {
  return rig.body(await rig.send({ type: "lre.things", scope: "gm", chatId, ...read }));
}

async function tidy(rig: Rig, chatId: string): Promise<TidyRun> {
  return (await things(rig, chatId, { op: "tidy" })).tidy as TidyRun;
}

async function edit(rig: Rig, chatId: string, ops: EditOp[]): Promise<string> {
  const result = rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
  if (typeof result.undo !== "string") throw new Error("no undo chip");
  return result.undo;
}

describe("Tidy up: a bought fridge an earlier build put on Jordan", () => {
  test("a finding whose Fix puts it at 114 Harbor Street, his home, not where he stands; Undo puts it back on him", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    const before = await headState(rig, chatId);
    expect(before.state.entities.pov?.fields.place).toBe("alder_market");
    expect(before.state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);

    const run = await tidy(rig, chatId);
    const finding = run.findings.find((f) => f.kind === "too_big" && f.things.includes(FRIDGE));
    expect(finding?.text).toBe("Refrigerator is on Jordan Ellis: too big to carry (Furniture; a person carries up to Armful). It was bought: put it at 114 Harbor Street, where Jordan Ellis lives?");
    expect(finding?.fix?.label).toBe("Put it at 114 Harbor Street");
    expect(finding?.fix?.ops).toEqual([{ op: "item", change: { do: "move", item: FRIDGE, to: { place: "harbor_street_114" }, why: "Too big to carry: delivered to the buyer's home" } }]);

    const undo = await edit(rig, chatId, finding?.fix?.ops ?? []);
    const fixed = await headState(rig, chatId);
    expect(fixed.state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    expect(fixed.state.entities[FRIDGE]?.relations.some((r) => r.type === "in")).toBe(false);
    expect(fixed.state.entities.pov?.fields.place).toBe("alder_market");
    expect((await tidy(rig, chatId)).findings.some((f) => f.things.includes(FRIDGE))).toBe(false);

    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo, choice: "undo" }));
    const undone = await headState(rig, chatId);
    expect(undone.state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    expect(undone.state.entities[FRIDGE]?.fields.place).toBeUndefined();
    expect((await tidy(rig, chatId)).findings.some((f) => f.key === finding?.key)).toBe(true);
  });
});

describe("Tidy up's other kinds, each with the GM edit that fixes it", () => {
  test("in two places at once: kept at the place, where play reads it, or on whoever holds it", async () => {
    const { rig, chatId } = await oldChat([{ type: "set", entity: "pov_phone", field: "place", value: "harbor_street_114" }]);
    const finding = (await tidy(rig, chatId)).findings.find((f) => f.key === "two_places:pov_phone");
    expect(finding?.text).toBe("Phone lies at 114 Harbor Street and is on Jordan Ellis at once; play reads it at 114 Harbor Street.");
    expect(finding?.fix?.label).toBe("Keep it at 114 Harbor Street");
    expect(finding?.choices.map((c) => c.label)).toEqual(["Keep it on Jordan Ellis"]);

    const undo = await edit(rig, chatId, finding?.fix?.ops ?? []);
    const atHome = (await headState(rig, chatId)).state.entities.pov_phone;
    expect(atHome?.fields.place).toBe("harbor_street_114");
    expect(atHome?.relations.some((r) => r.type === "in")).toBe(false);
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "two_places")).toBe(false);

    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo, choice: "undo" }));
    await edit(rig, chatId, finding?.choices[0]?.ops ?? []);
    const onHim = (await headState(rig, chatId)).state.entities.pov_phone;
    expect(onHim?.fields.place ?? null).toBeNull();
    expect(onHim?.relations.some((r) => r.type === "in" && r.to === "pov")).toBe(true);
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "two_places")).toBe(false);
  });

  test("an owner a reply's read set on a handover: its owner's again, held by the one it was handed to", async () => {
    const group = "fx:handover";
    const { rig, chatId } = await oldChat([
      { type: "unlink", rel: "worn_by", from: "pov_pocketknife", to: "pov", group },
      { type: "unlink", rel: "in", from: "pov_pocketknife", to: "pov", group },
      { type: "link", rel: "in", from: "pov_pocketknife", to: "danny_okafor", group },
      { type: "set", entity: "pov_pocketknife", field: "owner", value: "danny_okafor", group },
    ]);
    const finding = (await tidy(rig, chatId)).findings.find((f) => f.kind === "handover_owner");
    expect(finding?.things).toEqual(["pov_pocketknife"]);
    expect(finding?.text).toBe("Pocketknife became Danny Okafor's when Jordan Ellis handed it over in a reply. A handover keeps the owner unless the story says it was a gift, a sale or a trade.");
    expect(finding?.fix?.label).toBe("Make it Jordan Ellis's again");
    expect(finding?.fix?.ops).toEqual([
      { op: "item", change: { do: "own", item: "pov_pocketknife", owner: "pov", why: "A handover keeps the owner" } },
      { op: "item", change: { do: "grant", item: "pov_pocketknife", who: "danny_okafor", basis: "hold", by: "pov" } },
    ]);

    await edit(rig, chatId, finding?.fix?.ops ?? []);
    const { state } = await headState(rig, chatId);
    expect(state.entities.pov_pocketknife?.fields.owner).toBe("pov");
    expect(state.entities.pov_pocketknife?.relations).toContainEqual({ type: "in", to: "danny_okafor" });
    expect(state.entities.danny_okafor?.relations.find((r) => r.type === "uses" && r.to === "pov_pocketknife")?.fields?.basis).toBe("hold");
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "handover_owner")).toBe(false);
  });

  test("a likely duplicate: one made in play beside the world's own of its type and owner, merged into the world's", async () => {
    const made = "item:5e0c9b2d41aa";
    const { rig, chatId } = await oldChat([{ type: "spawn", entity: { id: made, kind: "item", name: "Keys", tier: "background", fields: { owner: "pov", catalog: "keys_set" }, relations: [{ type: "in", to: "pov" }] } }]);
    const finding = (await tidy(rig, chatId)).findings.find((f) => f.kind === "duplicate");
    expect(finding?.things).toEqual([made, "pov_keys"]);
    expect(finding?.text).toBe("Keys (on Jordan Ellis) and Keys (on Jordan Ellis, made in play) may be the same thing: both Jordan Ellis's.");
    expect(finding?.fix?.ops).toEqual([{ op: "item", change: { do: "merge", keep: "pov_keys", drop: made } }]);

    await edit(rig, chatId, finding?.fix?.ops ?? []);
    const { state } = await headState(rig, chatId);
    expect(state.entities[made]?.fields.merged_into).toBe("pov_keys");
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "duplicate")).toBe(false);
  });

  test("a thing made in play whose size nothing gives: each size to pick, none picked for the GM", async () => {
    const rig = new Rig({ shipped: true });
    const { chatId } = await portAlder(rig);
    await edit(rig, chatId, [{ op: "item", change: { do: "make", name: "Strange gadget", at: { place: "harbor_street_114" }, why: "Left on the doorstep" } }]);
    const finding = (await tidy(rig, chatId)).findings.find((f) => f.kind === "size_unknown");
    expect(finding?.text).toBe("Strange gadget was made in play, and nothing gives its size (its type, volume or category), so play treats it as portable. What size is it?");
    expect(finding?.fix).toBeNull();
    expect(finding?.choices.map((c) => c.label)).toEqual(["Pocket", "Hand", "Armful", "Heavy", "Furniture", "Built-in"]);

    const id = finding?.things[0] ?? "";
    await edit(rig, chatId, finding?.choices.find((c) => c.label === "Hand")?.ops ?? []);
    expect((await headState(rig, chatId)).state.entities[id]?.fields.size).toBe("hand");
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "size_unknown")).toBe(false);
  });
});

describe("Leave it, and how many findings a run shows", () => {
  test("a finding left stays out of every run, kept beside the chat through a restart, until it is brought back", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    const run = await tidy(rig, chatId);
    const fridge = run.findings.find((f) => f.things.includes(FRIDGE));
    if (!fridge) throw new Error("no finding");
    const left = (await things(rig, chatId, { op: "leave", key: fridge.key, left: true })).tidy as TidyRun;
    expect(left.findings.some((f) => f.key === fridge.key)).toBe(false);
    expect(left.left).toBe(1);
    expect(left.total).toBe(run.total - 1);
    expect(left.leftOut.map((f) => f.key)).toEqual([fridge.key]);
    // Never in the ledger: the fridge is still on Jordan, and the chat's journal never heard of it.
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);

    const again = rig.restart();
    expect((await tidy(again, chatId)).leftOut.map((f) => f.key)).toEqual([fridge.key]);
    const back = (await things(again, chatId, { op: "leave", key: fridge.key, left: false })).tidy as TidyRun;
    expect(back.findings.map((f) => f.key)).toContain(fridge.key);
    expect(back.left).toBe(0);
  });

  test("a run shows at most the user's findings per run, saying how many there are", async () => {
    const { rig, chatId } = await oldChat([...RECORDED.events, { type: "set", entity: "pov_phone", field: "place", value: "harbor_street_114" }]);
    const all = await tidy(rig, chatId);
    expect(all.limit).toBe(50);
    expect(all.total).toBeGreaterThanOrEqual(2);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { tidy: { findings: 1 } } }));
    const one = await tidy(rig, chatId);
    expect(one.limit).toBe(1);
    expect(one.findings).toEqual(all.findings.slice(0, 1));
    expect(one.total).toBe(all.total);
  });
});

describe("a thing's page in GM, and the list's Here", () => {
  test("the bought fridge's: made in play, why Jordan has it, its history in the chat, its finding and the loans Hand to… offers", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    const body = await things(rig, chatId, { op: "thing", entity: FRIDGE });
    const gm = body.gm as GmThingExtras;
    expect(gm.made).toBe(true);
    expect(gm.why).toBe("Theirs");
    expect(gm.pov).toBe("pov");
    expect(gm.findings.map((f) => f.kind)).toEqual(["too_big"]);
    expect(gm.history[0]).toMatchObject({ turn: 1, source: "story" });
    expect(gm.loans.map((l) => l.label.split(",")[0])).toEqual(["For a day", "For three days", "For a week"]);
    expect(gm.loans.every((l, i) => i === 0 || l.until > (gm.loans[i - 1]?.until ?? 0))).toBe(true);
  });

  test("a thing the GM moved: where it rests, Put it away back there, and the GM's move at the top of its history", async () => {
    const rig = new Rig({ shipped: true });
    const { chatId } = await portAlder(rig);
    await edit(rig, chatId, [{ op: "item", change: { do: "move", item: "pov_toolbox", to: { place: "harbor_street_114" }, why: "Brought home" } }]);
    const gm = (await things(rig, chatId, { op: "thing", entity: "pov_toolbox" })).gm as GmThingExtras;
    expect(gm.rest).toMatchObject({ owner: false, from: "authored" });
    expect(gm.rest?.where.at(-1)?.id).toBe("alder_automotive");
    expect(gm.putAway).toEqual({ place: "alder_automotive" });
    expect(gm.history[0]?.source).toBe("gm");
    expect(gm.why).toBeNull();
    expect(gm.made).toBe(false);

    await edit(rig, chatId, [{ op: "item", change: { do: "move", item: "pov_toolbox", to: { place: "alder_automotive" }, why: "Put away" } }]);
    expect(((await things(rig, chatId, { op: "thing", entity: "pov_toolbox" })).gm as GmThingExtras).putAway).toBeNull();
  });

  test("a grant with an end, one the loans Hand to… offers, is a loan the page shows until then, the GM's and the player's alike; an end before now is refused", async () => {
    const rig = new Rig({ shipped: true });
    const { chatId } = await portAlder(rig);
    const page = async (): Promise<{ thing: ThingPage; gm: GmThingExtras }> => {
      const body = await things(rig, chatId, { op: "thing", entity: "pov_toolbox" });
      return { thing: body.thing as ThingPage, gm: body.gm as GmThingExtras };
    };
    const [day, , week] = (await page()).gm.loans;
    if (!day || !week) throw new Error("no loans offered");
    await edit(rig, chatId, [{ op: "item", change: { do: "grant", item: "pov_toolbox", who: "danny_okafor", until: day.until, by: "pov" } }]);
    // The player's ✎ lends it for a week the same way.
    rig.body(await rig.send({ type: "lre.fix", chatId, thing: { do: "grant", item: "pov_toolbox", who: "marcus_delgado", until: week.until } }));
    const ends = (label: string): string => label.slice(label.indexOf("until ") + "until ".length);
    expect((await page()).thing.grants.map((g) => [g.who.id, g.basis, g.until])).toEqual([
      ["danny_okafor", "loan", ends(day.label)],
      ["marcus_delgado", "loan", ends(week.label)],
    ]);
    const now = (await headState(rig, chatId)).state.clock;
    expect(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "item", change: { do: "grant", item: "pov_toolbox", who: "danny_okafor", until: now } }] })).toMatchObject({ type: "lre.error", message: "a grant's end is after now" });
  });

  test("the list says where the player character is, and why each one who has a thing has it", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    const here = (await things(rig, chatId, { op: "list" })).here as { here: string | null; why: Record<string, string> };
    expect(here.here).toBe("alder_market");
    expect(here.why[FRIDGE]).toBe("Theirs");
    expect(here.why.pov_keys).toBe("Theirs");
    expect(here.why.pov_toolbox).toBeUndefined();
  });
});

describe("Keep in the world", () => {
  /** A Port Alder chat that made a garage in play at 114 Harbor Street, a corner shelf in it, and a workbench lying there. */
  async function madeAtHome(): Promise<{ rig: Rig; chatId: string; worldId: string; garage: string; shelf: string; bench: string }> {
    const rig = new Rig({ shipped: true });
    const { chatId, worldId } = await portAlder(rig);
    await edit(rig, chatId, [{ op: "place", change: { do: "make", name: "Garage", parent: "harbor_street_114", as: "room", why: "Jordan keeps the truck there" } }]);
    const garage = ((await things(rig, chatId, { op: "made" })).made as MadeInPlay).places.find((p) => p.name === "Garage")?.id ?? "";
    await edit(rig, chatId, [{ op: "place", change: { do: "make", name: "Corner shelf", parent: garage, as: "spot", why: "Where the tools go" } }]);
    await edit(rig, chatId, [{ op: "item", change: { do: "make", name: "Workbench", size: "furniture", at: { place: garage }, owner: "pov", why: "Built last winter" } }]);
    const made = (await things(rig, chatId, { op: "made" })).made as MadeInPlay;
    return { rig, chatId, worldId, garage, shelf: made.places.find((p) => p.name === "Corner shelf")?.id ?? "", bench: made.things.find((t) => t.name === "Workbench")?.id ?? "" };
  }

  test("what the chat made in play, copied into the world's draft under its own ids, the places around one first", async () => {
    const { rig, chatId, worldId, garage, shelf, bench } = await madeAtHome();
    const made = (await things(rig, chatId, { op: "made" })).made as MadeInPlay;
    expect(made.places.map((p) => [p.id, p.as, p.path.at(-1)?.id, p.inDraft])).toEqual([
      [garage, "room", "harbor_street_114", false],
      [shelf, "spot", garage, false],
    ]);
    expect(made.things.find((t) => t.id === bench)).toMatchObject({ name: "Workbench", inDraft: false });

    // A place in one made in play is kept only with it.
    const alone = (await things(rig, chatId, { op: "keep", things: [], places: [shelf] })).kept as KeepResult;
    expect(alone).toEqual({ things: [], places: [], skipped: [{ id: shelf, reason: "Corner shelf: it is in Garage, which was made in play too: keep it as well" }], notes: [] });

    const body = await things(rig, chatId, { op: "keep", things: [bench], places: [shelf, garage] });
    expect(body.kept).toEqual({ things: [bench], places: [garage, shelf], skipped: [], notes: [] });
    const draft = await rig.rt.worlds.working(worldId, rig.host.userId);
    expect(draft.places[garage]).toMatchObject({ id: garage, name: "Garage", parent: "harbor_street_114" });
    expect(Object.hasOwn(draft.places[garage] ?? {}, "made")).toBe(false);
    expect(draft.places[shelf]?.parent).toBe(garage);
    expect(draft.entities[bench]?.fields).toMatchObject({ place: garage, owner: "pov", size: "furniture" });
    expect(draft.entities[bench]?.fields.made).toBeUndefined();
    // What Keep answers is the list after it: all of it in the draft now, and a second Keep skips it.
    const after = body.made as MadeInPlay;
    expect([...after.places, ...after.things].filter((x) => [garage, shelf, bench].includes(x.id)).every((x) => x.inDraft)).toBe(true);
    const again = (await things(rig, chatId, { op: "keep", things: [bench], places: [garage] })).kept as KeepResult;
    expect(again.skipped.map((s) => s.reason)).toEqual(["Garage: the world's draft has it already", "Workbench: the world's draft has it already"]);
    // The chat plays on as it did: its garage is still the one it made.
    expect(((await headState(rig, chatId)).state.packs.space?.places as Record<string, unknown> | undefined)?.[garage]).toBeDefined();
  });

  test("a thing kept without the place it lies at lies at the nearest place the draft has, and says so", async () => {
    const { rig, chatId, worldId, bench } = await madeAtHome();
    const kept = (await things(rig, chatId, { op: "keep", things: [bench], places: [] })).kept as KeepResult;
    expect(kept.things).toEqual([bench]);
    expect(kept.notes).toEqual(["Workbench: Garage isn't in the world, so it lies at 114 Harbor Street."]);
    expect((await rig.rt.worlds.working(worldId, rig.host.userId)).entities[bench]?.fields.place).toBe("harbor_street_114");
  });
});

describe("every turn's Things tidied fix (ITEMS-SPEC §9, §12 Phase 4; N3)", () => {
  test("an old chat's next turn records it before the turn reads, with Undo: the bought fridge an earlier build put on Jordan goes to 114 Harbor Street", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    const fixed = await headState(rig, chatId);
    expect(fixed.state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    expect(fixed.state.entities[FRIDGE]?.relations.some((r) => r.type === "in")).toBe(false);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "tidied");
    expect(chips.map((c) => [c.label, c.actions.map((a) => a.id)])).toEqual([["Things tidied", ["undo"]]]);
    expect(chips[0]?.detail).toEndWith("Undo puts them back as they were.");
    expect((await tidy(rig, chatId)).findings.some((f) => f.things.includes(FRIDGE))).toBe(false);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chips[0]?.id ?? "", choice: "undo" }));
    const undone = await headState(rig, chatId);
    expect(undone.state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    // The player's Undo holds: while the fridge stays on him, the next turn leaves it there, and the finding waits in Tidy up.
    await rig.turn(chatId, "I head for the checkout.", "You queue at the checkout.");
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "tidied")).toBe(false);
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "too_big" && f.things.includes(FRIDGE))).toBe(true);
  });

  test("a chat with nothing too big on anyone records no fix", async () => {
    const rig = new Rig({ shipped: true });
    const { chatId } = await portAlder(rig);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce.");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "tidied")).toBe(false);
  });

  test("with the world's Tidy impossible holds automatically off, the old chat's first turn records nothing, and the finding waits in Tidy up", async () => {
    const first = new Rig({ shipped: true });
    const worldId = await first.newWorld("Port Alder", "modern_slice_of_life");
    const draft = first.body(await first.send({ type: "lre.editor", op: "get", worldId, base: null }));
    first.body(await first.send({ type: "lre.editor", op: "patch", worldId, base: draft.base, ops: [{ op: "add", path: "/packs/gear/config/tidy", value: { auto: false } }] }));
    first.body(await first.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = first.host.createChat("Morning.");
    first.body(await first.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await first.turn(chatId, "I head out to the market.", "You drive to Alder Market.");
    await recordRead(first, chatId, RECORDED.events);
    const rig = first.restart();
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "tidied")).toBe(false);
    expect((await tidy(rig, chatId)).findings.some((f) => f.kind === "too_big" && f.things.includes(FRIDGE))).toBe(true);
  });

  test("this chat's own switch (GM → This chat → Things) overrides the world's: off, the first turn records nothing; back to the world's, the next turn tidies", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.things.tidy).toEqual({ chat: null, world: true });
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, tidy: false }))).toEqual({ knowledge: null, narrator: null, tidy: false });
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.things.tidy).toEqual({ chat: false, world: true });
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "tidied")).toBe(false);
    // Kept beside the chat, not in its story: read again, and through a restart.
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId })).tidy).toBe(false);
    const again = rig.restart();
    expect(again.body(await again.send({ type: "lre.chat.knowledge", chatId })).tidy).toBe(false);
    // Following the world's again, the chain holds no fix yet, so the next turn records it.
    expect(again.body(await again.send({ type: "lre.chat.knowledge", chatId, tidy: null }))).toEqual({ knowledge: null, narrator: null });
    await again.turn(chatId, "I pick out some apples.", "You pick out some apples.");
    expect((await headState(again, chatId)).state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    expect((await again.rt.view(chatId, again.host.userId)).chips.filter((c) => c.kind === "tidied").map((c) => c.label)).toEqual(["Things tidied"]);
    expect((await again.send({ type: "lre.chat.knowledge", chatId, tidy: "yes" })).type).toBe("lre.error");
  });

  test("on in a chat whose world has it off, the old chat's first turn tidies", async () => {
    const first = new Rig({ shipped: true });
    const worldId = await first.newWorld("Port Alder", "modern_slice_of_life");
    const draft = first.body(await first.send({ type: "lre.editor", op: "get", worldId, base: null }));
    first.body(await first.send({ type: "lre.editor", op: "patch", worldId, base: draft.base, ops: [{ op: "add", path: "/packs/gear/config/tidy", value: { auto: false } }] }));
    first.body(await first.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = first.host.createChat("Morning.");
    first.body(await first.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await first.turn(chatId, "I head out to the market.", "You drive to Alder Market.");
    await recordRead(first, chatId, RECORDED.events);
    const rig = first.restart();
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.things.tidy).toEqual({ chat: null, world: false });
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, tidy: true })).tidy).toBe(true);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    const fixed = await headState(rig, chatId);
    expect(fixed.state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    expect(fixed.state.entities[FRIDGE]?.relations.some((r) => r.type === "in")).toBe(false);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "tidied").map((c) => c.label)).toEqual(["Things tidied"]);
  });
});

/** A TV an earlier build put on Jordan when he bought it, as it recorded the purchase's thing. */
const TV = "item:tv55recorded";
const BOUGHT_TV: LedgerEvent = { type: "spawn", entity: { id: TV, kind: "item", name: "Television, 55 in 4K", tier: "background", fields: { notable: true, owner: "pov", catalog: "tv_55_4k", category: "electronics", got: { how: "bought", at: 1 } }, relations: [{ type: "in", to: "pov" }] } } as LedgerEvent;

describe("every turn's tidy, turn after turn (N3)", () => {
  test("the fridge and the TV of a world whose catalog has no size column go to Jordan's home on the next turn, under one chip whose Undo puts both back", async () => {
    // The world's own catalog as an older build copied it: no size, aliases or holds on these rows.
    const first = new Rig({ shipped: true });
    const worldId = await first.newWorld("Port Alder", "modern_slice_of_life");
    const draft = first.body(await first.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const strip = [...["size", "aliases", "holds"].map((c) => `/tables/economy.catalog/rows/refrigerator/${c}`), ...["size", "aliases"].map((c) => `/tables/economy.catalog/rows/tv_55_4k/${c}`)].map((path) => ({ op: "remove", path }));
    first.body(await first.send({ type: "lre.editor", op: "patch", worldId, base: draft.base, ops: strip }));
    first.body(await first.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = first.host.createChat("Morning.");
    first.body(await first.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await first.turn(chatId, "I head out to the market.", "You drive to Alder Market.");
    await recordRead(first, chatId, [...RECORDED.events, BOUGHT_TV]);
    const rig = first.restart();
    expect((await headState(rig, chatId)).state.entities[TV]?.relations).toEqual([{ type: "in", to: "pov" }]);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    const fixed = await headState(rig, chatId);
    for (const id of [FRIDGE, TV]) {
      expect(fixed.state.entities[id]?.fields.place).toBe("harbor_street_114");
      expect(fixed.state.entities[id]?.relations.some((r) => r.type === "in")).toBe(false);
    }
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "tidied");
    expect(chips.map((c) => c.label)).toEqual(["Things tidied"]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chips[0]?.id ?? "", choice: "undo" }));
    const undone = await headState(rig, chatId);
    for (const id of [FRIDGE, TV]) expect(undone.state.entities[id]?.relations).toEqual([{ type: "in", to: "pov" }]);
  });

  test("a later impossible hold is tidied on the turn after it, the earlier one staying home", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    // The next reply's read, as an earlier build recorded it, puts a TV he bought on him; the chat opened again by this build.
    await recordRead(rig, chatId, [BOUGHT_TV]);
    const next = rig.restart();
    expect((await headState(next, chatId)).state.entities[TV]?.relations).toEqual([{ type: "in", to: "pov" }]);
    await next.turn(chatId, "I head for the checkout.", "You queue at the checkout.");
    const head = await headState(next, chatId);
    expect(head.state.entities[TV]?.fields.place).toBe("harbor_street_114");
    expect(head.state.entities[FRIDGE]?.fields.place).toBe("harbor_street_114");
    expect((await next.rt.view(chatId, next.host.userId)).chips.filter((c) => c.kind === "tidied").map((c) => c.label)).toEqual(["Things tidied"]);
  });

  test("the chip's detail lists every move, a line each, past the eight lines a change chip keeps", async () => {
    const bought = (n: number): LedgerEvent => ({ type: "spawn", entity: { id: `${TV}_${n}`, kind: "item", name: `Television, 55 in 4K no. ${n}`, tier: "background", fields: { notable: true, owner: "pov", catalog: "tv_55_4k", category: "electronics", got: { how: "bought", at: 1 } }, relations: [{ type: "in", to: "pov" }] } }) as LedgerEvent;
    const { rig, chatId } = await oldChat([...RECORDED.events, BOUGHT_TV, bought(2), bought(3), bought(4)]);
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    const [chip, ...more] = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "tidied");
    expect(more).toEqual([]);
    const lines = (chip?.detail ?? "").split("\n");
    expect([lines[0], lines.at(-1)]).toEqual(["Put right, as play can't have them:", "Undo puts them back as they were."]);
    // Five things put down, each no longer carried and now at home: ten moves, none cut.
    expect(lines.length).toBe(12);
    for (const n of [2, 3, 4]) expect(lines.filter((l) => l.startsWith(`Television, 55 in 4K no. ${n} `))).toHaveLength(2);
  });

  test("a finding left as it is (Leave it) is never tidied, and a turn with nothing else to tidy records no chip", async () => {
    const { rig, chatId } = await oldChat(RECORDED.events);
    const finding = (await tidy(rig, chatId)).findings.find((f) => f.kind === "too_big" && f.things.includes(FRIDGE));
    if (!finding) throw new Error("no finding");
    await things(rig, chatId, { op: "leave", key: finding.key, left: true });
    await rig.turn(chatId, "I look over the produce.", "You look over the produce at Alder Market.");
    expect((await headState(rig, chatId)).state.entities[FRIDGE]?.relations).toEqual([{ type: "in", to: "pov" }]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "tidied")).toBe(false);
  });
});
