// The raw layout of a prompt for RPH (STANDALONE-PLAN §4.8, step 1): the facts laid out without
// judging them. Every message the model is sent, with its role, length and hash; the parts each is
// made of, as the extension's interceptor listed them before Lumiverse joined any; which parts are
// chat history and which standalone lore; and where the blocks of Lumiverse's own breakdown of the
// prompt are found in it, as a hint for names. The shape is RPH's contract's (`RawLayout`, agreed
// with its owner while `rp-harness/contract` is being written).

import { isRecord } from "../../shared/json";
import type { LaidMessage } from "./overlay";
import { textHash, type Role, type Tag } from "./wire";

export interface RawLayout {
  preset: { id: string; name?: string; revision?: string } | null;
  /** The prompt the model receives, in order, after the history window's cut. */
  messages: RawMessage[];
  /** False when some text could not be told apart: that way of joining is unsupported for slicing. */
  complete: boolean;
  /** Lumiverse's own breakdown of the prompt, in its order; none when it had none. */
  blocks: RawBlock[];
  blocksFrom: "breakdown" | "dry-run" | null;
}

export interface RawMessage {
  role: Role;
  length: number;
  hash: string;
  /** Its parts that are not text; `length` and `hash` are of its text. */
  images?: number;
  parts: RawPart[];
}

export interface RawPart {
  /** UTF-16 offsets into the message's text; a gap between two parts is a separator Lumiverse put there when it joined them. */
  start: number;
  end: number;
  /** The part's own role and hash, as the interceptor saw it. */
  role: Role;
  hash: string;
  /** "unknown": no message of the interceptor's list accounts for it. */
  kind: "history" | "lore" | "other" | "unknown";
  /** For history: the chat message it is. */
  source?: { id: string; index: number };
  /** Where `blocks[block]`'s text was found inside this part (offsets into the message's text). */
  blocks: { block: number; start: number; end: number }[];
}

export interface RawBlock {
  name: string;
  type: string;
  role?: Role;
  text: string;
  id?: string;
}

/** Lumiverse's breakdown of a prompt: stored after a generation (`generate.service.ts:4432-4476`) or returned by a dry run (`generate.service.ts:424`). */
export interface BlocksHint {
  from: "breakdown" | "dry-run";
  presetId: string | null;
  presetName: string | null;
  blocks: RawBlock[];
}

function role(value: unknown): Role | undefined {
  return value === "system" || value === "user" || value === "assistant" ? value : undefined;
}

/**
 * Lumiverse's breakdown, read: its entries with text, in its order. Chat history has no text in it
 * (`generate.service.ts:4449`); separators and empty entries name nothing.
 */
export function readBlocksHint(value: unknown, from: BlocksHint["from"]): BlocksHint | null {
  if (!isRecord(value)) return null;
  const entries = Array.isArray(value.entries) ? value.entries : Array.isArray(value.breakdown) ? value.breakdown : null;
  if (entries === null) return null;
  const blocks: RawBlock[] = [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.name !== "string" || typeof e.type !== "string" || e.type === "chat_history" || e.type === "separator") continue;
    if (typeof e.content !== "string" || e.content.trim() === "") continue;
    const r = role(e.role);
    blocks.push({ name: e.name, type: e.type, text: e.content, ...(r ? { role: r } : {}), ...(typeof e.blockId === "string" ? { id: e.blockId } : {}) });
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

/** The raw layout of the prompt RPE passes on (`messages`), from the tag that listed it and Lumiverse's breakdown of it. */
export function rawLayout(tag: Tag, messages: readonly LaidMessage[], complete: boolean, hint: BlocksHint | null): RawLayout {
  const out: RawMessage[] = messages.map((m) => {
    const parts: RawPart[] = m.places.length === 0
      ? [{ start: 0, end: m.text.length, role: role(m.role) ?? "user", hash: textHash(m.text), kind: "unknown", blocks: [] }]
      : m.places.map((p) => {
          const listed = tag.messages[p.member]!;
          return {
            start: p.start,
            end: p.end,
            role: listed.role,
            hash: listed.hash,
            kind: listed.history ? "history" : listed.lore ? "lore" : "other",
            ...(listed.source ? { source: { ...listed.source } } : {}),
            blocks: [],
          };
        });
    // A role Lumiverse's chat format has beyond these (a tool's result) is input to the model.
    return { role: role(m.role) ?? "user", length: m.text.length, hash: textHash(m.text), ...(m.media > 0 ? { images: m.media } : {}), parts };
  });
  const blocks = hint?.blocks ?? [];
  placeBlocks(out, messages.map((m) => m.text), blocks);
  const preset = tag.preset === null ? null : { id: tag.preset, ...(hint !== null && hint.presetId === tag.preset && hint.presetName !== null ? { name: hint.presetName } : {}) };
  return { preset, messages: out, complete: complete && messages.every((m) => m.places.length > 0), blocks, blocksFrom: hint?.from ?? null };
}
