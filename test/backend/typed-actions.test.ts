// What `interpret` reads from typed text (DESIGN §5.2, §9.4, §11), on Port Alder: an action whose
// params name nothing in the world plays as plain roleplay, says why on a decline chip and tells the
// next reply it didn't happen; a message's actions play in order in one turn until the queue stops,
// and what the turn didn't play is offered as a chip that sends it as the next message.

import { describe, expect, test } from "bun:test";
import type { DecideRequest, QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { Answers } from "../../src/engine/decide";
import { placeOfEntity } from "../../src/engine/scope";
import { unrevealedSecrets } from "../../src/engine/visibility";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";

/** A secret track's truth, short enough to fit a second action. */
const TRUTH = "the ferryman sank the old boat";

/**
 * A Port Alder chat. `hidden` adds someone of that name the POV can't see, `truth` a secret track
 * holding `TRUTH`, and `secretAlias` a secret lore entry known by that alias.
 */
async function chat(extra: { hidden?: string; truth?: boolean; secretAlias?: string } = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  };
  if (extra.hidden) await put("entities", "hidden_one", { id: "hidden_one", kind: "person", name: extra.hidden, tier: "background", fields: {}, relations: [], visibility: "secret" });
  if (extra.truth) await put("tracks", "wreck", { id: "wreck", kind: "secret", label: "The wreck", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: TRUTH } } });
  if (extra.secretAlias) await put("lore", "courier", { id: "courier", title: "The masked courier", content: "The masked courier carries letters nobody else may read.", keys: [], aliases: [extra.secretAlias], links: [], secret: true, gate: "false", audience: [] });
  if (Object.keys(extra).length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` answers `read(typed text)`; every other step reads nothing. */
function reading(rig: Rig, read: (text: string) => JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify(read(req.messages[1]?.content ?? "")) : "{}");
}

/** `interpret` on the Decision route, which chooses `action`, with `calls` model calls before the reply. */
async function decisionRoute(rig: Rig, action: string, calls: number): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "standard" } } }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", budgets: { pre: { calls } }, steps: { interpret: { enabled: true, signals: ["typed_input"], route: { provider: "decision", connectionId: null, model: null } } } } } }));
  rig.host.decideReply = (req: DecideRequest): Answers => {
    const out: Answers = {};
    for (const [key, q] of Object.entries(req.questions)) {
      const choice = key === "action" ? action : q.type === "choice" ? (Object.keys(q.criteria)[0] ?? "none") : null;
      if (choice !== null) out[key] = { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 };
    }
    return out;
  };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = state ? core?.worldAt(state.revision) : undefined;
  if (!state || !world) throw new Error("no state");
  return { state, world };
}

/** The POV's money history (the Money panel's lines). */
async function history(rig: Rig, chatId: string): Promise<JsonValue[]> {
  const h = (await folded(rig, chatId)).state.packs.economy?.history;
  return Array.isArray(h) ? h : [];
}

/** The chips on the latest reply. */
async function replyChips(rig: Rig, chatId: string): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
}

/** Plays the next turn on `text` and returns what its Outcome slot told the narrator. */
async function nextTurn(rig: Rig, chatId: string, text: string): Promise<string> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
  await rig.host.finish(g, "A quiet moment passes.");
  return outcome;
}

describe("a typed action that names nothing in the world", () => {
  const pay = (to: string) => () => ({ action: "pay", params: { to, amount: 6 }, confidence: 0.9 });

  test("'I pay Rena for the latte' charges nothing, its reply says why on a decline chip, and the next reply is told it didn't happen", async () => {
    const { rig, chatId } = await chat();
    reading(rig, pay("rena"));
    const before = await history(rig, chatId);
    await rig.turn(chatId, "I pay Rena for the latte.", "You hand Rena a few bills and take the cup.");
    expect(await history(rig, chatId)).toEqual(before);
    const chip = (await replyChips(rig, chatId)).find((c) => c.kind === "decline");
    // The chip names the action and the name as the player typed it, with the usual choices.
    expect(`${chip?.label} ${chip?.detail}`).toContain("Pay");
    expect(chip?.detail).toContain("Rena");
    expect(chip?.actions.map((a) => a.id)).toEqual(["remove", "accept"]);
    const told = (await nextTurn(rig, chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"));
    expect(told).toContain("Rena");
    expect(rig.rt.ledger.errors).toEqual([]);

    // Remove it rewords that note before the next reply.
    const other = await chat();
    reading(other.rig, pay("rena"));
    await other.rig.turn(other.chatId, "I pay Rena for the latte.", "You hand Rena a few bills and take the cup.");
    const decline = (await replyChips(other.rig, other.chatId)).find((c) => c.kind === "decline");
    expect(other.rig.body(await other.rig.send({ type: "lre.chip", chatId: other.chatId, chip: decline?.id, choice: "remove" })).applied).toBe(true);
    const removed = (await nextTurn(other.rig, other.chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"));
    expect(removed).toBeDefined();
    expect(removed).not.toBe(told);
  });

  test("a name the POV can't see is never repeated on the chip", async () => {
    const { rig, chatId } = await chat({ hidden: "Vex Morrow" });
    reading(rig, pay("Vex"));
    await rig.turn(chatId, "I pay Vex for the latte.", "You look around for Vex.");
    const chips = await replyChips(rig, chatId);
    expect(chips.some((c) => c.kind === "decline")).toBe(true);
    for (const c of chips) expect(`${c.label} ${c.detail ?? ""}`.toLowerCase()).not.toContain("vex");
  });

  test("a name the player didn't type, or one that leads to secret lore, is never repeated on the chip", async () => {
    const made = await chat();
    reading(made.rig, pay("Lena"));
    await made.rig.turn(made.chatId, "I pay the barista for the latte.", "You hand the barista a few bills.");
    const madeChips = await replyChips(made.rig, made.chatId);
    expect(madeChips.some((c) => c.kind === "decline")).toBe(true);
    for (const c of madeChips) expect(`${c.label} ${c.detail ?? ""}`).not.toContain("Lena");

    const lore = await chat({ secretAlias: "Rena" });
    reading(lore.rig, pay("rena"));
    await lore.rig.turn(lore.chatId, "I pay Rena for the latte.", "You hand Rena a few bills.");
    const loreChips = await replyChips(lore.rig, lore.chatId);
    expect(loreChips.some((c) => c.kind === "decline")).toBe(true);
    for (const c of loreChips) expect(`${c.label} ${c.detail ?? ""}`.toLowerCase()).not.toContain("rena");
  });

  test("on the Decision route with no call left to read where the player goes, the move goes unread, never 'couldn't'", async () => {
    const { rig, chatId } = await chat();
    // The choice takes the only call before the reply, so none is left to fill its params.
    await decisionRoute(rig, "go", 1);
    reading(rig, () => ({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }));
    await rig.turn(chatId, "I walk to Bluebird Coffee.", "You set off down Main Street.");
    const chips = await replyChips(rig, chatId);
    expect(chips.some((c) => c.kind === "decline")).toBe(false);
    expect(chips.find((c) => c.kind === "read_failed")?.actions.map((a) => a.id)).toEqual(["rerun"]);
    expect(await nextTurn(rig, chatId, "I look around.")).not.toContain("Go to");
  });

  test("a Continue and a Re-read edit of the reply keep the decline and the note it leaves the next reply", async () => {
    const { rig, chatId } = await chat();
    reading(rig, pay("rena"));
    await rig.turn(chatId, "I pay Rena for the latte.", "You hand Rena a few bills.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const g = await rig.host.start(chatId, { type: "continue" });
    await rig.host.finish(g, " She smiles and turns to the next customer.");
    rig.host.editMessage(chatId, head.id, "You hand Rena a few bills, and she smiles.");
    await rig.host.settle();
    const reread = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    if (!reread) throw new Error("no Re-read chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" }));
    expect((await replyChips(rig, chatId)).some((c) => c.kind === "decline")).toBe(true);
    expect((await nextTurn(rig, chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"))).toContain("Rena");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a second action in the same message", () => {
  /** Reads the walk with `next` as its second action, and anything else as buying a latte. */
  const walkThenBuy =
    (next: string) =>
    (text: string): JsonObject =>
      text.startsWith("I walk") ? { action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9, next } : { action: "buy", params: { item: "latte" }, confidence: 0.9 };

  test("'I walk to Bluebird Coffee to buy a latte' walks there, and the buy is a chip that sends it; it plays as its own turn", async () => {
    const { rig, chatId } = await chat();
    reading(rig, walkThenBuy("I buy a latte"));
    await rig.turn(chatId, "I walk to Bluebird Coffee to buy a latte.", "You push open the door of the cafe.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    const chip = (await replyChips(rig, chatId)).find((c) => c.kind === "choice");
    expect(chip?.label).toBe("I buy a latte");
    const lattes = async (): Promise<number> => (await history(rig, chatId)).filter((h) => isRecord(h) && typeof h.memo === "string" && /latte/i.test(h.memo)).length;
    expect(await lattes()).toBe(0);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: chip?.actions[0]?.id })).applied).toBe(true);
    expect((await rig.host.chats.messages(chatId, rig.host.userId)).findLast((m) => m.isUser)?.content).toBe("I buy a latte");
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The barista slides a latte across the counter.");
    expect(await lattes()).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("on the Decision route, the helper call that fills the params brings it too", async () => {
    const { rig, chatId } = await chat();
    // The choice and the helper call that fills its params each take a call; NPC choices may take another.
    await decisionRoute(rig, "go", 4);
    reading(rig, walkThenBuy("I buy a latte"));
    await rig.turn(chatId, "I walk to Bluebird Coffee to buy a latte.", "You push open the door of the cafe.");
    expect(rig.host.decideCalls.some((r) => isRecord(r.questions.action))).toBe(true);
    expect((await replyChips(rig, chatId)).filter((c) => c.kind === "choice").map((c) => c.label)).toEqual(["I buy a latte"]);
  });

  test("a secret in it, or a name that leads to secret lore, drops only it: the walk still plays; time passing is never offered", async () => {
    const { rig, chatId } = await chat({ truth: true, secretAlias: "Rena" });
    const { state, world } = await folded(rig, chatId);
    expect(unrevealedSecrets(rig.rt.registry, world, state)).toContain(TRUTH);
    reading(rig, walkThenBuy(`I buy a postcard saying ${TRUTH}`));
    await rig.turn(chatId, "I walk to Bluebird Coffee to buy a postcard.", "You push open the door of the cafe.");
    const after = await folded(rig, chatId);
    expect(placeOfEntity(after.state, after.world.pov)).toBe("bluebird_coffee");
    const chips = await replyChips(rig, chatId);
    expect(chips.some((c) => c.kind === "choice")).toBe(false);
    for (const c of chips) expect(`${c.label} ${c.detail ?? ""}`).not.toContain(TRUTH);

    for (const [typed, next] of [
      ["I walk to Bluebird Coffee and buy Rena a latte.", "I buy Rena a latte"],
      ["I walk to Bluebird Coffee and sleep until the next morning.", "I sleep until the next morning"],
    ] as const) {
      reading(rig, walkThenBuy(next));
      await rig.turn(chatId, typed, "The cafe is quiet.");
      expect((await replyChips(rig, chatId)).some((c) => c.kind === "choice")).toBe(false);
    }
  });

  test("a placeholder, the message or its first action said again, or words that aren't an action are never offered", async () => {
    const { rig, chatId } = await chat();
    const offered: Record<string, string | undefined> = {};
    for (const [typed, next] of [
      ["I walk to Bluebird Coffee to buy a latte.", "none"],
      ["I walk to Bluebird Coffee to buy a mocha.", "N/A"],
      ["I walk to Bluebird Coffee to buy a scone.", "I walk to Bluebird Coffee"],
      ["I walk to Bluebird Coffee to buy a cookie.", "I walk to Bluebird Coffee to buy a cookie"],
      ["I walk to Bluebird Coffee and smile at the barista.", "I smile at the barista"],
      ["I walk to Bluebird Coffee to buy a muffin.", "I buy a muffin"],
    ] as const) {
      reading(rig, walkThenBuy(next));
      await rig.turn(chatId, typed, "The cafe is quiet.");
      offered[next] = (await replyChips(rig, chatId)).find((c) => c.kind === "choice")?.label;
    }
    expect(offered).toEqual({ none: undefined, "N/A": undefined, "I walk to Bluebird Coffee": undefined, "I walk to Bluebird Coffee to buy a cookie": undefined, "I smile at the barista": undefined, "I buy a muffin": "I buy a muffin" });
  });

  test("when the first action names nothing in the world, nothing after it is offered", async () => {
    const { rig, chatId } = await chat();
    reading(rig, () => ({ action: "pay", params: { to: "rena", amount: 6 }, confidence: 0.9, next: "I buy a muffin", then: { minutes: 60 } }));
    await rig.turn(chatId, "I pay Rena for the latte, buy a muffin and wait an hour.", "You hand Rena a few bills.");
    const kinds = (await replyChips(rig, chatId)).map((c) => c.kind);
    expect(kinds).toContain("decline");
    expect(kinds).not.toContain("choice");
    expect(kinds).not.toContain("timelapse_offer");
  });
});

describe("several actions in one message (the action queue)", () => {
  /** Reads the walk to Bluebird Coffee with `more` as its further actions, and anything else as buying a muffin. */
  const walkThen =
    (more: JsonObject[]) =>
    (text: string): JsonObject =>
      text.startsWith("I walk") ? { action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9, more } : { action: "buy", params: { item: "muffin" }, confidence: 0.9 };
  const buying = (item: string, extra: JsonObject = {}): JsonObject => ({ action: "buy", params: { item, ...extra }, text: `I buy a ${item}` });
  const bought = async (rig: Rig, chatId: string, item: RegExp): Promise<number> => (await history(rig, chatId)).filter((h) => isRecord(h) && typeof h.memo === "string" && item.test(h.memo)).length;
  const outcomeLines = (rig: Rig): string[] => (rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "").split("\n").map((line) => line.replace(/^- /, ""));

  test("'I walk to Bluebird Coffee and buy a latte' walks there and buys it in one turn, and the narrator is told both, in order", async () => {
    const { rig, chatId } = await chat();
    reading(rig, walkThen([buying("latte")]));
    await rig.turn(chatId, "I walk to Bluebird Coffee and buy a latte.", "You order at the counter.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    expect(await bought(rig, chatId, /latte/i)).toBe(1);
    const lines = outcomeLines(rig);
    const at = (action: string): number => lines.findIndex((line) => line.startsWith(`${rig.rt.registry.actions.get(action)?.label ?? action}:`));
    expect(at("go")).toBeGreaterThanOrEqual(0);
    expect(at("buy")).toBeGreaterThan(at("go"));
    expect((await replyChips(rig, chatId)).some((c) => c.kind === "choice")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Buy the money can't cover stops the queue: the rest is offered on the chip, and Send plays it as the next turn", async () => {
    const { rig, chatId } = await chat();
    reading(rig, (text): JsonObject => (text.startsWith("I buy a yacht") ? { action: "buy", params: { item: "yacht", price: 9000000 }, confidence: 0.9, more: [buying("muffin")] } : { action: "buy", params: { item: "muffin" }, confidence: 0.9 }));
    await rig.turn(chatId, "I buy a yacht for $9,000,000, then a muffin.", "The broker laughs.");
    expect(await bought(rig, chatId, /muffin/i)).toBe(0);
    expect(outcomeLines(rig).some((line) => /hasn't happened/.test(line))).toBe(true);
    const chip = (await replyChips(rig, chatId)).find((c) => c.kind === "choice");
    expect(chip?.label).toBe("I buy a muffin");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: chip?.actions[0]?.id })).applied).toBe(true);
    expect((await rig.host.chats.messages(chatId, rig.host.userId)).findLast((m) => m.isUser)?.content).toBe("I buy a muffin");
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The barista bags a muffin.");
    expect(await bought(rig, chatId, /muffin/i)).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a queued action that names nothing in the world ends the queue with its decline, and nothing after it is offered", async () => {
    const { rig, chatId } = await chat();
    reading(rig, walkThen([{ action: "pay", params: { to: "rena", amount: 6 }, text: "I pay Rena" }, buying("muffin")]));
    await rig.turn(chatId, "I walk to Bluebird Coffee, pay Rena and buy a muffin.", "You look around for Rena.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    const chips = await replyChips(rig, chatId);
    expect(chips.find((c) => c.kind === "decline")?.detail).toContain("Rena");
    expect(chips.some((c) => c.kind === "choice")).toBe(false);
    expect(await bought(rig, chatId, /muffin/i)).toBe(0);
  });
});
