// The turn's folder (plan §5.3): what the Author is shown at the start of a turn, written as files for
// the agents it delegates to, for queries, for the live view and for the player, alongside the Author's
// run once its first model call has gone out, never before it (§10.1 step 6, §4.7). They are generated
// files, written through the tree as RPH's own writer; an agent's write to them is refused, since only
// the turn's working folders are an agent's (`TURN_WRITABLE`). Each file that holds words is laid out by
// its prompt part under `.prompts/`, so its layout and words are the user's; `world-state.md` is the
// briefing's world state as its own part laid it out, and `turn.json` holds data only. A file whose part
// is switched off, or that lays out nothing, is not written.
//
// The views of the prompt itself (the whole prompt, the history it holds, the preset's guidance) are the
// harness's prompt map's: it writes them in this folder during the run, from the request.

import type { Fields, Guidance, LinesPart, TemplatePart } from "rp-harness";
import type { LiveApi, PromptMessage, Scope, TurnRequest } from "rp-harness/contract";
import type { TaggedTurn } from "../adapter/lumiverse/provider";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { ActivatedRead } from "../lore/indexing";
import { isRecord } from "../shared/json";
import type { TreeFiles } from "../tree";
import { textOf } from "./request";

/** The files, by their names in the turn's folder. */
export const TURN_FILES = {
  lore: "active-wi-content.md",
  persona: "persona.md",
  character: "character.md",
  worldState: "world-state.md",
  briefing: "briefing.md",
  turn: "turn.json",
  attempts: "previous-attempts/",
} as const;

/** The prompt parts the files are laid out by; the briefing's file is laid out as the Author's briefing is. */
export const FOLDER_PARTS = { lore: "turn-lore", card: "turn-card", attempt: "turn-attempt", briefing: "briefing" } as const;

/**
 * Lumiverse's own markers of the preset blocks that put the persona and the character card in the
 * prompt (`PromptBlock.marker`; the structural markers of `prompt-assembly.service.ts:1255-1266`).
 */
const PERSONA_MARKERS: Readonly<Record<string, true>> = { persona_description: true };
const CHARACTER_MARKERS: Readonly<Record<string, true>> = { char_description: true, char_personality: true, scenario: true, dialogue_examples: true };

/** An earlier attempt at the reply a swipe or regenerate writes again: its reply where RPE kept it, and its intent record where it wrote one. */
export interface Attempt {
  turn: string;
  reply: string | null;
  intent: string | null;
}

export interface FolderDeps {
  files: TreeFiles;
  reads: LumiverseReads;
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
  /** The entries that activated for the prompt, as the lore map read them at intake: the lore file is laid out from them, reading nothing again. */
  lore: readonly ActivatedRead[];
  attempts: readonly Attempt[];
  received: number;
}

/**
 * The briefing's fields as RPH fills the Author's briefing with the host's part of it (`harness/turn.ts` `#briefing`): the host's
 * blocks by name, the turn, the prefill and what happened since. What RPH adds at the run (rules due, files changed, the reply
 * contract) is not the host's to know here.
 */
function briefingFields(req: TurnRequest, turnFiles: string): Fields {
  const host: Record<string, string> = {};
  for (const block of req.briefing) {
    host[block.name] = block.text;
    host[block.name.replaceAll("-", "_")] = block.text;
  }
  return {
    ...host,
    turn: { kind: req.kind, ...(req.speaker !== undefined ? { speaker: req.speaker } : {}) },
    ...(req.prefill !== undefined && req.prefill !== "" ? { prefill: req.prefill } : {}),
    ...(req.since.length > 0 ? { since: { items: req.since.map((item) => item.text) } } : {}),
    ...(req.briefing.length > 0 ? { blocks: req.briefing.map((block) => ({ name: block.name, text: block.text })) } : {}),
    turn_files: turnFiles,
  };
}

/** The preset's blocks by id, with Lumiverse's marker for each that has one. */
async function markersOf(reads: LumiverseReads, preset: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const row = preset === null ? null : await reads.preset(preset);
  if (row !== null && Array.isArray(row.promptOrder)) {
    for (const block of row.promptOrder) if (isRecord(block) && typeof block.id === "string" && typeof block.marker === "string") out.set(block.id, block.marker);
  }
  return out;
}

/** The text of the prompt's blocks that bear one of the `wanted` markers, where this prompt holds them, in the prompt's order, under each block's name. */
function blocksMarked(ask: FolderAsk, texts: readonly string[], markers: ReadonlyMap<string, string>, wanted: Readonly<Record<string, true>>): { name: string; text: string }[] {
  const { layout } = ask.tagged;
  const found: { message: number; start: number; name: string; text: string }[] = [];
  layout.messages.forEach((m, i) => {
    for (const part of m.parts) {
      for (const at of part.blocks) {
        const block = layout.blocks[at.block];
        const marker = block?.id === undefined ? undefined : markers.get(block.id);
        if (block !== undefined && marker !== undefined && Object.hasOwn(wanted, marker)) found.push({ message: i, start: at.start, name: block.name, text: (texts[i] ?? "").slice(at.start, at.end) });
      }
    }
  });
  return found.sort((a, b) => a.message - b.message || a.start - b.start).map(({ name, text }) => ({ name, text }));
}

/** The lore map as the briefing holds it, then each entry that activated for the prompt, in full as intake read it (`FolderAsk.lore`). */
function loreFields(ask: FolderAsk, loreMap: string | undefined): Fields {
  const entries = ask.lore.map((e) => ({ id: e.id, title: e.title, ...(e.source !== "" ? { source: e.source } : {}), ...(e.how !== undefined ? { how: e.how } : {}), ...(e.text !== undefined ? { text: e.text } : {}) }));
  return { ...(loreMap !== undefined ? { lore_map: loreMap } : {}), entries };
}

/** What `turn.json` holds: the turn's facts as data. */
function turnData(ask: FolderAsk, written: readonly string[]): string {
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
    lore: tag.lore.map((l) => l.id),
    loreMap: ask.loreMap,
    files: written,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Writes the turn's folder; gives the files written, by their paths in the agents' view. What needs nothing of Lumiverse is written at
 * once, all together; the persona's and the character's files once the reads they need are in; `turn.json`, which lists the others,
 * last. A file that cannot be written leaves the others to be written: the error names each one that was not.
 */
export async function writeTurnFolder(d: FolderDeps, ask: FolderAsk): Promise<string[]> {
  const places = await d.files.places(ask.scope);
  const folder = places.turn;
  if (folder === undefined) return [];
  const { guidance, tagged } = ask;
  const [lorePart, cardPart, attemptPart, briefingPart] = await Promise.all(
    [FOLDER_PARTS.lore, FOLDER_PARTS.card, FOLDER_PARTS.attempt, FOLDER_PARTS.briefing].map(async (name): Promise<TemplatePart | undefined> => {
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
  // From the chat application's own markers, so here from the first turn; once a learned map names these slices, its view of them takes the file's place during the run, with the same text from the prompt.
  const cards = (async (): Promise<{ persona?: string; character?: string }> => {
    if (cardPart === undefined) return {};
    const texts = ask.messages.map(textOf);
    const markers = await markersOf(d.reads, tagged.tag.preset);
    const persona = blocksMarked(ask, texts, markers, PERSONA_MARKERS);
    const character = blocksMarked(ask, texts, markers, CHARACTER_MARKERS);
    const personaName = persona.length === 0 || tagged.tag.persona === null ? null : ((await d.reads.persona(tagged.tag.persona))?.name ?? null);
    return {
      ...(persona.length === 0 ? {} : { persona: cardPart.render({ persona: true, ...(personaName !== null ? { name: personaName } : {}), blocks: persona }).text }),
      ...(character.length === 0 ? {} : { character: cardPart.render({ character: true, ...(tagged.tag.speaker.name !== null ? { name: tagged.tag.speaker.name } : {}), blocks: character }).text }),
    };
  })();

  const loreMap = ask.request.briefing.find((b) => b.name === "lore-map")?.text;
  const settled = await Promise.allSettled([
    write(TURN_FILES.lore, lorePart?.render(loreFields(ask, loreMap)).text),
    cards.then((c) => write(TURN_FILES.persona, c.persona)),
    cards.then((c) => write(TURN_FILES.character, c.character)),
    write(TURN_FILES.worldState, ask.request.briefing.find((b) => b.name === "world-state")?.text),
    write(TURN_FILES.briefing, briefingPart?.render(briefingFields(ask.request, folder)).text),
    ...ask.attempts.map((a, i) =>
      write(`${TURN_FILES.attempts}attempt-${i + 1}.md`, attemptPart?.render({ n: i + 1, turn: a.turn, ...(a.intent !== null ? { intent: a.intent } : {}), ...(a.reply !== null ? { reply: a.reply } : {}) }).text),
    ),
  ]);
  const written = settled.flatMap((s) => (s.status === "fulfilled" && s.value !== null ? [s.value] : []));
  const failed = new Set(settled.flatMap((s) => (s.status === "rejected" ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : [])));
  const data = await d.files.write(ask.scope, `${folder}${TURN_FILES.turn}`, { op: "write", text: turnData(ask, written) }, "harness");
  if (data.status !== "written") failed.add(`The turn's file ${TURN_FILES.turn} could not be written (${data.status}).`);
  if (failed.size > 0) throw new Error([...failed].join(" "));
  return [...written, data.path];
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
