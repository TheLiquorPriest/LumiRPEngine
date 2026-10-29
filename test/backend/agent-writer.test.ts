// The agents' writer outside a turn (INC1-SPEC C7, R3b), driven on the fake host with no model. A
// dry run says what a change would do and writes nothing. Apply writes the changes that pass as one
// GM edit with one Undo chip: the same apply sent again finds it and writes nothing more, a batch
// asked for again after another is a new write, and the chip's Undo takes the edit back whole. A
// change that can't be made comes back with its code, its reason and its key, and someone the player
// character can't know reads exactly as an id no one has. A write made while a turn's engine runs
// waits for the turn, whatever Settings → Writes says, and lands once its reply is in; the turn
// stands as it was played.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { chatHead, listWorkspace } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type ApplyResult, GM_ROLE, type OpPreview, type OpRefusal, opKey, outsideWriter, type ToolWriter } from "../../src/backend/agents/tools/writer";
import { renderPrompt } from "../../src/backend/prompts";
import { fixChip } from "../../src/backend/view";
import { resolveEdit } from "../../src/engine/edits";
import { GONE_FIELD } from "../../src/engine/scope";
import { STARTER_WORLDS } from "../../src/packs/index";
import { type AgentKnowledge, TOOL_NOTE } from "../../src/shared/agent-tools";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import { factId, type KnowledgeFact, MINDS_EVENTS, type MindsGmView } from "../../src/shared/minds";
import type { Rec } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { AGENT_CHANGE_LABEL } from "../../src/shared/settings";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const LABEL = "Sam and Dev on edge";
const NOTE = "notes/dev.md";
const NOTE_TEXT = "Dev keeps the bar, and the books behind it.";
/** Mara's id: not her name, so an answer that named her would show. */
const NEIGHBOR = "neighbor";
/** Mara, whom the world keeps secret: no one may know of her but the GM. */
const MARA: JsonObject = { id: NEIGHBOR, kind: "person", name: "Mara", tier: "background", visibility: "secret", fields: {}, relations: [] };
/** An id no one in the world has. */
const NO_ONE = "lodger";

/** The env an agent's tools run with in `chatId` under `knowledge`, as `role` (the assistant unless named), with the writer outside a turn. */
function agentEnv(rig: Rig, chatId: string, knowledge: AgentKnowledge, role = "assistant"): ToolEnv & { writer: ToolWriter } {
  const base = { userId: rig.host.userId, chatId, knowledge };
  const env = { ...base, reader: outsideReader(rig.rt, base), agent: { role, id: "agent_test" }, signal: new AbortController().signal };
  return { ...env, writer: outsideWriter(rig.rt, { ...env, connectionId: null }) };
}

/** A Port Alder chat where Marcus keeps the shop's debt from everyone, Jordan included, and the chat records a rumour no one holds. */
async function debtChat(): Promise<{ rig: Rig; chatId: string; now: number; debt: KnowledgeFact; rumour: KnowledgeFact }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const now = (rig.body(await rig.send({ type: "lre.gm", chatId })).minds as MindsGmView).now;
  const debt: KnowledgeFact = { id: factId({ kind: "track", track: "s_shop_trouble", stage: "truth" }), kind: "track", claim: "The shop is behind on its lease", about: ["marcus_delgado"], truth: "true" };
  const rumour: KnowledgeFact = { id: factId({ kind: "claim", hash: "fleet" }), kind: "claim", claim: "The fleet contract is off", about: ["marcus_delgado"], truth: "false" };
  const learn = { who: ["marcus_delgado"], fact: debt.id, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, keptFrom: "everyone", at: now, msg: null };
  const events = [{ type: MINDS_EVENTS.fact, data: { fact: debt as unknown as JsonObject } }, { type: MINDS_EVENTS.fact, data: { fact: rumour as unknown as JsonObject } }, { type: MINDS_EVENTS.learn, data: learn }];
  await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "seed-debt", target: "head", entry: { kind: "fix", events } });
  return { rig, chatId, now, debt, rumour };
}

/** A test-world chat after one turn: the reply a write lands on. */
async function playedChat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig();
  const chatId = await rig.worldChat();
  await rig.turn(chatId, "I look around.", "The square is quiet.");
  return { rig, chatId };
}

/** A dry run's preview; a refusal fails the test with its reason. */
function previewOf(out: OpPreview | OpRefusal): OpPreview {
  if ("refused" in out) throw new Error(`refused (${out.code}): ${out.reason}`);
  return out;
}

/** A dry run's refusal; a preview fails the test with what it would change. */
function refusalOf(out: OpPreview | OpRefusal): OpRefusal {
  if (!("refused" in out)) throw new Error(`not refused: ${out.lines.join("; ")}`);
  return out;
}

/** The journal's last seq, which every write the chat takes moves on. */
async function journalSeq(rig: Rig, chatId: string): Promise<number | undefined> {
  return (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.seq;
}

/** The record of the head reply's displayed swipe, as the journal holds it. */
async function headRecord(rig: Rig, chatId: string): Promise<Rec | undefined> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  return head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
}

/** Sam's mood and Dev's, as the chat's head has them. */
async function moods(rig: Rig, chatId: string): Promise<unknown[]> {
  const head = await chatHead(rig.rt, chatId, rig.host.userId);
  return [POV, "dev"].map((id) => head?.state.entities[id]?.fields.mood);
}

/** All a write could change: the journal's last seq and its held writes, each message's stored metadata, the head's state and the user's stored blobs. */
async function standing(rig: Rig, chatId: string): Promise<Record<string, unknown>> {
  const user = rig.host.userId;
  const head = await chatHead(rig.rt, chatId, user);
  if (!head) throw new Error("the chat plays no world");
  return {
    seq: head.core.journal.seq,
    held: head.core.journal.held.length,
    metadata: (await rig.host.chats.messages(chatId, user)).map((m) => m.metadata),
    state: hashJson(head.state),
    blobs: (await rig.rt.blobs.list(user)).sort(),
  };
}

describe("a dry run", () => {
  test("says what a change would do, its change type and its mode, and writes nothing", async () => {
    const { rig, chatId } = await playedChat();
    const { writer } = agentEnv(rig, chatId, "gm");
    const before = await standing(rig, chatId);
    const tense: AgentOp = { kind: "gm_edit", op: { op: "set", entity: POV, field: "mood", value: "tense" } };
    const edit = previewOf(await writer.dryRun(tense));
    expect([edit.key, edit.changeType, edit.mode]).toEqual([opKey(tense), "gm_edit", "auto"]);
    expect(edit.lines.length).toBeGreaterThan(0);
    // A file's dry run doesn't store its body either: only an apply does, just before its write.
    const note: AgentOp = { kind: "ws_write", path: NOTE, text: NOTE_TEXT };
    const file = previewOf(await writer.dryRun(note));
    expect([file.key, file.changeType, file.mode]).toEqual([opKey(note), "workspace", "auto"]);
    expect(file.lines.length).toBeGreaterThan(0);
    expect(await standing(rig, chatId)).toEqual(before);
    expect(await rig.moodOf(chatId)).toBe("fine");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("apply", () => {
  test("writes the changes that pass as one GM edit with one Undo chip; the same apply again writes nothing more; Undo takes it all back", async () => {
    const { rig, chatId } = await playedChat();
    const user = rig.host.userId;
    const { writer } = agentEnv(rig, chatId, "gm");
    const samEdit: EditOp = { op: "set", entity: POV, field: "mood", value: "tense" };
    const devEdit: EditOp = { op: "set", entity: "dev", field: "mood", value: "wary" };
    const sam: AgentOp = { kind: "gm_edit", op: samEdit };
    const dev: AgentOp = { kind: "gm_edit", op: devEdit };
    // Remove and Restore own whether someone is gone: the engine refuses this one, and the rest still go.
    const gone: AgentOp = { kind: "gm_edit", op: { op: "set", entity: "dev", field: GONE_FIELD, value: true } };
    const before = await moods(rig, chatId);
    const result = await writer.apply([sam, gone, dev], LABEL);
    expect(result.applied).toEqual([opKey(sam), opKey(dev)]);
    expect(result.refused.map((r) => r.key)).toEqual([opKey(gone)]);
    expect(result.pending).toBe(false);
    expect(await moods(rig, chatId)).toEqual(["tense", "wary"]);

    // One entry on the head: the GM's, naming the agent, with what it asked for; its chip is the chat's one GM edit, with Undo.
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const fixes = (await headRecord(rig, chatId))?.post.filter((p) => p.kind === "fix") ?? [];
    expect(fixes).toHaveLength(1);
    const [fix] = fixes;
    expect(fix?.gm).toBe(true);
    expect(fix?.edit).toEqual({ ops: [samEdit, devEdit] });
    expect(fix?.agent).toMatchObject({ role: "assistant", applied: result.applied, label: LABEL, knowledge: "gm" });
    expect(typeof fix?.agent?.key).toBe("string");
    expect(result.chipId).toBe(fixChip(head.id, head.swipeId, fix?.seq ?? -1));
    const chipId = result.chipId ?? "";
    const chips = async () => (await rig.rt.view(chatId, user)).chips.filter((c) => c.kind === "fix").map((c) => [c.id, c.actions.map((a) => a.id)]);
    expect(await chips()).toEqual([[chipId, ["undo"]]]);

    // The same apply again, as a retry sends it, finds that edit: nothing more is written, and it names the same chip and keys.
    const seq = await journalSeq(rig, chatId);
    const again = await writer.apply([sam, gone, dev], LABEL);
    expect([again.chipId, again.applied, again.pending]).toEqual([result.chipId, result.applied, false]);
    expect(again.refused.map((r) => r.key)).toEqual([opKey(gone)]);
    expect(await journalSeq(rig, chatId)).toBe(seq);
    expect((await headRecord(rig, chatId))?.post.filter((p) => p.kind === "fix")).toHaveLength(1);
    expect(await chips()).toEqual([[chipId, ["undo"]]]);

    // Its Undo, pressed as the chat presses it, takes every change of it back, and the chip with them.
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: result.chipId, choice: "undo" }))).toEqual({ applied: true, pending: false });
    expect(await moods(rig, chatId)).toEqual(before);
    expect(await chips()).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a batch asked for again after another is a new write: pin, unpin and pin again leave the file pinned, each with a chip of its own", async () => {
    const { rig, chatId } = await playedChat();
    const { writer } = agentEnv(rig, chatId, "gm");
    expect((await writer.apply([{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev")).refused).toEqual([]);
    const pin: AgentOp = { kind: "ws_pin", path: NOTE, pinned: true };
    const unpin: AgentOp = { kind: "ws_pin", path: NOTE, pinned: false };
    const first = await writer.apply([pin], "Pin the notes");
    const second = await writer.apply([unpin], "Unpin the notes");
    // The same batch as the first, but no longer the latest write: it is made again.
    const third = await writer.apply([pin], "Pin the notes");
    for (const r of [first, second, third]) expect([r.refused, r.pending]).toEqual([[], false]);
    expect(third.applied).toEqual([opKey(pin)]);
    const chips = [first.chipId, second.chipId, third.chipId];
    expect(chips).not.toContain(null);
    expect(new Set(chips).size).toBe(3);
    expect((await headRecord(rig, chatId))?.post.filter((p) => p.kind === "fix")).toHaveLength(4);
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId, knowledge: "gm" })).map((f) => [f.path, f.pinned])).toEqual([[NOTE, true]]);
    // Sent once more straight after, it is the latest write again: nothing more is written.
    const seq = await journalSeq(rig, chatId);
    expect(await writer.apply([pin], "Pin the notes")).toEqual(third);
    expect(await journalSeq(rig, chatId)).toBe(seq);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a change that can't be made", () => {
  test("comes back with the engine's code and reason, bad_op when it can't be read, and mode_never when its change type is set to Never, each with its key", async () => {
    const { rig, chatId } = await playedChat();
    const { writer } = agentEnv(rig, chatId, "gm");
    // Remove and Restore own whether someone is gone, so the engine refuses a set of it.
    const goneEdit: EditOp = { op: "set", entity: "dev", field: GONE_FIELD, value: true };
    const gone: AgentOp = { kind: "gm_edit", op: goneEdit };
    const head = await chatHead(rig.rt, chatId, rig.host.userId);
    if (!head) throw new Error("the chat plays no world");
    const engine = resolveEdit(rig.rt.registry, head.world, head.state, [goneEdit], { gm: true, runSeed: head.run.runSeed });
    if (!("rejection" in engine)) throw new Error("the engine took it");
    expect(engine.rejection.reason).not.toBe("");
    expect(await writer.dryRun(gone)).toEqual({ refused: true, code: engine.rejection.code, reason: engine.rejection.gm ?? engine.rejection.reason, key: opKey(gone) });

    // One it can't read: a set with no field and no value.
    const malformed = { kind: "gm_edit", op: { op: "set", entity: "dev" } } as unknown as AgentOp;
    expect(await writer.dryRun(malformed)).toEqual({ refused: true, code: "bad_op", reason: renderPrompt(WRITE_NOTE.badOp, {}, {}), key: opKey(malformed) });

    // GM edits set to Never (Settings → Changes from the reply): refused to the agent, its dry run and its apply alike, and nothing is written.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { gm_edit: { mode: "never" } } } }));
    const tense: AgentOp = { kind: "gm_edit", op: { op: "set", entity: POV, field: "mood", value: "tense" } };
    const never: OpRefusal = { refused: true, code: "mode_never", reason: renderPrompt(WRITE_NOTE.never, {}, { type: AGENT_CHANGE_LABEL.gm_edit }), key: opKey(tense) };
    expect(await writer.dryRun(tense)).toEqual(never);
    const seq = await journalSeq(rig, chatId);
    expect(await writer.apply([tense], "Sam tenses")).toEqual({ applied: [], refused: [never], chipId: null, pending: false });
    expect(await journalSeq(rig, chatId)).toBe(seq);
    expect(await rig.moodOf(chatId)).toBe("fine");
    // The GM's own writes (GM → Workspace) are no agent's, so no mode applies to them.
    expect(previewOf(await agentEnv(rig, chatId, "gm", GM_ROLE).writer.dryRun(tense)).mode).toBe("auto");
  });

  test("under the player character's knowledge, someone it can't know is refused exactly as an id no one has: the not-found note, never her name", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: NEIGHBOR, value: MARA }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const { writer } = agentEnv(rig, chatId, "pov");
    const mara: AgentOp = { kind: "gm_edit", op: { op: "set", entity: NEIGHBOR, field: "mood", value: "wary" } };
    const lodger: AgentOp = { kind: "gm_edit", op: { op: "set", entity: NO_ONE, field: "mood", value: "wary" } };
    const hidden = refusalOf(await writer.dryRun(mara));
    const missing = refusalOf(await writer.dryRun(lodger));
    expect(hidden).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noThing, {}, { name: NEIGHBOR }), key: opKey(mara) });
    expect(hidden.reason).not.toContain("Mara");
    // Only the id each was asked for tells the two apart.
    expect(missing.code).toBe(hidden.code);
    expect(missing.reason.replaceAll(NO_ONE, "{id}")).toBe(hidden.reason.replaceAll(NEIGHBOR, "{id}"));
    // Applied together, both are refused as their dry runs were, and nothing is written.
    const seq = await journalSeq(rig, chatId);
    expect(await writer.apply([mara, lodger], "Mornings")).toEqual({ applied: [], refused: [hidden, missing], chipId: null, pending: false });
    expect(await journalSeq(rig, chatId)).toBe(seq);
    // Everyone's knowledge reaches her, so there the same change may be made; an id no one has is still no one.
    const everyone = agentEnv(rig, chatId, "everyone").writer;
    expect(previewOf(await everyone.dryRun(mara)).changeType).toBe("gm_edit");
    expect(await everyone.dryRun(lodger)).toEqual(missing);
  });
});

describe("a write made while a turn's engine runs", () => {
  test("is held whatever Settings → Writes says, lands once the reply is in, and the turn stands as it was played", async () => {
    const { rig, chatId } = await playedChat();
    const user = rig.host.userId;
    expect((await rig.rt.settings.get(user)).holdWrites).toBe(false);
    const { writer } = agentEnv(rig, chatId, "gm");
    const tense: AgentOp = { kind: "gm_edit", op: { op: "set", entity: POV, field: "mood", value: "tense" } };
    // The agent applies while the engine reads the player's message, as the GM agent may at any time.
    const asked: Promise<ApplyResult>[] = [];
    rig.host.quietReply = () => {
      if (asked.length === 0) asked.push(writer.apply([tense], "Sam tenses"));
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    rig.host.quietReply = () => "{}";
    const [made] = asked;
    if (!made) throw new Error("the engine asked no model while it ran");
    const held = await made;
    expect(held).toEqual({ applied: [opKey(tense)], refused: [], chipId: null, pending: true });
    // The reply starts as planned; the write waits, changing nothing yet, and the same apply again finds it waiting.
    expect(g.halted).toBeUndefined();
    expect((await rig.rt.view(chatId, user)).pending).toHaveLength(1);
    expect(await rig.moodOf(chatId)).toBe("fine");
    expect(await writer.apply([tense], "Sam tenses")).toEqual(held);
    expect((await rig.rt.ledger.core(chatId, user))?.journal.held).toHaveLength(1);

    await rig.host.finish(g, "Someone waves back.");
    expect(await rig.moodOf(chatId)).toBe("tense");
    // It is the turn's own, on the reply's record after its events; the reply is the one played, its turn kept.
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    expect([head.id, head.swipes.length]).toEqual([g.messageId ?? "", 1]);
    const rec = await headRecord(rig, chatId);
    expect(rec?.status).toBe("ok");
    const fix = rec?.post.find((p) => p.kind === "fix");
    expect(fix).toMatchObject({ gm: true, agent: { role: "assistant", applied: [opKey(tense)], label: "Sam tenses", knowledge: "gm" } });
    expect(fix?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
    const core = await rig.rt.ledger.core(chatId, user);
    expect([core?.journal.held, core?.journal.prereply]).toEqual([[], undefined]);
    expect((await rig.rt.view(chatId, user)).chips.some((c) => c.kind === "engine_failed")).toBe(false);
    // Landed, it is the head's GM edit with its Undo chip, which the same apply again names.
    expect(await writer.apply([tense], "Sam tenses")).toEqual({ applied: [opKey(tense)], refused: [], chipId: fixChip(head.id, head.swipeId, fix?.seq ?? -1), pending: false });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("what the player character's knowledge may ask of the writer", () => {
  test("a spawn takes no id of its own: an id someone it can't know holds, one it knows and one no one has are refused alike", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: NEIGHBOR, value: MARA }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const spawn = (id?: string): AgentOp => ({ kind: "gm_edit", op: { op: "spawn", kind: "person", name: "Lou", ...(id !== undefined ? { id } : {}) } });
    const pov = agentEnv(rig, chatId, "pov").writer;
    for (const id of [NEIGHBOR, "dev", NO_ONE]) expect(await pov.dryRun(spawn(id))).toEqual({ refused: true, code: "bad_id", reason: renderPrompt(WRITE_NOTE.spawnId, {}, { id }), key: opKey(spawn(id)) });
    expect(renderPrompt(WRITE_NOTE.spawnId, {}, { id: NEIGHBOR })).not.toContain("Mara");
    // With no id of its own, one is made.
    expect(previewOf(await pov.dryRun(spawn())).changeType).toBe("gm_spawn");
    // The GM's knowledge may name one: a free id is taken, and one in use is the engine's refusal.
    const gm = agentEnv(rig, chatId, "gm").writer;
    expect(previewOf(await gm.dryRun(spawn(NO_ONE))).changeType).toBe("gm_spawn");
    expect(refusalOf(await gm.dryRun(spawn(NEIGHBOR))).code).toBe("bad_id");
  });

  test("a fact it doesn't hold reads exactly as one the chat doesn't record; everyone's knowledge finds each fact the chat records", async () => {
    const { rig, chatId, now, debt } = await debtChat();
    const learns = (fact: string): AgentOp => ({ kind: "mind_edit", edit: { op: "mind_knowledge", entity: "pov", fact, holding: { how: "witnessed", by: null, evidence: [], since: { msg: null, at: now }, belief: "true", confidence: 1 } } });
    const nothing = factId({ kind: "claim", hash: "nothing" });
    const pov = agentEnv(rig, chatId, "pov").writer;
    const held = refusalOf(await pov.dryRun(learns(debt.id)));
    expect(held).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noFact, {}, { name: debt.id }), key: opKey(learns(debt.id)) });
    const none = refusalOf(await pov.dryRun(learns(nothing)));
    expect([none.code, none.reason.replaceAll(nothing, "{id}")]).toEqual([held.code, held.reason.replaceAll(debt.id, "{id}")]);
    const everyone = agentEnv(rig, chatId, "everyone").writer;
    expect(await everyone.dryRun(learns(debt.id))).not.toMatchObject({ code: "not_found" });
    expect(refusalOf(await everyone.dryRun(learns(nothing))).code).toBe("not_found");
  });

  test("another's mind is beyond it: a change to Marcus's mind answers alike whether or not he holds the fact", async () => {
    const { rig, chatId, now, debt, rumour } = await debtChat();
    const holding = { how: "witnessed", by: null, evidence: [], since: { msg: null, at: now }, belief: "true", confidence: 1 };
    const marcus = (fact: string, held: JsonObject | null): AgentOp => ({ kind: "mind_edit", edit: { op: "mind_knowledge", entity: "marcus_delgado", fact, holding: held } });
    // He holds the debt and not the rumour: forgetting each, or learning the rumour.
    const asks = [marcus(debt.id, null), marcus(rumour.id, null), marcus(rumour.id, holding), { kind: "mind_edit", edit: { op: "mind_intent", entity: "marcus_delgado", text: "Keep the shop open." } } satisfies AgentOp];
    const pov = agentEnv(rig, chatId, "pov").writer;
    const reason = renderPrompt(WRITE_NOTE.notYourMind, {}, { pov: "Jordan Ellis" });
    for (const ask of asks) expect(await pov.dryRun(ask)).toEqual({ refused: true, code: "not_your_mind", reason, key: opKey(ask) });
    const seq = await journalSeq(rig, chatId);
    expect((await pov.apply(asks, "Marcus")).refused.map((r) => [r.code, r.reason])).toEqual(asks.map(() => ["not_your_mind", reason]));
    expect(await journalSeq(rig, chatId)).toBe(seq);
    // Everyone's knowledge reaches his mind, where the same two forgets tell what he holds: the rule above is what keeps that from the player character's.
    const everyone = agentEnv(rig, chatId, "everyone").writer;
    expect(previewOf(await everyone.dryRun(marcus(debt.id, null))).changeType).toBe("gm_edit");
    expect(refusalOf(await everyone.dryRun(marcus(rumour.id, null))).code).toBe("no_change");
  });

  test("an id in a value is held to it too: a reference set to an account it can't know reads exactly as one set to an account no one has", async () => {
    const { rig, chatId } = await debtChat();
    const pov = agentEnv(rig, chatId, "pov").writer;
    // Jordan's debit card draws on an account: Danny's, which Jordan can't know of, or one no one has.
    const draws = (account: string): AgentOp => ({ kind: "gm_edit", op: { op: "set", entity: "card_pov_debit", field: "account", value: account } });
    const hidden = refusalOf(await pov.dryRun(draws("acct_danny_checking")));
    const missing = refusalOf(await pov.dryRun(draws("acct_no_one")));
    expect(hidden).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noThing, {}, { name: "acct_danny_checking" }), key: opKey(draws("acct_danny_checking")) });
    expect([missing.code, missing.reason.replaceAll("acct_no_one", "{id}")]).toEqual([hidden.code, hidden.reason.replaceAll("acct_danny_checking", "{id}")]);
    // One it knows of is taken, as before; everyone's knowledge reaches Danny's.
    expect(previewOf(await pov.dryRun(draws("acct_pov_savings"))).changeType).toBe("gm_edit");
    expect(previewOf(await agentEnv(rig, chatId, "everyone").writer.dryRun(draws("acct_danny_checking"))).changeType).toBe("gm_edit");
  });

  test("no effect is proposed with it, whatever the effect would touch, and every refusal of the engine's is one note", async () => {
    const { rig, chatId } = await debtChat();
    const pov = agentEnv(rig, chatId, "pov").writer;
    const closes = (account: string): AgentOp => ({ kind: "gm_edit", op: { op: "effect", effect: "economy.close_account", args: { account } } });
    const effectNote = renderPrompt(WRITE_NOTE.povEffect, {}, { pov: "Jordan Ellis" });
    // Danny's account, one no one has and Jordan's own: refused alike.
    for (const account of ["acct_danny_checking", "acct_no_one", "acct_pov_savings"]) expect(await pov.dryRun(closes(account))).toEqual({ refused: true, code: "pov_effect", reason: effectNote, key: opKey(closes(account)) });
    expect(effectNote).not.toContain("Danny");
    // The engine refuses a tier the world doesn't have: the GM's knowledge hears its reason, the player character's one note.
    const tier: AgentOp = { kind: "gm_edit", op: { op: "entity", entity: "pov", tier: "legendary" } };
    const head = await chatHead(rig.rt, chatId, rig.host.userId);
    if (!head) throw new Error("the chat plays no world");
    const engine = resolveEdit(rig.rt.registry, head.world, head.state, [{ op: "entity", entity: "pov", tier: "legendary" }], { gm: true, runSeed: head.run.runSeed });
    if (!("rejection" in engine)) throw new Error("the engine took it");
    expect(await agentEnv(rig, chatId, "gm").writer.dryRun(tier)).toMatchObject({ code: engine.rejection.code, reason: engine.rejection.gm ?? engine.rejection.reason });
    expect(await pov.dryRun(tier)).toEqual({ refused: true, code: "refused", reason: renderPrompt(WRITE_NOTE.povRefused, {}, { pov: "Jordan Ellis" }), key: opKey(tier) });
  });

  test("a field it can't see reads exactly as one its kind doesn't have, whatever its value, and a change that changes nothing is the one note", async () => {
    /** Port Alder with Marcus's desperation, a secret field, at `level`, and his composure, a field anyone may see, at its top. */
    const alder = (level: number) => (id: string, name: string): WorldDoc => {
      const doc = STARTER_WORLDS.modern_slice_of_life(id, name);
      const character = doc.kinds.character;
      const marcus = doc.entities.marcus_delgado;
      if (!character || !marcus) throw new Error("Port Alder has no Marcus");
      character.fields = { ...character.fields, desperation: { type: "number", label: "Desperation", min: 0, max: 3, visibility: "secret" }, composure: { type: "number", label: "Composure", min: 0, max: 3, visibility: "public" } };
      marcus.fields = { ...marcus.fields, desperation: level, composure: 3 };
      return doc;
    };
    const adds = (field: string): AgentOp => ({ kind: "gm_edit", op: { op: "add", entity: "marcus_delgado", field, delta: 1 } });
    const sets = (field: string): AgentOp => ({ kind: "gm_edit", op: { op: "set", entity: "marcus_delgado", field, value: 3 } });
    // Below its top and at it, the hidden field is answered as a field Marcus doesn't have is.
    for (const level of [1, 3]) {
      const rig = new Rig({ shipped: true, templates: { alder_hidden: alder(level) } });
      const worldId = await rig.newWorld("Port Alder", "alder_hidden");
      const chatId = rig.host.createChat("Morning.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      const pov = agentEnv(rig, chatId, "pov").writer;
      for (const change of [adds, sets]) {
        const hidden = refusalOf(await pov.dryRun(change("desperation")));
        const none = refusalOf(await pov.dryRun(change("no_such_field")));
        expect(hidden).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noField, {}, { name: "desperation" }), key: opKey(change("desperation")) });
        expect([none.code, none.reason.replace("no_such_field", "{field}")]).toEqual([hidden.code, hidden.reason.replace("desperation", "{field}")]);
      }
      // A field it sees, already at its top: the GM's knowledge hears that nothing changes, the player character's the one note.
      expect(refusalOf(await agentEnv(rig, chatId, "gm").writer.dryRun(adds("composure"))).code).toBe("no_change");
      expect(await pov.dryRun(adds("composure"))).toEqual({ refused: true, code: "refused", reason: renderPrompt(WRITE_NOTE.povRefused, {}, { pov: "Jordan Ellis" }), key: opKey(adds("composure")) });
    }
  });

  test("an id in a relation's own field is held to it as well: an account it can't know reads exactly as one no one has", async () => {
    // A relation with a reference field, as Build → Relations allows one.
    const alder = (id: string, name: string): WorldDoc => {
      const doc = STARTER_WORLDS.modern_slice_of_life(id, name);
      doc.relations = { ...doc.relations, owes: { id: "owes", label: "Owes", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: { via: { type: "ref", label: "Via" } } } };
      return doc;
    };
    const rig = new Rig({ shipped: true, templates: { alder_owes: alder } });
    const worldId = await rig.newWorld("Port Alder", "alder_owes");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const owes = (via: string): AgentOp => ({ kind: "gm_edit", op: { op: "link", rel: "owes", from: "pov", to: "marcus_delgado", fields: { via } } });
    const pov = agentEnv(rig, chatId, "pov").writer;
    const hidden = refusalOf(await pov.dryRun(owes("acct_danny_checking")));
    const missing = refusalOf(await pov.dryRun(owes("acct_no_one")));
    expect(hidden).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noThing, {}, { name: "acct_danny_checking" }), key: opKey(owes("acct_danny_checking")) });
    expect([missing.code, missing.reason.replaceAll("acct_no_one", "{id}")]).toEqual([hidden.code, hidden.reason.replaceAll("acct_danny_checking", "{id}")]);
    // The GM's knowledge reaches Danny's account.
    expect(previewOf(await agentEnv(rig, chatId, "gm").writer.dryRun(owes("acct_danny_checking"))).changeType).toBe("gm_edit");
  });
});

describe("rules and retries through a turn", () => {
  test("a ✎ fix is written as the player's own (fix_set): held through a turn, it is worked out again under the player's rules", async () => {
    const { rig, chatId } = await playedChat();
    const { writer } = agentEnv(rig, chatId, "gm");
    const fix: AgentOp = { kind: "fix", fix: { entity: POV, field: "mood", value: "tense" } };
    const asked: Promise<ApplyResult>[] = [];
    rig.host.quietReply = () => {
      if (asked.length === 0) asked.push(writer.apply([fix], LABEL));
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    rig.host.quietReply = () => "{}";
    expect((await asked[0])?.pending).toBe(true);
    await rig.host.finish(g, "Someone waves back.");
    expect(await rig.moodOf(chatId)).toBe("tense");
    const entry = (await headRecord(rig, chatId))?.post.find((p) => p.agent?.role === "assistant");
    expect(entry).toMatchObject({ gm: true, edit: { ops: [{ op: "fix_set", entity: POV, field: "mood", value: "tense" }] } });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a held write the turn already made so still counts as its role's latest: asked for again, it writes nothing", async () => {
    const { rig, chatId } = await playedChat();
    const user = rig.host.userId;
    const gm = agentEnv(rig, chatId, "gm", GM_ROLE).writer;
    const { writer } = agentEnv(rig, chatId, "gm");
    const note: AgentOp = { kind: "ws_write", path: NOTE, text: NOTE_TEXT };
    expect((await gm.apply([note], "GM")).applied).toEqual([opKey(note)]);
    // While the engine runs the next turn, the GM pins the note with another change, and the agent pins it too.
    const pin: AgentOp = { kind: "ws_pin", path: NOTE, pinned: true };
    const other: AgentOp = { kind: "ws_write", path: "notes/sam.md", text: "Sam waves at everyone." };
    const asked: Promise<ApplyResult>[] = [];
    rig.host.quietReply = () => {
      if (asked.length === 0) asked.push(gm.apply([pin, other], "GM"), writer.apply([pin], LABEL));
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    rig.host.quietReply = () => "{}";
    expect((await Promise.all(asked)).map((r) => r.pending)).toEqual([true, true]);
    await rig.host.finish(g, "Someone waves back.");
    // The GM's landed first: the agent's, worked out again over it, landed with nothing of its own.
    expect((await headRecord(rig, chatId))?.post.filter((p) => p.agent?.role === "assistant").map((p) => p.events.length)).toEqual([0]);
    // The GM unpins it; the agent's same batch asked for again is still its latest write, so nothing is written and the note stays unpinned.
    expect((await gm.apply([{ kind: "ws_pin", path: NOTE, pinned: false }], "GM")).applied).toHaveLength(1);
    const seq = await journalSeq(rig, chatId);
    expect(await writer.apply([pin], LABEL)).toEqual({ applied: [opKey(pin)], refused: [], chipId: null, pending: false });
    expect(await journalSeq(rig, chatId)).toBe(seq);
    expect((await listWorkspace(rig.rt, { userId: user, chatId, knowledge: "gm" })).find((f) => f.path === NOTE)?.pinned).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
