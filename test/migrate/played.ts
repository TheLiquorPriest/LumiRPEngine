// Chats played the way today's build records them, added to the fixture of today's data: each reply's
// swipe holds a record of its world changes, made on the chain showing when it was played (its path,
// hashed by today's own code); a ✎ fix is a post entry tagged with the path it was made on; an edit
// of a user message pauses what follows it, Keep converts what no longer applies, Discard leaves
// tombstones. The world is an invented harbour town made by today's world store. Everything is made up.
//
// Each played swipe keeps the picks it was played on (the swipe each earlier reply showed then), so
// a test can fold today's fold along that chain for itself and hold RPE's store to it.

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { encodeLedger } from "../../src/migrate/today/ledger-io";
import { WorldStore } from "../../src/worlds/worlds";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { computePaths, contentId } from "../../src/engine/ledger/path";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { hashJson } from "../../src/shared/hash";
import type { ChatId, UserId, WorldId } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import type { Journal, LedgerEvent, Marker, MessageLedger, Pause, PostEntry, Rec, Tombstone } from "../../src/shared/ledger";
import { defaultTiers } from "../../src/shared/tiers";
import { DEFAULT_CURRENCY, WORLD_FORMAT, type WorldDoc } from "../../src/shared/world";
import { FakeHost } from "../support/fake-host";
import { IDENT, USER, type Fixture } from "./fixture";

export const POV = "mara";

/** Saltmarsh: a quay, a market, an inn; Mara with a satchel, a rope in it and a purse of coin. */
function harbourWorld(): WorldDoc {
  const tables = defaultTables();
  const thing = (id: string, kind: string, name: string, fields: JsonObject, relations: WorldDoc["entities"][string]["relations"] = []): WorldDoc["entities"][string] => ({ id, kind, name, tier: "background", fields, relations });
  return {
    format: WORLD_FORMAT,
    id: "world-saltmarsh",
    name: "Saltmarsh",
    engineVersion: "0.0.0",
    packs: Object.fromEntries(ALL_PACKS.map((p) => [p.id, { version: p.version, config: {} }])),
    pins: { generators: {}, tables: Object.fromEntries(Object.values(tables).map((t) => [t.id, t.revision])) },
    kinds: { character: { id: "character", label: "Character", extends: "person", fields: {} } },
    relations: {},
    entities: {
      [POV]: { id: POV, kind: "character", name: "Mara", tier: "principal", fields: { place: "quay", description: "A rope-maker's daughter." }, relations: [] },
      satchel: thing("satchel", "container", "Satchel", {}, [{ type: "in", to: POV }]),
      purse: thing("purse", "container", "Purse", {}, [{ type: "in", to: POV }]),
      acct_mara: thing("acct_mara", "account", "Mara's coin", { owners: [{ party: POV, role: "owner" }], product: "cash", opening: 5000 }, [{ type: "in", to: "purse" }]),
      rope: thing("rope", "item", "Coil of rope", {}, [{ type: "in", to: "satchel" }]),
    },
    places: {
      saltmarsh: { id: "saltmarsh", name: "Saltmarsh", timeZone: "Europe/London", fields: {} },
      quay: { id: "quay", name: "The Quay", parent: "saltmarsh", fields: {} },
      market: { id: "market", name: "Fish Market", parent: "saltmarsh", fields: {} },
      inn: { id: "inn", name: "The Gull", parent: "saltmarsh", fields: {} },
    },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: { system: "gregorian", epoch: "2031-05-01T00:00", timeZone: "Europe/London", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }], holidays: [] },
    schedules: {},
    tracks: {},
    tables,
    realism: { preset: "story", levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 2, sheets: 1 }, tierCaps: { principal: {}, supporting: {}, background: {} } },
    time: {
      sceneTicks: { conversation: 2, action: 1, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "ignore", arrival: "stop", overdue: "ignore", needs: "ignore", weather: "ignore" },
      speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } },
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    lore: {},
    loreIndex: { terms: {}, topics: {} },
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: POV,
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "quay", at: "2031-05-01T08:00" },
  };
}

// ---------------------------------------------------------------- events, as today's engine writes them

export const tick = (minutes: number): LedgerEvent => ({ type: "clock", minutes, cause: "tick" });
export const goTo = (place: string): LedgerEvent => ({ type: "set", entity: POV, field: "place", value: place });
export const pay = (cents: number, memo: string, account = "acct_mara"): LedgerEvent => ({ type: "post", lines: [{ account, amount: -cents }, { account: `${EXTERNAL_ACCOUNT_PREFIX}market`, amount: cents }], memo });
export const make = (id: string, name: string): LedgerEvent => ({ type: "spawn", entity: { id, kind: "item", name, tier: "background", fields: {}, relations: [{ type: "in", to: POV }] } });
/** A thing taken out of what holds it into Mara's hands: one unit, as today's item moves are. */
export function takeOut(item: string, from: string): LedgerEvent[] {
  const group = `take:${item}:${from}`;
  return [
    { type: "unlink", rel: "in", from: item, to: from, group },
    { type: "link", rel: "in", from: item, to: POV, group },
  ];
}

interface PlayedMessage {
  id: string;
  isUser: boolean;
  swipes: string[];
  swipeId: number;
  dates: number[];
  ledger: MessageLedger | null;
}

/** A swipe as played: where it was played (the swipe each earlier reply showed), for a test to fold along. */
export interface PlayedSwipe {
  chat: string;
  message: string;
  swipe: number;
  /** By message id: the swipe each earlier reply showed when this one was played. */
  picks: Record<string, number>;
  /** Its own path can't be hashed again (an earlier message was edited or deleted since): it folds where it shows now. */
  lost?: true;
  /** Expected to be placed where it shows now: its chat's head stands rebased and differs from what its own path gives (`placedWhereShown`). */
  whereShown?: true;
}

/** One chat being played, message by message, as today's build records it. */
export class Play {
  readonly messages: PlayedMessage[] = [];
  readonly pauses: Pause[] = [];
  readonly tombstones: Tombstone[] = [];
  readonly played: PlayedSwipe[] = [];
  private seq = 0;
  private started = false;

  constructor(
    readonly chat: string,
    private readonly revision: string,
  ) {}

  private at(id: string): PlayedMessage {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error(`no message ${id}`);
    return m;
  }

  private chainTo(index: number): ChainMessage[] {
    return this.messages.slice(0, index + 1).map((m) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, swipes: [...m.swipes], ledger: m.ledger }));
  }

  /** The path before message `id` on the chain as it shows now. */
  private parentOf(id: string): string {
    const index = this.messages.findIndex((m) => m.id === id);
    return computePaths(this.chainTo(index), this.tombstones)[index]?.parentPath ?? "";
  }

  user(id: string, text: string, date: number): this {
    this.messages.push({ id, isUser: true, swipes: [text], swipeId: 0, dates: [date], ledger: null });
    return this;
  }

  /** A swipe played on the chain as it shows now: a new reply `id`, or another swipe of it, which then shows. */
  reply(id: string, text: string, date: number, events: LedgerEvent[]): this {
    let m = this.messages.find((x) => x.id === id);
    if (!m) {
      m = { id, isUser: false, swipes: [], swipeId: 0, dates: [], ledger: { v: 1, swipes: {}, markers: [] } };
      this.messages.push(m);
    }
    const swipe = m.swipes.length;
    m.swipes.push(text);
    m.dates.push(date);
    m.swipeId = swipe;
    const ledger = m.ledger as MessageLedger;
    // The chat's starting marker comes with its first record, which takes it before its events.
    let markersApplied = 0;
    if (!this.started) {
      this.started = true;
      const marker: Marker = { kind: "migrate", to: this.revision, seq: ++this.seq, at: null, start: true };
      ledger.markers.push(marker);
      markersApplied = marker.seq;
    }
    const picks: Record<string, number> = {};
    for (const earlier of this.messages) if (!earlier.isUser && earlier !== m) picks[earlier.id] = earlier.swipeId;
    const rec: Rec = { v: 1, defHash: this.revision, seq: ++this.seq, swipeHash: contentId(text), path: this.parentOf(id), seed: `seed-${this.seq}`, pre: events.length, events, post: [], markersApplied, status: "ok", undone: [], intents: {} };
    ledger.swipes[String(swipe)] = rec;
    this.played.push({ chat: this.chat, message: id, swipe, picks });
    return this;
  }

  /** Shows another swipe of an earlier reply. */
  flip(id: string, swipe: number): this {
    this.at(id).swipeId = swipe;
    return this;
  }

  /** A ✎ fix on reply `id`'s showing record, tagged with the path before it as the chat shows now. */
  fix(id: string, events: LedgerEvent[]): this {
    const m = this.at(id);
    const rec = m.ledger?.swipes[String(m.swipeId)];
    if (!rec) throw new Error(`no record on ${id}`);
    const entry: PostEntry = { seq: ++this.seq, at: this.parentOf(id), kind: "fix", events };
    rec.post.push(entry);
    return this;
  }

  /** The user edits their message: what was played after it can no longer be hashed on its own path. */
  edit(id: string, text: string): this {
    const m = this.at(id);
    m.swipes[m.swipeId] = text;
    const index = this.messages.indexOf(m);
    for (const p of this.played) if (this.messages.findIndex((x) => x.id === p.message) > index) p.lost = true;
    return this;
  }

  /** Today's keep-or-discard question, left waiting on an edited user message. */
  pause(id: string): this {
    const m = this.at(id);
    this.pauses.push({ messageId: id, content: contentId(m.swipes[m.swipeId] ?? "") });
    return this;
  }

  /** Discard: every record after the edited message is set aside, as tombstones. */
  discardAfter(id: string): this {
    const index = this.messages.findIndex((x) => x.id === id);
    for (const m of this.messages.slice(index + 1)) {
      const rec = m.ledger?.swipes[String(m.swipeId)];
      if (rec) this.tombstones.push({ messageId: m.id, swipeHash: rec.swipeHash, recHash: hashJson(rec) });
    }
    return this;
  }

  /** Keep: an event of reply `id`'s showing record that fails where it stands now is converted, and applies there all the same. */
  keep(id: string, index: number): this {
    const m = this.at(id);
    const rec = m.ledger?.swipes[String(m.swipeId)];
    if (!rec) throw new Error(`no record on ${id}`);
    rec.keep = { ...(rec.keep ?? {}), [this.parentOf(id)]: { convert: [{ in: "events", index }] } };
    return this;
  }

  /** What the test expects of the import: the swipe reply `id` shows is placed where it shows now. */
  placedWhereShown(id: string): this {
    const m = this.at(id);
    for (const p of this.played) if (p.message === id && p.swipe === m.swipeId) p.whereShown = true;
    return this;
  }

  /** The message is deleted in Lumiverse: what was played after it can no longer be hashed on its own path. */
  remove(id: string): this {
    const index = this.messages.findIndex((x) => x.id === id);
    for (const p of this.played) if (this.messages.findIndex((x) => x.id === p.message) > index) p.lost = true;
    this.played.splice(0, this.played.length, ...this.played.filter((p) => p.message !== id));
    this.messages.splice(index, 1);
    return this;
  }

  journal(worldId: string, runSeed: string): Journal {
    const messages: Journal["messages"] = {};
    for (const m of this.messages) if (m.ledger) messages[m.id] = { ledger: structuredClone(m.ledger), flushed: true };
    return { v: 1, chatId: this.chat as ChatId, seq: this.seq, chain: [], messages, pauses: this.pauses, tombstones: this.tombstones, held: [], windows: [], pending: {}, started: true, run: { worldId: worldId as WorldId, runSeed } };
  }

  /** A branch's start: another chat's messages as they stood, under new ids, with its records and its count of numbers. */
  copyOf(source: Play, rename: (id: string) => string): this {
    for (const m of source.messages) this.messages.push({ ...structuredClone(m), id: rename(m.id) });
    this.seq = source.seq;
    this.started = source.started;
    return this;
  }
}

/** The played chats, by what each shows. */
export const PLAYED = {
  /** Swipes, a swipe flipped on an earlier message with turns after it, a ✎ fix, a review card waiting. */
  classic: "p-classic",
  /** A user message edited after the turns that follow it, its keep-or-discard question left waiting. */
  paused: "p-paused",
  /** An edit discarded: the turns after it are tombstones. */
  discarded: "p-discarded",
  /** A reply deleted with a turn after it. */
  deleted: "p-deleted",
  /** Keep converted an event that no longer applies: a value RPE's fold gets differently. */
  planted: "p-planted",
  /** A branch of the classic chat, made at its second reply, with a turn of its own. */
  branch: "p-branch",
  /** A swipe flipped on an earlier reply, then a ✎ fix made on the reply after it as it then stood: its head stands rebased, and differs. */
  rebased: "p-rebased",
} as const;

export interface Played {
  worldId: string;
  revision: string;
  /** Every swipe played, with where. */
  swipes: PlayedSwipe[];
  /** Each chat as played, to play on in today's build and write again (`replay`). */
  plays: Map<string, Play>;
}

/** Writes a chat's messages into Lumiverse's database again, and its journal, as today's build leaves them after more play. */
export async function replay(fixture: Fixture, played: Played, chat: string): Promise<void> {
  const play = played.plays.get(chat);
  if (!play) throw new Error(`no chat ${chat}`);
  const db = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
  try {
    db.query("DELETE FROM messages WHERE chat_id = ?").run(chat);
    writeMessages(db, play);
    db.query("UPDATE chats SET updated_at = updated_at + 1 WHERE id = ?").run(chat);
  } finally {
    db.close();
  }
  await put(join(fixture.userFolder, "runs", chat, "journal.json"), JSON.stringify(play.journal(played.worldId, `seed-${chat}`)));
  played.swipes = [...played.swipes.filter((s) => s.chat !== chat), ...play.played];
}

function writeMessages(db: Database, play: Play): void {
  for (const [i, m] of play.messages.entries()) {
    const extra = m.ledger ? { spindle_metadata: encodeLedger({}, m.ledger) } : {};
    db.query("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipe_id, swipes, swipe_dates, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(m.id, play.chat, i, m.isUser ? 1 : 0, m.isUser ? "Player" : "Narrator", m.swipes[m.swipeId] ?? "", m.swipeId, JSON.stringify(m.swipes), JSON.stringify(m.dates), JSON.stringify(extra));
  }
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/**
 * Plays the chats into the fixture: the world into the user's storage by today's world store, the
 * chats and their messages into Lumiverse's database, each chat's journal into its run folder.
 */
export async function addPlayedChats(fixture: Fixture): Promise<Played> {
  const fake = new FakeHost();
  const made = await new WorldStore(fake, createRegistry(ALL_PACKS), []).create("Saltmarsh", harbourWorld(), USER as UserId);
  for (const [key, text] of fake.files) await put(join(fixture.userFolder, key.slice(USER.length + 1)), text);
  const worldId = made.world.id;
  const rev = made.revision;
  const plays: { play: Play; name: string; prefs: JsonObject; branch?: { from: string; at: string } }[] = [];

  const classic = new Play(PLAYED.classic, rev)
    .user("pc-u1", "We walk to the fish market.", 100)
    .reply("pc-a1", "The market is loud with gulls.", 101, [tick(10), goTo("market")])
    .user("pc-u2", "I buy a lantern.", 200)
    .reply("pc-a2", "A tin lantern changes hands.", 201, [tick(5), pay(300, "Lantern"), make("lantern", "Tin lantern")])
    .reply("pc-a2", "She picks the brass one.", 202, [tick(7), pay(450, "Brass lantern"), make("lantern_brass", "Brass lantern")])
    .user("pc-u3", "Then the inn, rope in hand.", 300)
    .reply("pc-a3", "The Gull is warm; the rope is in her hands.", 301, [...takeOut("rope", "satchel"), goTo("inn"), tick(15)])
    .flip("pc-a2", 0)
    .reply("pc-a3", "She heads back to the quay.", 302, [goTo("quay"), tick(3)])
    .fix("pc-a3", [pay(100, "Tip for the ferryman")])
    .user("pc-u4", "I buy a fish.", 400)
    .reply("pc-a4", "A mackerel, wrapped in paper.", 401, [tick(20), make("fish", "Mackerel")])
    .flip("pc-a3", 0);
  plays.push({ play: classic, name: "Saltmarsh (classic)", prefs: { knowledge: true } });

  const paused = new Play(PLAYED.paused, rev)
    .user("pp-u1", "Down to the market.", 100)
    .reply("pp-a1", "The stalls are open.", 101, [tick(5), goTo("market")])
    .user("pp-u2", "I sell the rope.", 200)
    .reply("pp-a2", "The rope sells for two coins.", 201, [tick(10), pay(-200, "Rope sold"), { type: "unlink", rel: "in", from: "rope", to: "satchel" }])
    .edit("pp-u2", "I keep the rope.")
    .pause("pp-u2");
  plays.push({ play: paused, name: "Saltmarsh (paused)", prefs: {} });

  const discarded = new Play(PLAYED.discarded, rev)
    .user("pd-u1", "Wait for the tide.", 100)
    .reply("pd-a1", "The tide turns.", 101, [tick(5)])
    .user("pd-u2", "To the inn.", 200)
    .reply("pd-a2", "The Gull's door creaks.", 201, [goTo("inn"), tick(10)])
    .user("pd-u3", "Supper, please.", 300)
    .reply("pd-a3", "Stew and bread.", 301, [pay(120, "Supper")])
    .edit("pd-u2", "To the market instead.")
    .discardAfter("pd-u2");
  plays.push({ play: discarded, name: "Saltmarsh (agents)", prefs: { engine: "agents" } });

  const deleted = new Play(PLAYED.deleted, rev)
    .user("px-u1", "Look around.", 100)
    .reply("px-a1", "Fog on the quay.", 101, [tick(5)])
    .user("px-u2", "To the market.", 200)
    .reply("px-a2", "The market, half empty.", 201, [goTo("market")])
    .user("px-u3", "Buy bread.", 300)
    .reply("px-a3", "A loaf, still warm.", 301, [pay(80, "Bread"), make("bread", "Loaf")])
    .remove("px-a2");
  plays.push({ play: deleted, name: "Saltmarsh (harness)", prefs: { engine: "harness" } });

  const planted = new Play(PLAYED.planted, rev)
    .user("pt-u1", "Morning.", 100)
    .reply("pt-a1", "Grey morning.", 101, [tick(5)])
    .user("pt-u2", "I pay the harbour master.", 200)
    .reply("pt-a2", "Dues are paid.", 201, [{ type: "post", lines: [{ account: "acct_harbour", amount: 250 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}fees`, amount: -250 }], memo: "Harbour dues" }])
    .edit("pt-u2", "I pay the harbour master, grudgingly.")
    .keep("pt-a2", 0);
  plays.push({ play: planted, name: "Saltmarsh (planted)", prefs: {} });

  const rebased = new Play(PLAYED.rebased, rev)
    .user("pr-u1", "To the market.", 100)
    .reply("pr-a1", "Gulls everywhere.", 101, [tick(5), goTo("market")])
    .user("pr-u2", "Buy a lantern.", 200)
    .reply("pr-a2", "A tin lantern.", 201, [pay(300, "Lantern"), make("lantern", "Tin lantern")])
    .reply("pr-a2", "A brass lantern.", 202, [pay(450, "Brass lantern"), make("lantern_brass", "Brass lantern")])
    .user("pr-u3", "To the inn.", 300)
    .reply("pr-a3", "The Gull.", 301, [goTo("inn"), tick(10)])
    .flip("pr-a2", 0)
    .fix("pr-a3", [pay(60, "Fee at the door")])
    .placedWhereShown("pr-a3");
  plays.push({ play: rebased, name: "Saltmarsh (rebased)", prefs: {} });

  // The branch: the classic chat's messages copied up to its second reply as they stood when it was made, then a turn of its own.
  const branch = new Play(PLAYED.branch, rev);
  const copied = new Play("copy", rev)
    .user("pc-u1", "We walk to the fish market.", 100)
    .reply("pc-a1", "The market is loud with gulls.", 101, [tick(10), goTo("market")])
    .user("pc-u2", "I buy a lantern.", 200)
    .reply("pc-a2", "A tin lantern changes hands.", 201, [tick(5), pay(300, "Lantern"), make("lantern", "Tin lantern")])
    .reply("pc-a2", "She picks the brass one.", 202, [tick(7), pay(450, "Brass lantern"), make("lantern_brass", "Brass lantern")]);
  branch.copyOf(copied, (id) => id.replace("pc-", "pb-"));
  branch.user("pb-u3", "We go down to the docks instead.", 500).reply("pb-a3", "The docks smell of tar.", 501, [goTo("quay"), tick(9)]);
  plays.push({ play: branch, name: "Saltmarsh (branch)", prefs: { knowledge: true }, branch: { from: PLAYED.classic, at: "pc-a2" } });

  const db = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
  try {
    let updated = 1000;
    for (const { play, name, prefs, branch: from } of plays) {
      const run = { v: 1, worldId, revision: rev, runSeed: `seed-${play.chat}`, startedAt: 1_700_000_000_000 };
      const meta: JsonObject = { [IDENT]: { ...run, prefs }, ...(from ? { branched_from: from.from, branch_at_message: from.at } : {}) };
      db.query("INSERT INTO chats (id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)").run(play.chat, name, JSON.stringify(meta), 1, updated++, USER);
      writeMessages(db, play);
      await put(join(fixture.userFolder, "runs", play.chat, "journal.json"), JSON.stringify(play.journal(worldId, `seed-${play.chat}`)));
    }
  } finally {
    db.close();
  }
  return { worldId, revision: rev, swipes: plays.flatMap(({ play }) => play.played), plays: new Map(plays.map(({ play }) => [play.chat, play])) };
}
