// The raw layout of a prompt for RPH (STANDALONE-PLAN §4.8, step 1): the facts laid out without
// judging them. Every message the model is sent, with its role, length and hash; the parts each is
// made of, as the extension's interceptor listed them before Lumiverse joined any; which parts are
// chat history and which standalone lore; and where the blocks of Lumiverse's own breakdown of the
// prompt are found in it, as a hint for names. The shape is RPH's contract's `RawLayout`.

import type { PromptRole, RawBlock, RawLayout, RawMessage, RawPart, SliceKind } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { apartFromLine, type Feedback } from "./feedback";
import type { LaidMessage } from "./overlay";
import { textHash, type Role, type Tag } from "./wire";

/** Lumiverse's breakdown of a prompt: stored after a generation (`generate.service.ts:4432-4476`) or returned by a dry run (`generate.service.ts:424`). */
export interface BlocksHint {
  from: "breakdown" | "dry-run";
  presetId: string | null;
  presetName: string | null;
  blocks: RawBlock[];
}

function role(value: unknown): PromptRole | undefined {
  return value === "system" || value === "user" || value === "assistant" || value === "tool" ? value : undefined;
}

/** What Lumiverse's own structural markers say a block is (`PromptBlock.marker`, `prompt-assembly.service.ts:1255-1266`): the persona, or the character card. */
const MARKER_KINDS: Readonly<Record<string, SliceKind>> = {
  persona_description: "persona",
  char_description: "character",
  char_personality: "character",
  scenario: "character",
  dialogue_examples: "character",
};

/**
 * The preset's blocks by id, each with Lumiverse's marker where it has one (null: the preset's own text), from the preset's
 * `prompt_order` as Lumiverse stores it (`rowToPreset`); none for a preset with no blocks there.
 */
export function presetMarkers(promptOrder: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (Array.isArray(promptOrder)) for (const block of promptOrder) if (isRecord(block) && typeof block.id === "string") out.set(block.id, typeof block.marker === "string" && block.marker !== "" ? block.marker : null);
  return out;
}

/**
 * A block's kind before any map is learned (§4.8 l.367, l.389): the one its Lumiverse marker names (a dry run's entries carry it; a
 * stored breakdown's are matched to the preset's blocks by id), `instructions` for a block of the preset's own text, which has no
 * marker; none for every other entry (world info, an extension's, a structural slot), which keeps its own flags. In a group chat
 * the card's blocks are the speaking character's, the generation's own.
 */
function kindOf(e: Record<string, unknown>, markers: ReadonlyMap<string, string | null>): SliceKind | undefined {
  if (e.type !== "block") return undefined;
  if (typeof e.marker === "string" && e.marker !== "") return MARKER_KINDS[e.marker];
  const held = typeof e.blockId === "string" ? markers.get(e.blockId) : undefined;
  return typeof held === "string" ? MARKER_KINDS[held] : "instructions";
}

/**
 * Lumiverse's breakdown, read: its entries with text, in its order, each block with its kind where Lumiverse's markers say it
 * (`markers`: the preset's blocks, `presetMarkers`). Chat history has no text in it (`generate.service.ts:4449`); separators and empty
 * entries name nothing.
 */
export function readBlocksHint(value: unknown, from: BlocksHint["from"], markers: ReadonlyMap<string, string | null> = new Map()): BlocksHint | null {
  if (!isRecord(value)) return null;
  const entries = Array.isArray(value.entries) ? value.entries : Array.isArray(value.breakdown) ? value.breakdown : null;
  if (entries === null) return null;
  const blocks: RawBlock[] = [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.name !== "string" || typeof e.type !== "string" || e.type === "chat_history" || e.type === "separator") continue;
    if (typeof e.content !== "string" || e.content.trim() === "") continue;
    const r = role(e.role);
    const kind = kindOf(e, markers);
    blocks.push({ name: e.name, type: e.type, text: e.content, ...(r ? { role: r } : {}), ...(typeof e.blockId === "string" ? { id: e.blockId } : {}), ...(kind !== undefined ? { kind } : {}) });
  }
  return { from, presetId: typeof value.presetId === "string" ? value.presetId : null, presetName: typeof value.presetName === "string" ? value.presetName : null, blocks };
}

/**
 * Each block found in the prompt's parts that are not chat history: at its first place not already
 * taken, looked for after the block before it first, since Lumiverse lists blocks in the order it
 * assembles them, then anywhere.
 */
function placeBlocks(messages: RawMessage[], texts: readonly string[], blocks: readonly RawBlock[]): void {
  const taken: { message: number; start: number; end: number }[] = [];
  const free = (message: number, start: number, end: number): boolean => !taken.some((t) => t.message === message && start < t.end && t.start < end);
  let cursor = { message: 0, at: 0 };
  blocks.forEach((block, b) => {
    const wanted = [block.text, block.text.trim()].filter((t, i, all) => t !== "" && all.indexOf(t) === i);
    const look = (fromMessage: number, fromAt: number): { message: number; part: RawPart; start: number; end: number } | null => {
      for (const text of wanted) {
        for (let m = fromMessage; m < messages.length; m++) {
          const body = texts[m]!;
          for (const part of messages[m]!.parts) {
            if (part.kind === "history") continue;
            let at = Math.max(part.start, m === fromMessage ? fromAt : 0);
            for (;;) {
              const start = body.indexOf(text, at);
              if (start < 0 || start + text.length > part.end) break;
              if (free(m, start, start + text.length)) return { message: m, part, start, end: start + text.length };
              at = start + 1;
            }
          }
        }
      }
      return null;
    };
    const found = look(cursor.message, cursor.at) ?? look(0, 0);
    if (found === null) return;
    found.part.blocks.push({ block: b, start: found.start, end: found.end });
    taken.push({ message: found.message, start: found.start, end: found.end });
    cursor = { message: found.message, at: found.end };
  });
}

/**
 * The raw layout of the prompt RPE passes on (`messages`), from the tag that listed it and Lumiverse's breakdown of it, with its preset's `revision` as the adapter reads it (R-18). `told`: every
 * listed message was found in the body (`Cut.told`). Where not, the prompt is unsupported for slicing (§18.1 row 0.4): each message is
 * carried whole as one part no listed message accounts for, so the Author still gets the whole prompt. A message Lumiverse added after
 * its interceptors is such a part in a told prompt too.
 */
export function rawLayout(tag: Tag, messages: readonly LaidMessage[], told: boolean, hint: BlocksHint | null, revision: string | null = null, feedback: Feedback | null = null): RawLayout {
  const out: RawMessage[] = messages.map((m) => {
    const whole: RawPart[] = !told || m.places.length === 0
      ? [{ start: 0, end: m.text.length, role: role(m.role) ?? "user", hash: textHash(m.text), kind: "unknown", blocks: [] }]
      : m.places.map((p) => {
          const listed = tag.messages[p.member]!;
          return {
            start: p.start,
            end: p.end,
            role: listed.role,
            hash: m.changed === true ? textHash(m.text.slice(p.start, p.end)) : listed.hash,
            kind: listed.history ? "history" : listed.lore ? "lore" : "other",
            // Lumiverse's memory put a summary here in place of the messages it sums: marked as a summary (§4.2).
            ...(listed.summary ? { summarized: true as const } : {}),
            ...(listed.source ? { source: { ...listed.source } } : {}),
            blocks: [],
          };
        });
    // The feedback typed in Lumiverse's dialog and appended to his last line is a part of its own: his line is not read as edited for it.
    const parts = told && feedback?.found === "separated" && feedback.position === "user" ? apartFromLine(whole, m.text, tag, feedback.text) : whole;
    // A role Lumiverse's chat format does not have is read as input to the model. Thinking sent back with an earlier reply is told apart from the text.
    const thinking = m.thinking === undefined ? {} : { thinking: { length: m.thinking.length, hash: textHash(m.thinking) } };
    return { role: role(m.role) ?? "user", length: m.text.length, hash: textHash(m.text), ...(m.media > 0 ? { images: m.media } : {}), ...thinking, parts };
  });
  const blocks = hint?.blocks ?? [];
  placeBlocks(out, messages.map((m) => m.text), blocks);
  const preset = tag.preset === null ? null : { id: tag.preset, ...(hint !== null && hint.presetId === tag.preset && hint.presetName !== null ? { name: hint.presetName } : {}), ...(revision !== null ? { revision } : {}) };
  return { preset, messages: out, complete: told, blocks, blocksFrom: hint?.from ?? null };
}

/**
 * A layout made with no names for its blocks (`blocksFrom` null), with a hint found since placed in it as `rawLayout` places one: its blocks, and
 * its preset's name where it names the same preset. `texts`: each message's text as the prompt was passed on; the layout as it was where they are
 * not its messages.
 */
export function withBlocks(layout: RawLayout, texts: readonly string[], hint: BlocksHint): RawLayout {
  if (texts.length !== layout.messages.length) return layout;
  const messages: RawMessage[] = layout.messages.map((m) => ({ ...m, parts: m.parts.map((p) => ({ ...p, blocks: [] })) }));
  placeBlocks(messages, texts, hint.blocks);
  const preset = layout.preset === null ? null : { ...layout.preset, ...(hint.presetId === layout.preset.id && hint.presetName !== null ? { name: hint.presetName } : {}) };
  return { ...layout, preset, messages, blocks: hint.blocks, blocksFrom: hint.from };
}
