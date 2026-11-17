// What today's harness keeps that the instance's play can't make, planted by the script in the
// instance user's storage after all play, each in today's shape and each named in the instance's
// record (`planted:<name>`, `Planted` in `rows.ts`, `made: "planted"`) and the change log:
// - two replies that stand with no turn played, one whose harness run was stopped and one whose run
//   failed. Play makes neither: a reply stopped once its text streamed is kept as a stopped turn
//   (RPE `src/backend/ledger-io.ts:1566-1580`), one stopped before has no text to carry a mark
//   (`src/engine/ledger/journal.ts:1528-1531`), and a failed run ends its reply with an error chunk
//   (LumiAH `src/core/turn.ts:187-193`, `src/runtime/sse.ts:173-178`), whose generation error RPE
//   records first (`ledger-io.ts:1554,1609`); so "the harness's run was stopped" and "…failed"
//   (`src/backend/harness/extension.ts:1162-1172,1351-1354`) never reach a reply by play;
// - a small store of search vectors and the count of what was embedded: meaning search is off as
//   shipped and needs an embedding connection Lumiverse has (LumiAH `src/core/recall/meaning.ts:
//   653-669`), and the instance is given none;
// - the operator's switch of the direct database reader (`harness/database.json`): only the operator's
//   Runtime page writes it (LumiAH `src/extension/backend/copy.ts:95,235-245`), and RPE's Harness tab
//   has no such page;
// - one chat's own choice of what counts as its story (`harness/chats.json`): only `lah.chat.story.set`
//   writes it (LumiAH `src/extension/backend/switch.ts:247-255`), from a page RPE's tab doesn't show;
// - one chat's ask that its notes be summarized (`session.json`): only `lah.session.summarize` writes
//   it (LumiAH `src/core/sessions.ts:361-373`).
// All of it goes to a harness chat of its own (`chat:unplayed`), which no play step plays, so the
// story choice and the summary ask change no turn anyone plays from the instance.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ctx, Step } from "../context";
import { guard, IDENTIFIER, userStorage } from "../env";
import type { Json } from "../record";
import { say } from "../record";
import { CARD_NAME, newWorldChat } from "../../steps/chats";
import type { Planted } from "./rows";
import { waitLinked } from "./stores";

/** The harness chat every planted thing of this file goes in, remembered as `chat:unplayed`. */
const CHAT_KEY = "unplayed";
const CHAT_NAME = "Port Alder test · harness, planted";
/** How long the engine is given to take a new message into the chat's journal, and the extension to start again. */
const SETTLE_MS = 2 * 60_000;

type Doc = { [key: string]: unknown };

function isDoc(value: unknown): value is Doc {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const at = (ctx: Ctx, rel: string): string => join(userStorage(ctx.env, ctx.userId), rel);

function readDoc(ctx: Ctx, rel: string): Doc | null {
  const path = at(ctx, rel);
  if (!existsSync(path)) return null;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isDoc(value)) throw new Error(`${rel} does not hold an object: left as it is`);
  return value;
}

/** Writes a JSON document as today's writers write theirs (`JSON.stringify`, LumiAH `src/extension/backend/docs.ts:86-91`), its folders made. */
function writeDoc(ctx: Ctx, rel: string, value: unknown): void {
  const path = at(ctx, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function record(ctx: Ctx, name: string, value: Planted | Planted[]): void {
  ctx.log.set(`planted:${name}`, value as unknown as Json);
  for (const item of Array.isArray(value) ? value : [value]) ctx.log.log({ step: "planted-harness", action: "placed", kind: `${item.row}: ${item.kind}`, id: item.path, ...(item.chat !== undefined ? { detail: { chat: item.chat } } : {}) });
}

/** A chat id as a part of a document's path: `encodeURIComponent`, with `.` written `%2E` (LumiAH `src/core/paths.ts:12-14`). */
const docKey = (id: string): string => encodeURIComponent(id).replace(/\./g, "%2E");

/** The planted chat: an invented chat on the test card with the test world (`steps/chats.ts`), on the harness (GM → This chat → Engine, RPE `src/backend/dispatch.ts:844-868`). */
async function plantedChat(ctx: Ctx): Promise<string> {
  const chatId = await newWorldChat(ctx, CHAT_KEY, CHAT_NAME);
  const asked = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId, engines: true });
  if (asked.engine !== "harness") {
    const set = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId, engine: "harness" });
    if (set.engine !== "harness") throw new Error(`the planted chat isn't on the harness (${set.engine ?? "classic"})`);
    ctx.log.log({ step: "planted-harness", action: "changed", kind: "chat engine (chat metadata prefs.engine)", id: chatId, detail: { engine: "harness" } });
  }
  return guard(ctx.env, chatId);
}

// ---------------------------------------------------------------- replies with no turn played

/**
 * The two planted reasons, each as RPE renders it from its shipped text (`src/shared/harness-texts.ts:
 * 625-626`, rendered at `src/backend/harness/extension.ts:1170` with `: ` and the run's reason) and
 * the reason LumiAH's own shipped text gives (a stop no one gave words for: LumiAH `src/core/texts.ts:
 * 554`, `src/core/turn.ts:205-208`; a writer's model that answered with nothing: `src/core/texts.ts:525`,
 * `src/core/turn.ts:432`). Each stands on a reply of invented text, made through Lumiverse's own
 * message route as a reply of the card's (`POST /api/v1/chats/:id/messages`, Lumiverse
 * `src/routes/chats.routes.ts:878-912`).
 */
export const PLANTED_REPLIES = [
  { kind: "run stopped", why: "the harness's run was stopped: the turn was stopped", text: "The evening fog rolls in off the lake while Jordan waits by the fuel dock, and somewhere behind the bait shed a radio plays the late ballgame." },
  { kind: "run failed", why: "the harness's run failed: its model answered with nothing", text: "Marcus counts the till twice, frowns at the ledger, and slides it under the counter before Jordan can see the totals." },
] as const;

/** One journal chain entry's content identity, as the journal keeps it (`contentId(activeText(m))`, `src/engine/ledger/journal.ts:409-417`). */
interface ContentId {
  len: number;
  hash: string;
}

/** The chat's journal as the engine wrote it (`runs/<chat>/journal.json`): its counter of records and each chained message's content identity. */
function journalOf(ctx: Ctx, chatId: string): { seq: number; content: Map<string, ContentId> } | null {
  const journal = readDoc(ctx, `runs/${chatId}/journal.json`);
  if (journal === null || typeof journal.seq !== "number" || !Array.isArray(journal.chain)) return null;
  const content = new Map<string, ContentId>();
  for (const entry of journal.chain) if (isDoc(entry) && typeof entry.id === "string" && isDoc(entry.content) && typeof entry.content.len === "number" && typeof entry.content.hash === "string") content.set(entry.id, { len: entry.content.len, hash: entry.content.hash });
  return { seq: journal.seq, content };
}

/**
 * Two replies of the planted chat marked as standing with no turn played, each mark in today's shape:
 * the record `recordUnplayed` makes on a reply that holds no record (`src/engine/ledger/journal.ts:
 * 1528-1546`, from `bareRecord`, `:550-553`), on the reply's shown swipe, in its metadata ledger
 * (`{v: 1, swipes, markers}`, which today's reader takes when its records pass `isRec`,
 * `src/backend/ledger-io.ts:113-153,283-293`). Its content identity is the one the journal chained
 * for the reply (`journal.ts:409-417`), its definitions the revision the chat plays (`bareRecord`'s
 * `defHash`), its sequence the next past the journal's (`bareRecord`'s `++seq`). Neither reply is in
 * the journal's own ledgers, and for such a reply the journal takes the metadata's
 * (`journal.ts:191-193`) and never writes over it (`journal.ts:217-225`): the mark stands as planted
 * whoever opens the chat. Today's own view then shows each (`unplayed:<message>:<swipe>`,
 * `src/backend/view.ts:782-786` on main), which the step checks.
 */
export const plantedUnplayed: Step = {
  name: "planted-unplayed",
  makes: "two replies standing with no turn played: the harness's run stopped, and its run failed (planted: play makes neither)",
  async run(ctx) {
    const chatId = await plantedChat(ctx);
    await ctx.log.once("planted:unplayed", async () => {
      const messages = [];
      for (const reply of PLANTED_REPLIES) {
        const key = `planted:unplayed:${reply.kind.replace(/ /g, "-")}:message`;
        let messageId = ctx.log.get<string>(key);
        if (messageId === undefined) {
          messageId = (await ctx.host.call<{ id: string }>("POST", `/api/v1/chats/${chatId}/messages`, { name: CARD_NAME, content: reply.text, is_user: false })).id;
          ctx.log.set(key, messageId);
          ctx.log.log({ step: "planted-harness", action: "created", kind: "reply of the card's, invented text (Lumiverse message route)", id: messageId, detail: { chatId } });
        }
        messages.push({ ...reply, messageId });
      }
      // The engine takes each new message into the chat's journal as it hears it (`ledger-io.ts:2575-2597`).
      let journal = journalOf(ctx, chatId);
      for (const began = Date.now(); journal === null || messages.some((m) => !journal?.content.has(m.messageId)); journal = journalOf(ctx, chatId)) {
        if (Date.now() - began > SETTLE_MS) throw new Error("the engine didn't take the planted replies into the chat's journal");
        await Bun.sleep(1000);
      }
      const chat = await ctx.host.chat(chatId);
      const run = chat.metadata?.[IDENTIFIER];
      const revision = isDoc(run) && typeof run.revision === "string" ? run.revision : null;
      if (revision === null) throw new Error("the planted chat's metadata names no revision it plays");
      const stored = await ctx.host.messages(chatId);
      const planted: Planted[] = [];
      for (const [n, reply] of messages.entries()) {
        const message = stored.find((m) => m.id === reply.messageId);
        const content = journal.content.get(reply.messageId);
        if (message === undefined || content === undefined) throw new Error(`the planted reply ${reply.messageId} is gone`);
        const swipe = String(message.swipe_id);
        const rec = { v: 1, defHash: revision, seq: journal.seq + n + 1, swipeHash: content, path: "", seed: "", pre: 0, events: [], post: [], markersApplied: 0, status: "ok", undone: [], intents: {}, harness: { turns: [], unplayed: reply.why } };
        const extra = isDoc(message.extra) ? message.extra : {};
        const meta = isDoc(extra.spindle_metadata) ? extra.spindle_metadata : {};
        // Lumiverse's own edit of a message's extra (`src/routes/chats.routes.ts:1062-1120`), the message's other keys kept.
        await ctx.host.call("PUT", `/api/v1/chats/${chatId}/messages/${reply.messageId}`, { extra: { ...extra, spindle_metadata: { ...meta, [IDENTIFIER]: { v: 1, swipes: { [swipe]: rec }, markers: [] } } } });
        planted.push({ row: "unplayed", kind: reply.kind, made: "planted", where: "message-metadata", chat: `chat:${CHAT_KEY}`, path: `${reply.messageId}:${swipe}` });
      }
      // Today's own read of the chat must show each mark: else the record isn't one today's reader takes.
      let shown: string[] = [];
      for (const began = Date.now(); planted.some((p) => !shown.includes(`unplayed:${p.path}`)); await Bun.sleep(1000)) {
        if (Date.now() - began > SETTLE_MS) throw new Error(`today's view of the planted chat doesn't show the planted marks (it shows ${shown.join(", ") || "none"})`);
        shown = (await ctx.socket.lre<{ view: { chips: { id: string }[] } }>("lre.state.get", { chatId })).view.chips.map((c) => c.id).filter((id) => id.startsWith("unplayed:"));
      }
      record(ctx, "unplayed", planted);
    });
  },
};

// ---------------------------------------------------------------- the harness's documents

/**
 * The invented embedding connection the planted vectors are of, and their space: the connection,
 * its model and its dimensions joined by `.`, each id's letters, digits and `-` as they are
 * (LumiAH `src/core/recall/meaning.ts:218-249`).
 */
const EMBEDDER = { id: "invented-embedder", model: "test-embed-8", dims: 8 } as const;
const SPACE = `${EMBEDDER.id}.${EMBEDDER.model}.${EMBEDDER.dims}`;
/** An hour long past, by when it began: the count of what was embedded keeps hours (LumiAH `meaning.ts:427-434,541-555`), and one this old counts in its total only. */
const EMBEDDED_HOUR = Date.parse("2026-11-08T09:00:00Z");
/** When the planted chat's notes were asked to be summarized: a moment long past, so two runs plant the same bytes. */
const ASKED_AT = Date.parse("2026-11-08T10:15:00Z");

/**
 * Invented texts and their vectors, each kept as today keeps a vector: signed bytes, its largest
 * component at 127 (LumiAH `meaning.ts:100,129-137`).
 */
export const PLANTED_VECTORS: readonly { text: string; vector: readonly number[] }[] = [
  { text: "Dale locks the marina office at nine and hangs the spare key in the bait freezer.", vector: [12, -40, 127, 3, -8, 55, -90, 21] },
  { text: "The Harbor Watch walks its round at eight and signs the logbook in the marina office.", vector: [-127, 18, 44, -6, 73, -29, 5, 61] },
  { text: "Marcus counts the till twice and slides the ledger under the counter.", vector: [33, 127, -12, -71, 9, 40, -55, -18] },
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A vector's components as stored text, three bytes to four characters of today's alphabet (LumiAH `meaning.ts:93,157-175`). */
export function encodeVector(components: readonly number[]): string {
  const q = Int8Array.from(components);
  let out = "";
  let i = 0;
  for (; i + 2 < q.length; i += 3) {
    const a = q[i] & 255;
    const b = q[i + 1] & 255;
    const c = q[i + 2] & 255;
    out += ALPHABET.charAt(a >> 2) + ALPHABET.charAt(((a & 3) << 4) | (b >> 4)) + ALPHABET.charAt(((b & 15) << 2) | (c >> 6)) + ALPHABET.charAt(c & 63);
  }
  if (i < q.length) {
    const a = q[i] & 255;
    const b = i + 1 < q.length ? q[i + 1] & 255 : 0;
    out += ALPHABET.charAt(a >> 2) + ALPHABET.charAt(((a & 3) << 4) | (b >> 4));
    if (i + 1 < q.length) out += ALPHABET.charAt((b & 15) << 2);
  }
  return out;
}

/** The harness's documents in the instance user's storage: under `harness/docs/` (RPE `src/backend/harness/mount.ts:52,295-301`; LumiAH `src/extension/backend/reads.ts:14`). */
const DOCS = "harness/docs";

/**
 * The planted chat's vectors and the count of what was embedded. Each text is keyed by its SHA-256
 * (LumiAH `src/core/hash.ts:21-23`, the hash today keys texts by) in the document its first two hex
 * digits name (`meaning.ts:258-271`), at `recall/vectors/<space>/chat/<chat>/<xx>.json` as
 * `{v: 1, dims, vectors}` (`meaning.ts:215-217,304-332,408-424`); the count at `recall/embedded.json`
 * as `{v: 1, all, hours}` (`meaning.ts:541-555`). A document already there is read and added to.
 */
export const plantedHarnessDocs: Step = {
  name: "planted-harness-docs",
  makes: "a small store of search vectors and the count of what was embedded, and an ask that the chat's notes be summarized (planted)",
  async run(ctx) {
    const chatId = await plantedChat(ctx);
    await ctx.log.once("planted:vectors", async () => {
      const shards = new Map<string, Doc>();
      for (const { text, vector } of PLANTED_VECTORS) {
        const hash = createHash("sha256").update(text, "utf8").digest("hex");
        const rel = `${DOCS}/recall/vectors/${SPACE}/chat/${docKey(chatId)}/${hash.slice(0, 2)}.json`;
        const shard = shards.get(rel) ?? readDoc(ctx, rel) ?? { v: 1, dims: EMBEDDER.dims, vectors: {} };
        if (shard.v !== 1 || shard.dims !== EMBEDDER.dims || !isDoc(shard.vectors)) throw new Error(`${rel} holds vectors of another shape: left as it is`);
        shards.set(rel, { ...shard, vectors: { ...shard.vectors, [hash]: encodeVector(vector) } });
      }
      for (const [rel, shard] of shards) writeDoc(ctx, rel, shard);
      // What embedding them would have counted: the texts, and their tokens at four characters each, invented as the vectors are.
      const tokens = PLANTED_VECTORS.reduce((n, v) => n + Math.ceil(v.text.length / 4), 0);
      const texts = PLANTED_VECTORS.length;
      const embeddedRel = `${DOCS}/recall/embedded.json`;
      const kept = readDoc(ctx, embeddedRel) ?? { v: 1, all: { texts: 0, tokens: 0, queries: 0 }, hours: [] };
      const all = isDoc(kept.all) ? kept.all : {};
      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
      const hours = (Array.isArray(kept.hours) ? kept.hours : []).filter(isDoc);
      const hour = hours.find((h) => h.at === EMBEDDED_HOUR);
      const withHour = hour ? hours.map((h) => (h === hour ? { ...h, texts: num(h.texts) + texts, tokens: num(h.tokens) + tokens } : h)) : [...hours, { at: EMBEDDED_HOUR, texts, tokens, queries: 0 }];
      writeDoc(ctx, embeddedRel, { ...kept, v: 1, all: { ...all, texts: num(all.texts) + texts, tokens: num(all.tokens) + tokens, queries: num(all.queries) }, hours: withHour });
      record(ctx, "vectors", [
        ...[...shards.keys()].map((rel): Planted => ({ row: "vectors-caches-snapshots", kind: "search vectors of a chat", made: "planted", where: "storage", chat: `chat:${CHAT_KEY}`, path: rel })),
        { row: "vectors-caches-snapshots", kind: "count of what was embedded", made: "planted", where: "storage", path: embeddedRel },
      ]);
    });
    await ctx.log.once("planted:session", async () => {
      // `{v: 1, kind: "session", compactAsked}` at `chats/<chat>/session.json` (LumiAH `src/core/sessions.ts:361-373`, `src/core/paths.ts:16-46`).
      const rel = `${DOCS}/chats/${docKey(chatId)}/session.json`;
      if (readDoc(ctx, rel) !== null) {
        say(`  ${rel} is there already: left as it is, and not named as planted`);
        return;
      }
      writeDoc(ctx, rel, { v: 1, kind: "session", compactAsked: ASKED_AT });
      record(ctx, "session", { row: "sessions", kind: "an ask that the chat's notes be summarized", made: "planted", where: "storage", chat: `chat:${CHAT_KEY}`, path: rel });
    });
  },
};

// ---------------------------------------------------------------- the extension's own documents

/** The chat's own choice of what counts as its story, each member away from what a user has before choosing (LumiAH `src/core/story.ts:40-50`). */
export const STORY_CHOICE = { hidden: "include", from: "everyone", newest: "leave_out" } as const;
/** The direct database reader's switch as LumiAH writes it, off as shipped (LumiAH `src/extension/backend/copy.ts:37-40,95`): on, it would have every runtime read Lumiverse's database file from then on (`copy.ts:229-245`). */
const DATABASE_SWITCH = { v: 1, on: false } as const;

async function extensionStatus(ctx: Ctx): Promise<string> {
  return (await ctx.host.extension(IDENTIFIER)).status;
}

/**
 * Runs `plant` with the extension off: Lumiverse's own Disable stops its worker
 * (`src/routes/spindle.routes.ts:391-420`), so nothing the extension held in memory can be written
 * over a planted file or record, and no event of a planted write reaches it. Then Enable starts it
 * again (`:349-389`), it reads what is on disk from then on, and the owner's runtime links to it anew.
 */
export async function withExtensionOff(ctx: Ctx, step: string, plant: () => Promise<void>): Promise<void> {
  await ctx.host.call("POST", `/api/v1/spindle/${ctx.extensionId}/disable`, {});
  ctx.log.log({ step, action: "changed", kind: "extension switched off (Lumiverse's Disable) to plant", id: ctx.extensionId });
  try {
    for (const began = Date.now(); (await extensionStatus(ctx)) === "running"; await Bun.sleep(1000)) if (Date.now() - began > SETTLE_MS) throw new Error("the extension didn't stop");
    await plant();
  } finally {
    await ctx.host.call("POST", `/api/v1/spindle/${ctx.extensionId}/enable`, {});
    ctx.log.log({ step, action: "changed", kind: "extension switched on again (Lumiverse's Enable)", id: ctx.extensionId });
    for (const began = Date.now(); (await extensionStatus(ctx)) !== "running"; await Bun.sleep(1000)) if (Date.now() - began > SETTLE_MS) throw new Error("the extension didn't start again");
  }
  await waitLinked(ctx);
}

/**
 * `harness/chats.json` and `harness/database.json`. The running extension reads each once per user
 * and writes it whole from what it holds at its next change (LumiAH `src/extension/backend/docs.ts:
 * 50-108`), which would write over a planted line. So both are written while the extension is off:
 * Lumiverse's own Disable stops its worker (`src/routes/spindle.routes.ts:391-420`), the files are
 * read, added to and written, and Enable starts it again (`:349-389`), and from then on it holds what
 * the files say. `chats.json` keeps `{v: 1, on, story}` (LumiAH `src/extension/backend/switch.ts:
 * 62-86,114`); a chat's story choice is a line of `story`. The database switch is written only where
 * there is none, as LumiAH writes it.
 */
export const plantedUserDocs: Step = {
  name: "planted-user-docs",
  makes: "one chat's story choice in harness/chats.json and the database reader's switch in harness/database.json (planted, with the extension off)",
  async run(ctx) {
    const chatId = await plantedChat(ctx);
    await ctx.log.once("planted:user-docs", async () => {
      const chatsRel = "harness/chats.json";
      const databaseRel = "harness/database.json";
      let databaseWritten = false;
      await withExtensionOff(ctx, "planted-harness", async () => {
        const chats = readDoc(ctx, chatsRel) ?? { v: 1, on: {}, story: {} };
        if (chats.v !== 1 || !isDoc(chats.on)) throw new Error(`${chatsRel} isn't one LumiAH reads: left as it is`);
        const story = isDoc(chats.story) ? chats.story : {};
        writeDoc(ctx, chatsRel, { ...chats, story: { ...story, [chatId]: STORY_CHOICE } });
        databaseWritten = readDoc(ctx, databaseRel) === null;
        if (databaseWritten) writeDoc(ctx, databaseRel, DATABASE_SWITCH);
        else say(`  ${databaseRel} is there already: left as it is, and not named as planted`);
      });
      record(ctx, "story", { row: "engine-switch", kind: "a chat's own choice of what counts as its story", made: "planted", where: "storage", chat: `chat:${CHAT_KEY}`, path: chatsRel });
      if (databaseWritten) record(ctx, "database", { row: "mirror", kind: "the operator's switch of the direct database reader", made: "planted", where: "storage", path: databaseRel });
    });
  },
};

/** Planted after the lead's planted steps, after all play: the replies first (today's view checks them while the extension runs), its own documents last (the extension is off while they are written). */
export const PLANTED_HARNESS_STEPS: Step[] = [plantedUnplayed, plantedHarnessDocs, plantedUserDocs];
