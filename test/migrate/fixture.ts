// An invented tree of "today's data", as today's build would leave it on a server: Lumiverse's data
// folder (its database, the extension's storage in either layout), and the runtime's folders (its
// config, its own folder with a working copy holding unsent writes, its installed copy, its service
// unit). Every store of the plan's table is in it, with a file no row names, damaged files, a
// leftover temporary file, a deleted chat's run data, chats on each engine with swipes, an edit
// waiting on keep-or-discard, a deleted turn, a branch, and another user whose data must never be
// read. World files are written by today's own world store; ledgers are encoded by today's encoder.
// Everything is made up.

import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeLedger } from "../../src/backend/ledger-io";
import { WorldStore } from "../../src/backend/worlds";
import { contentId } from "../../src/engine/ledger/path";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { hashJson } from "../../src/shared/hash";
import type { UserId } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import type { Journal, MessageLedger, Rec } from "../../src/shared/ledger";
import { blobHash } from "../../src/shared/stores";
import { readBytes, sha256 as sha } from "../../src/migrate/files";
import { walk } from "../../src/app/archive";
import { copyFolderOf } from "../../src/migrate/runtime-folders";
import type { Sources } from "../../src/migrate/today";
import { FakeHost } from "../support/fake-host";

export const IDENT = "lumi_rp_engine";
export const USER = "user-fixture-01";
export const OTHER_USER = "user-fixture-02";
export const USERNAME = "fixture-player";
export const RUNTIME = "home";
export const BASE = "http://127.0.0.1:7860";

/** The chats of the fixture, by what each shows. */
export const CHAT = {
  classic: "c-classic",
  agents: "c-agents",
  harness: "c-harness",
  branch: "c-branch",
  /** A world chat whose journal was never written. */
  fresh: "c-fresh",
  plain: "c-plain",
  /** Gone from Lumiverse; its run data stays. */
  gone: "c-gone",
  /** Gone too, and named by LumiAH's list of chats to forget. */
  forgot: "c-forgot",
  /** The other user's. */
  other: "c-other",
} as const;

/** The character the harness chat is with, in Lumiverse's characters: the chat's folders in RPE are named for it. */
export const CHARACTER = { id: "char-ada", name: "Ada Vane" } as const;

/** The file no row of the plan's table names. */
export const STRAY = "stray-notes.txt";

/** The invented secrets of the runtime's connections: a key, a header's value and a sign-in's tokens, which must reach RPE's secrets file and nowhere else. */
export const SECRETS = { key: "sk-invented-0123456789", header: "team-invented-4567", access: "access-invented-89ab", refresh: "refresh-invented-cdef" } as const;

export interface Fixture {
  root: string;
  sources: Sources;
  /** Where the user's storage folder and the extension's own storage folder are. */
  userFolder: string;
  extensionFolder: string;
  worldId: string;
  revisions: string[];
  /** The working copy's unsent document and the one it removed, by user-storage path. */
  unsentDoc: string;
  unsentRemoval: string;
  /** A blob a record names that today's clean-up removed. */
  missingBlob: string;
  remove(): Promise<void>;
}

async function put(path: string, text: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function rec(seq: number, revision: string, text: string, extra: Partial<Rec> = {}): Rec {
  return { v: 1, defHash: revision, seq, swipeHash: contentId(text), path: `path-${seq}`, seed: `seed-${seq}`, pre: 0, events: [{ type: "economy.transfer", data: { amount: 5 } }], post: [], markersApplied: 1, status: "ok", undone: [], intents: {}, ...extra };
}

function ledger(swipes: Record<string, Rec>, revision: string): MessageLedger {
  return { v: 1, swipes, markers: [{ seq: 0, at: null, start: true, kind: "migrate", to: revision }] };
}

/**
 * The swiped reply of the classic chat: two swipes, each with its own turn; a correction (a ✎ fix)
 * on the second, which also holds an event of the chat's own places and one of knowledge.
 */
function swipedReply(revision: string): MessageLedger {
  const fix = { seq: 7, at: "2026-11-01T10:00:00.000Z", kind: "fix" as const, events: [{ type: "economy.transfer" as const, data: { amount: -2 } }] };
  return ledger({ "0": rec(1, revision, "The harbour is busy."), "1": rec(2, revision, "The harbour is quiet.", { post: [fix], events: [{ type: "engine.world", data: { place: "pier" } }, { type: "minds.learn", data: { who: "e-ada" } }] }) }, revision);
}

interface Message {
  id: string;
  isUser: boolean;
  swipes: string[];
  swipeId?: number;
  meta?: JsonObject;
}

/** The fixture's chats (each with its owner and metadata) and their messages, for Lumiverse's database. */
interface FixtureChats {
  chats: { id: string; user: string; name: string; meta: JsonObject; character?: string }[];
  messages: Record<string, Message[]>;
}

/** The fixture's chats and messages for Lumiverse's database: chat rows and message rows, ledgers encoded by today's encoder. */
function chatsOf(worldId: string, rev: string, blobs: { agents: string[]; harness: { segment: string; workspace: string } }): FixtureChats {
  const run = (seed: string, extra: JsonObject = {}): JsonObject => ({ [IDENT]: { v: 1, worldId, revision: rev, runSeed: seed, startedAt: 1_700_000_000_000, ...extra } });
  const bag = (l: MessageLedger): JsonObject => encodeLedger({}, l);
  const classic: Message[] = [
    { id: "m-c1", isUser: true, swipes: ["We walk to the harbour."] },
    { id: "m-c2", isUser: false, swipes: ["The harbour is busy.", "The harbour is quiet."], swipeId: 1, meta: bag(swipedReply(rev)) },
    { id: "m-c3", isUser: true, swipes: ["Pay the ferryman."], meta: { [IDENT]: { action: "economy.pay", params: { amount: 3 }, source: "palette" } } },
    // Long enough that today's encoder keeps it in chunks.
    { id: "m-c4", isUser: false, swipes: ["The ferryman nods."], meta: bag(ledger({ "0": rec(3, rev, "The ferryman nods.", { diag: "d".repeat(40_000) }) }, rev)) },
  ];
  const agents: Message[] = [
    { id: "m-a1", isUser: true, swipes: ["Ask the guard."] },
    { id: "m-a2", isUser: false, swipes: ["The guard shrugs."], meta: bag(ledger({ "0": rec(1, rev, "The guard shrugs.", { session: { segment: blobs.agents[0] ?? "", transcript: blobs.agents[3] ?? "" }, agents: [{ role: "gm", key: "k", from: 0, to: 1 }], events: [{ type: "engine.ws.write", data: { path: "notes.md" } }] }) }, rev)) },
  ];
  const harness: Message[] = [
    { id: "m-h1", isUser: true, swipes: ["Look around."] },
    {
      id: "m-h2",
      isUser: false,
      swipes: ["Fog rolls in."],
      meta: bag(
        ledger(
          {
            "0": rec(1, rev, "Fog rolls in.", {
              harness: { turns: ["gen-1"], record: { v: 1, generationId: "gen-1", kind: "reply", at: 1, path: "p", segment: blobs.harness.segment, workspace: blobs.harness.workspace, usage: {} }, departures: ["The reply says the fog is red; the turn decided grey."] },
              story: { beats: [{ id: "b1", turn: "gen-1", at: 0, where: null, by: "world", kind: "happen", what: "Fog came.", surface: "Fog.", exposure: [], decidedBy: { agent: "author" } }], cast: [{ entity: "e-ada", standing: "principal" }] },
            }),
          },
          rev,
        ),
      ),
    },
    { id: "m-h3", isUser: true, swipes: ["Wait."] },
    { id: "m-h4", isUser: false, swipes: ["(stopped)"], meta: bag(ledger({ "0": rec(2, rev, "(stopped)", { harness: { turns: [], unplayed: "the generation was stopped" } }) }, rev)) },
  ];
  // A branch of the classic chat: its messages and records copied, as Lumiverse's branch copies them.
  const branch: Message[] = classic.slice(0, 2).map((m) => ({ ...m, id: `${m.id}-b` }));
  return {
    chats: [
      { id: CHAT.classic, user: USER, name: "Harbour (classic)", meta: run("seed-classic", { prefs: { knowledge: true, narrator: "player" } }) },
      // Its engine came from the user's New chats start on, as a build with the depth engine marked it at the chat's first turn.
      { id: CHAT.agents, user: USER, name: "Gate (agents)", meta: run("seed-agents", { prefs: { engine: "agents", engineFrom: "default" }, agents: { learned: { "learned/notes.md": { hash: blobs.agents[1] ?? "" } }, assistant: { messages: [blobs.agents[2] ?? ""], proposals: {} }, rollback: { base: blobs.agents[0] ?? "", archived: blobs.agents[1] ?? "" } } }) },
      { id: CHAT.harness, user: USER, name: "Fog (harness)", character: CHARACTER.id, meta: { ...run("seed-harness", { prefs: { engine: "harness" } }), [`lumiah_chat_${IDENT}`]: { v: 1, chat: CHAT.harness, name: "LumiRPEngine", since: 1 }, chat_world_book_ids: ["book-engine"] } },
      { id: CHAT.branch, user: USER, name: "Harbour (branch)", meta: { ...run("seed-classic", { prefs: { knowledge: true } }), branched_from: CHAT.classic } },
      { id: CHAT.fresh, user: USER, name: "Lighthouse (no journal yet)", meta: run("seed-fresh") },
      { id: CHAT.plain, user: USER, name: "No engine here", meta: {} },
      { id: CHAT.other, user: OTHER_USER, name: "Someone else's", meta: run("seed-other") },
    ],
    messages: {
      [CHAT.classic]: classic,
      [CHAT.agents]: agents,
      [CHAT.harness]: harness,
      [CHAT.branch]: branch,
      [CHAT.fresh]: [
        { id: "m-f1", isUser: true, swipes: ["Climb the stairs."] },
        { id: "m-f2", isUser: false, swipes: ["The lamp is cold."], meta: bag(ledger({ "0": rec(1, rev, "The lamp is cold.") }, rev)) },
      ],
      [CHAT.plain]: [{ id: "m-p1", isUser: true, swipes: ["Hello."] }],
      [CHAT.other]: [{ id: "m-o1", isUser: false, swipes: ["Not yours."], meta: bag(ledger({ "0": rec(1, rev, "Not yours.") }, rev)) }],
    },
  };
}

/** Lumiverse's tables the readers read, with Lumiverse's own column names (`src/db/baseline.sql`). */
const SCHEMA = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT, username TEXT UNIQUE);
CREATE TABLE extensions (id TEXT PRIMARY KEY, identifier TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, metadata TEXT NOT NULL DEFAULT '{}', install_scope TEXT NOT NULL DEFAULT 'operator', installed_by_user_id TEXT, branch TEXT);
CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT);
CREATE TABLE chats (id TEXT PRIMARY KEY, character_id TEXT, name TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER, updated_at INTEGER, user_id TEXT);
CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, index_in_chat INTEGER NOT NULL, is_user INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', send_date INTEGER, swipe_id INTEGER NOT NULL DEFAULT 0, swipes TEXT NOT NULL DEFAULT '[]', extra TEXT NOT NULL DEFAULT '{}', parent_message_id TEXT, branch_id TEXT, created_at INTEGER, swipe_dates TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE world_books (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER, updated_at INTEGER, user_id TEXT, folder TEXT NOT NULL DEFAULT '');
CREATE TABLE world_book_entries (id TEXT PRIMARY KEY, world_book_id TEXT NOT NULL REFERENCES world_books(id) ON DELETE CASCADE, uid TEXT NOT NULL, key TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '', disabled INTEGER NOT NULL DEFAULT 0, extensions TEXT NOT NULL DEFAULT '{}');
CREATE TABLE regex_scripts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, find_regex TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'global', scope_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', folder TEXT NOT NULL DEFAULT '');
CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', parameters TEXT NOT NULL DEFAULT '{}', prompt_order TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}', prompts TEXT NOT NULL DEFAULT '{}', user_id TEXT);
`;

/** Writes Lumiverse's database: WAL mode, as Lumiverse runs it. */
function writeDatabase(path: string, layout: "operator" | "user", data: FixtureChats): void {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  db.query(`INSERT INTO "user" (id, name, username) VALUES (?, ?, ?)`).run(USER, "Player", USERNAME);
  db.query(`INSERT INTO "user" (id, name, username) VALUES (?, ?, ?)`).run(OTHER_USER, "Someone", "someone-else");
  db.query("INSERT INTO extensions (id, identifier, name, version, install_scope, installed_by_user_id, branch) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ext-1", IDENT, "LumiRPEngine", "0.0.1", layout, layout === "user" ? USER : null, "main");
  db.query("INSERT INTO characters (id, name, user_id) VALUES (?, ?, ?)").run(CHARACTER.id, CHARACTER.name, USER);
  let updated = 100;
  for (const c of data.chats) {
    db.query("INSERT INTO chats (id, character_id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.id, c.character ?? null, c.name, JSON.stringify(c.meta), 1, updated++, c.user);
    for (const [i, m] of (data.messages[c.id] ?? []).entries()) {
      const swipeId = m.swipeId ?? 0;
      db.query("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipe_id, swipes, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(m.id, c.id, i, m.isUser ? 1 : 0, m.isUser ? "Player" : "Narrator", m.swipes[swipeId] ?? "", swipeId, JSON.stringify(m.swipes), JSON.stringify(m.meta ? { spindle_metadata: m.meta } : {}));
    }
  }
  db.query("INSERT INTO world_books (id, name, metadata, user_id) VALUES (?, ?, ?, ?)").run("book-engine", "LumiRPEngine · Harbour", JSON.stringify({ lumi_rp_engine: true }), USER);
  db.query("INSERT INTO world_book_entries (id, world_book_id, uid, disabled, extensions) VALUES (?, ?, ?, ?, ?)").run("entry-slot", "book-engine", "1", 1, JSON.stringify({ lumi_rp_engine: { slot: "scene" } }));
  db.query("INSERT INTO world_books (id, name, metadata, user_id) VALUES (?, ?, ?, ?)").run("book-own", "My lore", "{}", USER);
  db.query("INSERT INTO world_book_entries (id, world_book_id, uid, content, extensions) VALUES (?, ?, ?, ?, ?)").run("entry-secret", "book-own", "2", "The well is dry.", JSON.stringify({ lumi_rp_engine: { lore: { secret: true } } }));
  db.query("INSERT INTO regex_scripts (id, user_id, name, find_regex, scope, scope_id, folder) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`lre_jsonx_${CHAT.classic}`, USER, "Hide engine JSON", "<json>", "chat", CHAT.classic, "LumiRPEngine");
  db.query("INSERT INTO presets (id, name, prompt_order, user_id) VALUES (?, ?, ?, ?)").run("preset-1", "Mine", JSON.stringify([{ id: "b1", name: "RPEngine", content: "" }, { id: "b2", name: "RPEngine · Scene", content: "" }, { id: "b3", name: "Story", content: "{{outlet::lre_scene}}" }]), USER);
  db.close();
}

/** A LumiAH area: its index blob and its files' bodies, as `harness/blobs/<xx>/<sha256>` texts, and the head document naming it, written at `at`. */
function area(files: Record<string, string>, blobs: Map<string, string>, at = 1): string {
  const index: JsonObject = { v: 1, kind: "index", files: {} };
  for (const [path, text] of Object.entries(files)) {
    const hash = sha(text);
    blobs.set(hash, text);
    (index.files as JsonObject)[path] = { hash, chars: text.length, at: 1, by: { kind: "user" }, was: [], pins: [] };
  }
  const text = JSON.stringify(index);
  const head = sha(text);
  blobs.set(head, text);
  return JSON.stringify({ v: 1, kind: "area", head, at });
}

/**
 * The files the depth engine of an earlier build left in the user's storage for a chat that was on
 * it, as that build wrote them (a54b3987, `src/backend/`): the chat's switch and its own settings for
 * it, its bootstrap's state, its copy of the chat and what each job answered, the layer of what it
 * landed, its search index of the chat and a leftover of a write to it, and the day's spend.
 */
export function depthFiles(chat: string): Record<string, string> {
  const basis = { message: "m-c1", swipe: contentId("The harbour is quiet."), path: "path-0" };
  const job = (slot: string): string => JSON.stringify({ slot, key: `key-${slot}`, at: 1_700_000_000_000, out: { beats: [] }, entries: [], supersedes: [] });
  const run = `runs/${chat}`;
  return {
    [`${run}/bootstrap/depth.json`]: JSON.stringify({ on: true, pin: { loopback: "conn-loopback", prior: { connection_profile_id: "conn-own", connection_model: "model-a" } } }),
    [`${run}/bootstrap/allowances.json`]: JSON.stringify({ v: 1, turn: 40_000, day: 400_000 }),
    [`${run}/bootstrap/run.json`]: JSON.stringify({ version: 1, status: "done", progress: [], hist: [], log: [] }),
    [`${run}/bootstrap/handover.json`]: JSON.stringify({ version: 1, at: 1_700_000_000_000, messages: ["m-c1", "m-c2"] }),
    [`${run}/bootstrap/manifest.json`]: JSON.stringify({ version: 1, surveyedAt: 1, bound: 6000, chunks: [{ n: 0, key: "chunk-0", first: "m-c1", last: "m-c1", firstIndex: 0, lastIndex: 0, basis }], totals: { messages: 1, tokens: 8, words: 4, user: 0, assistant: 1 } }),
    [`${run}/bootstrap/spool/00000.json`]: JSON.stringify([{ id: "m-c1", index: 0, isUser: false, name: "Narrator", text: "The harbour is quiet.", basis }]),
    ...Object.fromEntries(["author", "beats", "chapter", "historian", "pov", "truthlink"].map((name) => [`${run}/bootstrap/jobs/${name}_0.json`, job(`${name}:0`)])),
    [`${run}/bootstrap/spot/c0000-ab12cd34.json`]: JSON.stringify({ id: "c0000-ab12cd34", items: [] }),
    [`${run}/layer/meta.json`]: JSON.stringify({ v: 2, seq: 1, segments: 1 }),
    [`${run}/layer/seg-0.json`]: JSON.stringify([{ id: "entry-1", seq: 1, basis, kind: "story.beat", events: [], by: { role: "historian", job: "historian:0" } }]),
    [`${run}/archive/shard-3.json`]: JSON.stringify({ v: 1, messages: { "m-c1": { swipe: basis.swipe, h: "fingerprint", p: [[0, 21, 21, "harbour quiet", [1, 1]]] } } }),
    [`${run}/archive/shard-7.json.tmp`]: '{ "v": 1, "messag',
    "depth/day-spend.json": JSON.stringify({ v: 1, day: "2026-11-07", tokens: 48_210 }),
  };
}

export async function buildFixture(layout: "operator" | "user" = "operator"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "rpe-migrate-fixture-"));
  const lumiverse = join(root, "lumiverse");
  const home = join(root, "home");
  const userFolder = join(lumiverse, "users", USER, "extensions", IDENT);
  const extensionFolder = layout === "user" ? userFolder : join(lumiverse, "extensions", IDENT, "storage");
  const user = (path: string, text: string | Uint8Array): Promise<void> => put(join(userFolder, path), text);

  // A world, made by today's own world store, then a second revision and a draft as Build leaves them.
  const fake = new FakeHost();
  const store = new WorldStore(fake, createRegistry(ALL_PACKS), []);
  const made = await store.create("Harbour", null, USER as UserId);
  const worldId = made.world.id;
  const second = { ...made.world, name: "Harbour, rebuilt", lorePins: { characters: { "e-ada": [{ lore: "lore-harbour" }] }, places: {}, steps: {} } };
  const rev2 = hashJson(second);
  for (const [key, text] of fake.files) await user(key.slice(USER.length + 1), text);
  await user(`worlds/${worldId}/rev/${rev2}.json`, JSON.stringify(second));
  await user(`worlds/${worldId}/index.json`, JSON.stringify({ id: worldId, name: "Harbour, rebuilt", head: rev2, loreBookId: "book-engine", revisions: [made.revision, rev2] }));
  await user(`worlds/${worldId}/history.json`, JSON.stringify({ v: 1, notes: [{ revision: made.revision, at: "2026-11-01T09:00:00.000Z", source: "create" }, { revision: rev2, at: "2026-11-01T09:30:00.000Z", source: "build" }] }));
  await user(`worlds/${worldId}/draft.json`, JSON.stringify({ base: rev2, doc: { ...second, name: "Harbour, draft" }, version: 1 }));
  const rev = made.revision;

  // The agents engine's blobs (`agents/blobs/<32hex>`): one a record names is gone, as today's clean-up leaves it.
  const agentTexts = ["segment text", "learned notes", "assistant message", "transcript text"];
  const agentHashes = agentTexts.map((t) => blobHash(t));
  for (const [i, t] of agentTexts.entries()) if (i !== 3) await user(`agents/blobs/${agentHashes[i]}`, t);
  const missingBlob = `agents/blobs/${agentHashes[3]}`;
  await user(`agents/blobs/${agentHashes[0]}.tmp`, "segment te");

  // LumiAH's areas, mirrored in the user's storage under `harness/`.
  const blobs = new Map<string, string>();
  const userArea = area({ "GUIDANCE.md": "Keep the fog grey.", "style.md": "Short lines." }, blobs);
  const rootArea = area({ "notebook.md": "Ada distrusts the guard." }, blobs);
  // The chat's area at its latest turn, written after the one before it (`root`).
  const turnArea = area({ "notebook.md": "Ada distrusts the guard. The fog came.", "minds/e-ada/core.md": "Ada, a pilot.", "minds/e-ada/memory.md": "Fog over the pier.", "minds/e-bo/profile.md": "Bo, a ferryman.", "author/prepare.md": "Next: the lighthouse." }, blobs, 2);
  const turnIndex = JSON.parse(turnArea).head as string;
  const learnedArea = area({ "notes.md": "The pier floods at high tide." }, blobs);
  const segment = "harness session segment";
  blobs.set(sha(segment), segment);
  for (const [hash, text] of blobs) await user(`harness/blobs/${hash.slice(0, 2)}/${hash}`, text);
  const docs: Record<string, string> = {
    "workspace/user.json": userArea,
    [`chats/${CHAT.harness}/area/root.json`]: rootArea,
    [`chats/${CHAT.harness}/area/gen-1.json`]: turnArea,
    [`chats/${CHAT.harness}/learned.json`]: learnedArea,
    [`chats/${CHAT.harness}/approvals.json`]: JSON.stringify({ v: 1, kind: "approvals", tools: ["lore_search"], at: {} }),
    [`chats/${CHAT.harness}/session.json`]: JSON.stringify({ v: 1, kind: "session", compactAsked: null }),
    [`chats/${CHAT.harness}/jobs.json`]: JSON.stringify({ v: 1, kind: "jobs", jobs: [{ id: "job-1", at: 1 }] }),
    [`chats/${CHAT.harness}/recall.json`]: JSON.stringify({ v: 1, generationId: "gen-1", at: 1, held: {}, added: [], dropped: [] }),
    [`chats/${CHAT.forgot}/learned.json`]: learnedArea,
    "jobs/job-1.json": JSON.stringify({ v: 1, kind: "job", job: "job-1", task: "file the notebook" }),
    "jobs/all.json": JSON.stringify({ v: 1, kind: "job_ids", jobs: [{ id: "job-1", chatId: CHAT.harness, at: 1 }] }),
    "jobs/running.json": JSON.stringify({ v: 1, kind: "running", ids: [] }),
    "sides.json": JSON.stringify({ v: 1, kind: "sides", sides: [{ id: "side-1" }, { id: "side-old" }] }),
    "sides/side-1.json": JSON.stringify({ v: 1, kind: "side", turns: [] }),
    "sides/side-old.json": JSON.stringify({ v: 1, kind: "side", turns: [] }),
    "spend/2026-11-01/07.json": JSON.stringify({ v: 1, kind: "spend", calls: [] }),
    "upkeep.json": JSON.stringify({ v: 1, found: [] }),
    "recall/embedded.json": JSON.stringify({ v: 1, all: {}, hours: {} }),
    [`recall/vectors/conn.model.own/chat/${CHAT.harness}/ab.json`]: JSON.stringify({ v: 1, dims: 2, vectors: {} }),
    "mirror.json": JSON.stringify({ v: 1, kind: "mirror", copy: "copy-0001", count: 5, owner: "home on the server", at: 1 }),
  };
  for (const [path, text] of Object.entries(docs)) await user(`harness/docs/${path}`, text);
  // LumiAH keeps only what the user changed, each a value put whole at a path of its sections `core` and `transport`.
  const lumiahOwn = [
    { path: ["core", "agents", "main", "effort"], value: "high" },
    { path: ["core", "story", "hidden"], value: "include" },
    { path: ["transport", "history"], value: { keep: "last", count: 30 } },
    { path: ["transport", "connections", "oneToolAtATime"], value: ["conn-1"] },
  ];
  const definitions = {
    agents: { scout: { id: "scout", name: "Scout", description: "Walks ahead and says what is there.", instructions: "Walk ahead of the party and report what you see.", given: "task", tools: ["lore_search", "chat_read"] } },
    skills: { "tide-tables": { id: "tide-tables", name: "Tide tables", description: "When the pier floods.", body: "Read the harbour's tide table before any walk on the pier." } },
  };
  await user("harness/settings.json", JSON.stringify({ v: 1, rev: 3, own: lumiahOwn, texts: { "lumiah.writer": "Write short." }, definitions }));
  await user("harness/registry.json", JSON.stringify({ v: 1, key: { hash: sha("lah_key"), print: "lah_…", at: 1 }, relays: { "relay-1": { id: "relay-1", secret: sha("relay secret") } }, replied: {} }));
  await user("harness/mirror-holder.json", JSON.stringify({ v: 1, holder: { relay: "relay-1", copy: "copy-0001", process: "proc-1", owner: "home" }, gen: 0 }));
  await user("harness/chats.json", JSON.stringify({ v: 1, on: { [CHAT.harness]: { since: 1, prior: null, priorModel: null } }, story: { [CHAT.harness]: { mode: "full" } } }));
  await user("harness/turns.json", JSON.stringify({ v: 1, open: {} }));
  await user("harness/notices.json", JSON.stringify({ v: 1, notices: [] }));
  await user("harness/notices.json.bad", "{ notices: [");
  await user("harness/forget.json", JSON.stringify({ v: 1, chats: { [CHAT.forgot]: 1 } }));
  await user("harness/database.json", JSON.stringify({ v: 1, on: false }));
  await user("harness/story.json", JSON.stringify({ v: 1, jobs: {} }));

  // The engine's own files at the root of the user's storage.
  await user("settings.json", JSON.stringify({ v: 1, defaults: 11, helper: { connectionId: "conn-helper", model: null }, agents: { main: { connectionId: "conn-main" }, acceptance: { connections: [] } }, story: { models: { standing: { connectionId: "conn-story" } } }, prompts: { texts: { "classic.narrator": "Be terse." }, maxChars: 20_000 } }));
  await user("extraction-learning.json", JSON.stringify({ v: 1, connections: {} }));
  await user("agents.json", JSON.stringify({ v: 1, clients: { "client-1": { name: "outside-harness", version: "1.0", host: "laptop", harness: "cli", core: null, kit: null, follows: true, why: null, seen: 1 } }, toasted: null, dismissed: null, processes: {} }));
  await user("agent-acceptance.json", JSON.stringify({ v: 1, run: null, last: null }));
  await user("jobs.json", JSON.stringify({ v: 1, jobs: [] }));
  await user("lore-ids.json", JSON.stringify({ v: 1, next: 1, ids: {}, own: {} }));
  await user("lore-tools.json", JSON.stringify({ v: 1, refused: {} }));
  await user("call-meter.json", "{ this is not json");
  await user("diagnostics.log", "2026-11-01 line\n");
  await user("agents/sweep.json", JSON.stringify({ v: 1, last: 1, unreferenced: {} }));
  await user("agents/global.json", JSON.stringify({ v: 1, files: { "~/rules.md": { hash: agentHashes[1] } } }));
  await user(`prompts/sets/${blobHash("set")}.json`, JSON.stringify({ v: 1, texts: {} }));
  await user(`secrecy/${blobHash("book-own")}.json`, JSON.stringify({ v: 1, bookId: "book-own", name: "My lore", moves: [] }));
  await user(STRAY, "Who put this here?");
  // RPE's own: the new light extension's registration with RPE, there once the new extension has run.
  await user("rpe/registration.json", JSON.stringify({ v: 1, base: "http://127.0.0.1:7871", key: "invented-extension-key", connection: null, relay: "relay-session-1", build: "dev" }));

  // Each chat's run data.
  const journal = (chatId: string, seed: string, extra: Partial<Journal> = {}): string =>
    JSON.stringify({ v: 1, chatId, seq: 9, started: true, chain: [], messages: {}, pauses: [], tombstones: [], held: [], windows: [], pending: {}, run: { worldId, runSeed: seed }, ...extra } satisfies Journal);
  const classicReply = swipedReply(rev);
  await user(
    `runs/${CHAT.classic}/journal.json`,
    journal(CHAT.classic, "seed-classic", {
      // The journal holds the reply's records; one is not yet flushed onto the message.
      messages: { "m-c2": { flushed: false, ledger: classicReply } },
      // An edit of the first reply waits on keep-or-discard; a turn was deleted; one is under way.
      pauses: [{ messageId: "m-c2", content: contentId("The harbour is quiet, edited.") }],
      tombstones: [{ messageId: "m-c9", swipeHash: contentId("A deleted reply."), recHash: "rechash" }],
      windows: ["gen-live"],
    }),
  );
  await user(`runs/${CHAT.classic}/journal.json.tmp`, "{ half a journal");
  await user(`runs/${CHAT.classic}/snapshots.json`, "[]");
  await user(`runs/${CHAT.classic}/chips.json`, JSON.stringify([{ id: "chip-1", kind: "review", messageId: "m-c2", label: "Review", payload: {}, expires: "never", actions: [{ id: "apply", label: "Apply" }] }]));
  await user(`runs/${CHAT.classic}/staged.json`, JSON.stringify({ action: "space.walk", request: { to: "pier" }, params: { to: "pier" }, source: "map", label: "Walk to the pier", after: "m-c4" }));
  await user(`runs/${CHAT.classic}/staged.json.corrupt-1700000000000`, "{ damaged");
  await user(`runs/${CHAT.classic}/plans.json`, JSON.stringify({ "seed-2": { outcome: ["x"], montage: [], outline: [] } }));
  await user(`runs/${CHAT.classic}/outcome-notes.json`, JSON.stringify({ v: 1 }));
  await user(`runs/${CHAT.classic}/prefs.json`, JSON.stringify({ v: 1, mapDisplay: "grid", tidyLeft: [] }));
  await user(`runs/${CHAT.classic}/inspector.json`, JSON.stringify({ v: 2, records: [] }));
  await user(`runs/${CHAT.classic}/diagnostics.json`, JSON.stringify({ v: 1, records: [] }));
  // The classic chat was on the depth engine of an earlier build, which left its files.
  for (const [path, text] of Object.entries(depthFiles(CHAT.classic))) await user(path, text);
  await user(`runs/${CHAT.agents}/journal.json`, journal(CHAT.agents, "an-earlier-run"));
  // The branch's journal holds a record its message doesn't yet: today's reader flushes it back.
  await user(`runs/${CHAT.branch}/journal.json`, journal(CHAT.branch, "seed-classic", { messages: { "m-c2-b": { flushed: false, ledger: classicReply } } }));
  await user(`runs/${CHAT.agents}/scene.json`, JSON.stringify({ v: 1, scene: "the gate" }));
  await user(`runs/${CHAT.agents}/chips.json`, "[ damaged");
  await user(`runs/${CHAT.harness}/journal.json`, "{ this journal was cut short");
  await user(`runs/${CHAT.gone}/journal.json`, journal(CHAT.gone, "seed-gone"));
  await user(`runs/${CHAT.gone}/chips.json`, "[]");

  // The extension's own storage, wherever this layout keeps it.
  await put(join(extensionFolder, "agents/build.json"), JSON.stringify({ build: "b2", previous: "b1", at: 1 }));
  await put(join(extensionFolder, "diagnostics/backend.log"), "backend started\n");
  await put(join(extensionFolder, "loopback/registry.json"), JSON.stringify({ v: 1, keys: {}, relays: {}, shared: { enabled: false, by: null, at: null } }));

  // Another user's storage: never read.
  await put(join(lumiverse, "users", OTHER_USER, "extensions", IDENT, "settings.json"), JSON.stringify({ v: 1 }));

  // Lumiverse's database.
  const data = chatsOf(worldId, rev, { agents: agentHashes, harness: { segment: sha(segment), workspace: turnIndex } });
  writeDatabase(join(lumiverse, "lumiverse.db"), layout, data);

  // The runtime's folders: its config (and another extension's, not read), its own folder, its installed copy and unit.
  const configDir = join(home, ".config", "lumiah");
  const dataDir = join(home, ".local", "share", "lumiah");
  const unitFile = join(home, ".config", "systemd", "user", "lumiah-home.service");
  const installed = join(dataDir, IDENT, "lumiah.js");
  const config = (name: string, extension: string, service: JsonObject | null): string =>
    `${JSON.stringify({ lumiah: 1, runtime: { name, base: BASE, extension, listen: "127.0.0.1", port: 7861, relay: "relay-1", secret: "relay secret", session: { username: USERNAME, token: "session-token", savedAt: 1 }, tuning: {}, memory: "1G", autoUpdate: true, source: null, service } }, null, 2)}\n`;
  await put(join(configDir, `${RUNTIME}.json`), config(RUNTIME, IDENT, { manager: "systemd", unit: "lumiah-home.service", file: unitFile, bun: "/opt/bun/bin/bun", script: installed }));
  await put(join(configDir, `${RUNTIME}.json.4242.tmp`), "{ half a config");
  await put(join(configDir, "standalone.json"), config("standalone", "lumi_ah", null));
  await put(unitFile, "[Service]\nExecStart=/opt/bun/bin/bun lumiah.js serve\n");
  await put(installed, "// the runtime\n");
  await put(`${installed}.4242.tmp`, "// half the runtime");
  const runtimeDir = join(dataDir, "runtimes", RUNTIME);
  // One connection with a key, a header with its value and one dropped, and an entry no runtime reads; a sign-in and the installation's id.
  await put(join(runtimeDir, "connections.json"), JSON.stringify({ lumiah: 1, default: "conn-1", connections: [{ id: "conn-1", name: "Main", provider: "deepseek", auth: "key", model: "deepseek-chat", effort: "high", headers: { "X-Team": SECRETS.header, "X-Gone": null } }, { id: "conn-x" }] }));
  await put(join(runtimeDir, "secrets.json"), JSON.stringify({ lumiah: 1, keys: { "conn-1": SECRETS.key }, signins: { anthropic: { type: "oauth", access: SECRETS.access, refresh: SECRETS.refresh, expires: 1 } }, device: "device-0001" }));
  await put(join(runtimeDir, "waiting.json"), JSON.stringify({ pid: 4242, since: 1, seen: 2 }));
  // The working copy: the copy the mirror's mark names, holding a document and a blob it hasn't sent, a removal it hasn't sent, and a journal entry cut off before its write.
  const copy = join(runtimeDir, "store", copyFolderOf(BASE, USERNAME, IDENT));
  await put(join(copy, "identity.json"), JSON.stringify({ v: 1, kind: "working-copy", lumiverse: BASE, user: USERNAME, extension: IDENT, copy: "copy-0001", count: 5, seen: 0 }, null, 2));
  const unsentPath = `chats/${CHAT.harness}/session.json`;
  const unsentText = JSON.stringify({ v: 1, kind: "session", compactAsked: 1_700_000_100_000 });
  await put(join(copy, "docs", unsentPath), unsentText);
  await put(join(copy, "journal", `d.${sha(unsentPath)}`), JSON.stringify({ path: unsentPath, at: 2 }));
  await put(join(copy, "docs", "jobs/job-2.json"), JSON.stringify({ v: 1, kind: "job", job: "job-2" }));
  await put(join(copy, "journal", `d.${sha("jobs/job-2.json")}`), JSON.stringify({ path: "jobs/job-2.json", at: 3 }));
  await put(join(copy, "docs", "sides/side-old.json"), "");
  await put(join(copy, "journal", `d.${sha("sides/side-old.json")}`), JSON.stringify({ path: "sides/side-old.json", at: 4 }));
  const unsentBlob = "a transcript the runtime hasn't sent";
  await put(join(copy, "blobs", sha(unsentBlob).slice(0, 2), sha(unsentBlob)), unsentBlob);
  await put(join(copy, "journal", `b.${sha(unsentBlob)}`), JSON.stringify({ at: 5 }));
  await put(join(copy, "journal", `d.${sha("upkeep.json")}`), JSON.stringify({ path: "upkeep.json", at: 6 }));
  await put(join(copy, "docs", `chats/${CHAT.harness}/learned.json`), learnedArea);
  await put(join(copy, "tmp", "0123abcd"), "partial");

  return {
    root,
    sources: { lumiverse, identifier: IDENT, userId: USER, runtime: { configDir, dataDir } },
    userFolder,
    extensionFolder,
    worldId,
    revisions: [rev, rev2],
    unsentDoc: `harness/docs/${unsentPath}`,
    unsentRemoval: "harness/docs/sides/side-old.json",
    missingBlob,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/** Every file under a folder, by path, with its SHA-256: what a run must leave exactly as it found. */
export async function treeSums(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of await walk(root)) out.set(f.path, sha((await readBytes(join(root, f.path))) ?? new Uint8Array()));
  return out;
}
