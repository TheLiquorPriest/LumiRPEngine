// The sweep of the agent stores' blobs (DESIGN §4.4; AGENT-LOOP-PLAN §4, §10, §15): what nothing
// references any more is removed once its retention has passed, and never while a turn runs.
//
// What references a blob, per user: every swipe's record in every one of their chats (each chat read,
// whether or not its metadata shows it as LRE's), read from the
// host's message metadata (LRE has journals only for the chats it has opened, and never sees a
// Branch being made), each with its session's parts, the segments a compaction's summary or an
// archived span reads (once earlier messages are deleted, only they name a kept segment) and the
// workspace files its events and post entries write; every chat's agent metadata (its learned
// index, and its GM assistant thread's messages and proposals); the agent-call texts Diagnostics
// still keeps; and what the metadata may not hold yet: the open chats' journals (a
// record not yet flushed, a pending turn, a held write), the stored journal of each chat that isn't
// open (what it writes back, commits or lands when it opens again), and what work in flight holds.
//
// A blob is removed only once an earlier sweep found it unreferenced, `unreferencedDays` have passed
// since, and it is still unreferenced, unheld and not put again (a put restarts its clock), with no
// turn started meanwhile. While what a chat references can't be read, nothing is removed. The sweep
// keeps when it last ran, and when it first found each blob unreferenced, in `agents/sweep.json`; a
// user who never stored a blob gets no file. Sweeps run in the background when the runtime nudges
// (after each ledger operation, and when settings load) and one is due: garbage accrues only with
// activity, so no timer is needed.

import type { ChatId, UserId } from "../../shared/ids";
import { hashParts } from "../../shared/hash";
import { isRecord, type JsonObject } from "../../shared/json";
import { LEDGER_NAMESPACE, type Journal } from "../../shared/ledger";
import { DAY_MS, HOUR_MS, isBlobHash, type RetentionSettings } from "../../shared/stores";
import { workspaceRefs } from "../../engine/workspace";
import { agentRefs } from "../chat-agent-meta";
import { messageOf } from "../diagnostics";
import type { HostPort } from "../host";
import { journalPath } from "../ledger-io";
import { readStoredJson } from "../stored-json";
import type { BlobStore } from "./blobs";
import { baseRefsOf, recordSessionOf, sessionRefsOf } from "./sessions";

/** The sweep's state in the user's storage (a fixed path, AGENT-LOOP-PLAN §16). */
export const SWEEP_PATH = "agents/sweep.json";

/** A ledger's continuation chunks in a message's metadata, as `encodeLedger` names them. */
const CHUNK_PREFIX = `${LEDGER_NAMESPACE}:`;

export interface SweepDeps {
  host: Pick<HostPort, "chats" | "storage" | "log">;
  blobs: BlobStore;
  /** The user's Settings → Agents → Retention. */
  retention(userId: UserId): Promise<RetentionSettings>;
  /** Whether a turn of the user's is under way in any chat (`LedgerService.turning`). */
  turning(userId: UserId): boolean;
  /** The journals of the user's open chats as they stand (`LedgerService.journals`). */
  journals(userId: UserId): readonly Journal[];
  /** The agent-call texts a chat's diagnostics still keep (`Diagnostics.transcripts`). */
  transcripts(chatId: ChatId, userId: UserId): Promise<string[]>;
  now?(): number;
}

/** What a sweep did, or why it didn't run. */
export type SweepReport =
  | { ran: false; reason: string }
  | {
      ran: true;
      /** Blobs stored when it began. */
      stored: number;
      /** Of those, the ones something referenced or held, or that were put while it ran. */
      referenced: number;
      /** Unreferenced blobs it was the first to find so: their retention starts with it. */
      found: number;
      removed: number;
      /** Why it removed nothing, or stopped removing: what a chat references couldn't be read, or a turn started. */
      stopped?: string;
    };

/** When the sweep last ran, and when a sweep first found each stored blob unreferenced (epoch ms). */
interface SweepState {
  last: number | null;
  unreferenced: Record<string, number>;
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The state file, `SWEEP_PATH`. */
interface SweepFile {
  v: 1;
  last: number;
  unreferenced: Record<string, number>;
}

/** The state file as a sweep writes it. Anything else is set aside and the sweep starts afresh, which removes nothing before a retention has passed again. */
function isSweepFile(raw: unknown): raw is SweepFile {
  return isRecord(raw) && raw.v === 1 && isTime(raw.last) && isRecord(raw.unreferenced) && Object.entries(raw.unreferenced).every(([hash, at]) => isBlobHash(hash) && isTime(at));
}

/** The blobs a sweep found referenced so far, and the compaction bases among them, whose segments are referenced too. */
interface Found {
  blobs: Set<string>;
  bases: Set<string>;
}

/** The workspace files a stored list of events writes; anything that isn't such a list names nothing. */
function eventRefs(events: unknown, into: Found): void {
  if (Array.isArray(events)) for (const hash of workspaceRefs(events)) into.blobs.add(hash);
}

/** What a stored record names, read leniently (records come from any metadata writer): its session's parts, and the files its events and post entries write. */
function recordRefs(rec: unknown, into: Found): void {
  for (const hash of sessionRefsOf(rec)) into.blobs.add(hash);
  const { summary, archived } = recordSessionOf(rec);
  for (const base of [summary, archived]) if (base !== undefined) into.bases.add(base);
  if (!isRecord(rec)) return;
  eventRefs(rec.events, into);
  if (Array.isArray(rec.post)) for (const entry of rec.post) if (isRecord(entry)) eventRefs(entry.events, into);
}

/**
 * What the ledger in a message's metadata names: inline, or its chunks joined and checked as
 * `decodeLedger` reads them, with every swipe's record taken leniently (one its checks would skip
 * still names what it names). False when it can't be read (a chunk missing, the chunks not matching
 * their hash, or text that isn't JSON), so what it names is unknown.
 */
function ledgerRefs(bag: JsonObject, into: Found): boolean {
  let raw: unknown = bag[LEDGER_NAMESPACE];
  if (isRecord(raw) && typeof raw.chunks === "number" && typeof raw.hash === "string") {
    if (!Number.isInteger(raw.chunks) || raw.chunks < 1) return false;
    // The join ends at the first chunk missing, so a header of any count reads no more than the bag holds.
    let text = "";
    for (let i = 0; i < raw.chunks; i++) {
      const part = bag[`${CHUNK_PREFIX}${i}`];
      if (typeof part !== "string") return false;
      text += part;
    }
    if (hashParts("lre.chunks", text) !== raw.hash) return false;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
  }
  const swipes = isRecord(raw) ? raw.swipes : undefined;
  if (isRecord(swipes)) for (const rec of Object.values(swipes)) recordRefs(rec, into);
  return true;
}

/**
 * What a journal names that the metadata may not: each message's records (one not yet flushed, or
 * one its message lost to another writer, which the journal writes back), the planned events of its
 * pending turns with a Re-narrate's copies, and the post entries of its held writes. Lenient, as a
 * stored journal is read as it is found.
 */
function journalRefs(journal: unknown, into: Found): void {
  if (!isRecord(journal)) return;
  if (isRecord(journal.messages)) {
    for (const m of Object.values(journal.messages)) {
      const swipes = isRecord(m) && isRecord(m.ledger) ? m.ledger.swipes : undefined;
      if (isRecord(swipes)) for (const rec of Object.values(swipes)) recordRefs(rec, into);
    }
  }
  if (isRecord(journal.pending)) {
    for (const p of Object.values(journal.pending)) {
      if (!isRecord(p)) continue;
      eventRefs(p.events, into);
      if (Array.isArray(p.copies)) for (const entry of p.copies) if (isRecord(entry)) eventRefs(entry.events, into);
    }
  }
  if (Array.isArray(journal.held)) {
    for (const h of journal.held) {
      const write = isRecord(h) ? h.write : undefined;
      if (isRecord(write) && write.kind === "post" && isRecord(write.entry)) eventRefs(write.entry.events, into);
    }
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class Sweep {
  /** Each user's state, loaded once and then kept as each sweep leaves it. */
  private readonly states = new Map<UserId, Promise<SweepState>>();
  /** The sweep under way for each user, with the blobs put since it began. */
  private readonly sweeping = new Map<UserId, Set<string>>();
  /** Each user's sweep job (a nudge's or a run's): one at a time per user. */
  private readonly jobs = new Map<UserId, Promise<void>>();
  /** Everything under way in the background, for `settle`. */
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: SweepDeps) {
    deps.blobs.onPut = (userId, hash) => this.heard(userId, hash);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Starts a sweep in the background if one is due for the user (`sweepHours` since the last; a user
   * the sweep has no state for is due; "none" never is), unless one is under way for them or a turn
   * of theirs runs. Errors are logged, never thrown.
   */
  nudge(userId: UserId): void {
    if (this.jobs.has(userId) || this.deps.turning(userId)) return;
    void this.start(userId, () => this.whenDue(userId)).catch((error: unknown) => this.deps.host.log("warn", `[LumiRPEngine] the blob sweep failed (${messageOf(error)})`, userId));
  }

  /** Sweeps now, whatever the schedule, once a sweep under way for the user has ended; refused while a turn of theirs runs. */
  async run(userId: UserId): Promise<SweepReport> {
    for (let under = this.jobs.get(userId); under; under = this.jobs.get(userId)) await under;
    return this.start(userId, () => this.sweep(userId));
  }

  /** Resolves once nothing of the sweep's is under way for anyone (tests; shutdown). */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Runs `work` as the user's sweep job, which `settle` waits for. */
  private start<T>(userId: UserId, work: () => Promise<T>): Promise<T> {
    const job = work();
    const done: Promise<void> = this.track(job).then(() => {
      if (this.jobs.get(userId) === done) this.jobs.delete(userId);
    });
    this.jobs.set(userId, done);
    return job;
  }

  /** `work` as something `settle` waits for; the promise given back never rejects. */
  private track(work: Promise<unknown>): Promise<void> {
    const done: Promise<void> = work.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(done);
    void done.then(() => this.pending.delete(done));
    return done;
  }

  /** Every put, before its text is written: a sweep under way keeps the blob, and a put restarts its clock, so the next sweep to find it unreferenced is its first. */
  private heard(userId: UserId, hash: string): void {
    this.sweeping.get(userId)?.add(hash);
    void this.stateOf(userId).then(
      (state) => {
        delete state.unreferenced[hash];
      },
      () => undefined,
    );
  }

  private async whenDue(userId: UserId): Promise<void> {
    const { sweepHours } = await this.deps.retention(userId);
    if (sweepHours === "none") return;
    const { last } = await this.stateOf(userId);
    if (last !== null && this.now() - last < sweepHours * HOUR_MS) return;
    await this.sweep(userId);
  }

  private stateOf(userId: UserId): Promise<SweepState> {
    const known = this.states.get(userId);
    if (known) return known;
    const load = this.load(userId);
    this.states.set(userId, load);
    // A load that failed is tried again by the next sweep.
    void this.track(
      load.catch(() => {
        if (this.states.get(userId) === load) this.states.delete(userId);
      }),
    );
    return load;
  }

  private async load(userId: UserId): Promise<SweepState> {
    const raw = await readStoredJson(this.deps.host, SWEEP_PATH, userId, "blob sweep", isSweepFile);
    return isSweepFile(raw) ? { last: raw.last, unreferenced: { ...raw.unreferenced } } : { last: null, unreferenced: {} };
  }

  private async save(userId: UserId, state: SweepState): Promise<void> {
    await this.deps.host.storage.write(`${SWEEP_PATH}.tmp`, JSON.stringify({ v: 1, last: state.last, unreferenced: state.unreferenced }), userId);
    await this.deps.host.storage.move(`${SWEEP_PATH}.tmp`, SWEEP_PATH, userId);
  }

  private async sweep(userId: UserId): Promise<SweepReport> {
    if (this.deps.turning(userId)) return { ran: false, reason: "a turn is under way" };
    const put = new Set<string>();
    this.sweeping.set(userId, put);
    try {
      const began = this.now();
      const state = await this.stateOf(userId);
      // Set first, so a sweep that fails is tried again when the next one is due, not on every nudge.
      state.last = began;
      const stored = new Set(await this.deps.blobs.list(userId));
      if (stored.size === 0) {
        // Nothing to keep or remove, and nothing is written: the time stays in memory.
        state.unreferenced = {};
        return { ran: true, stored: 0, referenced: 0, found: 0, removed: 0 };
      }
      const { unreferencedDays } = await this.deps.retention(userId);
      const read = await this.references(userId, stored);
      const held = this.deps.blobs.held(userId);
      const marks = state.unreferenced;
      for (const hash of Object.keys(marks)) if (!stored.has(hash)) delete marks[hash];
      let referenced = 0;
      let found = 0;
      const due: string[] = [];
      for (const hash of stored) {
        if (read.refs.has(hash) || held.has(hash) || put.has(hash)) {
          referenced++;
          delete marks[hash];
          continue;
        }
        const since = marks[hash];
        if (since !== undefined) {
          if (began - since >= unreferencedDays * DAY_MS) due.push(hash);
        } else if (read.unknown === null) {
          // While what a chat references is unknown, no retention starts.
          marks[hash] = began;
          found++;
        }
      }
      let stopped = read.unknown === null ? undefined : `${read.unknown}, so what is still referenced isn't known`;
      let removed = 0;
      if (stopped === undefined) {
        for (const hash of due) {
          if (this.deps.turning(userId)) {
            stopped = "a turn started, so the rest wait for the next sweep";
            break;
          }
          if (put.has(hash) || this.deps.blobs.held(userId).has(hash)) {
            delete marks[hash];
            continue;
          }
          await this.deps.blobs.remove(userId, hash);
          delete marks[hash];
          removed++;
        }
      }
      await this.save(userId, state);
      if (read.unknown !== null) this.deps.host.log("warn", `[LumiRPEngine] the blob sweep removed nothing: ${stopped}`, userId);
      if (removed > 0) this.deps.host.log("info", `[LumiRPEngine] the blob sweep removed ${removed} of ${stored.size} stored blobs, which nothing had referenced for ${unreferencedDays} days or more`, userId);
      return { ran: true, stored: stored.size, referenced, found, removed, ...(stopped !== undefined ? { stopped } : {}) };
    } finally {
      if (this.sweeping.get(userId) === put) this.sweeping.delete(userId);
    }
  }

  /**
   * Every blob something of the user's references now (`refs`) and, when part of it can't be read,
   * what (`unknown`); what was found before that still counts. A base's segments are read only for a
   * base still stored. Every chat of the user's is read, not only those whose metadata holds LRE's
   * key: one whose key is gone, or that the list doesn't show as LRE's, can still hold records,
   * journals or diagnostics that name blobs, so a chat that can't be told apart fails closed.
   */
  private async references(userId: UserId, stored: ReadonlySet<string>): Promise<{ refs: Set<string>; unknown: string | null }> {
    const { host, blobs } = this.deps;
    const found: Found = { blobs: new Set(), bases: new Set() };
    let reading = "the chat list";
    try {
      const chats = await host.chats.list(userId);
      for (const chat of chats) {
        for (const hash of agentRefs(chat.metadata)) found.blobs.add(hash);
        reading = `chat ${chat.id}'s messages`;
        for (const m of await host.chats.messages(chat.id, userId)) if (!ledgerRefs(m.metadata, found)) return { refs: found.blobs, unknown: `chat ${chat.id}: the engine data on message ${m.id} can't be read` };
      }
      const open = new Set<ChatId>();
      for (const journal of this.deps.journals(userId)) {
        open.add(journal.chatId);
        journalRefs(journal, found);
      }
      for (const chat of chats) {
        if (open.has(chat.id)) continue;
        reading = `chat ${chat.id}'s journal`;
        const text = await host.storage.read(journalPath(chat.id), userId);
        // One that doesn't parse names nothing: the chat puts a fresh one in its place when it opens.
        if (text !== null) journalRefs(parsed(text), found);
      }
      for (const chat of chats) {
        reading = `chat ${chat.id}'s diagnostics`;
        for (const hash of await this.deps.transcripts(chat.id, userId)) found.blobs.add(hash);
      }
      for (const base of found.bases) {
        if (!stored.has(base)) continue;
        reading = `the session blob ${base}`;
        for (const hash of baseRefsOf(await blobs.getJson(userId, base))) found.blobs.add(hash);
      }
    } catch (error) {
      return { refs: found.blobs, unknown: `${reading} couldn't be read (${messageOf(error)})` };
    }
    return { refs: found.blobs, unknown: null };
  }
}
