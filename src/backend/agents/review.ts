// An agent turn's review card (INC2-SPEC C13; AGENT-LOOP-PLAN §6, §7.6): one card per turn, made
// once the turn has committed, listing in plain words every change of the turn that asks first (its
// change type's mode is Confirm, Settings → Changes from the reply): the operations its roles staged
// and the reply's read's own confirm proposals, each with its key, its role and its change type.
//
// The card is a stored chip of its own kind (`review`), so it is kept with the chat's chips, shows on
// the turn's swipe, and lapses at the next send as confirm chips do; its items live in the chip's
// payload, which never reaches a page. It is a player surface: every item is worded as the player
// character may read it, whatever knowledge the role that staged it read with. `lre.review` reads and
// answers it, and every change to one is pushed as `lre.review.update`.
//
// Where a turn's operations that ask first wait (Settings → Agents → Review card, `review.placement`):
// - `chips` (the default): the turn goes on, and the narrator isn't told until a change is applied.
//   Apply lands each operation on the head through the outside writer, held while a turn runs, with
//   an Undo chip; a read proposal is applied as its confirm chip applies it.
// - `gate`: the turn waits after its plan, like the outline gate. Apply or No answers the card and
//   the turn resumes: the plan it held replays, the operations let through are re-validated against it
//   and land after it, and no agent is called again.
//
// Learning is per source (AGENT-LOOP-PLAN §6): each operation's outcome counts for its role on its
// connection (`recordOutcome(..., role)`), as Apply, No or an Undo of an applied one; a read
// proposal's counts as the read's, as its confirm chip's always has.

import type { AgentKnowledge } from "../../shared/agent-tools";
import type { ChatId, ChipId, MessageId, UserId } from "../../shared/ids";
import { isRecord, type JsonObject } from "../../shared/json";
import { type GenerateAs, PROTOCOL_VERSION, type ReviewCardView, type ReviewItemView } from "../../shared/protocol";
import { CHANGE_TYPES } from "../../shared/settings";
import { activeRecord } from "../../engine/ledger/path";
import type { StoredChip } from "../chips";
import type { LandedWrites, Runtime } from "../runtime";
import { recordOutcome } from "../settings-store";
import { fixChip } from "../view";
import { outsideReader } from "./tools/read-view";
import { type AgentOp, batchKey, outsideWriter } from "./tools/writer";

/** The review card's chip kind and id prefix. */
export const REVIEW_KIND = "review";

/** What a player reads of a change that no longer applies when a card applies it, whatever the role knew. */
const NO_LONGER = "It no longer applies.";

/** One item of a card as kept in its chip's payload. */
export interface StoredReviewItem {
  key: string;
  source: "agent" | "read";
  /** The role that staged it, or `read` for the reply's read. */
  role: string;
  changeType: string;
  /** The change in plain words, as the player character may read it. */
  lines: string[];
  status: "open" | "approved" | "applied" | "rejected" | "refused";
  refused?: { code: string; reason: string };
  /** An applied operation's Undo chip; a read proposal's confirm chip. */
  chipId?: string;
  /** Applied while a turn ran: its write's batch, by which its Undo chip is named once it lands. */
  batch?: string;
  undone?: true;
  /** An operation's own: what it asks, who staged it, with whose knowledge, and the connection its change type's learning is keyed by. */
  op?: AgentOp;
  agentId?: string;
  knowledge?: AgentKnowledge;
  connection?: string | null;
}

/** A card's payload: where its turn's changes wait, the turn's words (a gate's, which its resume replays), and its items. */
interface CardPayload {
  turn: string;
  placement: "chips" | "gate";
  text: string;
  items: StoredReviewItem[];
}

function itemOf(raw: unknown): StoredReviewItem | null {
  if (!isRecord(raw) || typeof raw.key !== "string" || (raw.source !== "agent" && raw.source !== "read") || typeof raw.role !== "string" || typeof raw.changeType !== "string" || !Array.isArray(raw.lines)) return null;
  if (raw.status !== "open" && raw.status !== "approved" && raw.status !== "applied" && raw.status !== "rejected" && raw.status !== "refused") return null;
  return raw as unknown as StoredReviewItem;
}

function payloadOf(chip: StoredChip): CardPayload | null {
  const p = chip.payload;
  if (chip.kind !== REVIEW_KIND || typeof p.turn !== "string" || (p.placement !== "chips" && p.placement !== "gate") || typeof p.text !== "string" || !Array.isArray(p.items)) return null;
  return { turn: p.turn, placement: p.placement, text: p.text, items: p.items.flatMap((raw) => itemOf(raw) ?? []) };
}

/** The card's id for a turn: its reply swipe's (`<message>:<swipe>`), or a gate's (`<message>:gate`). */
export function reviewChipId(turn: string): ChipId {
  return `${REVIEW_KIND}:${turn}`;
}

/** What `lre.review` answers with for one card: its items without what only the backend reads. */
function viewOf(chip: StoredChip, card: CardPayload): ReviewCardView {
  const items = card.items.map(({ key, source, role, changeType, lines, status, refused, chipId, undone }): ReviewItemView => ({ key, source, role, changeType, lines: [...lines], status, ...(refused ? { refused } : {}), ...(chipId !== undefined && source === "agent" ? { undo: chipId } : {}), ...(undone ? { undone } : {}) }));
  return { turn: card.turn, messageId: chip.messageId, ...(chip.swipeId !== undefined ? { swipeId: chip.swipeId } : {}), placement: card.placement, items, ...(chip.as ? { resume: chip.as } : {}) };
}

/** What an answer did: the card after it, and, at a gate, how the turn resumes (a page starts it as the stopped generation started). */
export interface ReviewAnswer {
  card: ReviewCardView;
  start: GenerateAs | null;
}

export class Review {
  /**
   * Applies or turns down a read proposal's confirm chip as its own Apply and No do (`lre.chip`), its
   * learning the read's: the dispatcher sets it, since the chip's action lives there.
   */
  readChip: ((chatId: ChatId, userId: UserId, chipId: ChipId, choice: "confirm" | "reject") => Promise<void>) | null = null;
  /** The sessions that asked about each chat's cards, by `user \0 chat`. */
  private readonly watchers = new Map<string, Set<string>>();

  constructor(private readonly rt: Runtime) {}

  start(): void {
    // An operation applied while a turn ran is named its write's Undo chip once that write lands.
    this.rt.onWritesLanded((input) => this.landed(input));
  }

  /** The chat's cards, oldest first; `session` hears their changes from now on, among the chats Settings → Agents → Budgets keeps the user watching (another user's are theirs to bound). */
  async cards(chatId: ChatId, userId: UserId, session?: string): Promise<ReviewCardView[]> {
    if (session !== undefined) {
      const key = `${userId}\u0000${chatId}`;
      const sessions = this.watchers.get(key) ?? new Set<string>();
      sessions.add(session);
      this.watchers.delete(key);
      this.watchers.set(key, sessions);
      const kept = (await this.rt.settings.get(userId)).agents.kept.watchers;
      const own = [...this.watchers.keys()].filter((k) => k.startsWith(`${userId}\u0000`));
      for (const k of own.slice(0, Math.max(0, own.length - kept))) this.watchers.delete(k);
    }
    return (await this.rt.chips.list(chatId, userId)).flatMap((chip) => {
      const card = payloadOf(chip);
      return card ? [viewOf(chip, card)] : [];
    });
  }

  /**
   * Makes a turn's card, or adds to it: one card per turn, each item once by key. Nothing to answer,
   * no card. A gate's card waits on the player's message the turn answers, with how the turn resumes
   * (`as`); a chips card sits on the turn's reply swipe.
   */
  async make(input: { chatId: ChatId; userId: UserId; turn: string; messageId: MessageId; swipeId?: number; placement: "chips" | "gate"; text: string; items: StoredReviewItem[]; as?: GenerateAs }): Promise<void> {
    if (input.items.length === 0) return;
    const id = reviewChipId(input.turn);
    const known = (await this.rt.chips.list(input.chatId, input.userId)).find((c) => c.id === id);
    const before = known ? (payloadOf(known)?.items ?? []) : [];
    const items = [...before, ...input.items.filter((i) => !before.some((b) => b.key === i.key))];
    const chip: StoredChip = {
      id,
      kind: REVIEW_KIND,
      messageId: input.messageId,
      ...(input.swipeId !== undefined ? { swipeId: input.swipeId } : {}),
      label: "",
      actions: [
        { id: "apply", label: "Apply all", style: "primary" },
        { id: "reject", label: "No" },
      ],
      ...(input.as ? { as: input.as } : {}),
      expires: "next_send",
      payload: {},
    };
    await this.save(input.chatId, input.userId, chip, { turn: input.turn, placement: input.placement, text: input.text, items });
  }

  /** What a gate's card let through for the turn of `text`, for its resume to commit after the plan it held; null when no gate holds that turn. */
  async gated(chatId: ChatId, userId: UserId, text: string): Promise<{ turn: string; approved: StoredReviewItem[]; open: boolean } | null> {
    for (const chip of await this.rt.chips.list(chatId, userId)) {
      const card = payloadOf(chip);
      if (!card || card.placement !== "gate" || card.text !== text) continue;
      return { turn: card.turn, approved: card.items.filter((i) => i.status === "approved" && i.source === "agent"), open: card.items.some((i) => i.status === "open") };
    }
    return null;
  }

  /** The turn's card goes, answered or not: its turn was cancelled or failed, so nothing on it stands. */
  async drop(chatId: ChatId, userId: UserId, turn: string): Promise<void> {
    const id = reviewChipId(turn);
    await this.rt.chips.removeWhere(chatId, userId, (c) => c.id === id);
    this.push(chatId, userId);
  }

  /** Every gate card of the chat goes: the turn it held was taken by its reply, or cancelled. */
  async dropGates(chatId: ChatId, userId: UserId): Promise<void> {
    await this.rt.chips.removeWhere(chatId, userId, (c) => c.kind === REVIEW_KIND && payloadOf(c)?.placement === "gate");
    this.push(chatId, userId);
  }

  /** Whether a gate card of the chat stands: its turn waits on it, or goes on from it, until the reply takes the turn. */
  async gateOpen(chatId: ChatId, userId: UserId): Promise<boolean> {
    return (await this.rt.chips.list(chatId, userId)).some((c) => payloadOf(c)?.placement === "gate");
  }

  /**
   * Apply (C13): every open item, or the ones `keys` picks. Under `chips` each operation lands on the
   * head through the outside writer, held while a turn runs, as one GM edit with its Undo chip, and
   * each read proposal applies as its confirm chip applies it. At a gate the picked operations are
   * let through for the turn's resume, the rest turned down, and the turn resumes. Each outcome
   * counts toward its source's learning.
   */
  async apply(chatId: ChatId, userId: UserId, turn: string, keys?: readonly string[]): Promise<ReviewAnswer> {
    const { chip, card } = await this.open(chatId, userId, turn);
    const open = card.items.filter((i) => i.status === "open");
    if (keys !== undefined && keys.some((k) => !open.some((i) => i.key === k))) throw new ReviewError("bad_request", "Pick changes the card holds that still wait for an answer.");
    const picked = keys === undefined ? open : open.filter((i) => keys.includes(i.key));
    if (picked.length === 0) throw new ReviewError("bad_request", "Pick at least one change to apply.");
    if (card.placement === "gate") {
      for (const item of open) item.status = picked.includes(item) ? "approved" : "rejected";
      await this.learn(userId, open.map((item) => ({ item, outcome: item.status === "approved" ? ("accepted" as const) : ("rejected" as const) })));
      return this.answered(chatId, userId, chip, card, true);
    }
    for (const item of picked) {
      if (item.source === "read") {
        if (item.chipId && this.readChip) await this.readChip(chatId, userId, item.chipId, "confirm");
        item.status = "applied";
      } else await this.land(chatId, userId, item);
    }
    // One held for a turn counts once it lands (`landed`).
    await this.learn(userId, picked.filter((i) => i.status === "applied" && i.batch === undefined).map((item) => ({ item, outcome: "accepted" as const })));
    return this.answered(chatId, userId, chip, card, false);
  }

  /** No (C13): every open item is turned down, each counted as rejected toward its source's learning; at a gate the turn resumes without them. */
  async reject(chatId: ChatId, userId: UserId, turn: string): Promise<ReviewAnswer> {
    const { chip, card } = await this.open(chatId, userId, turn);
    const open = card.items.filter((i) => i.status === "open");
    for (const item of open) {
      if (item.source === "read" && item.chipId && this.readChip) await this.readChip(chatId, userId, item.chipId, "reject");
      item.status = "rejected";
    }
    await this.learn(userId, open.map((item) => ({ item, outcome: "rejected" as const })));
    return this.answered(chatId, userId, chip, card, card.placement === "gate");
  }

  /** An applied operation's Undo, wherever it was pressed (its `fix:` chip): its item says so, and it counts as undone toward its role's learning. */
  async undone(chatId: ChatId, userId: UserId, undoChip: string): Promise<void> {
    for (const chip of await this.rt.chips.list(chatId, userId)) {
      const card = payloadOf(chip);
      const item = card?.items.find((i) => i.source === "agent" && i.status === "applied" && i.chipId === undoChip && i.undone !== true);
      if (!card || !item) continue;
      item.undone = true;
      await this.save(chatId, userId, chip, card);
      await this.learn(userId, [{ item, outcome: "undone" }]);
      return;
    }
  }

  /** The card for `turn` with something still to answer, or why not. */
  private async open(chatId: ChatId, userId: UserId, turn: string): Promise<{ chip: StoredChip; card: CardPayload }> {
    const chip = (await this.rt.chips.list(chatId, userId)).find((c) => c.id === reviewChipId(turn));
    const card = chip ? payloadOf(chip) : null;
    if (!chip || !card) throw new ReviewError("not_found", "There is no review card for that turn: it was answered, or it lapsed.");
    if (!card.items.some((i) => i.status === "open")) throw new ReviewError("bad_request", "Every change on that card has its answer already.");
    return { chip, card };
  }

  /** One operation landed on the head as one GM edit, held while a turn runs, through the writer the assistant's Apply uses, with the knowledge its role staged it with. */
  private async land(chatId: ChatId, userId: UserId, item: StoredReviewItem): Promise<void> {
    if (!item.op || !item.knowledge) {
      item.status = "refused";
      item.refused = { code: "bad_op", reason: NO_LONGER };
      return;
    }
    const base = { userId, chatId, knowledge: item.knowledge };
    const writer = outsideWriter(this.rt, { ...base, reader: outsideReader(this.rt, base), agent: { role: item.role, id: item.agentId ?? item.role }, signal: new AbortController().signal, connectionId: item.connection ?? null });
    const result = await writer.apply([item.op], `${item.role}: ${item.lines[0] ?? item.changeType}`);
    if (result.applied.includes(item.key)) {
      item.status = "applied";
      if (result.chipId !== null) item.chipId = result.chipId;
      if (result.pending) item.batch = batchKey(item.role, [item.op]);
      return;
    }
    // The writer's reason is worded for the role's knowledge; the card is the player's, so only one read as the player character is passed on.
    const no = result.refused[0];
    item.status = "refused";
    item.refused = { code: no?.code ?? "write_refused", reason: item.knowledge === "pov" && no ? no.reason : NO_LONGER };
  }

  /** Saves the card as answered; a gate's card says how its turn resumes, and its turn replays the plan the gate held. */
  private async answered(chatId: ChatId, userId: UserId, chip: StoredChip, card: CardPayload, resume: boolean): Promise<ReviewAnswer> {
    const saved = await this.save(chatId, userId, chip, card);
    if (resume) this.rt.bridgeOf(chatId)?.passReview(card.text);
    return { card: viewOf(saved, card), start: resume ? (chip.as ?? "regenerate") : null };
  }

  /** Stores the card with its label and actions as its items stand: one with nothing left to answer asks nothing more, and keeps its applied items' Undo. */
  private async save(chatId: ChatId, userId: UserId, chip: StoredChip, card: CardPayload): Promise<StoredChip> {
    const open = card.items.filter((i) => i.status === "open");
    const saved: StoredChip = { ...chip, label: open.length === 1 ? "1 change to review" : `${open.length} changes to review`, detail: open.flatMap((i) => i.lines).join("\n"), actions: open.length > 0 ? chip.actions : [], payload: card as unknown as JsonObject };
    await this.rt.chips.add(chatId, userId, [saved]);
    this.push(chatId, userId);
    return saved;
  }

  /**
   * Counts each operation's outcome toward its change type's learning, for its role on its connection
   * (AGENT-LOOP-PLAN §6: role × connection × type); a read proposal's counted where its chip is. A
   * failure is logged and never undoes the answer.
   */
  private async learn(userId: UserId, outcomes: readonly { item: StoredReviewItem; outcome: "accepted" | "rejected" | "undone" }[]): Promise<void> {
    const counted = outcomes.filter((o) => o.item.source === "agent");
    if (counted.length === 0) return;
    try {
      const settings = await this.rt.settings.get(userId);
      const learning = await this.rt.settings.learningOf(userId);
      const active = await this.rt.activeConnectionId(userId);
      const now = Date.now();
      for (const { item, outcome } of counted) {
        const type = CHANGE_TYPES.find((t) => t === item.changeType);
        if (type) recordOutcome(settings, learning, item.connection ?? active, type, outcome, now, item.role);
      }
      await this.rt.settings.saveLearning(userId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] an agent turn's reviewed changes weren't counted toward what its roles learn (${error instanceof Error ? error.message : String(error)})`, userId);
    }
  }

  /**
   * Writes that landed: an operation applied from a card while a turn ran is named its write's Undo
   * chip once that write lands (none when the turn had already made it so), and counts toward its
   * role's learning then; one the turn's close refused says so.
   */
  private landed(input: LandedWrites): void {
    const keys = new Set(input.writes.flatMap((w) => (w.kind === "post" && w.entry.agent ? [w.entry.agent.key] : [])));
    const refused = new Set(input.refused.flatMap((r) => (r.write.kind === "post" && r.write.entry.agent ? [r.write.entry.agent.key] : [])));
    if (keys.size === 0 && refused.size === 0) return;
    const head = input.core.chain(input.observed).findLast((m) => !m.isUser);
    const rec = head ? activeRecord(head, input.core.journal.tombstones) : null;
    // Read here, inside the operation that landed them; the cards are written after it.
    const chips = new Map([...keys].map((batch) => {
      const entry = rec?.post.findLast((p) => p.kind === "fix" && p.agent?.key === batch);
      return [batch, head && entry && entry.events.length > 0 ? fixChip(head.id, head.swipeId, entry.seq) : null] as const;
    }));
    void (async () => {
      for (const chip of await this.rt.chips.list(input.chatId, input.userId)) {
        const card = payloadOf(chip);
        const held = card?.items.filter((i) => i.batch !== undefined && (keys.has(i.batch) || refused.has(i.batch))) ?? [];
        if (!card || held.length === 0) continue;
        const counted: StoredReviewItem[] = [];
        for (const item of held) {
          const batch = item.batch ?? "";
          delete item.batch;
          if (refused.has(batch)) {
            item.status = "refused";
            item.refused = { code: "write_refused", reason: NO_LONGER };
            continue;
          }
          const undo = chips.get(batch);
          if (undo) item.chipId = undo;
          counted.push(item);
        }
        await this.save(input.chatId, input.userId, chip, card);
        await this.learn(input.userId, counted.map((item) => ({ item, outcome: "accepted" as const })));
      }
    })().catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${input.chatId}: a review card held for a turn wasn't updated once the turn closed (${error instanceof Error ? error.message : String(error)})`, input.userId));
  }

  /** The chat's state goes out with its chips, and the cards to the sessions that asked about them. */
  private push(chatId: ChatId, userId: UserId): void {
    this.rt.push.changed(chatId, userId);
    const sessions = this.watchers.get(`${userId}\u0000${chatId}`);
    if (!sessions || sessions.size === 0) return;
    void this.cards(chatId, userId).then((cards) => {
      for (const session of sessions) this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.review.update", chatId, cards }, userId, session === "" ? undefined : session);
    });
  }
}

/** A review request refused, with the protocol's error code for it. */
export class ReviewError extends Error {
  constructor(
    readonly code: "bad_request" | "not_found",
    message: string,
  ) {
    super(message);
  }
}
