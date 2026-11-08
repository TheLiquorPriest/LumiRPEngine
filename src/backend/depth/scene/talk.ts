// Real-time dialogue at the chat's surface (DEPTH-PLAN §2.5, §7 Chips): the chip under the last
// reply, "Talking with Mira" with Leave while it runs, or the author's offer of it with Talk while
// Settings → Depth starts it only from the chip; the player's tap on it, which lands a `story.talk`
// as a basis-anchored layer entry at the chat's last message (§4.9), so it stays with the swipe it
// was made on (a reply being written aside: a tap during a generation lands before it, held through
// its turn, as every player action does, `headBasis`); the end of the talk he left, whose partner
// remembers it then (`talkLeft`); and the event the author's setup writes when it enters, offers or
// ends real time, with its line in the thinking block. A turn reads the talk through its basis
// (`foldAtBasisOf` with `STORY_TALK`, then `talkNow`), never on the swipe it replaces.

import type { ChatId, EntityId, MessageId, UserId } from "../../../shared/ids";
import type { Basis, LandResult, LayerDraft } from "../../../shared/layer";
import type { PackEvent } from "../../../shared/ledger";
import type { PromptTexts } from "../../../shared/prompts";
import { REALTIME_TEXT } from "../../../shared/realtime-prompts";
import type { Chip } from "../../../shared/state-view";
import { STORY_TALK, talkEvent, talkNow, type Talk, type TalkNow } from "../../../shared/talk";
import type { ChainMessage } from "../../../engine/ledger/chain";
import type { LedgerCore } from "../../../engine/ledger/journal";
import { layerEntryId } from "../../../engine/ledger/layer";
import type { LiveEvent } from "../../../engine/ledger/story";
import { own } from "../../../engine/pack-kit";
import { headBasis } from "../../character-engine";
import { eventsOf } from "../../ledger-io";
import type { HostPort } from "../../host";
import { renderPrompt } from "../../prompts";
import type { ModelPort } from "../port";
import { afterDepthReply, type AfterOut, type AfterRt } from "./after";
import type { TurnSink } from "./contract";

/** The chip's kind, and its id's head: `talk:<the reply it shows under>:<that reply's swipe>`. */
export const TALK_CHIP_KIND = "talk";

/** The chip's buttons: Leave while real time runs, Talk on the author's offer. */
export const TALK_CHOICES = { leave: "leave", talk: "talk" } as const;
export type TalkChoice = (typeof TALK_CHOICES)[keyof typeof TALK_CHOICES];

/** Whether `choice` is one of the chip's buttons. */
export function isTalkChoice(choice: string): choice is TalkChoice {
  return choice === TALK_CHOICES.leave || choice === TALK_CHOICES.talk;
}

/** The chat's last reply on its active chain: what the chip shows under, and where an offer stands. */
function lastReplyOf(chain: readonly ChainMessage[]): ChainMessage | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (m !== undefined && !m.isUser) return m;
  }
  return null;
}

/**
 * Real-time dialogue's chip under the chat's last reply, in the user's words (Settings → Prompts →
 * Depth → Real-time dialogue): whom the player is talking with, with Leave; or the author's offer,
 * with its reason and Talk. Null when neither stands. From `live`, the chain's live events with its
 * `story.talk` among them (others passed over), when the caller read them already: the view reads
 * them with the asks' in one walk. Queue-free: for the view, which holds the chat's core; it folds
 * the chain only when a talk stands, for the name it shows.
 */
export function talkChipOn(core: LedgerCore, observed: readonly ChainMessage[], texts: PromptTexts, live?: readonly LiveEvent[]): Chip | null {
  const chain = core.chain(observed);
  const last = lastReplyOf(chain);
  if (last === null) return null;
  const talk = talkNow(live ?? eventsOf(core, observed, [STORY_TALK]), last.id);
  if (talk === null) return null;
  const name = own(core.fold(observed).state.entities, talk.with)?.name ?? talk.with;
  return talkChip(talk, { id: last.id, swipeId: last.swipeId }, name, texts);
}

/** The chip for a talk that stands under the last reply (`talkChipOn`, with the talk read and named). */
export function talkChip(talk: TalkNow, last: { id: MessageId; swipeId: number }, name: string, texts: PromptTexts): Chip {
  const text = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, texts, vars).trim();
  const base = { id: `${TALK_CHIP_KIND}:${last.id}:${last.swipeId}`, kind: TALK_CHIP_KIND, messageId: last.id, swipeId: last.swipeId, expires: "never" } as const;
  if (talk.state === "on") return { ...base, label: text(REALTIME_TEXT.chipOn, { name }), detail: text(REALTIME_TEXT.chipOnDetail, { name }), actions: [{ id: TALK_CHOICES.leave, label: text(REALTIME_TEXT.chipLeave) }] };
  const why = talk.why !== undefined ? text(REALTIME_TEXT.chipOfferDetail, { why: talk.why }) : "";
  return { ...base, label: text(REALTIME_TEXT.chipOffer, { name }), ...(why !== "" ? { detail: why } : {}), actions: [{ id: TALK_CHOICES.talk, label: text(REALTIME_TEXT.chipTalk), style: "primary" }] };
}

/** What a tap on the chip needs of the runtime (`Runtime` is one). */
export interface TalkRt {
  readonly host: Pick<HostPort, "chats">;
  readonly ledger: {
    readEvents(chatId: ChatId, userId: UserId, types: readonly string[], upTo?: MessageId): Promise<LiveEvent[]>;
    landLayer(chatId: ChatId, userId: UserId, draft: LayerDraft): Promise<LandResult>;
    with(chatId: ChatId, userId: UserId, op: (core: LedgerCore, observed: ChainMessage[]) => void | Promise<void>): Promise<void>;
  };
}

/** A talk the player left, as its end reads it: whom with, the scene it ran in, the message the Leave landed at, and the Leave's own entry. */
export interface TalkLeft {
  with: EntityId;
  scene?: string;
  basis: Basis;
  entry: string;
}

/** How a tap went: landed now, held behind a reply in flight (it lands when that closes), or lapsed with the reason the player reads. A Leave that landed now names the talk it ended (`left`), for its end (`talkLeft`). */
export type TalkTap = { applied: true; pending: boolean; left?: TalkLeft } | { lapsed: string };

/**
 * The player's tap on the chip (`talk:<reply>:<swipe>`): Leave ends real time, Talk takes the
 * author's offer, each as a `story.talk` decided by the player, landed as a layer entry at the
 * chat's last message (a reply being written aside, `headBasis`), so the next line plays as he chose.
 * A chip whose reply is no longer the last one, or whose talk has moved on, has lapsed and changes
 * nothing.
 */
export async function talkTap(rt: TalkRt, chatId: ChatId, userId: UserId, chipId: string, choice: TalkChoice): Promise<TalkTap> {
  const [, messageId] = chipId.split(":");
  const messages = await rt.host.chats.messages(chatId, userId);
  const last = [...messages].reverse().find((m) => !m.isUser);
  if (!last || last.id !== messageId) return { lapsed: "the chip has lapsed: a later reply came" };
  const live = await rt.ledger.readEvents(chatId, userId, [STORY_TALK]);
  const talk = talkNow(live, last.id);
  const wanted = choice === TALK_CHOICES.leave ? "on" : "offer";
  if (talk === null || talk.state !== wanted) return { lapsed: "the chip has lapsed: real-time dialogue has moved on" };
  const basis = await headBasis(rt, chatId, userId);
  if (basis === null) return { lapsed: "the chat has no messages" };
  const t: Talk = { with: talk.with, state: choice === TALK_CHOICES.leave ? "off" : "on", by: "player", ...(talk.scene !== undefined ? { scene: talk.scene } : {}) };
  // One tap per state of the talk at this message: a double tap lands once, a later tap afresh.
  const id = layerEntryId(STORY_TALK, t.state, t.with, basis.message, basis.swipe, String(live.length));
  const r = await rt.ledger.landLayer(chatId, userId, { id, basis, kind: STORY_TALK, events: [talkEvent(t)], by: { role: "player" } });
  if (r.status === "refused") return { lapsed: `LumiRPEngine couldn't keep this: ${r.reason}` };
  const left = t.state === "off" && r.status === "landed" && r.existing !== true;
  return { applied: true, pending: r.status === "held", ...(left ? { left: { with: t.with, ...(t.scene !== undefined ? { scene: t.scene } : {}), basis, entry: id } } : {}) };
}

/**
 * The end of a talk the player left (§2.5; §4.4: a character remembers when a scene ends for it), at
 * the message the Leave landed at: the step after a reply runs for it (`afterDepthReply`, its entries
 * named by the Leave's), so whoever holds takes there remembers, the talk's partner among them, and
 * the GM links what they now believe. The conversation's end is where a poll its lines deferred runs
 * (PLAN:180), so the author's poll runs there too, reading everything since it last looked. A Leave
 * held behind a reply in flight needs none: that reply's own step finds the talk ended. Never throws.
 */
export function talkLeft(rt: AfterRt, chatId: ChatId, userId: UserId, left: TalkLeft, o: { model?: ModelPort } = {}): Promise<AfterOut> {
  return afterDepthReply(rt, chatId, userId, left.basis, { scene: left.scene ?? null, ended: false, remember: [left.with], poll: true, beats: [] }, { ...o, occasion: left.entry });
}

/**
 * The `story.talk` the author's setup writes when it enters, offers or ends real time (§2.5), and
 * its line in the thinking block ("the thinking block says so"): a paragraph when Settings → Depth
 * shows the whole thinking (D-5), else a progress line. An offer is the chip's to say.
 */
export function talkWritten(t: Talk, o: { name: string; texts: PromptTexts; sink: Pick<TurnSink, "progress" | "reasoning">; thinking: "whole" | "progress" }): PackEvent {
  const why = t.why?.trim() ?? "";
  const line = t.state === "on" ? renderPrompt(REALTIME_TEXT.lineEntered, o.texts, { name: o.name, why }) : t.state === "off" ? renderPrompt(REALTIME_TEXT.lineEnded, o.texts, { name: o.name, why }) : "";
  if (line.trim() !== "") {
    if (o.thinking === "whole") o.sink.reasoning(`\n\n${line.trim()}\n\n`);
    else o.sink.progress(line.trim());
  }
  return talkEvent(t);
}
