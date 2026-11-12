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
// (`worldMadeChip`): each commit of the turn, in the lines its card would have listed, with Open in
// Build, which the page opens by itself. A harness turn is undone whole (`undoTurn`), the user's
// own act on the latest reply through `lre.chip`: never an agent's, and never one change at a time.

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

/** Open in Build, which the page opens and sends nothing for. */
export const OPEN_IN_BUILD: ChipAction = { id: "build", label: "Open in Build" };

/** One commit a turn made, as its reply's chip keeps it: the world's newest revision before it and the one it made, and the harness turn that made it. */
export interface WorldMade {
  worldId: WorldId;
  from: RevisionId;
  to: RevisionId;
  turn: string;
}

/**
 * The reply's chip for one commit its turn made, marked as made: the revision it is now, whether this
 * chat plays it from the next turn (`plays`: the turn also brought the chat to it), and what it
 * changed, in the lines its review card would have listed (`changes`). The document is the world's,
 * not this chat's: undoing the turn leaves it, and the chip says so. Kept until the reply goes.
 */
export function worldMadeChip(made: WorldMade, at: { id: string; messageId: MessageId; swipeId: number }, said: { note: string | null; changes: readonly string[]; plays: boolean }): StoredChip {
  const what = `The author made this the world's newest revision${said.note !== null ? ` (${said.note})` : ""}.`;
  const when = said.plays ? "This chat plays it from the next turn." : "This chat plays it once you upgrade it, in GM → This chat → Pins and upgrade.";
  return { id: at.id, kind: WORLD_MADE, messageId: at.messageId, swipeId: at.swipeId, label: "Changed the world's document", detail: [`${what} ${when} ${KEPT_ON_UNDO}`, ...said.changes].join("\n"), actions: [OPEN_IN_BUILD], expires: "never", payload: { worldId: made.worldId, from: made.from, to: made.to, turn: made.turn } };
}

/** What a commit's chip says of undoing its turn. */
const KEPT_ON_UNDO = "Undoing this turn leaves the world's document as it is: to change it, edit the world in Build, or ask the author in your next message.";

// ---------------------------------------------------------------- the whole turn undone

/** The kind of a harness reply's footer (`backend/view.ts`): one line of what its turn did, with Undo on the latest reply. */
export const TURN_FOOTER = "turn";

/** Why a whole turn can't be undone now, in plain words. */
const UNDO_REFUSED = {
  busy: "A turn is under way. Wait for its reply to finish, then undo.",
  paused: "An earlier message was edited: choose Keep or Discard first.",
  latest: "Only the latest reply's turn can be undone.",
  shown: "That swipe isn't the one shown any more.",
  unplayed: "No turn was played for this reply, so there is nothing of it to undo. Delete the reply in Lumiverse to take it away.",
  unloaded: "This chat's world isn't loaded.",
} as const;

/**
 * Undo of a whole harness turn (DEPTH2-PLAN §2), the user's own act on the latest reply (its
 * footer's Undo, `lre.chip`): the reply goes, with everything its turn wrote. What a turn writes
 * lives on its reply's record (its state, its story record, the writes of its jobs) or follows the
 * chat's path (the turn's jobs in LumiAH, its files), so it goes as it goes for a reply deleted by
 * hand. Refused, with why in plain words, while a turn is under way or waits for its reply, while an
 * earlier message waits on Keep or Discard, for any reply but the latest as shown, and for a reply no
 * turn was played for. A commit of the world's document the turn made stays: that is the world's.
 */
export async function undoTurn(rt: Runtime, who: { chatId: ChatId; userId: UserId }, at: { messageId: MessageId; swipeId: number }): Promise<{ undone: true } | { refused: string }> {
  const { chatId, userId } = who;
  const core = await rt.ledger.core(chatId, userId);
  if (!core) return { refused: UNDO_REFUSED.unloaded };
  if (core.inFlight || rt.ledger.queuedOn(chatId) !== null) return { refused: UNDO_REFUSED.busy };
  if (core.journal.pauses.length > 0) return { refused: UNDO_REFUSED.paused };
  const chain = core.chain(toChain(await rt.host.chats.messages(chatId, userId)));
  const last = chain.at(-1);
  if (!last || last.isUser || last.id !== at.messageId) return { refused: UNDO_REFUSED.latest };
  if (last.swipeId !== at.swipeId) return { refused: UNDO_REFUSED.shown };
  const rec = activeRecord(last, core.journal.tombstones);
  if (!rec?.harness || rec.harness.turns.length === 0 || rec.harness.unplayed !== undefined) return { refused: UNDO_REFUSED.unplayed };
  await rt.host.chats.deleteMessage(chatId, at.messageId, userId);
  rt.push.changed(chatId, userId);
  return { undone: true };
}
