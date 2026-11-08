// The author's jumpstart pass (DEPTH-PLAN Round 2 item 1): once a chat's LumiBooks records land, a few
// author calls (one per volume) read them with the world's lore and what LRE already holds of the cast,
// and write through the existing writers: a core for each of the main and returning cast who has none
// (the seed path, marked for review), what each knows and doesn't into their beliefs file (imported,
// for review), and the notebook's seed as edits added to its files. LumiBooks is evidence only: canon
// going forward is LRE's beats, minds and notebook. Pure: it asks and returns events, it never lands.

import type { EntityId } from "../../shared/ids";
import type { PackEvent } from "../../shared/ledger";
import { mindFileWrite, mindPath } from "../../shared/character-engine";
import { blobHash } from "../../shared/stores";
import { isRecord } from "../../shared/json";
import { wsWrite } from "../../engine/workspace";
import { NOTEBOOK_DIR, notebookEvent } from "../../engine/notebook";
import { seedCore } from "../character-agent";
import { answerRead, type ModelPort, type PortMessage } from "../depth/port";
import { DepthAnswerError } from "../depth/common";
import { cutShort } from "../agents/runtime";
import { roomFor } from "./run";

export interface JumpstartRecord {
  id: string;
  level: "volume" | "arc" | "chapter";
  title: string;
  range: [number, number];
  text: string;
}

export interface JumpstartCast {
  id: EntityId;
  name: string;
  /** Whether a core already stands for them: the jumpstart seeds one only where none does. */
  core: boolean;
  /** Their beliefs file as it stands, which the imported outline knowledge is added to. */
  beliefs: string;
  /** Their beliefs file is the user's own edit, which stands: no outline knowledge is written over it. */
  pinned: boolean;
}

export interface JumpstartInput {
  /** The call's system text: Settings → Prompts' "Jumpstart from LumiBooks" (`DEPTH_TEXT.jumpstart`) as the user set it, else as shipped. */
  system: string;
  records: readonly JumpstartRecord[];
  lore: readonly string[];
  cast: readonly JumpstartCast[];
  /** The notebook's files as they stand, by path. */
  notebook: Readonly<Record<string, string>>;
  /** The story minute the writes are made at. */
  at: number;
  /** The last message the records cover: the notebook revision's `through`. */
  through: string | null;
}

export interface JumpstartOut {
  events: PackEvent[];
  blobs: Record<string, string>;
  calls: number;
}

/** The records each author call reads: one call per volume with the arcs and chapters inside it; a book without volumes is one call. */
export function jumpstartGroups(records: readonly JumpstartRecord[]): JumpstartRecord[][] {
  const volumes = records.filter((r) => r.level === "volume");
  if (volumes.length === 0) return records.length > 0 ? [[...records]] : [];
  const inside = (v: JumpstartRecord, r: JumpstartRecord): boolean => r.range[0] >= v.range[0] && r.range[1] <= v.range[1];
  const groups = volumes.map((v) => records.filter((r) => r === v || (r.level !== "volume" && inside(v, r))));
  const loose = records.filter((r) => r.level !== "volume" && !volumes.some((v) => inside(v, r)));
  return loose.length > 0 ? [...groups, loose] : groups;
}

function messagesOf(group: readonly JumpstartRecord[], input: JumpstartInput): PortMessage[] {
  const records = group.map((r) => `### ${r.level}: ${r.title} (messages ${r.range[0] + 1}–${r.range[1] + 1})\n${r.text}`).join("\n\n");
  const lore = input.lore.length > 0 ? input.lore.join("\n\n") : "(none)";
  const cast = input.cast.map((c) => `- ${c.name}${c.core ? "" : " (no core yet)"}${c.beliefs.trim() !== "" ? `\n  holds: ${c.beliefs.trim()}` : ""}`).join("\n");
  const notebook = Object.entries(input.notebook).map(([p, t]) => `### ${p}\n${t}`).join("\n\n") || "(empty)";
  return [
    { role: "system", content: input.system },
    { role: "user", content: `## LumiBooks summaries (evidence only)\n${records}\n\n## Lore\n${lore}\n\n## The cast as LRE holds it\n${cast}\n\n## The notebook\n${notebook}` },
  ];
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * One group's reading: asked at a room sized from what it reads (`roomFor`), read as the other bootstrap
 * answers are (`answerRead`: fences, a stray tail and tool tags around the object are read past). An
 * answer cut off at its room is asked again at twice it; one still cut off, or not an object at all,
 * splits the group in halves, each read beside the same cast and notebook. A single record that still
 * won't read fails the pass with what the model said, so the run pauses and Resume asks again.
 */
async function readGroup(model: ModelPort, group: readonly JumpstartRecord[], input: JumpstartInput, signal: AbortSignal | undefined, asked: { calls: number }): Promise<Record<string, unknown>[]> {
  const messages = messagesOf(group, input);
  const ask = async (maxTokens: number) => {
    asked.calls++;
    return model("author", messages, { json: true, maxTokens, ...(signal ? { signal } : {}) });
  };
  let answer = await ask(roomFor(messages));
  if (cutShort(answer.finish)) answer = await ask(roomFor(messages) * 2);
  const read = cutShort(answer.finish) ? null : answerRead(answer.text);
  if (read) return [read.answer];
  if (group.length > 1) {
    const half = Math.ceil(group.length / 2);
    return [...(await readGroup(model, group.slice(0, half), input, signal, asked)), ...(await readGroup(model, group.slice(half), input, signal, asked))];
  }
  throw new DepthAnswerError("author", answer.text, { ...(answer.finish !== undefined ? { finish: answer.finish } : {}), ...(answer.usage ? { usage: answer.usage } : {}) });
}

/** The jumpstart pass: a few author calls, and what they write, as events for one layer entry. */
export async function jumpstart(model: ModelPort, input: JumpstartInput, signal?: AbortSignal): Promise<JumpstartOut> {
  const byName = new Map(input.cast.map((c) => [c.name.trim().toLowerCase(), c]));
  const cores = new Map<EntityId, string>();
  const knowledge = new Map<EntityId, string[]>();
  const notebook = new Map<string, string[]>();
  const groups = jumpstartGroups(input.records);
  const asked = { calls: 0 };
  for (const group of groups) for (const parsed of await readGroup(model, group, input, signal, asked)) {
    for (const raw of Array.isArray(parsed.cast) ? parsed.cast : []) {
      if (!isRecord(raw)) continue;
      const who = byName.get(text(raw.name).toLowerCase());
      if (!who) continue;
      const core = text(raw.core);
      if (!who.core && core !== "" && !cores.has(who.id)) cores.set(who.id, core);
      const lines = [text(raw.knows) !== "" ? `Knows: ${text(raw.knows)}` : "", text(raw.doesntKnow) !== "" ? `Doesn't know: ${text(raw.doesntKnow)}` : ""].filter((l) => l !== "");
      if (lines.length > 0) knowledge.set(who.id, [...(knowledge.get(who.id) ?? []), ...lines]);
    }
    for (const raw of Array.isArray(parsed.notebook) ? parsed.notebook : []) {
      if (!isRecord(raw)) continue;
      const path = text(raw.path);
      const body = text(raw.text);
      if (!path.startsWith(NOTEBOOK_DIR) || path.length === NOTEBOOK_DIR.length || path.includes("..") || body === "") continue;
      notebook.set(path, [...(notebook.get(path) ?? []), body]);
    }
  }
  const events: PackEvent[] = [];
  const blobs: Record<string, string> = {};
  const add = (out: { events: PackEvent[]; blobs: Record<string, string> }): void => {
    events.push(...out.events);
    Object.assign(blobs, out.blobs);
  };
  for (const [who, core] of cores) add(seedCore({ who, at: input.at, source: "entry", text: core }));
  for (const [who, lines] of knowledge) {
    const mind = input.cast.find((c) => c.id === who);
    if (!mind || mind.pinned) continue;
    const had = mind.beliefs.trim();
    const body = `${had !== "" ? `${had}\n\n` : ""}## Imported from LumiBooks (for review)\n${lines.join("\n")}`;
    // Written as a catch-up from the records (only a core is seeded), marked imported and for review.
    add(mindFileWrite({ who, path: mindPath(who, "beliefs"), at: input.at, mode: "catch-up", lived: [], about: [], source: "entry", review: true }, body));
  }
  // Notebook edits, never rewrites: each file keeps what it held, the seed added at its end, with the revision's bookkeeping beside them so the files stand as the author's, not the player's.
  const files: Record<string, string> = {};
  for (const [path, adds] of notebook) {
    const had = input.notebook[path]?.trim() ?? "";
    const body = [had, ...adds].filter((t) => t !== "").join("\n\n");
    const hash = blobHash(body);
    blobs[hash] = body;
    files[path] = hash;
    events.push(wsWrite(path, hash));
  }
  if (Object.keys(files).length > 0) events.push(notebookEvent({ kind: "light", files, through: input.through, reason: "Seeded from the chat's LumiBooks records, which are evidence only." }));
  return { events, blobs, calls: asked.calls };
}
