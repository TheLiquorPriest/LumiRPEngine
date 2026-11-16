// The turn's folder (plan §5.3): what the Author is shown at the start of a turn, written as files for
// the agents it delegates to, for queries, for the live view and for the player, alongside the Author's
// run once its first model call has gone out, never before it (§10.1 step 6, §4.7). They are generated
// files, written through the tree as RPH's own writer; an agent's write to them is refused, since only
// the turn's working folders are an agent's (`TURN_WRITABLE`). Each file that holds words is laid out by
// its prompt part under `.prompts/`, so its layout and words are the user's; `world-state.md` is the
// briefing's world state as its own part laid it out, `cast/<name>/` holds every view the cast lays out
// of each character on stage, one file a view by its `cast-*` part, and `turn.json`, the turn's record,
// holds data only, merged into (`mergeTurnRecord`) since its run's end and its message's tie complete it
// too. A file whose part is switched off, or that lays out nothing, is not written.
//
// The views of the prompt itself (the whole prompt, the history it holds, the preset's guidance, the
// persona, the character) are the harness's prompt map's, their one writer: it writes them in this
// folder during the run, from the request, on a prompt with no map yet from the raw layout's block names
// and kinds, which the door gives. So is `briefing.md`, what the lead was told at its run's start as it
// was sent, which a kept request points into.

import type { Fields, Guidance, LinesPart, TemplatePart } from "../app/guidance";
import type { JsonValue, LiveApi, PromptMessage, Scope, TurnRequest } from "rp-harness/contract";
import type { TaggedTurn } from "../adapter/lumiverse/provider";
import type { CastView } from "../cast";
import type { ActivatedRead } from "../lore/indexing";
import { mergeTurnRecord, TURN_RECORD, type TreeFiles } from "../tree";

/** The files, by their names in the turn's folder. */
export const TURN_FILES = {
  lore: "active-wi-content.md",
  worldState: "world-state.md",
  turn: TURN_RECORD,
  attempts: "previous-attempts/",
  cast: "cast/",
} as const;

/** The prompt parts the files are laid out by. */
export const FOLDER_PARTS = { lore: "turn-lore", attempt: "turn-attempt" } as const;

/**
 * An earlier attempt at the reply a swipe or regenerate writes again: its reply where RPE kept it, its intent record where it wrote
 * one, and what the player said with the swipe or regenerate that replaced it.
 */
export interface Attempt {
  turn: string;
  reply: string | null;
  intent: string | null;
  feedback: AttemptFeedback;
}

/**
 * What the player said with the swipe or regenerate that replaced an attempt: the mode he asked of the composer's swipe and the words he
 * typed with it; the feedback he typed in Lumiverse's regenerate dialog where it was told apart; and, where it could not be, where it
 * stands if he typed any (inside his last line, or a message at the prompt's end; null where that is not known).
 */
export interface AttemptFeedback {
  mode: string | null;
  words: string | null;
  typed: string | null;
  unseparated: { position: "system" | "user" | null } | null;
}

/** An attempt's fields for its part: the feedback as `feedback` (his words, then what he typed in the dialog), `mode`, and where unseparated feedback stands. */
function attemptFields(a: Attempt, n: number): Fields {
  const { feedback: f } = a;
  const said = [f.words, f.typed].filter((t): t is string => t !== null && t.trim() !== "").join("\n\n");
  return {
    n,
    turn: a.turn,
    ...(a.intent !== null ? { intent: a.intent } : {}),
    ...(a.reply !== null ? { reply: a.reply } : {}),
    ...(said !== "" ? { feedback: said } : {}),
    ...(f.mode !== null ? { mode: f.mode } : {}),
    ...(f.unseparated !== null ? { unseparated: true, ...(f.unseparated.position !== null ? { position: f.unseparated.position } : {}) } : {}),
  };
}

/** A character on stage at the turn, by the name the scene gives, and the cast's views of them that hold anything, each laid out by its part. */
export interface CastFolder {
  name: string;
  views: readonly CastView[];
}

/** A character's folder name in `cast/`: the name with what a path cannot hold made a dash; null for a name that leaves nothing. */
function castFolderName(name: string): string | null {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim();
  return safe === "" ? null : safe;
}

export interface FolderDeps {
  files: TreeFiles;
}

export interface AlongsideDeps extends FolderDeps {
  /** The harness's live view, which tells when the lead's first model call of the turn goes out. */
  live: Pick<LiveApi, "subscribe">;
}

export interface FolderAsk {
  scope: Scope & { turn: string };
  guidance: Guidance;
  tagged: TaggedTurn;
  /** The prompt as RPH takes it, in the order of the request's layout. */
  messages: readonly PromptMessage[];
  request: TurnRequest;
  /** The ids of the entries the lore map named in the Author's briefing, as the map writes them. */
  loreMap: readonly string[];
  /** The entries that activated for the prompt, in the tag's order with the lore map's ids and how each activated, each with its text as the prompt carried it (none where it was not found there): the lore file is laid out from them, reading nothing again. */
  lore: readonly ActivatedRead[];
  attempts: readonly Attempt[];
  /** The cast's views of those on stage, read at the turn's start (none where no scene is open); awaited when the folder is written. */
  cast: Promise<readonly CastFolder[]>;
  received: number;
}

/** The lore map as the briefing holds it, then each entry that activated for the prompt, its text as the prompt carried it (`FolderAsk.lore`). */
function loreFields(ask: FolderAsk, loreMap: string | undefined): Fields {
  const entries = ask.lore.map((e) => ({ id: e.id, title: e.title, ...(e.source !== "" ? { source: e.source } : {}), ...(e.how !== undefined ? { how: e.how } : {}), ...(e.text !== undefined ? { text: e.text } : {}) }));
  return { ...(loreMap !== undefined ? { lore_map: loreMap } : {}), entries };
}

/** What intake gives the turn's record (`turn.json`): the turn's facts as data, `received` among them, which retention orders folders by. */
function turnData(ask: FolderAsk, written: readonly string[]): Record<string, JsonValue> {
  const { tag, cut } = ask.tagged;
  const data = {
    turn: ask.scope.turn,
    chat: ask.scope.chat,
    session: ask.scope.session,
    parent: ask.request.parent ?? null,
    kind: tag.kind,
    generation: tag.generation,
    target: tag.target,
    speaker: tag.speaker,
    connection: tag.connection,
    preset: tag.preset,
    persona: tag.persona,
    received: ask.received,
    prompt: { messages: ask.messages.length, keptFrom: cut.keep, leftOut: ask.request.leftOut ?? [] },
    lore: ask.tagged.lore.map((l) => l.id),
    loreMap: ask.loreMap,
    files: written,
  };
  return JSON.parse(JSON.stringify(data)) as Record<string, JsonValue>;
}

/**
 * Writes the turn's folder; gives the files written, by their paths in the agents' view. Every file is written at once, all
 * together; `turn.json`, which lists the others, last, merged into what its run's end or its message's tie may have put there
 * first. A file that cannot be written leaves the others to be written: the error names each one that was not.
 */
export async function writeTurnFolder(d: FolderDeps, ask: FolderAsk): Promise<string[]> {
  const places = await d.files.places(ask.scope);
  const folder = places.turn;
  if (folder === undefined) return [];
  const { guidance } = ask;
  const [lorePart, attemptPart] = await Promise.all(
    [FOLDER_PARTS.lore, FOLDER_PARTS.attempt].map(async (name): Promise<TemplatePart | undefined> => {
      const part: TemplatePart | LinesPart | undefined = await guidance.part(name);
      return part?.format === "template" ? part : undefined;
    }),
  );
  const write = async (name: string, text: string | undefined): Promise<string | null> => {
    if (text === undefined || text.trim() === "") return null;
    const result = await d.files.write(ask.scope, `${folder}${name}`, { op: "write", text: `${text.trimEnd()}\n` }, "harness");
    if (result.status !== "written") throw new Error(`The turn's file ${name} could not be written (${result.status}).`);
    return result.path;
  };
  const loreMap = ask.request.briefing.find((b) => b.name === "lore-map")?.text;
  const failed = new Set<string>();
  let cast: readonly CastFolder[] = [];
  try {
    cast = await ask.cast;
  } catch (error) {
    failed.add(`The cast's views of those on stage could not be read for the turn's folder: ${error instanceof Error ? error.message : String(error)}`);
  }
  const settled = await Promise.allSettled([
    write(TURN_FILES.lore, lorePart?.render(loreFields(ask, loreMap)).text),
    write(TURN_FILES.worldState, ask.request.briefing.find((b) => b.name === "world-state")?.text),
    ...ask.attempts.map((a, i) =>
      write(`${TURN_FILES.attempts}attempt-${i + 1}.md`, attemptPart?.render(attemptFields(a, i + 1)).text),
    ),
    ...cast.flatMap((c) => {
      const named = castFolderName(c.name);
      return named === null ? [] : c.views.map((v) => write(`${TURN_FILES.cast}${named}/${v.name.replace(/:/g, "-")}.md`, v.text));
    }),
  ]);
  const written = settled.flatMap((s) => (s.status === "fulfilled" && s.value !== null ? [s.value] : []));
  for (const s of settled) if (s.status === "rejected") failed.add(s.reason instanceof Error ? s.reason.message : String(s.reason));
  try {
    await mergeTurnRecord(d.files, ask.scope, { fields: turnData(ask, written) });
  } catch (error) {
    failed.add(error instanceof Error ? error.message : String(error));
  }
  if (failed.size > 0) throw new Error([...failed].join(" "));
  return [...written, `${folder}${TURN_FILES.turn}`];
}

/**
 * Writes the turn's folder alongside the Author (plan §10.1 step 6; §4.7: "files written after the call starts, not before"): once
 * the lead's first model call of the turn has gone out, as the harness's live view tells it, or once `ended` resolves where the run
 * ends with none. Nothing of the folder is read or written before then. `began` is told the moment its writing begins. The
 * subscription is made before this gives way, so a caller that starts the run after calling it misses no call.
 */
export async function writeAlongside(d: AlongsideDeps, ask: FolderAsk, ended: Promise<void>, began: () => void): Promise<string[]> {
  const first = Promise.withResolvers<void>();
  const stop = d.live.subscribe({ user: ask.scope.user, chat: ask.scope.chat }, (item) => {
    if (item.type === "event" && item.record.event.kind === "call_started" && item.record.parent === undefined && item.record.scope.turn === ask.scope.turn) first.resolve();
  });
  try {
    await Promise.race([first.promise, ended]);
  } finally {
    stop();
  }
  began();
  return await writeTurnFolder(d, ask);
}
