// Each chat into RPE's store (STANDALONE-PLAN §15.3 item 7, §6.3). Today's own reader reads the chat
// as today's fold does (the journal's records over the messages', its pauses and tombstones), and
// every reply and every swipe becomes a turn tied to its message by the saved text's hash and the
// swipe's date. Each swipe is folded by today's fold where it was played (`own-path.ts`), and what
// the fold applied at that step becomes the turn's changes, each with the source `import`, so the
// chat reads as not yet played on RPE. What an old engine recorded for the swipe is kept beside the
// turn, read-only.
//
// A reply edited after today's build read it (its record read other text than the swipe holds now) is
// tied to what the record read, not to the edit: the chat's first comparison on RPE then finds it
// edited after its turn, as it finds a reply edited after a turn RPE played (§6.3), and the Author is
// told of it like any reply that differs from the record (§15.2). Tied to the edit, it would read as
// unchanged, and the edit would reach no agent.
//
// The check: RPE's fold over the imported changes is compared, value for value, with today's state at
// every swipe and at the chat's head. Where they differ, today's state there is kept as the starting
// state of that turn (`setBase`), so nothing is lost, and the values that differ are listed by path.
// A turn takes a base on any swipe, on the shown path or off it; the head of a chat that stands rebased
// (an earlier swipe flipped after later replies were played) takes it at the node the shown path runs
// through its newest turn.
//
// A branch shares the turns of the chat it was made from for the messages it copied, as long as the
// copies are still the same (its texts, records, pauses and discards); after that it has its own.
//
// A run imports every chat again from the start (§15.3): a chat not yet played on RPE is removed with
// its branches and imported afresh; a chat played on RPE, or one a played branch shares turns with, is
// left as it is, and the report says so. A chat an earlier run imported that Lumiverse no longer has is
// removed, unless it was played on RPE; one Lumiverse still has that this run can't read keeps what
// the earlier run imported of it.

import type { Database } from "bun:sqlite";
import type { Migration, MigrationArea } from "../app/migrations";
import { chatKnowledgePrefsOf } from "./today/chat-knowledge-prefs";
import { readRun } from "./today/run";
import type { ChainMessage, FoldInput } from "../engine/ledger/chain";
import { activeText, contentId, isTombstoned, sameContent } from "../engine/ledger/path";
import type { Registry } from "../engine/registry-impl";
import { hashJson } from "../shared/hash";
import type { ChatId, RevisionId, UserId, WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { ChatRun, Tombstone } from "../shared/ledger";
import { type KeptOwn, matchTurn, StoreInputError, type ShownMessage, type Store, type UserStore } from "../store";
import { CapturingFold, foldToday } from "./capture";
import { textHash, type SwipeFacts } from "./lumiverse-db";
import { chainOf, placements, type Pick, type Placement } from "./own-path";
import type { ChatImportReport, Difference } from "./report";
import { forgetChats, keepChat, keepRecord } from "./tables";
import type { Today } from "./today";

/** A chat as the importer takes it: today's fold input for it as it stands, its swipes' hashes and dates, and the chat it was branched from. */
export interface ChatToImport {
  chatId: string;
  run: ChatRun;
  input: FoldInput;
  /** Every world revision its folds may ask for. */
  revisions: ReadonlySet<RevisionId>;
  swipes: ReadonlyMap<string, SwipeFacts>;
  /** Lumiverse's own note on a branch: the chat it was made from, and the message it was made at. */
  branch: { from: string; at: string } | null;
  /** Whether the engine was switched on for the chat today: LumiAH's own switch for a chat it plays, else on, as the chat's metadata holds its run. */
  wasOn: boolean;
  /** The engine that played it, as the chat's own choice holds it (classic where none). */
  engine: string;
}

/** The chats LumiAH's own `harness/chats.json` says the engine is switched on for; null where it keeps no such file. */
function switchedOn(text: string | null): Set<string> | null {
  let doc: unknown = null;
  try {
    doc = text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
  return isRecord(doc) && isRecord(doc.on) ? new Set(Object.keys(doc.on)) : null;
}

/** Every chat of the user's that plays a world, read by today's reader; and those today's reader can't open, with why (fixed words). */
export async function chatsToImport(today: Today): Promise<{ chats: ChatToImport[]; notOpened: { chatId: string; why: string }[] }> {
  const user = today.sources.userId as UserId;
  const chats: ChatToImport[] = [];
  const notOpened: { chatId: string; why: string }[] = [];
  const switched = switchedOn(await today.userView.read("harness/chats.json"));
  for (const row of today.chats) {
    const run = readRun(row.metadata);
    if (!run) continue;
    const read = await today.reader.today(row.id as ChatId, user);
    if (!read) {
      notOpened.push({ chatId: row.id, why: "today's reader can't open it: its world can't be read" });
      continue;
    }
    const from = row.metadata.branched_from;
    const at = row.metadata.branch_at_message;
    // The swipes' hashes and dates from the read the reader folded, not a fresh one: a swipe Lumiverse deleted since would move the others up one.
    chats.push({
      chatId: row.id,
      run: read.run,
      input: read.input,
      revisions: read.revisions,
      swipes: today.standIn.swipes(row.id as ChatId),
      branch: typeof from === "string" && typeof at === "string" ? { from, at } : null,
      wasOn: switched === null || switched.has(row.id) || chatKnowledgePrefsOf(row.metadata).engine !== "harness",
      engine: chatKnowledgePrefsOf(row.metadata).engine ?? "classic",
    });
  }
  return { chats, notOpened };
}

/** The chats in an order where each comes after the chat it was branched from. */
function sourcesFirst(chats: readonly ChatToImport[]): ChatToImport[] {
  const byId = new Map(chats.map((c) => [c.chatId, c]));
  const out: ChatToImport[] = [];
  const placed = new Set<string>();
  const visit = (c: ChatToImport, seen: Set<string>): void => {
    if (placed.has(c.chatId) || seen.has(c.chatId)) return;
    seen.add(c.chatId);
    const source = c.branch ? byId.get(c.branch.from) : undefined;
    if (source) visit(source, seen);
    placed.add(c.chatId);
    out.push(c);
  };
  for (const c of chats) visit(c, new Set());
  return out;
}

/** A branch's messages that share the turns of the chat it was made from: by the branch's index, with the source's message. */
interface Link {
  from: string;
  at: string;
  /** The source's message id to the branch's, for the store's branch. */
  map: Record<string, string>;
  /** The source's message at each shared index of the branch's chain. */
  shared: Map<number, string>;
}

const json = (v: unknown): string => JSON.stringify(v) ?? "";

/**
 * Where a branch shares its source's turns: from its first message, as long as each message is
 * still the same in both (texts, swipe dates, records, and the journal's pauses and discards naming
 * it), up to the message it was made at. None when no reply is shared, or the two play other runs.
 */
function linkOf(chat: ChatToImport, source: ChatToImport | undefined): Link | null {
  if (!chat.branch || !source || chat.run.worldId !== source.run.worldId || chat.run.revision !== source.run.revision) return null;
  const sc = source.input.chain;
  const bc = chat.input.chain;
  const at = sc.findIndex((m) => m.id === chat.branch?.at);
  if (at < 0) return null;
  const naming = (input: FoldInput, id: string): string => json([input.pauses.filter((p) => p.messageId === id), input.tombstones.filter((t: Tombstone) => t.messageId === id)]);
  const map: Record<string, string> = {};
  const shared = new Map<number, string>();
  let replies = 0;
  for (let i = 0; i <= at && i < bc.length; i++) {
    const a = sc[i] as ChainMessage;
    const b = bc[i] as ChainMessage;
    const same = a.isUser === b.isUser && json(a.swipes) === json(b.swipes) && json(a.ledger) === json(b.ledger) && json(source.swipes.get(a.id)) === json(chat.swipes.get(b.id)) && naming(source.input, a.id) === naming(chat.input, b.id);
    if (!same) break;
    map[a.id] = b.id;
    shared.set(i, a.id);
    if (!a.isUser) replies++;
  }
  return replies === 0 ? null : { from: source.chatId, at: chat.branch.at, map, shared };
}

/**
 * Why a reply's swipe stood with no turn played, as the old engine recorded it (`RecHarness.unplayed`, in its own words): undefined
 * where the record says no such thing, the store's reason where its words say the generation was stopped, failed or the engine
 * restarted, and null for words that say none of them (the reply stands unplayed all the same).
 */
function unplayedReason(rec: { harness?: { unplayed?: string; turns?: unknown[] } } | undefined): "stopped" | "failed" | "restarted" | null | undefined {
  const said = rec?.harness?.unplayed;
  if (typeof said !== "string" || (rec?.harness?.turns ?? []).length > 0) return undefined;
  if (/restart/i.test(said)) return "restarted";
  if (/fail/i.test(said)) return "failed";
  if (/stop/i.test(said)) return "stopped";
  return null;
}

/** The paths of the values two states differ in (`clock`, `entities/<id>/fields/<field>`): never the values. */
export function stateDifferences(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, at: string): void => {
    if (json(x) === json(y)) return;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      x.forEach((v, i) => walk(v, y[i], `${at}/${i}`));
      return;
    }
    if (isRecord(x) && isRecord(y) && !Array.isArray(x) && !Array.isArray(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) walk(x[k], y[k], at === "" ? k : `${at}/${k}`);
      return;
    }
    out.push(at === "" ? "(the whole state)" : at);
  };
  walk(JSON.parse(json(a)) as unknown, JSON.parse(json(b)) as unknown, "");
  return out;
}

/**
 * Where a swipe's live record read other text than the swipe holds now, by today's own rule (an edit
 * since, accepted unread): today's own hash of what it read (`contentId`), which no text hashes to as
 * RPE hashes texts, so the swipe reads as edited until a turn of RPE's is tied to it. Null where the
 * record read what the swipe holds, or the swipe has no live record.
 */
function readOtherwise(chat: ChatToImport, m: ChainMessage, swipe: number): string | null {
  const rec = m.ledger?.swipes[String(swipe)];
  if (rec === undefined || isTombstoned(chat.input.tombstones, m.id, rec)) return null;
  return sameContent(rec.swipeHash, contentId(m.swipes[swipe] ?? "")) ? null : rec.swipeHash.hash;
}

/** The hash a reply's swipe is tied to, in each place a turn is matched to it: what today's build read of it where that differs from the swipe now, else the swipe as saved. */
function tieHash(chat: ChatToImport, m: ChainMessage, swipe: number): string {
  return readOtherwise(chat, m, swipe) ?? chat.swipes.get(m.id)?.hashes[swipe] ?? textHash(m.swipes[swipe] ?? "");
}

/** One chat's import, as far as its turns go. */
interface Imported {
  turns: number;
  placed: ChatImportReport["placed"];
  shared: number;
  matched: { head: boolean; swipes: number; of: number };
  differences: Difference[];
  dropped: number;
  violations: number;
  /** Swipes it carried that were edited since today's build read them (`readOtherwise`). */
  edited: number;
}

/**
 * Keeps the run record of a turn a migration carried (the turn lane's `keepCarriedRun`, which `migrate` may not import, so the
 * command line hands it in): the reply as released and what the old engine saved otherwise than released (its departures), so the
 * first turn RPE plays after it is told the reply as it tells any. Called inside the chat's write, once for every imported turn.
 */
export type KeepCarriedRun = (db: Database, run: { user: string; chat: string; turn: string; at: number; released: string; saved: string | null }) => void;

/** The turn lane's writer of carried turns' run records, with the tables it writes (its area's migrations, which the run brings up to date first). */
export interface CarriedRuns {
  tables: { area: MigrationArea; migrations: readonly Migration[] };
  keep: KeepCarriedRun;
}

/** The lines a swipe's record holds where its reply says something against its turn, joined; null where it holds none. */
function savedOf(rec: unknown): string | null {
  const lines = isRecord(rec) && isRecord(rec.harness) ? rec.harness.departures : undefined;
  const kept = Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string") : [];
  return kept.length > 0 ? kept.join("\n") : null;
}

/** Imports one chat into the store. */
function importOne(s: UserStore, db: Database, registry: Registry, chat: ChatToImport, link: Link | null, turnOfShared: (link: Link, index: number, swipe: number) => string | null, keepRun: KeepCarriedRun | undefined): Imported {
  const chain = chat.input.chain;
  const id = chat.chatId;
  if (link) s.branchChat({ id, from: link.from, map: link.map, at: link.at, seed: chat.run.runSeed, started: chat.run.startedAt, wasOn: chat.wasOn, engine: chat.engine });
  else s.createChat({ id, world: chat.run.worldId as WorldId, revision: chat.run.revision, seed: chat.run.runSeed, started: chat.run.startedAt, wasOn: chat.wasOn, engine: chat.engine });
  const facts = (m: ChainMessage): SwipeFacts | undefined => chat.swipes.get(m.id);
  const hashOf = (m: ChainMessage, swipe: number): string => facts(m)?.hashes[swipe] ?? textHash(m.swipes[swipe] ?? "");
  const dateOf = (m: ChainMessage, swipe: number): number | null => facts(m)?.dates[swipe] ?? null;
  const own = new Map<string, string>();
  const turnOf = (at: number, swipe: number): string | null => (link?.shared.has(at) ? turnOfShared(link, at, swipe) : (own.get(`${at}:${swipe}`) ?? null));
  // A chain's prefix is folded before the chain: replies in order, the swipe each shows last, since the next reply's own path most often runs through it.
  const order = placements(chain, chat.input.tombstones).sort((a, b) => a.at - b.at || Number(a.swipe === (chain[a.at] as ChainMessage).swipeId) - Number(b.swipe === (chain[b.at] as ChainMessage).swipeId) || a.swipe - b.swipe);
  const capture = new CapturingFold(registry);
  const out: Imported = { turns: 0, placed: { own: 0, shown: 0, lost: 0 }, shared: 0, matched: { head: true, swipes: 0, of: 0 }, differences: [], dropped: 0, violations: 0, edited: 0 };
  const nodeOf = (picks: Pick | null): string | null => {
    const list: Pick[] = [];
    for (let p = picks; p !== null; p = p.prev) list.push(p);
    let on: string | null = null;
    for (const p of list.reverse()) {
      const turn = turnOf(p.at, p.swipe);
      if (turn === null && unplayedReason((chain[p.at] as ChainMessage).ledger?.swipes[String(p.swipe)]) !== undefined) continue;
      if (turn === null) throw new StoreInputError(`no turn for swipe ${p.swipe} of message ${(chain[p.at] as ChainMessage).id}`);
      on = s.extendPath(on, turn);
    }
    return on;
  };
  for (const p of order as Placement[]) {
    if (link?.shared.has(p.at)) {
      out.shared++;
      continue;
    }
    const m = chain[p.at] as ChainMessage;
    // A reply that stood with no turn played has no turn here either: it stays on the chat's path as an unplayed stretch, with the reason the old engine gave.
    const standing = unplayedReason(m.ledger?.swipes[String(p.swipe)]);
    if (standing !== undefined) {
      if (standing !== null) s.setReason(id, m.id, standing);
      continue;
    }
    const on = nodeOf(p.picks);
    const step = capture.last({ ...chat.input, chain: chainOf(chain, p) });
    const turn = s.beginTurn({ chat: id, kind: p.swipe === 0 ? "normal" : "swipe", imported: true, on });
    // Changes before the tie: both orders give the same state, and this one writes no snapshot twice.
    if (step.changes.length > 0) s.addChanges(turn.id, step.changes);
    // The text the turn was played on is kept with it: a reply played on what it holds now says so, and a reply edited since is told, by that text, as one edited after its turn. Where the record read other text, it is not known whole.
    const edited = readOtherwise(chat, m, p.swipe) !== null;
    s.tieTurn(turn.id, { message: m.id, hash: tieHash(chat, m, p.swipe), date: dateOf(m, p.swipe), text: edited ? null : (m.swipes[p.swipe] ?? "") });
    if (edited) out.edited++;
    if (step.clock !== null) s.updateTurn(turn.id, { storyTime: step.clock });
    own.set(`${p.at}:${p.swipe}`, turn.id);
    const rec = m.ledger?.swipes[String(p.swipe)];
    if (rec) keepRecord(db, s.id, { chat: id, turn: turn.id, message: m.id, swipe: p.swipe, record: rec });
    // Every imported turn has its run record, one with nothing saved otherwise included: the telling reads the chat's newest kept run, so a turn without one would show an older turn's lines.
    keepRun?.(db, { user: s.id, chat: id, turn: turn.id, at: dateOf(m, p.swipe) ?? 0, released: m.swipes[p.swipe] ?? "", saved: savedOf(rec) });
    out.turns++;
    out.placed[p.how === "shown" && p.lost ? "lost" : p.how]++;
    out.dropped += step.dropped;
    out.violations += step.violations;
    // The check at this swipe: RPE's fold of its changes against today's state where it was folded.
    out.matched.of++;
    const ours = s.stateAt(turn.id).state.world;
    if (hashJson(ours) === hashJson(step.state)) out.matched.swipes++;
    else {
      out.differences.push({ at: { message: m.id, swipe: p.swipe }, turn: turn.id, values: stateDifferences(step.state, ours), kept: true });
      s.setBase(turn.id, step.state);
    }
  }
  // The chat as it stands: its path as today's build last read it (a reply edited since, as its turn is tied), each message with the hidden mark Lumiverse holds for it (R-21), and the check at its head against today's fold of it.
  const shownOf = (messages: readonly ChainMessage[]): ShownMessage[] => messages.map((m) => (m.isUser ? { id: m.id, user: true, hash: hashOf(m, m.swipeId), hidden: facts(m)?.hidden === true } : { id: m.id, user: false, hash: tieHash(chat, m, m.swipeId), date: dateOf(m, m.swipeId), hidden: facts(m)?.hidden === true }));
  s.sync(id, shownOf(chain));
  // The import's own comparison is not the Author's: the edits it found are told by the first comparison on RPE, each once.
  s.forgetEdits(id);
  const today = foldToday(registry, chat.input);
  const head = s.headState(id).state.world;
  if (hashJson(head) !== hashJson(today.state)) {
    out.matched.head = false;
    // The newest turn the chat shows, at the node the shown path runs through it (a rebased chat's own path for that turn is another): today's state there is the start of every path through that node.
    const last = s.path(id).findLast((e) => e.turn !== null);
    const turn = last?.turn ?? null;
    if (turn !== null) {
      // A turn of the chat this one was branched from is that chat's to hold a state at: its difference is listed and not kept.
      const mine = s.turn(turn)?.chat === id;
      out.differences.push({ at: "head", turn, values: stateDifferences(today.state, head), kept: mine });
      if (mine) s.setBase(turn, today.state, last?.node ?? undefined);
    }
  }
  return out;
}

/** Fixed words for why a chat couldn't be imported: an error's own words can quote the chat. */
function whyNot(error: unknown): string {
  if (error instanceof StoreInputError) return "the store refused what today's fold gave for it";
  return "today's fold could not fold it";
}

/**
 * Imports every chat into the store for one run. A chat's replacing and its import are one
 * transaction: a chat that fails leaves nothing of the attempt behind, and what an earlier run
 * imported of it stands. `earlier` lists the chats earlier runs imported; `notOpened` the chats
 * today's reader can't open, with why; `present` every chat Lumiverse has of the user's: only a chat
 * missing from it is gone.
 */
export function importChats(input: { store: Store; s: UserStore; db: Database; registry: Registry; chats: readonly ChatToImport[]; notOpened: readonly { chatId: string; why: string }[]; present: ReadonlySet<string>; earlier: readonly { chat: string; source: string | null }[]; run: string; keepRun?: KeepCarriedRun }): ChatImportReport[] {
  const { store, s, db, registry, run } = input;
  const reports: ChatImportReport[] = [];
  const wasImported = new Set(input.earlier.map((e) => e.chat));
  const byId = new Map(input.chats.map((c) => [c.chatId, c]));
  const sharedTurns = new Map<string, string | null>();
  const turnOfShared = (link: Link, index: number, swipe: number): string | null => {
    const sourceMessage = link.shared.get(index);
    const source = byId.get(link.from);
    const m = source?.input.chain[index];
    if (sourceMessage === undefined || source === undefined || m === undefined) return null;
    const key = `${link.from}\u0000${sourceMessage}\u0000${swipe}`;
    if (!sharedTurns.has(key)) {
      const found = matchTurn(s.swipes(link.from, sourceMessage), { hash: tieHash(source, m, swipe), date: source.swipes.get(sourceMessage)?.dates[swipe] ?? null });
      sharedTurns.set(key, found.turn?.id ?? null);
    }
    return sharedTurns.get(key) ?? null;
  };
  const blank = { turns: 0, placed: { own: 0, shown: 0, lost: 0 }, shares: null, matched: { head: true, swipes: 0, of: 0 }, differences: [], dropped: 0, violations: 0 };
  /** Why a chat was not imported, saying so where what an earlier run imported of it stands. */
  const stands = (chat: string, why: string): string => (s.chat(chat) !== null ? `${why}; what an earlier run imported of it stands` : why);
  /** His own changes and his jobs' that a replaced chat and its branches held, each waiting for its chat to be imported again (R-79). */
  const keptOwn = new Map<string, KeptOwn[]>();
  for (const chat of sourcesFirst(input.chats)) {
    const id = chat.chatId;
    const earlier = s.chat(id) !== null;
    const freed: KeptOwn[] = [];
    /** Writes his changes of this chat again, tied to the same replies, once its turns are tied afresh. */
    const restored = (): { placed: number; lost: number } => {
      const r = s.restoreOwn([...(keptOwn.get(id) ?? []), ...freed.filter((k) => k.chat === id)]);
      return { placed: r.placed, lost: r.lost.length };
    };
    let outcome: { left: ChatImportReport["outcome"] } | { done: Imported; link: Link | null; replaced: boolean; own: { placed: number; lost: number } };
    try {
      outcome = db.transaction(() => {
        freed.length = 0;
        if (earlier) {
          const forgot = s.forgetImport(id);
          if (forgot.played.length > 0) return { left: forgot.played.includes(id) ? ("played on RPE: left alone" as const) : ("a chat made from it was played on RPE: left alone" as const) };
          forgetChats(db, s.id, forgot.removed);
          freed.push(...forgot.kept);
        }
        const source = chat.branch ? byId.get(chat.branch.from) : undefined;
        const link = source && s.chat(source.chatId) ? linkOf(chat, source) : null;
        return { done: db.transaction(() => importOne(s, db, registry, chat, link, turnOfShared, input.keepRun))(), link, replaced: earlier || wasImported.has(id), own: restored() };
      })();
    } catch (error) {
      store.dropCaches();
      reports.push({ chatId: id, outcome: "not imported", why: stands(id, whyNot(error)), ...blank });
      continue;
    }
    if ("left" in outcome) {
      reports.push({ chatId: id, outcome: outcome.left, ...blank });
      continue;
    }
    // What a branch of it held waits for the branch, which is imported after it.
    keptOwn.delete(id);
    for (const k of freed) if (k.chat !== id) keptOwn.set(k.chat, [...(keptOwn.get(k.chat) ?? []), k]);
    const { done, link, replaced, own } = outcome;
    const shares = link ? { chat: link.from, messages: Object.keys(link.map).length } : null;
    reports.push({ chatId: id, outcome: replaced ? "replaced" : "imported", turns: done.turns, placed: done.placed, shares, matched: done.matched, differences: done.differences, dropped: done.dropped, violations: done.violations, edited: done.edited, ...(own.placed + own.lost > 0 ? { own } : {}) });
    keepChat(db, s.id, id, run, shares?.chat ?? null, replaced ? "replaced" : "imported", done.differences.length > 0);
  }
  for (const n of input.notOpened) reports.push({ chatId: n.chatId, outcome: "not imported", why: stands(n.chatId, n.why), ...blank });
  const unread = new Set(input.notOpened.map((n) => n.chatId));
  // Chats an earlier run imported that this run didn't read: gone only when Lumiverse no longer has them.
  for (const gone of input.earlier) {
    if (byId.has(gone.chat) || unread.has(gone.chat) || !s.chat(gone.chat)) continue;
    if (input.present.has(gone.chat)) {
      reports.push({ chatId: gone.chat, outcome: "not imported", why: stands(gone.chat, "today's build plays no world in it now"), ...blank });
      continue;
    }
    if (s.isPlayed(gone.chat)) {
      reports.push({ chatId: gone.chat, outcome: "gone from Lumiverse, played on RPE: left alone", ...blank });
      continue;
    }
    const forgot = s.forgetImport(gone.chat);
    if (forgot.played.length > 0) {
      reports.push({ chatId: gone.chat, outcome: "gone from Lumiverse, a chat made from it was played on RPE: left alone", ...blank });
      continue;
    }
    forgetChats(db, s.id, forgot.removed);
    reports.push({ chatId: gone.chat, outcome: "gone from Lumiverse: removed", ...blank });
  }
  return reports;
}
