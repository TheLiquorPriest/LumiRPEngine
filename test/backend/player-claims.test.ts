// Player claims (DESIGN §9.4), on Port Alder: a typed action that uses a thing the world doesn't
// have, as the POV sees it, plays by the chat's policy. Make it real makes the thing, plays the
// action and says so with an Undo; Ask first waits, with nothing generated, on Add or Not an
// action, and either gives one reply; Hold me to the world plays the action as plain roleplay. Cash
// the player character carries is handed over as it is; money they lack, keys and things over the
// cap ask, and added money tops up their cash for the Pay; a claimed key opens no lock its author
// marked hard; a hidden thing counts as absent, and nothing tells of it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { isGone } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { ClaimsPolicy } from "../../src/shared/claims";
import { heldBy } from "../../src/shared/finance";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const DANNY = "danny_okafor";
const HERE = "harbor_street_114";

/** A Port Alder chat whose new chats start from `claims` (the world sets none), with any editor `puts` committed first. */
async function chat(claims?: ClaimsPolicy, puts: [string, JsonObject][] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  for (const [collection, value] of puts) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
  if (puts.length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  if (claims) rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "custom", claims } } }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` reads every message as `read`; every other step reads nothing. */
function reading(rig: Rig, read: JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
}

const give = (item: string, thing: string): JsonObject => ({ action: "give", params: { item, to: DANNY }, thing });

async function state(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const folded = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!folded) throw new Error("no state");
  return folded;
}

/** The claimed things in the chat, by id. */
async function claimed(rig: Rig, chatId: string): Promise<[string, WorldState["entities"][string]][]> {
  return Object.entries((await state(rig, chatId)).entities).filter(([, e]) => e.fields.claimed === true);
}

/** What moved on the player character's own accounts, as their journal shows it, less the openings: each line's memo, amount and other side. */
async function journal(rig: Rig, chatId: string): Promise<{ memo: string; cents: number; counterparty: string | null }[]> {
  const s = await state(rig, chatId);
  const out: { memo: string; cents: number; counterparty: string | null }[] = [];
  const book = s.packs.economy?.journal;
  if (!isRecord(book)) return out;
  for (const [account, entries] of Object.entries(book)) {
    if (!heldBy(s.entities, account, "pov") || !Array.isArray(entries)) continue;
    for (const e of entries) if (isRecord(e) && e.kind !== "opening") out.push({ memo: String(e.memo), cents: Number(e.cents), counterparty: typeof e.counterparty === "string" ? e.counterparty : null });
  }
  return out;
}

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

const replies = (rig: Rig, chatId: string): number => rig.host.chat(chatId).messages.filter((m) => !m.isUser).length;

/** Sends `text` and starts its reply: the generation, as far as the engine let it go. */
async function send(rig: Rig, chatId: string, text: string) {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  return rig.host.start(chatId, { type: "normal" });
}

describe("tracking gaps", () => {
  test("'I put on my clothes' with the clothes kept elsewhere plays through the claim, and the rest of the message plays", async () => {
    const clothes: JsonObject = { id: "pov_clothes", kind: "item", name: "Clothes", tier: "background", fields: { owner: "pov", place: "lakefront_park", slot: "torso", notable: true }, relations: [] };
    for (const item of ["pov_clothes", "clothes"]) {
      const { rig, chatId } = await chat(undefined, [["entities", clothes]]);
      reading(rig, { action: "wear", params: { item }, thing: "other", more: [{ action: "go", params: { to: "alder_harbor_marina" }, text: "I walk down to the marina" }] });
      await rig.turn(chatId, "I put on my clothes and walk down to the marina.", "You dress and head out.");
      const after = await state(rig, chatId);
      expect({ item, worn: after.entities.pov_clothes?.relations.some((r) => r.type === "worn_by" && r.to === "pov"), made: (await claimed(rig, chatId)).length, place: after.entities.pov?.fields.place }).toEqual({ item, worn: true, made: 0, place: "alder_harbor_marina" });
    }
  });

  test("a secret thing of theirs kept elsewhere plays as a made-up claim does, in every mode, and nothing names or moves it", async () => {
    const ring: JsonObject = { id: "pov_ring", kind: "item", name: "Grandmother's Signet Ring", tier: "background", fields: { owner: "pov", place: "lakefront_park", slot: "finger" }, relations: [], visibility: "secret" };
    for (const mode of ["real", "ask", "hold"] as const) {
      const seen: JsonObject[] = [];
      for (const puts of [[["entities", ring]], []] as [string, JsonObject][][]) {
        const { rig, chatId } = await chat({ mode, capped: false }, puts);
        reading(rig, { action: "wear", params: { item: "pov_ring" }, thing: "other" });
        const started = await send(rig, chatId, "I put on my ring.");
        if (!started.halted) await rig.host.finish(started, "You slip it on.");
        if (puts.length > 0) expect((await state(rig, chatId)).entities.pov_ring).toMatchObject({ fields: { place: "lakefront_park" }, relations: [] });
        const view = JSON.stringify(await rig.rt.view(chatId, rig.host.userId));
        expect(`${view}\n${rig.host.section("Outcome")}`).not.toMatch(/signet|grandmother/i);
        seen.push({ halted: started.halted ?? null, made: (await claimed(rig, chatId)).length, chips: (await chips(rig, chatId)).map((c) => `${c.kind} ${c.label} ${c.detail ?? ""}`).sort() });
      }
      expect({ mode, ...seen[0] }).toEqual({ mode, ...seen[1] });
    }
  });
});

describe("Make it real", () => {
  test("'I pour Danny a coffee' with no coffee makes one in hand, gives it, says Added with Undo, tells the narrator nothing failed, and clears it once given", async () => {
    const { rig, chatId } = await chat();
    reading(rig, give("coffee", "drink"));
    await rig.turn(chatId, "I pour Danny a coffee.", "You pour Danny a coffee; he takes it gratefully.");
    const [made] = await claimed(rig, chatId);
    const [id, coffee] = made ?? [];
    expect(coffee?.name).toBe("coffee");
    // The give stands: Danny owns and holds it; then it is cleared, used up.
    expect(coffee?.fields.owner).toBe(DANNY);
    expect(coffee?.relations.some((r) => r.type === "in" && r.to === DANNY)).toBe(true);
    expect(isGone(await state(rig, chatId), id ?? "")).toBe(true);
    const shown = await chips(rig, chatId);
    expect(shown.find((c) => c.kind === "claimed")).toMatchObject({ label: "Added: a coffee", actions: [{ id: "undo", label: "Undo" }] });
    expect(shown.some((c) => c.kind === "decline")).toBe(false);
    const outcome = rig.host.section("Outcome");
    expect(outcome.split("\n").some((line) => line.startsWith("- Give") && line.includes("coffee"))).toBe(true);
    expect(outcome).not.toMatch(/didn't happen/);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a claimed lighter given away stays with its new holder", async () => {
    const { rig, chatId } = await chat();
    reading(rig, give("lighter", "other"));
    await rig.turn(chatId, "I hand Danny a lighter.", "Danny pockets the lighter.");
    const [[id, lighter] = []] = await claimed(rig, chatId);
    expect(lighter?.relations.some((r) => r.type === "in" && r.to === DANNY)).toBe(true);
    expect(isGone(await state(rig, chatId), id ?? "")).toBe(false);
  });

  test("Undo takes the thing back with what its action did", async () => {
    const { rig, chatId } = await chat();
    reading(rig, give("lighter", "other"));
    const before = Object.keys((await state(rig, chatId)).entities).sort();
    await rig.turn(chatId, "I hand Danny a lighter.", "Danny pockets the lighter.");
    const undo = (await chips(rig, chatId)).find((c) => c.kind === "claimed");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo?.id, choice: "undo" })).applied).toBe(true);
    expect(await claimed(rig, chatId)).toEqual([]);
    expect(Object.keys((await state(rig, chatId)).entities).sort()).toEqual(before);
  });
});

describe("Ask first", () => {
  for (const choice of ["add", "drop"] as const) {
    test(`the turn waits on the question with nothing generated, and ${choice === "add" ? "Add plays the give with the claimed coffee" : "Not an action plays the message without it"}, in one reply`, async () => {
      const { rig, chatId } = await chat({ mode: "ask", capped: true });
      reading(rig, give("coffee", "drink"));
      const halted = await send(rig, chatId, "I pour Danny a coffee.");
      expect(halted.halted).toBe("cancelled");
      expect(rig.host.restarts.filter((r) => r.chatId === chatId)).toEqual([]);
      expect(rig.host.assembled).toEqual([]);
      expect(replies(rig, chatId)).toBe(1);
      const ask = (await chips(rig, chatId)).find((c) => c.kind === "claim");
      expect(ask).toMatchObject({ label: "Coffee isn't in this world yet. Add it and give it?", actions: [{ id: "add", label: "Add" }, { id: "drop", label: "Not an action" }] });
      expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice })).applied).toBe(true);
      const reply = await rig.host.start(chatId, { type: "regenerate" });
      expect(reply.halted).toBeUndefined();
      await rig.host.finish(reply, "You pour the coffee.");
      expect(replies(rig, chatId)).toBe(2);
      const made = await claimed(rig, chatId);
      expect(made.map(([, e]) => e.fields.owner)).toEqual(choice === "add" ? [DANNY] : []);
      expect((await chips(rig, chatId)).some((c) => c.kind === "decline" || c.kind === "claim")).toBe(false);
    });
  }

  test("a new reply after a reply asks nothing again about the message the turn before played", async () => {
    const { rig, chatId } = await chat({ mode: "ask", capped: true });
    let reads = 0;
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      reads++;
      return JSON.stringify({ confidence: 0.9, ...give("coffee", "drink") });
    };
    await send(rig, chatId, "I pour Danny a coffee.");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: (await chips(rig, chatId)).find((c) => c.kind === "claim")?.id, choice: "drop" }));
    const played = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(played, "You think better of it.");
    // Send, with nothing typed: the reply after that one goes out, and the coffee isn't asked about again.
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    expect(reads).toBe(1);
    expect((await chips(rig, chatId)).some((c) => c.kind === "claim")).toBe(false);
  });
});

describe("Hold me to the world", () => {
  test("the action plays as plain roleplay: a receipt says why with nothing to answer, and no reply is told it didn't happen", async () => {
    const { rig, chatId } = await chat({ mode: "hold", capped: false });
    reading(rig, give("coffee", "drink"));
    await rig.turn(chatId, "I pour Danny a coffee.", "You pour Danny a coffee.");
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.realism.claims).toEqual({ mode: "hold", capped: false });
    expect(await claimed(rig, chatId)).toEqual([]);
    const receipt = (await chips(rig, chatId)).find((c) => c.kind === "untracked");
    expect(receipt?.label).toStartWith("Give");
    expect(receipt?.detail).toMatch(/coffee/i);
    expect(receipt?.actions).toEqual([]);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const next = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.section("Outcome")).not.toMatch(/didn't happen|never happened/);
    expect(rig.host.section("Outcome")).not.toContain("Give");
    await rig.host.finish(next, "Quiet.");
  });
});

describe("limits in every mode", () => {
  test("'I hand Danny a twenty' with $85 on them hands it over as it is, in every mode: nothing is asked and no money is made", async () => {
    for (const mode of ["real", "ask", "hold"] as const) {
      const { rig, chatId } = await chat({ mode, capped: false });
      reading(rig, give("a twenty", "money"));
      const g = await send(rig, chatId, "I hand Danny a twenty.");
      expect({ mode, halted: g.halted }).toEqual({ mode, halted: undefined });
      await rig.host.finish(g, "You press a twenty into Danny's hand.");
      const moved = (await journal(rig, chatId)).filter((l) => Math.abs(l.cents) === 2000).map((l) => [l.cents, l.counterparty === DANNY]);
      expect({ mode, moved }).toEqual({ mode, moved: [[-2000, true]] });
      expect((await chips(rig, chatId)).some((c) => c.kind === "claim" || c.kind === "claimed")).toBe(false);
    }
  });

  test("'I hand Danny $100' with $85 on them asks to add only the $15 they lack, and Add hands the $100 over in cash; Hold me to the world plays it as plain roleplay", async () => {
    for (const mode of ["real", "ask"] as const) {
      const { rig, chatId } = await chat({ mode, capped: false });
      reading(rig, give("$100", "money"));
      expect({ mode, halted: (await send(rig, chatId, "I hand Danny $100.")).halted }).toEqual({ mode, halted: "cancelled" });
      const ask = (await chips(rig, chatId)).find((c) => c.kind === "claim");
      expect(ask?.label).toContain("$15.00");
      expect(ask?.actions.map((a) => a.id)).toEqual(["add", "drop"]);
      expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "add" })).applied).toBe(true);
      await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "You count a hundred into Danny's hand.");
      // Only the $15 came into the player character's cash, and the whole $100 went to Danny.
      const moved = (await journal(rig, chatId)).filter((l) => l.cents > 0 || l.counterparty === DANNY).map((l) => [l.cents, l.counterparty === DANNY]);
      expect({ mode, moved }).toEqual({ mode, moved: expect.arrayContaining([[1500, false], [-10000, true]]) });
      expect(moved.some(([cents]) => cents === 10000)).toBe(false);
      expect((await chips(rig, chatId)).find((c) => c.kind === "claimed")?.label).toContain("$15.00");
      expect(await claimed(rig, chatId)).toEqual([]);
    }
    const held = await chat({ mode: "hold", capped: false });
    reading(held.rig, give("$100", "money"));
    await held.rig.turn(held.chatId, "I hand Danny $100.", "Danny looks at you, puzzled.");
    expect((await journal(held.rig, held.chatId)).filter((l) => l.counterparty === DANNY || l.cents > 0)).toEqual([]);
    const shown = await chips(held.rig, held.chatId);
    expect(shown.some((c) => c.kind === "claim")).toBe(false);
    expect(shown.find((c) => c.kind === "untracked")?.label).toStartWith("Give");
  });

  test("money for someone who isn't there plays as plain roleplay, as the give would: nothing is made, nothing moves, and a receipt says why", async () => {
    const { rig, chatId } = await chat({ mode: "real", capped: false });
    reading(rig, { action: "go", params: { to: "bluebird_coffee" } });
    await rig.turn(chatId, "I walk to Bluebird Coffee.", "The cafe is warm.");
    reading(rig, give("a twenty", "money"));
    await rig.turn(chatId, "I hand Danny a twenty.", "You look around for Danny.");
    const head = rig.host.head(chatId)?.id ?? "";
    expect((await chips(rig, chatId)).filter((c) => c.kind === "untracked").map((c) => c.messageId)).toEqual([head]);
    reading(rig, give("$100", "money"));
    expect((await send(rig, chatId, "I hand Danny $100.")).halted).toBe("cancelled");
    const ask = (await chips(rig, chatId)).find((c) => c.kind === "claim");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "add" })).applied).toBe(true);
    await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "You look around for Danny.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "claimed")).toBe(false);
    expect((await journal(rig, chatId)).filter((l) => l.counterparty === DANNY || l.cents > 0)).toEqual([]);
  });

  describe("the intent gate's Edit of the handover", () => {
    const MARCUS = "marcus_delgado";
    /** "I hand Danny $100" with $85 on them, Add on the claim's question, then the intent gate's Edit with `edit`, and the reply. */
    async function edited(edit: JsonObject): Promise<{ rig: Rig; chatId: string }> {
      const { rig, chatId } = await chat({ mode: "real", capped: false });
      for (const patch of [{ gates: { intent: true } }, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
      reading(rig, give("$100", "money"));
      expect((await send(rig, chatId, "I hand Danny $100.")).halted).toBe("cancelled");
      const ask = (await chips(rig, chatId)).find((c) => c.kind === "claim");
      expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "add" })).applied).toBe(true);
      expect((await rig.host.start(chatId, { type: "regenerate" })).halted).toBe("cancelled");
      const gate = (await chips(rig, chatId)).find((c) => c.kind === "intent_gate");
      expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "edit", payload: { params: { to: DANNY, amount: 10000, method: "cash", ...edit } } })).applied).toBe(true);
      await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "You count out the money.");
      return { rig, chatId };
    }
    /** What came into the player character's accounts and went to `to`, as the journal shows it. */
    const moved = async (rig: Rig, chatId: string, to: string): Promise<number[][]> => (await journal(rig, chatId)).filter((l) => l.cents > 0 || l.counterparty === to).map((l) => [l.cents, l.counterparty === to ? 1 : 0]);

    test("to someone who isn't there it plays as plain roleplay, as the give would: nothing is added and nothing moves", async () => {
      const { rig, chatId } = await edited({ to: MARCUS });
      expect(await moved(rig, chatId, MARCUS)).toEqual([]);
      expect(await moved(rig, chatId, DANNY)).toEqual([]);
      const shown = await chips(rig, chatId);
      expect(shown.some((c) => c.kind === "claimed")).toBe(false);
      expect(shown.filter((c) => c.kind === "untracked").map((c) => c.label)).toEqual([expect.stringMatching(/^Pay\b/)]);
    });

    test("a lower amount adds only what the cash lacks of it; a higher one adds nothing the player wasn't asked about", async () => {
      const lower = await edited({ amount: 9000 });
      expect(await moved(lower.rig, lower.chatId, DANNY)).toEqual(expect.arrayContaining([[500, 0], [-9000, 1]]));
      expect((await moved(lower.rig, lower.chatId, DANNY)).filter(([cents]) => cents !== undefined && cents > 0)).toEqual([[500, 0]]);
      expect((await chips(lower.rig, lower.chatId)).find((c) => c.kind === "claimed")?.label).toContain("$5.00");
      const higher = await edited({ amount: 12000 });
      expect((await moved(higher.rig, higher.chatId, DANNY)).filter(([cents]) => cents !== undefined && cents > 0)).toEqual([]);
      expect((await chips(higher.rig, higher.chatId)).some((c) => c.kind === "claimed")).toBe(false);
    });
  });

  test("capped Make it real asks for a thing over the cap and makes one under it", async () => {
    const capped = { mode: "real", capped: true } as const;
    const over = await chat(capped);
    reading(over.rig, give("tablet", "other"));
    expect((await send(over.rig, over.chatId, "I give Danny a tablet.")).halted).toBe("cancelled");
    expect((await chips(over.rig, over.chatId)).find((c) => c.kind === "claim")?.detail).toMatch(/over this world's \$23\.00/);
    const under = await chat(capped);
    reading(under.rig, give("coffee", "drink"));
    await under.rig.turn(under.chatId, "I pour Danny a coffee.", "You pour Danny a coffee.");
    expect((await claimed(under.rig, under.chatId)).map(([, e]) => e.name)).toEqual(["coffee"]);
  });

  test("a claimed key asks first, and once added never opens a lock its author marked hard that needs the authored key", async () => {
    const unlock: JsonObject = { id: "unlock_office", label: "Unlock the office", description: "Unlock the shop's back office.", params: {}, requires: [{ expr: "carries(self, shop_office_key)", hard: true }], outcomes: { default: [] }, duration: "1", lexicon: ["unlock the office"] };
    const { rig, chatId } = await chat(undefined, [["actions", unlock]]);
    reading(rig, { action: "use", params: { item: "office key" }, thing: "key", more: [{ action: "unlock_office", params: {}, text: "I unlock the office" }] });
    expect((await send(rig, chatId, "I take out my office key and unlock the office.")).halted).toBe("cancelled");
    const ask = (await chips(rig, chatId)).find((c) => c.kind === "claim");
    expect(ask).toMatchObject({ label: "Office key isn't in this world yet. Add it and use it?", detail: "Keys, weapons and documents always ask first." });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "add" }));
    await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "The key doesn't turn.");
    const [[id] = []] = await claimed(rig, chatId);
    expect(id).not.toBe("shop_office_key");
    expect((await chips(rig, chatId)).find((c) => c.kind === "decline")?.label).toBe("Unlock the office: couldn't");
    expect((await state(rig, chatId)).entities.shop_office_key?.relations.some((r) => r.type === "in" && r.to === "marcus_delgado")).toBe(true);
  });

  test("in every mode a guessed hidden thing plays as any made-up thing does, and nothing the player sees tells of the hidden one", async () => {
    const hidden: JsonObject = { id: "hidden_coat", kind: "item", name: "Smuggler's Oilskin", tier: "background", fields: { place: HERE }, relations: [], visibility: "secret" };
    for (const mode of ["real", "ask", "hold"] as const) {
      const seen: JsonObject[] = [];
      for (const puts of [[["entities", hidden]], []] as [string, JsonObject][][]) {
        const { rig, chatId } = await chat({ mode, capped: false }, puts);
        reading(rig, give("oilskin", "other"));
        const started = await send(rig, chatId, "I hand Danny the oilskin.");
        if (!started.halted) await rig.host.finish(started, "Danny shrugs it on.");
        const made = await claimed(rig, chatId);
        expect(made.map(([id]) => id)).not.toContain("hidden_coat");
        if (puts.length > 0) expect((await state(rig, chatId)).entities.hidden_coat?.fields).toEqual({ place: HERE });
        const view = JSON.stringify(await rig.rt.view(chatId, rig.host.userId));
        expect(`${view}\n${rig.host.section("Outcome")}`).not.toMatch(/smuggler|hidden_coat/i);
        seen.push({ halted: started.halted ?? null, made: made.map(([, e]) => `${e.name} ${String(e.fields.owner)}`), chips: (await chips(rig, chatId)).map((c) => `${c.kind} ${c.label} ${c.detail ?? ""}`).sort() });
      }
      expect({ mode, ...seen[0] }).toEqual({ mode, ...seen[1] });
    }
  });
});

describe("where the policy comes from", () => {
  test("the world's default, then the user's setting for new chats, then the chat's own, as realism layers", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const doc = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "realism", value: { ...doc.realism, claims: { mode: "hold", capped: false } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "simulation" } } }));
    const newChat = async (): Promise<string> => {
      const chatId = rig.host.createChat("Morning.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      return chatId;
    };
    const policy = async (chatId: string) => (await rig.rt.view(chatId, rig.host.userId)).controls?.realism.claims;
    // The world's own comes first; the user's Simulation asks first only with Use my settings on.
    expect(await policy(await newChat())).toEqual({ mode: "hold", capped: false });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: true } }));
    const mine = await newChat();
    expect(await policy(mine)).toEqual({ mode: "ask", capped: true });
    // The chat's own change wins from the next turn.
    reading(rig, { action: null, params: {} });
    await rig.turn(mine, "I look around.", "The street is quiet.");
    rig.body(await rig.send({ type: "lre.marker", chatId: mine, kind: "claims", to: { mode: "real", capped: false } }));
    expect(await policy(mine)).toEqual({ mode: "real", capped: false });
  });
});
