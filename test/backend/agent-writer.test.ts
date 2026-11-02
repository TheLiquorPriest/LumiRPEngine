// The agents' writer outside a turn (INC1-SPEC C7, R3b), driven on the fake host with no model. A
// dry run says what a change would do and writes nothing. Apply writes the changes that pass as one
// GM edit with one Undo chip: the same apply sent again finds it and writes nothing more, a batch
// asked for again after another is a new write, and the chip's Undo takes the edit back whole. A
// change that can't be made comes back with its code, its reason and its key; someone the world keeps
// secret is changed as anyone else is, under every view. A write made while a turn's engine runs
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
import { TOOL_NOTE, type ToolView } from "../../src/shared/agent-tools";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import { factId, type KnowledgeFact, MINDS_EVENTS, type MindsGmView } from "../../src/shared/minds";
import type { Rec } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
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
function agentEnv(rig: Rig, chatId: string, knowledge: ToolView, role = "assistant"): ToolEnv & { writer: ToolWriter } {
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
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).map((f) => [f.path, f.pinned])).toEqual([[NOTE, true]]);
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

  test("someone the world keeps secret is changed as anyone else is, under every view; an id no one has is the not-found note", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: NEIGHBOR, value: MARA }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const mara: AgentOp = { kind: "gm_edit", op: { op: "set", entity: NEIGHBOR, field: "mood", value: "wary" } };
    const lodger: AgentOp = { kind: "gm_edit", op: { op: "set", entity: NO_ONE, field: "mood", value: "wary" } };
    for (const knowledge of ["everyone", "gm"] as const) {
      const { writer } = agentEnv(rig, chatId, knowledge);
      expect(previewOf(await writer.dryRun(mara)).changeType).toBe("gm_edit");
      expect(refusalOf(await writer.dryRun(lodger))).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noThing, {}, { name: NO_ONE }), key: opKey(lodger) });
    }
  });
});

describe("a write made while a turn's engine runs", () => {
  test("is held, lands once the reply is in, and the turn stands as it was played", async () => {
    const { rig, chatId } = await playedChat();
    const user = rig.host.userId;
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

describe("what every view may ask of the writer", () => {
  test("a spawn may name its own id: a free id is taken, and one in use is the engine's refusal", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: NEIGHBOR, value: MARA }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const spawn = (id?: string): AgentOp => ({ kind: "gm_edit", op: { op: "spawn", kind: "person", name: "Lou", ...(id !== undefined ? { id } : {}) } });
    for (const knowledge of ["everyone", "gm"] as const) {
      const { writer } = agentEnv(rig, chatId, knowledge);
      expect(previewOf(await writer.dryRun(spawn())).changeType).toBe("gm_spawn");
      expect(previewOf(await writer.dryRun(spawn(NO_ONE))).changeType).toBe("gm_spawn");
      expect(refusalOf(await writer.dryRun(spawn(NEIGHBOR))).code).toBe("bad_id");
    }
  });

  test("each fact the chat records may be learned, one Jordan doesn't hold too; a fact the chat doesn't record is the not-found note", async () => {
    const { rig, chatId, now, debt } = await debtChat();
    const learns = (fact: string): AgentOp => ({ kind: "mind_edit", edit: { op: "mind_knowledge", entity: "pov", fact, holding: { how: "witnessed", by: null, evidence: [], since: { msg: null, at: now }, belief: "true", confidence: 1 } } });
    const nothing = factId({ kind: "claim", hash: "nothing" });
    const { writer } = agentEnv(rig, chatId, "everyone");
    expect(await writer.dryRun(learns(debt.id))).not.toMatchObject({ code: "not_found" });
    expect(refusalOf(await writer.dryRun(learns(nothing)))).toEqual({ refused: true, code: "not_found", reason: renderPrompt(TOOL_NOTE.noFact, {}, { name: nothing }), key: opKey(learns(nothing)) });
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
    expect((await listWorkspace(rig.rt, { userId: user, chatId })).find((f) => f.path === NOTE)?.pinned).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
