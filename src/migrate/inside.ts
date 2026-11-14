// The rows whose things sit inside other rows' files and entries, counted from them: what the ledger
// records hold (turns, pack events, knowledge, a chat's own places, the story record, what an old
// engine recorded), what the world documents hold, the harness's workspace areas (mind files, the
// Author's notes, learned/ and ~/, GUIDANCE.md) and the settings (model choices that name a Lumiverse
// connection, edited texts, the user's own agents and skills). Counts, never content. A blob one of
// them names that isn't there is listed as unreadable, by its path.

import { isRecord } from "../shared/json";
import type { MessageLedger, Rec } from "../shared/ledger";
import type { RowId } from "./rows";

/** What each row's inside count counts. */
export const INSIDE_UNIT: Partial<Record<RowId, string>> = {
  ledger: "turns: replies and swipes that hold a record",
  "pack-state": "events folded into pack state",
  "secret-holdings": "knowledge events: facts recorded, learned, forgotten, kept from others, settled",
  "chat-places": "events of the chat's own places, paths and maps",
  "story-record": "story entries: beats, struck beats, castings, drafts",
  unplayed: "replies that stand with no turn played",
  departures: "lines where a reply says something against its turn",
  sessions: "records holding what an old engine recorded on a reply",
  "agents-workspace": "workspace events, and files of the learned and global areas",
  "assistant-threads": "assistant thread messages and proposals",
  "world-contents": "world documents read whole: revisions and drafts",
  pins: "pins in the worlds' current revisions",
  "mind-files": "mind-file versions across the chat areas' turns",
  "author-notes": "other file versions of the chat areas across turns",
  "learned-and-home": "files of the learned/ and ~/ areas",
  guidance: "GUIDANCE.md files of your ~/ area",
  "model-choices": "settings that name a connection in Lumiverse",
  texts: "edited texts in your settings",
  "own-agents": "your own agents and skills",
  "link-credentials": "credentials of the old link: session tokens, relay secrets and their hashes",
  loopback: "loopback key hashes",
};

/** A thing that couldn't be read, by its path, and why. */
export interface Unreadable {
  path: string;
  why: string;
}

export class Tally {
  readonly counts = new Map<RowId, number>();
  readonly unreadable: Unreadable[] = [];

  add(row: RowId, n = 1): void {
    if (n > 0) this.counts.set(row, (this.counts.get(row) ?? 0) + n);
  }
}

/** How many things a JSON value holds as a list or a map; none for anything else. */
function sizeOf(value: unknown): number {
  return Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0;
}

/** The minds pack's knowledge events (`shared/minds.ts:1340-1347`), which carry who holds which fact, lore secrets among them. */
const KNOWLEDGE: Readonly<Record<string, true>> = { "minds.fact": true, "minds.learn": true, "minds.forget": true, "minds.keep": true, "minds.settle": true };

/** One event, counted under the row its kind belongs to. */
function countEvent(type: string, tally: Tally): void {
  if (type === "engine.world") tally.add("chat-places");
  else if (type.startsWith("engine.ws.")) tally.add("agents-workspace");
  else if (Object.hasOwn(KNOWLEDGE, type)) tally.add("secret-holdings");
  else tally.add("pack-state");
}

/** A record's parts, counted: its events and its corrections' events, its story part, its harness part and what an old engine recorded. */
export function countRecord(rec: Rec, tally: Tally): void {
  tally.add("ledger");
  for (const e of rec.events) countEvent(e.type, tally);
  for (const p of rec.post) for (const e of p.events) countEvent(e.type, tally);
  const story = rec.story;
  if (story) tally.add("story-record", sizeOf(story.beats) + sizeOf(story.struck) + sizeOf(story.cast) + sizeOf(story.drafts));
  if (typeof rec.harness?.unplayed === "string") tally.add("unplayed");
  tally.add("departures", sizeOf(rec.harness?.departures));
  if (rec.session !== undefined || rec.agents !== undefined || rec.memoryNext !== undefined || rec.finalEdits !== undefined || rec.finalParts !== undefined || rec.prompts !== undefined || rec.diag !== undefined || rec.harness?.record !== undefined) tally.add("sessions");
}

/** Every record of a chat's ledgers. */
export function countLedgers(ledgers: readonly (MessageLedger | null)[], tally: Tally): void {
  for (const ledger of ledgers) if (ledger) for (const rec of Object.values(ledger.swipes)) countRecord(rec, tally);
}

/** The blob hashes a record names (`RecSession`'s and LumiAH's `TurnRecord`'s), by store. */
export function recordBlobs(rec: Rec): { agents: string[]; harness: string[] } {
  const agents = [rec.session?.segment, rec.session?.summary, rec.session?.archived, rec.session?.transcript].filter((h): h is string => typeof h === "string");
  const record = rec.harness?.record;
  const harness = isRecord(record) ? [record.segment, record.transcript, record.summary, record.workspace].filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) : [];
  return { agents, harness };
}

/**
 * A world document's parts, counted: the document itself, and, for a world's current one, its pins:
 * pinned tables and generators (`WorldPins`) and lore pinned for characters, places and steps
 * (`LorePins`, `shared/world.ts:1085-1089`).
 */
export function countWorldDoc(doc: unknown, current: boolean, tally: Tally): void {
  if (!isRecord(doc)) return;
  tally.add("world-contents");
  if (!current) return;
  const pins = isRecord(doc.pins) ? doc.pins : {};
  const lore = isRecord(doc.lorePins) ? doc.lorePins : {};
  let n = sizeOf(pins.generators) + sizeOf(pins.tables);
  for (const group of [lore.characters, lore.places, lore.steps]) if (isRecord(group)) for (const list of Object.values(group)) n += sizeOf(list);
  tally.add("pins", n);
}

/** An area's index as LumiAH keeps it in a blob (`AreaIndex`, `H/core/workspace.ts:41-45`): each file's path and the hash of its body. */
export function areaFiles(text: string | null): { path: string; hash: string }[] | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || raw.kind !== "index" || !isRecord(raw.files)) return null;
  return Object.entries(raw.files).flatMap(([path, entry]) => (isRecord(entry) && typeof entry.hash === "string" ? [{ path, hash: entry.hash }] : []));
}

/** The head of an area as its document holds it (`AreaDoc`, `H/core/workspace.ts:48-53`): the hash of its index, or null while it holds no file. */
export function areaHead(text: string | null): string | null | undefined {
  if (text === null) return undefined;
  try {
    const raw = JSON.parse(text) as unknown;
    return isRecord(raw) && raw.v === 1 && raw.kind === "area" && (raw.head === null || typeof raw.head === "string") ? raw.head : undefined;
  } catch {
    return undefined;
  }
}

/** A mind file's path in a chat's area (`backend/story/minds.ts:38-52`). */
export const MIND_FILE = /^minds\/[^/]+\/(core|now|memory|beliefs|people|plans|outline|profile)\.md$/;

/** Every `connectionId` a settings document holds that names a connection: the settings' one name for a connection chosen for a kind of work. */
export function connectionChoices(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + connectionChoices(v), 0);
  if (!isRecord(value)) return 0;
  let n = 0;
  for (const [key, v] of Object.entries(value)) n += key === "connectionId" && typeof v === "string" && v !== "" ? 1 : connectionChoices(v);
  return n;
}

/** The parts of today's settings files the plan's other rows name: model choices and edited texts in the engine's, and LumiAH's texts and the user's own agents and skills (`definitions`). */
export function countSettings(engine: unknown, harness: unknown, tally: Tally): void {
  if (isRecord(engine)) {
    tally.add("model-choices", connectionChoices(engine));
    tally.add("texts", isRecord(engine.prompts) ? sizeOf(engine.prompts.texts) : 0);
  }
  if (isRecord(harness)) {
    tally.add("texts", sizeOf(harness.texts));
    const defs = isRecord(harness.definitions) ? harness.definitions : {};
    tally.add("own-agents", sizeOf(defs.agents) + sizeOf(defs.skills));
  }
}

/**
 * The loopback key's hash, as today's extension reads it from the user's registry (`registryOf`,
 * LumiAH `extension/backend/registry.ts:53-58`): the SHA-256 of the key, hex, which RPE takes at the
 * swap as one of its provider keys. Null where the registry holds no key today's extension reads.
 */
export function loopbackKeyHash(registry: unknown): string | null {
  if (!isRecord(registry) || registry.v !== 1 || !isRecord(registry.key)) return null;
  const { hash, print, at } = registry.key;
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) && typeof print === "string" && typeof at === "number" ? hash : null;
}

/** The old link's credentials: each config's session token and relay secret, and the relay secrets' hashes the registry keeps; and the loopback key's hash. */
export function countLink(configs: number, registry: unknown, tally: Tally): void {
  tally.add("link-credentials", configs * 2);
  if (!isRecord(registry)) return;
  tally.add("link-credentials", sizeOf(registry.relays));
  if (loopbackKeyHash(registry) !== null) tally.add("loopback");
}
