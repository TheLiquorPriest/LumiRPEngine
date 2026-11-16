// An invented chat on the store lane's invented world: the store and the cast on one database behind
// the application's write queue, played the way the turn lane drives the store (the player's message
// shown, a turn begun after it, its reply tied and shown; a swipe; a delete). Lumiverse's sources are
// an invented shelf whose revisions a test can change. Every name here is made up.

import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGuidance, type TemplatePart } from "rp-harness";
import type { AgentRef, HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { WriteQueue } from "../../src/app/database";
import { CAST_STORE_AREA, castTools, type CastDeps } from "../../src/cast/index";
import { STORY_STORE_AREA } from "../../src/story";
import { castAt } from "../../src/cast/path";
import { attachFile, CastRecord, type CastRow, type CastWrite, type SourceKind, writeCast } from "../../src/cast/record";
import { CAST_MIGRATIONS } from "../../src/cast/schema";
import { LORE_MIGRATIONS } from "../../src/lore/schema";
import type { SourceNow, SourceReader } from "../../src/cast/sources";
import { CAST_VIEWS, type CastViewName } from "../../src/cast/views";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import { migrateStore, openStore, type ShownMessage, type Store, type TurnRow, type UserStore } from "../../src/store";
import { asHarnessPasses } from "../story/rig";
import { hashOf, inventedWorld, registry } from "../store/fixtures";

export const USER = "user-a";
export const CHAT = "chat-a";

/** Lumiverse's side, invented: each source by kind and id, with its title and revision. */
export class Shelf {
  readonly held = new Map<string, SourceNow>();
  readonly reads: string[] = [];

  put(kind: SourceKind, ref: string, title: string, revision = "r1"): void {
    this.held.set(`${kind}:${ref}`, { title, revision });
  }

  remove(kind: SourceKind, ref: string): void {
    this.held.delete(`${kind}:${ref}`);
  }

  readonly reader: SourceReader = async (_scope, source) => {
    this.reads.push(`${source.kind}:${source.ref}`);
    return this.held.get(`${source.kind}:${source.ref}`) ?? null;
  };
}

export interface Table {
  db: Database;
  store: Store;
  s: UserStore;
  writes: WriteQueue;
  shelf: Shelf;
  /** The chat as the chat application shows it. */
  shown: ShownMessage[];
  /** The player says something, and a turn begins after it. */
  begin(): Promise<TurnRow>;
  /** A turn's reply is saved and shown: a new message, or for a swipe the newest reply's own. */
  tie(turn: TurnRow, text?: string): Promise<TurnRow>;
  /** Another attempt at the newest reply begins. */
  swipe(): Promise<TurnRow>;
  /** The chat shows this turn's swipe of its reply again. */
  showSwipe(turn: TurnRow): Promise<void>;
  /** The last `count` messages are deleted. */
  remove(count: number): Promise<void>;
  /** A whole exchange: the player's message, a turn, `writes` recorded on it, its reply tied. */
  play(writes?: readonly CastWrite[]): Promise<TurnRow>;
  write(turn: TurnRow, writes: readonly CastWrite[], by?: string): Promise<CastRow[]>;
  /** The rows at a turn, or at the chat's head. */
  record(turn?: TurnRow | null): CastRecord;
}

/**
 * The invented chat, on `world`: the invented one unless a test gives its own (more lore, other
 * people); null, the chat names none and plays on the blank world. The store's clock moves on by one
 * at each of its writes, so whatever it dates (a turn begun, a job's end) is ordered as it was done.
 */
export async function openTable(world: WorldDoc | null = inventedWorld()): Promise<Table> {
  const revision = world === null ? null : hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  for (const m of CAST_MIGRATIONS) {
    if ("sql" in m) db.run(m.sql);
    else m.up(db, USER);
  }
  // The lore keeps the bindings of lore entries, which the cast binds a character to.
  for (const m of LORE_MIGRATIONS) if ("sql" in m) db.run(m.sql);
  let clock = 0;
  const store = openStore({ db, registry: registry(), worlds: (r) => (world !== null && r === revision ? world : undefined), now: () => ++clock, areas: [CAST_STORE_AREA, STORY_STORE_AREA] });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat(world === null ? { id: CHAT } : { id: CHAT, world: world.id, revision }));
  const shown: ShownMessage[] = [];
  let n = 0;
  let date = 1_000;
  const sync = (): Promise<unknown> => writes.run(() => s.sync(CHAT, shown));
  const table: Table = {
    db,
    store,
    s,
    writes,
    shelf: new Shelf(),
    shown,
    async begin() {
      shown.push({ id: `m${n++}`, user: true, hash: hashOf(`the player's line ${n}`), hidden: false });
      await sync();
      return writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
    },
    async tie(turn, text = `reply ${n}`) {
      const target = turn.kind === "swipe" ? shown.at(-1) : undefined;
      const message = target?.id ?? `m${n++}`;
      const at = date++;
      const tied = await writes.run(() => s.tieTurn(turn.id, { message, hash: hashOf(text), date: at }));
      const entry: ShownMessage = { id: message, user: false, hash: hashOf(text), date: at, hidden: false };
      if (target) shown[shown.length - 1] = entry;
      else shown.push(entry);
      await sync();
      return tied;
    },
    swipe() {
      const target = shown.at(-1);
      if (!target || target.user) throw new Error("the newest message is not a reply");
      return writes.run(() => s.beginTurn({ chat: CHAT, kind: "swipe", target: target.id }));
    },
    async showSwipe(turn) {
      const row = s.turn(turn.id);
      const at = shown.findIndex((m) => m.id === row?.message);
      if (!row || at < 0) throw new Error("that swipe's message is not shown");
      shown[at] = { id: row.message ?? "", user: false, hash: row.hash ?? "", date: row.date, hidden: false };
      await sync();
    },
    async remove(count) {
      shown.splice(shown.length - count, count);
      await sync();
    },
    async play(list = []) {
      const turn = await table.begin();
      if (list.length > 0) await table.write(turn, list);
      return table.tie(turn);
    },
    write(turn, list, by = "author") {
      return writes.run(() => {
        // A carried file's text is attached as the migration attaches it, and its write names the version.
        const attached = list.map((w): CastWrite => {
          const { text, file } = w.value;
          if (w.value.kind !== "imported" || typeof text !== "string" || typeof file !== "string") return w;
          const { text: _text, ...rest } = w.value;
          const version = attachFile(db, { user: USER, turn: turn.id, by, agent: `${by}-1`, now: 5 }, w.character, file, text);
          return { ...w, value: { ...rest, version } };
        });
        return writeCast(store, { user: USER, turn: turn.id, by, agent: `${by}-1`, job: null, at: null, now: 5 }, attached);
      });
    },
    record(turn = null) {
      return CastRecord.read(store, USER, castAt(s, CHAT, turn?.id ?? null));
    },
  };
  return table;
}

// ---------------------------------------------------------------- the tools, as an agent calls them

const PATTERNS = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "cast-answers.md"), "utf8"), "cast-answers.md").patterns();

export function texts(r: ToolResult): string[] {
  return r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Every sentence of an answer is a line of the answers' file: none is written in code. */
export function wordsFromFiles(r: ToolResult): boolean {
  return [...texts(r).filter((text) => !isJson(text)), ...(r.reports ?? [])].every((text) => PATTERNS.some((p) => p.test(text)));
}

export function dataOf(r: ToolResult): JsonObject {
  const found = texts(r).find(isJson);
  if (found === undefined) throw new Error(`no data in ${JSON.stringify(r.content)}`);
  return JSON.parse(found) as JsonObject;
}

export interface Bench {
  t: Table;
  tools: Map<string, HostTool>;
  /** A call of a cast tool on a turn (null: none), by the Author unless another agent is named. */
  call(name: string, args: JsonObject, turn: string | null, agent?: AgentRef): Promise<ToolResult>;
  /** The same call as the harness plays it: its arguments checked and coerced by pi first, as the agent loop does. */
  play(name: string, args: JsonObject, turn: string | null, agent?: AgentRef): Promise<ToolResult>;
}

/** The cast's tools over a fresh table, with the shipped words; `world` is the chat's world, the invented one unless given (null: none, the blank one played). */
export async function openBench(more: Partial<CastDeps> = {}, world?: WorldDoc | null): Promise<Bench> {
  const t = await openTable(world);
  const deps: CastDeps = { store: t.store, writes: t.writes, files: shippedTexts(), sources: t.shelf.reader, now: () => 7, ...more };
  const tools = new Map((await castTools(deps)).map((x) => [x.name, x]));
  let calls = 0;
  const tool = (name: string): HostTool => {
    const found = tools.get(name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    return found;
  };
  const call = (name: string, args: JsonObject, turn: string | null, agent: AgentRef = { id: "author-1", definition: "author" }): Promise<ToolResult> => {
    const scope = { user: USER, chat: CHAT, session: "s-1", ...(turn !== null ? { turn } : {}) };
    return tool(name).run(args, { scope, agent, run: "run-1", callId: `call-${++calls}`, signal: new AbortController().signal, onUpdate: () => undefined });
  };
  return { t, tools, call, play: (name, args, turn, agent) => call(name, asHarnessPasses(tool(name), args), turn, agent) };
}

// ---------------------------------------------------------------- the views' shipped layouts

/** The shipped layouts of the cast's views, loaded the way the agents' guidance is: as the shipped level of a folder host. `dispose` removes its folder. */
export async function shippedLayouts(): Promise<{ layouts: Partial<Record<CastViewName, TemplatePart>>; dispose(): void }> {
  const dir = mkdtempSync(join(tmpdir(), "rpe-cast-layouts-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  for (const part of Object.values(CAST_VIEWS)) copyFileSync(join(SHIPPED_GUIDANCE, ".prompts", `${part}.md`), join(dir, "files", "defaults", ".prompts", `${part}.md`));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const guidance = loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" });
  const problems = await guidance.problems();
  if (problems.length > 0) throw new Error(`The shipped layouts have problems: ${JSON.stringify(problems)}`);
  const layouts: Partial<Record<CastViewName, TemplatePart>> = {};
  for (const [view, part] of Object.entries(CAST_VIEWS)) {
    const loaded = await guidance.part(part);
    if (loaded?.format !== "template") throw new Error(`The shipped ${part} part did not load as a template.`);
    layouts[view as CastViewName] = loaded;
  }
  return { layouts, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
