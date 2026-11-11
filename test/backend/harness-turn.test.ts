// One turn on the harness engine (HARNESS-SLICE3: "One turn on the harness engine"), played by a
// driver that stands where LumiAH's runtime does (`harness-driver.ts`): the guard lets the generation
// through, the run begins, the author and the agents it starts call tools, the writer is asked, the
// reply is saved, and the turn commits once, with one record on the reply. Every decision is a tool
// call the test makes as an agent; the engine makes no model call (`noModelCalls`).

import { describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { readKnowledge, readSlice } from "../../src/packs/minds/core/state";
import { placeOfEntity } from "../../src/engine/scope";
import type { QuietRequest } from "../../src/backend/host";
import { plainMinds, Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { type Agent, AUTHOR, beginTurn, cashOf, claimOf, harnessChat, JOSS, MARA, MARKER, noModelCalls, OKORO, PEOPLE, playOn, type Run, recordOn, stateOf, toolsOf, turnRecord } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);
const CASH = "acct_pov_cash";

/** What the player character's wallet opens with, as the world has it: an account posts its opening the first time money moves. */
const openingOf = async (rig: Rig, chatId: string): Promise<number> => Number((await stateOf(rig, chatId)).entities[CASH]?.fields.opening);

/** A character's agent, as the author's `delegate` starts one: a handle of its own, running as the character definition. */
const mind = (of: string): Agent => ({ id: `delegate-${of}`, role: HARNESS_AGENT.character });
const GM: Agent = { id: "delegate-gm", role: HARNESS_AGENT.gm };

interface Committed {
  landed: string[][];
  review: string[][];
  refused: { lines: string[]; reason: string }[];
}
const commit = async (run: Run, noteText?: string): Promise<Committed> => (await run.answer(AUTHOR, "commit", noteText === undefined ? {} : { note: noteText })).committed as Committed;

/** What the author and a character do in the turn these tests play: Mara decides for herself, Okoro arrives, ten minutes pass. */
async function play(run: Run): Promise<void> {
  await run.answer(mind(MARA), "mind_decide", { who: "Mara", monologue: "He said noon, so I will say noon.", depiction: "Mara glances at the door", intent: "Tell him Okoro comes by at noon.", mood: "easy" });
  await run.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
  await run.answer(AUTHOR, "time_pass", { minutes: 10 });
}

describe("a turn on the harness engine", () => {
  test("the staged writes of a whole turn land in the ledger when its reply is saved, with one record on the reply", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    // What the runtime asks at the start of every run: the engine's author answers this chat, under the world's guidance, with the engine's tools.
    const claim = await claimOf(rig, chatId);
    expect(claim?.mainAgent).toBe(HARNESS_AGENT.author);
    expect(claim?.guidance && "text" in claim.guidance ? claim.guidance.text.length : 0).toBeGreaterThan(0);
    const tools = (await toolsOf(rig, chatId)).map((t) => t.name);
    for (const name of ["commit", "grant_writes", "time_pass", "checks_stakes", "mind_view", "mind_decide", "knowledge_infer", "gm_move", "people_find"]) expect(tools).toContain(name);
    // About no chat it is the engine's whole catalogue, which LumiAH's own Agents and Tools pages hold a definition's tools to: every tool with its family, its tier and what it does. A chat that plays no world on the harness is given none.
    const catalogue = await toolsOf(rig, "");
    expect(catalogue.map((t) => t.name)).toEqual(expect.arrayContaining(tools));
    expect(catalogue.filter((t) => t.family === "" || !["read", "write"].includes(t.tier) || t.description === "")).toEqual([]);
    expect(await toolsOf(rig, rig.host.createChat("Hello."))).toEqual([]);

    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    // The guard let the generation through: no engine run came before it, and nothing asks a page to start it again.
    expect(run.generation?.halted).toBeUndefined();
    expect(run.generation?.open).toBe(true);
    expect(rig.host.restarts).toEqual([]);

    // A character the author started reads as the person she is, and stages her own decision.
    expect((await run.call(mind(MARA), "mind_view", { who: "Mara" })).text).toContain("You are Mara.");
    await play(run);
    // Each agent reads what it staged itself; no one else does, and the chat's ledger holds nothing of the turn.
    expect(JSON.stringify(await run.answer(AUTHOR, "people_find", { name: "Okoro" }))).toContain(HOME);
    expect(JSON.stringify(await run.answer(GM, "people_find", { name: "Okoro" }))).not.toContain(HOME);
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBeNull();

    // Only the author commits: the call's gate closes it to anyone else. Its commit lands what every agent staged, in the order it was staged.
    expect(await run.refusal(GM, "commit", {})).toBe(note(HARNESS_NOTE.authorOnly, { tool: "commit" }));
    const committed = await commit(run, "Okoro is here");
    expect(committed.landed.length).toBe(3);
    expect(committed.review).toEqual([]);
    expect(committed.refused).toEqual([]);
    // Landed is the turn's own until its reply is saved: every agent reads it now, and the ledger takes it whole then, or never.
    expect(JSON.stringify(await run.answer(GM, "people_find", { name: "Okoro" }))).toContain(HOME);
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBeNull();
    expect((await stateOf(rig, chatId)).clock).toBe(clock);

    await run.finish("Mara glances at the door. Okoro is already on the step.", "- Mara says noon.\n- Okoro arrives early.");
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, OKORO)).toBe(HOME);
    expect(state.clock).toBe(clock + 10);
    expect(readSlice(state).chars[MARA]?.mind?.intent).toBe("Tell him Okoro comes by at noon.");
    // One record, on the reply: it names the turn that wrote it, holds LumiAH's own record of that turn, and says which role wrote what.
    const reply = rig.host.head(chatId);
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    expect(rec?.status).toBe("ok");
    expect(recHarnessOf(rec)).toEqual({ turns: [run.turn], record: JSON.parse(JSON.stringify(turnRecord(run))) });
    expect(rec?.agents?.map((a) => a.role)).toEqual(["director"]);
    expect(rec?.events.map((e) => e.type)).toContain("minds.mind");
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    expect(said ? await recordOn(rig, chatId, said.id) : null).toBeNull();
    // Once the turn is over, a call of its run stages nothing: there is nothing to commit.
    expect(await run.refusal(AUTHOR, "commit", {})).toContain(note(HARNESS_NOTE.notTurn));
    noModelCalls(rig);
  });

  test("a turn whose author never says its time takes the scene's default tick, and says so on its record", async () => {
    const { rig, chatId } = await harnessChat();
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I put the kettle on.");
    await run.finish("The kettle ticks as it warms.");
    const reply = rig.host.head(chatId);
    const tick = recHarnessOf(reply ? await recordOn(rig, chatId, reply.id) : null)?.defaultTick ?? 0;
    expect(tick).toBeGreaterThan(0);
    expect((await stateOf(rig, chatId)).clock).toBe(clock + tick);
    // A turn of no time is said, and takes none; and with the setting off no tick is added for a silent author.
    const still = await beginTurn(rig, chatId, "I stand and listen.");
    await still.answer(AUTHOR, "time_pass", { minutes: 0 });
    await still.finish("Nothing moves.");
    expect((await stateOf(rig, chatId)).clock).toBe(clock + tick);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness: { defaultTick: false } } } }));
    const silent = await beginTurn(rig, chatId, "I wait.");
    await silent.finish("The morning holds.");
    expect((await stateOf(rig, chatId)).clock).toBe(clock + tick);
    const last = rig.host.head(chatId);
    expect(recHarnessOf(last ? await recordOn(rig, chatId, last.id) : null)).toEqual({ turns: [silent.turn], record: JSON.parse(JSON.stringify(turnRecord(silent))) });
    noModelCalls(rig);
  });

  test("a character's agent reads what its person knows, and nothing else", async () => {
    const secret = { id: "joss_debt", title: "Joss's debt", content: "HELD-MARK: Joss owes the harbor office two months of rent.", keys: ["rent"], links: [], secret: true, gate: "false", holders: [JOSS] };
    const { rig, chatId } = await harnessChat({ minds: true, put: { lore: { joss_debt: secret } } });
    const run = await beginTurn(rig, chatId, "I ask who is behind on the rent.");
    // Joss holds his secret, and his own mind is given it.
    expect((await run.call(mind(JOSS), "mind_view", { who: "Joss" })).text).toContain("HELD-MARK");
    await run.answer(mind(JOSS), "mind_decide", { who: "Joss", monologue: "THOUGHT-MARK two months behind, and nobody here knows.", depiction: "Joss studies the kettle", intent: "Say nothing about the rent.", mood: "tense" });
    await commit(run);
    // Mara's mind is given what Mara perceives: Joss in the room, but neither his secret nor what he thinks.
    const seen = (await run.call(mind(MARA), "mind_view", { who: "Mara" })).text;
    expect(seen).toContain("You are Mara.");
    expect(seen).toContain("- Joss");
    expect(seen).not.toContain("HELD-MARK");
    expect(seen).not.toContain("THOUGHT-MARK");
    // She is one person: another's mind is closed to her agent, by any of its tools.
    expect(await run.refusal(mind(MARA), "mind_view", { who: "Joss" })).toBe(note(HARNESS_NOTE.otherMind, { self: "Mara", other: "Joss", tool: "mind_view" }));
    // And the tools that read the world as no one person does refuse her agent, whatever its definition was given.
    const closed: [string, Record<string, string>][] = [
      ["people_sheet", { person: "Joss" }],
      ["minds_read", { person: "Joss" }],
      ["knowledge_what_knows", { person: "Joss" }],
      ["lore_search", { query: "rent" }],
      ["lore_read", { id: "joss_debt" }],
      ["gm_move", { entity: "Joss", to: HOME }],
    ];
    for (const [tool, args] of closed) expect(await run.refusal(mind(MARA), tool, args)).toBe(note(HARNESS_NOTE.mindOnly, { tool }));
    // The author reads all of it, marked as secret: the boundary is the character's, not the turn's.
    expect(JSON.stringify(await run.answer(AUTHOR, "lore_search", { query: "rent" }))).toContain('"id":"joss_debt"');
    expect((await run.call(AUTHOR, "lore_read", { id: "joss_debt" })).text).toContain("HELD-MARK");
    expect((await run.call(AUTHOR, "minds_read", { person: "Joss" })).text).toContain("THOUGHT-MARK");
    await run.finish("Nobody answers at first.");
    // After the reply the same holds for a job's run: the character's agent still reads through its own tools alone.
    expect(await run.refusal(mind(MARA), "minds_read", { person: "Joss" })).toBe(note(HARNESS_NOTE.mindOnly, { tool: "minds_read" }));
    noModelCalls(rig);
  });

  test("a write set to Confirm waits on the reply's review card, and lands when the game master applies it", async () => {
    const { rig, chatId } = await harnessChat();
    const run = await beginTurn(rig, chatId, "I pay Mara back the twenty I owe her.");
    // Money adjustments are Confirm as shipped (Settings → Changes from the reply): the write is staged, and says where it waits.
    const staged = (await run.answer(AUTHOR, "gm_adjust_money", { account: CASH, cents: -2000 })).staged as { mode: string; lines: string[] };
    expect(staged.mode).toBe("confirm");
    const committed = await commit(run);
    expect(committed.landed).toEqual([]);
    expect(committed.review).toEqual([staged.lines]);
    await run.finish("Mara counts the notes twice and pockets them.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // The reply's card holds it, open; nothing of it is in the ledger.
    const opening = await openingOf(rig, chatId);
    expect(await cashOf(rig, chatId, CASH)).not.toBe(opening - 2000);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; placement: string; messageId: string; items: { key: string; status: string; source: string; role: string; lines: string[] }[] }[];
    expect(cards.map((c) => ({ turn: c.turn, placement: c.placement, messageId: c.messageId }))).toEqual([{ turn: `${reply.id}:0`, placement: "chips", messageId: reply.id }]);
    expect(cards[0]?.items.map((i) => ({ status: i.status, source: i.source, role: i.role }))).toEqual([{ status: "open", source: "agent", role: "director" }]);
    // Apply lands it, on the reply's record, after the turn.
    const applied = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as typeof cards;
    expect(applied[0]?.items.map((i) => i.status)).toEqual(["applied"]);
    expect(await cashOf(rig, chatId, CASH)).toBe(opening - 2000);
    noModelCalls(rig);
  });

  test("a change set to Confirm that no proposal form holds goes on the card in its tool's plain words, and Apply lands what was recorded", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, knowledge: true }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { learn: { mode: "confirm" } } } }));
    const claim = "Joss owes Mara two months of rent.";
    const holds = async (): Promise<boolean> => Object.values(readKnowledge(await stateOf(rig, chatId)).facts).some((fact) => fact.claim === claim);
    const run = await beginTurn(rig, chatId, "I ask Joss whether the rent is paid.");
    // What Mara learns from Joss is someone else's learning: the reply's own confirm has a form for the player character's alone.
    const knowledge: Agent = { id: "delegate-knowledge", role: HARNESS_AGENT.knowledge };
    const told = { who: ["Mara", "Joss"], facts: [{ ref: "n1", claim, matters: "Mara means to collect, and Joss is hiding it." }], learned: [{ fact: "n1", how: "told", by: "Joss", who: ["Mara"] }] };
    const recorded = (await run.answer(knowledge, "knowledge_infer", told)).recorded as { claim: string; lands: string }[];
    expect(recorded.map((r) => [r.claim, r.lands])).toEqual([[claim, note(WRITE_NOTE.stagedReview)]]);
    const committed = await commit(run);
    expect([committed.landed, committed.refused]).toEqual([[], []]);
    expect(committed.review.length).toBe(1);
    await run.finish("Joss shrugs and says the rent can wait.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // The card tells it as the tool did, and nothing of it is in the ledger.
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; items: { status: string; source: string; changeType: string; lines: string[] }[] }[];
    expect(cards.map((c) => c.turn)).toEqual([`${reply.id}:0`]);
    expect(cards[0]?.items).toMatchObject([{ status: "open", source: "read", changeType: "learn", lines: committed.review[0] }]);
    expect(cards[0]?.items[0]?.lines.join(" ")).toContain(claim);
    expect(await holds()).toBe(false);
    // Apply lands the events the engine's validator made of the call.
    const applied = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as typeof cards;
    expect(applied[0]?.items.map((i) => i.status)).toEqual(["applied"]);
    expect(await holds()).toBe(true);
    noModelCalls(rig);
  });

  test("at a gate the commit waits on the card under the player's message: what is let through lands with the turn, what is declined never does", async () => {
    const { rig, chatId } = await harnessChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { review: { placement: "gate" } } } }));
    const run = await beginTurn(rig, chatId, "I pay Mara back the twenty I owe her.");
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    if (!said) throw new Error("no message");
    await run.answer(AUTHOR, "gm_adjust_money", { account: CASH, cents: -2000 });
    await run.answer(AUTHOR, "gm_adjust_money", { account: CASH, cents: -1500 });
    let done = false;
    const waiting = commit(run).finally(() => {
      done = true;
    });
    await rig.host.settle();
    // The commit holds: the turn's card stands under the message the turn answers, and the reply waits with it.
    expect(done).toBe(false);
    const gate = `${said.id}:gate`;
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; placement: string; items: { key: string; status: string; lines: string[] }[] }[];
    expect(cards.map((c) => ({ turn: c.turn, placement: c.placement, open: c.items.map((i) => i.status) }))).toEqual([{ turn: gate, placement: "gate", open: ["open", "open"] }]);
    const [first] = cards[0]?.items ?? [];
    if (!first) throw new Error("no item");
    // The game master lets the first through and leaves the second. Its answer starts no generation: the turn goes on inside its own.
    const answered = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: gate, keys: [first.key] }));
    expect(answered.start ?? null).toBeNull();
    const committed = await waiting;
    expect(committed.landed).toEqual([first.lines]);
    expect(committed.refused.map((r) => r.reason)).toEqual([note(HARNESS_NOTE.declined)]);
    expect(committed.review).toEqual([]);
    expect(rig.host.restarts).toEqual([]);
    // The gate's card is gone with the wait, and what it let through is the turn's: it lands with the reply.
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    await run.finish("Mara counts the notes twice and pockets them.");
    expect(await cashOf(rig, chatId, CASH)).toBe((await openingOf(rig, chatId)) - 2000);
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    noModelCalls(rig);
  });

  test("a turn that is stopped, or whose run fails, leaves nothing: no record, nothing staged, nothing half-written", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const start = await stateOf(rig, chatId);
    const untouched = async (): Promise<void> => {
      const state = await stateOf(rig, chatId);
      expect(placeOfEntity(state, OKORO)).toBeNull();
      expect(state.clock).toBe(start.clock);
      expect(readSlice(state).chars[MARA]?.mind ?? null).toBeNull();
      expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    };
    // Stopped by the player, after the author committed and while a write still waited to be committed.
    const stopped = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    await play(stopped);
    await commit(stopped);
    await stopped.answer(AUTHOR, "gm_adjust_money", { account: CASH, cents: -2000 });
    if (!stopped.generation) throw new Error("no generation");
    await rig.host.stop(stopped.generation, "Mara glances at the");
    await stopped.end("stopped");
    await untouched();
    const cut = rig.host.head(chatId);
    expect(recHarnessOf(cut ? await recordOn(rig, chatId, cut.id) : null)).toBeNull();
    expect((cut ? await recordOn(rig, chatId, cut.id) : null)?.events ?? []).toEqual([]);
    // What its run still calls is no turn's.
    expect(await stopped.refusal(AUTHOR, "gm_move", { entity: "Okoro", to: HOME })).toBe(note(HARNESS_NOTE.noTurn));
    expect(await stopped.refusal(AUTHOR, "commit", {})).toBe(note(HARNESS_NOTE.noTurn));

    // The run failed, and Lumiverse still saved what the writer had sent: the reply stands, with no record of the turn.
    const failed = await beginTurn(rig, chatId, null, { type: "regenerate" });
    await play(failed);
    await commit(failed);
    await failed.end("failed", { reason: "the connection dropped" });
    if (!failed.generation) throw new Error("no generation");
    await rig.host.finish(failed.generation, "Mara glances at the door.");
    await untouched();
    const kept = rig.host.head(chatId);
    expect(recHarnessOf(kept ? await recordOn(rig, chatId, kept.id) : null)).toBeNull();

    // Neither left anything in the way: the next telling of the reply plays from where the chat stood, and commits.
    const again = await beginTurn(rig, chatId, null, { type: "regenerate" });
    await play(again);
    await again.finish("Mara glances at the door. Okoro is already on the step.");
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, OKORO)).toBe(HOME);
    expect(state.clock).toBe(start.clock + 10);
    const reply = rig.host.head(chatId);
    expect(recHarnessOf(reply ? await recordOn(rig, chatId, reply.id) : null)?.turns).toEqual([again.turn]);
    noModelCalls(rig);
  });

  test("the harness path reaches none of the engine's own model steps, and a classic chat of the same install plays as it always did", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId;
    const classic = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: classic }));
    // A chat new to its world is the harness's wherever the harness can play: this one is put on its classic steps.
    await playOn(rig, classic, "classic");
    // A harness turn with everything a classic turn asks a model for: an action, minds, time, a reply to read. The helper throws, and is never asked.
    const run = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    await play(run);
    await commit(run);
    const sent = await run.finish("Mara glances at the door. Okoro is already on the step.", "- Mara says noon.");
    noModelCalls(rig);
    expect(run.assembled.some((e) => MARKER.test(e.content))).toBe(true);
    expect(sent.some((m) => MARKER.test(m.content))).toBe(false);

    // The same message on the classic chat: the engine runs first, asks its model steps, and the reply starts again with its sections written.
    const calls: QuietRequest[] = [];
    rig.host.quietReply = (req) => {
      calls.push(req);
      return plainMinds(req);
    };
    await rig.turn(classic, "I ask Mara whether Okoro is coming by today.", "Mara glances at the door.");
    expect(calls.length).toBeGreaterThan(0);
    expect(rig.host.assembled.some((e) => MARKER.test(e.content))).toBe(false);
    expect(rig.host.section("Scene")).not.toBe("");
    const reply = rig.host.head(classic);
    const rec = reply ? await recordOn(rig, classic, reply.id) : null;
    expect(rec?.status).toBe("ok");
    expect(rec?.harness).toBeUndefined();

    // And it plays exactly as on an install that never had a harness chat: the same steps asked, the same kinds of events recorded.
    const control = new Rig({ shipped: true, minds: true });
    const controlWorld = await control.newWorld("Alder", "modern_slice_of_life");
    for (const [id, value] of Object.entries(PEOPLE)) control.body(await control.send({ type: "lre.editor", op: "put", worldId: controlWorld, base: null, collection: "entities", id, value }));
    control.body(await control.send({ type: "lre.world", op: "commit", worldId: controlWorld, base: null }));
    const plain = control.host.createChat("Morning.");
    control.body(await control.send({ type: "lre.world", op: "attach", worldId: controlWorld, chatId: plain }));
    const asked: QuietRequest[] = [];
    control.host.quietReply = (req) => {
      asked.push(req);
      return plainMinds(req);
    };
    await control.turn(plain, "I ask Mara whether Okoro is coming by today.", "Mara glances at the door.");
    const head = (req: QuietRequest): string => (req.messages[0]?.content ?? "").slice(0, 60);
    expect(calls.map(head)).toEqual(asked.map(head));
    const controlReply = control.host.head(plain);
    const controlRec = controlReply ? await recordOn(control, plain, controlReply.id) : null;
    expect(rec?.events.map((e) => e.type)).toEqual(controlRec?.events.map((e) => e.type) ?? []);
    expect(rec?.post.map((p) => p.kind)).toEqual(controlRec?.post.map((p) => p.kind) ?? []);
  });
});
