// The chat's workspace as the agents write and read it (INC1-SPEC R3b; DESIGN §4.4), driven on the
// fake host with no model. A note an agent writes is listed and read with who wrote it, on which
// reply, and its pin. It follows its turn as every other event does: a Re-run and a Re-narrate carry
// it, a swipe made before it never had it, and a Branch made from before it lacks it while keeping
// the chat's learned area (learned/), which lives beside the chat's run rather than in its turns.
// Every file is every agent's to read, whatever knowledge it reads the world with: a file names no
// readers. The user's global workspace (~/) is every chat's: a change lands at once, in their own
// storage, and no swipe touches it.

import { describe, expect, test } from "bun:test";
import { BLOBS_DIR, BlobStore } from "../../src/backend/agents/blobs";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import type { ToolDefinition, ToolEnv } from "../../src/backend/agents/tools/registry";
import { listWorkspace, readWorkspaceFile, WORKSPACE_TOOLS } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, opKey, outsideWriter, type ToolWriter } from "../../src/backend/agents/tools/writer";
import { GLOBAL_INDEX_PATH } from "../../src/backend/global-workspace";
import type { QuietRequest } from "../../src/backend/host";
import { renderPrompt } from "../../src/backend/prompts";
import { ROLE_LABEL } from "../../src/shared/agent-roles";
import type { ToolView } from "../../src/shared/agent-tools";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { blobHash, type KeptFile } from "../../src/shared/stores";
import { Rig } from "../support/rig";

const NOTE = "notes/dev.md";
const NOTE_TEXT = "Dev keeps the bar, and the books behind it.";
const SQUARE = "notes/square.md";
const SQUARE_TEXT = "The square is quiet before nine.";
const PLOT = "gm/plot.md";
const PLOT_TEXT = "Dev is behind on the rent and hasn't told Sam.";
const LEARNED = "learned/dev.md";
const LEARNED_TEXT = "Dev takes his coffee black.";

/** The env an agent's tools run with in `chatId` under `knowledge`, as the assistant, with the writer outside a turn. */
function agentEnv(rig: Rig, chatId: string, knowledge: ToolView): ToolEnv & { writer: ToolWriter } {
  const base = { userId: rig.host.userId, chatId, knowledge };
  const env = { ...base, reader: outsideReader(rig.rt, base), agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
  return { ...env, writer: outsideWriter(rig.rt, { ...env, connectionId: null }) };
}

/** Applies `ops` as one batch and gives its Undo chip; a refusal fails the test with its reason. */
async function applied(writer: ToolWriter, ops: readonly AgentOp[], label: string): Promise<string> {
  const out = await writer.apply(ops, label);
  const [refused] = out.refused;
  if (refused) throw new Error(`refused (${refused.code}): ${refused.reason}`);
  if (out.chipId === null) throw new Error("nothing was written");
  return out.chipId;
}

/** The chat's workspace notes as the GM's knowledge lists them, the turns' transcripts aside: each file's path and its body's hash. */
async function files(rig: Rig, chatId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).filter((f) => f.transcript !== true).map((f) => [f.path, f.hash]));
}

/** Swipes the head reply as `mode`, and checks it ran so: a Re-narrate keeps its source's seed, a Re-run rolls a new one. */
async function swipeAs(rig: Rig, chatId: string, mode: "rerun" | "renarrate", text: string): Promise<void> {
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  const from = head.swipeId;
  rig.rt.setSwipeChoice(chatId, mode);
  await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), text);
  const to = rig.host.message(chatId, head.id).swipeId;
  const swipes = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[head.id]?.ledger.swipes;
  expect(to).not.toBe(from);
  expect(swipes?.[String(to)]?.seed === swipes?.[String(from)]?.seed).toBe(mode === "renarrate");
}

/** The workspace tool `name`, as an agent is given it. */
function workspaceTool(name: string): ToolDefinition {
  const tool = WORKSPACE_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no ${name} tool`);
  return tool;
}

describe("a workspace note", () => {
  test("is listed and read with who wrote it and on which reply, and is pinned once its pin is applied", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const { writer } = agentEnv(rig, chatId, "everyone");
    const chip = await applied(writer, [{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev");
    // The entry its Undo chip names (`fix:<message>:<swipe>:<seq>`) is the agent's.
    const [, messageId = "", swipe = "", seq = ""] = chip.split(":");
    const fix = (await rig.rt.ledger.core(chatId, user))?.journal.messages[messageId]?.ledger.swipes[swipe]?.post.find((p) => p.seq === Number(seq));
    expect(fix?.agent).toMatchObject({ role: "assistant", label: "Notes on Dev", knowledge: "everyone" });
    // Written on the head reply: its place among the chat's replies, the greeting the first of them.
    const turn = (await rig.host.chats.messages(chatId, user)).filter((m) => !m.isUser).length;
    const env = { userId: user, chatId };
    const file = { path: NOTE, hash: blobHash(NOTE_TEXT), size: NOTE_TEXT.length, learned: false, provenance: { role: "assistant", key: fix?.agent?.key, turn } };
    expect(await listWorkspace(rig.rt, env)).toEqual([{ ...file, pinned: false }]);
    expect(await readWorkspaceFile(rig.rt, env, NOTE)).toBe(NOTE_TEXT);
    // A pin is a change of its own; the file is still the one that write made.
    await applied(writer, [{ kind: "ws_pin", path: NOTE, pinned: true }], "Pin the notes on Dev");
    expect(await listWorkspace(rig.rt, env)).toEqual([{ ...file, pinned: true }]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("follows a Re-run and a Re-narrate of the reply it was written on and of a later one, and is gone on a swipe made before it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const env = { userId: rig.host.userId, chatId };
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // The reply is swiped before the note is written, so its first swipe never has it.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    await applied(agentEnv(rig, chatId, "everyone").writer, [{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev");
    const note = { [NOTE]: blobHash(NOTE_TEXT) };
    expect(await files(rig, chatId)).toEqual(note);

    // Its reply's Re-run carries it, as it carries every GM edit; a Re-narrate keeps the turn, and the note with it.
    await swipeAs(rig, chatId, "rerun", "The square wakes slowly.");
    expect(await files(rig, chatId)).toEqual(note);
    await swipeAs(rig, chatId, "renarrate", "The square wakes, slowly, again.");
    expect(await files(rig, chatId)).toEqual(note);

    // The first swipe, made before the note, never had it; back on the latest, it is there again.
    const latest = rig.host.message(chatId, reply.id).swipeId;
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({});
    expect(await readWorkspaceFile(rig.rt, env, NOTE)).toBeNull();
    rig.host.navigate(chatId, reply.id, latest);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual(note);

    // A later reply's Re-narrate and Re-run leave it where it is.
    await rig.turn(chatId, "I walk to the pier.", "Gulls call over the water.");
    await swipeAs(rig, chatId, "renarrate", "Gulls call, and the water laps.");
    expect(await files(rig, chatId)).toEqual(note);
    await swipeAs(rig, chatId, "rerun", "The pier is empty.");
    expect(await files(rig, chatId)).toEqual(note);
    expect(await readWorkspaceFile(rig.rt, env, NOTE)).toBe(NOTE_TEXT);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("follows a Regenerate made from the swipe it was written on even while the chat's queue is busy: the swipe that showed is taken in the order the swipes came", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({});
    // A reply's read and memory steps hold the chat's queue; meanwhile the player shows the first swipe
    // again and regenerates, and the host's events arrive as they happen.
    const free = Promise.withResolvers<void>();
    const busy = rig.rt.ledger.with(chatId, user, () => free.promise);
    rig.host.navigate(chatId, reply.id, 0);
    rig.host.deliverNow();
    // The Regenerate's swipe is added, and its event delivered, before its start waits for the backend.
    const started = rig.host.start(chatId, { type: "regenerate" });
    free.resolve();
    await busy;
    await rig.host.finish(await started, "The square wakes slowly.");
    const made = rig.host.message(chatId, reply.id).swipeId;
    expect(made).toBe(2);
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("what the events told of a chat's shown swipes goes with its ledger when that is let go or the chat is deleted, and a Regenerate after the chat opens again is made from the swipe it last synced", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    const shown = (rig.rt.ledger as unknown as { shown: Map<string, unknown> }).shown;
    expect(shown.has(chatId)).toBe(true);
    // The memory budget lets the chat's ledger go, and its shown swipes with it.
    expect(rig.rt.ledger.trim(() => false)).toContain(chatId);
    expect(shown.has(chatId)).toBe(false);
    // Opened again by the first swipe's showing, whose event came before it: the Regenerate's source is the swipe the chat's sync saw.
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "The square wakes slowly.");
    expect(rig.host.message(chatId, reply.id).swipeId).toBe(2);
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(shown.has(chatId)).toBe(true);
    // A deleted chat's go too.
    rig.host.deleteChat(chatId);
    await rig.host.settle();
    expect(shown.has(chatId)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("follows a Regenerate made from its swipe however slowly the chat's ledger opens again: a showing that comes while it is let go is taken in order too", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(rig.rt.ledger.trim(() => false)).toContain(chatId);
    // The chat's journal reads slowly as its ledger opens again; meanwhile the player shows the first
    // swipe and regenerates, and the host's events arrive as they happen.
    const read = rig.host.storage.read.bind(rig.host.storage);
    const journal = Promise.withResolvers<void>();
    rig.host.storage.read = async (path, userId) => {
      if (path.includes("journal")) await journal.promise;
      return read(path, userId);
    };
    rig.host.navigate(chatId, reply.id, 0);
    rig.host.deliverNow();
    const started = rig.host.start(chatId, { type: "regenerate" });
    journal.resolve();
    rig.host.storage.read = read;
    await rig.host.finish(await started, "The square wakes slowly.");
    expect(rig.host.message(chatId, reply.id).swipeId).toBe(2);
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Regenerate whose source swipe is deleted while it generates is made from the swipe below it, never from a later one", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is very quiet.");
    // The note is on the third swipe; the player shows the second, regenerates, and deletes the second meanwhile.
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({});
    const g = await rig.host.start(chatId, { type: "regenerate" });
    rig.host.deleteSwipe(chatId, reply.id, 1);
    await rig.host.settle();
    await rig.host.finish(g, "The square wakes slowly.");
    // Made from the first swipe now, which has no note: the new swipe's record carries nothing, and the third's note stays there.
    const shownNow = rig.host.message(chatId, reply.id).swipeId;
    const made = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[reply.id]?.ledger.swipes[String(shownNow)];
    expect(made?.post.filter((e) => e.agent !== undefined)).toEqual([]);
    expect(await files(rig, chatId)).toEqual({});
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("isn't carried from a later swipe by a Regenerate made from a swipe that holds no record", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const chatId = rig.host.createChat("Morning, Sam.");
    // The first reply is made before the world is attached: its swipe holds no record.
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "The square is quiet.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.host.settle();
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    // Made from the first swipe, which has nothing to carry: the second swipe's note stays there.
    for (const mode of ["rerun", "renarrate"] as const) {
      rig.host.navigate(chatId, reply.id, 0);
      await rig.host.settle();
      expect(await files(rig, chatId)).toEqual({});
      rig.rt.setSwipeChoice(chatId, mode);
      await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), `The square wakes (${mode}).`);
      const message = rig.host.message(chatId, reply.id);
      expect(message.swipeId).toBe(message.swipes.length - 1);
      expect(await files(rig, chatId)).toEqual({});
    }
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("on an agents chat, follows a role-run Regenerate by the same rule: made from the swipe that showed, kept by a Retry read of it that stopped, and never carried from a later swipe", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const recOf = async (swipe: number) => (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[reply.id]?.ledger.swipes[String(swipe)];
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The square is quiet still.");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    expect(await files(rig, chatId)).toEqual({});
    // The first swipe shows again: a Regenerate stopped part-way is made from it, and carries its note.
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    await rig.host.stop(await rig.host.start(chatId, { type: "regenerate" }), "The square");
    expect(rig.host.message(chatId, reply.id).swipeId).toBe(2);
    expect((await recOf(2))?.status).toBe("stopped");
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    // Its Retry read reads it on the chat's roles and keeps what it carried.
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "retry_read");
    if (!chip) throw new Error("no Retry read");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "retry_read" }));
    await rig.host.settle();
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "retry_read")).toBe(false);
    expect(await files(rig, chatId)).toEqual({ [SQUARE]: blobHash(SQUARE_TEXT) });
    // From the second swipe, which never had it, the turn its roles run carries nothing.
    rig.host.navigate(chatId, reply.id, 1);
    await rig.host.settle();
    await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "The square wakes slowly.");
    expect(rig.host.message(chatId, reply.id).swipeId).toBe(3);
    expect(typeof (await recOf(3))?.session?.segment).toBe("string");
    expect(await files(rig, chatId)).toEqual({});
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("is missing from a Branch made from before it, which keeps the chat's learned area as it stood: a file under learned/ lands at once in the chat's metadata, and no swipe changes it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    const { writer } = agentEnv(rig, chatId, "everyone");
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const first = rig.host.head(chatId);
    if (!first) throw new Error("no reply");
    await applied(writer, [{ kind: "ws_write", path: SQUARE, text: SQUARE_TEXT }], "The square");
    await rig.turn(chatId, "I walk to the pier.", "Gulls call over the water.");
    await applied(writer, [{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev");
    // What the agents keep across turns: under learned/, in the chat's metadata beside its run, never in its turns, so it lands at once with no Undo chip.
    expect(await writer.apply([{ kind: "ws_write", path: LEARNED, text: LEARNED_TEXT }], "What Dev drinks")).toMatchObject({ applied: [expect.any(String)], refused: [], chipId: null, pending: false });
    const learned: Record<string, KeptFile> = { [LEARNED]: { hash: blobHash(LEARNED_TEXT), role: "assistant" } };
    expect((await rig.rt.chatAgents.get(chatId, user)).learned).toEqual(learned);
    expect(await readWorkspaceFile(rig.rt, { userId: user, chatId }, LEARNED)).toBe(LEARNED_TEXT);
    const all = { [LEARNED]: blobHash(LEARNED_TEXT), [NOTE]: blobHash(NOTE_TEXT), [SQUARE]: blobHash(SQUARE_TEXT) };
    expect(await files(rig, chatId)).toEqual(all);
    // A Re-run of the reply leaves it as it is.
    await swipeAs(rig, chatId, "rerun", "The pier is empty.");
    expect(await files(rig, chatId)).toEqual(all);

    // A Branch at the first reply has the note written there and not the later one, and the learned area as it stood.
    const branch = rig.host.branch(chatId, first.id);
    await rig.rt.ledger.open(branch, user);
    await rig.host.settle();
    expect(await files(rig, branch)).toEqual({ [LEARNED]: blobHash(LEARNED_TEXT), [SQUARE]: blobHash(SQUARE_TEXT) });
    expect((await rig.rt.chatAgents.get(branch, user)).learned).toEqual(learned);
    // What the chat learns after the Branch is its own; the Branch keeps the area as it was made with.
    expect((await writer.apply([{ kind: "ws_delete", path: LEARNED }], "Forget what Dev drinks")).applied).toHaveLength(1);
    expect((await rig.rt.chatAgents.get(chatId, user)).learned).toEqual({});
    expect((await rig.rt.chatAgents.get(branch, user)).learned).toEqual(learned);
    // The chat it was made from keeps both notes.
    expect(await files(rig, chatId)).toEqual({ [NOTE]: blobHash(NOTE_TEXT), [SQUARE]: blobHash(SQUARE_TEXT) });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a learned file moves, pins and is read as the others are, and never moves into or out of learned/, nor into the global workspace", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const { writer } = agentEnv(rig, chatId, "everyone");
    await writer.apply([{ kind: "ws_write", path: LEARNED, text: LEARNED_TEXT }], "What Dev drinks");
    await applied(writer, [{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev");
    const moved = "learned/people/dev.md";
    expect((await writer.apply([{ kind: "ws_move", from: LEARNED, to: moved }, { kind: "ws_pin", path: moved, pinned: true }], "File it")).applied).toHaveLength(2);
    expect((await listWorkspace(rig.rt, { userId: user, chatId })).find((f) => f.path === moved)).toMatchObject({ pinned: true, learned: true, provenance: { role: "assistant", turn: null } });
    // Across the line, any way, the move is refused in the tool layer's own words, and nothing changes.
    for (const [from, to] of [
      [moved, "notes/dev-drinks.md"],
      [NOTE, "learned/notes.md"],
      [moved, "~/dev-drinks.md"],
      [NOTE, "~/notes/dev.md"],
    ] as const) {
      const op: AgentOp = { kind: "ws_move", from, to };
      expect(await writer.dryRun(op)).toEqual({ refused: true, code: "learned_move", reason: renderPrompt(WRITE_NOTE.learnedMove, {}, { path: from, to }), key: opKey(op) });
    }
    expect(Object.keys(await files(rig, chatId)).sort()).toEqual([moved, NOTE]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("every agent reads every file, whatever view it reads the world with: the GM's note too, which an agent may write over", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    await applied(agentEnv(rig, chatId, "gm").writer, [{ kind: "ws_write", path: PLOT, text: PLOT_TEXT }], "The plot");
    await applied(agentEnv(rig, chatId, "everyone").writer, [{ kind: "ws_write", path: NOTE, text: NOTE_TEXT }], "Notes on Dev");
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: SQUARE, text: SQUARE_TEXT }));
    await rig.host.settle();
    expect((await listWorkspace(rig.rt, { userId: user, chatId })).map((f) => f.path)).toEqual([PLOT, NOTE, SQUARE]);
    expect(await readWorkspaceFile(rig.rt, { userId: user, chatId }, PLOT)).toBe(PLOT_TEXT);
    // A file names no readers: none is listed with any.
    expect((await listWorkspace(rig.rt, { userId: user, chatId })).some((f) => "readers" in f)).toBe(false);
    // An agent gets the same from its own tools whatever its view: every file listed, and each read whole.
    for (const knowledge of ["everyone", "gm"] as const) {
      const env = agentEnv(rig, chatId, knowledge);
      const listed = JSON.parse((await workspaceTool("workspace_list").run({}, env)).text) as { files: { path: string }[] };
      expect(listed.files.map((f) => f.path)).toEqual([PLOT, NOTE, SQUARE]);
      const read = workspaceTool("workspace_read");
      expect(JSON.parse((await read.run({ path: PLOT }, env)).text)).toEqual({ path: PLOT, text: PLOT_TEXT });
      expect(JSON.parse((await read.run({ path: SQUARE }, env)).text)).toEqual({ path: SQUARE, text: SQUARE_TEXT });
    }
    // Nor is any file kept from its writer: the GM's note is written over, and moved in GM → Workspace like any other.
    await applied(agentEnv(rig, chatId, "everyone").writer, [{ kind: "ws_write", path: PLOT, text: "Nothing is planned." }], "The plot, again");
    expect(await readWorkspaceFile(rig.rt, { userId: user, chatId }, PLOT)).toBe("Nothing is planned.");
    rig.body(await rig.send({ type: "lre.workspace", op: "move", chatId, from: PLOT, to: "gm/rent.md" }));
    await rig.host.settle();
    expect(JSON.parse((await workspaceTool("workspace_list").run({}, agentEnv(rig, chatId, "everyone"))).text).files.map((f: { path: string }) => f.path)).toEqual(["gm/rent.md", NOTE, SQUARE]);
    // Asking to set who may read a file is no operation, from an agent or GM → Workspace.
    const op = { kind: "ws_readers", path: SQUARE, readers: "pov" } as unknown as AgentOp;
    expect(await agentEnv(rig, chatId, "gm").writer.dryRun(op)).toEqual({ refused: true, code: "bad_op", reason: renderPrompt(WRITE_NOTE.badOp, {}, {}), key: opKey(op) });
    expect(await rig.send({ type: "lre.workspace", op: "readers", chatId, path: SQUARE, readers: "pov" } as never)).toMatchObject({ type: "lre.error", code: "bad_request" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the global workspace (~/)", () => {
  test("a file written under ~/ lands at once in the user's storage, is listed and read in every chat of theirs, and no swipe or Undo changes it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const other = await rig.worldChat();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const AGENTS = "~/AGENTS.md";
    const STYLE = "~/notes/style.md";
    // GM → Workspace writes it: it lands at once, with no Undo chip, held by no turn.
    const written = rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: AGENTS, text: "Keep replies short." })) as { files?: { path: string }[]; pending?: boolean; undo?: string | null };
    expect([written.pending, written.undo]).toEqual([false, null]);
    expect(written.files?.find((f) => f.path === AGENTS)).toMatchObject({ pinned: false, learned: false, provenance: { role: "gm", turn: null } });
    // An agent writes one too, with its own tool, outside a turn: it lands at once, as a learned file's change does.
    const { writer } = agentEnv(rig, chatId, "everyone");
    expect(await writer.apply([{ kind: "ws_write", path: STYLE, text: "Plain words." }], "House style")).toMatchObject({ applied: [expect.any(String)], refused: [], chipId: null, pending: false });
    // In the user's own storage, not in any chat's ledger or metadata.
    const stored = JSON.parse(rig.host.files.get(`${user}/${GLOBAL_INDEX_PATH}`) ?? "null") as { files: Record<string, unknown> };
    expect(stored.files).toEqual({ [AGENTS]: { hash: blobHash("Keep replies short."), role: "gm" }, [STYLE]: { hash: blobHash("Plain words."), role: "assistant" } });
    expect((await rig.rt.chatAgents.get(chatId, user)).learned).toEqual({});
    // Every chat of the user's lists and reads them; the other chat never had a turn.
    for (const chat of [chatId, other]) {
      expect((await listWorkspace(rig.rt, { userId: user, chatId: chat })).map((f) => f.path).filter((p) => p.startsWith("~/"))).toEqual([AGENTS, STYLE]);
      expect(await readWorkspaceFile(rig.rt, { userId: user, chatId: chat }, AGENTS)).toBe("Keep replies short.");
    }
    const listed = JSON.parse((await workspaceTool("workspace_list").run({ under: "~/notes/" }, agentEnv(rig, other, "everyone"))).text) as { files: { path: string }[] };
    expect(listed.files.map((f) => f.path)).toEqual([STYLE]);
    // A Re-run of the reply leaves it as it is.
    await swipeAs(rig, chatId, "rerun", "The square is waking.");
    expect(await readWorkspaceFile(rig.rt, { userId: user, chatId }, STYLE)).toBe("Plain words.");
    // It moves within ~/, pins, and is deleted there; a move out of it is refused.
    rig.body(await rig.send({ type: "lre.workspace", op: "move", chatId: other, from: STYLE, to: "~/style.md" }));
    rig.body(await rig.send({ type: "lre.workspace", op: "pin", chatId: other, path: "~/style.md", pinned: true }));
    expect((await listWorkspace(rig.rt, { userId: user, chatId })).find((f) => f.path === "~/style.md")).toMatchObject({ pinned: true });
    expect(await rig.send({ type: "lre.workspace", op: "move", chatId, from: AGENTS, to: "AGENTS.md" })).toMatchObject({ type: "lre.error", code: "validation" });
    rig.body(await rig.send({ type: "lre.workspace", op: "delete", chatId, path: "~/style.md" }));
    expect((await listWorkspace(rig.rt, { userId: user, chatId: other })).map((f) => f.path).filter((p) => p.startsWith("~/"))).toEqual([AGENTS]);
    // A ~ anywhere but the start is no path.
    expect(await writer.dryRun({ kind: "ws_write", path: "notes/~/x.md", text: "x" })).toMatchObject({ refused: true, code: "bad_path" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("listing the workspace", () => {
  test("reads no stored body whose size it knows: New note and the list after it read none, with 31 notes there; a body not yet read is read once", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    for (let i = 0; i < 31; i++) rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: `notes/n-${String(i).padStart(2, "0")}.md`, text: `Note ${i}: the harbour at ${i} o'clock.` }));
    await rig.host.settle();
    // Every read of a stored body from here on, counted.
    const read = rig.host.storage.read;
    let bodies = 0;
    rig.host.storage.read = async (path, userId) => {
      if (path.startsWith(BLOBS_DIR)) bodies++;
      return read(path, userId);
    };
    // GM → Workspace's New note: the write, then the list it answers with and the one asked for after it.
    const created = rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: "notes/new.md", text: "" })) as { files?: { path: string; size: number }[] };
    const listed = rig.body(await rig.send({ type: "lre.workspace", op: "list", chatId })) as { files?: { path: string; size: number }[] };
    expect(listed.files).toHaveLength(32);
    expect(created.files).toEqual(listed.files);
    expect(listed.files?.find((f) => f.path === "notes/n-07.md")?.size).toBe("Note 7: the harbour at 7 o'clock.".length);
    expect(bodies).toBe(0);
    // A store that has read no body yet (the engine started again) reads each once, then knows its size.
    const fresh = new BlobStore(rig.host);
    const hash = blobHash("Note 7: the harbour at 7 o'clock.");
    expect([await fresh.size(user, hash), await fresh.size(user, hash)]).toEqual(["Note 7: the harbour at 7 o'clock.".length, "Note 7: the harbour at 7 o'clock.".length]);
    expect(bodies).toBe(1);
    expect(await fresh.size(user, blobHash("never stored"))).toBeNull();
  });
});

describe("an agent turn's note", () => {
  /** A role agent's call: which role's, by its system prompt. */
  const roleOf = (req: QuietRequest): string | null => /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;
  /** What the tools gave back to the call that sends their results. */
  const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));

  test("a role's workspace_write in a turn is staged, as its tool says: a later role of the turn reads it, it lands with the turn under the role that wrote it, and Diagnostics says what the run staged", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    // The read may read the workspace too: after the reply, it reads the note the scene wrote before the plan.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { read: { families: ["people", "workspace"] } } } } }));
    const told: string[] = [];
    const read: string[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      const role = roleOf(req);
      const all = req.messages.map((m) => m.content).join("\n");
      const got = resultsOf(req);
      if (role === "scene") {
        if (got.length === 0) return { content: "", toolCalls: [{ name: "workspace_write", args: { path: NOTE, text: NOTE_TEXT }, callId: "w1" }] };
        told.push(...got);
        return JSON.stringify({ lore: [], notes: [] });
      }
      if (role === "read") {
        if (got.length === 0) return { content: "", toolCalls: [{ name: "workspace_read", args: { path: NOTE }, callId: "r1" }] };
        read.push(...got);
        return JSON.stringify({ proposals: [], where: null });
      }
      if (all.includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      return "{}";
    };
    await rig.turn(chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(told.join("\n")).toContain(renderPrompt(WRITE_NOTE.staged, {}, {}));
    expect(read.join("\n")).toContain(NOTE_TEXT);
    const turn = (await rig.host.chats.messages(chatId, rig.host.userId)).filter((m) => !m.isUser).length;
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).find((f) => f.path === NOTE)).toMatchObject({ hash: blobHash(NOTE_TEXT), provenance: { role: "scene", turn } });
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.scene && r.reason === "Its changes: 1 staged, landing when the turn commits.")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
