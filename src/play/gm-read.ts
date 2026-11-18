// The GM view of a chat, read from RPE's store at its head (plan §14: GM mode's pieces kept on World behind the spoiler gate,
// PlanChatUI-P6, -P7, -P4 item 4): one part of today's GM view at a time (`lre.gm.part`'s answer), built by the kept engine's own
// builders over the played world and the head's state; GM → Things' reads with what the GM's add (where the player character is and
// why each thing is had; a thing's rest, history and findings, over the events on the chat's path); Tidy up's run of what does not add
// up (R-173: listed, never fixed here; a fix is his own edit on the taps route) and Leave it, which writes the chat's leave list;
// what the chat made in play beside the world's draft, and Keep in the world's draft patch, which the page sends to Build's draft
// route; and a person's usual day. Reads only, but for Leave it's one setting. Everything secret included: these are the GM's.

import { route, RouteError, shape } from "../app";
import { buildGmRoster, buildGmWorldPart, type GmPick, type GmWorldPart, gmWorldPartCount } from "../engine/gm-view";
import { authorLines } from "../engine/player-events";
import { withHistoryLines } from "../iface";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import { gmThingExtras, gmThingsList, keepPlaces, keepThings, madePlaceViews, madeThings, type PathEvent } from "../engine/thing-gm";
import { tidyFindings, tidyRun } from "../engine/thing-tidy";
import { personThings, thingPage, thingPicks, thingsList } from "../engine/thing-view";
import { routineChanges, routineGmView, routinePlayerView } from "../packs/castlife/core/view";
import { GM_IDS_MAX, GM_IDS_PARTS, GM_KEYED_PARTS, GM_KIND_PARTS, GM_OUTLINE, GM_PARTS, GM_ROSTER, type GmOutline, type GmPartAnswer, type GmReadPart, keyedItem } from "../shared/gm-parts";
import { isRecord, type JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { GmView } from "../shared/state-view";
import type { WorldDoc } from "../shared/world";
import type { Store, UserStore } from "../store";
import { eventOf } from "../store/fold";
import { pathEventsBefore } from "./path-events";
import type { PlayDeps } from "./service";
import { chatContext } from "./things";
import { headTurn } from "./view";

/** How many of his edits the GM view lists, newest first (today's `GM_EDITS`). */
const GM_EDITS = 40;
/** How many entries a thing's History strip shows, newest first (today's `HISTORY`). */
const HISTORY = 12;
/** The parts RPE's store gives no source for: the characters' minds are the cast record's, on the Cast page. */
const NOT_HERE: readonly GmReadPart[] = ["minds"];

/** The events on the chat's path to its head: every turn's applied changes and what was placed before each, then his changes since the head turn began. */
export function pathEventsAtHead(s: UserStore, chat: string): PathEvent[] {
  const head = headTurn(s, chat);
  const out: PathEvent[] = head === null ? [] : pathEventsBefore(s, head);
  const seen = new Set(out.map((e) => e.unit));
  const turn = out.reduce((n, e) => Math.max(n, e.turn), 0) + 1;
  const missed = new Set(s.headState(chat).notApplied.map((n) => n.change));
  const put = (origin: PathEvent["origin"], id: number, op: string, value: JsonValue, applied: boolean): void => {
    const event = applied && !missed.has(id) && !seen.has(`change:${id}`) ? eventOf(op, value) : null;
    if (event !== null) out.push({ turn, origin, unit: `change:${id}`, event });
  };
  const row = head === null ? null : s.turn(head);
  if (head !== null) for (const c of s.changes(head)) put(c.job !== null ? "agent" : "turn", c.id, c.op, c.value, c.applied);
  for (const c of s.ownerChanges(chat)) if (row === null || c.created >= row.created) put("fix", c.id, c.op, c.value, c.applied);
  return out;
}

/** His edits on the chat, newest first, as GM → This chat lists them: each edit's events worded, with the id that undoes it; an undone one is left out. */
function editsOf(s: UserStore, chat: string, ctx: ReadContext): GmView["edits"] {
  const undone = new Set<number>();
  const edits = new Map<string, { message: string; events: LedgerEvent[]; ids: number[] }>();
  const path = s.path(chat);
  const last = path.at(-1)?.message ?? "";
  for (const c of s.ownerChanges(chat)) {
    if (isRecord(c.cite) && typeof c.cite.undoes === "number") undone.add(c.cite.undoes);
    const tap = isRecord(c.cite) && typeof c.cite.tap === "string" ? c.cite.tap : null;
    if (tap === null) continue;
    const edit = edits.get(tap) ?? { message: last, events: [], ids: [] };
    const event = eventOf(c.op, c.value);
    if (event !== null) edit.events.push(event);
    edit.ids.push(c.id);
    edits.set(tap, edit);
  }
  return [...edits.entries()]
    .filter(([, e]) => !e.ids.every((id) => undone.has(id)) && e.events.length > 0)
    .reverse()
    .slice(0, GM_EDITS)
    .map(([tap, e], i) => ({ messageId: e.message, seq: i, lines: authorLines(ctx.registry, ctx.world, ctx.state, e.events, 12), undo: tap }));
}

/** What a page asks of one part, as `lre.gm.part` asks it. */
export interface GmPartQuery {
  part: string;
  id?: string;
  ids?: readonly string[];
  kind?: string;
  bytes?: boolean;
}

/** Why a part cannot be read as asked; null when it can. */
function problemOf(ask: GmPartQuery, part: GmReadPart | typeof GM_OUTLINE | undefined): string | null {
  if (part === undefined) return `A part is one of ${[...GM_PARTS, GM_ROSTER].join(", ")} or ${GM_OUTLINE}, not ${JSON.stringify(ask.part)}.`;
  if (part === GM_OUTLINE) return ask.id !== undefined || ask.ids !== undefined || ask.kind !== undefined ? "The outline is read whole." : null;
  if (NOT_HERE.includes(part)) return "RPE keeps the characters' minds in the cast record: the Cast page shows them.";
  if (ask.bytes !== undefined) return "Only the outline tells each part's bytes.";
  if (ask.id !== undefined && !GM_KEYED_PARTS.some((p) => p === part)) return `Only ${GM_KEYED_PARTS.join(", ")} take an id; ${part} is read whole.`;
  if (ask.id !== undefined && (ask.ids !== undefined || ask.kind !== undefined)) return "Name one by its id, or several by ids, not both.";
  if (ask.ids !== undefined && !GM_IDS_PARTS.includes(part)) return `Only ${GM_IDS_PARTS.join(", ")} take ids; ${part} is read whole.`;
  if (ask.ids !== undefined && ask.ids.length > GM_IDS_MAX) return `At most ${GM_IDS_MAX} ids at once.`;
  if (ask.kind !== undefined && !GM_KIND_PARTS.includes(part)) return `Only ${GM_KIND_PARTS.join(", ")} take a kind; ${part} is read whole.`;
  return null;
}

/** The key of the chat's head as the GM view reads it: its path's node, its revision and his newest change. */
function keyOf(s: UserStore, chat: string): string {
  const row = s.chat(chat);
  return `${row?.head ?? "~"}\u0000${row?.revision ?? ""}\u0000${s.ownerChanges(chat).at(-1)?.id ?? 0}`;
}

/** One part of the GM view at the chat's head, as `lre.gm.part` answers it; `same` where `since` is the head's key still. */
export function gmPart(store: Store, user: string, chat: string, ask: GmPartQuery, since: string | null): (GmPartAnswer & { key: string }) | { part: string; id: string | null; key: string; same: true } {
  const s = store.user(user);
  const part = ask.part === GM_OUTLINE ? GM_OUTLINE : ask.part === GM_ROSTER ? GM_ROSTER : GM_PARTS.find((p) => p === ask.part);
  const problem = problemOf(ask, part);
  if (problem !== null || part === undefined) throw new RouteError(400, problem ?? "");
  const key = keyOf(s, chat);
  if (since === key) return { part: ask.part, id: ask.id ?? null, key, same: true };
  const ctx = chatContext(store, user, chat);
  const { registry, world, state } = ctx;
  const chatParts: Partial<Record<GmReadPart, () => unknown>> = { edits: () => editsOf(s, chat, ctx), refused: () => [], held: () => [] };
  const whole = (p: GmReadPart): unknown => chatParts[p]?.() ?? (p === GM_ROSTER ? buildGmRoster(registry, world, state) : buildGmWorldPart(registry, world, state, p as GmWorldPart));
  const answer = readPass((): GmPartAnswer => {
    if (part === GM_OUTLINE) {
      const outline: GmOutline = [GM_PARTS[0], GM_ROSTER, ...GM_PARTS.slice(1)]
        .filter((p) => !NOT_HERE.includes(p))
        .map((p) => {
          const value = p === GM_ROSTER || p === "entities" || chatParts[p] !== undefined ? null : gmWorldPartCount(registry, world, state, p as GmWorldPart);
          const count = value ?? (p === GM_ROSTER || p === "entities" ? Object.keys(state.entities).length : (whole(p) as unknown[]).length);
          return { part: p, count, ...(ask.bytes === true ? { bytes: Buffer.byteLength(JSON.stringify(whole(p)), "utf8") } : {}) };
        });
      return { part: GM_OUTLINE, id: null, value: outline };
    }
    const pick: GmPick = { ...(ask.ids !== undefined ? { ids: ask.ids } : {}), ...(ask.kind !== undefined ? { kind: ask.kind } : {}) };
    if (ask.id === undefined) {
      if (pick.ids === undefined && pick.kind === undefined) return { part, id: null, value: whole(part) } as GmPartAnswer;
      return { part, id: null, value: part === GM_ROSTER ? buildGmRoster(registry, world, state, pick) : buildGmWorldPart(registry, world, state, part as GmWorldPart, pick) } as GmPartAnswer;
    }
    const keyed = GM_KEYED_PARTS.find((p) => p === part);
    if (keyed === undefined) throw new RouteError(400, `Only ${GM_KEYED_PARTS.join(", ")} take an id.`);
    const id = ask.id;
    if (keyed === "orgs") {
      const all = buildGmWorldPart(registry, world, state, "orgs");
      const named = keyedItem(all, id, (o) => o.page.id, (o) => o.page.name);
      if (named !== null && "ambiguous" in named) throw new RouteError(400, `${named.ambiguous.length} have the name ${JSON.stringify(id)}: ${named.ambiguous.join(", ")}; name one by its id.`);
      return named === null ? { part: keyed, id, value: [] } : { part: keyed, id: named.item.page.id, value: [named.item] };
    }
    const named = keyedItem(
      Object.entries(state.entities).map(([e, def]) => ({ id: e, name: def.name })),
      id,
      (e) => e.id,
      (e) => e.name,
    );
    if (named !== null && "ambiguous" in named) throw new RouteError(400, `${named.ambiguous.length} have the name ${JSON.stringify(id)}: ${named.ambiguous.join(", ")}; name one by its id.`);
    if (named === null) return { part: keyed, id, value: [] } as GmPartAnswer;
    return { part: keyed, id: named.item.id, value: buildGmWorldPart(registry, world, state, keyed, { ids: [named.item.id] }) } as GmPartAnswer;
  });
  return { ...answer, key };
}

/** What the GM reads take from the play area: the store, the chat's settings and guidance files (the history lines his edits are worded in), and the writer of a chat's setting (Leave it). */
export type GmReadDeps = Pick<PlayDeps, "store" | "settings" | "texts" | "writeChatSetting">;

/** The leave list's key, as `things.tidyLeft` is written. */
const TIDY_LEFT = "things.tidyLeft";

const T = shape.text();
const answer = shape.json();
const draftParts = shape.field(shape.json(), "The world's draft as Build holds it now: its `entities` and `places`.");

/** The world's draft parts a page sent, as the readers take them. */
function draftOf(raw: JsonValue): Pick<WorldDoc, "entities" | "places"> {
  if (!isRecord(raw) || !isRecord(raw.entities) || !isRecord(raw.places)) throw new RouteError(400, "Send the world's draft with its entities and places.");
  return raw as unknown as Pick<WorldDoc, "entities" | "places">;
}

export function gmRoutes(deps: GmReadDeps) {
  const { store } = deps;
  const read = <T>(user: string, chat: string, run: (ctx: ReadContext) => T): JsonValue => readPass(() => run(chatContext(store, user, chat))) as unknown as JsonValue;
  /** Tidy up's run at the chat's head: every finding of the kept finder, less those he left, at most `things.maxTidyFindings`. */
  const tidy = async (user: string, chat: string): Promise<JsonValue> => {
    const { taps } = await deps.settings(user, chat);
    const path = pathEventsAtHead(store.user(user), chat);
    return read(user, chat, (ctx) => ({ tidy: tidyRun(tidyFindings(ctx, path), new Set(taps.tidy.left), taps.tidyRunMost) }));
  };
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/gm/parts/:part",
      access: "page",
      group: "state",
      does: "One part of the GM view of the chat at its head (everything, secrets included): one of the view's parts, the roster, or the outline of them all; with `id`, of the entities, money or organizations that one (by id or name), with `ids` those, with `kind` those of the kind. With `since` the key of an answer held: `same` while the head is still there.",
      query: {
        id: shape.optional(T, "One entity, party or organization, by its id or name."),
        ids: shape.optional(T, "Several, by their ids, joined by commas."),
        kind: shape.optional(T, "Only those of this kind or one extending it."),
        since: shape.optional(T, "The key of the answer held."),
        bytes: shape.optional(T, "`true`: the outline tells each part's bytes."),
      },
      reply: answer,
      handle: async ({ user, params, query }) => {
        const ask: GmPartQuery = { part: params.part, ...(query.id ? { id: query.id } : {}), ...(query.ids ? { ids: query.ids.split(",") } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.bytes === "true" ? { bytes: true } : {}) };
        // His edits are worded in the chat's own copy of the history lines.
        return (await withHistoryLines(deps.texts(user, params.chat), () => gmPart(store, user, params.chat, ask, query.since || null))) as unknown as JsonValue;
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/gm/things",
      access: "page",
      group: "state",
      does: "GM → Things' list of the chat at its head: each thing with who has it and where, where the player character is, and why each thing someone has is theirs.",
      reply: answer,
      handle: ({ user, params }) => read(user, params.chat, (ctx) => ({ list: thingsList(ctx), here: gmThingsList(ctx) })),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/gm/things/:entity",
      access: "page",
      group: "state",
      does: "A thing's page as the GM reads it: the page, the pickers, and what the GM's adds (its rest, why it is had, its history in this chat over the path's events, its findings).",
      reply: answer,
      handle: ({ user, params }) => {
        const path = pathEventsAtHead(store.user(user), params.chat);
        return read(user, params.chat, (ctx) => {
          const thing = thingPage(ctx, params.entity);
          if (thing === null) throw new RouteError(404, `Chat ${params.chat} has no thing ${params.entity}.`);
          return { thing, pick: thingPicks(ctx), gm: gmThingExtras(ctx.registry, ctx, path, params.entity, tidyFindings(ctx, path), HISTORY) };
        });
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/gm/people/:entity/things",
      access: "page",
      group: "state",
      does: "A person's things as the GM reads them, with the pickers.",
      reply: answer,
      handle: ({ user, params }) =>
        read(user, params.chat, (ctx) => {
          const person = personThings(ctx, params.entity);
          if (person === null) throw new RouteError(404, `Chat ${params.chat} has no person ${params.entity}.`);
          return { person, pick: thingPicks(ctx) };
        }),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/tidy",
      access: "page",
      group: "state",
      does: "Tidy up: what does not add up among the chat's things at its head, every kind, each with its fix or fixes, less those he left as they are, at most `things.maxTidyFindings`; with the switch on or off. Nothing is changed.",
      reply: answer,
      handle: ({ user, params }) => tidy(user, params.chat),
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/tidy/left",
      access: "page",
      group: "state",
      does: "Leave it, or bring it back: the finding's key put in the chat's `things.tidyLeft` (newest last, the oldest gone past `things.maxTidyLeft`), or taken out; then Tidy up's run as it stands.",
      body: shape.object({ key: shape.text({ blank: false }), left: shape.yesNo() }),
      reply: answer,
      handle: async ({ user, params, body }) => {
        const { taps } = await deps.settings(user, params.chat);
        const rest = taps.tidy.left.filter((k) => k !== body.key);
        await deps.writeChatSetting(params.chat, TIDY_LEFT, (body.left ? [...rest, body.key] : rest).slice(-taps.tidy.leftMost));
        return await tidy(user, params.chat);
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/made",
      access: "page",
      group: "state",
      does: "What the chat made in play (things, places, the grids laid or changed) that the world's draft sent does not have, or has already.",
      body: shape.object({ draft: draftParts }),
      reply: answer,
      // It only reads the chat against the draft sent: a chat RPE does not hold is not taken on.
      takesChat: false,
      handle: ({ user, params, body }) => {
        const draft = draftOf(body.draft);
        return read(user, params.chat, (ctx) => ({ made: { things: madeThings(ctx, draft), places: madePlaceViews(ctx, draft) } }));
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/made/keep",
      access: "page",
      group: "state",
      does: "Keep in the world: the draft patch that copies the picked places, then things, into the world's draft sent, each under its own id, with what would be kept, what skipped and why. The page sends the patch to Build's draft route.",
      body: shape.object({ draft: draftParts, things: shape.list(T), places: shape.list(T) }),
      reply: answer,
      // It answers a patch for the page to send to Build, and keeps nothing of the chat.
      takesChat: false,
      handle: ({ user, params, body }) => {
        const draft = draftOf(body.draft);
        return read(user, params.chat, (ctx) => {
          const placed = keepPlaces(ctx, body.places, draft);
          const kept = keepThings(ctx, body.things, draft, new Set(placed.result.places));
          return { ops: [...placed.ops, ...kept.ops], kept: { things: kept.result.things, places: placed.result.places, skipped: [...placed.result.skipped, ...kept.result.skipped], notes: kept.result.notes } };
        });
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/people/:entity/day",
      access: "page",
      group: "state",
      does: "A person's usual day at the chat's head: as far as the player character may know them (`view=player`; one he does not know reads as no one), or the GM's, with why each block is there (`view=gm`, at `day` where given).",
      query: { view: shape.oneOf("player", "gm"), day: shape.optional(T, "The day's index, for the GM's view; today's where left out.") },
      reply: answer,
      handle: ({ user, params, query }) =>
        read(user, params.chat, (ctx) => {
          if (query.view === "gm") {
            if (!Object.hasOwn(ctx.state.entities, params.entity)) throw new RouteError(404, `Chat ${params.chat} has no one ${params.entity}.`);
            return { gm: routineGmView(ctx, params.entity, query.day ? Number(query.day) : undefined) };
          }
          const player = routinePlayerView(ctx, params.entity);
          if (player === null) throw new RouteError(404, `Chat ${params.chat} has no one ${params.entity} your character knows.`);
          return { player };
        }),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/routines/changed",
      access: "page",
      group: "state",
      does: "Whose routines or schedules this chat changed, by him or by the story.",
      reply: answer,
      handle: ({ user, params }) => read(user, params.chat, (ctx) => ({ changed: routineChanges(ctx) })),
    }),
  ] as const;
}
