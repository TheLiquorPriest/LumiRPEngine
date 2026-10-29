// The main agent's session (DESIGN §4.4; AGENT-LOOP-PLAN §3.3, §4): each turn's segment of it, the
// summaries compaction makes and the spans they replace, every one a blob in the user's store
// (`blobs.ts`). A turn record carries only their hashes (`Rec.session`), outside the path hash like
// `diag`, so swipes, Re-runs and Lumiverse Branches follow with no remapping: reading the session
// walks the chat's active chain back to the latest summary on it, and joins each record's segment
// from there on.
//
// A summary is a base the session reads from in place of everything on the chain before its record:
// the text that stands for what came before, then the segments it kept whole, then that record's own
// segment and those after it. A compaction makes one and archives the session it replaced as one
// too; a rollback brings an archived span back the same way. Either lands on the record of the turn
// that makes it, so no earlier record ever changes, and nothing is written into a record once the
// next turn is planned (`LedgerCore.recordSession`).

import { AGENT_KNOWLEDGE, type AgentKnowledge } from "../../shared/agent-tools";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { RecSession, Tombstone } from "../../shared/ledger";
import { isBlobHash } from "../../shared/stores";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import type { LedgerService } from "../ledger-io";
import type { BlobStore } from "./blobs";

/** A message of the main session as the agent runtime keeps it: stored as given, read back as JSON. */
export type SessionMessage = JsonObject;

/**
 * A base the session reads from (a compaction's summary, or an archived span): the summary standing
 * for what came before (null when nothing was summarized), then the segments read whole after it;
 * the knowledge its summary was made under (the main agent's, C14; absent in a base kept before it,
 * read as the GM's); and whether a rollback restored it, so it is no compaction to roll back.
 */
export interface SessionBase {
  summary: string | null;
  segments: string[];
  knowledge?: AgentKnowledge;
  restored?: true;
}

/** Where the session stands at a point of the chain, by hash: the latest base on it, the segments after it in order, and the span that base replaced. */
export interface SessionRefs {
  base: string | null;
  segments: string[];
  /** What the latest base's record archived (what a rollback brings back); null when it archived none. */
  archived: string | null;
}

/** The session read back. */
export interface ResumedSession {
  /** The summary standing for what came before `messages`; null when nothing was summarized. */
  summary: string | null;
  messages: SessionMessage[];
  refs: SessionRefs;
  /** Blobs it names that the store doesn't have, or that don't read as what they should be: what they held is missing from `messages`. */
  missing: string[];
}

/** A session as `refs` name it, turn by turn: the summary standing for what came before, then each segment it reads whole with its hash, which is how a compaction keeps the latest turns whole. */
export interface SessionParts {
  summary: string | null;
  /** The knowledge the summary was made under: the GM's for one kept without it, or none. */
  summaryKnowledge: AgentKnowledge;
  /** The base it reads from is a span a rollback restored. */
  restored: boolean;
  segments: { hash: string; messages: SessionMessage[] }[];
  /** As `ResumedSession.missing`. */
  missing: string[];
}

/** What a compaction or a rollback lands on the record of the turn that makes it. */
export interface Rebase {
  summary: string;
  archived: string;
}

/** A stored record's session as its readers take it: each part a blob's hash, anything else left out (records come from any metadata writer). */
export function recordSessionOf(rec: unknown): RecSession {
  const raw = isRecord(rec) ? rec.session : undefined;
  if (!isRecord(raw)) return {};
  const out: RecSession = {};
  for (const part of ["segment", "summary", "archived"] as const) {
    const hash = raw[part];
    if (isBlobHash(hash)) out[part] = hash;
  }
  return out;
}

/** The blobs a stored record's session names: what the sweep keeps for it. */
export function sessionRefsOf(rec: unknown): string[] {
  return Object.values(recordSessionOf(rec));
}

/**
 * Where the session stands at the end of `chain` (the active chain up to the turn that reads it, as
 * the core overlays it): each assistant message's active record, newest first, back to the latest
 * one with a base. Pure: no blob is read.
 */
export function sessionAt(chain: readonly ChainMessage[], tombstones: readonly Tombstone[]): SessionRefs {
  const segments: string[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    const rec = m && !m.isUser ? activeRecord(m, tombstones) : null;
    if (!rec) continue;
    const session = recordSessionOf(rec);
    if (session.segment) segments.push(session.segment);
    if (session.summary) return { base: session.summary, segments: segments.reverse(), archived: session.archived ?? null };
  }
  return { base: null, segments: segments.reverse(), archived: null };
}

function baseOf(value: unknown): SessionBase | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== "base" || !(value.summary === null || typeof value.summary === "string") || !Array.isArray(value.segments) || !value.segments.every(isBlobHash)) return null;
  const knowledge = AGENT_KNOWLEDGE.find((k) => k === value.knowledge);
  return { summary: value.summary, segments: [...value.segments], ...(knowledge ? { knowledge } : {}), ...(value.restored === true ? { restored: true as const } : {}) };
}

/**
 * The segments a stored base (a summary or an archived span) names: what the sweep keeps for a
 * record that names the base, since once earlier messages are gone a kept or archived segment is
 * referenced only through it. Nothing for anything else.
 */
export function baseRefsOf(value: unknown): string[] {
  return baseOf(value)?.segments ?? [];
}

/** A stored segment's messages, or null when the blob isn't one. */
export function segmentOf(value: JsonValue | null): SessionMessage[] | null {
  if (!isRecord(value) || value.v !== 1 || value.kind !== "segment" || !Array.isArray(value.messages) || !value.messages.every(isRecord)) return null;
  return value.messages as SessionMessage[];
}

export class Sessions {
  /** Each user's latest session read, by segment hash: a segment never changes, so the next read of the same session reads none of its blobs again, and the cache holds no more than that session. */
  private readonly read = new Map<UserId, Map<string, SessionMessage[]>>();

  constructor(
    private readonly blobs: BlobStore,
    private readonly ledger: Pick<LedgerService, "recordSession">,
  ) {}

  /** The session at the end of `chain` (`sessionAt`), read back. */
  resume(userId: UserId, chain: readonly ChainMessage[], tombstones: readonly Tombstone[]): Promise<ResumedSession> {
    return this.load(userId, sessionAt(chain, tombstones));
  }

  /** The session `refs` name, read back: a turn reads from a rollback before its record carries it. */
  async load(userId: UserId, refs: SessionRefs): Promise<ResumedSession> {
    const parts = await this.parts(userId, refs);
    return { summary: parts.summary, messages: parts.segments.flatMap((s) => s.messages), refs, missing: parts.missing };
  }

  /** The session `refs` name, turn by turn (`SessionParts`), its segments read together. */
  async parts(userId: UserId, refs: SessionRefs): Promise<SessionParts> {
    const missing: string[] = [];
    let base: SessionBase | null = null;
    let hashes = refs.segments;
    if (refs.base !== null) {
      base = baseOf(await this.blobs.getJson(userId, refs.base));
      if (base) hashes = [...base.segments, ...refs.segments];
      else missing.push(refs.base);
    }
    const cached = this.read.get(userId);
    const read = await Promise.all(hashes.map(async (hash) => cached?.get(hash) ?? segmentOf(await this.blobs.getJson(userId, hash))));
    const segments: SessionParts["segments"] = [];
    const kept = new Map<string, SessionMessage[]>();
    hashes.forEach((hash, i) => {
      const messages = read[i];
      if (!messages) return missing.push(hash);
      segments.push({ hash, messages });
      kept.set(hash, messages);
    });
    this.read.set(userId, kept);
    return { summary: base?.summary ?? null, summaryKnowledge: base?.knowledge ?? "gm", restored: base?.restored === true, segments, missing };
  }

  /** Stores what a turn added to the session, held for `holder` until its record carries it (`record`). */
  segment(userId: UserId, holder: string, messages: readonly SessionMessage[]): Promise<string> {
    return this.blobs.putJson(userId, { v: 1, kind: "segment", messages: [...messages] }, holder);
  }

  /**
   * A compaction by the turn whose session stands at `at`: `summary`, made under `knowledge`, stands
   * for everything but the last `keep` segments, which stay whole, and the session it replaced is
   * archived whole, for a rollback. Both are held for `holder` until the turn's record carries them.
   */
  async compact(userId: UserId, holder: string, at: SessionRefs, summary: string, keep: number, knowledge?: AgentKnowledge): Promise<Rebase> {
    const current = await this.expanded(userId, at);
    const kept = keep > 0 ? current.segments.slice(-keep) : [];
    return this.rebase(userId, holder, current, { summary, segments: kept, ...(knowledge ? { knowledge } : {}) });
  }

  /**
   * A rollback by the turn whose session stands at `at`: the span `archived` held comes back, with
   * the segments since the base it was replaced by, and that base is archived in turn. Null when
   * `archived` isn't a stored span.
   */
  async rollback(userId: UserId, holder: string, at: SessionRefs, archived: string): Promise<Rebase | null> {
    const span = baseOf(await this.blobs.getJson(userId, archived));
    if (!span) return null;
    const current = await this.expanded(userId, at);
    return this.rebase(userId, holder, current, { summary: span.summary, segments: [...span.segments, ...at.segments], ...(span.knowledge ? { knowledge: span.knowledge } : {}), restored: true });
  }

  /**
   * Writes the turn's session parts into its record from outside the turn's own ledger operation, then
   * lets `holder` go: once the record carries them they are referenced, and if it was refused (the
   * next turn was already planned) they are garbage for the sweep. Null once written, else why not.
   */
  async record(chatId: ChatId, userId: UserId, holder: string, at: { messageId: MessageId; swipeId: number }, session: RecSession): Promise<string | null> {
    try {
      return await this.ledger.recordSession(chatId, userId, at.messageId, at.swipeId, session);
    } finally {
      this.blobs.release(userId, holder);
    }
  }

  /** `record` from inside the turn's own ledger operation (a turn's hooks get its core and chain), which the queue would wait behind. */
  recordIn(core: LedgerCore, observed: readonly ChainMessage[], userId: UserId, holder: string, at: { messageId: MessageId; swipeId: number }, session: RecSession): string | null {
    try {
      return core.recordSession(at.messageId, at.swipeId, session, observed);
    } finally {
      this.blobs.release(userId, holder);
    }
  }

  /** The session `at` names as one base: its base's summary and knowledge, then the base's segments and those after it. */
  private async expanded(userId: UserId, at: SessionRefs): Promise<SessionBase> {
    if (at.base === null) return { summary: null, segments: [...at.segments] };
    const base = baseOf(await this.blobs.getJson(userId, at.base));
    if (!base) throw new Error("the session's summary isn't stored, so it can't be rebased");
    return { summary: base.summary, segments: [...base.segments, ...at.segments], ...(base.knowledge ? { knowledge: base.knowledge } : {}) };
  }

  private async rebase(userId: UserId, holder: string, replaced: SessionBase, next: SessionBase): Promise<Rebase> {
    const stored = (b: SessionBase) => ({ v: 1, kind: "base", summary: b.summary, segments: b.segments, ...(b.knowledge ? { knowledge: b.knowledge } : {}), ...(b.restored ? { restored: true } : {}) });
    const archived = await this.blobs.putJson(userId, stored(replaced), holder);
    const summary = await this.blobs.putJson(userId, stored(next), holder);
    return { summary, archived };
  }
}
