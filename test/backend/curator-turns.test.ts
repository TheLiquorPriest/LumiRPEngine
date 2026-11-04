// The Curator's work as an agent turn lands it (ITEMS-SPEC §6.4, §7; a live turn where
// the Curator spent its rounds looking up what its sections showed and lost the place and the thing
// it had staged, and the read's handover was dropped as the Curator's). A round limit that stops its
// agent before it answers leaves what it staged standing, with a warning; an agent that fails lands
// nothing it staged; and wherever its own work isn't whole, the read's changes of its types, held
// aside for it, land through the reconciler for what it didn't stage or answer, once. Its context
// starts it with the scene's things (the Place, Gear and People sections), which it writes from by
// name. The models are scripted: each role's agent answers in its contract, the Curator as each test
// says, the read always giving the reply's handover.

import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { madePlaces } from "../../src/engine/places-in-play";
import type { WorldState } from "../../src/engine/state";
import { CURATOR_TOOL_TURNS, ROLE_LABEL } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { QuietScript } from "../support/fake-host";
import { alderChat, DANNY, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const HOME = "harbor_street_114";
const PHONE = "pov_phone";
const SAID = "I hand Danny my phone so he can call the hardware store.";
const REPLY = "Danny takes your phone and squints at the cracked corner, then holds it to his ear while Maddie keeps the flashlight on the salt.";
/** The read's answer: the reply's handover, a change of the Curator's type it holds aside for it. */
const HANDOVER: JsonObject = { type: "give", item: PHONE, from: "pov", to: DANNY, basis: "hold", why: "Jordan hands Danny his phone" };
/** A thing the world has none of, which the Curator makes. */
const RECEIPT = "Salt receipt";

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });

/** The Curator's make of the receipt Helen keeps in the book. */
const MAKE_RECEIPT = call("item_make", { name: RECEIPT, at: HOME, size: "pocket", why: "Helen's receipt for the salt, in the book on the shelf" }, "m1");

/** The role whose agent made a call, as its system prompt names it; null for a classic call. */
const roleOf = (req: QuietRequest): string | null => /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;

/** A role agent's answer in its contract, with nothing in it, and a classic call's. */
function quietRole(role: string | null, req: QuietRequest): QuietScript {
  const all = req.messages.map((m) => m.content).join("\n");
  if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
  if (role === "curator") return JSON.stringify({ proposals: [] });
  if (role === "knowledge") return JSON.stringify({ facts: [], learned: [], inferred: [], doubted: [] });
  if (role === "minds") return JSON.stringify({ monologue: "Nothing yet.", depiction: "looks up", intent: "Wait.", reactions: [], mood: "calm" });
  if (role === "memory") return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [] });
  if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [], where: null });
  return "{}";
}

interface Played {
  state: WorldState;
  /** Every call the Curator's agent made, in order. */
  curator: QuietRequest[];
  /** The classic extract calls after the reply: the Curator's prompt-only read, when it ran. */
  classic: QuietRequest[];
  chatId: string;
}

/**
 * Port Alder on agents, the fixed pipeline's roles agent-backed (§15), played one turn: the player
 * hands Danny the phone, the read gives the handover, and the Curator's agent answers as `curator`
 * says for its `n`th call (from 0). `patch` joins the settings.
 */
async function curated(rig: Rig, curator: (req: QuietRequest, n: number) => QuietScript, patch: JsonObject = {}): Promise<Played> {
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  const asked: QuietRequest[] = [];
  const classic: QuietRequest[] = [];
  let replied = false;
  rig.host.quietReply = (req) => {
    const role = roleOf(req);
    if (role === "curator") {
      asked.push(req);
      return curator(req, asked.length - 1);
    }
    if (role === "read") return JSON.stringify({ proposals: [HANDOVER], where: null });
    if (role === null && replied && (req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) classic.push(req);
    return quietRole(role, req);
  };
  rig.host.sendUser(chatId, SAID);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  replied = true;
  await rig.host.finish(g, REPLY);
  expect(rig.rt.ledger.errors).toEqual([]);
  return { state: (await stateOf(rig, chatId)).state, curator: asked, classic, chatId };
}

/** Who holds a thing, and on what basis the one holding it uses it. */
function heldBy(state: WorldState, thing: string): { holder: string | null; basis: unknown } {
  const holder = state.entities[thing]?.relations.find((r) => r.type === "in")?.to ?? null;
  const uses = holder === null ? undefined : state.entities[holder]?.relations.find((r) => r.type === "uses" && r.to === thing);
  return { holder, basis: uses?.fields?.basis };
}

/** A thing the Curator made in play, by its name. */
const madeThing = (state: WorldState, name: string) => Object.values(state.entities).find((e) => e.name === name && (e.fields.made as JsonObject | undefined)?.by === "curator");

describe("the Curator's work in an agent turn", () => {
  test("a Curator a round limit stops before it answers keeps what it staged, says so as a warning, and the read's handover lands for what it didn't stage", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    // As seen live: a place and a thing staged, then lookup after lookup until its rounds run out.
    const played = await curated(rig, (_req, n) =>
      n === 0
        ? { content: "", toolCalls: [call("place_make", { name: "Cellar", parent: HOME, as: "room", why: "The salt is stacked in the cellar" }, "p1"), MAKE_RECEIPT] }
        : { content: "", toolCalls: [call("items_find", { words: `salt bag ${n}` }, `f${n}`)] },
    );
    // Its own rounds bound it, not every agent's 10: its rounds, then the answer whose calls didn't run.
    expect(played.curator).toHaveLength(CURATOR_TOOL_TURNS + 1);
    expect(madePlaces(played.state).map((p) => [p.name, p.parent, p.made.by])).toEqual([["Cellar", HOME, "curator"]]);
    expect(madeThing(played.state, RECEIPT)).toBeDefined();
    // The read's handover, held for the Curator, lands: the Curator staged nothing for the phone.
    expect(heldBy(played.state, PHONE)).toEqual({ holder: DANNY, basis: "hold" });
    // Cut short is no failure: no prompt-only read ran in its place.
    expect(played.classic).toEqual([]);
    const records = await rig.rt.diag.records(played.chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.curator && r.level === "warn" && (r.reason ?? "").includes("its agent stopped at a round limit before it answered: what it staged and noted stands"))).toBe(true);
    expect(rig.host.logs.some((l) => l.startsWith("warn:") && l.includes("the Curator's work isn't whole (a round limit stopped its agent): 1 of the 1 change(s) the read held for it land"))).toBe(true);
  });

  test("a Curator whose agent fails lands nothing it staged, and the read's held handover lands beside its prompt-only read", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const played = await curated(rig, (_req, n) => (n === 0 ? { content: "", toolCalls: [MAKE_RECEIPT] } : "not an answer"));
    expect(played.curator).toHaveLength(2);
    // Its make was staged, and its failed run took it back.
    expect(played.curator[1]?.messages.at(-1)?.content ?? "").toContain('"staged"');
    expect(madeThing(played.state, RECEIPT)).toBeUndefined();
    // Its onFail, prompt-only by default, read the Curator's facts once more, and found none.
    expect(played.classic).toHaveLength(1);
    expect(heldBy(played.state, PHONE)).toEqual({ holder: DANNY, basis: "hold" });
    expect(rig.host.logs.some((l) => l.startsWith("warn:") && l.includes("the Curator's work isn't whole (its agent failed, and its prompt-only read stands in): 1 of the 1 change(s) the read held for it land"))).toBe(true);
  });

  test("the reply's handover lands once: as the Curator staged it where it did, and not at all where its work is whole", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    // Cut short after handing the phone over itself, as a loan: the read's hold is the Curator's already.
    const cut = await curated(rig, (_req, n) => ({ content: "", toolCalls: [n === 0 ? call("item_hand", { item: "Phone", to: "Danny Okafor", basis: "loan", why: "Danny borrows the phone to call the store" }, "h1") : call("items_find", { words: `salt bag ${n}` }, `f${n}`)] }));
    expect(heldBy(cut.state, PHONE)).toEqual({ holder: DANNY, basis: "loan" });
    expect(rig.host.logs.some((l) => l.includes("the Curator's work isn't whole (a round limit stopped its agent): 0 of the 1 change(s) the read held for it land"))).toBe(true);
    // Whole, having left the phone alone: the Curator owns the reply's things, so the read's handover doesn't land.
    const other = new Rig({ shipped: true, minds: true });
    const whole = await curated(other, () => JSON.stringify({ proposals: [] }));
    expect(heldBy(whole.state, PHONE).holder).toBe("pov");
    expect(other.host.logs.some((l) => l.includes("the Curator's work is whole, so none of the 1 change(s) the read held for it lands"))).toBe(true);
  });

  test("its context starts it with the scene's things, which it writes from by name: one round where looking each up takes two", async () => {
    // The Curator as its texts ask: a thing its sections list it hands by the name they give it, one it can't see there it looks up first.
    const works = (req: QuietRequest, n: number): QuietScript => {
      const told = req.messages.find((m) => m.role === "user")?.content ?? "";
      const results = (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
      if (results.some((r) => r.includes('"staged"'))) return JSON.stringify({ proposals: [] });
      const found = /"id":"(pov_phone)"/.exec(results.join("\n"))?.[1];
      const named = /^- On you: (Phone)\b/m.exec(told)?.[1];
      const item = named ?? found;
      return { content: "", toolCalls: [item ? call("item_hand", { item, to: "Danny Okafor", basis: "hold", why: "Jordan hands Danny his phone" }, `h${n}`) : call("items_find", { words: "phone" }, `f${n}`)] };
    };
    const rig = new Rig({ shipped: true, minds: true });
    const given = await curated(rig, works);
    // The narrator's Place, Gear and People sections, as its context starts it with them (ITEMS-SPEC §7.2): the phone on Jordan, Danny here, the place.
    const told = given.curator[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    for (const section of ["[People]", "[Gear]", "[Place]", "- On you: Phone", "Danny Okafor", "114 Harbor Street"]) expect(told).toContain(section);
    expect(heldBy(given.state, PHONE)).toEqual({ holder: DANNY, basis: "hold" });
    // Without its sections (Settings → Agents → Context), the same Curator looks the phone up first.
    const other = new Rig({ shipped: true, minds: true });
    const bare = await curated(other, works, { agents: { context: { roles: { curator: { start: [] } } } } });
    expect(bare.curator[0]?.messages.find((m) => m.role === "user")?.content ?? "").not.toContain("[Gear]");
    expect(heldBy(bare.state, PHONE)).toEqual({ holder: DANNY, basis: "hold" });
    // The reduction, measured on the engine's own estimate of each call's prompt: a round and its tokens.
    const spent = async (r: Rig, chatId: string) => {
      const calls = (await r.rt.diag.records(chatId, r.host.userId)).flatMap((x) => (x.kind === "agent" && x.step === "curator" && x.agent?.usage ? [x.agent.usage.in] : []));
      return { calls: calls.length, tokensIn: calls.reduce((a, b) => a + b, 0) };
    };
    const fromSections = await spent(rig, given.chatId);
    const lookedUp = await spent(other, bare.chatId);
    expect([fromSections.calls, lookedUp.calls]).toEqual([2, 3]);
    expect(fromSections.tokensIn).toBeLessThan(lookedUp.tokensIn);
  });
});
