// GM → Depth → Bootstrap's LumiBooks tree (DEPTH-PLAN Round 2 item 1): the chat's LumiBooks book read
// against its messages now (`lumibooks.ts`), its records landed as the bootstrap starts, with no model
// call, and what each deepening of a node would take, shown before it runs.

import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import type { Basis } from "../../shared/layer";
import type { LbActionEstimate, LbTree } from "../../shared/bootstrap";
import type { Runtime } from "../runtime";
import type { BootstrapEnv } from "./run";
import { findLumiBooks, isLbMarks, lbCoverOf, lbDrafts, lbEstimate, lbProgressOf, lbTreeOf, type LbBook, type LbMessage, type MessageCover } from "./lumibooks";

/** Who caught up on each node and whose full mind each built, in the chat's bootstrap files. */
const MARKS = "lumibooks.json";

/**
 * Whether the run (and its estimate) skips the messages the chat's LumiBooks book covers. Only once
 * the author's jumpstart pass reads the records into the cast's cores and the notebook may it: until
 * that pass exists nothing reads the records, so skipping would leave depth blind to that history.
 * Off: every message is read, and the records stand only in the tree.
 */
export const JUMPSTART_SKIPS_COVERED = false;

/** The chat's book against its messages: each message's coverage, and its basis on the active chain where it has one. */
interface Read {
  book: LbBook | null;
  messages: LbMessage[];
  cover: MessageCover[];
  chain: Basis[];
}

export class LumiBooksBootstrap {
  constructor(private readonly rt: Runtime) {}

  async read(chatId: ChatId, userId: UserId): Promise<Read> {
    const messages = (await this.rt.host.chats.messages(chatId, userId)).sort((a, b) => a.index - b.index).map((m): LbMessage => ({ id: m.id, isUser: m.isUser, content: m.content }));
    const bases = new Map((await this.rt.ledger.chainBases(chatId, userId)).map((b) => [b.message, b]));
    // Each message's basis by its place in the chat; the chain read stops at the first message the ledger doesn't hold, so nothing lands against the wrong one.
    const chain: Basis[] = [];
    for (const m of messages) {
      const b = bases.get(m.id);
      if (!b) break;
      chain.push(b);
    }
    const book = await findLumiBooks(this.rt.host, chatId, userId, messages);
    return { book, messages, cover: book ? await lbCoverOf(book, messages) : messages.map((): MessageCover => "uncovered"), chain };
  }

  /** The messages the book covers: its hash of each still matches (or its shelf names it) and an entry of it spans it, so its record stands for it. */
  async covered(chatId: ChatId, userId: UserId): Promise<Set<MessageId>> {
    const { book, messages, cover } = await this.read(chatId, userId);
    if (!book) return new Set();
    return new Set(messages.filter((_, i) => cover[i] === "covered" && book.records.some((r) => r.range[0] <= i && i <= r.range[1])).map((m) => m.id));
  }

  async tree(chatId: ChatId, userId: UserId, env: Pick<BootstrapEnv, "people" | "files">): Promise<LbTree> {
    const { book, cover, chain } = await this.read(chatId, userId);
    const { cast, pov } = await env.people();
    const marks = (await env.files.read(MARKS, isLbMarks)) ?? { caughtUp: {}, fullMind: {} };
    const progress = lbProgressOf(await this.rt.ledger.layerSummaries(chatId, userId), chain);
    return lbTreeOf(chatId, book, cover, cast.filter((p) => p.id !== pov), marks, progress);
  }

  /** Lands the book's records with no model call, as the bootstrap starts: what landed, refused and was already there. */
  async land(chatId: ChatId, userId: UserId): Promise<{ landed: number; refused: string[] } | null> {
    const { book, chain } = await this.read(chatId, userId);
    if (!book || book.records.length === 0) return null;
    const { drafts, blobs } = lbDrafts(chatId, book, chain, await this.rt.ledger.layerSummaries(chatId, userId));
    if (drafts.length === 0) return { landed: 0, refused: [] };
    for (const text of Object.values(blobs)) await this.rt.blobs.put(userId, text);
    const results = await this.rt.ledger.landLayers(chatId, userId, drafts, { without: new Set(), wait: true });
    return { landed: results.filter((r) => r.status === "landed").length, refused: results.flatMap((r) => (r.status === "refused" ? [r.reason] : [])) };
  }

  /** What a deepening of the node `entry` would take (the whole book for a full mind without one); null where the chat's book has no such node. */
  async estimate(chatId: ChatId, userId: UserId, env: Pick<BootstrapEnv, "knobs">, kind: "catchup" | "deep" | "fullmind", entry: string | undefined, who: readonly EntityId[]): Promise<LbActionEstimate | null> {
    const { book, messages } = await this.read(chatId, userId);
    if (!book || book.records.length === 0) return null;
    const record = entry === undefined ? null : book.records.find((r) => r.id === entry);
    if (entry !== undefined && !record) return null;
    const range: [number, number] = record ? record.range : [Math.min(...book.records.map((r) => r.range[0])), Math.max(...book.records.map((r) => r.range[1]))];
    return lbEstimate(kind, range, messages, record?.text ?? "", who.length, (await env.knobs()).chunkTokens);
  }
}
