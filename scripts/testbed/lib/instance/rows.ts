// The instance read back store by store: one row for every row of STANDALONE-PLAN §15.2's first
// table (l.1592-1639), in its order, then its second table (l.1647-1654) and its leftovers paragraph
// (l.1656). Each row reads its store as the instance's user, through today's build's own reads: the
// engine's page requests (`lre.*`), its harness pages' (`lah.*`), its CLI, and Lumiverse's own REST
// API, by the ids the run recorded in `state.json`. It goes to disk only where no read of today's
// build reaches the store, or where every read that does would change it, and `via` says which.
//
// "Today" is RPE's `main` (3b318f02) with LumiAH 6a38779a and Lumiverse a70f4ed2; every file:line
// below is on those (LumiAH paths start `LumiAH`, Lumiverse's `Lumiverse`, the rest are RPE's).
//
// A read changes nothing and repeats exactly. That rules out, as reads: `lah.hello`, which rewrites
// `chats.json` when a switched-on chat is gone (LumiAH `extension/backend/switch.ts:336-343`) and
// answers with the times it first ran (`extension/backend/ui.ts:387`); `lah.upkeep.get` while
// `upkeep.json` is missing (LumiAH `core/upkeep.ts:296-300`); `lah.story.get` (`story.ts:50-55`);
// `lah.spend.get`, whose days count back from now (LumiAH `core/spend.ts:355-411`); and every read of
// today's build that names `chat:reader-cases`: opening that chat's ledger replaces its journal from
// another run (`src/backend/ledger-io.ts:2533-2541`, `:367`) and a read of its chips sets the damaged
// file aside (`src/backend/chips.ts:77`, `src/backend/stored-json.ts:17-31`), which is item 4's to
// rehearse. So no read here names that chat except Lumiverse's own, and no loop runs over chat keys.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context";
import { IDENTIFIER, userStorage } from "../env";
import type { Message } from "../lumiverse";
import type { Json } from "../record";
import { credentialsFile, type InstanceEnv, lumiahPath, runtimeXdg, type Who } from "./env";

export interface RowRead {
  /** Which of today's own reads gave it: "lre.<type> <op>", "lah.<type>", "cli <command>", "GET <Lumiverse path>"; or "disk: <why no read of today's build reaches it>". */
  via: string;
  /** How many things of this row were read back. 0 fails the report. */
  found: number;
  /** What was read that the script itself made: the same on every run from nothing. No ids, no times, no text or counts the model chose. */
  facts: Json;
  /** What the model wrote or chose (how many mind files, which characters were cast): compared between two runs only for being there. */
  played?: Json;
  /** Ids of what was read (chats, messages, revisions, entries, files named by ids): set aside when two runs are compared, kept for the migration's comparison. */
  ids?: Json;
}

export interface Row {
  /** Short stable key, e.g. "worlds", "journal", "forget". */
  id: string;
  /** The plan's own words for the row (§15.2 "Today" column), shortened. */
  today: string;
  /** How the instance holds it: made by play on today's build, made by the set-up steps, or planted by the script (only what today's build cannot make). */
  made: "play" | "setup" | "planted";
  read(ctx: Ctx, env: InstanceEnv): Promise<RowRead>;
}

/** What the lead's planting steps record under `planted:<name>` (one item or an array). */
export interface Planted {
  row: "depth" | "leftovers" | "unnamed" | "reader-writes" | "departures";
  /** A short stable label. */
  kind: string;
  made: "play" | "planted";
  where: "storage" | "chat-metadata" | "message-metadata";
  /** storage: from the owner's storage root; chat-metadata: a dotted key; message-metadata: `<messageId>:<swipe>`. */
  path: string;
  /** The state key of the chat it is in, for the metadata kinds and a file of a chat's run. */
  chat?: string;
}

/** One record of a message's ledger, as stored (`src/shared/ledger.ts:578-646`): only what the rows count. */
interface StoredRec {
  path?: string;
  events?: { type?: string }[];
  post?: { kind?: string; events?: { type?: string }[] }[];
  undone?: unknown[];
  keep?: { [key: string]: unknown };
  accepted?: unknown;
  dropped?: unknown[];
  status?: string;
  session?: unknown;
  agents?: unknown;
  memoryNext?: unknown;
  finalEdits?: unknown;
  finalParts?: unknown;
  prompts?: unknown;
  diag?: unknown;
  harness?: { turns?: unknown[]; record?: unknown; unplayed?: string; departures?: unknown[] };
  story?: { beats?: unknown[]; struck?: unknown[]; cast?: unknown[]; drafts?: unknown[] };
}

/** A message's ledger as stored: records by swipe, and markers (`src/shared/ledger.ts:648`). */
export interface StoredLedger {
  swipes: { [swipe: string]: StoredRec };
  markers?: { kind?: string }[];
}

/** The ledger in a message's metadata bag, inline or in `lumi_rp_engine:<i>` chunks under a `{v, chunks, hash}` header (`src/backend/ledger-io.ts:57-80`). */
export function ledgerOf(bag: { [key: string]: unknown } | undefined): StoredLedger | null {
  const own = bag?.[IDENTIFIER];
  if (own === null || typeof own !== "object") return null;
  const head = own as { swipes?: unknown; chunks?: unknown };
  if (head.swipes !== undefined) return own as StoredLedger;
  if (typeof head.chunks !== "number") return null;
  let text = "";
  for (let i = 0; i < head.chunks; i++) {
    const part = bag?.[`${IDENTIFIER}:${i}`];
    if (typeof part !== "string") return null;
    text += part;
  }
  return JSON.parse(text) as StoredLedger;
}

// ------------------------------------------------------------------ ids, chats and files

/**
 * The chats today's own reads may name: the play steps' and the store steps'. Never `chat:reader-cases`
 * (see the head of this file), nor `chat:set-aside`, whose leftovers are read on disk.
 */
const PLAYED = ["chat:classic", "chat:agents", "chat:harness", "chat:branch", "stores:chat:kept", "stores:chat:held", "stores:chat:cut"] as const;
/** The harness's chats among them. */
const HARNESS_CHATS = ["chat:harness", "stores:chat:cut"] as const;
/** Every chat key the run records, for Lumiverse's own reads and for naming an id by its key. */
const ALL_CHATS = [...PLAYED, "chat:deleted", "chat:reader-cases", "chat:set-aside"] as const;

/** A recorded id: a string, or a record holding one as `id`. */
function idOf(ctx: Ctx, key: string): string | undefined {
  const v = ctx.log.get<Json>(key);
  if (typeof v === "string") return v;
  return v !== null && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" ? v.id : undefined;
}

/** The recorded chats among `keys`, as [key, id]. */
function chatsOf(ctx: Ctx, keys: readonly string[]): [string, string][] {
  return keys.flatMap((key) => {
    const id = idOf(ctx, key);
    return id === undefined ? [] : [[key, id] as [string, string]];
  });
}

/** An id named by its key (a chat, a connection, a user), so facts carry no id; "other" for one no key names. */
function keyOf(ctx: Ctx, id: string, keys: readonly string[]): string {
  return keys.find((k) => idOf(ctx, k) === id) ?? "other";
}

function planted(ctx: Ctx, name: string): Planted[] {
  const v = ctx.log.get<Json>(`planted:${name}`);
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as unknown as Planted[];
}

const owner = (ctx: Ctx, env: InstanceEnv): string => userStorage(env, ctx.userId);

/** The extension's own storage for a system-wide install (Lumiverse `src/spindle/manager.service.ts:719-721,2109-2113`). */
const extensionStorage = (env: InstanceEnv): string => join(env.dataDir, "extensions", IDENTIFIER, "storage");

/** A JSON file of the owner's storage or the runtime's folders, parsed; null when it is missing. */
function json(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null;
}

/** Every file under `dir`, by its path from `dir`, sorted; none when it is missing. */
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(join(dir, at))) {
      const rel = at === "" ? name : `${at}/${name}`;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

function record(v: unknown): { [key: string]: unknown } {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as { [key: string]: unknown }) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A paged list as Lumiverse answers it: an array, or `{data}`. */
function rows(v: unknown): { [key: string]: unknown }[] {
  return (Array.isArray(v) ? v : list(record(v).data)).map(record);
}

function count(byKey: { [key: string]: number }, key: string): void {
  byKey[key] = (byKey[key] ?? 0) + 1;
}

/** Each message's records, with the message, through Lumiverse's own read of the chat's messages. */
async function recordsOf(ctx: Ctx, chatId: string): Promise<{ message: Message; swipe: string; rec: StoredRec }[]> {
  return (await ctx.host.messages(chatId)).flatMap((message) =>
    Object.entries(ledgerOf((message.extra as { spindle_metadata?: { [key: string]: unknown } } | undefined)?.spindle_metadata)?.swipes ?? {}).map(([swipe, rec]) => ({ message, swipe, rec })),
  );
}

/** The engine's part of a chat's metadata (`lumi_rp_engine`: run, prefs, agents; `src/shared/ledger.ts:656`), through Lumiverse's own read. */
async function metadataOf(ctx: Ctx, chatId: string): Promise<{ [key: string]: unknown }> {
  return record((await ctx.host.chat(chatId)).metadata);
}

/** The owner's runtime as the set-up recorded it: `{name, unit, port, config}`. */
function runtimeOf(ctx: Ctx, who: Who): { name: string; unit: string; port: number; config: string } {
  const r = record(ctx.log.get<Json>(`runtime:${who}`));
  if (typeof r.name !== "string" || typeof r.config !== "string") throw new Error(`runtime:${who} isn't recorded`);
  return { name: r.name, unit: String(r.unit ?? ""), port: Number(r.port), config: r.config };
}

/** The owner's runtime folder: `<XDG_DATA_HOME>/lumiah/runtimes/<name>/` (LumiAH `src/runtime/config.ts:84-90`). */
const runtimeDir = (env: InstanceEnv, name: string): string => join(runtimeXdg(env).XDG_DATA_HOME, "lumiah", "runtimes", name);

// ------------------------------------------------------------------ the rows

export const ROWS: Row[] = [
  {
    id: "worlds",
    today: "Worlds: the index, every revision, the draft, the history notes (user storage, worlds/)",
    made: "play",
    async read(ctx) {
      const worldId = idOf(ctx, "worldId") ?? "";
      // Build's world list and world page (`src/backend/dispatch.ts:1098-1104`), and its editor's draft (`dispatch.ts:813-815`).
      const index = await ctx.socket.lre<{ worlds?: { id: string; name: string }[] }>("lre.world", { op: "list" });
      const got = await ctx.socket.lre<{ revision: string; history: { revision: string; source: string; note?: string }[] }>("lre.world", { op: "get", worldId });
      const draft = await ctx.socket.lre<{ stored: boolean; version: number }>("lre.editor", { op: "get", worldId, base: null });
      const named = index.worlds?.find((w) => w.id === worldId);
      return {
        via: "lre.world list, lre.world get, lre.editor get",
        found: (named ? 1 : 0) + got.history.length + (draft.stored ? 1 : 0),
        facts: { name: named?.name ?? null, revisions: got.history.length, notes: got.history.map((h) => ({ source: h.source, note: h.note ?? null })), draftStored: draft.stored },
        ids: { worldId, head: got.revision, revisions: got.history.map((h) => h.revision) },
      };
    },
  },
  {
    id: "world-parts",
    today: "What a world holds: packs, kinds, entities, places, maps, rules, calendar, lore with its holders, lore index and pins, the start (inside the world document)",
    made: "play",
    async read(ctx) {
      const got = await ctx.socket.lre<{ world: { [part: string]: unknown } }>("lre.world", { op: "get", worldId: idOf(ctx, "worldId") ?? "" });
      const size = (v: unknown): number => (Array.isArray(v) ? v.length : v !== null && typeof v === "object" ? Object.keys(v).length : v === undefined || v === null || v === "" ? 0 : 1);
      const parts = Object.keys(got.world).sort();
      const filled = parts.filter((p) => size(got.world[p]) > 0);
      const lore = Object.values(record(got.world.lore)).map(record);
      return {
        via: "lre.world get",
        found: filled.length,
        facts: {
          filled,
          empty: parts.filter((p) => size(got.world[p]) === 0),
          sizes: Object.fromEntries(filled.map((p) => [p, size(got.world[p])])),
          maps: Object.values(record(got.world.maps)).map((m) => ({ id: String(record(m).id), cellMeters: (record(m).cellMeters as Json) ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
          kept: lore.filter((l) => l.holders !== undefined || l.gate !== undefined).map((l) => ({ id: String(l.id), holders: (l.holders as Json) ?? null, gate: (l.gate as Json) ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
        },
      };
    },
  },
  {
    id: "jobs-lore-ids-secrecy",
    today: "Build jobs and their proposals; lore ids; secrecy backups (jobs.json, lore-ids.json, secrecy/)",
    made: "play",
    async read(ctx, env) {
      const worldId = idOf(ctx, "worldId") ?? "";
      const bookId = idOf(ctx, "bookId") ?? "";
      // Build → Jobs (`dispatch.ts:870-872`); Build → Lore → Secrecy's preview (`dispatch.ts:975-977`), which says when the move was applied and names a damaged backup (`src/shared/protocol.ts:923-932`).
      const jobs = await ctx.socket.lre<{ jobs?: { kind: string; status: string; result?: unknown }[] }>("lre.job", { op: "list", worldId });
      const plan = await ctx.socket.lre<{ book?: { state: string; applied: number | null; damaged: string | null } }>("lre.secrecy", { op: "preview", bookId });
      // The id map and the backups themselves: no request returns either (`src/backend/lore-ids.ts:85`, read to give ids; `src/backend/secrecy-migration.ts:290-302`, read to restore).
      const ids = record(json(join(owner(ctx, env), "lore-ids.json")));
      const backups = files(join(owner(ctx, env), "secrecy")).filter((f) => f.endsWith(".json"));
      const idCount = Object.keys(record(ids.ids)).length;
      return {
        via: "lre.job list, lre.secrecy preview; disk: lore-ids.json and secrecy/ (no request returns the id map or a backup's file)",
        found: (jobs.jobs ?? []).length + idCount + backups.length,
        facts: { jobs: (jobs.jobs ?? []).map((j) => ({ kind: j.kind, status: j.status, proposals: list(record(j.result).proposals).length })), loreIds: idCount, secrecy: { state: plan.book?.state ?? null, applied: plan.book?.applied !== null && plan.book?.applied !== undefined, damaged: plan.book?.damaged ?? null }, backups: backups.length },
        ids: { backups },
      };
    },
  },
  {
    id: "chat-runs",
    today: "Which world and revision each chat plays, its seed and when it started (chat metadata)",
    made: "play",
    async read(ctx) {
      const out: { [key: string]: Json } = {};
      const runs: { [key: string]: Json } = {};
      for (const [key, chatId] of chatsOf(ctx, ALL_CHATS.filter((k) => k !== "chat:deleted"))) {
        const run = record((await metadataOf(ctx, chatId))[IDENTIFIER]);
        if (typeof run.worldId !== "string") continue;
        out[key] = { world: run.worldId === idOf(ctx, "worldId") ? "worldId" : "other", seed: typeof run.runSeed === "string", started: typeof run.startedAt === "number" };
        runs[key] = { revision: (run.revision as Json) ?? null, runSeed: (run.runSeed as Json) ?? null };
      }
      return { via: "GET /api/v1/chats/:id (metadata.lumi_rp_engine)", found: Object.keys(out).length, facts: out, ids: runs };
    },
  },
  {
    id: "engine-switch",
    today: "Which chats the engine is switched on for, which engine each used, each chat's story choice (chat metadata, LumiAH chats.json)",
    made: "play",
    async read(ctx, env) {
      const engines: { [key: string]: Json } = {};
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // GM → This chat: with no part given it only reads (`dispatch.ts:844-868`; `protocol.ts:466-479`).
        const k = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId });
        engines[key] = k.engine ?? "classic";
      }
      const on: { [key: string]: Json } = {};
      // LumiAH's switch for a chat (`LumiAH extension/backend/switch.ts:162-178`), which writes nothing.
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) on[key] = (await ctx.socket.lah<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on;
      // The story choice: `lah.chat.story.get` also asks RPE's claim hook (LumiAH `switch.ts:204-218`), not shown to change nothing.
      const stored = record(json(join(owner(ctx, env), "harness", "chats.json")));
      const story = Object.keys(record(stored.story)).map((id) => keyOf(ctx, id, ALL_CHATS)).sort();
      return {
        via: "lre.chat.knowledge, lah.chat.get; disk: harness/chats.json for the story choice",
        found: Object.keys(engines).length + Object.keys(on).length + story.length,
        facts: { engines, harnessOn: on, storyChoices: story, switchedOn: Object.keys(record(stored.on)).map((id) => keyOf(ctx, id, ALL_CHATS)).sort() },
      };
    },
  },
  {
    id: "ledgers",
    today: "Each chat's ledger for every reply and swipe, and the journal runs/<chat>/journal.json (message metadata, journal)",
    made: "play",
    async read(ctx, env) {
      const played: { [key: string]: Json } = {};
      const facts: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        const recs = await recordsOf(ctx, chatId);
        const posts: { [kind: string]: number } = {};
        for (const { rec } of recs) for (const p of rec.post ?? []) count(posts, p.kind ?? "?");
        // A chat's state view: its status says whether the journal holds a pause, `pending` its held writes (`src/backend/view.ts:1029,1040,1050` on main).
        const { view } = await ctx.socket.lre<{ view: { status: string; pending: unknown[] } }>("lre.state.get", { chatId });
        // GM → This chat's refused writes (`lre.gm.part refused`, `src/shared/gm-parts.ts:13`, `src/shared/state-view.ts:583` on main).
        const refused = list((await ctx.socket.lre<{ value?: unknown }>("lre.gm.part", { chatId, part: "refused" })).value).length;
        // The journal's tombstones: no read of today's build returns them (the view reads only its pauses and held writes, the GM view its held and refused ones).
        const journal = record(json(join(owner(ctx, env), "runs", chatId, "journal.json")));
        found += recs.length + (Object.keys(journal).length > 0 ? 1 : 0);
        facts[key] = { status: view.status, journal: Object.keys(journal).length > 0, held: view.pending.length };
        played[key] = { records: recs.length, turns: recs.filter((r) => r.rec.path !== undefined && r.rec.path !== "").length, posts, undone: recs.reduce((n, r) => n + (r.rec.undone ?? []).length, 0), keeps: recs.filter((r) => r.rec.keep !== undefined).length, accepted: recs.filter((r) => r.rec.accepted !== undefined).length, refused, tombstones: list(journal.tombstones).length };
      }
      return { via: "GET /api/v1/chats/:id/messages, lre.state.get, lre.gm.part refused; disk: runs/<chat>/journal.json for its tombstones", found, facts, played };
    },
  },
  {
    id: "panel-requests",
    today: "What you asked for through a panel, recorded on your own messages (message metadata)",
    made: "play",
    async read(ctx) {
      const asked: Json[] = [];
      const ids: Json[] = [];
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        for (const m of await ctx.host.messages(chatId)) {
          // A user message's intent (`src/backend/dispatch.ts:494`).
          const intent = record(record((m.extra as { spindle_metadata?: unknown } | undefined)?.spindle_metadata)[IDENTIFIER]);
          if (!m.is_user || typeof intent.action !== "string") continue;
          asked.push({ chat: key, action: intent.action, source: (intent.source as Json) ?? null, staged: intent.staged === true });
          ids.push(m.id);
        }
      }
      return { via: "GET /api/v1/chats/:id/messages", found: asked.length, facts: asked, ids };
    },
  },
  {
    id: "pack-state",
    today: "All pack state folded from the ledger: money, items, places, quests, groups, calendar, minds… (folded)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: Json } = {};
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // The chat's folded head as one document (`dispatch.ts:647-656`): read only.
        const head = await ctx.socket.lre<{ state: { packs?: { [pack: string]: unknown }; entities?: { [id: string]: unknown } } }>("lre.chat.export", { chatId });
        played[key] = { packs: Object.keys(head.state.packs ?? {}).sort(), entities: Object.keys(head.state.entities ?? {}).length };
      }
      return { via: "lre.chat.export", found: Object.keys(played).length, facts: { chats: Object.keys(played).sort() }, played };
    },
  },
  {
    id: "secret-holdings",
    today: "Who holds which lore secret, and the two settings that decide when a holding counts (minds state; settings)",
    made: "play",
    async read(ctx) {
      const classic = idOf(ctx, "chat:classic") ?? "";
      const fact = (n: number): string => `wi:${idOf(ctx, "bookId") ?? ""}:${idOf(ctx, "entryId") ?? ""}:${n}`;
      // GM → Minds' part of the GM view (`dispatch.ts:623-645`; parts `src/shared/gm-parts.ts:13`).
      const minds = JSON.stringify(await ctx.socket.lre<unknown>("lre.gm.part", { chatId: classic, part: "minds" }));
      const { settings } = await ctx.socket.lre<{ settings: { minds: { knowledge: { enabled: boolean; threshold: number } } } }>("lre.settings.get", {});
      const held = [0, 1].filter((n) => minds.includes(fact(n)));
      return { via: "lre.gm.part minds, lre.settings.get", found: held.length + 1, facts: { marksHeld: held, knowledge: settings.minds.knowledge } };
    },
  },
  {
    id: "chat-places",
    today: "A chat's own places, paths and maps (events in its ledger)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: number } = {};
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // `engine.world` events (`src/engine/world-draft.ts:34`) in a record's events or its post entries.
        let n = 0;
        for (const { rec } of await recordsOf(ctx, chatId)) n += [...(rec.events ?? []), ...(rec.post ?? []).flatMap((p) => p.events ?? [])].filter((e) => e.type === "engine.world").length;
        if (n > 0) played[key] = n;
      }
      const total = Object.values(played).reduce((a, b) => a + b, 0);
      return { via: "GET /api/v1/chats/:id/messages", found: total, facts: { chats: Object.keys(played).sort() }, played };
    },
  },
  {
    id: "story-record",
    today: "The story record: beats, struck beats, cast, drafts (in the ledger)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        // `Rec.story{beats,struck,cast,drafts}` (`src/shared/ledger.ts:483-570`).
        const sum = { beats: 0, struck: 0, cast: 0, drafts: 0 };
        for (const { rec } of await recordsOf(ctx, chatId)) for (const part of ["beats", "struck", "cast", "drafts"] as const) sum[part] += list(rec.story?.[part]).length;
        found += sum.beats + sum.struck + sum.cast + sum.drafts;
        played[key] = sum;
      }
      return { via: "GET /api/v1/chats/:id/messages", found, facts: { chats: Object.keys(played).sort() }, played };
    },
  },
  {
    id: "unplayed",
    today: "A reply that stands with no turn played, and why (stopped, failed, restarted) (the harness engine's record on the reply)",
    made: "play",
    async read(ctx) {
      const reasons: Json[] = [];
      const ids: Json[] = [];
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        for (const { message, swipe, rec } of await recordsOf(ctx, chatId)) {
          if (typeof rec.harness?.unplayed !== "string") continue;
          reasons.push({ chat: key, why: rec.harness.unplayed, onTurn: (rec.harness.turns ?? []).length > 0 });
          ids.push(`${message.id}:${swipe}`);
        }
      }
      return { via: "GET /api/v1/chats/:id/messages (Rec.harness.unplayed)", found: reasons.length, facts: reasons, ids };
    },
  },
  {
    id: "departures",
    today: "Where a reply says something against what its turn decided, a line each (the same record)",
    made: "planted",
    async read(ctx) {
      // Today's build writes no departures (`src/shared/ledger.ts:450-457` declares them; nothing on main writes or reads them), so the lead plants one.
      const facts: Json[] = [];
      const ids: Json[] = [];
      let found = 0;
      for (const p of planted(ctx, "departures")) {
        const chatId = idOf(ctx, p.chat ?? "") ?? "";
        const [messageId, swipe] = p.path.split(":");
        const hit = (await recordsOf(ctx, chatId)).find((r) => r.message.id === messageId && r.swipe === swipe);
        const lines = list(hit?.rec.harness?.departures).length;
        found += lines;
        facts.push({ kind: p.kind, chat: p.chat ?? null, lines });
        ids.push(p.path);
      }
      return { via: "GET /api/v1/chats/:id/messages (Rec.harness.departures)", found, facts, ids };
    },
  },
  {
    id: "mind-files",
    today: "Mind files per character (core, now, memory, beliefs, people, plans, outline, profile) (LumiAH's chat area)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        // Harness → Workspace's chat area (`LumiAH src/shared/ui.ts:1524`; `core/areas.ts:106-109,230-240`); it writes only for a branch's first read of `learned` (`core/areas.ts:80-103`).
        const area = await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId, area: "chat" });
        const minds = (area.files ?? []).map((f) => f.path.replace(/^\//, "")).filter((p) => p.startsWith("minds/")).sort();
        found += minds.length;
        played[key] = minds;
      }
      return { via: "lah.ws.list (area chat)", found, facts: { chats: Object.keys(played).sort() }, played };
    },
  },
  {
    id: "notebook",
    today: "The Author's notebook, scene, prepare.md, story.md, saved lore and lore drafts (the same chat area)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        const area = await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId, area: "chat" });
        const notes = (area.files ?? []).map((f) => f.path.replace(/^\//, "")).filter((p) => !p.startsWith("minds/")).sort();
        found += notes.length;
        played[key] = notes;
      }
      return { via: "lah.ws.list (area chat)", found, facts: { chats: Object.keys(played).sort() }, played };
    },
  },
  {
    id: "learned-user-files",
    today: "learned/ and your own ~/ files (LumiAH's docs)",
    made: "play",
    async read(ctx) {
      const learned: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        const area = await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId, area: "learned" });
        const paths = (area.files ?? []).map((f) => f.path).sort();
        found += paths.length;
        learned[key] = paths;
      }
      const user = (await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId: null, area: "user" })).files ?? [];
      found += user.length;
      return { via: "lah.ws.list (areas learned and user)", found, facts: { learned, user: user.map((f) => f.path).sort() } };
    },
  },
  {
    id: "guidance",
    today: "Your GUIDANCE.md (your ~/ files in LumiAH)",
    made: "play",
    async read(ctx) {
      // Harness → Guidance (`LumiAH src/shared/ui.ts:888-905,1546`); with no chat it reads `~/` only.
      const g = await ctx.socket.lah<{ levels: { id: string; text: string; hash: string | null }[] }>("lah.guidance.get", { chatId: null });
      const user = g.levels.find((l) => l.id === "user");
      return { via: "lah.guidance.get", found: user?.hash ? 1 : 0, facts: { chars: user?.text.length ?? 0 }, ids: { hash: user?.hash ?? null } };
    },
  },
  {
    id: "agents-workspace",
    today: "The agents engine's workspace, global workspace and learned area (ledger events, agents/global.json, chat metadata, blobs)",
    made: "play",
    async read(ctx) {
      const facts: { [key: string]: Json } = {};
      const played: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, ["chat:agents", "stores:chat:kept"])) {
        // GM → Workspace's list (`src/shared/protocol.ts:1098`; `dispatch.ts:1008-1021`).
        const ws = await ctx.socket.lre<{ files?: { path: string; pinned: boolean; learned: boolean; transcript?: true }[] }>("lre.workspace", { chatId, op: "list" });
        const own = (ws.files ?? []).filter((f) => f.transcript !== true);
        found += (ws.files ?? []).length;
        facts[key] = own.map((f) => ({ path: f.path, learned: f.learned, pinned: f.pinned })).sort((a, b) => a.path.localeCompare(b.path));
        played[key] = { transcripts: (ws.files ?? []).length - own.length };
      }
      return { via: "lre.workspace list", found, facts, played };
    },
  },
  {
    id: "assistant-threads",
    today: "GM assistant threads (chat metadata and blobs; LumiAH sides/)",
    made: "play",
    async read(ctx) {
      const played: { [key: string]: Json } = {};
      const ids: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // GM → Assistant (`dispatch.ts:1008-1021`).
        const v = await ctx.socket.lre<{ thread: { id: string; role: string }[] }>("lre.assistant", { chatId, op: "get" });
        if (v.thread.length === 0) continue;
        found += v.thread.length;
        played[key] = v.thread.length;
        ids[key] = v.thread.map((m) => m.id);
      }
      // LumiAH's side sessions (`LumiAH core/side.ts:58-61,78-81`), in which a harness chat's assistant answers.
      const sides = (await ctx.socket.lah<{ sessions: { id: string; chatId: string }[] }>("lah.side.list", {})).sessions;
      return { via: "lre.assistant get, lah.side.list", found: found + sides.length, facts: { chats: Object.keys(played).sort(), sides: sides.map((s) => keyOf(ctx, s.chatId, ALL_CHATS)).sort() }, played, ids: { ...ids, sides: sides.map((s) => s.id) } };
    },
  },
  {
    id: "sessions",
    today: "Sessions, compaction summaries and transcripts, and everything else an old engine recorded on a reply (the ledger and blobs)",
    made: "play",
    async read(ctx, env) {
      const parts = ["session", "agents", "memoryNext", "finalEdits", "finalParts", "prompts", "diag"] as const;
      const played: { [key: string]: Json } = {};
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        const by: { [part: string]: number } = {};
        for (const { rec } of await recordsOf(ctx, chatId)) {
          for (const p of parts) if (rec[p] !== undefined) count(by, p);
          if (rec.harness?.record !== undefined) count(by, "harness.record");
        }
        found += Object.values(by).reduce((a, b) => a + b, 0);
        if (Object.keys(by).length > 0) played[key] = by;
      }
      // Both blob stores, whose files no request lists (`src/backend/agents/blobs.ts:27`; LumiAH `extension/backend/reads.ts:24-27`).
      const blobs = { agents: files(join(owner(ctx, env), "agents", "blobs")).length, harness: files(join(owner(ctx, env), "harness", "blobs")).length };
      return { via: "GET /api/v1/chats/:id/messages; disk: agents/blobs and harness/blobs (no request lists a blob store)", found: found + blobs.agents + blobs.harness, facts: { chats: Object.keys(played).sort() }, played: { ...played, blobs } };
    },
  },
  {
    id: "rollback",
    today: "A rollback of the agents engine's last compaction asked for and not applied yet (chat metadata)",
    made: "play",
    async read(ctx) {
      const chatId = idOf(ctx, "stores:chat:kept") ?? "";
      const agents = record(record((await metadataOf(ctx, chatId))[IDENTIFIER]).agents);
      // GM → Workspace's session read says whether a rollback waits (`agents/compaction.ts:251-270`).
      const session = await ctx.socket.lre<{ session?: { rollback: string } }>("lre.workspace", { chatId, op: "session" });
      const pending = agents.rollback !== undefined && agents.rollback !== null;
      return { via: "GET /api/v1/chats/:id (metadata.lumi_rp_engine.agents.rollback), lre.workspace session", found: pending ? 1 : 0, facts: { chat: "stores:chat:kept", pending, session: session.session?.rollback ?? null } };
    },
  },
  {
    id: "review-staged",
    today: "Review cards and stored chips; staged changes (runs/<chat>/)",
    made: "play",
    async read(ctx, env) {
      const played: { [key: string]: Json } = {};
      const staged: string[] = [];
      let found = 0;
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // A chat's chips as its page shows them (`src/backend/view.ts:1046` on main), and an agent turn's review cards (`dispatch.ts:1022-1039`).
        const { view } = await ctx.socket.lre<{ view: { chips: { kind: string }[] } }>("lre.state.get", { chatId });
        const cards = HARNESS_CHATS.includes(key as (typeof HARNESS_CHATS)[number]) || key === "chat:agents" || key === "stores:chat:kept" ? (await ctx.socket.lre<{ cards: { items: { status: string }[] }[] }>("lre.review", { chatId, op: "get" })).cards : [];
        // A staged action: no request returns it whole (`src/backend/staged.ts:35-55`, read by the turn that takes it).
        const s = json(join(owner(ctx, env), "runs", chatId, "staged.json"));
        if (s !== null) staged.push(key);
        const open = cards.reduce((n, c) => n + c.items.filter((i) => i.status === "open").length, 0);
        found += view.chips.length + cards.length + (s !== null ? 1 : 0);
        played[key] = { chips: view.chips.length, cards: cards.length, open };
      }
      return { via: "lre.state.get, lre.review get; disk: runs/<chat>/staged.json", found, facts: { staged: staged.sort() }, played };
    },
  },
  {
    id: "plans-scene",
    today: "The classic pipeline's re-narrate lines and the agents engine's kept scene (runs/<chat>/plans.json, scene.json)",
    made: "play",
    async read(ctx, env) {
      const plans: string[] = [];
      const scenes: string[] = [];
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        // Read only by the classic pipeline's Re-narrate (`src/backend/plan-notes.ts:38`) and the agents engine's next turn (`src/backend/chat-prefs.ts:36-40`): no request returns either.
        if (existsSync(join(owner(ctx, env), "runs", chatId, "plans.json"))) plans.push(key);
        if (existsSync(join(owner(ctx, env), "runs", chatId, "scene.json"))) scenes.push(key);
      }
      return { via: "disk: runs/<chat>/plans.json and scene.json (only a later turn reads them)", found: plans.length + scenes.length, facts: { plans: plans.sort(), scenes: scenes.sort() } };
    },
  },
  {
    id: "pins",
    today: "Pins: the world's pins and lore pins; workspace and file pins",
    made: "play",
    async read(ctx) {
      // Build → Lore → Pins on the world's draft (`dispatch.ts:928-933`).
      const lore = await ctx.socket.lre<{ pins?: unknown }>("lre.lore", { op: "pins", worldId: idOf(ctx, "worldId") ?? "" });
      const loreCount = Object.values(record(lore.pins)).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(record(v)).length), 0);
      let pinned = 0;
      for (const [, chatId] of chatsOf(ctx, ["chat:agents", "stores:chat:kept"])) pinned += ((await ctx.socket.lre<{ files?: { pinned: boolean }[] }>("lre.workspace", { chatId, op: "list" })).files ?? []).filter((f) => f.pinned).length;
      let filePins = 0;
      for (const [, chatId] of chatsOf(ctx, HARNESS_CHATS)) filePins += ((await ctx.socket.lah<{ files?: { pins?: unknown }[] }>("lah.ws.list", { chatId, area: "chat" })).files ?? []).filter((f) => list(f.pins).length > 0 || f.pins === true).length;
      return { via: "lre.lore pins, lre.workspace list, lah.ws.list", found: loreCount + pinned + filePins, facts: { lorePins: loreCount }, played: { workspacePins: pinned, filePins } };
    },
  },
  {
    id: "settings",
    today: "Your settings: settings.json, chat prefs, runs/<chat>/prefs.json, LumiAH's settings.json and story.json",
    made: "play",
    async read(ctx, env) {
      const { settings } = await ctx.socket.lre<{ settings: { narrator: Json; tidy: { findings: number }; minds: { knowledge: { enabled: boolean; threshold: number } }; agents: { persist: { on: boolean }; compaction: { atTokens: number; keepTurns: number } } } }>("lre.settings.get", {});
      const kept = idOf(ctx, "stores:chat:kept") ?? "";
      const chat = await ctx.socket.lre<Json>("lre.chat.knowledge", { chatId: kept });
      const world = await ctx.socket.lre<{ world: { narrator?: Json; mapSettings?: Json; minds?: { thresholds?: Json } } }>("lre.world", { op: "get", worldId: idOf(ctx, "worldId") ?? "" });
      // A chat's map display and what Tidy up leaves: `lre.map` and `lre.things leave` only write them (`dispatch.ts:837-842`, `:273-276`), and no request reads the file back.
      const prefs = chatsOf(ctx, PLAYED).flatMap(([key, chatId]) => {
        const p = record(json(join(owner(ctx, env), "runs", chatId, "prefs.json")));
        return Object.keys(p).length > 0 ? [{ chat: key, mapDisplay: (p.mapDisplay as Json) ?? null, tidyLeft: list(p.tidyLeft).length }] : [];
      });
      // LumiAH's own settings rows (`LumiAH extension/backend/settings.ts:45-52`): only `lah.hello` returns them, and it writes (head of file).
      const harness = record(json(join(owner(ctx, env), "harness", "settings.json")));
      return {
        via: "lre.settings.get, lre.chat.knowledge, lre.world get; disk: runs/<chat>/prefs.json and harness/settings.json",
        found: 1 + 1 + 1 + prefs.length + (Object.keys(harness).length > 0 ? 1 : 0),
        facts: { user: { narrator: settings.narrator, tidy: settings.tidy.findings, knowledge: settings.minds.knowledge, persist: settings.agents.persist.on, compaction: settings.agents.compaction }, chat: chat, world: { narrator: world.world.narrator ?? null, mapSettings: world.world.mapSettings ?? null, thresholds: world.world.minds?.thresholds ?? null }, prefs: prefs.sort((a, b) => a.chat.localeCompare(b.chat)), harnessRows: list(harness.own).map((r) => (record(r).path as Json) ?? null) },
      };
    },
  },
  {
    id: "model-choices",
    today: "Which model each kind of work uses, where today's setting names a connection that lives in Lumiverse (settings.json, LumiAH's settings)",
    made: "play",
    async read(ctx) {
      const { settings } = await ctx.socket.lre<{ settings: { [key: string]: unknown } }>("lre.settings.get", {});
      const keys = ["connection:main", "connection:unmatched"];
      const named: { [path: string]: string } = {};
      // Every `connectionId` the settings hold, by its path: the helper, each step's route, the agents', the story models'.
      const walk = (v: unknown, path: string): void => {
        if (Array.isArray(v)) {
          v.forEach((x, i) => walk(x, `${path}[${i}]`));
          return;
        }
        if (v === null || typeof v !== "object") return;
        for (const [k, x] of Object.entries(v)) {
          if (k === "connectionId" && typeof x === "string") named[path] = keyOf(ctx, x, keys);
          else walk(x, path === "" ? k : `${path}.${k}`);
        }
      };
      walk(settings, "");
      return { via: "lre.settings.get", found: Object.keys(named).length, facts: named };
    },
  },
  {
    id: "texts",
    today: "Your edited prompts and texts (prompts.texts, LumiAH's texts, prompt sets)",
    made: "play",
    async read(ctx, env) {
      const { settings } = await ctx.socket.lre<{ settings: { prompts: { texts: { [id: string]: string } } } }>("lre.settings.get", {});
      // LumiAH's own edited texts: only `lah.hello` returns them (LumiAH `extension/backend/settings.ts:242-244`), and it writes.
      const harness = Object.keys(record(record(json(join(owner(ctx, env), "harness", "settings.json"))).texts)).sort();
      // Prompt sets: read by hash only, at a Re-narrate (`src/backend/prompts.ts:135-137,166`).
      const sets = files(join(owner(ctx, env), "prompts", "sets"));
      return { via: "lre.settings.get; disk: harness/settings.json texts, prompts/sets/ (no request lists them)", found: Object.keys(settings.prompts.texts).length + harness.length + sets.length, facts: { engine: Object.keys(settings.prompts.texts).sort(), harness }, played: { promptSets: sets.length } };
    },
  },
  {
    id: "own-agents-skills",
    today: "Your own agents and skills (LumiAH's settings.json)",
    made: "play",
    async read(ctx) {
      // Harness → Agents and Skills (`LumiAH src/shared/ui.ts:914-971`): the user's own have `source: "user"` (`core/ports.ts:389`).
      const defs = await ctx.socket.lah<{ agents: { id: string; source?: string }[]; skills: { id: string; source?: string }[] }>("lah.defs.get", {});
      const agents = defs.agents.filter((a) => a.source === "user").map((a) => a.id).sort();
      const skills = defs.skills.filter((s) => s.source === "user").map((s) => s.id).sort();
      return { via: "lah.defs.get", found: agents.length + skills.length, facts: { agents, skills } };
    },
  },
  {
    id: "approvals-jobs",
    today: "Approvals and jobs (LumiAH's docs; waiting.json is the runtime's port wait)",
    made: "play",
    async read(ctx, env) {
      // Harness → Tools' kept approvals (`LumiAH src/shared/ui.ts:829-836,1479`; `core/approved.ts:33-42`) and Harness → Jobs per chat (`views.ts:370-382`); a null chat would seed jobs in memory (`ui.ts:607-610`).
      const kept = (await ctx.socket.lah<{ kept: { chatId: string; tool: string }[] }>("lah.approvals.kept", { chatId: null })).kept;
      const jobs: { [key: string]: Json } = {};
      let found = kept.length;
      for (const [key, chatId] of chatsOf(ctx, HARNESS_CHATS)) {
        const page = await ctx.socket.lah<{ jobs: { agent: string; state: string }[] }>("lah.jobs.list", { chatId, cursor: null, limit: 200 });
        found += page.jobs.length;
        jobs[key] = page.jobs.length;
      }
      const waiting = existsSync(join(runtimeDir(env, runtimeOf(ctx, "owner").name), "waiting.json"));
      return { via: "lah.approvals.kept, lah.jobs.list; disk: the runtime folder's waiting.json", found, facts: { approved: kept.map((k) => ({ chat: keyOf(ctx, k.chatId, ALL_CHATS), tool: k.tool })).sort((a, b) => `${a.chat}${a.tool}`.localeCompare(`${b.chat}${b.tool}`)), waiting }, played: { jobs } };
    },
  },
  {
    id: "spend-upkeep",
    today: "Spend history and upkeep records (LumiAH's docs)",
    made: "play",
    async read(ctx, env) {
      const docs = join(owner(ctx, env), "harness", "docs");
      // The spend's hour files: `lah.spend.get` reads only the days counted back from now (LumiAH `core/spend.ts:355-411`), so its answer moves with the clock.
      const hours = files(join(docs, "spend")).filter((f) => f.endsWith(".json"));
      const calls = hours.reduce((n, f) => n + list(record(json(join(docs, "spend", f))).calls).length, 0);
      // Harness → Upkeep reads `upkeep.json`, and writes it only while it is missing (LumiAH `core/upkeep.ts:296-300`).
      const upkeep = existsSync(join(docs, "upkeep.json")) ? await ctx.socket.lah<{ total?: unknown; lastSweep?: unknown }>("lah.upkeep.get", {}) : null;
      return { via: "disk: harness/docs/spend/ (lah.spend.get counts days back from now); lah.upkeep.get once upkeep.json exists", found: hours.length + (upkeep ? 1 : 0), facts: { upkeep: upkeep !== null }, played: { hours: hours.length, calls } };
    },
  },
  {
    id: "runtime-connections",
    today: "Connections and keys (the runtime's own files on the server)",
    made: "setup",
    async read(ctx, env) {
      // The runtime's connection book, as Harness → Runtime lists it (`LumiAH src/shared/ui.ts:566-604,1632`; `runtime/models/book.ts:256-295`).
      const book = await ctx.socket.lah<{ connections: { provider?: string; model?: string }[] }>("lah.connections.list", {});
      // Which connections hold a key: no read returns a key (`book.ts:1-8`), so only the count is read from the file.
      const secrets = record(json(join(runtimeDir(env, runtimeOf(ctx, "owner").name), "secrets.json")));
      const keyed = Object.keys(record(secrets.keys)).length;
      return { via: "lah.connections.list; disk: the runtime folder's secrets.json, its keys counted, never read", found: book.connections.length + keyed, facts: { connections: book.connections.map((c) => ({ provider: c.provider ?? null, model: c.model ?? null })), keyed } };
    },
  },
  {
    id: "loopback",
    today: "The loopback connection in Lumiverse, and the hash of its key (Lumiverse; the extension's registry.json)",
    made: "setup",
    async read(ctx, env) {
      // The runtime's Custom connection, model `lumiah-<identifier>` (LumiAH `link/contract.ts:50-61`; `runtime/lumiverse.ts:240-246`).
      const loop = (await ctx.host.connections()).filter((c) => c.model === `lumiah-${IDENTIFIER}`);
      // The key's hash: no read returns it beyond its print (LumiAH `src/shared/ui.ts:280-307`), and `lah.hello`, which gives the print, writes.
      const registry = record(json(join(owner(ctx, env), "harness", "registry.json")));
      const hashed = typeof record(registry.key).hash === "string";
      return { via: "GET /api/v1/connections; disk: harness/registry.json, read for whether a key hash is kept", found: loop.length + (hashed ? 1 : 0), facts: { connections: loop.map((c) => ({ provider: c.provider ?? null, model: c.model ?? null })), keyHashKept: hashed }, ids: loop.map((c) => c.id) };
    },
  },
  {
    id: "runtime-settings",
    today: "The runtime's own settings: tuning, memory limit, update choice (the runtime's config file on the server)",
    made: "setup",
    async read(ctx) {
      // `lumiah status` prints no config field (LumiAH `src/runtime/cli.ts:963-993`) and asks Lumiverse with the runtime's session, which may renew it (`link/settings.ts:96`).
      const config = record(record(json(runtimeOf(ctx, "owner").config)).runtime);
      return { via: "disk: the runtime's config file (no read of today's build returns its fields)", found: ["tuning", "memory", "autoUpdate"].filter((k) => config[k] !== undefined).length, facts: { memory: (config.memory as Json) ?? null, autoUpdate: (config.autoUpdate as Json) ?? null, tuning: Object.keys(record(config.tuning)).length, recorded: (ctx.log.get<Json>("setup:runtime-settings") ?? null) } };
    },
  },
  {
    id: "old-credentials",
    today: "The old link's own credentials: the runtime's Lumiverse session token, the relay secrets and their hashes (the runtime's config; registry.json)",
    made: "setup",
    async read(ctx, env) {
      // Never read out: only whether each is kept. No read of today's build returns them (LumiAH `src/shared/ui.ts:280-307`; `relays.ts:437-457`).
      const config = record(record(json(runtimeOf(ctx, "owner").config)).runtime);
      const relays = Object.values(record(record(json(join(owner(ctx, env), "harness", "registry.json"))).relays)).filter((r) => typeof record(r).secret === "string").length;
      const facts = { sessionToken: typeof record(config.session).token === "string", relaySecret: typeof config.secret === "string", relaySecretHashes: relays };
      return { via: "disk: the runtime's config and harness/registry.json, each read only for whether a credential is kept", found: (facts.sessionToken ? 1 : 0) + (facts.relaySecret ? 1 : 0) + relays, facts };
    },
  },
  {
    id: "mirror",
    today: "Which runtime held the working copy; the chat copy's own state (mirror-holder.json, mirror.json, database.json)",
    made: "setup",
    async read(ctx, env) {
      // No page request reads mirror-holder.json or docs/mirror.json (LumiAH `extension/backend/mirror.ts`, `runtime/store/index.ts:688`); database.json only the operator's chat-data read, which needs a relay.
      const h = join(owner(ctx, env), "harness");
      const holder = record(record(json(join(h, "mirror-holder.json"))).holder);
      const mirror = json(join(h, "docs", "mirror.json"));
      const database = json(join(h, "database.json"));
      return { via: "disk: harness/mirror-holder.json, harness/docs/mirror.json, harness/database.json (no page request reads them)", found: (Object.keys(holder).length > 0 ? 1 : 0) + (mirror !== null ? 1 : 0) + (database !== null ? 1 : 0), facts: { held: Object.keys(holder).length > 0, mirror: mirror !== null, database: database === null ? null : ((record(database).on as Json) ?? null) } };
    },
  },
  {
    id: "forget",
    today: "LumiAH's list of chats to forget (forget.json)",
    made: "play",
    async read(ctx, env) {
      // Written at Lumiverse's CHAT_DELETED and emptied once the runtime forgets the chat (LumiAH `extension/backend/forget.ts:56-110`); only forget.ts reads it.
      const f = json(join(owner(ctx, env), "harness", "forget.json"));
      const chats = Object.keys(record(record(f).chats));
      return { via: "disk: harness/forget.json (only LumiAH's forget.ts reads it)", found: f === null ? 0 : 1, facts: { file: f !== null, chats: chats.map((id) => keyOf(ctx, id, ALL_CHATS)).sort() } };
    },
  },
  {
    id: "checkins",
    today: "Check-ins from outside harnesses (agents.json and the extension's storage)",
    made: "play",
    async read(ctx, env) {
      // Settings → MCP server (`dispatch.ts:990-993`; `src/backend/agents.ts:534`).
      const v = await ctx.socket.lre<{ view?: { clients: { id: string; harness: string | null }[] } }>("lre.agents", { op: "get" });
      const clients = v.view?.clients ?? [];
      // The build the extension last started as, beside them: read only at the extension's start (`src/backend/agents.ts:51,229-251`).
      const build = existsSync(join(extensionStorage(env), "agents", "build.json"));
      return { via: "lre.agents get; disk: the extension's agents/build.json (read only as the extension starts)", found: clients.length + (build ? 1 : 0), facts: { harnesses: clients.map((c) => c.harness).sort(), build }, ids: clients.map((c) => c.id) };
    },
  },
  {
    id: "cli-signins",
    today: "Command-line sign-ins (a credentials file in your home on the machine you ran the CLI from)",
    made: "setup",
    async read(_ctx, env) {
      // The CLI has no command that lists its sign-ins (`src/cli/credentials.ts:26-33` is where it keeps them); only the hosts are counted, never a token.
      const hosts = (["owner", "other"] as const).map((who) => ({ who, hosts: Object.keys(record(record(json(credentialsFile(env, who))).hosts)).length }));
      return { via: "disk: each user's lumirpengine/credentials.json (no command lists sign-ins)", found: hosts.reduce((n, h) => n + h.hosts, 0), facts: hosts };
    },
  },
  {
    id: "browser",
    today: "Browser preferences (the browser's local storage)",
    made: "play",
    async read(ctx) {
      // Set in the live driver's browser profile, which keeps what it set under `browser:prefs` ({key, value}[]). The keys today's pages keep: `lre:ui:show-ids` (src/frontend/app.ts:131), `lre:things:recent:<chat>` (things/play-where.ts:95), `lre:prepare-live:<chat>` (story/prepare-live.tsx:363), `lumi_ah.prefs` (LumiAH extension/frontend/app.tsx:238).
      const kept = list(ctx.log.get<Json>("browser:prefs")).map(record);
      return { via: "the live driver's record of what it set in its browser profile (no read of today's build reaches a browser)", found: kept.length, facts: kept.map((k) => String(k.key ?? "").replace(/:[0-9a-f-]{36}$/, ":<chat>")).sort() };
    },
  },
  {
    id: "vectors-caches-snapshots",
    today: "Search vectors, caches and snapshots (LumiAH's recall/, runs/<chat>/snapshots.json)",
    made: "play",
    async read(ctx, env) {
      // A chat's fold snapshots: read only as its ledger opens (`src/backend/ledger-io.ts:2543`). LumiAH's recall: `chats/<c>/recall.json` and `recall/` (LumiAH `core/recall/recall.ts:60`, `meaning.ts:215-217`).
      const snapshots = chatsOf(ctx, PLAYED).filter(([, chatId]) => existsSync(join(owner(ctx, env), "runs", chatId, "snapshots.json"))).map(([key]) => key);
      const docs = join(owner(ctx, env), "harness", "docs");
      const recall = files(join(docs, "recall")).length + files(join(docs, "chats")).filter((f) => f.endsWith("/recall.json")).length;
      return { via: "disk: runs/<chat>/snapshots.json and harness/docs recall files (no request returns either)", found: snapshots.length + recall, facts: { snapshots: snapshots.sort() }, played: { recall } };
    },
  },
  {
    id: "logs",
    today: "Logs, diagnostics and small working files (call meter, inspector and diagnostics files, lore-tool refusals, learning, acceptance, sweep, open turns, notices)",
    made: "play",
    async read(ctx, env) {
      const u = owner(ctx, env);
      // Read by their own owners only: the meter (`src/backend/steps.ts:99`), learning (`settings-store.ts:1045`), lore tools (`lore-steps.ts:454`), acceptance (`agents/provider.ts:544`), sweep (`agents/sweep.ts:286`), LumiAH's open turns and notices (LumiAH `extension/backend/open.ts`, `notices.ts:67-69`).
      const named = ["diagnostics.log", "call-meter.json", "extraction-learning.json", "lore-tools.json", "agent-acceptance.json", "agents/sweep.json", "harness/turns.json", "harness/notices.json"].filter((p) => existsSync(join(u, p)));
      const perChat = chatsOf(ctx, PLAYED).flatMap(([key, chatId]) => ["inspector.json", "diagnostics.json"].filter((f) => existsSync(join(u, "runs", chatId, f))).map((f) => `${key}/${f}`));
      const backend = existsSync(join(extensionStorage(env), "diagnostics", "backend.log"));
      // Diagnostics' records of a chat (`dispatch.ts:745-756`).
      let records = 0;
      for (const [, chatId] of chatsOf(ctx, PLAYED)) records += (await ctx.socket.lre<{ records: unknown[] }>("lre.diag", { chatId, op: "get" })).records.length;
      return { via: "lre.diag get; disk: the working files no request returns", found: named.length + perChat.length + (backend ? 1 : 0), facts: { files: named, perChat: perChat.sort(), backendLog: backend }, played: { records } };
    },
  },
  {
    id: "runtime-working-copy",
    today: "The runtime's working copy: its identity file and temporary folder; the installed copy of today's runtime (the runtime's folders)",
    made: "setup",
    async read(ctx, env) {
      // The store folder per identity (LumiAH `src/runtime/store/index.ts:31-46,307-311`); the installed copy (`runtime/config.ts:80-82,98-100`); a folder no config names, as the set-up recorded it.
      const runtime = runtimeDir(env, runtimeOf(ctx, "owner").name);
      const stores = existsSync(join(runtime, "store")) ? readdirSync(join(runtime, "store")) : [];
      const identities = stores.filter((s) => existsSync(join(runtime, "store", s, "identity.json")));
      const installed = existsSync(join(runtimeXdg(env).XDG_DATA_HOME, "lumiah", IDENTIFIER, "lumiah.js"));
      const loose = record(ctx.log.get<Json>("setup:runtime-folder"));
      const looseHere = typeof loose.path === "string" && existsSync(loose.path);
      return { via: "disk: the runtime's folders (no read of today's build lists them)", found: identities.length + (installed ? 1 : 0) + (looseHere ? 1 : 0) + (existsSync(lumiahPath(env)) ? 1 : 0), facts: { identities: identities.length, tmp: identities.filter((s) => existsSync(join(runtime, "store", s, "tmp"))).length, installed, unnamedFolder: looseHere }, ids: { stores } };
    },
  },
  {
    id: "deleted-chat-runs",
    today: "Run data of chats since deleted in Lumiverse (runs/<chat>/ with no chat)",
    made: "play",
    async read(ctx, env) {
      const chatId = idOf(ctx, "chat:deleted") ?? "";
      let gone = false;
      try {
        await ctx.host.chat(chatId);
      } catch {
        gone = true;
      }
      // No read of today's build reaches a chat Lumiverse no longer has: every chat request asks Lumiverse for it first.
      const left = files(join(owner(ctx, env), "runs", chatId));
      return { via: "GET /api/v1/chats/:id (gone); disk: runs/<chat>/", found: gone ? left.length : 0, facts: { goneFromLumiverse: gone, files: left }, ids: { chatId } };
    },
  },
  {
    id: "depth",
    today: "What the depth engine left: depth/, runs/<chat>/archive/, layer/, bootstrap/, a chat's switch and default mark (user storage; chat metadata)",
    made: "planted",
    async read(ctx, env) {
      // Today's build has no depth engine, so nothing of it reads these: the lead plants them.
      const out: Json[] = [];
      let found = 0;
      for (const p of [...planted(ctx, "depth-files"), ...planted(ctx, "depth-mark")]) {
        let here = false;
        if (p.where === "storage") here = existsSync(join(owner(ctx, env), p.path));
        else if (p.where === "chat-metadata") {
          let v: unknown = await metadataOf(ctx, idOf(ctx, p.chat ?? "") ?? "");
          for (const k of p.path.split(".")) v = record(v)[k];
          here = v !== undefined;
        }
        if (here) found++;
        out.push({ kind: p.kind, where: p.where, chat: p.chat ?? null, present: here });
      }
      return { via: "disk: user storage; GET /api/v1/chats/:id for the metadata mark", found, facts: out };
    },
  },
  {
    id: "registration",
    today: "RPE's own registration with its light extension (rpe/registration.json, present once the new extension has run)",
    made: "play",
    async read(ctx, env) {
      // Absent by definition: today's build has no RPE to write it. Read so the report says so.
      const here = existsSync(join(owner(ctx, env), "rpe", "registration.json"));
      return { via: "disk: rpe/registration.json (today's build has no RPE and no read of it)", found: here ? 1 : 0, facts: { present: here, expected: false } };
    },
  },
  {
    id: "unnamed",
    today: "Anything else in either storage root or the runtime's folders that no row names",
    made: "planted",
    async read(ctx, env) {
      const out = planted(ctx, "unnamed").map((p) => ({ kind: p.kind, path: p.path, present: existsSync(join(owner(ctx, env), p.path)) }));
      return { via: "disk: the owner's storage (no row's store names the file)", found: out.filter((o) => o.present).length, facts: out };
    },
  },
  // ---------------------------------------------------------------- what today's build wrote into Lumiverse (l.1647-1654)
  {
    id: "book-marks",
    today: "Secret marks and lore fields in your own book entries, and the lore index entry (Lumiverse)",
    made: "play",
    async read(ctx) {
      const bookId = idOf(ctx, "bookId") ?? "";
      // Build → Lore → World Info entries (`dispatch.ts:900-903`) and the lore index (`dispatch.ts:938-952`).
      const entries = (await ctx.socket.lre<{ entries?: { id: string; title: string; marks?: unknown[]; lore?: unknown }[] }>("lre.lore", { op: "entries", bookId })).entries ?? [];
      const index = await ctx.socket.lre<{ index?: { built: unknown } }>("lre.lore", { op: "index", worldId: idOf(ctx, "worldId") ?? "" });
      const marks = entries.reduce((n, e) => n + list(e.marks).length, 0);
      const fields = entries.filter((e) => e.lore !== undefined).length;
      const built = index.index?.built !== null && index.index?.built !== undefined;
      return { via: "lre.lore entries, lre.lore index", found: marks + fields + (built ? 1 : 0), facts: { entries: entries.map((e) => ({ title: e.title, marks: list(e.marks).length, fields: e.lore !== undefined })).sort((a, b) => a.title.localeCompare(b.title)), indexEntry: built }, ids: entries.map((e) => e.id) };
    },
  },
  {
    id: "engine-book",
    today: "The per-world engine book of blank, disabled entries, and its attachment to each chat (Lumiverse)",
    made: "play",
    async read(ctx) {
      // "LumiRPEngine · <World>", made with metadata `{lumi_rp_engine: true}`; its entries marked `extensions.lumi_rp_engine` (`src/backend/book.ts:155-175`).
      const books = rows(await ctx.host.call<unknown>("GET", "/api/v1/world-books?limit=500")).filter((b) => record(b.metadata)[IDENTIFIER] === true);
      let entries = 0;
      for (const b of books) entries += (await ctx.host.bookEntries(String(b.id))).filter((e) => record(e.extensions)[IDENTIFIER] !== undefined).length;
      const attached: string[] = [];
      for (const [key, chatId] of chatsOf(ctx, ALL_CHATS.filter((k) => k !== "chat:deleted"))) if (list((await metadataOf(ctx, chatId)).chat_world_book_ids).some((id) => books.some((b) => b.id === id))) attached.push(key);
      return { via: "GET /api/v1/world-books, GET /api/v1/world-books/:id/entries, GET /api/v1/chats/:id", found: books.length + entries + attached.length, facts: { books: books.map((b) => String(b.name)).sort(), attached: attached.sort() }, played: { entries }, ids: books.map((b) => String(b.id)) };
    },
  },
  {
    id: "regex-scripts",
    today: "Regex scripts that hide engine JSON in old replies (Lumiverse)",
    made: "play",
    async read(ctx) {
      // Folder "LumiRPEngine": per chat `lre_jsonx_<chat>` and the user's unwrap scripts (`src/backend/json-hiding.ts:77-132`); Lumiverse's list (`src/routes/regex-scripts.routes.ts:110-125`).
      const scripts = rows(await ctx.host.call<unknown>("GET", "/api/v1/regex-scripts?limit=500")).filter((s) => String(s.name ?? "").startsWith("LumiRPEngine"));
      return { via: "GET /api/v1/regex-scripts", found: scripts.length, facts: { names: [...new Set(scripts.map((s) => String(s.name)))].sort(), count: scripts.length } };
    },
  },
  {
    id: "preset-blocks",
    today: "Preset blocks named RPEngine · <step> and {{outlet::lre_…}} references (Lumiverse presets)",
    made: "play",
    async read(ctx): Promise<RowRead> {
      // Settings → Preset's card (`dispatch.ts:882-887`; `src/backend/runtime.ts:4195-4209`): refused when Lumiverse names no active preset.
      try {
        const { card } = await ctx.socket.lre<{ card: { preset: { name: string } | null; outlets: { outlet: string }[]; blocks: { target: string; state: string }[] } }>("lre.preset", { op: "get" });
        const blocks = card.blocks.filter((b) => b.state !== "missing");
        return { via: "lre.preset get", found: blocks.length + card.outlets.length, facts: { preset: card.preset !== null, blocks: blocks.map((b) => ({ target: b.target, state: b.state })), outlets: card.outlets.map((o) => o.outlet).sort() } };
      } catch (error) {
        return { via: "lre.preset get", found: 0, facts: { preset: false, refused: error instanceof Error ? error.message : String(error) } };
      }
    },
  },
  {
    id: "panel-messages",
    today: "Messages the panels put in the chat for you (Lumiverse)",
    made: "play",
    async read(ctx) {
      // A panel or chip action that plays at once appends the player's message with its intent (`dispatch.ts:494`); it carries no `staged` flag of a typed message that took a staged tap.
      const out: Json[] = [];
      const ids: Json[] = [];
      for (const [key, chatId] of chatsOf(ctx, PLAYED)) {
        for (const m of await ctx.host.messages(chatId)) {
          const intent = record(record((m.extra as { spindle_metadata?: unknown } | undefined)?.spindle_metadata)[IDENTIFIER]);
          if (!m.is_user || typeof intent.action !== "string" || intent.staged === true) continue;
          out.push({ chat: key, action: intent.action });
          ids.push(m.id);
        }
      }
      return { via: "GET /api/v1/chats/:id/messages", found: out.length, facts: out, ids };
    },
  },
  {
    id: "chat-pins",
    today: "Each chat's pin to the engine's connection and model, and the engine's address on your scheduler's exclusions (Lumiverse)",
    made: "play",
    async read(ctx) {
      const loop = (await ctx.host.connections()).filter((c) => c.model === `lumiah-${IDENTIFIER}`).map((c) => c.id);
      const pinned: string[] = [];
      // Switching a chat to the runtime pins it (LumiAH `extension/backend/switch.ts:45-46,309`).
      for (const [key, chatId] of chatsOf(ctx, ALL_CHATS.filter((k) => k !== "chat:deleted"))) if (loop.includes(String((await metadataOf(ctx, chatId)).connection_profile_id ?? ""))) pinned.push(key);
      // The runtime puts its address on the scheduler's exclusions (LumiAH `src/runtime/lumiverse.ts:307`; Lumiverse `src/services/inference-scheduler/config.ts:19,112`).
      const config = record(await ctx.host.call<unknown>("GET", "/api/v1/inference-scheduler/config"));
      const port = runtimeOf(ctx, "owner").port;
      const excluded = list(config.excludedOrigins).filter((o) => typeof o === "string" && o.endsWith(`:${port}`)).length;
      return { via: "GET /api/v1/chats/:id, GET /api/v1/connections, GET /api/v1/inference-scheduler/config", found: pinned.length + excluded, facts: { pinned: pinned.sort(), excluded } };
    },
  },
  // ---------------------------------------------------------------- leftovers (l.1656)
  {
    id: "leftovers",
    today: "Leftovers: a .tmp of a write cut short, a damaged file set aside as .corrupt-<n> or .bad, a temporary copy during an update",
    made: "planted",
    async read(ctx, env) {
      const u = owner(ctx, env);
      // Every leftover by name in the owner's storage: `.tmp` (`src/backend/*.ts`, each write's temp), `.corrupt-<ms>` (`src/backend/stored-json.ts:10,39-46`), `.bad` (LumiAH `extension/backend/docs.ts:91-96`).
      const found = files(u).filter((f) => /\.tmp$|\.corrupt-\d+$|\.bad$/.test(f));
      const named = (f: string): string => {
        const m = /^runs\/([^/]+)\/(.*)$/.exec(f);
        return m ? `runs/<${keyOf(ctx, m[1] ?? "", ALL_CHATS)}>/${(m[2] ?? "").replace(/\.corrupt-\d+$/, ".corrupt-<n>")}` : f.replace(/\.corrupt-\d+$/, ".corrupt-<n>");
      };
      // The lead's planted leftovers and item 4's two files, read from disk only (head of file).
      const marked = [...planted(ctx, "set-aside"), ...planted(ctx, "tmp"), ...planted(ctx, "reader-writes")].map((p) => ({ row: p.row, kind: p.kind, made: p.made, chat: p.chat ?? null, present: existsSync(join(u, p.path)) }));
      return { via: "disk: the owner's storage (no read of today's build lists leftovers, and reading item 4's files through it would write)", found: found.length + marked.filter((p) => p.row === "reader-writes" && p.present).length, facts: { leftovers: found.map(named).sort(), planted: marked }, ids: { leftovers: found } };
    },
  },
];
