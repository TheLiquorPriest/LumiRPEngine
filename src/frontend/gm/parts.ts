// GM → the page by part (DESIGN §7): each tab reads only the GM view's parts it shows, each one
// `lre.gm.part` (`GM_TAB_PARTS` for the engine's tabs; a pack's tab its own `GmSectionDef.parts`, or
// every part when it names none), with `edits`, which the notice over the tab bar reads, for every
// tab. `GmParts` keeps one chat's parts while its truth is shown: when the chat moves on, every part
// goes stale and only the open tab's are asked again, each with the key it was read at (`since`), so
// one the move left as it was comes back `same`, built by nothing; another tab's are asked again when
// it opens. Lists read the roster, every entity slim; a page asks for the full entries it shows by id
// (an entity's `entities`, a character's `money`), laid over the roster while it needs them, and
// tells a slim one (`thinEntity`) until its entry lands. A tab's view is assembled from its parts
// and the rest as kept (or empty), and stays the same object while none of them changes.

import type { FinanceView } from "../../shared/finance";
import { GM_IDS_MAX, GM_PARTS, GM_ROSTER, rosterEntity, type GmPart, type GmPartReply, type GmReadPart } from "../../shared/gm-parts";
import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { DEFAULT_WORLD_MINDS, knowledgeThreshold } from "../../shared/minds";
import type { GmDuringTurn } from "../../shared/settings";
import type { ChatStatus, GmEntity, GmRosterEntry, GmView } from "../../shared/state-view";
import type { GmSection } from "../app";
import type { GmSectionDef, RequestBody } from "../registry";

/** The engine's own tabs: World, Places, Things, Story and This chat. */
export type GmEngineTab = "world" | "places" | "things" | "story" | "chat";

/**
 * What each of the engine's tabs reads, `edits` besides: World's list the roster, with what its
 * pages, Spawn, the Fight and Change selected pick from and name; Places the places, named with the
 * roster; Things the roster, the kinds and places, and the relation types a thing's Advanced edits;
 * Story the tracks; This chat the edits and the writes refused or held.
 */
export const GM_TAB_PARTS: Readonly<Record<GmEngineTab, readonly GmReadPart[]>> = Object.freeze({
  world: [GM_ROSTER, "kinds", "tiers", "lifeStates", "domains", "classifications", "places", "relationTypes", "minds", "encounter", "routineRoles"],
  places: ["places", GM_ROSTER],
  things: [GM_ROSTER, "kinds", "places", "relationTypes"],
  story: ["tracks"],
  chat: ["edits", "refused", "held"],
});

/**
 * The parts a GM tab reads, `edits` always among them: an engine tab's (`GM_TAB_PARTS`); a pack's
 * tab its own (`GmSectionDef.parts`), every part when it names none; a tab no pack has, World's, as
 * the page shows World for it.
 */
export function partsOf(section: GmSection, def: Pick<GmSectionDef, "parts"> | undefined): readonly GmReadPart[] {
  const own = hasOwn(GM_TAB_PARTS, section) ? GM_TAB_PARTS[section as GmEngineTab] : def ? (def.parts ?? GM_PARTS) : GM_TAB_PARTS.world;
  return own.includes("edits") ? own : [...own, "edits"];
}

/** What an open page reads besides its tab's parts: the full entries of the entities it shows (an entity's page, Change selected) and the money of the parties it shows (a character's sheet). */
export interface GmNeed {
  entities?: readonly EntityId[];
  money?: readonly EntityId[];
}

/** What a tab reads: its parts, and what its open page needs. */
export interface GmWant extends GmNeed {
  parts: readonly GmReadPart[];
}

/** Sends one `lre.gm.part`: its answer, or null when it failed (and said so where it was sent). */
export type GmPartRead = (request: Extract<RequestBody, { type: "lre.gm.part" }>) => Promise<GmPartReply | null>;

/** The view's parts while they aren't read: empty, the minds off. */
const EMPTY: GmView = {
  entities: [],
  kinds: [],
  tiers: [],
  lifeStates: [],
  domains: [],
  classifications: {},
  places: [],
  tracks: [],
  relationTypes: [],
  money: [],
  orgs: [],
  encounter: null,
  routineRoles: [],
  edits: [],
  refused: [],
  held: [],
  minds: { enabled: false, secrecy: DEFAULT_WORLD_MINDS.secrecy, now: 0, nowText: "", characters: [], knowledge: { facts: [], pov: null, threshold: knowledgeThreshold(undefined) } },
};

// Each roster entry's slim entity, made once, and every such entity, so a page can tell one.
const THIN = new WeakSet<GmEntity>();
const THIN_OF = new WeakMap<GmRosterEntry, GmEntity>();

function thinOf(entry: GmRosterEntry): GmEntity {
  const made = THIN_OF.get(entry);
  if (made) return made;
  const thin = rosterEntity(entry);
  THIN.add(thin);
  THIN_OF.set(entry, thin);
  return thin;
}

/** Whether an entity in a tab's view is only its roster entry: its fields, relations, levels, classes and sheet unread. A page showing it asks for its entry (`Editor.need`) and shows Loading… until it lands. */
export function thinEntity(entity: GmEntity): boolean {
  return THIN.has(entity);
}

/** A kept read: a part by its name; an entity's full entry by `entities:<id>`, a party's money by `money:<id>` (null: there is none). */
const ENTITY = "entities:";
const MONEY = "money:";

/**
 * What the page does when the chat's GM key (`StateView.gmKey`) reads `next` and its parts were last
 * loaded at `prev` (null: never): `load` the open tab's parts, the first time and whenever the chat
 * moved on; `hold` them as they are while a turn runs and the page holds (`gm.duringTurn`); `none`
 * while the key is the one they were loaded at.
 */
export function gmReload(prev: string | null, next: string, status: ChatStatus, hold: GmDuringTurn): "load" | "hold" | "none" {
  if (prev === null) return "load";
  if (prev === next) return "none";
  return status === "in_flight" && hold === "hold" ? "hold" : "load";
}

/** One request a load sends, and the reads it fills. */
interface Ask {
  seq: number;
  move: number;
  part: GmReadPart;
  /** For a read by ids: the id each read is, in order. */
  ids: EntityId[] | null;
  slots: string[];
  body: Extract<RequestBody, { type: "lre.gm.part" }>;
}

/**
 * One chat's GM view, part by part, as the GM page reads it (no Preact: `use-gm-parts` holds it).
 * `load` asks for what a tab reads that isn't kept or went stale (`moved`), each kept one with its
 * key, and keeps the answers once they have all landed; a read asked again meanwhile keeps the newer
 * answer. `view` assembles a tab's view from what is kept. `changed` hears every load that landed.
 */
export class GmParts {
  private readonly kept = new Map<string, { key: string; value: unknown }>();
  private readonly stale = new Set<string>();
  /** The newest request for each read, and the move it was asked after. */
  private readonly asked = new Map<string, { seq: number; move: number }>();
  private seq = 0;
  private moves = 0;
  /** Moves on when a kept value changes: a view assembled at another is assembled again. */
  private version = 0;
  private newest = { seq: 0, key: "" };
  private last: { sig: string; version: number; view: GmView } | null = null;

  constructor(
    readonly chatId: string,
    private readonly read: GmPartRead,
    private readonly changed: () => void = () => undefined,
  ) {}

  /** The key of the head the newest answer was built at ("" before one landed). */
  get key(): string {
    return this.newest.key;
  }

  /** The chat moved on: everything kept is stale, kept as it is until it is asked for again. */
  moved(): void {
    for (const slot of this.kept.keys()) this.stale.add(slot);
    this.moves++;
  }

  /** Whether every part `want` reads has landed (fresh or stale): its tab can show. */
  ready(want: GmWant): boolean {
    return want.parts.every((part) => this.kept.has(part));
  }

  /** Whether any part `want` reads is stale: shown as it was before the chat moved on. */
  staleIn(want: GmWant): boolean {
    return want.parts.some((part) => this.stale.has(part));
  }

  /**
   * Asks for what `want` reads that isn't kept, or is stale (unless `stale` is false: only what
   * isn't kept), and wasn't asked for since the chat last moved: each part alone, the entities and
   * the money by ids, a kept one with the key it was read at; resolves once they all landed.
   */
  async load(want: GmWant, options: { stale?: boolean } = {}): Promise<void> {
    const due = (slot: string): boolean => {
      const asked = this.asked.get(slot);
      if (asked !== undefined && asked.move === this.moves) return false;
      return !this.kept.has(slot) || (options.stale !== false && this.stale.has(slot));
    };
    const asks: Ask[] = [];
    const ask = (part: GmReadPart, ids: EntityId[] | null, slots: string[], since: string | undefined): void => {
      const seq = ++this.seq;
      for (const slot of slots) this.asked.set(slot, { seq, move: this.moves });
      asks.push({ seq, move: this.moves, part, ids, slots, body: { type: "lre.gm.part", chatId: this.chatId, part, ...(ids ? { ids } : {}), ...(since !== undefined ? { since } : {}) } });
    };
    for (const part of new Set(want.parts)) if (due(part)) ask(part, null, [part], this.kept.get(part)?.key);
    for (const [part, prefix, ids] of [
      ["entities", ENTITY, want.entities ?? []],
      ["money", MONEY, want.money ?? []],
    ] as const) {
      // Those read at one key are asked together, with it; those never read, together without one.
      const byKey = new Map<string, EntityId[]>();
      for (const id of new Set(ids)) {
        const slot = `${prefix}${id}`;
        if (!due(slot)) continue;
        const key = this.kept.get(slot)?.key ?? "";
        byKey.set(key, [...(byKey.get(key) ?? []), id]);
      }
      for (const [key, group] of byKey) {
        for (let at = 0; at < group.length; at += GM_IDS_MAX) {
          const chunk = group.slice(at, at + GM_IDS_MAX);
          ask(part, chunk, chunk.map((id) => `${prefix}${id}`), key === "" ? undefined : key);
        }
      }
    }
    if (asks.length === 0) return;
    const replies = await Promise.all(asks.map((a) => this.read(a.body)));
    asks.forEach((a, i) => {
      const reply = replies[i] ?? null;
      a.slots.forEach((slot, n) => {
        // A newer request for it was sent meanwhile: its answer is the one kept.
        if (this.asked.get(slot)?.seq !== a.seq) return;
        if (reply === null) {
          this.asked.delete(slot);
          return;
        }
        if (reply.same !== true) {
          const id = a.ids?.[n];
          this.kept.set(slot, { key: reply.key, value: id === undefined ? reply.value : this.picked(a.part, reply.value, id) });
          this.version++;
        }
        // Read since the chat last moved: fresh; asked before it moved, stale still.
        if (a.move === this.moves) this.stale.delete(slot);
      });
      if (reply !== null && a.seq > this.newest.seq) this.newest = { seq: a.seq, key: reply.key };
    });
    this.changed();
  }

  /** The one of a read by ids that is `id`: an entity's entry by its id, a party's money by its party; null when the read found none. */
  private picked(part: GmReadPart, value: unknown, id: EntityId): unknown {
    if (!Array.isArray(value)) return null;
    if (part === "money") return (value as FinanceView[]).find((m) => m.party === id) ?? null;
    return (value as GmEntity[]).find((e) => e.id === id) ?? null;
  }

  /**
   * The view a tab reads, once its parts have landed (null before): each part as kept, those it
   * doesn't read empty until they are. Its entities are the whole `entities` when it reads them, else
   * the roster slim with the full entries of `want.entities` laid over it; its money the whole when it
   * reads it, else as kept with the money of `want.money` laid over it. The same object while none of
   * what it reads changed.
   */
  view(want: GmWant): GmView | null {
    if (!this.ready(want)) return null;
    const sig = [want.parts.join(","), (want.entities ?? []).join(","), (want.money ?? []).join(",")].join("\u0000");
    if (this.last !== null && this.last.sig === sig && this.last.version === this.version) return this.last.view;
    const prev = this.last?.view ?? null;
    const next = { ...EMPTY };
    for (const part of GM_PARTS) {
      const kept = this.kept.get(part);
      if (kept) (next as Record<GmPart, unknown>)[part] = kept.value;
    }
    next.entities = this.entitiesOf(want, prev);
    next.money = this.moneyOf(want, prev);
    const view = prev !== null && GM_PARTS.every((part) => prev[part] === next[part]) ? prev : next;
    this.last = { sig, version: this.version, view };
    return view;
  }

  private entitiesOf(want: GmWant, prev: GmView | null): GmEntity[] {
    const whole = (this.kept.get("entities")?.value as GmEntity[] | undefined) ?? EMPTY.entities;
    const roster = this.kept.get(GM_ROSTER)?.value as GmRosterEntry[] | undefined;
    if (want.parts.includes("entities") || roster === undefined) return whole;
    const needed = new Set(want.entities ?? []);
    const list = roster.map((entry) => (needed.has(entry.id) ? (this.kept.get(`${ENTITY}${entry.id}`)?.value as GmEntity | null | undefined) : null) ?? thinOf(entry));
    // The list as it was when each of its entities is: the view needn't change for it.
    return prev !== null && prev.entities.length === list.length && list.every((e, i) => e === prev.entities[i]) ? prev.entities : list;
  }

  private moneyOf(want: GmWant, prev: GmView | null): FinanceView[] {
    const whole = (this.kept.get("money")?.value as FinanceView[] | undefined) ?? EMPTY.money;
    if (want.parts.includes("money")) return whole;
    const own = (want.money ?? []).flatMap((id) => (this.kept.get(`${MONEY}${id}`)?.value as FinanceView | null | undefined) ?? []);
    if (own.length === 0) return whole;
    const list = [...whole.map((m) => own.find((o) => o.party === m.party) ?? m), ...own.filter((o) => !whole.some((m) => m.party === o.party))];
    return prev !== null && prev.money.length === list.length && list.every((m, i) => m === prev.money[i]) ? prev.money : list;
  }
}
