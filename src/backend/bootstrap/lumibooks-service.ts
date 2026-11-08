// GM → Depth → Bootstrap's LumiBooks tree (DEPTH-PLAN Round 2 item 1): the chat's LumiBooks book read
// against its messages now (`lumibooks.ts`), its records landed as the bootstrap starts, with no model
// call, the author's jumpstart pass over them as the run's first stage (`jumpstart.ts`), and what each
// deepening of a node would take, shown before it runs.

import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import type { Basis } from "../../shared/layer";
import type { LbActionEstimate, LbTree } from "../../shared/bootstrap";
import type { Runtime } from "../runtime";
import type { BootstrapEnv, BootstrapRun } from "./run";
import { findLumiBooks, isLbMarks, lbCoverOf, lbDrafts, lbEstimate, lbJob, lbProgressOf, lbTreeOf, type LbBook, type LbMarks, type LbMessage, type LbRecord, type MessageCover } from "./lumibooks";
import { jumpstart, jumpstartGroups, type JumpstartCast } from "./jumpstart";
import { tokensOf } from "../book";
import { MIND_WRITE, mindMetaAt, pinnedBy } from "../../shared/character-engine";
import { blobHash } from "../../shared/stores";
import { hashParts } from "../../shared/hash";
import { layerEntryId } from "../../engine/ledger/layer";
import { readMind } from "../character-engine";
import { readNotebook } from "../depth/notebook";
import { promptDef, sendable } from "../../shared/prompts";
import { DEPTH_TEXT } from "../../shared/depth-prompts";

/** Who caught up on each node and whose full mind each built, in the chat's bootstrap files. */
const MARKS = "lumibooks.json";

/** The jumpstart's layer entry for the book as it stands: a book whose records changed is read again, and the skip waits on it. */
function jumpstartId(chatId: ChatId, book: Pick<LbBook, "records">): string {
  return layerEntryId("bootstrap", chatId, "lumibooks", "jumpstart", hashParts("lumibooks.jumpstart", ...book.records.flatMap((r) => [r.id, r.level, r.title, blobHash(r.text), String(r.range[0]), String(r.range[1])])));
}

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

  /**
   * The messages the run and its estimate skip: those the book covers (its hash of each still matches,
   * or its shelf names it, and an entry of it spans it), once the jumpstart's entry for the book as it
   * stands landed. None before: a jumpstart failed, missing or not yet run leaves every message read.
   */
  async covered(chatId: ChatId, userId: UserId): Promise<Set<MessageId>> {
    const { book, messages, cover } = await this.read(chatId, userId);
    if (!book) return new Set();
    const id = jumpstartId(chatId, book);
    if (!(await this.rt.ledger.layerSummaries(chatId, userId)).some((s) => s.id === id)) return new Set();
    return new Set(messages.filter((_, i) => cover[i] === "covered" && book.records.some((r) => r.range[0] <= i && i <= r.range[1])).map((m) => m.id));
  }

  /** The jumpstart still to run for the book as it stands, for the estimate: a call per volume and the records' tokens; null where it landed or there is nothing to read. */
  async jumpstartPending(chatId: ChatId, userId: UserId): Promise<{ calls: number; tokens: number } | null> {
    const { book } = await this.read(chatId, userId);
    if (!book || book.records.length === 0) return null;
    const id = jumpstartId(chatId, book);
    if ((await this.rt.ledger.layerSummaries(chatId, userId)).some((s) => s.id === id)) return null;
    return { calls: jumpstartGroups(book.records).length, tokens: book.records.reduce((n, r) => n + tokensOf(r.text), 0) };
  }

  /**
   * The author's jumpstart pass, the run's first stage: once per book as it stands, a few author calls
   * read its records with the world's lore and what LRE holds of the cast, and what they write (cores
   * where none stands, outline knowledge, the notebook's seed) lands at the last message the book
   * covers. Null where there is nothing to read or it already ran. A refused landing throws, so the run
   * pauses with the error and Resume asks again.
   */
  async jumpstart(chatId: ChatId, userId: UserId, env: Pick<BootstrapEnv, "model" | "people" | "imports">): Promise<{ calls: number } | null> {
    const { book, chain } = await this.read(chatId, userId);
    if (!book || book.records.length === 0) return null;
    const id = jumpstartId(chatId, book);
    if ((await this.rt.ledger.layerSummaries(chatId, userId)).some((s) => s.id === id)) return null;
    const basis = chain[Math.min(Math.max(...book.records.map((r) => r.range[1])), chain.length - 1)];
    if (!basis) return null;
    const at = await this.rt.ledger.foldAtBasis(chatId, userId, basis, [], new Set());
    if (!at) throw new Error("the chat moved on under the jumpstart");
    const { cast, pov } = await env.people();
    const minds: JumpstartCast[] = [];
    for (const p of cast.filter((c) => c.id !== pov)) {
      const meta = mindMetaAt(at.state, p.id);
      minds.push({ id: p.id, name: p.name, core: meta["core.md"] !== undefined, beliefs: (await readMind(this.rt.blobs, userId, at.state, p.id))["beliefs.md"] ?? "", pinned: pinnedBy(meta["beliefs.md"], "beliefs.md") });
    }
    const lore = (await env.imports()).entries.filter((e) => e.role === "lore").map((e) => e.text);
    const notebook = (await readNotebook(this.rt, userId, at.state)).files;
    // Settings → Prompts' text as the user set it, where it can be sent, else as shipped.
    const def = promptDef(DEPTH_TEXT.jumpstart);
    if (!def) throw new Error("the jumpstart's prompt isn't registered");
    const own = (await this.rt.settings.get(userId)).prompts.texts[DEPTH_TEXT.jumpstart];
    const system = own !== undefined && sendable(def, own) ? own : def.text;
    const out = await jumpstart(env.model, { system, records: book.records.map((r) => ({ id: r.id, level: r.level, title: r.title, range: r.range, text: r.text })), lore, cast: minds, notebook, at: at.state.clock, through: basis.message });
    for (const text of Object.values(out.blobs)) await this.rt.blobs.put(userId, text);
    const results = await this.rt.ledger.landLayers(chatId, userId, [{ id, basis, kind: MIND_WRITE, events: out.events, by: { role: "author", job: "jumpstart" } }], { without: new Set(), wait: true });
    const refused = results.flatMap((r) => (r.status === "refused" ? [r.reason] : []));
    if (refused.length > 0) throw new Error(`the jumpstart's writes were refused: ${refused.join("; ")}`);
    return { calls: out.calls };
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

  /**
   * Runs a deepening the player confirmed after its estimate, through the run's own chunk read
   * (`BootstrapRun.deepen`): `deep` lands the node's exact beats over its record, which they
   * supersede; `catchup`, those characters' catch-ups scoped to the node; `fullmind`, one character's
   * over the node, or the whole book without one. Marks the node with who caught up and whose full mind it built.
   */
  async deepen(chatId: ChatId, userId: UserId, env: Pick<BootstrapEnv, "files">, run: BootstrapRun, kind: "catchup" | "deep" | "fullmind", entry: string | undefined, who: readonly EntityId[]): Promise<{ landed: number; refused: number; caught: EntityId[]; tokens: number } | null> {
    const { book } = await this.read(chatId, userId);
    if (!book || book.records.length === 0) return null;
    const record = entry === undefined ? null : book.records.find((r) => r.id === entry);
    if (entry !== undefined && !record) return null;
    const range: [number, number] = record ? record.range : [Math.min(...book.records.map((r) => r.range[0])), Math.max(...book.records.map((r) => r.range[1]))];
    let supersede: string[] = [];
    if (kind === "deep" && record) {
      const landed = await this.rt.ledger.layerSummaries(chatId, userId);
      const gone = new Set(landed.flatMap((s) => s.supersedes ?? []));
      supersede = landed.filter((s) => s.by?.job === lbJob(record.id) && !gone.has(s.id)).map((s) => s.id);
    }
    const out = await run.deepen({ range, kind: kind === "deep" ? "deep" : "catchup", who, supersede });
    if (kind !== "deep" && out.caught.length > 0) {
      const marks: LbMarks = (await env.files.read(MARKS, isLbMarks)) ?? { caughtUp: {}, fullMind: {} };
      const nodes = record ? [record.id] : book.records.map((r) => r.id);
      const into = kind === "catchup" ? marks.caughtUp : marks.fullMind;
      for (const node of nodes) into[node] = [...new Set([...(into[node] ?? []), ...out.caught])];
      await env.files.write(MARKS, marks);
    }
    return out;
  }

  /**
   * The book's nodes that name each of `cast` (its keys, title or text, by full or first name), the
   * narrowest only: a node whose span holds another that names them gives way to it. Superseded
   * entries aside. By character, in story order: what a returning character's catch-up is scoped to.
   */
  async naming(chatId: ChatId, userId: UserId, cast: readonly { id: EntityId; name: string }[]): Promise<Map<EntityId, { id: string; title: string }[]>> {
    const { book } = await this.read(chatId, userId);
    const out = new Map<EntityId, { id: string; title: string }[]>();
    if (!book) return out;
    const records = book.records.filter((r) => !r.superseded);
    for (const c of cast) {
      const words = [...new Set([c.name.trim(), c.name.trim().split(/\s+/)[0] ?? ""])].filter((w) => w.length > 1).map((w) => w.toLowerCase());
      const names = (r: LbRecord): boolean => {
        const keys = r.keys.map((k) => k.toLowerCase());
        const prose = ` ${r.title} ${r.text} `.toLowerCase();
        return words.some((w) => keys.includes(w) || new RegExp(`[^\\p{L}]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u").test(prose));
      };
      const hits = records.filter(names);
      const narrow = hits.filter((r) => !hits.some((o) => o !== r && r.range[0] <= o.range[0] && o.range[1] <= r.range[1] && (o.range[0] !== r.range[0] || o.range[1] !== r.range[1])));
      if (narrow.length > 0) out.set(c.id, narrow.sort((a, b) => a.range[0] - b.range[0]).map((r) => ({ id: r.id, title: r.title })));
    }
    return out;
  }
}
