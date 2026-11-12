// A job's writes on the harness engine (HARNESS-SLICE3 step 9: "The jobs run"). Work for after the
// reply is a job an agent of the turn started. No turn is open by then, so nothing is staged and
// nothing waits for a commit: each change is checked against the chat's head and written as it is
// made, through the ledger's path for writes outside a turn (`LedgerService.write`), under its change
// type's mode.
//
// A job belongs to the record of the turn that started it (`RecHarness.turns`). Every write is tied
// to that record, twice: before it is checked, and again as it reaches the chat's ledger, in the
// same operation that writes it. Once the record is off the chat's path (its reply swiped away or
// deleted, or the chat before it edited: waiting on Keep or Discard, or kept as another story), the
// job writes nothing more. An edit of the reply's own text keeps its record, as it does on every
// engine, so the job goes on.
//
// What a job writes is the reply's own: a `confirm` entry on the head record, never a GM edit, so a
// Regenerate or a swipe of the reply doesn't carry it to the new telling, whose own jobs write what
// that one needs.

import type { RoleId, RoleTier } from "../../shared/agent-roles";
import { WRITE_NOTE } from "../../shared/agent-tools-write";
import { HARNESS_NOTE } from "../../shared/harness-texts";
import { hashParts } from "../../shared/hash";
import type { ChatId, UserId } from "../../shared/ids";
import type { LedgerEvent, PostEntry } from "../../shared/ledger";
import { WRITE_REFUSED } from "../../shared/protocol";
import { type ChangeType, EXTRACTION_TYPES } from "../../shared/settings";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeText, ownMessage } from "../../engine/ledger/path";
import { runRulesOnEvents } from "../../engine/rules";
import type { WorldState } from "../../engine/state";
import { stepTracks } from "../../engine/tracks";
import { Working } from "../../engine/working";
import type { Review } from "../agents/review";
import { type HarnessFiles, worldBuild } from "../agents/tools/harness-ports";
import type { HarnessChange, HarnessTurn } from "../agents/tools/harness-turn";
import { outsideReader } from "../agents/tools/read-view";
import type { ToolEnv } from "../agents/tools/registry";
import { type ChatHead, chatHead, keptFiles } from "../agents/tools/workspace";
import { type AgentOp, type ApplyResult, type CheckedOp, checkOp, contextOf, isOpRefusal, landKept, opLines, type OpPreview, type OpRefusal, type ToolWriter, type WriterCtx, type WriterEnv } from "../agents/tools/writer";
import { opTier } from "../agents/turn-writer";
import { knowledgeOn } from "../chat-knowledge-prefs";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { effectiveMode } from "../settings-store";
import { cardedChange, stagedBy } from "./card";
import { type OffPath, turnRecord, type TurnRecordAt } from "./record";
import { jobStoryPort } from "../story/record";
import { reach, type Standing, toolRefusal, type TurnAgent, writerRole } from "./turn";

/** What the ledger answers a write its maker refused as it reached the chat (`LedgerService.write`'s `unless`): the job's record left the path between its check and its write. */
const LEFT_PATH = "its turn's record is off the chat's path";

/** A sequence for the ids of the writes a job makes: each is the journal's own, as the dispatcher's are. */
let writes = 0;

/** One call of a job's run: whose chat, the turn the job belongs to, and the calling agent. */
export interface JobCall {
  chatId: ChatId;
  userId: UserId;
  /** The harness turn whose record the job belongs to, by its generation's id. */
  basis: string;
  /** The engine saw that turn write its record: one it no longer finds has left the path (its reply was deleted), where a turn it never saw is unknown. */
  committed: boolean;
  agent: TurnAgent;
  /** Where the agent stands (`standingOf`): its definition's tier, held to the agents over it in its run and to whoever started its job. No grant reaches past the turn it was made in. */
  standing: Standing;
  /** The tool called: what a change it stages is held to once more (`toolRefusal`). */
  tool: string;
  /** The chat's area of LumiAH's workspace, where whoever mounts LumiAH gives one (`ToolEnv.files`). */
  files: HarnessFiles | null;
  /** The changes this run's harness tools staged, by key: the same one again is the one written. */
  staged: Map<string, "auto" | "confirm">;
  signal: AbortSignal;
  /** Which instance of its definition the caller is (LumiAH's `RemoteToolCall.as`: the person a character plays); null where nobody said. */
  as: string | null;
  /** The player directs the story, as the job's run was claimed (`HarnessTurn.directed`). */
  directed: boolean;
  /** The job whose run the call is of; null for what an agent of the turn's own run still calls after its reply. */
  job: string | null;
}

/** The record of the job's turn on the chat's path as it stands, or why it takes no writes. */
function recordOf(call: Pick<JobCall, "basis" | "committed">, core: LedgerCore, observed: readonly ChainMessage[]): TurnRecordAt | OffPath {
  const record = turnRecord(core, observed, call.basis);
  return record === "unknown" && call.committed ? "off_path" : record;
}

function refusal(code: string, reason: string, key?: string): OpRefusal {
  return { refused: true, code, reason, ...(key !== undefined ? { key } : {}) };
}

/** Why a job's record takes no more writes, as its tools answer it. */
function offPath(why: OffPath, note: (id: string) => string, key?: string): OpRefusal {
  return refusal(why === "unknown" ? "no_basis" : "off_path", note(why === "unknown" ? HARNESS_NOTE.noBasis : HARNESS_NOTE.offPath), key);
}

/**
 * What a job's call runs with, while its turn's record is on the chat's path: the chat's head as the
 * agent's view reads it, a writer that writes each change as it is made, and the turn the job
 * belongs to as the harness engine's own tools reach it, with its reply. Why not, once the record is
 * off the path: the job stops there. A job the engine can tie to no reply (one started outside a
 * reply's turn, or of a turn the engine never saw) still reads: the chat as it stands, with its
 * newest reply as the reply. What it would change is refused where the change is made (`stageChange`,
 * `jobWriter`, the story record's `keepStory`), in the words `HARNESS_NOTE.noBasis` gives.
 */
export async function jobEnv(rt: Runtime, review: Review, call: JobCall): Promise<ToolEnv | OpRefusal> {
  const { chatId, userId, agent } = call;
  const settings = await rt.settings.get(userId);
  const note = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
  const head = await chatHead(rt, chatId, userId);
  if (!head) return refusal("no_world", note(WRITE_NOTE.noWorld));
  const found = recordOf(call, head.core, head.observed);
  if (found === "off_path") return offPath(found, note);
  const record = typeof found === "string" ? null : found;
  const { view, marks } = agent.role ?? { view: "everyone" as const, marks: true };
  const reader = outsideReader(rt, { userId, chatId, knowledge: view, marks });
  const role = agent.role;
  const tier = reach(call.standing);
  // As in a turn: an agent writes as the role its tier's changes are made as, one of the engine's own that only reads is told so by its own writer, and an agent of no definition of the engine's has none.
  const as = writerRole(role, tier) ?? role?.role ?? null;
  const writer = as ? jobWriter(rt, review, call, as, tier, reader) : null;
  const at = record ? record.index : head.observed.findLastIndex((m) => !m.isUser);
  const reply = at >= 0 ? head.observed[at] : undefined;
  const before = at >= 0 ? head.observed.slice(0, at) : head.observed;
  const said = ownMessage(before);
  const earlier = before.findLast((m) => !m.isUser);
  // Where the turn started and what it landed, as its record holds them: what a memory or a learning reads as what happened.
  const context = record ? head.core.readContext(record.messageId, head.observed) : null;
  const turn: HarnessTurn = {
    main: false,
    tier,
    directed: call.directed,
    // A grant is the author's, in its own turn: no agent of a job is the author.
    grant: () => false,
    knowing: knowledgeOn(await rt.chatKnowledge.get(chatId, userId), head.world, settings),
    settings,
    host: rt.host,
    seed: record ? record.rec.seed : head.run.runSeed,
    runSeed: head.run.runSeed,
    start: context?.start ?? head.state,
    landed: () => (record ? [...record.rec.events] : []),
    said: { messageId: said?.id ?? null, user: said ? activeText(said) : "", before: earlier ? activeText(earlier) : "" },
    reply: record ? { messageId: record.messageId, text: reply ? activeText(reply) : "" } : reply ? { messageId: reply.id, text: activeText(reply) } : null,
    ...(call.job !== null ? { job: { id: call.job, byUser: false } } : {}),
    story: jobStoryPort(rt, { chatId, userId, turn: call.basis, committed: call.committed }),
    stage: (change) => stageChange(rt, review, call, role?.role ?? null, change),
    commit: async () => refusal("not_turn", note(HARNESS_NOTE.notTurn)),
  };
  return { userId, chatId, knowledge: view, marks, reader, writer, agent: { role: agent.def, id: agent.id, ...(call.as !== null ? { as: call.as } : {}) }, signal: call.signal, build: await worldBuild(rt, chatId, userId), files: call.files, turn };
}

/** The job's record as the chat stands when a write reaches it, inside the write's own operation: the last word on whether it lands. */
function unlessOffPath(call: Pick<JobCall, "basis" | "committed">): (core: LedgerCore, observed: ChainMessage[]) => string | null {
  return (core, observed) => (typeof recordOf(call, core, observed) === "string" ? LEFT_PATH : null);
}

/** One checked operation, with what it was checked against. */
interface Checked {
  head: ChatHead;
  ctx: WriterCtx;
  checked: CheckedOp;
  record: TurnRecordAt;
  lines: string[];
  after: Readonly<WorldState>;
}

/**
 * A job's writer: the outside writer's checks (`checkOp`: the operation's shape, the agent's view,
 * its change type's mode, the caps, the engine's own validation) against the chat's head, at the
 * tier the agent writes at, as the role that tier's changes are made as (`writerRole`), for a job
 * whose record is on the path. `stage`, which the write tools call, writes the operation at once;
 * one whose mode is Confirm goes on its reply's review card instead, where Apply lands it.
 */
function jobWriter(rt: Runtime, review: Review, call: JobCall, role: RoleId, tier: RoleTier, reader: ToolEnv["reader"]): ToolWriter {
  const { chatId, userId, signal } = call;
  const wenv: WriterEnv = { userId, chatId, knowledge: "everyone", reader, agent: { role, id: call.agent.id }, signal, connectionId: null, gm: tier === "gm" };
  const check = async (op: AgentOp): Promise<Checked | OpRefusal> => {
    const settings = await rt.settings.get(userId);
    const note = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
    if (signal.aborted) return refusal("cancelled", note(WRITE_NOTE.cancelled));
    if (tier === "read") return refusal("no_writer", note(WRITE_NOTE.noWriter));
    const head = await chatHead(rt, chatId, userId);
    if (!head) return refusal("no_world", note(WRITE_NOTE.noWorld));
    const record = recordOf(call, head.core, head.observed);
    if (typeof record === "string") return offPath(record, note);
    const ctx = contextOf(rt, wenv, head, settings, await rt.settings.learningOf(userId), await keptFiles(rt, chatId, userId), await rt.activeConnectionId(userId), "harness");
    // The story's tier takes the story's own changes; the game master's edits need the game master's (`opTier`).
    const needs = opTier(op, role);
    if (tier !== "gm" && needs !== "story") return refusal("not_granted", ctx.view.text(WRITE_NOTE.notGranted, { tier, needs }));
    const checked = checkOp(rt, ctx, wenv, head.state, ctx.kept, op);
    if (isOpRefusal(checked)) return checked;
    const after = new Working(rt.registry, head.world, head.state);
    after.applyAll(checked.events);
    return { head, ctx, checked, record, after: after.state, lines: opLines(rt, ctx, "everyone", checked.type, after.state, checked.shown) };
  };
  const preview = (c: Checked): OpPreview => ({ key: c.checked.p.key, changeType: c.checked.type, mode: c.checked.mode, lines: c.lines });
  /** Writes one checked operation: a kept file's change in its store, any other as one entry on the head record; why not, when the ledger refuses it. */
  const write = async (c: Checked, label: string): Promise<OpRefusal | { pending: boolean }> => {
    const p = c.checked.p;
    // A file's body is stored first, held for this write until the journal points at it.
    const holder = `harness-job:${p.key}`;
    try {
      if (p.body) await rt.blobs.put(userId, p.body.text, holder);
      if (p.kept) {
        await landKept(rt, chatId, userId, p.kept.changes);
        return { pending: false };
      }
      const agent: NonNullable<PostEntry["agent"]> = { role, key: p.key, applied: [p.key], label, knowledge: "everyone" };
      const result = await rt.ledger.write(chatId, userId, { kind: "post", id: `h${Date.now().toString(36)}${(++writes).toString(36)}`, target: "head", entry: { kind: "confirm", events: c.checked.events, agent } }, { unless: unlessOffPath(call) });
      if (result.reason === LEFT_PATH) return refusal("off_path", c.ctx.view.text(HARNESS_NOTE.offPath), p.key);
      if (result.reason === "paused") return refusal("paused", c.ctx.view.text(WRITE_NOTE.paused), p.key);
      if (!result.applied && !result.pending) return refusal(WRITE_REFUSED, c.ctx.view.text(WRITE_NOTE.stale), p.key);
      rt.push.changed(chatId, userId);
      return { pending: result.pending };
    } finally {
      rt.blobs.release(userId, holder);
    }
  };
  return {
    async dryRun(op) {
      const c = await check(op);
      return isOpRefusal(c) ? c : preview(c);
    },
    async apply(ops, label): Promise<ApplyResult> {
      const out: ApplyResult = { applied: [], refused: [], chipId: null, pending: false };
      for (const op of ops) {
        const c = await check(op);
        const done = isOpRefusal(c) ? c : await write(c, label);
        if (isOpRefusal(done)) out.refused.push(done);
        else if (!isOpRefusal(c)) {
          out.applied.push(c.checked.p.key);
          out.pending ||= done.pending;
        }
      }
      return out;
    },
    async stage(op) {
      const c = await check(op);
      if (isOpRefusal(c)) return c;
      if (c.checked.mode === "confirm") {
        // The card is the player's: its lines are the player character's.
        const lines = opLines(rt, c.ctx, "player", c.checked.type, c.after, c.checked.shown);
        await review.make({ chatId, userId, turn: `${c.record.messageId}:${c.record.swipeId}`, messageId: c.record.messageId, swipeId: c.record.swipeId, placement: "chips", text: "", items: [{ key: c.checked.p.key, source: "agent", role, changeType: c.checked.type, lines, status: "open", op, agentId: call.agent.id, connection: null, by: stagedBy(c.ctx.settings.prompts.texts, call.agent.def, true) }] });
        return preview(c);
      }
      const done = await write(c, `${role}: ${c.lines[0] ?? c.checked.type}`);
      return isOpRefusal(done) ? done : preview(c);
    },
  };
}

/**
 * One change of a harness tool, made after the reply, once the tool is seen to be the caller's to
 * call (the call's own gate once more, so no change rests on that one line): under its type's
 * mode, a Confirm one goes to its reply's review card as a confirm chip the card holds (Apply makes
 * it from its proposal, as a reply's own confirm is made); any other is written at once as one
 * entry on the head record, with what the world's rules and the story's tracks make of it, as a
 * confirmed change is written.
 */
async function stageChange(rt: Runtime, review: Review, call: JobCall, role: RoleId | null, change: HarnessChange): Promise<{ mode: "auto" | "confirm" } | OpRefusal> {
  const { chatId, userId } = call;
  const settings = await rt.settings.get(userId);
  const note = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
  if (call.signal.aborted) return refusal("cancelled", note(WRITE_NOTE.cancelled), change.key);
  // No turn is open after the reply, so nothing is the author's own any more, whoever calls.
  const closed = toolRefusal(call.tool, { ...call.standing, author: false }, note, change.key);
  if (closed) return closed;
  const again = call.staged.get(change.key);
  if (again !== undefined) return { mode: again };
  const head = await chatHead(rt, chatId, userId);
  if (!head) return refusal("no_world", note(WRITE_NOTE.noWorld), change.key);
  const record = recordOf(call, head.core, head.observed);
  if (typeof record === "string") return offPath(record, note, change.key);
  const type: ChangeType | null = change.changeType;
  const active = await rt.activeConnectionId(userId);
  if (type !== null) {
    // A type a reply's read may change keeps the read's mode, whoever makes it; any other is its role's.
    const byRole = (EXTRACTION_TYPES as readonly string[]).includes(type) ? undefined : (role ?? undefined);
    const { mode } = effectiveMode(settings, await rt.settings.learningOf(userId), active, type, byRole, "harness");
    if (mode === "never") return refusal("mode_never", note(WRITE_NOTE.never, { type }), change.key);
    if (mode === "confirm") {
      // On the reply's card, as a chip the card owns: with a proposal it is made from again, or, with none, in its tool's plain words (`cardedChange`).
      const carded = cardedChange(rt, change, type, rt.registry.context(head.world, head.state), { id: `confirm:${record.messageId}:${call.basis}:j${hashParts("lre.harness.job", change.key).slice(0, 12)}`, messageId: record.messageId, swipeId: record.swipeId, connection: active, detail: change.time !== undefined ? "The reply's telling added this much time. Apply it?" : "A change recorded after the reply. Apply it?", by: stagedBy(settings.prompts.texts, call.agent.def, true) });
      await rt.chips.add(chatId, userId, [carded.chip]);
      await review.make({ chatId, userId, turn: `${record.messageId}:${record.swipeId}`, messageId: record.messageId, swipeId: record.swipeId, placement: "chips", text: "", items: [carded.item] });
      call.staged.set(change.key, "confirm");
      return { mode: "confirm" };
    }
  }
  // Nothing to write (a turn that took no time): said, and done.
  if (change.events.length === 0) {
    call.staged.set(change.key, "auto");
    return { mode: "auto" };
  }
  // Its events, whole or not at all, on the head as it stands; then what follows from them.
  const w = new Working(rt.registry, head.world, head.state);
  if (w.applyAll(change.events).length < change.events.length) {
    const why = w.dropped.at(-1)?.rejection;
    return refusal(why?.code ?? WRITE_REFUSED, why ? (why.gm ?? why.reason) : note(WRITE_NOTE.stale), change.key);
  }
  const seed = hashParts(record.rec.seed, "harness", "job", change.key);
  // The world's rules hear what the story changed, as they hear a confirmed change. Passed time ran them as it passed, and an action played ran them as it was played.
  if (type !== null && type !== "play" && change.time === undefined) runRulesOnEvents(rt.registry, w, change.events, { seed: `${seed}:rules` });
  if (type !== null) stepTracks(rt.registry, w, `${seed}:tracks`);
  const events: LedgerEvent[] = [...w.events];
  const agent: NonNullable<PostEntry["agent"]> = { role: role ?? call.agent.def, key: change.key, label: change.lines[0] ?? type ?? call.agent.def };
  const result = await rt.ledger.write(chatId, userId, { kind: "post", id: `h${Date.now().toString(36)}${(++writes).toString(36)}`, target: "head", entry: { kind: "confirm", events, agent } }, { unless: unlessOffPath(call) });
  if (result.reason === LEFT_PATH) return refusal("off_path", note(HARNESS_NOTE.offPath), change.key);
  if (result.reason === "paused") return refusal("paused", note(WRITE_NOTE.paused), change.key);
  if (!result.applied && !result.pending) return refusal(WRITE_REFUSED, note(WRITE_NOTE.stale), change.key);
  call.staged.set(change.key, "auto");
  rt.push.changed(chatId, userId);
  return { mode: "auto" };
}
