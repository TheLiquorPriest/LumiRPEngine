// A harness tool's change that asks first, as a review card holds it (HARNESS-SLICE3 step 5:
// "A write set to Confirm goes to the review card"). A write tool's operation goes on the card as an
// agent turn's does, and Apply makes it through the writer. A change one of the harness engine's own
// tools staged has no operation: the card holds it as a confirm chip of its own, hidden from the
// chips area, whose Apply makes the change.
//
// - A change with a proposal (a learning, a reveal, time passing) is worded as the player character
//   may read it, and Apply makes it again from that proposal on the chat as it then stands, as a
//   reply's own confirm is made.
// - A change with none is told in the plain words its tool gave it, and Apply lands the events the
//   engine's validator made of the call, whole or not at all. It asks first like any other: a type
//   set to Confirm is never refused for want of a form.
// - Whoever staged a change is named as the harness names its agents (`stagedBy`), never by a role of
//   the older engines: on a harness chat nothing is read from the reply but by the agent that reads it.
//
// And what a turn's agents made of the world's document, which the reply shows after the fact
// (`worldMadeChip`): each commit of the turn, in the lines its card would have listed, with Undo
// while it can be undone whole (`worldMadeShown`, `undoWorldMade`) and Open in Build, which the page
// opens by itself. Undo is the user's own act, through `lre.chip`: never an agent's.

import { HARNESS_AGENT_IDS, HARNESS_TEXT } from "../../shared/harness-texts";
import type { ChatId, MessageId, RevisionId, UserId, WorldId } from "../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import type { PromptTexts } from "../../shared/prompts";
import type { ChangeType } from "../../shared/settings";
import type { Chip, ChipAction } from "../../shared/state-view";
import { changesBetween } from "../../shared/world-diff";
import { validMarkerBody } from "../../engine/events";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import type { ReadContext } from "../../engine/registry";
import type { StoredReviewItem } from "../agents/review";
import { draftNotice, syncWorldBook, worldBuild } from "../agents/tools/harness-ports";
import type { HarnessChange } from "../agents/tools/harness-turn";
import type { StoredChip } from "../chips";
import { toChain } from "../ledger-io";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { WorldError } from "../worlds";

/** The lines a card tells a change in: its proposal as the player character may read it, or, where it has none, the plain words its tool gave it. */
export function cardLines(rt: Runtime, change: HarnessChange, view: Pick<ReadContext, "registry" | "world" | "state">): string[] {
  if (change.proposal) return [rt.proposalLabel(change.proposal, view)];
  return change.lines.length > 0 ? [...change.lines] : [String(change.changeType)];
}

/**
 * Who staged a change, as a harness chat's review card names them: the agent's name as the harness
 * lists its agents, in the user's texts, or the id of a definition that isn't the engine's; `after`:
 * it came once the reply was written, in a job's run.
 */
export function stagedBy(texts: PromptTexts, def: string, after: boolean): string {
  const own = HARNESS_AGENT_IDS.find((id) => id === def);
  const name = own === undefined ? def : renderPrompt(HARNESS_TEXT.agent(own, "name"), texts, {});
  return after ? `${name}, after the reply` : name;
}

/** The confirm chip a reply's card holds for a change, and the card's item for it: `at` says which chip, on which swipe of which reply, under whose connection its answer counts, what the chip says of itself, and who staged the change (`stagedBy`). */
export function cardedChange(rt: Runtime, change: HarnessChange, type: ChangeType, view: Pick<ReadContext, "registry" | "world" | "state">, at: { id: string; messageId: MessageId; swipeId: number; connection: string; detail: string; by: string }): { chip: StoredChip; item: StoredReviewItem } {
  const lines = cardLines(rt, change, view);
  const form: JsonObject = change.proposal ? { proposal: change.proposal } : { staged: JSON.parse(JSON.stringify(change.events)) as JsonValue };
  const chip: StoredChip = { id: at.id, kind: "confirm", messageId: at.messageId, swipeId: at.swipeId, label: lines[0] ?? type, detail: at.detail, actions: [{ id: "confirm", label: "Apply", style: "primary" }, { id: "reject", label: "No" }], expires: "next_send", payload: { type, connection: at.connection, ...form, review: true } };
  return { chip, item: { key: at.id, source: "read", role: "read", changeType: type, lines, status: "open", chipId: at.id, by: at.by } };
}

// ---------------------------------------------------------------- what a turn made of the world's document

/** The kind of a reply's chip for a commit of the world's document its turn made. */
export const WORLD_MADE = "world_made";

/** Undo, which the backend makes; Open in Build, which the page opens and sends nothing for. */
const UNDO: ChipAction = { id: "undo", label: "Undo", style: "danger" };
export const OPEN_IN_BUILD: ChipAction = { id: "build", label: "Open in Build" };
/** What the chip says where Undo isn't offered, and what a refusal of it ends with: how to change it now. */
const CHANGE_NOW = "To change it now, edit the world in Build, or ask the author in your next message.";
const MOVED_ON = `The world has changed since, or this chat has played on. ${CHANGE_NOW}`;

/** One commit a turn made, as its reply's chip keeps it: the world's newest revision before it and the one it made, and the harness turn that made it. */
export interface WorldMade {
  worldId: WorldId;
  from: RevisionId;
  to: RevisionId;
  turn: string;
}

/** A chip's record of a commit, read back; null where it isn't one, as a stored file may hold anything. */
function worldMadeOf(payload: JsonObject): WorldMade | null {
  const { worldId, from, to, turn } = payload;
  return typeof worldId === "string" && typeof from === "string" && typeof to === "string" && typeof turn === "string" ? { worldId, from, to, turn } : null;
}

/**
 * The reply's chip for one commit its turn made, marked as made: the revision it is now, whether this
 * chat plays it from the next turn (`plays`: the turn also brought the chat to it), and what it
 * changed, in the lines its review card would have listed (`changes`). Kept until the reply goes.
 */
export function worldMadeChip(made: WorldMade, at: { id: string; messageId: MessageId; swipeId: number }, said: { note: string | null; changes: readonly string[]; plays: boolean }): StoredChip {
  const what = `The author made this the world's newest revision${said.note !== null ? ` (${said.note})` : ""}.`;
  const when = said.plays ? "This chat plays it from the next turn." : "This chat plays it once you upgrade it, in GM → This chat → Pins and upgrade.";
  return { id: at.id, kind: WORLD_MADE, messageId: at.messageId, swipeId: at.swipeId, label: "Changed the world's document", detail: [`${what} ${when}`, ...said.changes].join("\n"), actions: [UNDO, OPEN_IN_BUILD], expires: "never", payload: { worldId: made.worldId, from: made.from, to: made.to, turn: made.turn } };
}

/** Whether this chat played on past the turn of a reply: a turn is under way, a Continue of the reply played after it, or a later reply on the chat's path holds a record. */
function playedOn(core: LedgerCore, chain: readonly ChainMessage[], messageId: MessageId, turn: string): boolean {
  if (core.inFlight) return true;
  const at = chain.findIndex((m) => m.id === messageId);
  const reply = chain[at];
  if (!reply) return true;
  if (activeRecord(reply, core.journal.tombstones)?.harness?.turns.at(-1) !== turn) return true;
  return chain.slice(at + 1).some((m) => !m.isUser && activeRecord(m, core.journal.tombstones) !== null);
}

/**
 * The chip as the page is shown it now: with Undo only while the commit's revision is still the
 * world's newest (`head`, read for a chat that holds such a chip) and this chat has played no later
 * turn; else with the line that says how to change it now. Open in Build either way.
 */
export function worldMadeShown(chip: Chip, payload: JsonObject, now: { head: RevisionId | null | undefined; core: LedgerCore; chain: readonly ChainMessage[] }): Chip {
  const made = worldMadeOf(payload);
  if (made !== null && now.head === made.to && !playedOn(now.core, now.chain, chip.messageId, made.turn)) return chip;
  return { ...chip, detail: chip.detail === undefined ? MOVED_ON : `${chip.detail}\n${MOVED_ON}`, actions: chip.actions.filter((a) => a.id !== UNDO.id) };
}

let undos = 0;

/**
 * Undo of a commit a turn made (the user's own act, `lre.chip`): the world goes back to the revision
 * before it, and this chat is brought back to it, by the means Build has: that revision put back
 * into the draft and committed, then an Upgrade. Whole or not at all: what could stop it is asked
 * first, and where a later step fails the earlier ones are taken back. Refused, with why in plain
 * words, once the commit's revision isn't the world's newest, once this chat played on, while a
 * turn is under way or an earlier message waits on Keep or Discard, and while the draft holds edits
 * of the user's own, which putting the revision back would replace.
 */
export async function undoWorldMade(rt: Runtime, who: { chatId: ChatId; userId: UserId }, chip: StoredChip): Promise<{ pending: boolean } | { refused: string }> {
  const { chatId, userId } = who;
  const made = worldMadeOf(chip.payload);
  const run = await rt.runOf(chatId, userId);
  if (!made || run?.worldId !== made.worldId) return { refused: "This chat no longer plays the world this change was made in." };
  const index = await rt.worlds.index(made.worldId, userId);
  if (!index?.revisions.includes(made.from)) return { refused: "The world's revision from before this change is gone, so it can't be put back." };
  if (index.head !== made.to) return { refused: `The world has a newer revision since this change, which Undo would throw away. ${CHANGE_NOW}` };
  const core = await rt.ledger.core(chatId, userId);
  if (!core) return { refused: "This chat's world isn't loaded." };
  if (core.journal.pauses.length > 0) return { refused: "An earlier message was edited: choose Keep or Discard first." };
  if (rt.ledger.queuedOn(chatId) !== null || playedOn(core, core.chain(toChain(await rt.host.chats.messages(chatId, userId))), chip.messageId, made.turn)) return { refused: `This chat has played on since this change, so Undo would leave a turn played on a world that is gone. ${CHANGE_NOW}` };
  const port = await worldBuild(rt, chatId, userId);
  if (!port) return { refused: "This chat no longer plays the world this change was made in." };
  const notice = draftNotice(rt, userId);
  try {
    const draft = await port.edit({ op: "get" });
    if (draft.stored && changesBetween(await port.revision(made.to), draft.draft).length > 0) return { refused: "The world's draft in Build holds edits of yours that aren't committed, and Undo would replace them. Commit or discard them in Build first." };
    // The revision from before the commit, put back into the draft and committed: the world's newest again.
    const restored = await port.edit({ op: "restore", revision: made.from, version: draft.version });
    let back: RevisionId;
    try {
      back = (await rt.worlds.commit(made.worldId, null, userId, { source: "build", note: "Undone from the chat: the world as it was before the author's change", version: restored.version }, notice)).revision;
    } catch (error) {
      // Nothing was committed: the draft goes back to none, as it was, unless someone wrote to it since.
      await port.edit({ op: "discard", version: restored.version }).catch(() => undefined);
      throw error;
    }
    await syncWorldBook(rt, made.worldId, userId);
    const playing = core.renderState(toChain(await rt.host.chats.messages(chatId, userId)))?.state.revision ?? null;
    if (playing === back) return { pending: false };
    const body = validMarkerBody({ kind: "migrate", to: back });
    const moved = body ? await rt.ledger.write(chatId, userId, { kind: "marker", id: `u${Date.now().toString(36)}${(++undos).toString(36)}`, target: "head", body }, { answerQueued: true }) : null;
    if (moved && (moved.applied || moved.pending)) {
      rt.push.changed(chatId, userId);
      return { pending: moved.pending };
    }
    // The chat couldn't be brought back: the world is put back as the commit left it, so nothing of the Undo stands.
    const again = await port.edit({ op: "restore", revision: made.to });
    await rt.worlds.commit(made.worldId, null, userId, { source: "build", note: "Undo taken back: this chat couldn't be brought to the earlier revision", version: again.version }, notice);
    await syncWorldBook(rt, made.worldId, userId);
    return { refused: `This chat couldn't be brought back to the earlier revision${moved?.reason !== undefined ? ` (${moved.reason})` : ""}, so nothing was undone.` };
  } catch (error) {
    if (!(error instanceof WorldError)) throw error;
    return { refused: `The world's document refused it (${error.message}), so nothing was undone.` };
  }
}
