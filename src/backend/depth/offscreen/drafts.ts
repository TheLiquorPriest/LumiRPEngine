// The drafts a chain holds (DEPTH-PLAN §4.6): read per chat and chain from the live events, never
// stored on a draft. A draft is a candidate where its entry folds (its basis on the chain); it is
// settled where a live `story.settle` cites it, dropped where a live `author.drop` does, and open
// otherwise. The fold keeps the same marks in the story and author slices (`settledIn`,
// `droppedIn`), which is what refuses a second settlement or a drop of a settled draft.
//
// No character plays from non-canon (§4.6's invariant): what a scene reaches that an open draft holds
// from before the scene's minute is due (`dueDrafts`), and the author settles, drops or re-dates it
// before anyone plays; a catch-up lives nothing of someone's from the minute an open draft holds them
// (`heldFrom`) until it settles or is dropped. Bookkeeping only: which drafts are due is a fact, what
// becomes of each is the author's.

import { AUTHOR_DROP, draftOf, dropOf, settleOf, STORY_DRAFT, STORY_SETTLE, type DraftData, type DraftTouch, type DropData, type SettleData } from "../../../shared/episodes";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { Chip } from "../../../shared/state-view";
import type { StoryContainer } from "../../../shared/story";
import { calendarOf, dateAt, weekdayName } from "../../../engine/calendar";
import type { ChainMessage } from "../../../engine/ledger/chain";
import type { LedgerCore } from "../../../engine/ledger/journal";
import type { LiveEvent } from "../../../engine/ledger/story";

/** The event types a reader of drafts asks a chain for (`readEvents`, `foldAtBasis`'s `types`). */
export const DRAFT_TYPES: readonly string[] = [STORY_DRAFT, STORY_SETTLE, AUTHOR_DROP];

export type DraftState = "open" | "settled" | "dropped";

export interface DraftOn {
  draft: DraftData;
  /** The layer entry its draft rides in, and the message that entry folds after. */
  from: StoryContainer;
  state: DraftState;
  /** The live settlement citing it, where it is settled. */
  settle?: { data: SettleData; from: StoryContainer };
  /** The live drop citing it, where it is dropped. */
  drop?: { data: DropData; from: StoryContainer };
}

/** Each live draft on a chain with its state there, in fold order, from the chain's live events (`DRAFT_TYPES`); the first of anything met twice wins. */
export function draftsOn(events: readonly LiveEvent[]): DraftOn[] {
  const drafts = new Map<string, { draft: DraftData; from: StoryContainer }>();
  const settles = new Map<string, { data: SettleData; from: StoryContainer }>();
  const drops = new Map<string, { data: DropData; from: StoryContainer }>();
  for (const e of events) {
    if (!("data" in e.event)) continue;
    if (e.event.type === STORY_DRAFT) {
      const d = draftOf(e.event.data);
      if (d && !drafts.has(d.id)) drafts.set(d.id, { draft: d, from: e.from });
    } else if (e.event.type === STORY_SETTLE) {
      const s = settleOf(e.event.data);
      if (s && !settles.has(s.draft)) settles.set(s.draft, { data: s, from: e.from });
    } else if (e.event.type === AUTHOR_DROP) {
      const d = dropOf(e.event.data);
      if (d && !drops.has(d.draft)) drops.set(d.draft, { data: d, from: e.from });
    }
  }
  return [...drafts.values()].map(({ draft, from }): DraftOn => {
    const settle = settles.get(draft.id);
    const drop = drops.get(draft.id);
    return { draft, from, state: settle ? "settled" : drop ? "dropped" : "open", ...(settle ? { settle } : {}), ...(drop ? { drop } : {}) };
  });
}

/** The drafts open on a chain. */
export function openDrafts(events: readonly LiveEvent[]): DraftOn[] {
  return draftsOn(events).filter((d) => d.state === "open");
}

/** The kind of the chip a settlement shows under the reply it landed at (§7 Chips): `settled:<reply>:<swipe>:<draft>`. */
export const SETTLED_CHIP_KIND = "settled";
/** The longest a settled draft's summary runs in its chip's label. */
const SETTLED_LABEL_MAX = 140;

/**
 * "Settled off screen: Dale sold the boat (Thursday)" (§7 Chips): for each draft a settlement made
 * canon at the chain's last reply, a chip under it with the draft's summary, the day its beats
 * happened and the author's reading, and Read, which opens the draft in GM → Depth → Drafts. From
 * `live`, the chain's live events with the draft types among them: the view reads them with the other
 * depth chips' in one walk. Queue-free: for the view, which holds the chat's core; it folds the chain
 * only when a settlement stands there, for the calendar the day is named in.
 */
export function settledChipsOn(core: LedgerCore, observed: readonly ChainMessage[], live: readonly LiveEvent[]): Chip[] {
  const last = core.chain(observed).findLast((m) => !m.isUser);
  if (!last) return [];
  const here = draftsOn(live).flatMap((d) => (d.settle?.from.messageId === last.id ? [{ draft: d.draft, settle: d.settle.data }] : []));
  if (here.length === 0) return [];
  const state = core.fold(observed).state;
  const world = core.playedAt(state);
  const cal = world ? calendarOf(world) : null;
  return here.map(({ draft, settle }): Chip => {
    const said = (draft.summary.split("\n").find((l) => l.trim() !== "") ?? draft.episode.why).trim();
    const what = said.length > SETTLED_LABEL_MAX ? `${said.slice(0, SETTLED_LABEL_MAX - 1).trimEnd()}…` : said;
    const weekday = cal ? dateAt(cal, settle.at).weekday : null;
    const day = cal && weekday !== null ? (cal.system.fullWeekdayNames[weekday] ?? weekdayName(cal, weekday)) : null;
    return {
      id: `${SETTLED_CHIP_KIND}:${last.id}:${last.swipeId}:${draft.id}`,
      kind: SETTLED_CHIP_KIND,
      messageId: last.id,
      swipeId: last.swipeId,
      label: `Settled off screen: ${what}${day ? ` (${day})` : ""}`,
      ...(settle.why.trim() !== "" ? { detail: settle.why.trim() } : {}),
      actions: [{ id: "read", label: "Read", input: { type: "draft", label: "Read", draft: draft.id } }],
      expires: "next_send",
    };
  });
}

/** What a moment of a scene reaches (§4.6): the people and things in it, by id (the player character too), and its places. */
export interface SceneReach {
  entities: ReadonlySet<EntityId>;
  places: ReadonlySet<PlaceId>;
}

/** An open draft a scene reaches, with the touches that make it due. */
export interface DueDraft {
  draft: DraftOn;
  touches: DraftTouch[];
}

/**
 * The open drafts a scene at story minute `now` may not play past (§4.6, §5.3), earliest first: each
 * holding someone or something it reaches (a person or a thing by id; one of its places, as
 * `samePlace` tells whether two places are one scene's) from `now` or before. A thing named only in
 * words, or a fact, has no id to meet: the poll's foresight settles those in advance.
 */
export function dueDrafts(drafts: readonly DraftOn[], reach: SceneReach, now: number, samePlace: (a: PlaceId, b: PlaceId) => boolean): DueDraft[] {
  const out: DueDraft[] = [];
  for (const d of drafts) {
    if (d.state !== "open") continue;
    const touches = d.draft.touches.filter((t) => {
      if (t.from > now) return false;
      const ref = t.ref;
      if ("entity" in ref) return reach.entities.has(ref.entity);
      if ("place" in ref) return [...reach.places].some((p) => samePlace(p, ref.place));
      return false;
    });
    if (touches.length > 0) out.push({ draft: d, touches });
  }
  return out.sort((a, b) => a.draft.draft.at - b.draft.draft.at);
}

/** The earliest story minute from which an open draft holds `who`, and which drafts do; null when none does. */
export function heldFrom(drafts: readonly DraftOn[], who: EntityId): { from: number; drafts: DraftData[] } | null {
  let from = Number.POSITIVE_INFINITY;
  const holding: DraftData[] = [];
  for (const d of drafts) {
    if (d.state !== "open") continue;
    const mine = d.draft.touches.filter((t) => "entity" in t.ref && t.ref.entity === who);
    if (mine.length === 0) continue;
    holding.push(d.draft);
    from = Math.min(from, ...mine.map((t) => t.from));
  }
  return holding.length > 0 ? { from, drafts: holding } : null;
}
