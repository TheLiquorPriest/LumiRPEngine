// Fixtures for the rig (PlanScenarios-2 item 6), loaded on the stand-in's Lumiverse side as Lumiverse keeps them: a chat of any
// length with facts planted in it, a book with keys, marks and unmarked copies, a preset, a group chat. They go in through the
// stand-in's own library and rows (`test/standin/`), which write the rows Lumiverse's services write; RPE's side is never
// loaded by hand: what RPE holds it makes from these through its own routes. Every name is invented, and a fixture built with
// the same words is the same rows.

import type { Block, Preset } from "../../../test/standin/assembly";
import type { Entry } from "../../../test/standin/lore";
import type { Character } from "../../../test/standin/books";
import type { ChatMessage, StandIn } from "../../../test/standin/lumiverse";
import { RIG_CHARACTER, RIG_USER } from "./bed";

/** A line the player or the character said at the place `at` (from 0), which the fixture plants in the chat. */
export interface Planted {
  at: number;
  text: string;
  /** Whose line it is; by default the place's own (even places the player's, odd the character's). */
  role?: "user" | "assistant";
}

export interface ChatSpec {
  id: string;
  name?: string;
  /** The chat's character; the rig's own by default. */
  character?: Character;
  /** How many messages it holds: the planted ones and the filler between them. */
  length: number;
  planted?: readonly Planted[];
  metadata?: Record<string, unknown>;
}

export interface BookSpec {
  id: string;
  name: string;
  /** Entries by their own fields; each is of this book. A copy that is "unmarked" is a second entry that says the same with no mark in its comment. */
  entries: readonly (Partial<Entry> & { id: string })[];
}

export interface GroupSpec {
  id: string;
  name: string;
  members: readonly Character[];
  length?: number;
}

/** A line of filler for place `at`: the same words every time, so a chat built twice is one chat. */
export function filler(at: number): string {
  const parts = ["The lamp holds steady.", "Salt carries on the wind.", "A gull circles twice and leaves.", "The stairs are cold underfoot.", "The sea keeps its own counsel."];
  return `${at + 1}. ${parts[at % parts.length] ?? ""}`;
}

/** The messages of a chat of `length`, the planted lines in their places and filler elsewhere; the first line is the player's. */
export function messagesOf(length: number, planted: readonly Planted[] = []): ChatMessage[] {
  for (const p of planted) if (!Number.isInteger(p.at) || p.at < 0 || p.at >= length) throw new Error(`a line planted at ${p.at} is outside a chat of ${length} messages`);
  const at = new Map(planted.map((p) => [p.at, p]));
  return Array.from({ length }, (_, i) => {
    const line = at.get(i);
    return { id: `m-${String(i + 1).padStart(5, "0")}`, role: line?.role ?? (i % 2 === 0 ? "user" : "assistant"), content: line?.text ?? filler(i) };
  });
}

/** What the rig can load, on a stand-in. */
export class Fixtures {
  constructor(private readonly host: StandIn) {}

  /** A chat of the spec's length, with its lines planted; gives its id. */
  chat(spec: ChatSpec): string {
    this.host.addChat({ id: spec.id, user: RIG_USER, name: spec.name ?? spec.id, character: spec.character ?? RIG_CHARACTER, messages: messagesOf(spec.length, spec.planted), ...(spec.metadata === undefined ? {} : { metadata: spec.metadata }) });
    return spec.id;
  }

  /** A book of the user's with the entries given, each a keyed entry unless its fields say otherwise; gives its id. */
  book(spec: BookSpec): string {
    const entries: Entry[] = spec.entries.map((e) => ({ comment: e.id, content: "", ...e, book: spec.id }));
    this.host.library.addBook({ id: spec.id, name: spec.name, user: RIG_USER, entries });
    return spec.id;
  }

  /** A preset with the blocks given, a chat-history block among them where none is named. */
  preset(spec: { id: string; name: string; blocks: readonly Block[]; more?: Partial<Preset> }): string {
    const blocks = spec.blocks.some((b) => b.marker === "chat_history") ? [...spec.blocks] : [...spec.blocks, { id: "b-history", name: "Chat History", role: "system" as const, content: "", marker: "chat_history" as const }];
    this.host.presets.set(spec.id, { id: spec.id, name: spec.name, blocks, ...spec.more });
    return spec.id;
  }

  /** A group chat: its members in the library first, then the chat, named a group by its metadata as Lumiverse names one. */
  group(spec: GroupSpec): string {
    const [first] = spec.members;
    if (first === undefined) throw new Error("a group chat has members");
    for (const member of spec.members) this.host.library.addCharacter(RIG_USER, member);
    return this.chat({ id: spec.id, name: spec.name, character: first, length: spec.length ?? 2, metadata: { group: true, character_ids: spec.members.map((m) => m.id), muted_character_ids: [] } });
  }
}
