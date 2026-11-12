// What the author is told as a run of a chat begins, beside its instructions (DEPTH2-PLAN §3 step 1):
// the moment as it stands, so it can act without first reading it; what is due on the story's path
// now; and what the story's prepared start still lacks. The author's notebook and the scene are
// pinned for it (`notebook.ts`), and LumiAH names the jobs due by this turn that are still running.
// Only the author's own definition carries this, so no other agent of the chat reads a draft or the
// preparation's state. Everything here is the engine's own read: no model is asked. Every line is a
// text the player can edit.

import { HARNESS_TEXT } from "../../shared/harness-texts";
import type { ChatId, UserId } from "../../shared/ids";
import type { CastStanding } from "../../shared/ledger";
import type { UserSettings } from "../../shared/settings";
import type { WorldDoc } from "../../shared/world";
import { calendarOf, formatClock, formatStamp, placeOffset } from "../../engine/calendar";
import { own } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import { placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { draftsDue } from "../../engine/story/drafts";
import { feedOf } from "../../engine/story/feed";
import { castOn, type StoryPath, walkStory } from "../../engine/story/record";
import { buildQuestLog } from "../../packs/story/core/index";
import { presentPeople } from "../agents/persist";
import type { HarnessFiles } from "../agents/tools/harness-ports";
import { chatHead } from "../agents/tools/workspace";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { PLAYER } from "./minds";
import { preparedNote } from "./prepare";
import { chatStoryPort } from "./record";

/** What the opening reads of the user's settings: their texts, and the story's limits and minds. */
export type OpeningSettings = Pick<UserSettings, "prompts" | "story">;

/** Who is there, ordered by how much the author acts on them: principals, then supporting characters, then extras. */
const STANDING_ORDER: Readonly<Record<CastStanding, number>> = { principal: 0, supporting: 1, extra: 2 };

/**
 * The moment as it stands on the chat's head, in the author's texts, cut to `story.limits.openingChars`:
 * the story time; where the player's character is; the principals there, in one line; who is there,
 * the player's character first, each with their standing and, for a mind, what it still has to take
 * in; the newest beats on the path (at most `beatsRead`), a line each; and each quest in play at its
 * stage. Cut in this order, one line at a time, until it fits: the oldest beats first, since the
 * record keeps every beat and they matter less the older they are; then the quests, which move
 * slowly; then the people there, the extras first; the time, the place and the principals' line last,
 * because the author acts on who is there now. Whatever is still too long loses its last lines.
 */
export function momentOf(reg: Registry, world: WorldDoc, state: WorldState, path: StoryPath, settings: OpeningSettings): string {
  const texts = settings.prompts.texts;
  const { limits, minds } = settings.story;
  const text = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const name = (id: string): string => own(state.entities, id)?.name ?? id;
  const here = placeOfEntity(state, world.pov);
  const cal = calendarOf(world);
  const offset = placeOffset(world, state.clock, here);
  // A mind takes in what reached it: a principal's, and the player's character's while it has one (as the Cast page counts it).
  const mind = (who: string): string => {
    const waiting = feedOf(path, who, world.pov, castOn(path, who)?.digestedTo ?? null, Number.MAX_SAFE_INTEGER).items.length;
    return waiting > 0 ? text(HARNESS_TEXT.openingWaiting, { count: String(waiting) }) : text(HARNESS_TEXT.openingTakenIn);
  };

  const head = [text(HARNESS_TEXT.openingTime, { time: formatClock(cal, state.clock, offset), stamp: formatStamp(cal, state.clock, offset) })];
  const place = here === null ? undefined : own(world.places, here);
  if (here !== null && place) head.push(text(HARNESS_TEXT.openingPlace, { pov: name(world.pov), place: place.name, id: here }));

  const others = presentPeople(reg, world, state)
    .map((id) => ({ id, standing: castOn(path, id)?.standing ?? "extra" }))
    .sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing]);
  const principals = others.filter((p) => p.standing === "principal");
  if (principals.length > 0) head.push(text(HARNESS_TEXT.openingPrincipals, { names: principals.map((p) => `${name(p.id)} (${p.id})`).join(", ") }));
  const people = [
    text(HARNESS_TEXT.openingPlayer, { name: name(world.pov), id: PLAYER, mind: minds.playerMind ? mind(PLAYER) : "" }),
    ...others.map((p) => text(HARNESS_TEXT.openingPerson, { name: name(p.id), id: p.id, standing: p.standing, mind: p.standing === "principal" ? mind(p.id) : "" })),
  ];

  const told = path.beats.filter((b) => b.beat.struck === undefined);
  const beats = told.slice(-limits.beatsRead).map(({ beat }) => text(HARNESS_TEXT.openingBeat, { by: beat.by === "world" ? text(HARNESS_TEXT.openingWorld) : name(beat.by === PLAYER ? world.pov : beat.by), kind: beat.kind, what: beat.what.replace(/\s+/g, " ").trim() }));
  // A secret not yet revealed shows no stage, only what can be noticed of it.
  const quests = buildQuestLog(reg.context(world, state)).active.map((t) => text(HARNESS_TEXT.openingQuest, { quest: t.label, stage: t.stage !== "" ? t.stage : (t.cue ?? "") }));

  const more = (count: number): string[] => (count > 0 ? [text(HARNESS_TEXT.openingMore, { count: String(count) })] : []);
  const compose = (kept: { beats: number; quests: number; people: number }): string => {
    const lines = [...head, text(HARNESS_TEXT.openingPeople, { people: [...people.slice(0, kept.people), ...more(people.length - kept.people)].join("\n") })];
    if (kept.beats > 0) {
      const earlier = told.length - kept.beats;
      lines.push(text(HARNESS_TEXT.openingBeats, { beats: [...(earlier > 0 ? [text(HARNESS_TEXT.openingEarlier, { count: String(earlier) })] : []), ...beats.slice(beats.length - kept.beats)].join("\n") }));
    }
    if (kept.quests > 0) lines.push(text(HARNESS_TEXT.openingQuests, { quests: [...quests.slice(0, kept.quests), ...more(quests.length - kept.quests)].join("\n") }));
    return text(HARNESS_TEXT.openingMoment, { moment: lines.join("\n") });
  };

  const most = limits.openingChars;
  const kept = { beats: beats.length, quests: quests.length, people: people.length };
  let moment = compose(kept);
  while (moment.length > most) {
    if (kept.beats > 0) kept.beats--;
    else if (kept.quests > 0) kept.quests--;
    // The player character's own line stays.
    else if (kept.people > 1) kept.people--;
    else break;
    moment = compose(kept);
  }
  if (moment.length <= most) return moment;
  const lines = moment.split("\n");
  while (lines.length > 1 && lines.join("\n").length > most) lines.pop();
  return lines.join("\n").slice(0, most);
}

/**
 * The author's opening for a run of chat `at`, in the user's texts: the moment as it stands
 * (`momentOf`); each draft on the path whose time has come or that may have gone stale
 * (`draftsDue`), a line each with its id, why it needs the author, its tier and its time; then where
 * the prepared start stands and what it still lacks (`preparedNote`, with the chat's area of the
 * workspace `files`). Empty where the chat plays no world.
 */
export async function authorOpening(rt: Runtime, at: { chatId: ChatId; userId: UserId }, files: HarnessFiles | null, settings: OpeningSettings): Promise<string> {
  const head = await chatHead(rt, at.chatId, at.userId);
  if (!head) return "";
  const texts = settings.prompts.texts;
  const read = await chatStoryPort(rt, { ...at, turn: "", on: "last" }).read();
  const { world, state } = head;
  const path = read?.path ?? walkStory([]);
  const when = (clock: number): string => formatStamp(calendarOf(world), clock, placeOffset(world, clock, placeOfEntity(state, world.pov)));
  const due = read ? draftsDue(read.path, state.clock, read.onPath) : [];
  const lines = due.map((d) => {
    const stale = d.basisGone || d.beats.length > 0 || d.draft.state === "stale";
    return renderPrompt(HARNESS_TEXT.openingDraft, texts, { id: d.draft.id, state: renderPrompt(stale ? HARNESS_TEXT.openingStale : HARNESS_TEXT.openingDue, texts, {}), tier: String(d.draft.tier), when: when(d.draft.when), what: d.draft.what });
  });
  const prepared = files ? await preparedNote(files, texts, read?.path ?? null) : null;
  return [momentOf(rt.registry, world, state, path, settings), ...(lines.length > 0 ? [renderPrompt(HARNESS_TEXT.openingDrafts, texts, { drafts: lines.join("\n") })] : []), ...(prepared !== null ? [prepared] : [])].filter((part) => part.trim() !== "").join("\n\n");
}
