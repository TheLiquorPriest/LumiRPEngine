// Typed money on Port Alder (DESIGN §9.4 typed money) never vanishes. It goes to whom it was for, as
// the player character knows them: a party they can see (a person, Alder Automotive) as themselves,
// wherever they are; a thing they know to whoever it belongs to, else to World, the world's catch-all
// outside account; their own thing to no one, as roleplay; and a receiver the story hasn't
// established to World. It is paid the way the player's words say, else as the purchase implies:
// cash they carry for a receiver in front of them, else their pay order. Someone the player
// character can't know is paid as no one, typed by name or guessed by id; a payment with no amount
// still plays as roleplay, and one the money can't cover is declined as before; a reply that tells
// the payment again charges it once. Cash handed over goes the same way, in cash.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { ClaimsPolicy } from "../../src/shared/claims";
import { heldBy } from "../../src/shared/finance";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { WORLD_ACCOUNT } from "../../src/packs/economy/core/model";
import { knownPeople } from "../../src/packs/economy/ui/layout";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
/** Alder Automotive, where the player character works: a business they can see from anywhere. */
const SHOP = "alder_automotive_co";
/** The shop's place. */
const SHOP_PLACE = "alder_automotive";
/** Where the player character starts: their home. */
const HOME = "harbor_street_114";
/** The player character's wallet: the cash they carry. */
const WALLET = "acct_pov_cash";

/** A tip jar standing at `place`, belonging to `owner` when given. */
const tipJar = (place: string, owner?: string): JsonObject => ({ id: "tip_jar", kind: "item", name: "Tip jar", tier: "background", fields: { place, ...(owner ? { owner } : {}) }, relations: [] });

/** A Port Alder chat, with someone the player character can't see going by `hidden`, the entities in `add`, the chat's claims policy (`claims`) and the user's `settings` when given. */
async function chat(extra: { hidden?: string; add?: JsonObject[]; claims?: ClaimsPolicy; settings?: JsonObject } = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  if (extra.settings) rig.body(await rig.send({ type: "lre.settings.set", patch: extra.settings }));
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const add: JsonObject[] = [...(extra.hidden ? [{ id: "hidden_one", kind: "person", name: extra.hidden, tier: "background", fields: {}, relations: [], visibility: "secret" }] : []), ...(extra.add ?? [])];
  for (const value of add) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: String(value.id), value }));
  if (add.length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  if (extra.claims) rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "custom", claims: extra.claims } } }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` reads every message as `read`; every other step reads nothing. */
function reading(rig: Rig, read: JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
}

/** A typed Pay to `to`, of `amount` dollars when the read gives one. */
const paying = (to: string, amount?: number): JsonObject => ({ action: "pay", params: { to, ...(amount !== undefined ? { amount } : {}) } });

async function state(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const folded = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!folded) throw new Error("no state");
  return folded;
}

/** What World, the world's catch-all outside account, holds. */
async function worldHolds(rig: Rig, chatId: string): Promise<number> {
  return (await state(rig, chatId)).accounts[WORLD_ACCOUNT] ?? 0;
}

interface Paid {
  account: string;
  cents: number;
  memo: string;
}

/** What went from the player character's own accounts to `to`, as their journal (the Money history) shows it: each line's account, amount and memo. */
async function paidTo(rig: Rig, chatId: string, to: string): Promise<Paid[]> {
  const s = await state(rig, chatId);
  const out: Paid[] = [];
  const book = s.packs.economy?.journal;
  if (!isRecord(book)) return out;
  for (const [account, entries] of Object.entries(book)) {
    if (!heldBy(s.entities, account, "pov") || !Array.isArray(entries)) continue;
    for (const e of entries) if (isRecord(e) && e.counterparty === to) out.push({ account, cents: Number(e.cents), memo: String(e.memo) });
  }
  return out;
}

/** An account's name, as the Outcome's lines name it. */
async function nameOf(rig: Rig, chatId: string, account: string): Promise<string> {
  return (await state(rig, chatId)).entities[account]?.name ?? account;
}

/** The chips on the latest reply. */
async function replyChips(rig: Rig, chatId: string): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
}

/** The latest reply's receipts for typed actions that played as plain roleplay. */
async function roleplayed(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await replyChips(rig, chatId)).filter((c) => c.kind === "untracked");
}

/** The Outcome's lines for a Pay that played. */
function payLines(outcome: string): string[] {
  return outcome.split("\n").filter((line) => line.includes("Pay ("));
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

describe("typed money to a receiver the story hasn't established", () => {
  test("'I drop $5 in cash in the tip jar' pays $5 from their cash to World: no roleplay receipt, and the narrator is told what it was for and how it was paid", async () => {
    const { rig, chatId } = await chat();
    reading(rig, paying("the tip jar", 5));
    const told = await nextTurn(rig, chatId, "I drop $5 in cash in the tip jar.");
    expect((await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -500]]);
    expect(await worldHolds(rig, chatId)).toBe(500);
    expect(await roleplayed(rig, chatId)).toEqual([]);
    const wallet = await nameOf(rig, chatId, WALLET);
    expect(payLines(told)).toEqual([expect.stringContaining("the tip jar")]);
    expect(payLines(told)[0]).toContain("$5.00");
    expect(payLines(told)[0]).toContain(wallet);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with no way of paying said, a tip jar in front of them takes the cash they carry", async () => {
    const { rig, chatId } = await chat();
    reading(rig, paying("the tip jar", 30));
    const told = await nextTurn(rig, chatId, "I drop $30 in the tip jar.");
    expect((await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -3000]]);
    expect(payLines(told)[0]).toContain(await nameOf(rig, chatId, WALLET));
  });

  test("more than the cash they carry comes from the account their pay order picks, as the same payment to Alder Automotive does", async () => {
    const charged = async (to: string, text: string): Promise<{ lines: Paid[]; told: string; name: string }> => {
      const { rig, chatId } = await chat();
      reading(rig, paying(to, 500));
      const told = await nextTurn(rig, chatId, text);
      const lines = await paidTo(rig, chatId, to === SHOP ? SHOP : WORLD_ACCOUNT);
      return { lines, told, name: await nameOf(rig, chatId, lines[0]?.account ?? "") };
    };
    const jar = await charged("the tip jar", "I drop $500 in the tip jar.");
    expect(jar.lines.map((l) => l.cents)).toEqual([-50000]);
    expect(jar.lines[0]?.account).not.toBe(WALLET);
    expect(jar.lines.map((l) => l.account)).toEqual((await charged(SHOP, "I pay Alder Automotive $500.")).lines.map((l) => l.account));
    // The Outcome says which account it came out of.
    expect(payLines(jar.told)[0]).toContain(jar.name);
  });

  test("a name nothing in the world has is a receiver the story hasn't established: 'I tip the busker $2' pays World", async () => {
    const { rig, chatId } = await chat();
    reading(rig, paying("the busker", 2));
    await rig.turn(chatId, "I tip the busker $2.", "The busker nods.");
    expect((await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -200]]);
    expect(await worldHolds(rig, chatId)).toBe(200);
    expect(await roleplayed(rig, chatId)).toEqual([]);
  });

  test("someone the player character can't know is paid as no one: guessed by id or typed by name, World takes it and everything reads as in a world without them", async () => {
    for (const [read, text] of [
      ["hidden_one", "I tip the stranger by the door $2."],
      ["Rosie", "I pay Rosie $2."],
    ] as const) {
      const seen: JsonObject[] = [];
      for (const extra of [{ hidden: "Rosie" }, {}]) {
        const { rig, chatId } = await chat(extra);
        reading(rig, paying(read, 2));
        const told = await nextTurn(rig, chatId, text);
        expect(await worldHolds(rig, chatId)).toBe(200);
        expect(JSON.stringify(await rig.rt.view(chatId, rig.host.userId))).not.toContain("hidden_one");
        seen.push({ paid: (await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents]), chips: (await replyChips(rig, chatId)).map((c) => `${c.kind} ${c.label} ${c.detail ?? ""}`).sort(), told: payLines(told) });
      }
      expect(seen[0]).toEqual(seen[1]);
    }
  });

  test("a payment with no amount still plays as plain roleplay, its receipt saying it needs one, and nothing moves, whether it names a thing or a party it can see", async () => {
    for (const [to, text] of [
      ["the tip jar", "I drop some change in the tip jar."],
      [SHOP, "I pay Alder Automotive what I owe."],
    ] as const) {
      const { rig, chatId } = await chat();
      reading(rig, paying(to));
      const told = await nextTurn(rig, chatId, text);
      expect(await paidTo(rig, chatId, WORLD_ACCOUNT)).toEqual([]);
      expect(await worldHolds(rig, chatId)).toBe(0);
      const receipts = await roleplayed(rig, chatId);
      expect(receipts.map((c) => c.label)).toEqual([expect.stringMatching(/^Pay\b/)]);
      expect(receipts[0]?.detail ?? "").toMatch(/amount/);
      expect(payLines(told)).toEqual([]);
    }
  });

  test("a payment that names no receiver says it needs someone, never something", async () => {
    const { rig, chatId } = await chat();
    reading(rig, { action: "pay", params: { amount: 5 } });
    await rig.turn(chatId, "I pay $5.", "A quiet moment passes.");
    expect((await roleplayed(rig, chatId)).map((c) => c.detail ?? "")).toEqual([expect.stringMatching(/someone/)]);
  });

  test("a payment the money can't cover is declined as one to Danny is: nothing moves, and its receipt reads the same", async () => {
    const declined = async (to: string, text: string): Promise<string[]> => {
      const { rig, chatId } = await chat();
      reading(rig, paying(to, 1_000_000));
      await rig.turn(chatId, text, "A quiet moment passes.");
      expect(await paidTo(rig, chatId, to === DANNY ? DANNY : WORLD_ACCOUNT)).toEqual([]);
      expect(await worldHolds(rig, chatId)).toBe(0);
      return (await replyChips(rig, chatId)).map((c) => `${c.kind} ${c.label} ${c.detail ?? ""}`).sort();
    };
    const jar = await declined("the tip jar", "I drop a million dollars in the tip jar.");
    expect(jar).toEqual(await declined(DANNY, "I pay Danny a million dollars."));
    expect(jar.filter((c) => c.startsWith("untracked Pay"))).toHaveLength(1);
  });

  test("the intent gate's card names the receiver in the player's words, and an Edit of the amount alone keeps paying it", async () => {
    const { rig, chatId } = await chat({ settings: { gates: { intent: true } } });
    reading(rig, paying("the tip jar", 5));
    rig.host.sendUser(chatId, "I drop $5 in the tip jar.");
    await rig.host.settle();
    await rig.host.start(chatId, { type: "normal" });
    const gate = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "intent_gate");
    expect(gate?.label).toContain("the tip jar");
    // The Actions palette offers no pick for World, so the Edit sends the amount alone.
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { amount: 300 } } })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(reply, "The coins clink.");
    expect((await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -300]]);
    expect(await worldHolds(rig, chatId)).toBe(300);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("typed money to someone or something the story has established", () => {
  test("an established person is paid as ever: Danny, at home with them, gets it in the cash they carry, and nothing goes to World", async () => {
    const { rig, chatId } = await chat();
    reading(rig, paying(DANNY, 5));
    await rig.turn(chatId, "I pay Danny $5 for the coffee.", "Danny pockets it.");
    expect((await paidTo(rig, chatId, DANNY)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -500]]);
    expect(await worldHolds(rig, chatId)).toBe(0);
    expect(await roleplayed(rig, chatId)).toEqual([]);
  });

  test("'I pay Alder Automotive $50' from home pays the shop itself, by its id or by its name, not World", async () => {
    for (const to of [SHOP, "Alder Automotive"]) {
      const { rig, chatId } = await chat();
      expect(placeOfEntity(await state(rig, chatId), "pov")).toBe(HOME);
      reading(rig, paying(to, 50));
      const told = await nextTurn(rig, chatId, "I pay Alder Automotive $50 for last week's parts.");
      expect((await paidTo(rig, chatId, SHOP)).map((l) => l.cents)).toEqual([-5000]);
      expect(await worldHolds(rig, chatId)).toBe(0);
      expect(await roleplayed(rig, chatId)).toEqual([]);
      expect(payLines(told)).toEqual([expect.stringContaining("Alder Automotive")]);
      expect(rig.rt.ledger.errors).toEqual([]);
    }
  });

  test("at the shop, its own tip jar pays the shop, in the cash they carry; the Actions sheet offers the shop to pay, and the people pickers still list only people", async () => {
    const { rig, chatId } = await chat({ add: [tipJar(SHOP_PLACE, SHOP)] });
    reading(rig, { action: "go", params: { to: SHOP_PLACE } });
    await rig.turn(chatId, "I walk to Alder Automotive.", "You walk to the shop.");
    expect(placeOfEntity(await state(rig, chatId), "pov")).toBe(SHOP_PLACE);
    const palette = (await rig.rt.view(chatId, rig.host.userId)).palette ?? null;
    expect(palette?.entries.find((e) => e.action === "pay")?.options.map((o) => o.params.to)).toContain(SHOP);
    expect(knownPeople(palette).map((p) => p.id)).not.toContain(SHOP);
    reading(rig, paying("tip_jar", 5));
    await rig.turn(chatId, "I drop $5 in the tip jar.", "The coins clink.");
    expect((await paidTo(rig, chatId, SHOP)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -500]]);
    expect(await worldHolds(rig, chatId)).toBe(0);
    expect(await roleplayed(rig, chatId)).toEqual([]);
  });

  test("a tip jar they can see that belongs to no one pays World", async () => {
    const { rig, chatId } = await chat({ add: [tipJar(HOME)] });
    reading(rig, paying("tip_jar", 5));
    await rig.turn(chatId, "I drop $5 in the tip jar.", "The coins clink.");
    expect((await paidTo(rig, chatId, WORLD_ACCOUNT)).map((l) => [l.account, l.cents])).toEqual([[WALLET, -500]]);
    expect(await worldHolds(rig, chatId)).toBe(500);
    expect(await roleplayed(rig, chatId)).toEqual([]);
  });

  test("money put in the player character's own tip jar stays theirs: nothing moves, and it plays as roleplay saying so", async () => {
    const { rig, chatId } = await chat({ add: [tipJar(HOME, "pov")] });
    reading(rig, paying("tip_jar", 5));
    await rig.turn(chatId, "I drop $5 in my tip jar.", "The coins clink.");
    const s = await state(rig, chatId);
    const book = s.packs.economy?.journal;
    // Nothing went out of any account of theirs (their opening balances are the world's start, not the turn's).
    const out = isRecord(book) ? Object.entries(book).flatMap(([account, entries]) => (heldBy(s.entities, account, "pov") && Array.isArray(entries) ? entries.filter((e) => isRecord(e) && e.kind !== "opening" && Number(e.cents) < 0) : [])) : [];
    expect(out).toEqual([]);
    expect(await worldHolds(rig, chatId)).toBe(0);
    expect((await roleplayed(rig, chatId)).map((c) => c.detail ?? "")).toEqual([expect.stringMatching(/yours/)]);
  });

  test("a reply that tells the same payment to the shop again charges it once, even with transfers applying on their own", async () => {
    const { rig, chatId } = await chat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { transfer: { mode: "auto" } } } }));
    rig.host.quietReply = (req: QuietRequest) => {
      const prompt = req.messages[0]?.content ?? "";
      if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ confidence: 0.9, ...paying(SHOP, 50) });
      if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [{ type: "transfer", from: "pov", to: SHOP, amount: 50 }] });
      return "{}";
    };
    await rig.turn(chatId, "I pay Alder Automotive $50.", "You send the shop fifty dollars.");
    expect((await paidTo(rig, chatId, SHOP)).map((l) => l.cents)).toEqual([-5000]);
    const money = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" || c.kind === "decline" || c.kind === "undo");
    expect(money).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("cash handed over (DESIGN §9.4 player claims)", () => {
  /** Plays "give `item` to `to`", read as cash, under claims `mode`; returns what the player character paid `payee`, what World holds and the claim chips. */
  async function handed(to: string, payee: string, text: string, add: JsonObject[] = [], mode: ClaimsPolicy["mode"] = "real"): Promise<{ paid: (string | number)[][]; world: number; asked: string[] }> {
    const { rig, chatId } = await chat({ add, claims: { mode, capped: false } });
    reading(rig, { action: "give", params: { item: "$5", to }, thing: "money" });
    await rig.turn(chatId, text, "The coins clink.");
    const asked = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "claim" || c.kind === "claimed" || c.kind === "untracked" || c.kind === "decline").map((c) => c.kind);
    expect(rig.rt.ledger.errors).toEqual([]);
    return { paid: (await paidTo(rig, chatId, payee)).map((l) => [l.account, l.cents]), world: await worldHolds(rig, chatId), asked };
  }

  test("'I put $5 in the jar' pays World $5 from their cash, in every mode, as handing Danny $5 pays him", async () => {
    for (const mode of ["real", "ask", "hold"] as const) {
      expect({ mode, ...(await handed("the jar", WORLD_ACCOUNT, "I put $5 in the jar.", [], mode)) }).toEqual({ mode, paid: [[WALLET, -500]], world: 500, asked: [] });
      expect({ mode, ...(await handed(DANNY, DANNY, "I hand Danny $5.", [], mode)) }).toEqual({ mode, paid: [[WALLET, -500]], world: 0, asked: [] });
    }
  });

  test("cash handed to the shop, which isn't here, pays the shop in cash: it's no person Give hands things to, so nothing fails", async () => {
    expect(await handed(SHOP, SHOP, "I hand Alder Automotive $5.")).toEqual({ paid: [[WALLET, -500]], world: 0, asked: [] });
  });

  test("cash put in a tip jar of Marcus's, who isn't there, pays Marcus", async () => {
    expect(await handed("tip_jar", MARCUS, "I put $5 in Marcus's tip jar.", [tipJar(HOME, MARCUS)])).toEqual({ paid: [[WALLET, -500]], world: 0, asked: [] });
  });
});
