// Which row of the plan's table each file found belongs to, by its path, and the fate it meets.
// Every path today's build writes has a rule here, each with the code that writes it: the user's
// storage (`src/backend/**` and LumiAH under `harness/`), the extension's own storage, and the
// runtime's folders on the server (LumiAH's `src/runtime/**`). A path no rule names is "found, not
// classified": the real run refuses to start while there is one, so nothing is skipped silently.

import { ROW, type Fate, type RowId } from "./rows";

export interface Classified {
  row: RowId;
  fate: Fate;
  /** Why this one meets another fate than its row's, or what else the report should say of it. */
  note?: string;
  /** A damaged file: the report lists it among what couldn't be read. */
  unreadable?: true;
}

/** What the rules need to know besides a path: the user's chats, and those LumiAH was told to forget. */
export interface ClassifyContext {
  chats: ReadonlySet<string>;
  forgotten: ReadonlySet<string>;
}

const SAFE = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const HASH32 = "[0-9a-f]{32}";
const HASH64 = "[0-9a-f]{64}";
/** A part of a LumiAH document path (`DOC_PATH`, `H/link/contract.ts:106`). */
const PART = "[A-Za-z0-9._-]{1,128}";

/**
 * What a temporary file is: the first half of a write (the text, before it is moved into place).
 * Read while today's build runs, it may be one under way; one left from before is one cut short.
 */
const TEMPORARY = "a temporary file: a write under way, or one cut short";

/** A rule: a path pattern, the row it belongs to, a fate when it isn't the row's own, and what the report says of the file. */
type Rule = readonly [pattern: RegExp, row: RowId, fate?: Fate, note?: string];

const rule = (pattern: string, row: RowId, fate?: Fate, note?: string): Rule => [new RegExp(`^${pattern}$`), row, fate, note];

/**
 * Why the depth engine's files are archived. Today's build has none of its code: main was put back
 * on the pre-depth build (5639d28c), so nothing reads them, and RPE's own bootstrap reads a chat's
 * history afresh (STANDALONE-PLAN §12). The references below are to the depth build before that,
 * a54b3987, under `src/backend/`.
 */
const DEPTH_GONE = "today's build has no depth engine, so nothing reads it now";

const depth = (pattern: string, what: string): Rule => rule(pattern, "depth-engine", undefined, `${what}; ${DEPTH_GONE}`);

/**
 * What today's build keeps in the extension's own storage (`spindle.storage`), for the extension as a
 * whole: the update notice (`agents.ts:51,251`), the backend's log (`spindle-host.ts:283,439`) and the
 * depth engine's loopback registry (`loopback/store.ts:47`). That folder is shared by every user of
 * the Lumiverse, so these are the only files of it the migration reads, keeps or counts: any other
 * file there may be kept for another user, and is never opened, listed or backed up. Each has its
 * rule below.
 */
export const EXTENSION_WIDE: readonly string[] = ["agents/build.json", "diagnostics/backend.log", "loopback/registry.json"];

/**
 * The files of the user's storage, and of the extension's own storage (which sits in the same
 * folder when the extension is installed for one user). Each names the code that writes it.
 */
const STORAGE_RULES: readonly Rule[] = [
  rule("settings\\.json", "settings"), // settings-store.ts:33,1012
  rule("extraction-learning\\.json", "logs"), // settings-store.ts:34,1053: the old engines' learning
  rule("agents\\.json", "mcp-clients"), // agents.ts:53,516: outside harnesses' check-ins
  rule("agent-acceptance\\.json", "logs"), // agents/provider.ts:380,560: acceptance runs
  rule("jobs\\.json", "build-jobs"), // jobs.ts:38,303
  rule("lore-ids\\.json", "build-jobs"), // lore-ids.ts:34,92
  rule("lore-tools\\.json", "logs"), // lore-steps.ts:440,474: connections that refused lore tools
  rule("call-meter\\.json", "logs"), // steps.ts:59,124
  rule("diagnostics\\.log", "logs"), // spindle-host.ts:285,440
  rule("agents/sweep\\.json", "logs"), // agents/sweep.ts:41,291: sweep runs
  rule("agents/global\\.json", "agents-workspace"), // global-workspace.ts:17,68
  rule(`agents/blobs/${HASH32}`, "sessions"), // agents/blobs.ts:27,83
  rule(`prompts/sets/${HASH32}\\.json`, "texts"), // prompts.ts:135,156
  rule(`secrecy/${HASH32}\\.json`, "build-jobs"), // secrecy-migration.ts:46,307
  rule(`worlds/${SAFE}/(index|draft|history)\\.json`, "worlds"), // worlds.ts:185,349,530
  rule(`worlds/${SAFE}/rev/${HASH32}\\.json`, "worlds"), // worlds.ts:123,339
  rule(`runs/${SAFE}/journal\\.json`, "ledger"), // ledger-io.ts:48,2643
  rule(`runs/${SAFE}/snapshots\\.json`, "derived"), // ledger-io.ts:222,2635
  rule(`runs/${SAFE}/(chips|staged)\\.json`, "chips-staged"), // chips.ts:65,100; staged.ts:35,54
  rule(`runs/${SAFE}/(plans|scene)\\.json`, "old-engine-notes"), // plan-notes.ts:30,63; chat-prefs.ts:46
  rule(`runs/${SAFE}/outcome-notes\\.json`, "old-engine-notes"), // an earlier build's classic notes, swept at start (chips.ts:53,92)
  rule(`runs/${SAFE}/prefs\\.json`, "settings"), // chat-prefs.ts:32,69
  rule(`runs/${SAFE}/(inspector|diagnostics)\\.json`, "logs"), // inspector-log.ts:133,183; diagnostics.ts:204,766
  // LumiAH's root documents (`H/extension/backend/docs.ts`), under `harness/` (mount.ts:52,112).
  rule("harness/settings\\.json", "settings"), // settings.ts:65
  rule("harness/registry\\.json", "loopback"), // registry.ts:49
  rule("harness/mirror-holder\\.json", "chat-copy"), // mirror.ts:58
  rule("harness/chats\\.json", "chat-switch"), // switch.ts:114
  rule("harness/(turns|notices)\\.json", "logs"), // open.ts:60; notices.ts:11: open turns and notices
  rule("harness/forget\\.json", "forget-list"), // forget.ts:52
  rule("harness/database\\.json", "chat-copy"), // copy.ts:95
  rule("harness/story\\.json", "settings"), // story.ts:28
  // LumiAH's documents (`H/core/paths.ts:16-43`), mirrored from the runtime (`reads.ts:26`).
  rule("harness/docs/workspace/user\\.json", "learned-and-home"),
  rule(`harness/docs/chats/${PART}/learned\\.json`, "learned-and-home"),
  rule(`harness/docs/chats/${PART}/area/${PART}\\.json`, "author-notes"),
  rule(`harness/docs/chats/${PART}/(approvals|jobs)\\.json`, "approvals-jobs"),
  rule(`harness/docs/chats/${PART}/session\\.json`, "sessions"),
  rule(`harness/docs/chats/${PART}/recall\\.json`, "derived"), // core/recall/recall.ts:60
  rule(`harness/docs/jobs/${PART}\\.json`, "approvals-jobs"),
  rule("harness/docs/sides\\.json", "assistant-threads"),
  rule(`harness/docs/sides/${PART}\\.json`, "assistant-threads"),
  rule(`harness/docs/spend/${PART}/${PART}\\.json`, "spend"),
  rule("harness/docs/upkeep\\.json", "spend"),
  rule("harness/docs/recall/embedded\\.json", "derived"), // core/recall/meaning.ts:217
  rule(`harness/docs/recall/vectors(/${PART}){1,4}`, "derived"), // core/recall/meaning.ts:216
  rule("harness/docs/mirror\\.json", "chat-copy"), // link/contract.ts:112; runtime/store/index.ts:667
  rule(`harness/blobs/[0-9a-f]{2}/${HASH64}`, "sessions"), // extension/backend/reads.ts:14
  // The extension's own storage (`spindle.storage`; the paths of `EXTENSION_WIDE`).
  rule("agents/build\\.json", "mcp-clients"), // agents.ts:51,251: the update notice
  rule("diagnostics/backend\\.log", "logs"), // spindle-host.ts:283,439
  // The depth engine's files (see `DEPTH_GONE` for where these lines are).
  depth("depth/day-spend\\.json", "what the depth engine spent today, kept for its daily ceiling"), // depth/budget.ts:32,133
  depth(`runs/${SAFE}/bootstrap/depth\\.json`, "the chat's switch to the depth engine, and the connection pin that switch replaced in Lumiverse"), // bootstrap/service.ts:42,50
  depth(`runs/${SAFE}/bootstrap/(absorption|allowances|history)\\.json`, "a setting of the chat's for the depth engine"), // depth/chat-absorption.ts:3; depth/chat-allowances.ts:3; depth/history-cut.ts:2
  depth(`runs/${SAFE}/bootstrap/(run|handover|lumibooks)\\.json`, "where the depth engine's bootstrap of the chat stood"), // bootstrap/run.ts:341,354; bootstrap/lumibooks-service.ts:24
  depth(`runs/${SAFE}/bootstrap/(manifest|edits)\\.json`, "the index of the depth engine's copy of the chat's messages"), // bootstrap/spool.ts:67,78
  depth(`runs/${SAFE}/bootstrap/spool/\\d{5}\\.json`, "a part of the depth engine's copy of the chat's messages"), // bootstrap/spool.ts:70,177
  depth(`runs/${SAFE}/bootstrap/jobs/${PART}\\.json`, "what one job of the depth engine's bootstrap answered"), // bootstrap/run.ts:461,1187,1193
  depth(`runs/${SAFE}/bootstrap/spot/${PART}\\.json`, "a spot-check card of the depth engine's bootstrap"), // bootstrap/run.ts:624,1155
  depth(`runs/${SAFE}/layer/(meta|held)\\.json`, "the index of what the depth engine landed for the chat, which only its own fold read"), // layer-store.ts:1-8,278,288
  depth(`runs/${SAFE}/layer/seg-\\d+\\.json`, "what the depth engine landed for the chat, which only its own fold read"), // layer-store.ts:5,131
  depth(`runs/${SAFE}/archive/shard-\\d+\\.json`, "the depth engine's search index of the chat's messages, made from them"), // archive-index.ts:29,144,210
  depth("loopback/registry\\.json", "the depth engine's loopback registry: its keys' and relays' hashes"), // loopback/store.ts:47
  // RPE's own: the new light extension's registration with RPE (`src/adapter/lumiverse/pipe-wire.ts:24`, written by `src/ext/registration.ts:39`).
  rule("rpe/registration\\.json", "rpe-own", undefined, "RPE's own: the light extension's registration with RPE, which the migration leaves as it is"),
];

/** The chat a per-chat path is kept for, and whose store keeps it: `runs/<chat>/` names it as it is, LumiAH's `chats/<key>/` as its document key (`docKey`, `H/core/paths.ts:12`). */
function chatOf(path: string): { chat: string; lumiah: boolean } | null {
  const run = /^runs\/([^/]+)\//.exec(path);
  if (run) return { chat: run[1] ?? "", lumiah: false };
  const doc = /^harness\/docs\/chats\/([^/]+)\//.exec(path);
  if (!doc) return null;
  try {
    return { chat: decodeURIComponent(doc[1] ?? ""), lumiah: true };
  } catch {
    return null;
  }
}

function byRules(rules: readonly Rule[], path: string): Classified | null {
  for (const [pattern, row, fate, note] of rules) if (pattern.test(path)) return { row, fate: fate ?? ROW[row].fate, ...(note === undefined ? {} : { note }) };
  return null;
}

/**
 * The row and fate of a file of the user's or the extension's storage, or null when no row names
 * it. A temporary file a write left behind, a damaged file set aside and LumiAH's kept unreadable
 * text belong to the row of the file they were made from, archived. What is kept for a chat that is
 * gone from Lumiverse is run data of a deleted chat; LumiAH's documents of a chat its list of chats
 * to forget names are archived, as LumiAH would have removed them.
 */
export function classifyStorage(path: string, context: ClassifyContext): Classified | null {
  const temp = /^(.+)\.tmp$/.exec(path);
  if (temp) {
    const base = classifyStorage(temp[1] ?? "", context);
    return base && { row: base.row, fate: "archived", note: TEMPORARY };
  }
  const aside = /^(.+)\.corrupt-\d+$/.exec(path); // stored-json.ts:10,42
  if (aside) {
    const base = classifyStorage(aside[1] ?? "", context);
    return base && { row: base.row, fate: "archived", note: "a damaged file today's build had already set aside", unreadable: true };
  }
  const bad = /^(harness\/[a-z-]+\.json)\.bad$/.exec(path); // H/extension/backend/docs.ts:93
  if (bad) {
    const base = classifyStorage(bad[1] ?? "", context);
    return base && { row: base.row, fate: "archived", note: "unreadable text LumiAH kept before writing over it", unreadable: true };
  }
  const found = byRules(STORAGE_RULES, path);
  const of = found && chatOf(path);
  if (!found || !of) return found;
  if (of.lumiah && context.forgotten.has(of.chat)) return { ...found, fate: "archived", note: "kept for a chat LumiAH's list of chats to forget names" };
  if (!context.chats.has(of.chat)) return { row: "deleted-chats", fate: "archived", note: "kept for a chat no longer in Lumiverse" };
  return found;
}

/**
 * The files of the runtime's folders, by where the migration found them: `config/` (its config
 * folder), `runtimes/<name>/` (its own folder), `installed/` (the folder of the installed copy) and
 * `unit/` (the folder of its service unit). Only the runtimes of this extension are read at all.
 */
const RUNTIME_RULES: readonly Rule[] = [
  rule(`config/${SAFE}\\.json`, "runtime-settings"), // runtime/config.ts:75; cli.ts:455
  rule(`config/${SAFE}\\.json\\.\\d+\\.tmp`, "runtime-settings", "archived"), // main.ts:128-132
  rule(`runtimes/${SAFE}/(connections|secrets)\\.json`, "connections"), // models/book.ts:257-258
  rule(`runtimes/${SAFE}/(connections|secrets)\\.json\\.tmp`, "connections", "archived"), // models/book.ts:324-338
  rule(`runtimes/${SAFE}/waiting\\.json`, "logs"), // cli.ts:722,770: the mark of a copy waiting for the port
  rule(`runtimes/${SAFE}/store/${HASH32}/identity\\.json`, "working-copy"), // store/index.ts:532
  rule(`runtimes/${SAFE}/store/${HASH32}/docs(/${PART}){1,8}`, "working-copy"), // store/index.ts:312
  rule(`runtimes/${SAFE}/store/${HASH32}/blobs/[0-9a-f]{2}/${HASH64}`, "working-copy"), // store/index.ts:313
  rule(`runtimes/${SAFE}/store/${HASH32}/journal/(d|b)\\.${HASH64}`, "working-copy"), // store/index.ts:315
  rule(`runtimes/${SAFE}/store/${HASH32}/tmp/[^/]+`, "working-copy"), // store/index.ts:311,462
  rule("installed/lumiah\\.js", "working-copy"), // config.ts:98-100
  rule("installed/lumiah\\.js\\.[^/]+\\.tmp", "working-copy"), // main.ts:134-138; update.ts:237-246
  // The unit is kept in the backup, for going back; RPE runs under its own (STANDALONE-PLAN §15.2).
  rule(`unit/lumiah-${SAFE}\\.service`, "runtime-settings", "archived"), // cli.ts:655; contract.ts:693
  rule(`unit/lumiah-${SAFE}\\.service\\.[^/]+\\.tmp`, "runtime-settings", "archived"), // cli.ts:655; update.ts rewriteUnit
];

export function classifyRuntime(path: string): Classified | null {
  const found = byRules(RUNTIME_RULES, path);
  if (found && path.endsWith(".tmp")) return { ...found, fate: "archived", note: TEMPORARY };
  return found;
}
