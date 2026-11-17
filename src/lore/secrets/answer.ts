// RPE's answer to the extension's question for the lore's secrets (plan §9.6; R-5, R-189): what each marked passage, whole-entry secret and
// copy reads as in the prompt about to be built, worked out by today's own rules (`worldInfoVerdict`, `src/secrecy/`) at the point of the
// path the generation's turn will start from. The world and the state there come from RPE's own store, held in memory and read in place,
// with no call to Lumiverse or to a model; the narrator's view follows the chat's own choice, else its world's at that point, else the
// global one; a holding counts as `revealsFact` counts it, by the switch and the threshold in force at that turn's start (the record the
// turn will make there applied, as today's interceptor read the state with its turn's planned events included). The marks are worded by
// `.prompts/secret-marks.md`. Nothing is kept from one generation to the next, and nothing is written.
//
// The same verdict is asked two ways: at the question (`secrecyRules`), and on receipt over the entries RPE read itself (`secrecyAt`),
// where an entry the world's secrets were indexed from, with no mark, is switched off and what the verdict would switch on is listed.

import type { Guidance, LinesPart } from "../../app/guidance";
import { worldInfoVerdict } from "../../secrecy/verdict";
import type { WorldState } from "../../engine/state";
import type { JsonObject } from "../../shared/json";
import type { WorldInfoCandidate, WorldInfoVerdict } from "../../shared/host";
import { SECRET_MARK_WORDING, type SecretMarkWording } from "../../shared/secret-marks";
import { BLANK_REVISION, type SeenMessage, type Store, type TurnPoint } from "../../store";
import type { LoreScope } from "../chat-settings";
import { knowledgeApplied, type SecretSettingsFor } from "./settings";

/** The part of the files that words a mark in the prompt (`.prompts/secret-marks.md`). */
export const SECRET_MARKS = "secret-marks";

/** The lines of `.prompts/secret-marks.md` in the guidance in force; none where the part is not lines or is not there. */
export async function secretMarkLines(guidance: Guidance): Promise<LinesPart | undefined> {
  const part = await guidance.part(SECRET_MARKS);
  return part?.format === "lines" ? part : undefined;
}

/** What the lane takes from the rest of RPE. */
export interface SecrecyDeps {
  store: Store;
  /** The secrecy settings of a chat's levels, with the world it plays on. */
  settingsFor: SecretSettingsFor;
  /** The lines of `.prompts/secret-marks.md` in force for a chat; none where the file has none. */
  wording: (at: LoreScope) => Promise<LinesPart | undefined>;
  log(message: string): void;
}

/** A candidate lore entry as the question carries it: its text key always, its text and RPE's fields only where it holds marks or fields. */
export interface QuestionEntryLike {
  id: string;
  book: string;
  disabled: boolean;
  key: string;
  content?: string;
  comment?: string;
  extensions?: JsonObject;
}

/** What the lane reads of the question: the chat, the path as the extension saw it, where the coming turn starts on it, and the candidate entries. */
export interface SecrecyQuestion {
  user: string;
  chat: string;
  path: readonly SeenMessage[];
  point: TurnPoint;
  entries: readonly QuestionEntryLike[];
}

/** The verdict as the door's wire says it. */
export interface SecrecyAnswer {
  disabled: string[];
  enabled: string[];
  mutated: { id: string; content: string }[];
}

/**
 * The mark wording from the part's lines: each line as the file says it, with the fields a mark is filled in with left in their places
 * for `renderMark` to fill. A line the file does not hold is today's shipped wording of it.
 */
export function markWording(lines: LinesPart | undefined): SecretMarkWording {
  const open = { text: "{{text}}", known: "{{known}}", kept: "{{kept}}", forms: "{{forms}}", everyone: "{{everyone}}" };
  const line = (name: keyof SecretMarkWording): string => lines?.line(name, open) ?? SECRET_MARK_WORDING[name];
  return { known: line("known"), kept: line("kept"), both: line("both"), everyone: line("everyone"), rule: line("rule") };
}

/** A question's entry as the verdict reads it: an entry told by its text key alone has no marks, so its key is the text a twin of a mark is known by. */
function candidateOf(e: QuestionEntryLike): WorldInfoCandidate {
  return { id: e.id, bookId: e.book, disabled: e.disabled, extensions: e.extensions ?? {}, comment: e.comment ?? "", content: e.content ?? e.key };
}

/**
 * The verdict over `entries` at a state: the world the state plays and the narrator's view there, today's rules, the holdings counted by
 * the switch and the threshold in force. A chat that plays no world gets none of it, as today's does. Throws, with why, where the state's
 * world is not at hand, so the answer says it could not be worked out.
 */
export async function secrecyAt(deps: SecrecyDeps, at: LoreScope, state: Readonly<WorldState>, entries: readonly WorldInfoCandidate[]): Promise<WorldInfoVerdict> {
  if (state.revision === BLANK_REVISION) return { disabled: [], enabled: [], mutated: [] };
  const world = deps.store.env.worlds(state.revision);
  if (world === undefined) throw new Error(`the world revision ${state.revision} of chat ${at.chat} is not available`);
  const set = await deps.settingsFor({ ...at, world });
  const wording = markWording(await deps.wording(at));
  const held = knowledgeApplied(state, set);
  const gate = {
    registry: deps.store.env.registry,
    playsWorld: () => true,
    head: async () => ({ world, state: held }),
    narrator: async () => ({ view: set.narrator, wording }),
    log: (message: string) => deps.log(message),
  };
  return worldInfoVerdict(gate, { chatId: at.chat, userId: at.user, entries: [...entries], chatMetadata: {} });
}

/**
 * The lane the door asks for the extension's question: the state where the coming turn starts on the question's path, from RPE's own
 * store alone, and the verdict there over the entries the question carries.
 */
export function secrecyRules(deps: SecrecyDeps): (ask: SecrecyQuestion, signal: AbortSignal) => Promise<SecrecyAnswer> {
  return async (ask) => {
    const start = deps.store.user(ask.user).turnStart(ask.chat, ask.path, ask.point);
    const verdict = await secrecyAt(deps, { user: ask.user, chat: ask.chat }, start.state.world, ask.entries.map(candidateOf));
    return { disabled: verdict.disabled, enabled: verdict.enabled, mutated: verdict.mutated ?? [] };
  };
}

/** What the lane reads on receipt: the chat, the path as the extension saw it, where the generation's turn starts on it, and the entries RPE read itself, whole. */
export interface SecrecyReceipt {
  user: string;
  chat: string;
  path: readonly SeenMessage[];
  point: TurnPoint;
  entries: readonly WorldInfoCandidate[];
}

/**
 * The lane the door asks on receipt (R-59): the verdict at the point the generation's turn starts from, over the entries RPE read itself, whole,
 * worked out by the same function as the question's (`secrecyAt`) from RPE's own store alone.
 */
export function secrecyOnReceipt(deps: SecrecyDeps): (ask: SecrecyReceipt, signal: AbortSignal) => Promise<SecrecyAnswer> {
  return async (ask) => {
    const start = deps.store.user(ask.user).turnStart(ask.chat, ask.path, ask.point);
    const verdict = await secrecyAt(deps, { user: ask.user, chat: ask.chat }, start.state.world, ask.entries);
    return { disabled: verdict.disabled, enabled: verdict.enabled, mutated: verdict.mutated ?? [] };
  };
}
