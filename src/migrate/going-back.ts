// Going back to the previous build (STANDALONE-PLAN §15.6), in its four steps: the words `rpe down`
// prints when it has stopped RPE's service, the report's and the Migration page's list. They are the
// application's own texts, kept with the command line's other output, and sent to no model. Today's
// data was never changed and the connection in Lumiverse neither (at the swap RPE answered on it as it
// was, in its runtime's place), so these steps are all going back takes; further steps name what the
// swap recorded at the cutover and what changed since: the chats moved onto RPE's connections, RPE's
// own earlier connection, a key put on a taken connection since. His word that he will not go back is
// kept here too (§15.6 l.1728; R-90): only after it does RPE offer to remove what today's build put in
// Lumiverse (`engine-book.ts`).

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { diskTexts, readConfig } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { openQuiet } from "./quiet-db";
import { lastReport } from "./tables";

/**
 * The permissions the previous build asks for, as its manifest names them (`spindle.json` of the build
 * kept for going back, RPEngine 71e30e33), in its order. Lumiverse withdrew those the light extension
 * doesn't ask for when it took the previous build's place, and treats them as new on the way back.
 */
export const PREVIOUS_PERMISSIONS = ["generation", "context_handler", "chats", "chat_mutation", "world_books", "presets", "regex_scripts", "decisions", "ui_panels", "mcp_servers", "interceptor", "embeddings", "memories", "databanks", "web_search", "generation_parameters", "cors_proxy"] as const;

/**
 * The permissions the light build asks for, as its manifest names them (`spindle.json`). The swap
 * goes on only once Lumiverse has granted each of them; the previous build's other twelve are
 * withdrawn when the extension is switched to the light build (PlanSwap-1).
 */
export const LIGHT_PERMISSIONS = ["interceptor", "generation_parameters", "generation", "cors_proxy", "ui_panels"] as const;

/**
 * Of the twelve that return on the way back, those Lumiverse holds as privileged (`PRIVILEGED_PERMISSIONS`,
 * its `manager.service.ts`): they wait for an admin's approval. The other four it grants again by
 * itself when the previous build's manifest returns.
 */
export const ADMIN_APPROVES = ["context_handler", "chats", "world_books", "presets", "regex_scripts", "mcp_servers", "databanks", "web_search"] as const;

const RETURNING = PREVIOUS_PERMISSIONS.filter((p) => !(LIGHT_PERMISSIONS as readonly string[]).includes(p));
const BY_THEMSELVES = RETURNING.filter((p) => !(ADMIN_APPROVES as readonly string[]).includes(p));

/** The branch of the new build, which the installed extension is switched to in Lumiverse until it is `main` (§15.3 l.1677). */
export const NEW_BUILD_BRANCH = "standalone";

/** The setting naming the branch the previous build is kept on (§19 item 4; R-84), and its default, until the owner names it. */
export const PREVIOUS_BRANCH_KEY = "migration.previousBranch";
export const PREVIOUS_BRANCH_DEFAULT = "before-standalone";

export const PREVIOUS_BRANCH_SETTING: Setting = {
  key: PREVIOUS_BRANCH_KEY,
  default: PREVIOUS_BRANCH_DEFAULT,
  takes: { type: "text" },
  levels: ["global"],
  perConnection: false,
  name: "The previous build's branch",
  about: "The branch of the extension's repository the previous build is kept on: going back switches the installed extension to it, and rpe down, the Migration page and the migration's report name it.",
  effect: "use",
};

/** The branch the previous build is kept on, as the global config says now; its default where it says none. */
export async function previousBranch(globalConfig: string): Promise<string> {
  const read = readConfig(await diskTexts([{ level: "global", file: globalConfig, disk: globalConfig }]), null, [PREVIOUS_BRANCH_SETTING]);
  const value = read.read(PREVIOUS_BRANCH_SETTING).value;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : PREVIOUS_BRANCH_DEFAULT;
}

/** A chat moved onto one of RPE's connections since the swap, by its name, with the connection it was on at the cutover (null: none of its own, so it followed the one active for him). */
export interface MovedChat {
  chat: string;
  name: string;
  had: string | null;
}

export interface GoingBackFacts {
  /** The extension's identifier in Lumiverse: the one the swap used, where a swap was made. */
  identifier: string;
  /** Today's runtime the swap took the place of, as the last run's report names it: its name and the file it was set up from (null: not known). Null where no run took one. */
  runtime: { name: string; source: string | null } | null;
  /** RPE's own connection in Lumiverse, by its id, where RPE answered on one of its own rather than on today's; absent or null where it took today's over. */
  own?: string | null;
  /** The branch the previous build is kept on (`migration.previousBranch`); its default where left out. */
  branch?: string;
  /** The chats moved onto one of RPE's connections since the swap. */
  moved?: readonly MovedChat[];
  /** RPE's own connections from before a swap that took today's: nothing has answered on them since. */
  earlier?: readonly string[];
  /** The connections the swap took whose key RPE holds no longer: a key made since took its place (only a data folder of the first build can hold one). */
  keyReplaced?: readonly string[];
}

/** A word of a shell line, quoted where it must be. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** What removing the extension does (AuFacts-117): never done to go back or forward, since switching its branch keeps everything. */
const NEVER_REMOVE = "Never remove the extension to install it again: removing it deletes its own folder with its storage, and leaves each user's own folder for it behind";

/** The branch switch and the permissions approved again (§15.6's steps 2 and 3), numbered from `first`: all that going back needs where today's service was never stopped. */
function switchBack(identifier: string, branch: string, first: number): [branch: string, approve: string] {
  return [
    `  ${first}. In Lumiverse, switch the installed extension (${identifier}) to the branch the previous build is kept on, ${branch}, with Lumiverse's branch switch: switching keeps its storage. ${NEVER_REMOVE} (the migration's backup holds a copy).`,
    `  ${first + 1}. In Lumiverse's extension settings, the previous build asks again for the ${RETURNING.length} permissions the light build did not: ${ADMIN_APPROVES.join(", ")} wait for an admin's approval, so approve them (or have an admin of this Lumiverse do so); ${BY_THEMSELVES.join(", ")} come back by themselves. Then switch the extension off and on again, so that it starts with them in hand. The ${PREVIOUS_PERMISSIONS.length} permissions it asks for: ${PREVIOUS_PERMISSIONS.join(", ")}.`,
  ];
}

const connections = (ids: readonly string[]): string => (ids.length === 1 ? `the connection ${ids[0]}` : `the connections ${ids.join(", ")}`);

/** The steps of going back, as lines; the first is what `rpe down` has just done, or, where it has not been run (`facts.downRun` false), what it does. */
export function goingBack(facts: GoingBackFacts & { downRun?: boolean }): string[] {
  const name = facts.runtime === null ? "<its name>" : shellWord(facts.runtime.name);
  const source = facts.runtime?.source ?? null;
  const script = source === null ? "<the extension's folder>/dist/lumiah.js" : shellWord(source);
  const down = "RPE's service is stopped and removed, and its data stays where it is: what you played on RPE does not flow back, and a later cutover finds it as you left it.";
  const more: string[][] = [];
  const moved = facts.moved ?? [];
  if (moved.length > 0) {
    more.push([
      "In Lumiverse, give each chat you moved onto one of RPE's connections since the swap the connection it had then: RPE no longer answers there.",
      ...moved.map((c) => `       "${c.name}" (${c.chat}): ${c.had === null ? "no connection of its own, so that it follows the one active for you" : `the connection ${c.had}`}`),
    ]);
  }
  if (facts.own) more.push([`In Lumiverse, give every chat you moved to RPE's connection ${facts.own} the connection it had before: RPE no longer answers there.`]);
  const earlier = facts.earlier ?? [];
  if (earlier.length > 0) more.push([`In Lumiverse, ${connections(earlier)}, RPE's own before the swap took today's, ${earlier.length === 1 ? "answers" : "answer"} nothing: RPE answered there alone. Give any chat still on ${earlier.length === 1 ? "it" : "them"} the previous build's connection, or remove ${earlier.length === 1 ? "it" : "them"}.`]);
  const replaced = facts.keyReplaced ?? [];
  if (replaced.length > 0) more.push([`In Lumiverse, put back on ${connections(replaced)} the key ${replaced.length === 1 ? "it" : "each"} held before the swap: the previous build's runtime takes only that key, and the one there now is a key RPE made.`]);
  return [
    "To go back to the previous build: today's data was never changed, and neither was its connection in Lumiverse.",
    facts.downRun === false ? `  1. Run rpe down: ${down}` : `  1. rpe down: done. ${down}`,
    ...switchBack(facts.identifier, facts.branch ?? PREVIOUS_BRANCH_DEFAULT, 2),
    `  4. Run the previous build's own install line, the one you use when you update it: bun ${script} up --name ${name} --systemd. It reads its address from its own config, keeps its registration, and takes up its service's unit, which the swap only switched off, with the memory cap it holds: all as the swap left them.`,
    ...more.flatMap(([first, ...rest], i) => [`  ${5 + i}. ${first}`, ...rest]),
  ];
}

/**
 * What a stop of the swap says, once the installed extension was switched to the new build (every stop
 * the swap makes after its first guard, which proved that): why it stopped; what has changed (Lumiverse
 * runs the light extension, and the permissions it does not ask for were withdrawn); what has not
 * (today's service runs, and today's data is as it was); and the way back, §15.6's steps 2 and 3 with
 * the previous build's permissions by name. Today's service was never stopped, so no more is needed.
 */
export function stopAfterSwitch(facts: Pick<GoingBackFacts, "identifier" | "branch">, why: string): string[] {
  return [
    why,
    `What has changed: Lumiverse runs the light extension (${facts.identifier}) now, and the ${RETURNING.length} permissions it does not ask for were withdrawn (${RETURNING.join(", ")}). What has not: today's service runs, and today's data is as it was.`,
    "To go back to the previous build now:",
    ...switchBack(facts.identifier, facts.branch ?? PREVIOUS_BRANCH_DEFAULT, 1),
  ];
}

/**
 * The steps before the swap, as he is shown them (§15.3 step 10; R-80, R-82, R-83): the report of the
 * rehearsal and the real run prints them, the Migration page shows them, and `rpe up` prints them
 * where it finds the extension not yet switched. `up` is the line that runs the swap, as the caller
 * writes it (`rpe up` where it has none).
 */
export function swapSteps(facts: Pick<GoingBackFacts, "identifier"> & { up?: string }): string[] {
  return [
    `  1. In Lumiverse, switch the installed extension (${facts.identifier}) to the new build's branch, ${NEW_BUILD_BRANCH} until it is main, with Lumiverse's branch switch: switching keeps its storage. ${NEVER_REMOVE}.`,
    `  2. In Lumiverse's extension settings, approve its five permissions: ${LIGHT_PERMISSIONS.join(", ")}.`,
    "  3. Let any reply being written finish: the swap waits for today's runtime to be idle before it stops it, and stops nothing while a reply is under way.",
    `  4. Run ${facts.up ?? "rpe up"}.`,
  ];
}

/** What the swap recorded at the cutover, for going back (PlanSwap-2 item 5, PlanSwap-3 item 5). */
export interface SwapRecord {
  /** When the swap's run read today's data. */
  at: string;
  /** The extension's identifier in Lumiverse the swap used. */
  identifier: string;
  /** Lumiverse's data folder the swap's run read: where each chat's connection is read again. */
  lumiverse: string;
  /** The connections in Lumiverse the swap made RPE's. */
  taken: string[];
  /** RPE's own connections from before the swap, which nothing answers once it took today's. */
  earlier: string[];
  /** Each chat that was on today and on none of RPE's connections at the cutover, with the connection it was on (null: none of its own). */
  chats: { chat: string; pinned: string | null }[];
}

// The two tables below are the migration's (`tables.ts`, step 8: `migration_swap`, `migration_no_going_back`); before that step
// is there, nothing is read from them.

function hasTable(db: Database, name: string): boolean {
  return (db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.n ?? 0) > 0;
}

/** Keeps the swap's record. */
export function keepSwap(db: Database, user: string, record: SwapRecord): void {
  db.run("INSERT OR REPLACE INTO migration_swap (user, at, record) VALUES (?, ?, ?)", [user, record.at, JSON.stringify(record)]);
}

/** Takes a swap's record out again, where the swap put back what it did. */
export function dropSwap(db: Database, user: string, at: string): void {
  db.run("DELETE FROM migration_swap WHERE user = ? AND at = ?", [user, at]);
}

/** The last swap's record; null where no swap went through in this data folder. */
export function lastSwap(db: Database, user: string): SwapRecord | null {
  if (!hasTable(db, "migration_swap")) return null;
  const row = db.query<{ record: string }, [string]>("SELECT record FROM migration_swap WHERE user = ? ORDER BY at DESC, rowid DESC LIMIT 1").get(user);
  return row === null ? null : (JSON.parse(row.record) as SwapRecord);
}

/** When he said he will not go back; null where he has not. */
export function noGoingBack(db: Database, user: string): string | null {
  if (!hasTable(db, "migration_no_going_back")) return null;
  return db.query<{ at: string }, [string]>("SELECT at FROM migration_no_going_back WHERE user = ?").get(user)?.at ?? null;
}

/** Keeps his word that he will not go back, once: said again, the first time stands. When it was said. */
export function sayNoGoingBack(db: Database, user: string, at: string): string {
  db.run("INSERT OR IGNORE INTO migration_no_going_back (user, at) VALUES (?, ?)", [user, at]);
  return noGoingBack(db, user) ?? at;
}

/** Whether RPE holds a key Lumiverse's connections send and none of them is the one the swap took: a key made since took its place (a data folder of the first build). */
export function takenKeyReplaced(db: Database, user: string): boolean {
  if (!hasTable(db, "provider_key")) return false;
  const row = db.query<{ all: number; taken: number }, [string]>("SELECT count(*) AS \"all\", coalesce(sum(taken), 0) AS taken FROM provider_key WHERE user = ?").get(user);
  return row !== null && row.all > 0 && row.taken === 0;
}

/** Reads RPE's database at `file` without changing it (as `earlierRuns` does); null where there is none. */
export function readRpe<T>(file: string, read: (db: Database) => T): T | null {
  if (!existsSync(file)) return null;
  const locked = !existsSync(`${file}-wal`) && !existsSync(`${file}-shm`) ? null : new Database(file, { readonly: true });
  const opened = locked === null ? openQuiet(file) : { db: locked, close: () => locked.close() };
  try {
    return read(opened.db);
  } finally {
    opened.close();
  }
}

/**
 * The chats of the swap's record that are on one of RPE's connections now (`rpe`) and were on another
 * then, each by its name, from the chats Lumiverse holds now (`now`).
 */
export function movedSince(record: SwapRecord, now: readonly ChatNow[], rpe: ReadonlySet<string>): MovedChat[] {
  const byId = new Map(now.map((c) => [c.id, c]));
  return record.chats.flatMap((then) => {
    const chat = byId.get(then.chat);
    const pin = chat?.metadata.connection_profile_id;
    const pinned = typeof pin === "string" && pin.trim() !== "" ? pin.trim() : null;
    return chat === undefined || pinned === null || pinned === then.pinned || !rpe.has(pinned) ? [] : [{ chat: then.chat, name: chat.name, had: then.pinned }];
  });
}

/** A chat as Lumiverse holds it now: its id, its name and its metadata, where its connection is pinned. */
export interface ChatNow {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
}

/**
 * Going back's facts from what RPE's database holds (the last run's report, the swap's record, the keys)
 * and the chats Lumiverse holds now (null: not read): the identifier the swap used, else `identifier`;
 * RPE's connections now (`rpe`, its config's); `own`, RPE's own connection where it did not take today's.
 */
export function goingBackFacts(db: Database, user: string, input: { identifier: string; branch: string; rpe: readonly string[]; own: string | null; chats: readonly ChatNow[] | null }): GoingBackFacts {
  const swap = lastSwap(db, user);
  const taken = lastReport(db, user)?.runtime?.taken ?? null;
  return {
    identifier: swap?.identifier ?? input.identifier,
    runtime: taken === null ? null : { name: taken.name, source: taken.source },
    branch: input.branch,
    own: input.own,
    moved: swap === null || input.chats === null ? [] : movedSince(swap, input.chats, new Set([...swap.taken, ...input.rpe])),
    earlier: swap?.earlier ?? [],
    keyReplaced: swap !== null && swap.taken.length > 0 && takenKeyReplaced(db, user) ? swap.taken : [],
  };
}
