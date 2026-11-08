// The historian (DEPTH-PLAN §5.1, §5.2, §8.1 step 3): the bootstrap's one stage where prose becomes
// canon, because that prose was written before depth and is, by D36, the canon of its time. It reads
// a stretch of the history (a chunk of whole messages, oldest first) with the beats and staging
// established before it, and records what happened as beats with exposure (`shared/story.ts`), each
// anchored at its own source message and swipe (`by.bootstrap`), dated from the ledger's clock where
// the chat had one, else from the historian's reading of the prose, marked approximate. Whoever acts
// in a beat perceives it, as a scene's beat has it, and lives it as the beat's deed, what they did
// and said as they did it, while everyone else lives what reached them of its surface, which is
// written from no one's side (`reachOf`); someone listed as perceiving it several ways is one entry
// with every way (`addExposure`). Someone the story meets for the first time comes back as a `new:`
// ref with their name, and so does a place no listed place holds (the world's, and those the run
// made from earlier stretches, which the fold may not hold yet); the bootstrap makes the person or
// the place and binds the ref (`bindNewcomers`, `bindPlaces`). It also notices the player starting to
// play someone else (D-10): from that message on, that person is the player character, with no
// agent. Its answer is read through the shared `Reading`, so whatever of it isn't kept as written is
// told to the call's keeper. Its answer room is the bootstrap port's (`BootstrapRun.metered`). It
// never runs in a depth turn.

import type { EntityId, MessageId, PlaceId } from "../../shared/ids";
import type { PackEvent } from "../../shared/ledger";
import type { Basis } from "../../shared/layer";
import type { PromptTexts } from "../../shared/prompts";
import { DEPTH_TEXT } from "../../shared/depth-prompts";
import { addExposure, BEAT_ACTS, beatEvent, beatId, EXPOSURE_CHANNELS, EXPOSURE_REACHES, stagingEvent, type Beat, type Exposure, type Staging, type StoryRef } from "../../shared/story";
import { povOf } from "../../shared/character-engine";
import type { WorldDoc } from "../../shared/world";
import { calendarOf, formatClock } from "../../engine/calendar";
import { own } from "../../engine/pack-kit";
import { placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { askRole, bareId, beatLine, named, nameKey, personNamed, putText, sameName, type BeatText, type Blobs, type StageCost, type StagingText } from "./common";
import type { ModelPort } from "./port";

/** One message of the stretch, as the bootstrap's spool holds it. */
export interface HistorianRow {
  id: MessageId;
  isUser: boolean;
  name: string;
  text: string;
  /** The story minute after its turn, where the chat's ledger has one. */
  clock: number | null;
  basis: Pick<Basis, "swipe">;
}

export interface HistorianInput {
  world: WorldDoc;
  /** The fold at the stretch's start: its people, places and clock. */
  state: Readonly<WorldState>;
  texts: PromptTexts;
  chunk: readonly HistorianRow[];
  /** The beats and staging established before the stretch (the most recent of them, as the caller bounds them). */
  before: { beats: readonly BeatText[]; staging: readonly StagingText[] };
  /** The people the story has met so far, the player character among them. */
  cast: readonly { id: EntityId; name: string }[];
  /** The places the bootstrap has made from earlier stretches, by id: the fold may not hold them yet, and the historian names them as it names the world's. */
  places?: readonly { id: PlaceId; name: string }[];
  /** The player character as the stretch opens (D-10): the one the player switched to last, before it; absent, the fold's. */
  pov?: EntityId;
  signal?: AbortSignal;
}

export interface Newcomer {
  ref: string;
  name: string;
  note: string;
}

/** A place the story meets that the world doesn't have: its `new:` ref, its name, what the historian says of it and the place it is in. */
export interface NewPlace {
  ref: string;
  name: string;
  note: string;
  parent: PlaceId;
}

/** The player starts playing `who` at `message` (D-10): from it on, `who` is the player character. */
export interface PovSwitch {
  message: MessageId;
  who: EntityId;
}

export interface HistorianResult extends StageCost {
  beats: BeatText[];
  /** Who stood where at the stretch's end. */
  staging: StagingText[];
  newcomers: Newcomer[];
  newPlaces: NewPlace[];
  /** The player's switches of character inside the stretch, in message order. */
  switches: PovSwitch[];
  uncertain: string[];
  /** Each source message's events, in order: its beats, and the stretch's closing staging with the last message's. */
  byMessage: Record<MessageId, PackEvent[]>;
  blobs: Blobs;
}

/** The ref someone new to the story has until the bootstrap makes them. */
export const NEWCOMER_PREFIX = "new:";

/** A short name as a ref's tail: lower case, words joined by `_`. */
function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "someone";
}

function historianData(input: HistorianInput, pov: EntityId, placesListed: readonly { id: PlaceId; name: string }[]): string {
  const { world, state } = input;
  const cal = calendarOf(world);
  const people = input.cast.map((p) => `- ${p.name} (id: ${p.id})${p.id === pov ? ": the player character as this stretch opens; the player's messages are his" : ""}`);
  const places = placesListed.map((p) => `- ${p.name} (id: ${p.id})`);
  const before = input.before.beats.map((b) => beatLine(world, state, b));
  const staging = input.before.staging.map((s) => `- ${named(world, state, s.staging.who)}: ${s.where}; ${s.doing}${s.occluded ? `; can't see or hear: ${s.occluded}` : ""}`);
  const pc = input.cast.find((p) => p.id === pov)?.name ?? own(state.entities, pov)?.name ?? pov;
  const stretch = input.chunk.map((m) => `[${m.id}] ${m.isUser ? `${pc} (id: ${pov}), the player` : m.name}${m.clock !== null ? `, ${formatClock(cal, m.clock)}` : ""}:\n${m.text}`);
  return [
    `People (name each by the id given here, the player character too; someone not here, by a "new:" ref):\n${people.join("\n") || "- (none yet)"}`,
    `Places (name each by its id, a room or a spot in one by the place that holds it; somewhere no place here holds, by a "new:" ref):\n${places.join("\n") || "- (none)"}`,
    `Where things stood before this stretch:\n${before.join("\n") || "- (this is the story's start)"}`,
    `Who stood where:\n${staging.join("\n") || "- (unknown)"}`,
    `The stretch, message by message (each opens with its id in brackets; the player's are headed with the player character as the stretch opens):\n\n${stretch.join("\n\n")}`,
  ].join("\n\n");
}

/** The events of a stretch's beats and closing staging, by the message each beat came from. */
export function historianEvents(beats: readonly BeatText[], staging: readonly StagingText[], chunk: readonly Pick<HistorianRow, "id">[]): Record<MessageId, PackEvent[]> {
  const out: Record<MessageId, PackEvent[]> = {};
  for (const m of chunk) out[m.id] = [];
  for (const b of beats) if ("bootstrap" in b.beat.by) out[b.beat.by.bootstrap.message]?.push(beatEvent(b.beat));
  const last = chunk[chunk.length - 1];
  if (last) for (const s of staging) out[last.id]?.push(stagingEvent(s.staging));
  return out;
}

/** Reads a stretch of the history into beats with exposure, staging at its end, the people and places it met for the first time, and the player's switches of character. */
export async function historian(input: HistorianInput, model: ModelPort): Promise<HistorianResult> {
  const { world, state } = input;
  const pcStart = input.pov ?? povOf(world, state);
  // The places a beat may happen at: the world's, then those the run made from earlier stretches that the fold doesn't hold yet.
  const placesListed = [...Object.values(world.places).map((p) => ({ id: p.id, name: p.name })), ...(input.places ?? []).filter((p) => !own(world.places, p.id))];
  const asking = { world, state, texts: input.texts, data: historianData(input, pcStart, placesListed), pov: pcStart, ...(input.signal ? { signal: input.signal } : {}) };
  const asked = await askRole(model, "historian", DEPTH_TEXT.historian, asking);
  const { answer: a, read } = asked;
  const usage = asked.usage;
  const blobs: Blobs = {};
  const uncertain = read.texts("uncertain", a.uncertain);
  const rows = new Map(input.chunk.map((m) => [m.id, m]));
  const order = new Map(input.chunk.map((m, i) => [m.id, i]));
  const castIds = new Set(input.cast.map((p) => p.id));
  const castByName = new Map(input.cast.map((p) => [nameKey(p.name), p.id]));
  const newcomers = new Map<string, Newcomer>();
  for (const [i, n] of read.list("newcomers", a.newcomers).entries()) {
    const g = `newcomers[${i}]`;
    const r = read.record(g, n);
    if (!r) continue;
    if (typeof r.ref !== "string" || typeof r.name !== "string" || r.name.trim() === "") {
      read.drop(g, r, "it has no ref or no name");
      continue;
    }
    const ref = r.ref.startsWith(NEWCOMER_PREFIX) ? r.ref : `${NEWCOMER_PREFIX}${slug(r.name)}`;
    if (ref !== r.ref) read.change(`${g}.ref`, r.ref, ref, `it isn't a "${NEWCOMER_PREFIX}" ref`);
    newcomers.set(ref, { ref, name: r.name.trim(), note: read.text(`${g}.note`, r.note) });
  }
  // A person as the answer names them: an id, the player character in force (`pc`), a name the story knows, or someone new (listed once); a field that is no name names no one.
  const person = (field: string, v: unknown, pc: EntityId = pcStart): EntityId | null => {
    if (typeof v !== "string" || v.trim() === "") {
      read.drop(field, v);
      return null;
    }
    const t = bareId(v);
    if (castIds.has(t) || own(state.entities, t)) return t;
    if (/^(you|the player character|player character|the player)$/i.test(t)) return pc;
    const byName = castByName.get(nameKey(t)) ?? (t.startsWith(NEWCOMER_PREFIX) ? null : personNamed(state, t));
    if (byName) return byName;
    const ref = t.startsWith(NEWCOMER_PREFIX) ? t : `${NEWCOMER_PREFIX}${slug(t)}`;
    if (!newcomers.has(ref)) newcomers.set(ref, { ref, name: t.startsWith(NEWCOMER_PREFIX) ? t.slice(NEWCOMER_PREFIX.length).replace(/_/g, " ") : t, note: "" });
    return ref;
  };
  const people = (field: string, v: unknown, pc?: EntityId): EntityId[] => [...new Set(read.list(field, v).flatMap((x, k) => person(`${field}[${k}]`, x, pc) ?? []))];
  // A place as the answer names it: an id or a name of a listed place, a new place it listed under a listed place's name (that place), or a new place it listed (or named by a "new:" ref where a beat happens).
  const same = new Map<string, PlaceId>();
  const placeNamed = (t: string): PlaceId | null => same.get(t) ?? placesListed.find((p) => p.id === t)?.id ?? placesListed.find((p) => sameName(t, p.name))?.id ?? null;
  const listed = new Map<string, { ref: string; name: string; note: string; parent?: PlaceId }>();
  for (const [i, raw] of read.list("newPlaces", a.newPlaces).entries()) {
    const g = `newPlaces[${i}]`;
    const r = read.record(g, raw);
    if (!r) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const said = typeof r.ref === "string" ? bareId(r.ref) : "";
    const ref = said.startsWith(NEWCOMER_PREFIX) ? said : `${NEWCOMER_PREFIX}${slug(name)}`;
    const known = name !== "" ? placeNamed(name) : null;
    if (name === "") {
      read.drop(g, r, "it has no name");
      continue;
    }
    if (known) {
      // A listed place under a second ref: wherever its ref is named, it is that place.
      if (!listed.has(ref)) same.set(ref, known);
      read.change(g, r, known, "a listed place has its name");
      continue;
    }
    if (ref !== said) read.change(`${g}.ref`, r.ref, ref, `it isn't a "${NEWCOMER_PREFIX}" ref`);
    const within = typeof r.in === "string" ? bareId(r.in) : "";
    const parent = within !== "" ? placeNamed(within) : null;
    if (!parent) read.drop(`${g}.in`, r.in, "it isn't a listed place");
    listed.set(ref, { ref, name, note: read.text(`${g}.note`, r.note), ...(parent ? { parent } : {}) });
  }
  const placeOf = (v: unknown, where: boolean): PlaceId | null => {
    if (typeof v !== "string") return null;
    const t = bareId(v);
    const known = placeNamed(t);
    if (known) return known;
    if (listed.has(t)) return t;
    const byName = [...listed.values()].find((p) => sameName(t, p.name));
    if (byName) return byName.ref;
    if (!where || !t.startsWith(NEWCOMER_PREFIX)) return null;
    listed.set(t, { ref: t, name: t.slice(NEWCOMER_PREFIX.length).replace(/_/g, " "), note: "" });
    return t;
  };
  // The player's switches of character (D-10), in message order: each from the message he first plays someone else in.
  const switches: PovSwitch[] = [];
  const marks = read
    .list("switches", a.switches)
    .flatMap((raw, i) => {
      const g = `switches[${i}]`;
      const r = read.record(g, raw);
      const row = r && typeof r.message === "string" ? rows.get(bareId(r.message)) : undefined;
      if (r && !row) read.drop(g, r, "it names no message of the stretch");
      return r && row ? [{ g, r, row }] : [];
    })
    .sort((x, y) => (order.get(x.row.id) ?? 0) - (order.get(y.row.id) ?? 0));
  for (const m of marks) {
    const pc = switches.at(-1)?.who ?? pcStart;
    const who = person(`${m.g}.who`, m.r.who, pc);
    if (!who) continue;
    if (who === pc || switches.some((s) => s.message === m.row.id)) {
      read.drop(m.g, m.r, who === pc ? "the player plays them already" : "another switch is at its message");
      continue;
    }
    switches.push({ message: m.row.id, who });
  }
  /** The player character in force at a message of the stretch: the last switch at or before it, else the one it opened with. */
  const pcAt = (id: MessageId): EntityId => {
    const i = order.get(id) ?? 0;
    let pc = pcStart;
    for (const s of switches) if ((order.get(s.message) ?? 0) <= i) pc = s.who;
    return pc;
  };
  // A beat's characters of its message, within the message; one that holds none of it is no span.
  const spanOf = (field: string, v: unknown, length: number): [number, number] | null => {
    if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isInteger(x))) {
      read.drop(field, v);
      return null;
    }
    const [from, to] = v as [number, number];
    const kept: [number, number] = [Math.max(0, from), Math.min(length, to)];
    if (kept[1] <= kept[0]) {
      read.drop(field, v, "it holds none of its message");
      return null;
    }
    if (kept[0] !== from || kept[1] !== to) read.change(field, v, kept, "it runs past its message");
    return kept;
  };
  const lastBefore = input.before.beats[input.before.beats.length - 1]?.beat;
  let at = lastBefore?.at ?? state.clock;
  let place: PlaceId = lastBefore?.place ?? placeOfEntity(state, pcStart) ?? Object.keys(world.places)[0] ?? "";
  const made = new Map<string, NewPlace>();
  const beats: BeatText[] = [];
  const perMessage = new Map<MessageId, number>();
  for (const [i, raw] of read.list("beats", a.beats).entries()) {
    const g = `beats[${i}]`;
    const b = read.record(g, raw);
    if (!b) continue;
    const row = typeof b.message === "string" ? rows.get(bareId(b.message)) : undefined;
    const what = typeof b.what === "string" ? b.what.trim() : "";
    if (!row || what === "") {
      uncertain.push(`A beat left out: it named no message of the stretch, or said nothing happened (${what || "no words"}).`);
      read.drop(g, b, row ? "it says nothing happened" : "it names no message of the stretch");
      continue;
    }
    const pc = pcAt(row.id);
    const doubt = read.text(`${g}.uncertain`, b.uncertain);
    const doubts: string[] = doubt !== "" ? [doubt] : [];
    let where = placeOf(b.place, true);
    const fresh = where !== null ? listed.get(where) : undefined;
    if (fresh && !made.has(fresh.ref)) {
      // A new place sits in the place it was said to be in, else beside where the story was when it was met; one with neither isn't made.
      const parent = fresh.parent ?? (own(world.places, place) ? (own(world.places, place)?.parent ?? place) : (made.get(place)?.parent ?? null));
      if (parent) made.set(fresh.ref, { ref: fresh.ref, name: fresh.name, note: fresh.note, parent });
      else where = null;
    }
    if (where) place = where;
    else if (b.place !== undefined) {
      doubts.push(`Its place, "${String(b.place)}", isn't one the world has; read as where the story last was.`);
      read.change(`${g}.place`, b.place, place, "it isn't a place the world has");
    }
    // The ledger's clock where the chat had one; else the historian's reading of time passing, approximate.
    const passed = read.number(`${g}.after`, b.after);
    if (passed !== null && passed < 0) read.change(`${g}.after`, passed, 0, "time runs forward");
    const after = passed !== null && passed > 0 ? Math.round(passed) : 0;
    const approx = row.clock === null;
    at = row.clock ?? at + after;
    const n = perMessage.get(row.id) ?? 0;
    perMessage.set(row.id, n + 1);
    const span = spanOf(`${g}.span`, b.span, row.text.length);
    const said = read.words(`${g}.quotes`, b.quotes);
    const quotes = said !== "" ? said : undefined;
    const sensed = read.text(`${g}.surface`, b.surface);
    const surface = sensed !== "" ? sensed : (quotes ?? "");
    if (surface === "") doubts.push("Nothing was said of what there was to sense.");
    const exposure: Exposure[] = [];
    for (const [j, x] of read.list(`${g}.exposure`, b.exposure).entries()) {
      const f = `${g}.exposure[${j}]`;
      const e = read.record(f, x);
      const who = e ? person(`${f}.who`, e.who, pc) : null;
      if (!e || !who) continue;
      // Everyone it reached lives it later, in their own agent's catch-up; the player character in force has no agent (D-10). Someone listed again is one entry, with every way it reached them.
      addExposure(exposure, { who, channel: read.pick(`${f}.channel`, e.channel, EXPOSURE_CHANNELS, "sight"), reach: read.pick(`${f}.reach`, e.reach, EXPOSURE_REACHES, "whole"), ...(who !== pc ? { pending: true as const } : {}) });
    }
    const about: StoryRef[] = [];
    for (const [k, v] of read.list(`${g}.about`, b.about).entries()) {
      if (typeof v !== "string" || v.trim() === "") {
        read.drop(`${g}.about[${k}]`, v);
        continue;
      }
      const p = placeOf(v, false);
      if (p && listed.has(p) && !made.has(p)) read.drop(`${g}.about[${k}]`, v, "a new place no beat has happened at yet");
      else if (p) about.push({ place: p });
      else about.push(castIds.has(v) || own(state.entities, v) || v.startsWith(NEWCOMER_PREFIX) ? { entity: v } : { thing: v.trim() });
    }
    const addressed = people(`${g}.addressed`, b.addressed, pc);
    const actors = people(`${g}.actors`, b.actors, pc);
    // What its actors did and said as they did it, which each lives as its own act: a beat no one acts in has none; one whose actors (the player character in force aside) the answer gave none has them live its surface, and says so.
    const did = read.text(`${g}.deed`, b.deed);
    if (did !== "" && actors.length === 0) read.drop(`${g}.deed`, b.deed, "no one acts in it");
    const deed = did !== "" && actors.length > 0 ? did : undefined;
    if (deed === undefined && actors.some((who) => who !== pc)) doubts.push("Nothing was said of what its actors did as they did it, so they live it as anyone there could sense it.");
    // Whoever acts in a beat perceives their own act, the player character's included, where the answer left them out (whole, by sight, as a scene's beat has it).
    for (const who of actors) if (!exposure.some((y) => y.who === who)) exposure.push({ who, channel: "sight", reach: "whole", ...(who !== pc ? { pending: true as const } : {}) });
    const beat: Beat = {
      id: beatId("bootstrap", row.id, row.basis.swipe, String(n)),
      at,
      ...(approx ? { approx: true as const } : {}),
      order: beats.length,
      place,
      actors,
      act: read.pick(`${g}.act`, b.act, BEAT_ACTS, "did"),
      about,
      what: putText(blobs, what),
      ...(deed !== undefined ? { deed: putText(blobs, deed) } : {}),
      surface: putText(blobs, surface),
      ...(quotes !== undefined ? { quotes: putText(blobs, quotes) } : {}),
      ...(addressed.length > 0 ? { addressed } : {}),
      exposure,
      by: { bootstrap: { message: row.id, swipe: row.basis.swipe, ...(span ? { span } : {}) } },
      ...(doubts.length > 0 ? { uncertain: putText(blobs, doubts.join(" ")) } : {}),
    };
    beats.push({ beat, what, surface, ...(quotes !== undefined ? { quotes } : {}) });
  }
  const lastBeat = beats[beats.length - 1]?.beat.id;
  const lastRow = input.chunk[input.chunk.length - 1];
  const pcEnd = lastRow ? pcAt(lastRow.id) : pcStart;
  const staging: StagingText[] = [];
  for (const [i, raw] of read.list("staging", a.staging).entries()) {
    const g = `staging[${i}]`;
    const s = read.record(g, raw);
    const who = s ? person(`${g}.who`, s.who, pcEnd) : null;
    if (!s || !who) continue;
    const again = staging.some((x) => x.staging.who === who);
    if (again || typeof s.where !== "string" || typeof s.doing !== "string") {
      read.drop(g, s, again ? "a second staging of one person" : "it lacks where they are or what they are doing");
      continue;
    }
    const occluded = read.text(`${g}.occluded`, s.occluded);
    const st: Staging = { who, ...(lastBeat ? { after: lastBeat } : {}), where: putText(blobs, s.where), doing: putText(blobs, s.doing), ...(occluded !== "" ? { occluded: putText(blobs, occluded) } : {}) };
    staging.push({ staging: st, where: s.where, doing: s.doing, ...(occluded !== "" ? { occluded } : {}) });
  }
  return {
    beats,
    staging,
    newcomers: [...newcomers.values()],
    newPlaces: [...made.values()],
    switches,
    uncertain,
    byMessage: historianEvents(beats, staging, input.chunk),
    blobs,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : {}),
    ...(usage ? { usage } : {}),
  };
}

/**
 * The stretch with each newcomer's ref bound to the person the bootstrap made for them (`ids`, ref →
 * id), wherever a beat, a staging or a switch names them; a ref left unbound stays as it was.
 */
export function bindNewcomers(result: HistorianResult, ids: Readonly<Record<string, EntityId>>, chunk: readonly Pick<HistorianRow, "id">[]): HistorianResult {
  const bind = (id: EntityId): EntityId => (Object.prototype.hasOwnProperty.call(ids, id) ? (ids[id] ?? id) : id);
  const beats = result.beats.map((b): BeatText => ({
    ...b,
    beat: {
      ...b.beat,
      actors: b.beat.actors.map(bind),
      about: b.beat.about.map((r) => ("entity" in r ? { entity: bind(r.entity) } : r)),
      ...(b.beat.addressed ? { addressed: b.beat.addressed.map(bind) } : {}),
      exposure: b.beat.exposure.map((x) => ({ ...x, who: bind(x.who) })),
    },
  }));
  const staging = result.staging.map((s): StagingText => ({ ...s, staging: { ...s.staging, who: bind(s.staging.who) } }));
  return { ...result, beats, staging, switches: result.switches.map((s) => ({ ...s, who: bind(s.who) })), newcomers: result.newcomers.filter((n) => !Object.prototype.hasOwnProperty.call(ids, n.ref)), byMessage: historianEvents(beats, staging, chunk) };
}

/** The stretch with each new place's ref bound to the place the bootstrap made for it (`ids`, ref → place id), wherever a beat happens at it or concerns it; a ref left unbound stays as it was. */
export function bindPlaces(result: HistorianResult, ids: Readonly<Record<string, PlaceId>>, chunk: readonly Pick<HistorianRow, "id">[]): HistorianResult {
  const bind = (id: PlaceId): PlaceId => (Object.prototype.hasOwnProperty.call(ids, id) ? (ids[id] ?? id) : id);
  const beats = result.beats.map((b): BeatText => ({ ...b, beat: { ...b.beat, place: bind(b.beat.place), about: b.beat.about.map((r) => ("place" in r ? { place: bind(r.place) } : r)) } }));
  return { ...result, beats, newPlaces: result.newPlaces.filter((p) => !Object.prototype.hasOwnProperty.call(ids, p.ref)), byMessage: historianEvents(beats, result.staging, chunk) };
}
