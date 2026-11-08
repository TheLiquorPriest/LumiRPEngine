// "Ask me" (DEPTH-PLAN §6.5, §7 Chips; D-7): an episode the poll opened that wants a treatment this
// story interval's allowance has spent, on a part the author judged major, is held for the player
// rather than slid down the ladder. The ask is an `author.ask` entry at the poll's basis; while it is
// live and unanswered on the chain, a chip under that reply asks "Dale's sale of the boat wants a
// live treatment; this story week's 2 are spent. Spend one more?" with Spend one more and Keep to
// the allowance. The player's tap lands his `author.answer` beside it, and the episode is drafted
// (`offscreen/jobs.ts`'s `draftAnswered`): at the treatments the author wanted, or down the ladder.
// His tap is his own decision, so it runs whatever the ceilings, which bind the author's own work.
// A swipe of the reply takes the ask, its answer and its draft along; nothing lapses while the ask
// stands, and the poll is told of it so it never opens the episode twice.

import { AUTHOR_ANSWER, AUTHOR_ASK, answerEvent, authorData, type AnswerData, type AskData } from "../../../shared/author";
import { DEPTH_TREATMENT_LABEL } from "../../../shared/depth-settings";
import type { ChatId, EntityId, MessageId, UserId } from "../../../shared/ids";
import type { Basis, LandResult, LayerDraft } from "../../../shared/layer";
import type { Chip } from "../../../shared/state-view";
import type { StoryContainer } from "../../../shared/story";
import type { ChainMessage } from "../../../engine/ledger/chain";
import type { LedgerCore } from "../../../engine/ledger/journal";
import { layerEntryId } from "../../../engine/ledger/layer";
import type { LiveEvent } from "../../../engine/ledger/story";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import { eventsOf } from "../../ledger-io";

/** The event types a reader of asks asks a chain for. */
export const ASK_TYPES: readonly string[] = [AUTHOR_ASK, AUTHOR_ANSWER];

/** The chip's kind, and its id's head: `allowance:<the reply the ask stands at>:<its swipe>:<the ask's id>`. */
export const ASK_CHIP_KIND = "allowance";

/** The chip's buttons: spend past the allowance, or keep to it (the episode drafted down the ladder). */
export const ASK_CHOICES = { spend: "spend", keep: "keep" } as const;
export type AskChoice = (typeof ASK_CHOICES)[keyof typeof ASK_CHOICES];

export function isAskChoice(choice: string): choice is AskChoice {
  return choice === ASK_CHOICES.spend || choice === ASK_CHOICES.keep;
}

/** One live ask on a chain: where it rides, and the player's answer there, if any. */
export interface AskOn {
  ask: AskData;
  from: StoryContainer;
  answer: AnswerData | null;
}

/** Each live ask on a chain, in fold order, with its answer there (the first of each wins). */
export function asksOn(events: readonly LiveEvent[]): AskOn[] {
  const asks = new Map<string, { ask: AskData; from: StoryContainer }>();
  const answers = new Map<string, AnswerData>();
  for (const e of events) {
    const a = authorData<AskData>(e.event, AUTHOR_ASK);
    if (a && !asks.has(a.id)) asks.set(a.id, { ask: a, from: e.from });
    const r = authorData<AnswerData>(e.event, AUTHOR_ANSWER);
    if (r && !answers.has(r.ask)) answers.set(r.ask, r);
  }
  return [...asks.values()].map(({ ask, from }) => ({ ask, from, answer: answers.get(ask.id) ?? null }));
}

/** The asks on a chain still waiting on the player. */
export function openAsks(events: readonly LiveEvent[]): AskOn[] {
  return asksOn(events).filter((a) => a.answer === null);
}

/** A part as the ask names it: "Dale's part", or the event in words. */
function subjectWords(part: AskData["parts"][number], name: (id: EntityId) => string): string {
  if ("who" in part.subject) return `${name(part.subject.who)}'s part`;
  const e = part.subject.event.trim();
  return e.charAt(0).toUpperCase() + e.slice(1);
}

/** The ask in the player's words: what wants more than the allowance leaves (`what`), that with the question (`label`), the reasons, and the spend button's words. */
export function askWords(ask: AskData, name: (id: EntityId) => string): { what: string; label: string; detail: string; spend: string } {
  const over = ask.over.flatMap((o) => {
    const part = ask.parts[o.part];
    return part ? [{ part, allowance: o.allowance, spent: o.spent }] : [];
  });
  const first = over[0];
  const more = over.length;
  const spend = more === 1 ? "Spend one more" : `Spend ${more} more`;
  const what =
    more === 1 && first
      ? `${subjectWords(first.part, name)} wants a ${DEPTH_TREATMENT_LABEL[first.part.treatment].toLowerCase()} treatment; this story ${ask.interval}'s ${first.allowance === 0 ? "allowance is none" : `${first.allowance} ${first.allowance === 1 ? "is" : "are"} spent`}.`
      : `${over.map((o) => `${subjectWords(o.part, name)} (${DEPTH_TREATMENT_LABEL[o.part.treatment].toLowerCase()})`).join(", ")} want more than this story ${ask.interval}'s allowances leave.`;
  const reasons = over.map((o) => `${subjectWords(o.part, name)}: ${o.part.rationale.trim() || "no reason given"}`);
  const detail = [ask.why.trim(), ...reasons, "Keep to the allowance drafts it a step down the ladder."].filter((s) => s !== "").join(" · ");
  return { what, label: `${what} ${spend}?`, detail, spend };
}

/** An open ask as the poll reads it, so it opens the episode no second time. */
export function askLine(ask: AskData, name: (id: EntityId) => string): string {
  return `${askWords(ask, name).what} (with ${ask.people.map(name).join(", ") || "no one named"}: ${ask.why.trim() || "no reason given"})`;
}

/**
 * The chips of the asks waiting on the player, each under the reply its ask stands at, on the swipe
 * shown there. From `live`, the chain's live events with its asks and answers among them (others
 * passed over), when the caller read them already: the view reads them with real-time dialogue's
 * in one walk. Queue-free: for the view, which holds the chat's core.
 */
export function askChipsOn(core: LedgerCore, observed: readonly ChainMessage[], live?: readonly LiveEvent[]): Chip[] {
  const open = openAsks(live ?? eventsOf(core, observed, ASK_TYPES));
  if (open.length === 0) return [];
  const chain = core.chain(observed);
  const state: Readonly<WorldState> = core.fold(observed).state;
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const out: Chip[] = [];
  for (const { ask, from } of open) {
    const message = chain.find((m) => m.id === from.messageId);
    if (!message) continue;
    const words = askWords(ask, name);
    out.push({
      id: `${ASK_CHIP_KIND}:${message.id}:${message.swipeId}:${ask.id}`,
      kind: ASK_CHIP_KIND,
      messageId: message.id,
      swipeId: message.swipeId,
      label: words.label,
      detail: words.detail,
      actions: [
        { id: ASK_CHOICES.spend, label: words.spend, style: "primary" },
        { id: ASK_CHOICES.keep, label: "Keep to the allowance" },
      ],
      expires: "never",
    });
  }
  return out;
}

/** What a tap on the chip needs of the runtime (`Runtime` is one). */
export interface AskRt {
  readonly ledger: {
    readEvents(chatId: ChatId, userId: UserId, types: readonly string[], upTo?: MessageId): Promise<LiveEvent[]>;
    basisFor(chatId: ChatId, userId: UserId, messageId?: MessageId): Promise<Basis | null>;
    landLayer(chatId: ChatId, userId: UserId, draft: LayerDraft): Promise<LandResult>;
  };
}

/** How a tap went: the answer landed (or waits behind a reply in flight), with the ask and its basis for the drafting; or lapsed, with the reason the player reads. */
export type AskTap = { applied: true; pending: boolean; ask: AskData; basis: Basis; spend: boolean } | { lapsed: string };

/**
 * The player's tap on the chip (`allowance:<reply>:<swipe>:<ask>`): his `author.answer`, landed at
 * the ask's basis beside it. An ask no longer live on the chain, or answered, has lapsed.
 */
export async function askAnswer(rt: AskRt, chatId: ChatId, userId: UserId, chipId: string, choice: AskChoice): Promise<AskTap> {
  const [, messageId = "", , askId = ""] = chipId.split(":");
  const found = asksOn(await rt.ledger.readEvents(chatId, userId, ASK_TYPES)).find((a) => a.ask.id === askId && a.from.messageId === messageId);
  if (!found) return { lapsed: "the chip has lapsed: its reply is no longer on the chat's chain" };
  if (found.answer) return { lapsed: "the chip has lapsed: it was answered" };
  const basis = await rt.ledger.basisFor(chatId, userId, messageId);
  if (!basis) return { lapsed: "the chip has lapsed: its reply is no longer on the chat's chain" };
  const spend = choice === ASK_CHOICES.spend;
  const r = await rt.ledger.landLayer(chatId, userId, { id: layerEntryId(AUTHOR_ANSWER, chatId, askId, basis.message, basis.swipe), basis, kind: AUTHOR_ANSWER, events: [answerEvent({ ask: askId, spend })], by: { role: "player" } });
  if (r.status === "refused") return { lapsed: `LumiRPEngine couldn't keep this: ${r.reason}` };
  return { applied: true, pending: r.status === "held", ask: found.ask, basis, spend };
}
