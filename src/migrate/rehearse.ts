// The rehearsal (STANDALONE-PLAN §15.3 step 1, §15.5): a full read of today's data, all three places
// of it, that changes nothing and returns the report. Today's build keeps its data in Lumiverse's
// database (one user's chats, messages and their metadata), in the extension's storage folders in
// Lumiverse's data folder (per user, and per extension or per user as the extension is installed:
// both are read), and in the runtime's own folders on the server, its working copy's unsent writes
// laid over the user's storage. Every file and database entry found is classified to a row of the
// plan's table, every chat is read by today's own readers over the read-only stand-in, and the
// report holds counts and checksums only. Each run reads everything again: given the report of an
// earlier run, the report says what changed since.

import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { walk } from "../app/archive";
import { agentMetaOf } from "../backend/chat-agent-meta";
import { decodeLedger } from "../backend/ledger-io";
import { readRun } from "../backend/runtime";
import { chatKnowledgePrefsOf } from "../backend/chat-knowledge-prefs";
import type { ChatId, UserId, WorldId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { backupSize, backupSources, makeBackup, type BackupChat, type BackupResult } from "./backup";
import { classifyRuntime, classifyStorage, type Classified, type ClassifyContext } from "./classify";
import { readBytes, sha256 } from "./files";
import { areaFiles, areaHead, countLedgers, countLink, countSettings, countWorldDoc, INSIDE_UNIT, MIND_FILE, recordBlobs, Tally, type Unreadable } from "./inside";
import type { ChatRow, LumiverseDb } from "./lumiverse-db";
import { changesSince, refusalsOf, type ChatReport, type Item, type MigrationReport, REPORT_FORMAT, type RowReport, type Where } from "./report";
import { ROWS } from "./rows";
import { openToday, type Sources, type Today } from "./today";

export interface RehearseOptions {
  mode?: "rehearsal" | "real run";
  /** The report of an earlier run: this one says what changed since. */
  previous?: MigrationReport;
  /** Where the real run will write (RPE's data folder, the backup): the free space there is weighed against what it needs. */
  target?: string;
  now?: () => Date;
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The bytes and checksum of a JSON value as text: how a database entry is measured. */
function measured(value: unknown): { bytes: number; sha256: string } {
  const text = JSON.stringify(value) ?? "null";
  return { bytes: new TextEncoder().encode(text).length, sha256: sha256(text) };
}

function itemOf(where: Where, path: string, size: { bytes: number; sha256: string }, found: Classified | null, note?: string): Item {
  const n = note ?? found?.note;
  return { where, path, bytes: size.bytes, sha256: size.sha256, row: found?.row ?? null, fate: found?.fate ?? null, ...(n ? { note: n } : {}) };
}

/** The keys of the engine's own key of a chat's metadata (`lumi_rp_engine`): its run (`ChatRun`), its own choices and its agents' metadata. */
const RUN_KEYS: Readonly<Record<string, true>> = { v: true, worldId: true, revision: true, runSeed: true, startedAt: true };
const PREFS_KEYS: Readonly<Record<string, true>> = { knowledge: true, narrator: true, engine: true, tidy: true };
const AGENTS_KEYS: Readonly<Record<string, true>> = { learned: true, assistant: true, rollback: true };

/**
 * The engine's entries in a chat's metadata, each its own item: the run, the engine chosen, the
 * chat's own settings, the agents' learned area, the assistant thread, a rollback never applied;
 * and LumiAH's switch for the chat. A key the engine doesn't write is found, not classified.
 */
function chatEntries(chat: ChatRow, identifier: string): Item[] {
  const out: Item[] = [];
  const at = (part: string): string => `chats/${chat.id}/${part}`;
  const own = chat.metadata[LEDGER_NAMESPACE];
  if (isRecord(own)) {
    const run = Object.fromEntries(Object.entries(own).filter(([k]) => Object.hasOwn(RUN_KEYS, k)));
    if (Object.keys(run).length > 0) out.push(itemOf("Lumiverse database", at(`${LEDGER_NAMESPACE}/run`), measured(run), { row: "chat-run", fate: "carried" }, readRun(chat.metadata) ? undefined : "a run that doesn't read: today's build plays no world in this chat"));
    for (const [key, value] of Object.entries(own)) {
      if (Object.hasOwn(RUN_KEYS, key)) continue;
      if (key === "prefs" && isRecord(value)) {
        for (const [pref, v] of Object.entries(value)) {
          const row = !Object.hasOwn(PREFS_KEYS, pref) ? null : pref === "engine" ? "chat-switch" : "settings";
          out.push(itemOf("Lumiverse database", at(`${LEDGER_NAMESPACE}/prefs/${pref}`), measured(v), row === null ? null : { row, fate: "carried" }));
        }
      } else if (key === "agents" && isRecord(value)) {
        for (const [part, v] of Object.entries(value)) {
          if (part === "rollback" && v === null) continue;
          const row = part === "learned" ? "agents-workspace" : part === "assistant" ? "assistant-threads" : part === "rollback" ? "rollback" : null;
          out.push(itemOf("Lumiverse database", at(`${LEDGER_NAMESPACE}/agents/${part}`), measured(v), row === null || !Object.hasOwn(AGENTS_KEYS, part) ? null : { row, fate: row === "rollback" ? "archived" : "carried" }));
        }
      } else out.push(itemOf("Lumiverse database", at(`${LEDGER_NAMESPACE}/${key}`), measured(value), null));
    }
  } else if (own !== undefined) out.push(itemOf("Lumiverse database", at(LEDGER_NAMESPACE), measured(own), null));
  const mark = chat.metadata[`lumiah_chat_${identifier}`];
  if (mark !== undefined && mark !== null) out.push(itemOf("Lumiverse database", at(`lumiah_chat_${identifier}`), measured(mark), { row: "chat-switch", fate: "carried" }));
  return out;
}

/**
 * A message's engine entry, as one item: a reply's ledger (inline, or a header and its chunks), or
 * the panel request recorded on a user's own message. One that reads as neither is found, not
 * classified; a ledger that can't be decoded is listed as unreadable and archived.
 */
function messageEntry(message: { id: string; chatId: string; isUser: boolean; metadata: JsonObject }, identifier: string, unreadable: Unreadable[]): Item {
  const parts = Object.entries(message.metadata).filter(([k]) => k === identifier || k.startsWith(`${identifier}:`));
  const value = Object.fromEntries(parts) as JsonObject;
  const path = `chats/${message.chatId}/messages/${message.id}/${identifier}`;
  const head = message.metadata[identifier];
  if (head === undefined) {
    unreadable.push({ path, why: "chunks of a record whose header is missing" });
    return itemOf("Lumiverse database", path, measured(value), { row: "ledger", fate: "archived" }, "chunks of a record whose header is missing");
  }
  if (message.isUser && isRecord(head) && typeof head.action === "string") return itemOf("Lumiverse database", path, measured(value), { row: "panel-requests", fate: "carried" });
  if (isRecord(head) && (isRecord(head.swipes) || typeof head.chunks === "number")) {
    if (decodeLedger(message.metadata) !== null) return itemOf("Lumiverse database", path, measured(value), { row: "ledger", fate: "carried" });
    unreadable.push({ path, why: "the engine record on this message can't be decoded" });
    return itemOf("Lumiverse database", path, measured(value), { row: "ledger", fate: "archived" }, "an engine record that can't be decoded");
  }
  return itemOf("Lumiverse database", path, measured(value), null);
}

/** A storage folder's files as items, with what the runtime hasn't sent laid over it (`pending`). */
async function storageItems(where: Where, root: string | null, pending: ReadonlyMap<string, string | null>, context: ClassifyContext, unreadable: Unreadable[]): Promise<Item[]> {
  const out: Item[] = [];
  const onDisk = new Set<string>();
  for (const f of root === null ? [] : await walk(root)) {
    onDisk.add(f.path);
    if (f.link) {
      out.push(itemOf(where, f.path, { bytes: f.bytes, sha256: "" }, null, "a symbolic link, which the migration doesn't follow"));
      continue;
    }
    const found = classifyStorage(f.path, context);
    if (found?.unreadable) unreadable.push({ path: `${where}: ${f.path}`, why: found.note ?? "damaged" });
    const fresher = pending.get(f.path);
    if (typeof fresher === "string") {
      out.push(itemOf(where, f.path, measuredText(fresher), found, "taken from the runtime's working copy, which hadn't sent it yet"));
      continue;
    }
    const size = { bytes: f.bytes, sha256: sha256((await readBytes(join(root ?? "", f.path))) ?? new Uint8Array()) };
    if (fresher === null) out.push(itemOf(where, f.path, size, found && { ...found, fate: "archived" }, "removed in the runtime's working copy, which hadn't sent that yet"));
    else out.push(itemOf(where, f.path, size, found));
  }
  for (const [path, text] of pending) {
    if (onDisk.has(path) || text === null) continue;
    out.push(itemOf(where, path, measuredText(text), classifyStorage(path, context), "taken from the runtime's working copy, which hadn't sent it yet"));
  }
  return out;
}

function measuredText(text: string): { bytes: number; sha256: string } {
  return { bytes: new TextEncoder().encode(text).length, sha256: sha256(text) };
}

/** The chats LumiAH's list of chats to forget names (`{v:1, chats{chatId→ms}}`, `H/extension/backend/forget.ts:52`). */
function forgottenOf(text: string | null): Set<string> {
  const raw = json(text);
  return new Set(isRecord(raw) && isRecord(raw.chats) ? Object.keys(raw.chats) : []);
}

/** Free bytes where `target` is, or would be made (its nearest folder that exists). */
async function freeAt(target: string): Promise<number> {
  let at = resolve(target);
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  const s = await statfs(at);
  return s.bavail * s.bsize;
}

/** The chats with engine records, from Lumiverse's database alone: what the backup lists. */
function engineChats(db: LumiverseDb, chats: readonly ChatRow[], userId: string, identifier: string): BackupChat[] {
  const turns = new Map<string, number>();
  for (const m of db.engineMessages(userId, identifier)) {
    const ledger = m.isUser ? null : decodeLedger(m.metadata);
    turns.set(m.chatId, (turns.get(m.chatId) ?? 0) + (ledger ? Object.keys(ledger.swipes).length : 0));
  }
  return chats.flatMap((c) => {
    if (!turns.has(c.id) && !isRecord(c.metadata[LEDGER_NAMESPACE]) && !isRecord(c.metadata[`lumiah_chat_${identifier}`])) return [];
    const run = readRun(c.metadata);
    return [{ chatId: c.id, name: c.name, engine: run ? (chatKnowledgePrefsOf(c.metadata).engine ?? "classic") : null, worldId: run?.worldId ?? null, messages: db.messageCount(c.id, userId), turns: turns.get(c.id) ?? 0 }];
  });
}

/** Takes the backup of today's data into `dest`: a new archive each time. */
export async function backup(sources: Sources, dest: string, now?: () => Date): Promise<BackupResult> {
  const today = await openToday(sources);
  try {
    return await backupOf(today, dest, now);
  } finally {
    today.close();
  }
}

/** The backup of an open read of today's data: its storage folders, its runtime's files and the chats with engine records. */
export async function backupOf(today: Today, dest: string, now?: () => Date): Promise<BackupResult> {
  const chats = engineChats(today.db, today.chats, today.sources.userId, today.sources.identifier);
  const sources = await backupSources({ user: today.user, extension: today.extension }, today.runtime.files);
  return makeBackup({ dest, sources, chats, roots: { user: today.user, extension: today.extension, runtime: today.sources.runtime }, ...(now ? { now } : {}) });
}

export async function rehearse(sources: Sources, options: RehearseOptions = {}): Promise<MigrationReport> {
  const today = await openToday(sources);
  try {
    return await reportOf(today, options);
  } finally {
    today.close();
  }
}

/** The report on an open read of today's data: every file and database entry found, classified and counted, and every chat read by today's readers. */
export async function reportOf(today: Today, options: RehearseOptions = {}): Promise<MigrationReport> {
  const at = (options.now?.() ?? new Date()).toISOString();
  const { sources, db, pending, writes, userView, standIn, reader } = today;
  const found = today;
  {
    const userId = sources.userId as UserId;
    const chatRows = today.chats;
    const context: ClassifyContext = { chats: new Set(chatRows.map((c) => c.id)), forgotten: forgottenOf(await userView.read("harness/forget.json")) };

    const unreadable: Unreadable[] = [];
    const items: Item[] = [];
    items.push(...(await storageItems("user storage", found.user, pending, context, unreadable)));
    if (found.extension !== null) items.push(...(await storageItems("extension storage", found.extension, new Map(), context, unreadable)));
    for (const f of found.runtime.files) {
      const bytes = await readBytes(f.disk);
      items.push(itemOf("runtime", f.path, { bytes: bytes?.length ?? f.bytes, sha256: sha256(bytes ?? new Uint8Array()) }, f.link ? null : classifyRuntime(f.path), f.link ? "a symbolic link, which the migration doesn't follow" : undefined));
    }
    for (const f of found.runtime.unreadable) {
      const bytes = await readBytes(f.disk);
      items.push(itemOf("runtime", f.path, { bytes: f.bytes, sha256: sha256(bytes ?? new Uint8Array()) }, null, "a runtime config that can't be read, so whose it is isn't known"));
      unreadable.push({ path: `runtime: ${f.path}`, why: "a runtime config that can't be read, so whose it is isn't known" });
    }
    for (const chat of chatRows) items.push(...chatEntries(chat, sources.identifier));
    for (const m of db.engineMessages(sources.userId, sources.identifier)) items.push(messageEntry(m, sources.identifier, unreadable));

    // Every chat the engine has anything of, read by today's readers.
    const engine = new Set<string>();
    for (const i of items) {
      const chat = /^chats\/([^/]+)\//.exec(i.path)?.[1] ?? /^runs\/([^/]+)\//.exec(i.path)?.[1] ?? null;
      if (chat !== null && context.chats.has(chat)) engine.add(chat);
    }
    // Today's settings reader runs first, as the runtime's does: it sets a damaged settings file aside.
    await reader.userSettings(userId);
    const tally = new Tally();
    const chats: ChatReport[] = [];
    const blobs = new Set(items.filter((i) => i.where === "user storage" && (i.path.startsWith("agents/blobs/") || i.path.startsWith("harness/blobs/")) && i.fate !== null).map((i) => i.path));
    const missingBlob = (path: string, why: string): void => {
      if (!blobs.has(path)) unreadable.push({ path: `user storage: ${path}`, why });
    };
    for (const chat of chatRows) {
      if (!engine.has(chat.id)) continue;
      const read = await reader.read(chat.id as ChatId, userId);
      const before = tally.counts.get("ledger") ?? 0;
      countLedgers(read.ledgers, tally);
      for (const ledger of read.ledgers) {
        for (const rec of Object.values(ledger?.swipes ?? {})) {
          const refs = recordBlobs(rec);
          for (const h of refs.agents) missingBlob(`agents/blobs/${h}`, `a session text a record on chat ${chat.id} names; today's clean-up had removed it`);
          for (const h of refs.harness) missingBlob(`harness/blobs/${h.slice(0, 2)}/${h}`, `a harness text a record on chat ${chat.id} names; today's clean-up had removed it`);
        }
      }
      const meta = agentMetaOf(chat.metadata);
      tally.add("agents-workspace", Object.keys(meta.learned).length);
      tally.add("assistant-threads", meta.assistant.messages.length + Object.keys(meta.assistant.proposals).length);
      for (const h of [...Object.values(meta.learned).map((f) => f.hash), ...meta.assistant.messages, ...Object.values(meta.assistant.proposals)]) missingBlob(`agents/blobs/${h}`, `a file chat ${chat.id}'s agents kept; today's clean-up had removed it`);
      unreadable.push(...read.unreadable);
      chats.push({ chatId: chat.id, engine: read.engine, worldId: read.worldId, messages: read.messages, replies: read.replies, turns: (tally.counts.get("ledger") ?? 0) - before, journal: read.journal, notOpened: read.notOpened, deletedTurns: read.deletedTurns, underWay: read.underWay, waiting: read.waiting });
    }

    // The agents engine's global workspace: its files, by the blobs they name.
    const global = json(await userView.read("agents/global.json"));
    if (isRecord(global) && isRecord(global.files)) {
      tally.add("agents-workspace", Object.keys(global.files).length);
      for (const f of Object.values(global.files)) if (isRecord(f) && typeof f.hash === "string") missingBlob(`agents/blobs/${f.hash}`, "a file of the global workspace; today's clean-up had removed it");
    }

    // The worlds, through today's world store: every revision its index lists must read.
    const worldIds = new Set<string>();
    for (const path of await userView.list("worlds")) {
      const id = /^worlds\/([^/]+)\/index\.json$/.exec(path)?.[1];
      if (id) worldIds.add(id);
    }
    for (const id of [...worldIds].sort()) {
      try {
        const index = await reader.worldStore.index(id as WorldId, userId);
        if (!index) {
          unreadable.push({ path: `user storage: worlds/${id}/index.json`, why: "a world index today's world store doesn't read" });
          continue;
        }
        const docs = await reader.worldStore.getMany(id as WorldId, userId, index.revisions);
        for (const rev of index.revisions) {
          const doc = docs.get(rev);
          if (doc) countWorldDoc(doc, rev === index.head, tally);
          else unreadable.push({ path: `user storage: worlds/${id}/rev/${rev}.json`, why: "a revision the world's index lists, which today's world store can't read" });
        }
        await reader.worldStore.history(id as WorldId, userId);
        const draft = json(await userView.read(`worlds/${id}/draft.json`));
        if (isRecord(draft)) countWorldDoc(draft.doc, false, tally);
      } catch {
        // A fixed reason: the store's own words can quote the file's text, and the report holds no content.
        unreadable.push({ path: `user storage: worlds/${id}/index.json`, why: "today's world store can't read it" });
      }
    }

    // The harness's workspace areas: each head's index, and every file it names.
    const versions = { mind: new Set<string>(), notes: new Set<string>(), home: new Set<string>(), guidance: new Set<string>() };
    for (const item of items) {
      if (item.where !== "user storage" || item.fate === null) continue;
      const area = /^harness\/docs\/(chats\/([^/]+)\/(area\/[^/]+|learned)\.json|workspace\/user\.json)$/.exec(item.path);
      if (!area) continue;
      const head = areaHead(await userView.read(item.path));
      if (head === undefined) {
        unreadable.push({ path: `user storage: ${item.path}`, why: "an area head that doesn't read" });
        continue;
      }
      if (head === null) continue;
      const indexPath = `harness/blobs/${head.slice(0, 2)}/${head}`;
      const files = areaFiles(await userView.read(indexPath));
      if (files === null) {
        unreadable.push({ path: `user storage: ${indexPath}`, why: `the index ${item.path} names; today's clean-up had removed it, or it doesn't read` });
        continue;
      }
      const chat = area[2] ?? "";
      for (const f of files) {
        missingBlob(`harness/blobs/${f.hash.slice(0, 2)}/${f.hash}`, `the text of ${f.path} in ${item.path}; today's clean-up had removed it`);
        const key = `${chat}\u0000${f.path}\u0000${f.hash}`;
        if (area[3]?.startsWith("area/")) (MIND_FILE.test(f.path) ? versions.mind : versions.notes).add(key);
        else {
          versions.home.add(key);
          if (area[1] === "workspace/user.json" && f.path.split("/").pop() === "GUIDANCE.md") versions.guidance.add(key);
        }
      }
    }
    tally.add("mind-files", versions.mind.size);
    tally.add("author-notes", versions.notes.size);
    tally.add("learned-and-home", versions.home.size);
    tally.add("guidance", versions.guidance.size);

    countSettings(json(await userView.read("settings.json")), json(await userView.read("harness/settings.json")), tally);
    countLink(found.runtime.runtimes.length, json(await userView.read("harness/registry.json")), tally);

    // A damaged file today's readers set aside, as the stand-in kept it.
    for (const w of writes) if (w.op === "move" && w.to !== undefined && /\.corrupt-\d+$/.test(w.to)) unreadable.push({ path: `${w.store}: ${w.path}`, why: "damaged: today's reader sets it aside and starts afresh" });

    const rows: RowReport[] = ROWS.map((r) => {
      const own = items.filter((i) => i.row === r.id);
      const count = { found: own.length, carried: own.filter((i) => i.fate === "carried").length, attached: own.filter((i) => i.fate === "attached").length, archived: own.filter((i) => i.fate === "archived").length };
      const unit = INSIDE_UNIT[r.id];
      return {
        row: r.id,
        what: r.what,
        found: r.found,
        ...("why" in r ? { why: r.why } : {}),
        count,
        bytes: own.reduce((n, i) => n + i.bytes, 0),
        digest: sha256(own.map((i) => `${i.where}\t${i.path}\t${i.sha256}`).join("\n")),
        inside: unit === undefined ? null : { count: tally.counts.get(r.id) ?? 0, unit },
      };
    });
    const notClassified = items.filter((i) => i.row === null);
    const backupFiles = (await backupSources({ user: found.user, extension: found.extension }, found.runtime.files)).map((s) => ({ name: s.name, bytes: Bun.file(s.disk).size }));
    const chatList = engineChats(db, chatRows, sources.userId, sources.identifier);
    const backupBytes = backupSize(backupFiles, chatList);
    const importBytes = items.filter((i) => i.fate === "carried" || i.fate === "attached").reduce((n, i) => n + i.bytes, 0);
    const disk = { backup: backupBytes, import: importBytes, total: backupBytes + importBytes, free: options.target === undefined ? null : await freeAt(options.target) };
    const logged = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const line of standIn.logged) logged[line.level]++;
    const report: MigrationReport = {
      format: REPORT_FORMAT,
      at,
      mode: options.mode ?? "rehearsal",
      layout: { scope: found.install?.scope ?? "not installed", userFolder: found.user !== null, extensionFolder: found.extension !== null },
      database: db.opened,
      rows,
      items,
      notClassified,
      chats,
      unreadable,
      unsent: found.runtime.unsent.map((u) => ({ runtime: u.runtime, files: u.files.size, kept: u.kept, why: u.why })),
      standIn: { writes, logged },
      lumiverse: db.marks(sources.userId, chatRows),
      disk,
      underWay: chats.reduce((n, c) => n + c.underWay, 0),
      imports: null,
      backup: null,
      landed: null,
      carried: null,
      changes: null,
      refusals: [],
    };
    report.refusals = refusalsOf(report, found.username !== null);
    if (options.previous) report.changes = changesSince(options.previous, report);
    return report;
  }
}
