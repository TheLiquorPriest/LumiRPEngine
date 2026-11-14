// The turn's folder (plan §5.3): what the Author is shown at the start of a turn, written as files for
// the agents it delegates to, for queries, for the live view and for the player. They are generated
// files, written through the tree as RPH's own writer; an agent's write to them is refused, since only
// the turn's working folders are an agent's (`TURN_WRITABLE`). Each file that holds words is laid out by
// its prompt part under `.prompts/`, so its layout and words are the user's; `world-state.md` is the
// briefing's world state as its own part laid it out, and `turn.json` holds data only. A file whose part
// is switched off, or that lays out nothing, is not written.
//
// Not written yet, each waiting on a part not built: `preset-guidance.md` and each message's slice
// marker in the assembled prompt (the prompt map's slices), and `cast/` (the cast's views).

import type { Fields, Guidance, LinesPart, TemplatePart } from "rp-harness";
import type { HistoryRange, PromptMessage, Scope, TurnRequest } from "rp-harness/contract";
import type { TaggedTurn } from "../adapter/lumiverse/provider";
import type { LumiverseReads, LvStep } from "../adapter/lumiverse/reads";
import type { Lore } from "../lore";
import { isRecord } from "../shared/json";
import type { TreeFiles } from "../tree";
import { textOf } from "./request";

/** The files, by their names in the turn's folder. */
export const TURN_FILES = {
  prompt: "assembled-preset-prompt.md",
  history: "visible-chat-history.md",
  lore: "active-wi-content.md",
  persona: "persona.md",
  character: "character.md",
  worldState: "world-state.md",
  briefing: "briefing.md",
  turn: "turn.json",
  attempts: "previous-attempts/",
} as const;

/** The prompt parts the files are laid out by; the briefing's file is laid out as the Author's briefing is. */
export const FOLDER_PARTS = { prompt: "turn-prompt", history: "turn-history", lore: "turn-lore", card: "turn-card", attempt: "turn-attempt", briefing: "briefing" } as const;

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
  lore: Lore;
}

export interface FolderAsk {
  scope: Scope & { turn: string };
  guidance: Guidance;
  tagged: TaggedTurn;
  /** The prompt as RPH takes it, in the order of the request's layout. */
  messages: readonly PromptMessage[];
  /** The chat's path as Lumiverse shows it. */
  steps: readonly LvStep[];
  request: TurnRequest;
  /** The ids of the entries the lore map named in the Author's briefing, as the map writes them. */
  loreMap: readonly string[];
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

/** The history messages the prompt holds, as it holds them, with their speakers; and the stretch of the chat it leaves out, by the chat's own places. */
async function historyFields(d: FolderDeps, ask: FolderAsk, texts: readonly string[]): Promise<Fields> {
  const shown = ask.tagged.layout.messages.flatMap((m, i) => m.parts.flatMap((p) => (p.kind === "history" && p.source !== undefined ? [{ id: p.source.id, at: p.source.index, text: (texts[i] ?? "").slice(p.start, p.end) }] : [])));
  const names = new Map((shown.length === 0 ? [] : await d.reads.messagesById(ask.scope.chat, shown.map((s) => s.id))).map((m) => [m.id, m.name]));
  const leftOut = (ask.request.leftOut ?? []).flatMap((r: HistoryRange) => {
    const from = ask.steps[r.from];
    const to = ask.steps[r.to - 1];
    return from === undefined || to === undefined ? [] : [{ from: from.index, to: to.index }];
  });
  return {
    ...(leftOut.length > 0 ? { left_out: leftOut } : {}),
    messages: shown.map((s) => {
      const speaker = names.get(s.id);
      return { ...s, ...(speaker !== undefined && speaker !== "" ? { speaker } : {}) };
    }),
  };
}

/** The lore map as the briefing holds it, then each entry that activated for the prompt, in full as agents read it. */
async function loreFields(d: FolderDeps, ask: FolderAsk, loreMap: string | undefined): Promise<Fields> {
  const at = { user: ask.scope.user, chat: ask.scope.chat, turn: ask.scope.turn };
  const activated = await d.lore.activated(at);
  const read = activated.length === 0 ? [] : await d.lore.read(at, activated.map((a) => a.id));
  const byId = new Map(read.map((e) => [e.id, e]));
  const entries = activated.flatMap((a) => {
    const e = byId.get(a.id);
    return e === undefined ? [] : [{ id: a.id, title: e.title, source: e.source, ...(a.how !== undefined ? { how: a.how } : {}), text: e.text }];
  });
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

/** Writes the turn's folder; gives the files written, by their paths in the agents' view. */
export async function writeTurnFolder(d: FolderDeps, ask: FolderAsk): Promise<string[]> {
  const places = await d.files.places(ask.scope);
  const folder = places.turn;
  if (folder === undefined) return [];
  const { guidance, tagged } = ask;
  const [promptPart, historyPart, lorePart, cardPart, attemptPart, briefingPart] = await Promise.all(
    [FOLDER_PARTS.prompt, FOLDER_PARTS.history, FOLDER_PARTS.lore, FOLDER_PARTS.card, FOLDER_PARTS.attempt, FOLDER_PARTS.briefing].map(async (name): Promise<TemplatePart | undefined> => {
      const part: TemplatePart | LinesPart | undefined = await guidance.part(name);
      return part?.format === "template" ? part : undefined;
    }),
  );
  const texts = ask.messages.map(textOf);
  const loreMap = ask.request.briefing.find((b) => b.name === "lore-map")?.text;
  const markers = cardPart === undefined ? new Map<string, string>() : await markersOf(d.reads, tagged.tag.preset);
  const persona = blocksMarked(ask, texts, markers, PERSONA_MARKERS);
  const character = blocksMarked(ask, texts, markers, CHARACTER_MARKERS);
  const personaName = persona.length === 0 || tagged.tag.persona === null ? null : ((await d.reads.persona(tagged.tag.persona))?.name ?? null);

  const files: [string, string | undefined][] = [
    [
      TURN_FILES.prompt,
      promptPart?.render({
        messages: ask.messages.map((m, i) => {
          const pictures = typeof m.content === "string" ? 0 : m.content.filter((p) => p.type === "image").length;
          return { n: i + 1, role: m.role, text: texts[i] ?? "", ...(pictures > 0 ? { pictures } : {}) };
        }),
      }).text,
    ],
    [TURN_FILES.history, historyPart?.render(await historyFields(d, ask, texts)).text],
    [TURN_FILES.lore, lorePart?.render(await loreFields(d, ask, loreMap)).text],
    [TURN_FILES.persona, persona.length === 0 ? undefined : cardPart?.render({ persona: true, ...(personaName !== null ? { name: personaName } : {}), blocks: persona }).text],
    [TURN_FILES.character, character.length === 0 ? undefined : cardPart?.render({ character: true, ...(tagged.tag.speaker.name !== null ? { name: tagged.tag.speaker.name } : {}), blocks: character }).text],
    [TURN_FILES.worldState, ask.request.briefing.find((b) => b.name === "world-state")?.text],
    [TURN_FILES.briefing, briefingPart?.render(briefingFields(ask.request, folder)).text],
    ...ask.attempts.map((a, i): [string, string | undefined] => [
      `${TURN_FILES.attempts}attempt-${i + 1}.md`,
      attemptPart?.render({ n: i + 1, turn: a.turn, ...(a.intent !== null ? { intent: a.intent } : {}), ...(a.reply !== null ? { reply: a.reply } : {}) }).text,
    ]),
  ];
  const written: string[] = [];
  for (const [name, text] of files) {
    if (text === undefined || text.trim() === "") continue;
    const result = await d.files.write(ask.scope, `${folder}${name}`, { op: "write", text: `${text.trimEnd()}\n` }, "harness");
    if (result.status !== "written") throw new Error(`The turn's file ${name} could not be written (${result.status}).`);
    written.push(result.path);
  }
  const data = await d.files.write(ask.scope, `${folder}${TURN_FILES.turn}`, { op: "write", text: turnData(ask, written) }, "harness");
  if (data.status !== "written") throw new Error(`The turn's file ${TURN_FILES.turn} could not be written (${data.status}).`);
  return [...written, data.path];
}
