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
import { heldBy } from "../../src/shared/finance";

const INTERPRET_MARK = "You map a player's typed input";

/** A secret track's truth, short enough to fit a second action. */
const TRUTH = "the ferryman sank the old boat";

/**
 * A Port Alder chat. `hidden` adds someone of that name the POV can't see, `truth` a secret track
 * holding `TRUTH`, `secretAlias` a secret lore entry known by that alias, and `puts` any other
 * editor puts, as [collection, value] with the value's own id.
 */
async function chat(extra: { hidden?: string; truth?: boolean; secretAlias?: string; puts?: [string, JsonObject][] } = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  };
  if (extra.hidden) await put("entities", "hidden_one", { id: "hidden_one", kind: "person", name: extra.hidden, tier: "background", fields: {}, relations: [], visibility: "secret" });
  if (extra.truth) await put("tracks", "wreck", { id: "wreck", kind: "secret", label: "The wreck", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: TRUTH } } });
  if (extra.secretAlias) await put("lore", "courier", { id: "courier", title: "The masked courier", content: "The masked courier carries letters nobody else may read.", keys: [], aliases: [extra.secretAlias], links: [], secret: true, gate: "false", audience: [] });
  for (const [collection, value] of extra.puts ?? []) await put(collection, String(value.id), value);
  if (Object.keys(extra).length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  // These chats hold the player to the world (DESIGN §9.4): a thing the world doesn't have drops its action, as before claims.
  rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "custom", claims: { mode: "hold", capped: false } } } }));
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
/** What was paid on the POV's own accounts: every journal line but the openings (DESIGN §25.6); a purchase writes one on the account that paid it. */
async function history(rig: Rig, chatId: string): Promise<JsonValue[]> {
  const { state, world } = await folded(rig, chatId);
  const journal = state.packs.economy?.journal;
  const lines: JsonValue[] = [];
  if (isRecord(journal)) for (const [account, entries] of Object.entries(journal)) if (heldBy(state.entities, account, world.pov) && Array.isArray(entries)) lines.push(...entries.filter((j) => !(isRecord(j) && j.kind === "opening")));
  return lines;
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
  const outcome = rig.host.section("Outcome");
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
    // The next reply's note says why in one wording, whatever the player called them (DESIGN §5.2).
    expect(told).toContain("it names no one you know");
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

  test("a name the player typed reads the same, made up or hidden, on the chip and in the next reply's note", async () => {
    const declined = async (extra: { hidden?: string; secretAlias?: string }): Promise<{ detail: string; told: string }> => {
      const { rig, chatId } = await chat(extra);
      reading(rig, pay("vex_morrow"));
      await rig.turn(chatId, "I pay Vex Morrow for the latte.", "You look around for the barista.");
      const detail = (await replyChips(rig, chatId)).find((c) => c.kind === "decline")?.detail ?? "";
      const told = (await nextTurn(rig, chatId, "I look around.")).split("\n").find((line) => line.includes("Pay")) ?? "";
      return { detail, told };
    };
    const none = await declined({});
    expect(none.detail).toStartWith("Vex Morrow isn't anyone you know.");
    expect(none.told).toContain("it names no one you know");
    // Someone hidden by that name, or a secret entry going by it: the chip says the player's own words,
    // and the note its one wording, as in a world without them.
    for (const extra of [{ hidden: "Vex Morrow" }, { secretAlias: "Vex Morrow" }]) expect(await declined(extra)).toEqual(none);
  });

  test("a name the player didn't type is never repeated on the chip", async () => {
    const made = await chat();
    reading(made.rig, pay("Lena"));
    await made.rig.turn(made.chatId, "I pay the barista for the latte.", "You hand the barista a few bills.");
    const madeChips = await replyChips(made.rig, made.chatId);
    expect(madeChips.find((c) => c.kind === "decline")?.detail).toStartWith("It names no one you know.");
    for (const c of madeChips) expect(`${c.label} ${c.detail ?? ""}`).not.toContain("Lena");
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
    expect((await nextTurn(rig, chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"))).toContain("didn't happen (it names no one you know)");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("after a swipe delete, the next reply is told only of the reply left, and its decline still rewords that note", async () => {
    // What the next reply is told after one reply whose decline was answered Remove it.
    const once = await chat();
    reading(once.rig, pay("rena"));
    await once.rig.turn(once.chatId, "I pay Rena for the latte.", "You look around for Rena.");
    const decline = (await replyChips(once.rig, once.chatId)).find((c) => c.kind === "decline");
    expect(once.rig.body(await once.rig.send({ type: "lre.chip", chatId: once.chatId, chip: decline?.id, choice: "remove" })).applied).toBe(true);
    const removed = (await nextTurn(once.rig, once.chatId, "I look around.")).split("\n").filter((line) => line.includes("Pay"));
    expect(removed).toHaveLength(1);

    // Two swipes of the same reply, each with its decline and its note; the first goes.
    const { rig, chatId } = await chat();
    reading(rig, pay("rena"));
    await rig.turn(chatId, "I pay Rena for the latte.", "You hand Rena a few bills.");
    const head = rig.host.head(chatId)?.id ?? "";
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe", messageId: head }), "You look around for Rena.");
    rig.host.deleteSwipe(chatId, head, 0);
    await rig.host.settle();
    const left = (await replyChips(rig, chatId)).filter((c) => c.kind === "decline");
    expect(left).toHaveLength(1);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: left[0]?.id, choice: "remove" })).applied).toBe(true);
    expect((await nextTurn(rig, chatId, "I look around.")).split("\n").filter((line) => line.includes("Pay"))).toEqual(removed);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("after a swipe delete, a swipe made later at the old index doesn't take the decline of the reply that moved", async () => {
    const { rig, chatId } = await chat();
    reading(rig, pay("rena"));
    await rig.turn(chatId, "I pay Rena for the latte.", "You hand Rena a few bills.");
    const head = rig.host.head(chatId)?.id ?? "";
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe", messageId: head }), "You look around for Rena.");
    rig.host.deleteSwipe(chatId, head, 0);
    await rig.host.settle();
    // A new swipe takes the index the reply left had before the delete.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe", messageId: head }), "Rena isn't here.");
    expect((await replyChips(rig, chatId)).filter((c) => c.kind === "decline")).toHaveLength(1);
    rig.host.navigate(chatId, head, 0);
    await rig.host.settle();
    expect((await replyChips(rig, chatId)).filter((c) => c.kind === "decline")).toHaveLength(1);
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

  test("a secret in it, or a name that leads to secret lore the player didn't type, drops only it: the walk still plays", async () => {
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

    // The read gave the courier the name her secret entry goes by.
    reading(rig, walkThenBuy("I buy Rena a latte"));
    await rig.turn(chatId, "I walk to Bluebird Coffee and buy the courier a latte.", "The cafe is quiet.");
    expect((await replyChips(rig, chatId)).some((c) => c.kind === "choice")).toBe(false);
  });

  test("the player's own words stay on the chip when they name someone hidden, as in a world without them", async () => {
    const TYPED = "I walk to Bluebird Coffee and ask Vex Morrow about the truck.";
    const offered = async (extra: { hidden?: string; secretAlias?: string }, typed: string): Promise<string[]> => {
      const { rig, chatId } = await chat(extra);
      reading(rig, walkThenBuy("I ask Vex Morrow about the truck"));
      await rig.turn(chatId, typed, "You push open the door of the cafe.");
      return (await replyChips(rig, chatId)).filter((c) => c.kind === "choice").map((c) => c.label);
    };
    const none = await offered({}, TYPED);
    expect(none).toEqual(["I ask Vex Morrow about the truck"]);
    // Hidden, or the alias a secret entry goes by: dropping their own words would say so.
    expect(await offered({ hidden: "Vex Morrow" }, TYPED)).toEqual(none);
    expect(await offered({ secretAlias: "Vex Morrow" }, TYPED)).toEqual(none);
    // Words the read added are its own: a hidden name in them is dropped.
    expect(await offered({ hidden: "Vex Morrow" }, "I walk to Bluebird Coffee and ask whoever runs the shop about the truck.")).toEqual([]);
  });

  test("time the read puts after the walk is offered as a Timelapse, never as words to send", async () => {
    const { rig, chatId } = await chat();
    const walkThenSleep: JsonObject = { action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9, then: { until: "morning" } };
    reading(rig, (text) => (text.startsWith("I walk") ? walkThenSleep : { action: null, params: {}, confidence: 0.9 }));
    await rig.turn(chatId, "I walk to Bluebird Coffee and sleep until the next morning.", "The cafe is quiet.");
    const kinds = (await replyChips(rig, chatId)).map((c) => c.kind);
    expect(kinds).toContain("timelapse_offer");
    expect(kinds).not.toContain("choice");
  });

  test("a placeholder, or the message or its first action said again, is never offered; any other words are, whatever their verb", async () => {
    const { rig, chatId } = await chat();
    const offered: Record<string, string | undefined> = {};
    for (const [typed, next] of [
      ["I walk to Bluebird Coffee to buy a latte.", "none"],
      ["I walk to Bluebird Coffee to buy a mocha.", "N/A"],
      ["I walk to Bluebird Coffee to buy a scone.", "I walk to Bluebird Coffee"],
      ["I walk to Bluebird Coffee to buy a cookie.", "I walk to Bluebird Coffee to buy a cookie"],
      ["I walk to Bluebird Coffee to buy a muffin.", "I buy a muffin"],
      ["I walk to the corner store to grab some milk.", "Grab some milk"],
      ["I walk to Bluebird Coffee to get a latte.", "get a latte"],
      ["I walk to the market to pick up groceries.", "pick up groceries"],
      ["I walk to Bluebird Coffee and smile at the barista.", "I smile at the barista"],
      // Whether words only let time pass is the read's call too: what it leaves in words is offered.
      ["I walk to Bluebird Coffee and wait for Dev there.", "wait for Dev"],
    ] as const) {
      reading(rig, walkThenBuy(next));
      await rig.turn(chatId, typed, "The cafe is quiet.");
      offered[next] = (await replyChips(rig, chatId)).find((c) => c.kind === "choice")?.label;
    }
    expect(offered).toEqual({
      none: undefined,
      "N/A": undefined,
      "I walk to Bluebird Coffee": undefined,
      "I walk to Bluebird Coffee to buy a cookie": undefined,
      "I buy a muffin": "I buy a muffin",
      "Grab some milk": "Grab some milk",
      "get a latte": "get a latte",
      "pick up groceries": "pick up groceries",
      "I smile at the barista": "I smile at the barista",
      "wait for Dev": "wait for Dev",
    });
  });

  test("when the first action names nothing in the world, what comes after it is still offered", async () => {
    const { rig, chatId } = await chat();
    reading(rig, () => ({ action: "pay", params: { to: "rena", amount: 6 }, confidence: 0.9, next: "I buy a muffin", then: { minutes: 60 } }));
    await rig.turn(chatId, "I pay Rena for the latte, buy a muffin and wait an hour.", "You hand Rena a few bills.");
    const chips = await replyChips(rig, chatId);
    expect(chips.filter((c) => c.kind === "decline")).toHaveLength(1);
    expect(chips.find((c) => c.kind === "choice")?.label).toBe("I buy a muffin");
    expect(chips.map((c) => c.kind)).toContain("timelapse_offer");
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
  const outcomeLines = (rig: Rig): string[] => (rig.host.section("Outcome")).split("\n").map((line) => line.replace(/^- /, ""));

  test("'I walk to Bluebird Coffee and buy a latte' walks there and buys it in one turn, and the narrator is told both, in order", async () => {
    const { rig, chatId } = await chat();
    reading(rig, walkThen([buying("latte")]));
    await rig.turn(chatId, "I walk to Bluebird Coffee and buy a latte.", "You order at the counter.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    expect(await bought(rig, chatId, /latte/i)).toBe(1);
    const lines = outcomeLines(rig);
    const at = (action: string): number => lines.findIndex((line) => line.startsWith(`${rig.rt.registry.actions.get(action)?.label ?? action} (`));
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

  test("a queued action that names nothing in the world is dropped with its decline, and the actions after it still play", async () => {
    const { rig, chatId } = await chat();
    reading(rig, walkThen([{ action: "pay", params: { to: "rena", amount: 6 }, text: "I pay Rena" }, buying("muffin")]));
    await rig.turn(chatId, "I walk to Bluebird Coffee, pay Rena and buy a muffin.", "You look around for Rena.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    const chips = await replyChips(rig, chatId);
    expect(chips.filter((c) => c.kind === "decline").map((c) => c.detail)).toEqual([expect.stringContaining("Rena")]);
    expect(chips.some((c) => c.kind === "choice")).toBe(false);
    expect(await bought(rig, chatId, /muffin/i)).toBe(1);
  });
});

describe("an incidental action before the move a turn is about (#30)", () => {
  const JACKET = "I pull on my work jacket, grab a coffee, and walk down to Alder Automotive to start my shift.";
  const walk: JsonObject = { action: "go", params: { to: "alder_automotive" }, text: "I walk down to Alder Automotive" };
  /** Reads the message as `first`, then `more`, and "I look around." as no action. */
  const reads = (first: JsonObject, ...more: JsonObject[]) => (text: string): JsonObject => (text.startsWith("I look around") ? { action: null, params: {}, confidence: 0.9 } : { ...first, confidence: 0.9, more });
  const wear = (item: string): JsonObject => ({ action: "wear", params: { item } });
  const at = async (rig: Rig, chatId: string): Promise<string | null> => {
    const { state, world } = await folded(rig, chatId);
    return placeOfEntity(state, world.pov);
  };
  const outcomeLines = (rig: Rig): string[] => rig.host.section("Outcome").split("\n").map((line) => line.replace(/^- /, ""));
  /** A check that always fails, and an action that rolls it. */
  const slip: [string, JsonObject][] = [
    ["checks", { id: "slip_check", dice: "1d2", bands: [{ outcome: "fail", max: 2 }, { outcome: "success", min: 3 }] }],
    ["actions", { id: "vault_fence", label: "Vault the fence", params: {}, requires: [], check: "slip_check", outcomes: { success: [], fail: [] }, duration: "1", lexicon: ["vault the fence"] }],
  ];

  test("a jacket the world doesn't have is dropped: the walk still plays, and its one chip is about the jacket", async () => {
    const { rig, chatId } = await chat();
    reading(rig, reads(wear("work jacket"), walk));
    await rig.turn(chatId, JACKET, "You shrug into your jacket and head down the hill to the garage.");
    expect(await at(rig, chatId)).toBe("alder_automotive");
    const declines = (await replyChips(rig, chatId)).filter((c) => c.kind === "decline");
    expect(declines).toHaveLength(1);
    expect(declines[0]?.label).toBe(`${rig.rt.registry.actions.get("wear")?.label}: couldn't`);
    expect(declines[0]?.detail).toMatch(/work jacket/i);
    expect(declines[0]?.detail).not.toContain("after it");
    // The narrator is told the walk played, and that nothing of the message was left unplayed.
    const lines = outcomeLines(rig);
    expect(lines.some((line) => line.startsWith(`${rig.rt.registry.actions.get("go")?.label} (`))).toBe(true);
    expect(lines.some((line) => /hasn't happened/.test(line))).toBe(false);
    // The next reply is told only that the wear didn't happen.
    const told = (await nextTurn(rig, chatId, "I look around.")).split("\n").filter((line) => line.includes("didn't happen"));
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("Wear");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("two actions that name nothing get a chip each, and the walk still plays", async () => {
    const { rig, chatId } = await chat();
    reading(rig, reads(wear("work jacket"), { action: "pay", params: { to: "rena", amount: 6 }, text: "I pay Rena" }, walk));
    await rig.turn(chatId, "I pull on my work jacket, pay Rena and walk down to Alder Automotive.", "You head down the hill to the garage.");
    expect(await at(rig, chatId)).toBe("alder_automotive");
    const declines = (await replyChips(rig, chatId)).filter((c) => c.kind === "decline");
    expect(declines.map((c) => c.label)).toEqual([`${rig.rt.registry.actions.get("wear")?.label}: couldn't`, `${rig.rt.registry.actions.get("pay")?.label}: couldn't`]);
    expect(declines[0]?.detail).toMatch(/work jacket/i);
    expect(declines[1]?.detail).toContain("Rena");
    // Remove it rewords only its own note.
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: declines[1]?.id, choice: "remove" })).applied).toBe(true);
    const told = (await nextTurn(rig, chatId, "I look around.")).split("\n").filter((line) => line.includes("never happened") || line.includes("didn't happen"));
    expect(told).toHaveLength(2);
    expect(told).toEqual(expect.arrayContaining([expect.stringMatching(/Wear.*didn't happen/), expect.stringMatching(/Pay.*leave it out/)]));
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an action after a failed check still doesn't play", async () => {
    const { rig, chatId } = await chat({ puts: slip });
    reading(rig, reads({ action: "vault_fence", params: {} }, walk));
    await rig.turn(chatId, "I vault the fence and walk down to Alder Automotive.", "You catch your foot on the top rail.");
    expect(await at(rig, chatId)).not.toBe("alder_automotive");
    expect((await replyChips(rig, chatId)).find((c) => c.kind === "choice")?.label).toBe(String(walk.text));
    expect(outcomeLines(rig).some((line) => /hasn't happened/.test(line))).toBe(true);
  });

  test("a dropped action before a failed check doesn't carry the queue past the check", async () => {
    const { rig, chatId } = await chat({ puts: slip });
    reading(rig, reads(wear("work jacket"), { action: "vault_fence", params: {}, text: "I vault the fence" }, walk));
    await rig.turn(chatId, "I pull on my work jacket, vault the fence and walk down to Alder Automotive.", "You catch your foot on the top rail.");
    expect(await at(rig, chatId)).not.toBe("alder_automotive");
    const chips = await replyChips(rig, chatId);
    expect(chips.filter((c) => c.kind === "decline")).toHaveLength(1);
    expect(chips.find((c) => c.kind === "choice")?.label).toBe(String(walk.text));
    expect(outcomeLines(rig).some((line) => line.startsWith("Vault the fence: fail"))).toBe(true);
  });

  test("a guessed id of a thing the POV can't see is dropped just as a missing one is, and never named", async () => {
    const chips: string[] = [];
    for (const item of ["hidden_coat", "spare_coat"]) {
      const here = "harbor_street_114";
      const { rig, chatId } = await chat({ puts: [["entities", { id: "hidden_coat", kind: "item", name: "Smuggler's Oilskin", tier: "background", fields: { place: here }, relations: [], visibility: "secret" }]] });
      expect(await at(rig, chatId)).toBe(here);
      reading(rig, reads(wear(item), walk));
      await rig.turn(chatId, "I pull on a coat and walk down to Alder Automotive.", "You head down the hill to the garage.");
      expect(await at(rig, chatId)).toBe("alder_automotive");
      const shown = (await replyChips(rig, chatId)).map((c) => `${c.label} ${c.detail ?? ""}`);
      for (const c of shown) expect(c).not.toMatch(/oilskin|smuggler|hidden coat/i);
      chips.push(shown.filter((c) => c.includes("couldn't")).join("\n"));
      const told = await nextTurn(rig, chatId, "I look around.");
      expect(told).not.toMatch(/oilskin|smuggler/i);
    }
    expect(chips[0]).not.toBe("");
    expect(chips[0]).toBe(chips[1]);
  });
});

describe("a new reply after a reply (Send with nothing typed)", () => {
  test("repeats nothing the message before it left: no decline or second note, no rest of the message and no Timelapse offer", async () => {
    const { rig, chatId } = await chat();
    // The pay names nobody in the world, the muffin is left to say, and an hour is let pass after them.
    const paid: JsonObject = { action: "pay", params: { to: "rena", amount: 6 }, confidence: 0.9, next: "I buy a muffin", then: { minutes: 60 } };
    reading(rig, (text) => (text.startsWith("I pay") ? paid : { action: null, params: {}, confidence: 0.9 }));
    await rig.turn(chatId, "I pay Rena for the latte, buy a muffin and wait an hour.", "You hand Rena a few bills.");
    expect((await replyChips(rig, chatId)).map((c) => c.kind)).toEqual(expect.arrayContaining(["decline", "choice", "timelapse_offer"]));
    // The new reply is told once that the pay didn't happen, and offers nothing of the message again.
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.section("Outcome")).toContain(`the player's "Pay"`);
    await rig.host.finish(g, "The cafe hums along.");
    const repeated = (await replyChips(rig, chatId)).filter((c) => c.kind === "decline" || c.kind === "choice" || c.kind === "timelapse_offer").map((c) => c.kind);
    // The reply after that isn't told it again.
    const toldAgain = (await nextTurn(rig, chatId, "I look around.")).includes(`the player's "Pay"`);
    expect({ repeated, toldAgain }).toEqual({ repeated: [], toldAgain: false });
  });

  test("a message that went unread puts no Retry on the reply after its reply", async () => {
    const { rig, chatId } = await chat();
    // The choice takes the only call before the reply, so none is left to fill its params.
    await decisionRoute(rig, "go", 1);
    reading(rig, () => ({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }));
    await rig.turn(chatId, "I walk to Bluebird Coffee.", "You set off down Main Street.");
    expect((await replyChips(rig, chatId)).some((c) => c.kind === "read_failed")).toBe(true);
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The street is quiet.");
    expect((await replyChips(rig, chatId)).some((c) => c.kind === "read_failed")).toBe(false);
  });
});
