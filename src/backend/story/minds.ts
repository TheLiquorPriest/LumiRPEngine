// Minds (DEPTH2-PLAN §4, §5): a person's mind is files in the chat's area of LumiAH's workspace,
// under `minds/<entity>/`. `core.md` says who they are at heart (the author and the user write it);
// `outline.md` is what they know only in outline of a past they didn't relive (written while the
// story is prepared); `now.md`, `memory.md`, `beliefs.md`, `people.md` and `plans.md` are the
// character's own, in its voice; a supporting character has `profile.md` alone, which the author
// keeps. How long each may be is the player's (`StoryMinds.chars`).
//
// Who the caller is comes from the call (`ToolEnv.agent.as`, LumiAH's `delegate` and `job_start`),
// never from an argument a model could change. Casting has effect here: only a person the author
// cast as a principal has an agent, a mind and a feed (`characterSelf`), so an extra or a
// supporting character can never be run as a character. The player's character has a mind only
// while the run plays under Sovereign Hand and the player keeps their mind switched on.
//
// The engine never writes a mind's content itself: every write is a model's, through `mind_write`.

import { HARNESS_AGENT, HARNESS_NOTE } from "../../shared/harness-texts";
import { MINDS_NOTE } from "../../shared/harness-texts-minds";
import type { JsonObject } from "../../shared/json";
import type { CastStanding } from "../../shared/ledger";
import { MIND_FILE_IDS, type MindFileId } from "../../shared/settings";
import { storyName } from "../../engine/story/feed";
import type { ToolOutcome } from "../agents/runtime";
import type { HarnessFile, HarnessFiles } from "../agents/tools/harness-ports";
import type { HarnessTurn } from "../agents/tools/harness-turn";
import type { ToolReadView } from "../agents/tools/read-view";
import type { ToolEnv } from "../agents/tools/registry";
import { resolvePerson } from "../agents/tools/resolve";
import { needText, textArg } from "../agents/tools/schema";
import { castFor } from "./cast";

/** The player's character, as the story record names them. */
export const PLAYER = "player";

/** A principal's own files, written by its agent in its own voice. */
export const CHARACTER_FILES: readonly MindFileId[] = ["now", "memory", "beliefs", "people", "plans"];

/** What a principal's mind is, as its agent reads it: who they are, what they know in outline, and their own files. */
export const PRINCIPAL_FILES: readonly MindFileId[] = ["core", "outline", ...CHARACTER_FILES];

/**
 * The one folder of the chat's workspace a person's mind is kept in. Every character of their id
 * that could mean something in a path is written as its code, so no id reaches another person's
 * folder or leaves `minds/`, whatever an entity is called.
 */
export function mindFolder(entity: string): string {
  return `minds/${encodeURIComponent(entity).replace(/\./g, "%2E")}/`;
}

/** Where one of a person's mind's files is kept: `entity` their entity's id (the player's character's own id, never "player"). */
export function mindPath(entity: string, file: MindFileId): string {
  return `${mindFolder(entity)}${file}.md`;
}

/** The entity whose folder holds `who`'s mind: the player's character's own id for "player". */
export function mindEntity(view: ToolReadView, who: string): string {
  return who === PLAYER ? view.pov : who;
}

/** How someone stands, for a mind tool: as the author cast them, or the player's character. */
export type MindStanding = CastStanding | "player";

/** How `who` stands in `cast`: a person never cast is an extra. */
export function standingIn(cast: readonly { entity: string; standing: CastStanding }[], who: string): MindStanding {
  return who === PLAYER ? "player" : (cast.find((c) => c.entity === who)?.standing ?? "extra");
}

/** How someone stands, in the user's words. */
export function standingWords(view: ToolReadView, standing: MindStanding): string {
  const id = { extra: MINDS_NOTE.standingExtra, supporting: MINDS_NOTE.standingSupporting, principal: MINDS_NOTE.standingPrincipal, player: MINDS_NOTE.standingPlayer }[standing];
  return view.text(id);
}

/** Whether the player's character has a mind in this run: under Sovereign Hand, with the player's switch for it on. */
export function playerHasMind(turn: HarnessTurn): boolean {
  return turn.directed && turn.settings.story.minds.playerMind;
}

/** The person `said` names, as the story record names them: "player" (or the player's character by name or id) for the player's character. */
export function whoNamed(view: ToolReadView, said: string): string | ToolOutcome {
  if (said.trim().toLowerCase() === PLAYER) return PLAYER;
  const named = resolvePerson(view, said);
  return "refused" in named ? named.refused : storyName(named.id, view.pov);
}

/**
 * The person a character's agent is, as the story record names them: the call's `as`, checked.
 * The answer that says why the call can't go on where there is no turn, the caller isn't a
 * character's agent, it was started as no one or as no person the world has, the person isn't
 * cast as a principal, or it is the player's character while they have no mind.
 */
export async function characterSelf(view: ToolReadView, env: ToolEnv, tool: string): Promise<{ who: string; turn: HarnessTurn } | ToolOutcome> {
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  if (env.agent.role !== HARNESS_AGENT.character) return view.refuse(MINDS_NOTE.onlyCharacter, { tool });
  const as = env.agent.as?.trim() ?? "";
  if (as === "") return view.refuse(MINDS_NOTE.noOne, { tool });
  const who = as === PLAYER ? PLAYER : storyName(as, view.pov);
  if (who === PLAYER) return playerHasMind(turn) ? { who, turn } : view.refuse(MINDS_NOTE.playerNoMind, { name: view.name(view.pov) });
  if (!view.isPerson(who)) return view.refuse(MINDS_NOTE.noPerson, { as });
  const cast = await castFor(env);
  if (cast === null) return view.refuse(MINDS_NOTE.noStory);
  const standing = standingIn(cast, who);
  return standing === "principal" ? { who, turn } : view.refuse(MINDS_NOTE.notPrincipal, { name: view.name(who), standing: standingWords(view, standing) });
}

/** Who calls a mind tool: a character's agent about its own mind, the author, or the game master. */
export type MindCaller = "self" | "author" | "gm";

/** A mind tool's call: who calls, whose mind it is about (as the story record names them), how they stand, and the turn. */
export interface MindCall {
  caller: MindCaller;
  who: string;
  standing: MindStanding;
  turn: HarnessTurn;
}

/**
 * Whose mind a call of `tool` reaches, and who calls. A character's agent reaches its own alone
 * (`characterSelf`): a `who` that names anyone else is refused, never followed. The author and the
 * game master name whose mind with `who`. Any other agent is refused.
 */
export async function mindCall(view: ToolReadView, env: ToolEnv, tool: string, args: JsonObject): Promise<MindCall | ToolOutcome> {
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  const role = env.agent.role;
  if (role === HARNESS_AGENT.character) {
    const self = await characterSelf(view, env, tool);
    if (!("who" in self)) return self;
    const said = typeof args.who === "string" && args.who.trim() !== "" ? whoNamed(view, args.who) : self.who;
    if (typeof said !== "string") return said;
    if (said !== self.who) return view.refuse(MINDS_NOTE.otherMind, { self: view.name(mindEntity(view, self.who)), other: view.name(mindEntity(view, said)) });
    return { caller: "self", who: self.who, standing: self.who === PLAYER ? "player" : "principal", turn };
  }
  const caller: MindCaller | null = role === HARNESS_AGENT.author ? "author" : role === HARNESS_AGENT.gm ? "gm" : null;
  if (caller === null) return view.refuse(MINDS_NOTE.notYours, { tool });
  const said = needText(view, tool, args, "who");
  if (typeof said !== "string") return said;
  const who = whoNamed(view, said);
  if (typeof who !== "string") return who;
  const cast = await castFor(env);
  if (cast === null) return view.refuse(MINDS_NOTE.noStory);
  return { caller, who, standing: standingIn(cast, who), turn };
}

/** The files a mind of `standing` keeps, as the author and the game master read it: a principal's, or a supporting character's profile; an extra keeps none. */
export function filesOf(standing: MindStanding): readonly MindFileId[] {
  return standing === "principal" || standing === "player" ? PRINCIPAL_FILES : standing === "supporting" ? ["profile"] : [];
}

/** The call's `file`: one of a mind's files, by its name with or without `.md`; or the answer that says which names there are. */
export function fileNamed(view: ToolReadView, tool: string, args: JsonObject): MindFileId | ToolOutcome {
  const said = needText(view, tool, args, "file");
  if (typeof said !== "string") return said;
  const id = said.toLowerCase().replace(/\.md$/, "");
  return MIND_FILE_IDS.find((f) => f === id) ?? view.refuse(MINDS_NOTE.badFile, { file: said });
}

/** `entity`'s files among `ids`, each as it stands, or null where it isn't written yet. */
export async function readMind(files: HarnessFiles, entity: string, ids: readonly MindFileId[]): Promise<{ id: MindFileId; file: HarnessFile | null }[]> {
  return Promise.all(ids.map(async (id) => ({ id, file: await files.read(mindPath(entity, id)) })));
}

/**
 * Adds `text` at the end of a file, after what it holds, written on the version it was read at: a
 * write made between that read and this one is read again, and added after, at most a few times.
 * Answers the file's new version, how long it would have been past `max`, or the workspace's refusal.
 */
export async function appendTo(files: HarnessFiles, path: string, text: string, max: number): Promise<{ version: string; size: number } | { long: number } | { refused: { code: string; reason: string } }> {
  let last: { code: string; reason: string } = { code: "conflict", reason: "" };
  for (let tries = 0; tries < 3; tries++) {
    const now = await files.read(path);
    const whole = now && now.text.trim() !== "" ? `${now.text.trimEnd()}\n\n${text}` : text;
    if (whole.length > max) return { long: whole.length };
    const wrote = await files.write(path, whole, now?.version ?? null);
    if (!("refused" in wrote)) return { version: wrote.version, size: whole.length };
    last = wrote.refused;
    if (wrote.refused.code !== "conflict") break;
  }
  return { refused: last };
}

/** The version a whole write is made on: the one the call gave, else the file's as it stands (null: a new file). */
export async function baseOf(files: HarnessFiles, path: string, args: JsonObject): Promise<{ given: string | null; base: string | null }> {
  const given = textArg(args, "version");
  return { given, base: given ?? (await files.read(path))?.version ?? null };
}
