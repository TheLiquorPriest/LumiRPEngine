// The lore index's short ids (DESIGN §4.2, Settings → Lore), kept per user in
// `userStorage/lore-ids.json`: every id ever given, by what it names (`bookId/entryId`), and each
// entry's own. An entry goes by its tag, the first World Info key of its own that matches the tag
// pattern, else by the id it was given before, else by a new one: the prefix and the next number,
// padded to the digits Settings asks for. No id is ever given again, nor taken back as entries come
// and go, so an id an agent wrote down names the same entry for good; an id an entry no longer goes
// by (a tag put on it later) still names it. A tag put on another entry takes its id along: the
// entry that had it goes by another of its ids, else a new one.

import type { UserId } from "../shared/ids";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import { entryKey, tagOf } from "../shared/lore-routing";
import { factId, type FactId, wiFactIdOfLiveLore } from "../shared/minds";
import { isShortId, type LoreIndexSettings, tagPatternOf } from "../shared/settings";
import type { WorldDoc } from "../shared/world";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/**
 * The fact a lore id names (DESIGN §24.11), as the knowledge step and the knowledge tools read one:
 * a world lore entry's (`lore:<id>`); a book entry's, or one of its marks' (`#n`, from 1), by its
 * lore id (`book:<bookId>/<entryId>`), its book and entry (`bookId/entryId`) or its short id, which
 * `entryOf` looks up in the user's id map; null for anything else.
 */
export async function loreFactOf(world: Pick<WorldDoc, "lore">, ref: string, entryOf: (id: string) => Promise<string | null>): Promise<FactId | null> {
  if (hasOwn(world.lore, ref)) return factId({ kind: "lore", lore: ref });
  const hash = ref.indexOf("#");
  const base = hash < 0 ? ref : ref.slice(0, hash);
  const key = base.startsWith("book:") ? base.slice("book:".length) : base.includes("/") ? base : isShortId(base) ? await entryOf(base) : null;
  return key === null ? null : wiFactIdOfLiveLore(`book:${key}${hash < 0 ? "" : ref.slice(hash)}`);
}

/** Where the ids are kept (`userStorage/lore-ids.json`). */
export const LORE_IDS_PATH = "lore-ids.json";

/** The id map as stored: the next number to try, every id by the entry it names, and each entry's own id. */
interface IdMap {
  v: 1;
  next: number;
  ids: Record<string, string>;
  own: Record<string, string>;
}

/** An entry asking for its id: where it is and its World Info keys, which may hold its tag. */
export interface IdAsk {
  bookId: string;
  entryId: string;
  keys: readonly string[];
}

function emptyMap(): IdMap {
  return { v: 1, next: 1, ids: {}, own: {} };
}

/** The map as stored, every pair checked: an id that can't be one, or a key that could reach a prototype, is left out. */
function mapOf(raw: unknown): IdMap {
  const out = emptyMap();
  if (!isRecord(raw)) return out;
  out.next = typeof raw.next === "number" && Number.isInteger(raw.next) && raw.next >= 1 ? raw.next : 1;
  const pairs = (v: unknown, ok: (key: string, value: string) => boolean): Record<string, string> => Object.fromEntries(Object.entries(isRecord(v) ? v : {}).filter((p): p is [string, string] => typeof p[1] === "string" && safeKey(p[0]) && ok(p[0], p[1])));
  out.ids = pairs(raw.ids, (id) => isShortId(id));
  out.own = pairs(raw.own, (_key, id) => isShortId(id));
  return out;
}

export class LoreIds {
  private readonly users = new Map<UserId, IdMap>();
  /** Each user's reads and writes of the map, one after another. */
  private readonly queues = new Map<UserId, Promise<unknown>>();

  constructor(private readonly host: Pick<HostPort, "storage" | "log">) {}

  private queued<T>(userId: UserId, work: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(userId) ?? Promise.resolve()).then(work, work);
    this.queues.set(
      userId,
      run.catch(() => undefined),
    );
    return run;
  }

  private async load(userId: UserId): Promise<IdMap> {
    const known = this.users.get(userId);
    if (known) return known;
    const raw = await readStoredJson(this.host, LORE_IDS_PATH, userId, "lore index ids", (r) => isRecord(r) && r.v === 1 && isRecord(r.ids) && isRecord(r.own));
    const map = raw === undefined ? emptyMap() : mapOf(raw);
    this.users.set(userId, map);
    return map;
  }

  private async save(userId: UserId, map: IdMap): Promise<void> {
    await this.host.storage.write(`${LORE_IDS_PATH}.tmp`, JSON.stringify(map), userId);
    await this.host.storage.move(`${LORE_IDS_PATH}.tmp`, LORE_IDS_PATH, userId);
  }

  /**
   * Each entry's id, by `bookId/entryId` (see the header): its tag (one several entries carry stays
   * with the entry it names already, else goes to the first of them in `entries`); else the id it
   * went by, while that still names it; else another id that names it; else a new one, `idPrefix`
   * then the next number not taken, padded to `idDigits`. What changed is stored before the ids are
   * given.
   */
  assign(userId: UserId, entries: readonly IdAsk[], settings: Pick<LoreIndexSettings, "tagPattern" | "idPrefix" | "idDigits">): Promise<Map<string, string>> {
    return this.queued(userId, async () => {
      const map = await this.load(userId);
      const pattern = tagPatternOf(settings.tagPattern);
      const out = new Map<string, string>();
      let changed = false;
      const name = (id: string, key: string): void => {
        if (map.ids[id] !== key) changed = true;
        if (map.own[key] !== id) changed = true;
        map.ids[id] = key;
        map.own[key] = id;
        out.set(key, id);
      };
      const tagged = new Map<string, string>();
      for (const e of entries) {
        const tag = tagOf(e.keys, pattern);
        const key = entryKey(e.bookId, e.entryId);
        if (tag === null || !isShortId(tag) || !safeKey(key)) continue;
        if (!tagged.has(tag) || map.ids[tag] === key) tagged.set(tag, key);
      }
      for (const [tag, key] of tagged) name(tag, key);
      // Every id by the entry it names, for an entry whose own id a tag took.
      const byEntry = new Map<string, string[]>();
      for (const [id, key] of Object.entries(map.ids)) byEntry.set(key, [...(byEntry.get(key) ?? []), id]);
      for (const e of entries) {
        const key = entryKey(e.bookId, e.entryId);
        if (out.has(key) || !safeKey(key)) continue;
        const had = hasOwn(map.own, key) ? map.own[key] : undefined;
        const kept = had !== undefined && map.ids[had] === key ? had : byEntry.get(key)?.find((id) => map.ids[id] === key);
        if (kept !== undefined) {
          name(kept, key);
          continue;
        }
        let id: string;
        do id = `${settings.idPrefix}${String(map.next++).padStart(settings.idDigits, "0")}`;
        while (hasOwn(map.ids, id) || tagged.has(id));
        name(id, key);
      }
      if (changed) await this.save(userId, map);
      return out;
    });
  }

  /** The entry an id names (`bookId/entryId`): one it names now or named before; null for one never given. */
  entryOf(userId: UserId, id: string): Promise<string | null> {
    return this.queued(userId, async () => {
      const map = await this.load(userId);
      return safeKey(id) && hasOwn(map.ids, id) ? (map.ids[id] ?? null) : null;
    });
  }
}
