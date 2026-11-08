// The bootstrap wired to the runtime (DEPTH-PLAN §8): the run's stages bound to the historian, the
// author's notebook and the GM's truth link (`backend/depth/`), the Character Engine's catch-up,
// reflection, point-of-view render and cores (`backend/character-agent.ts`), the import's GM
// reconciliation and the author's amendment of a beat marked wrong; its ledger bound to the
// basis-anchored layer and the blob store; its model to the roles Settings → Depth sets. Each stage
// reads the fold at its own basis, never the live head.

import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import type { LedgerEvent } from "../../shared/ledger";
import type { Basis } from "../../shared/layer";
import { STORY_BEAT, type Beat, type Staging, type StoryRead } from "../../shared/story";
import { STORY_PASSAGE } from "../../shared/passage";
import { STORY_SCENE } from "../../shared/scene";
import type { BootstrapStage } from "../../shared/bootstrap";
import type { UserSettings } from "../../shared/settings";
import { depthCall, ownRoom, type DepthRole } from "../../shared/depth-settings";
import { MIND_WRITE, mindMetaAt, mindPath, povOf, presentAt } from "../../shared/character-engine";
import { spawnTierOf } from "../../shared/tiers";
import { hasOwn, type JsonObject } from "../../shared/json";
import type { WorldDoc } from "../../shared/world";
import type { WorldState } from "../../engine/state";
import type { ChainMessage } from "../../engine/ledger/chain";
import { kindIs } from "../../engine/scope";
import { calendarOf, formatClock } from "../../engine/calendar";
import { PLACE_EVENT, PLACE_NAME_MAX, placeKindFor } from "../../engine/places-in-play";
import type { Runtime } from "../runtime";
import { toChain } from "../ledger-io";
import { giveWay } from "../give-way";
import { depthPort } from "../depth-model-host";
import { sameName, type BeatText, type StagingText } from "../depth/common";
import { bindNewcomers, bindPlaces, historian, historianEvents } from "../depth/historian";
import type { HistorianResult } from "../depth/historian";
import { authorChapter, authorRead, readNotebook, type CastMember } from "../depth/notebook";
import { truthLink } from "../depth/truth-link";
import { cardCoreText, catchUp, povRender, readCard, reflect, seedCore, worldCoreText, type LivedPov } from "../character-agent";
import { knowsFor, mindInput, povRefs, readMind, rewriteFor } from "../character-engine";
import { BootstrapFiles } from "./files";
import { entriesAbout, readImports, reconcile } from "./import";
import { amendBeat } from "./amend";
import type { BootstrapEnv, BootstrapKnobs, BootstrapStages, HistorianOut, Lived, Person } from "./run";
import type { SpoolRow, SurveyMessage } from "./spool";

/** Each stage's role in Settings → Depth (§7): the survey and the import ask no model. */
export const STAGE_ROLE: Readonly<Record<BootstrapStage, DepthRole | null>> = { survey: null, import: null, historian: "historian", author: "author", pov: "pov", minds: "character", truthlink: "gm", reconcile: "gm" };

function beatText(b: Beat, blobs: Readonly<Record<string, string>>): BeatText {
  const quotes = b.quotes !== undefined ? blobs[b.quotes] : undefined;
  return { beat: b, what: blobs[b.what] ?? "", surface: blobs[b.surface] ?? "", ...(quotes !== undefined ? { quotes } : {}) };
}

function stagingText(s: Staging, blobs: Readonly<Record<string, string>>): StagingText {
  const occluded = s.occluded !== undefined ? blobs[s.occluded] : undefined;
  return { staging: s, where: blobs[s.where] ?? "", doing: blobs[s.doing] ?? "", ...(occluded !== undefined ? { occluded } : {}) };
}

function asOut(r: HistorianResult): HistorianOut {
  return { events: [], blobs: r.blobs, beats: r.beats.map((t) => t.beat), staging: r.staging.map((t) => t.staging), newcomers: r.newcomers, newPlaces: r.newPlaces, switches: r.switches, uncertain: r.uncertain, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
}

function asResult(out: HistorianOut): HistorianResult {
  return { beats: out.beats.map((b) => beatText(b, out.blobs)), staging: out.staging.map((s) => stagingText(s, out.blobs)), newcomers: out.newcomers, newPlaces: out.newPlaces ?? [], switches: out.switches ?? [], uncertain: out.uncertain, byMessage: {}, blobs: out.blobs };
}

function nameOf(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): string {
  return (hasOwn(state.entities, id) ? state.entities[id]?.name : undefined) ?? (hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) ?? id;
}

/** The world's person kind a newcomer joins as: `person` itself where the world has it, else the first kind that is one. */
function personKind(rt: Pick<Runtime, "registry">, world: WorldDoc): string {
  if (kindIs(rt.registry, world, "person", "person")) return "person";
  return Object.keys(world.kinds).find((k) => kindIs(rt.registry, world, k, "person")) ?? "person";
}

/** What only a turn depth played records: its scene, its beats and the narrator's prose. */
const DEPTH_PLAYED: ReadonlySet<string> = new Set([STORY_SCENE, STORY_BEAT, STORY_PASSAGE]);

/**
 * Where the chat's history ends on `chain` (§1.3, §8.1 step 3): before the first reply depth made
 * (its shown record holds depth's narrative record, or says nothing read it: `Rec.unread`, a reply
 * made with no scene or a Continue's prose on depth) and the player's messages it answered. The
 * prose before it was written before depth; from it on, the narrator's, whose beats its turns hold
 * already, or depth-era prose nothing decided, never canon. A turn in flight at the chain's end is
 * play too: the reply it is making (`making`), or, while its engine run is under way before the
 * reply exists (`opening`), the player's messages last.
 */
export function historyEnd(chain: readonly ChainMessage[], making: ReadonlySet<MessageId>, opening: boolean): number {
  const last = chain.length - 1;
  const played = chain.findIndex((m, i) => {
    if (m.isUser) return false;
    const shown = m.ledger?.swipes[String(m.swipeId)];
    return (i === last && making.has(m.id)) || shown?.unread !== undefined || (shown?.events ?? []).some((e) => DEPTH_PLAYED.has(e.type));
  });
  if (played < 0 && !opening) return chain.length;
  let end = played < 0 ? chain.length : played;
  while (end > 0 && chain[end - 1]?.isUser) end--;
  return end;
}

/** The bootstrap's run environment for one chat of one user's. */
export function bootstrapEnv(rt: Runtime, chatId: ChatId, userId: UserId, changed: () => void): BootstrapEnv {
  const files = new BootstrapFiles(rt.host, chatId, userId);
  // The run counts against its own cap (§8.3), never the per-day ceiling, and keeps the idle line on each connection: a turn's calls go first (§6.2).
  const model = depthPort(rt.host, (u) => rt.settings.get(u), userId, { day: null, lane: "idle" });
  const settings = (): Promise<UserSettings> => rt.settings.get(userId);
  // The entries the run is replacing (a redo, a chunk read afresh): every stage reads the world as it will be once what replaces them lands (§8.4).
  let replacing: ReadonlySet<string> = new Set();
  const fold = async (basis: Pick<Basis, "message" | "swipe">): Promise<{ state: WorldState; world: WorldDoc; story: StoryRead }> => {
    const at = await rt.ledger.foldAtBasis(chatId, userId, basis, [], replacing);
    if (!at) throw new Error("the chat moved on under the run");
    return at;
  };
  const head = async (): Promise<{ state: WorldState; world: WorldDoc; basis: Basis }> => {
    const basis = await rt.ledger.basisFor(chatId, userId);
    if (!basis) throw new Error("this chat has no messages yet");
    return { ...(await fold(basis)), basis };
  };
  const texts = async (): Promise<Readonly<Record<string, string>>> => (await settings()).prompts.texts;
  /** Whom a Lumiverse card seeds, by id: those the world names a card for, and the chat's own card's character by name (D-17). */
  let cards: Map<EntityId, string> | null = null;
  const cardsOf = async (world: WorldDoc, state: Readonly<WorldState>): Promise<Map<EntityId, string>> => {
    if (cards) return cards;
    const out = new Map<EntityId, string>();
    for (const [id, e] of Object.entries(world.entities)) if (typeof e.characterId === "string" && e.characterId !== "") out.set(id, e.characterId);
    const own = rt.host.characters ? await rt.host.characters.ofChat(chatId, userId).catch(() => null) : null;
    const card = own ? await readCard(rt.host, own, userId) : null;
    if (card) {
      const named = Object.keys(state.entities).filter((id) => !out.has(id) && sameName(card.name, nameOf(world, state, id)));
      if (named.length === 1 && named[0] !== undefined) out.set(named[0], card.id);
    }
    cards = out;
    return out;
  };
  const castMembers = async (cast: readonly Person[], world: WorldDoc, state: Readonly<WorldState>): Promise<CastMember[]> => {
    const withCards = await cardsOf(world, state);
    return cast.map((p) => ({ id: p.id, name: p.name, card: withCards.has(p.id), mind: mindMetaAt(state, p.id)["core.md"] !== undefined }));
  };
  /** What the player did beyond his words that the spool shows: the replies he swiped, and which he kept. */
  const signalsOf = (rows: readonly SpoolRow[]): string[] => rows.flatMap((r) => (r.swipes !== undefined && r.swipes > 1 ? [`Message ${r.index + 1} (${r.name}): ${r.swipes} swipes; the player kept number ${(r.swipe ?? 0) + 1}.`] : []));

  const stages: BootstrapStages = {
    async historian(i, m) {
      const first = i.chunk[0];
      if (!first) throw new Error("an empty chunk");
      const at = await fold(first.basis);
      return asOut(await historian({ world: at.world, state: at.state, texts: await texts(), chunk: i.chunk, before: { beats: i.before.beats.map((b) => beatText(b, i.before.blobs)), staging: i.before.staging.map((s) => stagingText(s, i.before.blobs)) }, cast: i.cast, places: i.places, pov: i.pov }, m));
    },
    bindNewcomers(out, ids, places) {
      const messages = [...new Set(out.beats.flatMap((b) => ("bootstrap" in b.by ? [b.by.bootstrap.message] : [])))].map((id) => ({ id }));
      // The historian's binding drops the bound refs from its lists; the run keeps each newcomer and new place under the id it gave them, to bring them into the world.
      const newcomers = out.newcomers.flatMap((n) => (ids[n.ref] !== undefined ? [{ ...n, ref: ids[n.ref] as EntityId }] : []));
      const newPlaces = (out.newPlaces ?? []).flatMap((p) => (places[p.ref] !== undefined ? [{ ...p, ref: places[p.ref] as string }] : []));
      return { ...asOut(bindPlaces(bindNewcomers(asResult(out), ids, messages), places, messages)), newcomers, newPlaces, ...(out.reasoning ? { reasoning: out.reasoning } : {}) };
    },
    beatEvents(beats, staging, blobs, rows) {
      return historianEvents(
        beats.map((b) => beatText(b, blobs)),
        staging.map((s) => stagingText(s, blobs)),
        rows,
      ) as Record<MessageId, LedgerEvent[]>;
    },
    async spawn(people, places, basis) {
      const at = await fold(basis);
      const kind = personKind(rt, at.world);
      const tier = spawnTierOf(at.world);
      const spawned: LedgerEvent[] = [];
      const links: LedgerEvent[] = [];
      for (const p of people) {
        if (hasOwn(at.state.entities, p.id)) continue;
        spawned.push({ type: "spawn", entity: { id: p.id, kind, name: p.name, tier, fields: { spawned: "bootstrap", ...(p.note.trim() !== "" ? { role: p.note.trim().slice(0, 120) } : {}) }, relations: [] } });
        // Known to the player character who met them, once both are in the world.
        if (p.knownBy !== null) links.push({ type: "link", rel: "knows", from: p.knownBy, to: p.id });
      }
      // A place made in play, as the space pack keeps one (`space.place`), in the place the historian read it in.
      const made: LedgerEvent[] = [];
      for (const p of places) {
        const name = p.name.trim().slice(0, PLACE_NAME_MAX);
        if (hasOwn(at.world.places, p.id) || name === "" || !hasOwn(at.world.places, p.parent)) continue;
        const fields: JsonObject = p.note.trim() !== "" ? { description: p.note.trim().slice(0, 300) } : {};
        const def: JsonObject = { id: p.id, name, parent: p.parent, fields, made: { as: placeKindFor(at.world, p.parent, name), by: "bootstrap", at: at.state.clock, why: "Met in the chat's history." } };
        made.push({ type: PLACE_EVENT, data: { place: p.id, def } });
      }
      return { people: [...spawned, ...links], places: made };
    },
    async authorRead(i, m) {
      const at = await fold(i.basis);
      const r = await authorRead({ world: at.world, state: at.state, texts: await texts(), chunk: i.chunk, beats: i.beats.map((b) => beatText(b, i.blobs)), notebook: await readNotebook(rt, userId, at.state), chapter: { index: i.chapter.index, stretches: Math.max(0, i.chapter.chunks.length - 1) }, cast: await castMembers(i.cast, at.world, at.state), signals: signalsOf(i.chunk) }, m);
      return { events: r.events, blobs: r.blobs, kind: "notebook", chapterEnds: r.chapter.ends, title: r.chapter.title, cast: r.cast, uncertain: r.uncertain, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
    },
    async authorChapter(i, m) {
      const at = await fold(i.basis);
      const r = await authorChapter({ world: at.world, state: at.state, texts: await texts(), chapter: { index: i.chapter.index, title: i.chapter.title ?? `Chapter ${i.chapter.index + 1}`, through: i.chapter.through }, beats: i.beats.map((b) => beatText(b, i.blobs)), notebook: await readNotebook(rt, userId, at.state), cast: await castMembers(i.cast, at.world, at.state) }, m);
      return { events: r.events, blobs: r.blobs, kind: "notebook", chapterEnds: true, cast: [], uncertain: r.uncertain, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
    },
    async pov(i, m) {
      const at = await fold(i.basis);
      // The people of the beat's moment; the chunk's closing staging places only them, since it has everyone where the stretch ended, not where this beat happened.
      const present = presentAt(i.beat);
      const staging = i.staging
        .filter((s) => present.includes(s.who))
        .map((s) => {
          const t = stagingText(s, i.blobs);
          return { who: s.who, where: t.where, doing: t.doing, ...(t.occluded !== undefined ? { occluded: t.occluded } : {}) };
        });
      const deed = i.beat.deed !== undefined ? i.blobs[i.beat.deed] : undefined;
      const r = await povRender(m, { beat: { id: i.beat.id, surface: i.surface, ...(deed !== undefined ? { deed } : {}), ...(i.quotes !== undefined ? { quotes: i.quotes } : {}), actors: i.beat.actors, exposure: i.beat.exposure }, staging, who: i.who, refs: povRefs(rt, at, i.who, present), texts: await texts() });
      return { povs: r.povs, fellBack: r.fellBack, ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
    },
    async seedCore(i) {
      const at = await fold(i.basis);
      // A core the user or the play wrote stands; one seeded (this slot's own before a Redo, say) is seeded again, the new entry superseding the old.
      const had = mindMetaAt(at.state, i.who.id)["core.md"];
      if (had !== undefined && had.mode !== "seed") return null;
      const s = await settings();
      const cardId = (await cardsOf(at.world, at.state)).get(i.who.id);
      const card = cardId ? await readCard(rt.host, cardId, userId) : null;
      const player = nameOf(at.world, at.state, povOf(at.world, at.state));
      const fromCard = card ? cardCoreText(card, { name: i.who.name, player, texts: s.prompts.texts }) : "";
      // Else the world's own description of them: its entity, then the lore about them (the world's own entries, then the chat's World Info, which marks it for review).
      const about = entriesAbout(i.entries, i.who);
      const lore = about.filter((e) => e.role === "lore");
      const entity = hasOwn(at.state.entities, i.who.id) ? at.state.entities[i.who.id] : hasOwn(at.world.entities, i.who.id) ? at.world.entities[i.who.id] : undefined;
      const fromWorld = worldCoreText({ name: i.who.name, fields: entity?.fields ?? {}, lore: lore.map((e) => e.text), player, texts: s.prompts.texts });
      const memory = about.find((e) => e.role === "memory");
      const seed =
        fromCard !== ""
          ? { source: "card" as const, text: fromCard }
          : fromWorld !== ""
            ? { source: "world" as const, text: fromWorld, review: lore.some((e) => e.source === "world_info") }
            : memory
              ? { source: "entry" as const, text: memory.text }
              : i.author && i.author.trim() !== ""
                ? { source: "history" as const, text: i.author }
                : null;
      if (!seed) return null;
      const out = seedCore({ who: i.who.id, at: i.at, ...seed });
      return { events: out.events, blobs: out.blobs, kind: MIND_WRITE };
    },
    async catchUp(i, m) {
      const at = await fold(i.basis);
      const s = await settings();
      const cal = calendarOf(at.world);
      const input = await mindInput(rt, userId, at, i.who.id, s);
      const pov = (l: Lived): LivedPov => ({ beat: l.beat, at: l.at, when: formatClock(cal, l.at), ...(l.place !== "" ? { where: hasOwn(at.world.places, l.place) ? (at.world.places[l.place]?.name ?? l.place) : l.place } : {}), channel: l.channel, whole: l.whole, ...(l.as !== "sensed" ? { as: l.as } : {}), ...(l.from !== undefined ? { from: l.from } : {}), text: l.text, ...(l.whole && l.quotes !== undefined ? { quotes: l.quotes } : {}) });
      const lived = i.lived.map(pov);
      // Living a corrected or struck beat: every file whose latest write drew on the old one is kept or rewritten at its own path.
      const old = i.supersedes;
      const rewrite = old === undefined ? null : await rewriteFor(rt.blobs, userId, at, i.who.id, [old], (i.was ?? []).map(pov));
      if (lived.length === 0 && !rewrite) return { events: [], blobs: {}, kind: MIND_WRITE };
      const call = { ...input, lived, ...(rewrite ? { rewrite } : {}) };
      // An answer that doesn't read leaves the batch pending (no events): asked once more, then the job fails and Resume asks again.
      // One that read but gave no file a verdict, asked twice (`inert`), leaves them out of the mind with nothing to land.
      let out = await catchUp(m, call);
      if (out.events.length === 0 && out.inert === undefined) out = await catchUp(m, call);
      if (out.events.length === 0 && out.inert === undefined) throw new Error(`${i.who.name}'s catch-up answer didn't read twice`);
      // Every write it makes supersedes, in the mind, what was written from the old one (§4.2, Retcons propagate).
      const events = old === undefined ? out.events : out.events.map((e) => (e.type === MIND_WRITE ? { ...e, data: { ...e.data, supersedes: old } } : e));
      return { events, blobs: out.blobs, kind: MIND_WRITE, ...(out.reasoning ? { reasoning: out.reasoning } : {}) };
    },
    async reflect(i, m) {
      const at = await fold(i.basis);
      const out = await reflect(m, await mindInput(rt, userId, at, i.who.id, await settings()));
      return { events: out.events, blobs: out.blobs, kind: MIND_WRITE, ...(out.reasoning ? { reasoning: out.reasoning } : {}) };
    },
    async truthLink(i, m) {
      const at = await fold(i.basis);
      const beliefs: { who: EntityId; path: string; text: string }[] = [];
      for (const who of i.minds) {
        const text = (await readMind(rt.blobs, userId, at.state, who))["beliefs.md"];
        if (text !== undefined && text.trim() !== "") beliefs.push({ who, path: mindPath(who, "beliefs"), text });
      }
      const s = await settings();
      const knowledge = s.minds.knowledge;
      // Its answer room grows with what it reads from the GM's own where the user set one (Settings → Depth), else it is the room rule's (`BootstrapRun.roomRule`).
      const room = ownRoom(s.depth, "gm");
      const r = await truthLink({ registry: rt.registry, world: at.world, state: at.state, texts: await texts(), beats: i.beats.map((b) => beatText(b, i.blobs)), beliefs, msg: i.basis.message, limits: { claimChars: knowledge.claimChars, factsPerChat: knowledge.factsPerChat }, ...(room !== null ? { room } : {}) }, m);
      return { events: r.events, blobs: r.blobs, kind: "truthlink", ...(r.reasoning ? { reasoning: r.reasoning } : {}) };
    },
    async reconcile(i, m) {
      return { ...(await reconcile(m, { chatId, chapter: i.chapter, final: i.final, span: i.span, entries: i.entries, beats: i.beats, blobs: i.blobs, minds: i.minds, basis: i.basis, at: i.at, texts: await texts() })), kind: "story.beat" };
    },
    async amend(i, m) {
      const at = await fold(i.basis);
      return amendBeat(m, { world: at.world, state: at.state, texts: await texts(), beat: i.beat, blobs: i.blobs, message: i.message, note: i.note, cast: i.cast, pov: i.pov, key: i.key });
    },
    async knows(who, basis) {
      return knowsFor(rt, await fold(basis), who);
    },
  };

  return {
    chatId,
    files,
    model,
    stages,
    ledger: {
      // Waiting for what a turn in flight holds: the job after a landing reads it (§8.2).
      landAll: (drafts, without) => rt.ledger.landLayers(chatId, userId, drafts, { without, wait: true }),
      async putBlobs(texts) {
        for (const text of Object.values(texts)) await rt.blobs.put(userId, text);
      },
      async moved(basis) {
        return !(await rt.ledger.chainBases(chatId, userId)).some((b) => b.message === basis.message && b.swipe === basis.swipe);
      },
      chain: () => rt.ledger.chainBases(chatId, userId),
      entries: () => rt.ledger.layerSummaries(chatId, userId),
      replacing(ids) {
        replacing = ids;
      },
    },
    async messages(): Promise<SurveyMessage[]> {
      const messages = await rt.host.chats.messages(chatId, userId);
      const bases = new Map((await rt.ledger.chainBases(chatId, userId)).map((b) => [b.message, b]));
      const core = await rt.ledger.core(chatId, userId);
      const observed = toChain(messages);
      const clocks = new Map<MessageId, number | null>();
      if (core) for (const r of core.fold(observed).messages) clocks.set(r.id, r.clock);
      // The history, never depth's play: up to the first turn depth played, or the one in flight now.
      const making = new Set(Object.values(core?.journal.pending ?? {}).flatMap((p) => (p.messageId !== null ? [p.messageId] : [])));
      const end = historyEnd(core ? core.chain(observed) : observed, making, (core?.journal.prereply ?? []).length > 0);
      return messages.slice(0, end).flatMap((m) => {
        const basis = bases.get(m.id);
        return basis ? [{ id: m.id, isUser: m.isUser, name: m.name, text: m.swipes[m.swipeId] ?? m.content, basis, clock: clocks.get(m.id) ?? null, swipes: m.swipes.length, swipe: m.swipeId }] : [];
      });
    },
    async people() {
      const { state, world } = await head();
      const cast = Object.keys(state.entities)
        .filter((id) => {
          const e = state.entities[id];
          return e !== undefined && kindIs(rt.registry, world, e.kind, "person");
        })
        .map((id) => ({ id, name: nameOf(world, state, id) }));
      // The player character the history starts with: the world's own; the historian notices each switch inside it (D-10).
      return { cast, pov: world.pov };
    },
    async imports() {
      const { state, world } = await head();
      const names = new Map(Object.keys(state.entities).map((id) => [id, nameOf(world, state, id)]));
      const minds = hasOwn(state.packs, "minds") ? (state.packs.minds as Readonly<Record<string, unknown>>) : null;
      return readImports({ host: rt.host, world, minds, names }, chatId, userId);
    },
    async knobs(): Promise<BootstrapKnobs> {
      const b = (await settings()).depth.bootstrap;
      return { chunkTokens: b.chunkTokens, atOnce: { ...b.atOnce }, sample: b.sample, pauseAfterWrong: b.pauseAfterWrong };
    },
    async room(role: DepthRole) {
      return ownRoom((await settings()).depth, role);
    },
    async routes() {
      const s = await settings();
      // Each stage's connection by its name, as Settings → Depth shows it; by its id when Lumiverse no longer has it.
      const names = new Map((await rt.host.connections.list(userId).catch(() => [])).map((c) => [c.id, c.name]));
      const out: Partial<Record<BootstrapStage, { connection: string | null; model: string | null }>> = {};
      for (const [stage, role] of Object.entries(STAGE_ROLE) as [BootstrapStage, DepthRole | null][]) {
        const call = role ? depthCall(s, role) : null;
        const id = call?.connectionId ?? null;
        out[stage] = { connection: id === null ? null : (names.get(id) ?? id), model: call?.model ?? null };
      }
      return out as Record<BootstrapStage, { connection: string | null; model: string | null }>;
    },
    now: () => Date.now(),
    rss: () => process.memoryUsage().rss,
    giveWay,
    log: (line) => rt.host.log("warn", `[LumiRPEngine] ${line}`, userId),
    changed,
  };
}
