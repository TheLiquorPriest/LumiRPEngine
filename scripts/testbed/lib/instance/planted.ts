// What today's build cannot make by play, planted by the script in the instance user's storage after
// all play, each named in the instance's record (`planted:<name>` in `state.json`, a line of the change
// log) so the read-back and the migration's report can be held against it (PlanScenarios-4 items 3
// and 4; STANDALONE-PLAN §15.2, §15.3 step 3):
// - the two cases in which today's own reader writes: a damaged file it would set aside
//   (`readStoredJson`, on `main` `src/backend/stored-json.ts:17-31`) and a journal it would replace
//   because it is from another run of the chat (`decodeJournal`, `src/backend/ledger-io.ts:355-366`),
//   both in a chat of their own that nothing opens after them;
// - a damaged file that today's reader has itself set aside (`.corrupt-<ms>`, made by play: the file is
//   planted, the page's read of the chat sets it aside), and a `.tmp` left by a write cut short
//   (planted: no play cuts a write short on cue);
// - the depth engine's kinds of §15.2 (READINGS N-6), which today's build has no code to make: its
//   day's spend, a chat's search index, the layer of what it landed, its bootstrap of the chat and its
//   switch to it, and a chat's mark that its engine came from the default (the shapes of the build
//   that had it, branch `depth/main`: `src/backend/depth/budget.ts:30,131`, `archive-index.ts`,
//   `layer-store.ts:25,127-148`, `bootstrap/files.ts:10-11`, `bootstrap/service.ts:41-45`,
//   `chat-knowledge-prefs.ts:40-41,192-193`);
// - a line against its turn's decisions on a harness reply's record (`Rec.harness.departures`, on
//   `main` `src/shared/ledger.ts:450-457`): declared, and written by nothing on `main`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Json } from "../record";
import { say } from "../record";
import type { Ctx, Step } from "../context";
import { userStorage } from "../env";
import { chatOf, newWorldChat } from "../../steps/chats";
import { withExtensionOff } from "./planted-harness";

/** One planted thing as the record names it (the read-back's `Planted`, `rows.ts`). */
export interface PlantedRecord {
  row: "depth" | "leftovers" | "unnamed" | "reader-writes" | "departures";
  kind: string;
  made: "play" | "planted";
  where: "storage" | "chat-metadata" | "message-metadata";
  path: string;
  chat?: string;
}

function record(ctx: Ctx, name: string, value: PlantedRecord | PlantedRecord[], detail?: Json): void {
  ctx.log.set(`planted:${name}`, value as unknown as Json);
  for (const item of Array.isArray(value) ? value : [value]) ctx.log.log({ step: "planted", action: item.made === "play" ? "created" : "placed", kind: `${item.row}: ${item.kind}`, id: item.path, ...(detail !== undefined ? { detail } : {}) });
}

/** Writes a file under the instance user's storage, its folders made as the extension's own writes make them. */
function plant(ctx: Ctx, rel: string, text: string): void {
  const path = join(userStorage(ctx.env, ctx.userId), rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A JSON file of the instance user's storage, which must hold an object. */
function readObject(ctx: Ctx, rel: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(join(userStorage(ctx.env, ctx.userId), rel), "utf8"));
  if (!isObject(value)) throw new Error(`${rel} does not hold an object`);
  return value;
}

async function stagedChat(ctx: Ctx, key: string, name: string): Promise<string> {
  const chatId = await newWorldChat(ctx, key, name);
  await ctx.log.once(`planted:${key}:staged`, async () => {
    // A staged tap makes the engine keep the chat's journal and its staged action (`steps/leftovers.ts`).
    const staged = await ctx.socket.lre<{ staged?: boolean }>("lre.action", { chatId, action: "go", params: { to: "alder_harbor_marina" }, source: "palette" });
    if (staged.staged !== true) throw new Error(`the palette tap wasn't staged in ${name}: ${JSON.stringify(staged)}`);
    ctx.log.log({ step: "planted", action: "created", kind: "staged action (runs/<chat>/staged.json)", id: chatId, detail: { key } });
  });
  return chatId;
}

/** Item 4: the damaged file and the journal from another run, in a chat nothing opens after them. */
export const readerWrites: Step = {
  name: "reader-writes",
  makes: "the two cases in which today's own reader writes: a damaged file and a journal from another run of the chat",
  async run(ctx) {
    const chatId = await stagedChat(ctx, "reader-cases", "Port Alder test · reader cases");
    await ctx.log.once("planted:reader-writes", async () => {
      const journalRel = `runs/${chatId}/journal.json`;
      const chipsRel = `runs/${chatId}/chips.json`;
      // With the extension off, the journal it may still hold from the staged tap can't be written over the planted one.
      await withExtensionOff(ctx, "planted", async () => {
        const journal = readObject(ctx, journalRel);
        const run = journal.run;
        if (!isObject(run) || typeof run.runSeed !== "string") throw new Error(`the reader-cases chat's journal names no run seed: ${journalRel}`);
        // The same journal stamped with another run's seed: `decodeJournal` resets it as "from another run of this chat".
        plant(ctx, journalRel, JSON.stringify({ ...journal, run: { ...run, runSeed: `${run.runSeed}-an-earlier-run` } }));
        // A chips file cut off mid-list: `chips.ts:77` reads it through `readStoredJson`, which sets it aside.
        plant(ctx, chipsRel, '[{"id":"confirm:an-earlier-turn","kind":"confirm","label":"Dale hands');
      });
      record(ctx, "reader-writes", [
        { row: "reader-writes", kind: "journal from another run of the chat", made: "planted", where: "storage", path: journalRel },
        { row: "reader-writes", kind: "damaged file today's reader would set aside", made: "planted", where: "storage", path: chipsRel },
      ]);
    });
  },
};

/** Item 3's leftovers: a damaged file today's reader set aside itself, and a `.tmp` of a write cut short. */
export const setAside: Step = {
  name: "set-aside",
  makes: "a file today's reader set aside as .corrupt-<n>, and a .tmp left by a write cut short",
  async run(ctx) {
    const chatId = await newWorldChat(ctx, "set-aside", "Port Alder test · set-aside leftover");
    await ctx.log.once("planted:set-aside", async () => {
      const dir = `runs/${chatId}`;
      // Written with the extension off, so whatever its cache already holds of the chat's staged action
      // goes with its worker (`staged.ts:39-47` keeps what it read per user and chat; making the chat
      // and attaching its world has the running extension read it: the bed's first run found no copy
      // set aside), and the page's first read after Enable goes to the file.
      await withExtensionOff(ctx, "planted", async () => plant(ctx, `${dir}/staged.json`, '{"action":"go","request":{"to":"alder'));
      await ctx.player.state(chatId);
      const aside = readdirSync(join(userStorage(ctx.env, ctx.userId), dir)).filter((f) => f.startsWith("staged.json.corrupt-"));
      if (aside.length !== 1) throw new Error(`today's reader set aside ${aside.length} copies of the damaged staged.json in ${dir}, where one was expected`);
      record(ctx, "set-aside", { row: "leftovers", kind: "damaged file today's reader set aside (.corrupt-<ms>)", made: "play", where: "storage", path: `${dir}/${aside[0]}` }, { planted: `${dir}/staged.json` });
      const tmpRel = `${dir}/plans.json.tmp`;
      plant(ctx, tmpRel, '{"v":1,"lines":{"an-earlier-turn":"Dale locks the office at ni');
      record(ctx, "tmp", { row: "leftovers", kind: ".tmp left by a write cut short", made: "planted", where: "storage", path: tmpRel });
    });
  },
};

/** An invented day long past, so two runs plant the same bytes. */
const DEPTH_DAY = "2026-11-08";
const DEPTH_AT = Date.parse(`${DEPTH_DAY}T09:30:00Z`);

/** The depth engine's kinds (N-6): files in the classic chat's run folder and the user's storage, and a mark in the agents chat's metadata. */
export const depthKinds: Step = {
  name: "depth-kinds",
  makes: "what the depth engine left, as a build that had it kept it (planted: today's build has no depth engine)",
  async run(ctx) {
    const chatId = await chatOf(ctx, "classic");
    const markChat = await chatOf(ctx, "agents");
    if (chatId === null || markChat === null) throw new Error("the chats step must run first");
    await ctx.log.once("planted:depth", async () => {
      const run = `runs/${chatId}`;
      const files: [string, string, unknown][] = [
        ["depth/day-spend.json", "day's spend", { v: 1, day: DEPTH_DAY, tokens: 18450 }],
        [`${run}/archive/shard-0.json`, "search index of the chat", { v: 1, shard: 0, terms: { marina: ["m-invented-1", "m-invented-3"], coffee: ["m-invented-1"] } }],
        [`${run}/layer/meta.json`, "layer of what it landed: index", { v: 2, seq: 2, segments: 1 }],
        [`${run}/layer/seg-0.json`, "layer of what it landed", [{ id: "layer-invented-1", kind: "story.beat", events: [], by: { role: "historian", job: "survey" } }]],
        [`${run}/layer/held.json`, "layer of what it landed: held", []],
        [`${run}/bootstrap/depth.json`, "the chat's switch to it", { on: true }],
        [`${run}/bootstrap/run.json`, "bootstrap of the chat: the run", { v: 1, state: "done", at: DEPTH_AT }],
        [`${run}/bootstrap/handover.json`, "bootstrap of the chat: the handover", { version: 1, at: DEPTH_AT, messages: 2 }],
        [`${run}/bootstrap/manifest.json`, "bootstrap of the chat: the spool's index", { v: 1, chunks: 1 }],
        [`${run}/bootstrap/spool/00000.json`, "bootstrap of the chat: the spool of messages", { v: 1, messages: [{ id: "m-invented-1", text: "Monday comes in grey and cool off the lake." }] }],
        [`${run}/bootstrap/jobs/survey.json`, "bootstrap of the chat: a job's recorded answer", { v: 1, answer: "Jordan works at Alder Automotive and walks to the marina before shifts." }],
      ];
      // With the extension off, a change of the agents chat's metadata reaches no handler of today's that could write its preferences again.
      await withExtensionOff(ctx, "planted", async () => {
        for (const [rel, , value] of files) plant(ctx, rel, JSON.stringify(value));
        const chat = await ctx.host.chat(markChat);
        const own = chat.metadata?.lumi_rp_engine;
        if (own === null || typeof own !== "object" || Array.isArray(own)) throw new Error("the agents chat holds no engine metadata to mark");
        const prefs = "prefs" in own && own.prefs !== null && typeof own.prefs === "object" ? own.prefs : {};
        // Lumiverse's own partial merge of a chat's metadata, one top-level key replaced (Lumiverse `src/routes/chats.routes.ts:470-500`).
        await ctx.host.call("PATCH", `/api/v1/chats/${markChat}/metadata`, { lumi_rp_engine: { ...own, prefs: { ...prefs, engineFrom: "default" } } });
      });
      record(ctx, "depth-files", files.map(([rel, kind]) => ({ row: "depth" as const, kind, made: "planted" as const, where: "storage" as const, path: rel })));
      record(ctx, "depth-mark", { row: "depth", kind: "a chat's mark that its engine came from the default", made: "planted", where: "chat-metadata", path: "lumi_rp_engine.prefs.engineFrom", chat: "chat:agents" });
    });
  },
};

/**
 * A line against its turn's decisions on a harness reply's record, in its record in the journal and in the reply's metadata: on the
 * newest reply of the harness chat whose record is in one piece. A long turn's record is split in chunks over the message's metadata
 * (`lumi_rp_engine:<n>`, the record's key then holding only the chunks' count and hash), and a split record is not planted on.
 */
export const departures: Step = {
  name: "departures",
  makes: "a line against its turn's decisions on a harness reply's record (planted: nothing on today's build writes one)",
  async run(ctx) {
    const chatId = await chatOf(ctx, "harness");
    if (chatId === null) throw new Error("the chats step must run first");
    await ctx.log.once("planted:departures", async () => {
      const line = "The reply has Dale lock the marina office at eight; the turn had him lock it at nine.";
      const messages = await ctx.host.messages(chatId);
      const inOnePiece = (m: (typeof messages)[number]): boolean => {
        const own = m.extra?.spindle_metadata;
        const record = isObject(own) ? own.lumi_rp_engine : undefined;
        return !m.is_user && isObject(record) && isObject(record.swipes);
      };
      const reply = messages.filter(inOnePiece).at(-1);
      const meta = reply?.extra?.spindle_metadata;
      const ledger = isObject(meta) ? meta.lumi_rp_engine : undefined;
      if (reply === undefined || !isObject(meta) || !isObject(ledger) || !isObject(ledger.swipes)) throw new Error("no reply of the harness chat holds a record in one piece to plant on (a record split in chunks is not planted on)");
      const swipe = String(reply.swipe_id);
      const metaSwipes: JsonObject = ledger.swipes;
      const withLine = (swipes: JsonObject): JsonObject => {
        const rec = swipes[swipe];
        if (!isObject(rec) || !isObject(rec.harness)) throw new Error(`the harness reply's swipe ${swipe} holds no harness record`);
        return { ...swipes, [swipe]: { ...rec, harness: { ...rec.harness, departures: [line] } } };
      };
      // The journal first, the authority (`ledger-io.ts` keeps each message's ledger under `messages`),
      // then the reply's metadata, its mirror, both with the extension off: a running one re-asserts the
      // journal it holds over the message at the edit's event (`ledger-io.ts:2655-2686`, `journal.ts:217-225`).
      const journalRel = `runs/${chatId}/journal.json`;
      await withExtensionOff(ctx, "planted", async () => {
        const journal = readObject(ctx, journalRel);
        const entries = journal.messages;
        const entry = isObject(entries) ? entries[reply.id] : undefined;
        const kept = isObject(entry) ? entry.ledger : undefined;
        if (!isObject(entries) || !isObject(entry) || !isObject(kept) || !isObject(kept.swipes)) throw new Error(`the harness chat's journal holds no ledger for its last reply`);
        plant(ctx, journalRel, JSON.stringify({ ...journal, messages: { ...entries, [reply.id]: { ...entry, ledger: { ...kept, swipes: withLine(kept.swipes) } } } }));
        await ctx.host.call("PUT", `/api/v1/chats/${chatId}/messages/${reply.id}`, { extra: { ...reply.extra, spindle_metadata: { ...meta, lumi_rp_engine: { ...ledger, swipes: withLine(metaSwipes) } } } });
      });
      record(ctx, "departures", { row: "departures", kind: "a line against its turn's decisions, on a harness reply's record", made: "planted", where: "message-metadata", chat: "chat:harness", path: `${reply.id}:${swipe}` });
      say(`  planted a departure line on reply ${reply.id} swipe ${swipe}`);
    });
  },
};

/** Whether the one file no row names is where the `leftovers` step placed it (item 5: after every step, it is). */
export function unnamedFilePresent(ctx: Pick<Ctx, "env" | "userId" | "log">): boolean {
  const placed = ctx.log.get<{ path?: string }>("planted:unnamed");
  return placed?.path !== undefined && existsSync(join(userStorage(ctx.env, ctx.userId), placed.path));
}

/** Planted after all play, in this order; the depth engine's files and mark last but one, the departure line last of all. */
export const PLANTED_STEPS: Step[] = [setAside, readerWrites, depthKinds, departures];
