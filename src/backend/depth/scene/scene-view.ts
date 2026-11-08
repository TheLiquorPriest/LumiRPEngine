// GM → Depth → Turn (DEPTH-PLAN §7, §9.1): the turn inspector's scene view. One depth reply's scene
// as its record holds it, read off the active chain: the staging, the beats in the order the scene
// decided them with who decided each and who perceived them (each point of view whole), each play's
// private take (`minds.v2.take`, the working memory its next plays read), and each passage with
// every draft and the GM's check of it; a Continue's beats and prose after the reply's own.
// Beside it, every model call the reply's turn made, from its generation's inspector record while
// that is kept (provenance, §9.0), each on its connection by name. Each reply is numbered as the
// chat numbers it (LIVE3 lane 1b). Nothing is withheld (§1.4).

import { calendarOf, formatClock } from "../../../engine/calendar";
import { activeRecord } from "../../../engine/ledger/path";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import { MIND_TAKE, mindTakeOf, povOf, type MindTakeData } from "../../../shared/character-engine";
import type { ChatId, EntityId, MessageId, UserId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { type Passage, passagesIn } from "../../../shared/passage";
import type { DepthSceneView, SceneBeat, SceneDecider, SceneDraft, SceneExposure, ScenePassage, SceneReplyRef, SceneStaging, SceneTake } from "../../../shared/scene-view";
import { type Beat, beatOf, STORY_BEAT, STORY_STAGING, type Staging, stagingOf } from "../../../shared/story";
import type { WorldDoc } from "../../../shared/world";
import type { BlobStore } from "../../agents/blobs";
import type { HostPort } from "../../host";
import type { InspectorLog } from "../../inspector-log";
import type { LedgerService } from "../../ledger-io";
import { type ChatNumbersHost, chatNumbers } from "../chat-numbers";

/** The replies with a scene the view lists to pick from, newest first. */
export const SCENE_REPLIES = 20;

/** What the view reads of the runtime: the chat's ledger, its blobs, its inspector records, how the chat numbers its messages, and the user's connections by name. */
export interface SceneViewRt {
  ledger: Pick<LedgerService, "with">;
  blobs: Pick<BlobStore, "get">;
  inspector: Pick<InspectorLog, "load">;
  host: ChatNumbersHost & { connections: Pick<HostPort["connections"], "list"> };
}

/** One reply's scene events as its record holds them: the plan's, then each Continue's, and each passage it told; `minute`, its latest beat's. */
interface Held {
  ref: Omit<SceneReplyRef, "at">;
  minute: number | null;
  beats: { beat: Beat; continued: boolean }[];
  staging: Staging[];
  told: { passage: Passage; continued: boolean }[];
  takes: MindTakeData[];
}

function decidedOf(beat: Beat): SceneDecider {
  if ("turn" in beat.by) return beat.by.decided;
  if ("draft" in beat.by) return "draft";
  return "bootstrap" in beat.by ? "history" : "entry";
}

/** The story events of a list of events: beats, staging, the plays' takes and each passage. */
function storyOf(events: readonly LedgerEvent[]): { beats: Beat[]; staging: Staging[]; takes: MindTakeData[]; told: Passage[] } {
  const beats: Beat[] = [];
  const staging: Staging[] = [];
  const takes: MindTakeData[] = [];
  for (const e of events) {
    if (!("data" in e)) continue;
    if (e.type === STORY_BEAT) {
      const b = beatOf(e.data);
      if (b) beats.push(b);
    } else if (e.type === STORY_STAGING) {
      const s = stagingOf(e.data);
      if (s) staging.push(s);
    } else if (e.type === MIND_TAKE) {
      const t = mindTakeOf(e.data);
      if (typeof t !== "string") takes.push(t);
    }
  }
  return { beats, staging, takes, told: passagesIn(events) };
}

/** The chain's replies whose records hold a scene, oldest first, each with its story events. */
async function heldScenes(rt: Pick<SceneViewRt, "ledger" | "host">, chatId: ChatId, userId: UserId): Promise<Held[]> {
  // Each reply by the number the chat shows it with (`chatNumbers`): "Message 8" is the chat's #8 (LIVE3 lane 1b).
  const numbers = await chatNumbers(rt.host, chatId, userId);
  const out: Held[] = [];
  await rt.ledger.with(chatId, userId, (core, observed) => {
    core.chain(observed).forEach((m, i) => {
      if (m.isUser) return;
      const rec = activeRecord(m, core.journal.tombstones);
      if (!rec) return;
      const plan = storyOf(rec.events.slice(0, rec.pre));
      const read = storyOf(rec.events.slice(rec.pre));
      const conts = rec.post.filter((e) => e.kind === "cont").map((e) => storyOf(e.events));
      const beats = [...plan.beats.map((beat) => ({ beat, continued: false })), ...conts.flatMap((c) => c.beats.map((beat) => ({ beat, continued: true })))];
      const told = [...read.told.map((passage) => ({ passage, continued: false })), ...conts.flatMap((c) => c.told.map((passage) => ({ passage, continued: true })))];
      if (beats.length === 0 && told.length === 0) return;
      const minute = beats.reduce<number | null>((latest, b) => (latest === null || b.beat.at > latest ? b.beat.at : latest), null);
      out.push({ ref: { messageId: m.id, swipeId: m.swipeId, index: numbers.get(m.id) ?? i }, minute, beats, staging: [...plan.staging, ...conts.flatMap((c) => c.staging)], told, takes: [...plan.takes, ...conts.flatMap((c) => c.takes)] });
    });
  });
  return out;
}

/** GM → Depth → Turn: the scene of `message` (the newest reply with one when absent or not on the chain). */
export async function sceneView(rt: SceneViewRt, at: { state: Readonly<WorldState>; world: WorldDoc }, chatId: ChatId, userId: UserId, message?: MessageId): Promise<DepthSceneView> {
  const { state, world } = at;
  const cal = calendarOf(world);
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const held = await heldScenes(rt, chatId, userId);
  const refs: SceneReplyRef[] = held.map((h) => ({ ...h.ref, at: h.minute === null ? null : formatClock(cal, h.minute) })).reverse();
  const shown = held.find((h) => h.ref.messageId === message) ?? held.at(-1);
  const replies = refs.slice(0, SCENE_REPLIES);
  if (!shown) return { reply: null, replies, pov: null, staging: [], beats: [], told: [], takes: [], provenance: null };
  const text = async (hash: string | undefined): Promise<string> => (hash ? ((await rt.blobs.get(userId, hash)) ?? "") : "");
  const asked = new Set(shown.told.flatMap((p) => (p.passage.asked ?? []).flatMap((a) => a.beats)));
  const passageOf = new Map<string, number>();
  shown.told.forEach((p, i) => {
    for (const id of p.passage.beats) if (!passageOf.has(id)) passageOf.set(id, i + 1);
  });
  const beats: SceneBeat[] = [];
  for (const { beat, continued } of shown.beats) {
    const quotes = beat.quotes ? await text(beat.quotes) : undefined;
    const exposure: SceneExposure[] = [];
    for (const x of beat.exposure) exposure.push({ who: x.who, name: name(x.who), channel: x.channel, reach: x.reach, ...(x.pov ? { pov: await text(x.pov) } : {}), pending: x.pending === true });
    beats.push({
      id: beat.id,
      at: formatClock(cal, beat.at),
      place: own(world.places, beat.place)?.name ?? beat.place,
      act: beat.act,
      actors: beat.actors.map(name),
      decided: decidedOf(beat),
      what: await text(beat.what),
      surface: await text(beat.surface),
      ...(quotes !== undefined ? { quotes } : {}),
      exposure,
      passage: passageOf.get(beat.id) ?? null,
      ...(asked.has(beat.id) ? { asked: true as const } : {}),
      ...(continued ? { continued: true as const } : {}),
    });
  }
  const staging: SceneStaging[] = [];
  for (const s of shown.staging) {
    const occluded = s.occluded ? await text(s.occluded) : undefined;
    staging.push({ who: s.who, name: name(s.who), where: await text(s.where), doing: await text(s.doing), ...(occluded !== undefined ? { occluded } : {}), ...(s.after ? { after: s.after } : {}) });
  }
  const told: ScenePassage[] = [];
  for (const [i, { passage, continued }] of shown.told.entries()) {
    const drafts: SceneDraft[] = [];
    for (const d of passage.drafts) {
      const notes = d.notes ? await text(d.notes) : undefined;
      const reasoning = d.reasoning ? await text(d.reasoning) : undefined;
      const checkReasoning = d.checkReasoning ? await text(d.checkReasoning) : undefined;
      drafts.push({ text: await text(d.text), faithful: d.faithful, ...(notes !== undefined ? { notes } : {}), ...(reasoning !== undefined ? { reasoning } : {}), ...(checkReasoning !== undefined ? { checkReasoning } : {}) });
    }
    const asks: ScenePassage["asked"] = [];
    for (const a of passage.asked ?? []) asks.push({ question: await text(a.question), beats: a.beats });
    told.push({ index: i + 1, beats: passage.beats, text: await text(passage.text), drafts, asked: asks, ...(passage.departs !== undefined ? { departs: passage.departs } : {}), ...(continued ? { continued: true as const } : {}) });
  }
  const placeOf = new Map(shown.beats.map(({ beat }, i) => [beat.id, i + 1]));
  const takes: SceneTake[] = [];
  for (const t of shown.takes) takes.push({ who: t.who, name: name(t.who), at: formatClock(cal, t.at), beat: t.beat !== undefined ? (placeOf.get(t.beat) ?? null) : null, lived: t.lived.length, text: await text(t.take) });
  const pov = shown.told[0]?.passage.pov ?? povOf(world, state);
  const records = (await rt.inspector.load(chatId, userId)).records;
  const turn = records.findLast((r) => r.provenance?.reply?.messageId === shown.ref.messageId && r.provenance.reply.swipeId === shown.ref.swipeId)?.provenance;
  // Each call's connection by its name, as Settings shows it; by its id when Lumiverse no longer has it (LIVE3 lane 1b).
  const connections = turn ? new Map((await rt.host.connections.list(userId).catch(() => [])).map((c) => [c.id, c.name])) : null;
  return {
    reply: refs.find((r) => r.messageId === shown.ref.messageId) ?? null,
    replies,
    pov: { id: pov, name: name(pov) },
    staging,
    beats,
    told,
    takes,
    provenance: turn ? { calls: turn.calls.map((c) => ({ ...c, connection: connections?.get(c.connection) ?? c.connection })), turnMs: turn.turnMs, firstContentMs: turn.firstContentMs } : null,
  };
}
