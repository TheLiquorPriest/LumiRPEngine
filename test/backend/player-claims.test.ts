// Player claims (DESIGN §9.4), on Port Alder: a typed action that uses a thing the world doesn't
// have, as the POV sees it, plays by the chat's policy. Make it real makes the thing, plays the
// action and says so with an Undo; Ask first waits, with nothing generated, on Add or Not an
// action, and either gives one reply; Hold me to the world drops the action as before. Money is
// never made; keys and things over the cap ask; a claimed key opens nothing authored; a hidden
// thing counts as absent, and nothing tells of it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { isGone } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { ClaimsPolicy } from "../../src/shared/claims";
import type { JsonObject } from "../../src/shared/json";
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
    expect(outcome).toContain("Give: done.");
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
});

describe("Hold me to the world", () => {
  test("the action is dropped with its decline chip and the next reply is told it didn't happen, as before", async () => {
    const { rig, chatId } = await chat({ mode: "hold", capped: false });
    reading(rig, give("coffee", "drink"));
    await rig.turn(chatId, "I pour Danny a coffee.", "You pour Danny a coffee.");
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.realism.claims).toEqual({ mode: "hold", capped: false });
    expect(await claimed(rig, chatId)).toEqual([]);
    const decline = (await chips(rig, chatId)).find((c) => c.kind === "decline");
    expect(decline?.label).toBe("Give: couldn't");
    expect(decline?.detail).toMatch(/coffee/i);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const next = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.section("Outcome")).toMatch(/Give.*didn't happen/);
    await rig.host.finish(next, "Quiet.");
  });
});

describe("limits in every mode", () => {
  test("'I hand him a twenty' never makes money, in any mode", async () => {
    for (const mode of ["real", "ask", "hold"] as const) {
      const { rig, chatId } = await chat({ mode, capped: false });
      reading(rig, give("a twenty", "money"));
      await rig.turn(chatId, "I hand Danny a twenty.", "Danny looks at you, puzzled.");
      expect({ mode, made: await claimed(rig, chatId), replies: replies(rig, chatId) }).toEqual({ mode, made: [], replies: 2 });
      expect((await chips(rig, chatId)).find((c) => c.kind === "decline")?.detail).toMatch(/^Money is never made/);
    }
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

  test("a claimed key asks first, and once added never opens a lock that needs the authored key", async () => {
    const unlock: JsonObject = { id: "unlock_office", label: "Unlock the office", description: "Unlock the shop's back office.", params: {}, requires: ["carries(self, shop_office_key)"], outcomes: { default: [] }, duration: "1", lexicon: ["unlock the office"] };
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
