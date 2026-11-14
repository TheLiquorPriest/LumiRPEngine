// An invented chat on the store lane's invented world: the store and the story record on one database
// behind the application's write queue, played the way the turn lane drives the store (the player's
// message shown, a turn begun after it, its reply tied and shown; a swipe; a delete). Every name here
// is made up.

import { Database } from "bun:sqlite";
import { WriteQueue } from "../../src/app/database";
import { hashJson } from "../../src/shared/hash";
import { migrateStore, openStore, type ShownMessage, type Store, type TurnRow, type UserStore } from "../../src/store";
import { STORY_MIGRATIONS } from "../../src/story/schema";
import { storyAt } from "../../src/story/path";
import { StoryRecord, type StoryRow, type StoryWrite, writeStory } from "../../src/story/record";
import { hashOf, inventedWorld, registry } from "../store/fixtures";

export const USER = "user-a";
export const CHAT = "chat-a";

export interface Table {
  db: Database;
  store: Store;
  s: UserStore;
  writes: WriteQueue;
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
  /** These messages are deleted, wherever they stand. */
  removeIds(ids: readonly string[]): Promise<void>;
  /** A whole exchange: the player's message, a turn, `writes` recorded on it, its reply tied. */
  play(writes?: readonly StoryWrite[]): Promise<TurnRow>;
  write(turn: TurnRow, writes: readonly StoryWrite[], by?: string): Promise<StoryRow[]>;
  /** The record at a turn, or at the chat's head. */
  record(turn?: TurnRow | null): StoryRecord;
}

export interface TableOptions {
  /** The chat starts on the invented world; false: it names none, and plays on the blank world. */
  world?: boolean;
}

export async function openTable(options: TableOptions = {}): Promise<Table> {
  const world = inventedWorld();
  const revision = hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  for (const m of STORY_MIGRATIONS) if ("sql" in m) db.run(m.sql);
  const store = openStore({ db, registry: registry(), worlds: (r) => (r === revision ? world : undefined) });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat(options.world === false ? { id: CHAT } : { id: CHAT, world: world.id, revision }));
  const shown: ShownMessage[] = [];
  let n = 0;
  let date = 1_000;
  const sync = (): Promise<unknown> => writes.run(() => s.sync(CHAT, shown));
  const table: Table = {
    db,
    store,
    s,
    writes,
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
    async removeIds(ids) {
      for (const id of ids) {
        const at = shown.findIndex((m) => m.id === id);
        if (at >= 0) shown.splice(at, 1);
      }
      await sync();
    },
    async play(list = []) {
      const turn = await table.begin();
      if (list.length > 0) await table.write(turn, list);
      return table.tie(turn);
    },
    write(turn, list, by = "author") {
      return writes.run((d) => writeStory(d, { user: USER, turn: turn.id, by, agent: `${by}-1`, job: null, now: 5 }, list));
    },
    record(turn = null) {
      return StoryRecord.read(db, USER, storyAt(s, CHAT, turn?.id ?? null));
    },
  };
  return table;
}
