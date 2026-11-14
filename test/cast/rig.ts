// An invented chat on the store lane's invented world: the store and the cast on one database behind
// the application's write queue, played the way the turn lane drives the store (the player's message
// shown, a turn begun after it, its reply tied and shown; a swipe; a delete). Lumiverse's sources are
// an invented shelf whose revisions a test can change. Every name here is made up.

import { Database } from "bun:sqlite";
import { WriteQueue } from "../../src/app/database";
import { castAt } from "../../src/cast/path";
import { CastRecord, type CastRow, type CastWrite, type SourceKind, writeCast } from "../../src/cast/record";
import { CAST_MIGRATIONS } from "../../src/cast/schema";
import type { SourceNow, SourceReader } from "../../src/cast/sources";
import { hashJson } from "../../src/shared/hash";
import { migrateStore, openStore, type ShownMessage, type Store, type TurnRow, type UserStore } from "../../src/store";
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

export async function openTable(): Promise<Table> {
  const world = inventedWorld();
  const revision = hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  for (const m of CAST_MIGRATIONS) if ("sql" in m) db.run(m.sql);
  const store = openStore({ db, registry: registry(), worlds: (r) => (r === revision ? world : undefined) });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat({ id: CHAT, world: world.id, revision }));
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
      shown.push({ id: `m${n++}`, user: true, hash: hashOf(`the player's line ${n}`) });
      await sync();
      return writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
    },
    async tie(turn, text = `reply ${n}`) {
      const target = turn.kind === "swipe" ? shown.at(-1) : undefined;
      const message = target?.id ?? `m${n++}`;
      const at = date++;
      const tied = await writes.run(() => s.tieTurn(turn.id, { message, hash: hashOf(text), date: at }));
      const entry: ShownMessage = { id: message, user: false, hash: hashOf(text), date: at };
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
      shown[at] = { id: row.message ?? "", user: false, hash: row.hash ?? "", date: row.date };
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
      return writes.run((d) => writeCast(d, { user: USER, turn: turn.id, by, agent: `${by}-1`, job: null, at: null, now: 5 }, list));
    },
    record(turn = null) {
      return CastRecord.read(db, USER, castAt(s, CHAT, turn?.id ?? null));
    },
  };
  return table;
}
