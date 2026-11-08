// A chat on depth through the loopback (DEPTH-PLAN §2.3, §9.2 A2): the bridge runs the depth turn
// (`runDepthTurn`, on the real stages) in place of today's narrator. The GM writes the player's
// beats, the author sets the scene, the narrator renders its moment, and the passage streams as the
// reply; the commit records the scene's beats and passage, never a read of the reply. Right after it,
// the step after the reply runs (the author's poll lands at it), and the player's edit of the reply
// is his directive, which the author reads once; the reply's own save asks it nothing. The engine
// run before the scene asks no model anything, on either engine: no intent read, judge or choice,
// no agent role or main agent, no final review, no brief or outline. Every model call is the fake
// host's, answered by what the call holds.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { LreError } from "../../src/cli/connection";
import type { CallFields, CallRequestType, RelayLink } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import type { LoopbackResultBodies } from "../../src/shared/loopback";
import { placeOfEntity } from "../../src/engine/scope";
import { isRecord } from "../../src/shared/json";
import { AUTHOR_EDIT, AUTHOR_POLL, authorData, type EditData, type PollData } from "../../src/shared/author";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import { passagesIn } from "../../src/shared/passage";
import { STORY_SCENE } from "../../src/shared/scene";
import { beatOf, STORY_BEAT } from "../../src/shared/story";
import { coreStream } from "../cli/core-staging/llm/openai-stream";
import type { Generation } from "../support/fake-host";
import { DANNY, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const SESSION = "d3e7".repeat(8);
const PORT = 7863;
const PASSAGE = "A bell rings over the door as you come in; behind the counter, someone looks up.";
const EDITED = "A bell rings as you come in; nobody is behind the counter.";
const POLL = "Your open predictions:";
const EDIT = "The reply as the player made it:";

/** The relay's link: each request a frame of its own session, answered as the dispatcher answers it. */
class BackendLink implements RelayLink {
  up = true;
  out = null;
  refused: string | null = null;
  secret = "";

  constructor(private readonly rig: Rig) {}

  async request<T extends CallRequestType>(type: T, fields: CallFields<T>): Promise<LoopbackResultBodies[T]> {
    return (await this.send(type, fields as unknown as Record<string, unknown>)) as LoopbackResultBodies[T];
  }

  async send(type: string, fields: Record<string, unknown>): Promise<unknown> {
    const reply = await this.rig.send({ type, secret: this.secret, ...fields }, SESSION);
    if (reply.type === "lre.error") throw new LreError(reply.code, reply.message, []);
    if (reply.type !== "lre.result") throw new Error(`no result to ${type}`);
    return reply.body;
  }
}

/** Every depth call answered by what it holds: the GM's reading of the player's turn, the author's setup, the narrator's moment and the GM's check, the author's poll and his reading of the player's edit. Null for any other call (the GM's truth-link after the reply; any call of today's engine run). */
function answer(text: string): string | null {
  if (text.includes(POLL)) return JSON.stringify({ considered: [{ what: "Whoever is behind the counter", raised: false, why: "the player speaks next" }] });
  if (text.includes(EDIT)) return JSON.stringify({ cosmetic: true, why: "He only put it his own way." });
  if (text.includes("What the player wrote, verbatim:")) return JSON.stringify({ beats: [{ kind: "act", act: "said", what: "He walks into the shop and says hello.", surface: "He walks in and says hello.", words: /What the player wrote, verbatim:\n(.*)/.exec(text)?.[1] ?? "", quotes: "Hello?" }], signals: [] });
  if (text.includes("His beats, as the GM wrote them:")) {
    const pov = /\[([^\]]+)\] \(the player character\)/.exec(text)?.[1] ?? "";
    return JSON.stringify({ scene: {}, cast: [], staging: [], exposure: [], beats: [{ what: "The bell over the door rings as he comes in.", surface: "A bell rings over the door.", exposure: [{ who: pov, channel: "hearing", reach: "whole" }] }], next: [], end: "He has come in: the player speaks next." });
  }
  if (text.includes("## The beats of its moment")) return JSON.stringify({ faithful: true });
  if (text.includes("## This moment")) return PASSAGE;
  return null;
}

/** A world chat on depth whose connection is the loopback, its relay registered and up: what a test plays turns through. Every model call is answered by `reply` (`answer` unless a test says otherwise); `people` are Live beside the player character, so a classic turn would ask their minds. */
async function loopbackDepth(rig: Rig, asked: string[], others: string[], reply: (text: string) => string | null = answer, people: readonly string[] = []): Promise<{ relay: Relay; key: string; chatId: string }> {
  const host = rig.host;
  host.connectionProfiles.push({ id: "conn-loop", name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: `http://127.0.0.1:${PORT}/v1` });
  host.contextConnectionId = "conn-loop";
  host.quietReply = (req) => {
    const text = req.messages.map((m) => m.content).join("\n");
    asked.push(text);
    const said = reply(text);
    if (said === null) others.push(text);
    return said ?? "{}";
  };
  const link = new BackendLink(rig);
  const registered = await link.send("lre.loopback.register", { name: "sam", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: PORT });
  if (!isRecord(registered) || typeof registered.secret !== "string") throw new Error("the relay wasn't registered");
  link.secret = registered.secret;
  const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" })).page;
  if (!isRecord(page) || typeof page.minted !== "string") throw new Error("no loopback key was minted");
  const key = page.minted;
  const report = { name: "sam", build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: PORT, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 };
  await link.send("lre.loopback.hello", { api: 1, report, open: [] });
  const relay = new Relay(link, { ...RELAY_DEFAULTS, listen: "127.0.0.1", port: PORT, mode: "user" }, { now: Date.now, id: () => crypto.randomUUID().replaceAll("-", ""), log: () => undefined, fingerprint: async () => "fp" });
  // The chunks the bridge pushes to the relay's session reach the relay, as its socket delivers them.
  const send = host.frontend.send;
  host.frontend.send = (message, userId, session) => {
    send(message, userId, session);
    if (message.type === "lre.loopback.chunk" && session === SESSION) queueMicrotask(() => relay.chunk(message));
  };

  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  if (people.length > 0) rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...people] } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (people.length > 0) {
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: people.map((entity) => ({ op: "move", entity, to: here })) }));
  }
  rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
  return { relay, key, chatId };
}

/** The player's message, then the reply generated through the relay as core asks for it: its generation and what streamed, before the reply commits. */
async function streamed(rig: Rig, at: { relay: Relay; key: string; chatId: string }, text: string) {
  const host = rig.host;
  host.sendUser(at.chatId, text);
  await host.settle();
  return relayed(at, await host.begin(at.chatId, { type: "normal" }));
}

/** Generation `g` through the relay as core asks for it: what streamed, before the reply commits. */
async function relayed(at: { relay: Relay; key: string }, g: Generation) {
  const res = await at.relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${at.key}`, host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify({ model: LOOPBACK_MODEL, stream: true, messages: g.prompt ?? [], lre_turn: g.parameters?.lre_turn }) }));
  let content = "";
  let reasoning = "";
  for await (const c of coreStream(res)) {
    content += c.token;
    reasoning += c.reasoning ?? "";
  }
  return { g, content, reasoning };
}

describe("a chat on depth, through the loopback", () => {
  test("its turn plays the scene in place of today's narrator: the passage streams as the reply, the commit records the beats and the passage, the step after the reply runs, and the player's edit goes to the author", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const at = await loopbackDepth(rig, asked, []);
    const { chatId } = at;
    expect(rig.rt.loopback.depth).toBe(rig.rt.depth.run);

    const { g, content, reasoning } = await streamed(rig, at, "I walk into the shop. Hello?");
    expect(content).toBe(PASSAGE);
    expect(reasoning).toContain("The author is setting the scene");
    await host.finish(g, content);

    const core = await rig.rt.ledger.core(chatId, host.userId);
    const rec = core?.chain(toChain(await host.chats.messages(chatId, host.userId))).at(-1)?.ledger?.swipes["0"];
    if (!rec) throw new Error("no record on the reply");
    const pre = rec.events.slice(0, rec.pre);
    expect(pre.some((e) => e.type === STORY_SCENE)).toBe(true);
    expect(pre.flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)?.by] : []))).toEqual([
      { turn: g.id, decided: "player" },
      { turn: g.id, decided: "author" },
    ]);
    expect(passagesIn(rec.events.slice(rec.pre)).map((p) => p.moment)).toEqual([0]);
    expect(rec.events.slice(rec.pre).every((e) => e.type === "story.passage")).toBe(true);

    // Right after the reply, the author's poll lands at it; the reply's own save asked him nothing about an edit.
    const reply = (await host.chats.messages(chatId, host.userId)).at(-1);
    if (!reply) throw new Error("no reply");
    const polls = (await rig.rt.ledger.readEvents(chatId, host.userId, [AUTHOR_POLL])).flatMap((e) => {
      const d = authorData<PollData>(e.event, AUTHOR_POLL);
      return d ? [{ at: e.from.messageId, through: d.through, considered: d.considered.map((c) => c.what) }] : [];
    });
    expect(polls).toEqual([{ at: reply.id, through: reply.id, considered: ["Whoever is behind the counter"] }]);
    expect(asked.filter((t) => t.includes(POLL))).toHaveLength(1);
    expect(asked.filter((t) => t.includes(EDIT))).toHaveLength(0);

    // The player's edit of the reply is his directive: the author reads it beside the passage as it streamed, once.
    host.editMessage(chatId, reply.id, EDITED);
    await host.settle();
    const reads = asked.filter((t) => t.includes(EDIT));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain(PASSAGE);
    expect(reads[0]).toContain(EDITED);
    const edits = (await rig.rt.ledger.readEvents(chatId, host.userId, [AUTHOR_EDIT])).flatMap((e) => {
      const d = authorData<EditData>(e.event, AUTHOR_EDIT);
      return d ? [{ at: e.from.messageId, message: d.message, cosmetic: d.cosmetic }] : [];
    });
    expect(edits).toEqual([{ at: reply.id, message: reply.id, cosmetic: true }]);
    // He reads what the author made of it, on the reply; a turn on the loopback never says depth needs it.
    await rig.rt.depthSettled();
    const shown = (await rig.rt.view(chatId, host.userId)).chips;
    expect(shown.filter((c) => c.kind === "edit_read").map((c) => [c.messageId, c.detail])).toEqual([[reply.id, "The author read your edit as cosmetic: no beat changed. (He only put it his own way.)"]]);
    expect(shown.filter((c) => c.kind === "needs_loopback")).toEqual([]);
  });

  // LIVE2's turn 1: the engine run before the scene still asked its models (the agent pipeline's
  // roles, five calls in, and the main agent's final review), whose work the scene does. With every
  // helper step on (Model use: Full), a classic turn would read the intent, judge the approach, choose
  // for those present and write the brief and the outline; with minds on and two people beside the
  // player character, it would ask their minds too.
  for (const engine of ["classic", "agents"] as const) {
    test(`its turn asks no model anything before the scene, on the ${engine} engine with every step, the minds and the final review on: every call is the scene's`, async () => {
      const rig = new Rig({ shipped: true, minds: true });
      const asked: string[] = [];
      const others: string[] = [];
      const at = await loopbackDepth(rig, asked, others, answer, [DANNY, PRIYA]);
      rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
      if (engine === "agents") rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: at.chatId, engine: "agents" }));
      expect((await rig.rt.settings.get(rig.host.userId)).agents.finalReview.on).toBe(true);

      const { content } = await streamed(rig, at, "I walk into the shop, buy a coffee and pay for it. Hello?");
      expect(content).toBe(PASSAGE);
      expect(asked.some((t) => t.includes("What the player wrote, verbatim:"))).toBe(true);
      // The two are in the scene the author sets.
      expect(asked.some((t) => t.includes("His beats, as the GM wrote them:") && t.includes("Danny Okafor") && t.includes("Priya Nair"))).toBe(true);
      // The point-of-view render of the bell he only hears is the scene's own (LIVE3c L3c-4); nothing else is asked.
      expect(others.filter((t) => !t.startsWith("You write points of view.")).map((t) => t.slice(0, 120))).toEqual([]);
    });
  }

  // LIVE3's turn 1: the reply came back empty, so it kept no record, and the player swiped
  // it with Settings → Swipes on Re-narrate (the default) once the extension's restart had dropped its
  // kept turn. With no record to tell again the plan plays it as a Re-run, but the depth turn was handed
  // the kind the generation started as, and failed: "A Re-narrate needs its source turn's record."
  test("a swipe of a reply that came back empty plays the scene again as a Re-run under the Re-narrate default, its kept turn dropped as Re-run the engine drops it", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    let writes = false;
    // The first reply comes back empty: its narrator writes nothing, its redrafts included (a turn whose beats reach no one
    // is no longer one, LIVE3c L3c-5: the author is given one more step, and still nothing, the reply is the quiet passage).
    const at = await loopbackDepth(rig, [], [], (text) => (!writes && text.includes("## This moment") ? "" : answer(text)));
    expect((await rig.rt.settings.get(host.userId)).swipeDefault).toBe("renarrate");

    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    expect(first.content).toBe("");
    await host.finish(first.g, "");
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");
    expect(rig.rt.ledger.discardKept(at.chatId)).toBe(true);

    writes = true;
    const again = await relayed(at, await host.begin(at.chatId, { type: "swipe", messageId: reply.id }));
    expect(again.reasoning).toContain("Re-running, as your swipe setting says");
    expect(again.content).toBe(PASSAGE);
    await host.finish(again.g, again.content);
    const rec = (await rig.rt.ledger.core(at.chatId, host.userId))?.chain(toChain(await host.chats.messages(at.chatId, host.userId))).at(-1)?.ledger?.swipes["1"];
    expect(passagesIn(rec?.events.slice(rec.pre) ?? []).map((p) => p.moment)).toEqual([0]);
  });

  // LIVE3's lane 1 (L3a-2): GM → Depth → Turn showed no model calls for any loopback turn. The bridge
  // filed them on the record by the engine run's id, which the generation's adoption had renamed to
  // the generation's; a kept turn's retry looked for the failed generation's.
  test("the Turn inspector keeps a loopback turn's model calls on the record its generation took, a kept turn's retry's too", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    let writes = false;
    const at = await loopbackDepth(rig, [], [], (text) => (!writes && text.includes("## This moment") ? "" : answer(text)));
    const roles = (id: string) => rig.rt.inspector.records(at.chatId)?.find((r) => r.id === id)?.provenance?.calls.map((c) => c.role) ?? null;

    // The first reply renders nothing and comes back empty, so its turn is kept for a retry.
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    expect(first.content).toBe("");
    await host.finish(first.g, "");
    expect(roles(first.g.id)).toContain("author");
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");

    // The swipe takes the kept turn: its record follows the retry, with the retry's own calls.
    writes = true;
    const again = await relayed(at, await host.begin(at.chatId, { type: "swipe", messageId: reply.id }));
    expect(again.content).toBe(PASSAGE);
    await host.finish(again.g, again.content);
    expect(roles(again.g.id)).toContain("narrator");
    // GM → Depth → Turn finds the calls by the reply they wrote (`provenance.reply`), which a new reply's plan never named.
    expect(rig.rt.inspector.records(at.chatId)?.find((r) => r.id === again.g.id)?.provenance?.reply).toEqual({ messageId: reply.id, swipeId: 1 });
    expect(roles(first.g.id)).toBeNull();
  });

  // Conformance finding 1 (FIXA's open item): no scene carries a reply on, so today's narrator writes a
  // Continue, but from B2's short context all the same: the preset, the sections and the recent window
  // (Settings → Depth: 4 messages), never the raw history before it. A turn made under a pause and a
  // Re-narrate of a pre-depth reply take the same way.
  test("a Continue is written from the short context: the recent window, never the history before it", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const at = await loopbackDepth(rig, [], []);
    const chat = host.chat(at.chatId);
    for (let i = 1; i <= 6; i++) host.append(chat, { id: `old${i}`, isUser: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", swipes: [`Earlier line ${i}.`], swipeId: 0, bag: {} });
    const g = await host.begin(at.chatId, { type: "continue" });
    const before = host.quietCalls.length;
    const { reasoning } = await relayed(at, g);
    const narrator = host.quietCalls.slice(before).at(-1)?.messages.map((m) => m.content).join("\n") ?? "";
    expect(narrator).toContain("Earlier line 3.");
    expect(narrator).toContain("Earlier line 6.");
    expect(narrator).not.toContain("Earlier line 2.");
    expect(narrator).not.toContain("Morning.");
    expect(reasoning).toContain("The narrator reads your preset as it is and the chat's last 4 messages");
    expect(reasoning).toContain("The 3 earlier messages stay out of its prompt.");
  });

  // FIXA's open item: the player's edit of a reply a Continue carried on was read against its
  // prose alone, so the author took what the Continue added for the player's own words.
  test("the player's edit of a reply a Continue carried on is read against everything it showed: its passage and what the Continue added", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const ADDED = "Behind the counter, a kettle starts to sing.";
    let continuing = false;
    const at = await loopbackDepth(rig, asked, [], (text) => answer(text) ?? (continuing ? ADDED : null));
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    await host.finish(first.g, first.content);

    continuing = true;
    const cont = await relayed(at, await host.begin(at.chatId, { type: "continue" }));
    continuing = false;
    expect(cont.content).toBe(ADDED);
    await host.finish(cont.g, cont.content);
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");
    expect(reply.swipes[reply.swipeId]).toBe(`${PASSAGE} ${ADDED}`);

    host.editMessage(at.chatId, reply.id, `${EDITED} ${ADDED}`);
    await host.settle();
    await rig.rt.depthSettled();
    const reads = asked.filter((t) => t.includes(EDIT));
    expect(reads).toHaveLength(1);
    const was = reads[0]?.split("The reply as it was:")[1]?.split(EDIT)[0] ?? "";
    expect(was).toContain(PASSAGE);
    expect(was).toContain(ADDED);
  });

  // LIVE3's lane 1 (L3a-6): every depth turn moved the clock by the world's scene tick (+30 min a turn,
  // a spoken line included) in the engine run before the scene, and ran the routines for it, while the
  // beats were stamped at the turn's start. The scene's own clock moves the time now: these beats take
  // none, so none passes.
  test("a depth turn's time is the scene's own: the engine run before it passes no scene tick", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const at = await loopbackDepth(rig, [], []);
    const clock = async () => (await rig.rt.ledger.core(at.chatId, host.userId))?.fold(toChain(await host.chats.messages(at.chatId, host.userId))).state.clock;
    const start = await clock();
    expect(typeof start).toBe("number");
    const { g, content } = await streamed(rig, at, "I walk into the shop. Hello?");
    expect(content).toBe(PASSAGE);
    await host.finish(g, content);
    expect(await clock()).toBe(start);
  });

  // Conformance finding 14 (FIXB2's design): Regenerate in the input area deletes the reply and asks a
  // new one, which always played as a Re-run, and any deletion in the last minute was called a redo.
  // Deleting exactly the chat's last depth reply makes its next new reply the redo, which follows the
  // swipe setting (Re-narrate, the default: the same beats, told afresh); his own next message clears it.
  test("Regenerate in the input area redoes the deleted depth reply as the swipe setting says, and a message of his own is never a redo", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const at = await loopbackDepth(rig, asked, []);
    const setups = () => asked.filter((t) => t.includes("His beats, as the GM wrote them:")).length;
    const beats = async () => {
      const rec = (await rig.rt.ledger.core(at.chatId, host.userId))?.chain(toChain(await host.chats.messages(at.chatId, host.userId))).at(-1)?.ledger?.swipes["0"];
      return (rec?.events.slice(0, rec.pre) ?? []).flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)?.id] : []));
    };
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    await host.finish(first.g, first.content);
    const told = await beats();
    expect(told.length).toBeGreaterThan(0);
    expect(setups()).toBe(1);

    const deleteHead = async () => {
      const reply = host.head(at.chatId);
      if (!reply) throw new Error("no reply");
      host.deleteMessage(at.chatId, reply.id);
      await host.settle();
    };
    await deleteHead();
    const redo = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(redo.reasoning).toContain("Redoing the reply you deleted, as your swipe setting says: the same beats, told afresh");
    expect(redo.content).toBe(PASSAGE);
    expect(setups()).toBe(1);
    await host.finish(redo.g, redo.content);
    expect(await beats()).toEqual(told);

    await deleteHead();
    const next = await streamed(rig, at, "I ask for a coffee.");
    expect(next.reasoning).not.toContain("Redoing");
    expect(setups()).toBe(2);
  });

  // The depth release's late correctness review, P2 #3: the redo wasn't tied to the message the
  // deleted reply answered, so deleting that message as well, or editing it, still told the deleted
  // exchange's beats again, his acts from the message he deleted among them.
  test("a redo answers only the message the deleted reply answered, as it was: that message deleted, or its text edited, there is none, and a write of its metadata alone keeps it", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const at = await loopbackDepth(rig, asked, []);
    const beats = async () => {
      const rec = (await rig.rt.ledger.core(at.chatId, host.userId))?.chain(toChain(await host.chats.messages(at.chatId, host.userId))).at(-1)?.ledger?.swipes["0"];
      return (rec?.events.slice(0, rec.pre) ?? []).flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)?.id] : []));
    };
    const deleteLast = async () => {
      const last = (await host.chats.messages(at.chatId, host.userId)).at(-1);
      if (!last) throw new Error("no message");
      host.deleteMessage(at.chatId, last.id);
      await host.settle();
    };
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    await host.finish(first.g, first.content);
    const told = await beats();
    expect(told.length).toBeGreaterThan(0);
    const mine = (await host.chats.messages(at.chatId, host.userId)).findLast((m) => m.isUser);
    if (!mine) throw new Error("no message of his");

    // Another extension writes his message's metadata, which the host tells as an edit: its text is as it was, so the redo stands.
    await deleteLast();
    host.clobberForeign(at.chatId, mine.id);
    await host.settle();
    const redo = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(redo.reasoning).toContain("Redoing the reply you deleted");
    await host.finish(redo.g, redo.content);
    expect(await beats()).toEqual(told);

    // He deletes the reply and puts his message right: the GM reads his new words, and nothing is told again.
    await deleteLast();
    host.editMessage(at.chatId, mine.id, "I stay home and make tea.");
    await host.settle();
    const fixed = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(fixed.reasoning).not.toContain("Redoing");
    expect(asked.filter((t) => t.includes("What the player wrote, verbatim:")).at(-1)).toContain("I stay home and make tea.");
    await host.finish(fixed.g, fixed.content);
    const again = await beats();
    expect(again.length).toBeGreaterThan(0);
    expect(again.some((id) => told.includes(id))).toBe(false);

    // He undoes the exchange, his message too: the next reply answers the message before it, and tells none of the deleted beats again.
    await deleteLast();
    await deleteLast();
    const undone = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(undone.reasoning).not.toContain("Redoing");
    await host.finish(undone.g, undone.content);
    expect((await beats()).some((id) => again.includes(id))).toBe(false);
  });

  // P2 #3 too: the redo took the last swipe a scene played, so swiping back and deleting the reply
  // told again a telling he hadn't kept.
  test("a redo tells again the swipe the deleted reply showed, not the last one a scene played", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const at = await loopbackDepth(rig, [], []);
    const beats = async () => {
      const head = host.head(at.chatId);
      const rec = (await rig.rt.ledger.core(at.chatId, host.userId))?.chain(toChain(await host.chats.messages(at.chatId, host.userId))).at(-1)?.ledger?.swipes[String(head?.swipeId ?? 0)];
      return (rec?.events.slice(0, rec.pre) ?? []).flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)?.id] : []));
    };
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    await host.finish(first.g, first.content);
    const kept = await beats();
    expect(kept.length).toBeGreaterThan(0);
    // A Re-run swipe plays the scene again, with beats of its own.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "rerun" } }));
    const swiped = await relayed(at, await host.begin(at.chatId, { type: "swipe" }));
    await host.finish(swiped.g, swiped.content);
    const other = await beats();
    expect(other.length).toBeGreaterThan(0);
    expect(other.some((id) => kept.includes(id))).toBe(false);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate" } }));

    // He swipes back to the first telling and deletes the reply: its redo tells that telling's beats again.
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");
    host.navigate(at.chatId, reply.id, 0);
    await host.settle();
    host.deleteMessage(at.chatId, reply.id);
    await host.settle();
    const redo = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(redo.reasoning).toContain("Redoing the reply you deleted, as your swipe setting says: the same beats, told afresh");
    await host.finish(redo.g, redo.content);
    expect(await beats()).toEqual(kept);
  });

  // The late correctness review's P2 #5: only the first Continue kept the reply's whole text, and an
  // edit's text outranked a Continue after it, so the author read a later Continue's prose as the
  // player's own edit.
  test("the player's edit is read against the reply as he last saw it: after every Continue, and after his edit the author read", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const ADDED = "Behind the counter, a kettle starts to sing.";
    const MORE = "Danny steps out of the back with two mugs.";
    const LAST = "He sets them down on the counter.";
    let continuing: string | null = null;
    const at = await loopbackDepth(rig, asked, [], (text) => answer(text) ?? continuing);
    const first = await streamed(rig, at, "I walk into the shop. Hello?");
    await host.finish(first.g, first.content);
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");
    const carryOn = async (added: string) => {
      continuing = added;
      const cont = await relayed(at, await host.begin(at.chatId, { type: "continue" }));
      continuing = null;
      expect(cont.content).toBe(added);
      await host.finish(cont.g, cont.content);
    };
    // The reply as it was, as the author read the player's edit to `text`.
    const read = async (text: string) => {
      host.editMessage(at.chatId, reply.id, text);
      await host.settle();
      await rig.rt.depthSettled();
      return asked.filter((t) => t.includes(EDIT)).at(-1)?.split("The reply as it was:")[1]?.split(EDIT)[0]?.trim() ?? "";
    };

    // Two Continues, then his edit: the reply as it was holds what both added.
    await carryOn(ADDED);
    await carryOn(MORE);
    expect(await read(`${EDITED} ${ADDED} ${MORE}`)).toBe(`${PASSAGE} ${ADDED} ${MORE}`);
    // A Continue after his edit, then another edit: the reply as it was is his edit and what that Continue added.
    await carryOn(LAST);
    expect(await read(`${EDITED} ${ADDED} ${MORE} ${LAST} He waves.`)).toBe(`${EDITED} ${ADDED} ${MORE} ${LAST}`);
    // An edit straight after that one: the reply as it was is that edit's text.
    expect(await read(`${EDITED} ${ADDED} ${MORE} He waves.`)).toBe(`${EDITED} ${ADDED} ${MORE} ${LAST} He waves.`);
    expect(asked.filter((t) => t.includes(EDIT))).toHaveLength(3);
  });
});
