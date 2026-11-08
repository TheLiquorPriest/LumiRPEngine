// The import (DEPTH-PLAN §8.1 steps 2 and 5): what the chat kept before depth, read once per run, and
// the GM's reconciliation of it at each chapter's end. The world's own lore (the world document's
// entries, where a starter keeps all of its own) and World Info stay the user's lore and keep doing
// their job; they are read here only so a character with no card can have its core seeded from what
// the world says of it (D-17). The memory entries (Lumibooks' books, core's summary, Memory Cortex,
// and on a chat that had LRE's minds, their notes, commitments, plans, summaries and holdings) are
// evidence the history is reconciled against: none enters a mind. An entry that agrees cites the
// beats; one recording an event the history no longer holds becomes beats sourced from it, marked for
// review; one that contradicts the beats goes to the spot checks, and the user decides.

import type { ChatId, EntityId, UserId } from "../../shared/ids";
import { loreIsSecret, loreSourceOf } from "../../shared/lore";
import { publicText } from "../../shared/secret-marks";
import type { PackEvent } from "../../shared/ledger";
import { isRecord } from "../../shared/json";
import type { JsonObject } from "../../shared/json";
import type { Basis } from "../../shared/layer";
import type { Beat } from "../../shared/story";
import { STORY_BEAT } from "../../shared/story";
import type { ImportSource, ImportView } from "../../shared/bootstrap";
import type { PromptTexts } from "../../shared/prompts";
import { BOOTSTRAP_TEXT } from "../../shared/bootstrap-prompts";
import { hashParts } from "../../shared/hash";
import type { WorldDoc } from "../../shared/world";
import type { HostPort } from "../host";
import { loreBookIds } from "../book-lore";
import { renderPrompt } from "../prompts";
import type { ModelPort } from "../depth/port";
import { bareId, DepthAnswerError, personNamed, putText, readAnswer, sameName, spoken } from "../depth/common";
import type { WorldState } from "../../engine/state";
import type { Person, ReconcileOut } from "./run";

/** One entry the import read. */
export interface ImportedEntry {
  /** Stable across runs: its source and the source's own id. */
  id: string;
  source: ImportSource;
  /** Lore the user keeps (World Info), or memory to reconcile. */
  role: "lore" | "memory";
  title: string;
  text: string;
  /** Whom it is about, by name, where the source says. */
  about: string[];
  /** Whom it is about, by id: the people a world lore entry links. */
  links?: EntityId[];
  /** The messages it covers, by index on the path, where the source says. */
  span?: [number, number];
  /** Its text's digest: a changed entry is reconciled again. */
  digest: string;
}

/** The host's Memory Cortex, read with the `memories` permission (absent where it isn't granted). */
export type CortexReader = NonNullable<HostPort["memories"]>;

export interface ImportDeps {
  host: Pick<HostPort, "books" | "chats" | "memories">;
  world: WorldDoc;
  /** The chat's folded state at the head, for LRE's earlier minds; null when it can't be read. */
  minds: Readonly<Record<string, unknown>> | null;
  /** The world's people, to name the earlier minds by. */
  names: ReadonlyMap<EntityId, string>;
}

/** Entries longer than this are cut for the reconciliation (the whole stays the user's). */
const ENTRY_CHARS = 6000;

function entry(source: ImportSource, sourceId: string, role: ImportedEntry["role"], title: string, text: string, about: string[] = [], span?: [number, number], links?: EntityId[]): ImportedEntry {
  const body = text.trim();
  return { id: `${source}:${sourceId}`, source, role, title: title.trim() || "(untitled)", text: body.length > ENTRY_CHARS ? `${body.slice(0, ENTRY_CHARS)}…` : body, about, ...(links && links.length > 0 ? { links } : {}), ...(span ? { span } : {}), digest: hashParts("bootstrap.entry", body) };
}

/**
 * Whether a book is LumiBooks' (`lumi_books`): it marks its chapters-and-arcs book with the chat it
 * keeps (`lumibooks_chat_id`) and its codex with `lumibooks_codex_chat_id`, and the chat names them
 * (`lumibooks_book_id`, `lumibooks_codex_book_id`). `forThis`: the book is this chat's.
 */
function lumibooksOf(book: { id: string; metadata: JsonObject }, chatId: ChatId, chat: JsonObject): { lumibooks: boolean; forThis: boolean } {
  const marks = [book.metadata.lumibooks_chat_id, book.metadata.lumibooks_codex_chat_id].filter((v): v is string => typeof v === "string" && v !== "");
  const named = book.id === chat.lumibooks_book_id || book.id === chat.lumibooks_codex_book_id;
  return { lumibooks: marks.length > 0 || named, forThis: named || marks.includes(chatId) };
}

/**
 * Reads what the chat kept before depth, per source; a source it can't read says why, in plain words,
 * and the run goes on without it.
 */
export async function readImports(deps: ImportDeps, chatId: ChatId, userId: UserId): Promise<{ entries: ImportedEntry[]; views: ImportView[] }> {
  const entries: ImportedEntry[] = [];
  const views: ImportView[] = [];
  const count = (source: ImportSource, unreadable: string | null): void => void views.push({ source, entries: entries.filter((e) => e.source === source).length, unreadable });

  // The world's own lore: the world document's entries (a starter's are all here, in no book), what anyone may read of each. A
  // secret, an entry hidden from every helper, and an earlier build's copy of a book entry (its book is read below) are left out.
  for (const [id, l] of Object.entries(deps.world.lore)) {
    if (loreSourceOf(l.source).kind === "book" || loreIsSecret(l) || (l.visibility !== undefined && l.visibility !== "public" && l.visibility !== "known_by")) continue;
    const text = publicText(l.content);
    if (text.trim() === "") continue;
    const people = l.links.filter((link) => deps.names.has(link));
    entries.push(entry("world_lore", id, "lore", l.title, text, [...people.map((p) => deps.names.get(p) ?? p), ...(l.aliases ?? [])].slice(0, 6), undefined, people));
  }
  count("world_lore", null);

  // World Info and LumiBooks: the chat's books, its character's and the global ones, never the engine's own, and LumiBooks' books
  // for this chat wherever they are (it needn't attach them). A LumiBooks book is memory, never lore.
  let marked = false;
  try {
    const { read } = await loreBookIds(deps.host, deps.world, chatId, userId, "auto");
    const chat = await deps.host.chats.chatMetadata(chatId, userId);
    const all = await deps.host.books.list(userId);
    const books = new Map(all.map((b) => [b.id, b]));
    marked = typeof chat.lumibooks_book_id === "string" || typeof chat.lumibooks_codex_book_id === "string" || all.some((b) => lumibooksOf(b, chatId, chat).forThis);
    for (const id of new Set([...read, ...all.filter((b) => lumibooksOf(b, chatId, chat).forThis).map((b) => b.id)])) {
      const book = books.get(id);
      if (!book) continue;
      const list = (await deps.host.books.entries(id, userId)).filter((e) => !e.disabled && e.content.trim() !== "");
      const memory = lumibooksOf(book, chatId, chat).lumibooks;
      for (const e of list) entries.push(entry(memory ? "lumibooks" : "world_info", e.id, memory ? "memory" : "lore", e.comment || e.keys.join(", "), e.content, e.keys.slice(0, 4)));
    }
    count("world_info", null);
    count("lumibooks", null);
  } catch (error) {
    const why = `couldn't read the chat's World Info books (${error instanceof Error ? error.message : String(error)})`;
    count("world_info", why);
    count("lumibooks", why);
  }
  // The chat uses LumiBooks when it is marked so, whatever could be read of it (D-18's advice follows the mark).
  const lumi = views.find((v) => v.source === "lumibooks");
  if (lumi && marked) lumi.marked = true;

  // Core's summary of the chat (the Summary panel's Loom summary).
  try {
    const meta = await deps.host.chats.chatMetadata(chatId, userId);
    const summary = typeof meta.loom_summary === "string" ? meta.loom_summary : "";
    if (summary.trim() !== "") entries.push(entry("summary", chatId, "memory", "The chat's summary", summary));
    count("summary", null);
  } catch (error) {
    count("summary", `couldn't read the chat's summary (${error instanceof Error ? error.message : String(error)})`);
  }

  // Memory Cortex: its entities' facts and its arcs, with the `memories` permission.
  const cortex = deps.host.memories;
  if (!cortex || !cortex.granted()) count("cortex", "Memory Cortex needs the Memories permission for LumiRPEngine (Extensions → LumiRPEngine → Permissions).");
  else {
    try {
      for (const e of await cortex.entities(chatId, userId)) {
        const facts = e.facts.filter((f) => f.trim() !== "");
        if (facts.length === 0 && e.description.trim() === "") continue;
        entries.push(entry("cortex", `entity:${e.id}`, "memory", e.name, [e.description, ...facts.map((f) => `- ${f}`)].filter((s) => s.trim() !== "").join("\n"), [e.name, ...e.aliases].slice(0, 6)));
      }
      for (const c of await cortex.consolidations(chatId, userId)) {
        if (c.summary.trim() === "") continue;
        const span: [number, number] | undefined = c.messageRangeStart !== null && c.messageRangeEnd !== null ? [c.messageRangeStart, c.messageRangeEnd] : undefined;
        entries.push(entry("cortex", `arc:${c.id}`, "memory", c.title ?? `Arc (tier ${c.tier})`, c.summary, [], span));
      }
      count("cortex", null);
    } catch (error) {
      count("cortex", `couldn't read Memory Cortex (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  // LRE's earlier minds on this chat: each character's notes, commitments, plans and summary, and what it held of the chat's facts.
  const chars = deps.minds && isRecord(deps.minds.chars) ? deps.minds.chars : {};
  const knowledge = deps.minds && isRecord(deps.minds.knowledge) ? deps.minds.knowledge : {};
  const facts = isRecord(knowledge.facts) ? knowledge.facts : {};
  const holdings = isRecord(knowledge.holdings) ? knowledge.holdings : {};
  for (const id of new Set([...Object.keys(chars), ...Object.keys(holdings)])) {
    const raw = isRecord(chars[id]) ? chars[id] : {};
    const held = isRecord(holdings[id]) ? holdings[id] : {};
    const name = deps.names.get(id) ?? id;
    const lines = [
      ...(typeof raw.summary === "string" && raw.summary.trim() !== "" ? [`Summary: ${raw.summary.trim()}`] : []),
      ...(Array.isArray(raw.notes) ? raw.notes.flatMap((n) => (isRecord(n) && typeof n.text === "string" ? [`Note: ${n.text}`] : [])) : []),
      ...(Array.isArray(raw.commitments) ? raw.commitments.flatMap((c) => (isRecord(c) && typeof c.text === "string" ? [`Commitment: ${c.text}`] : [])) : []),
      ...(Array.isArray(raw.plans) ? raw.plans.flatMap((p) => (isRecord(p) && typeof p.what === "string" ? [`Plan: ${p.what}`] : [])) : []),
      ...Object.entries(held).flatMap(([fact, h]) => {
        const f = facts[fact];
        if (!isRecord(h) || !isRecord(f) || typeof f.claim !== "string") return [];
        return [`Held: ${f.claim} (takes it as ${typeof h.belief === "string" ? h.belief : "uncertain"}${typeof h.confidence === "number" ? `, ${Math.round(h.confidence * 100)}% sure` : ""}${typeof h.how === "string" ? `, ${h.how}` : ""})`];
      }),
    ];
    if (lines.length > 0) entries.push(entry("lre_minds", id, "memory", `${name}'s earlier mind`, lines.join("\n"), [name]));
  }
  count("lre_minds", null);
  return { entries, views };
}

/** The imported entries about a person, by id where the entry links them, else by name or key, as an answer may write a name (`sameName`): lore first, the world's own before World Info. */
export function entriesAbout(entries: readonly ImportedEntry[], who: Person): ImportedEntry[] {
  const hits = entries.filter((e) => e.links?.includes(who.id) || e.about.some((a) => sameName(a, who.name)) || sameName(e.title, who.name));
  return [...hits.filter((e) => e.role === "lore"), ...hits.filter((e) => e.role === "memory")];
}

// ---------------------------------------------------------------- the GM's reconciliation

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export interface ReconcileInput {
  chatId: ChatId;
  chapter: number;
  /** The history ends with this chapter: any entry not yet placed may become beats. */
  final: boolean;
  /** The chapter's messages, by index on the path. */
  span: [number, number];
  entries: readonly ImportedEntry[];
  beats: readonly Beat[];
  blobs: Readonly<Record<string, string>>;
  minds: readonly Person[];
  /** The world as the chapter's basis folds it, to name anyone the story has met (`personNamed`), not only those with a mind; absent, the minded only. */
  state?: Readonly<WorldState>;
  basis: Basis;
  /** The chapter's clock where the ledger has one: an event the history lost is dated there, approximately. */
  at: number;
  texts: PromptTexts;
  signal?: AbortSignal;
}

/**
 * The GM's reconciliation of the memory entries that speak to a chapter: those whose span meets it,
 * and those with none. Events the history lost land as beats sourced from their entry (`by.entry`),
 * marked for review and pending for whoever knew of them.
 */
export async function reconcile(model: ModelPort, i: ReconcileInput): Promise<ReconcileOut> {
  const memory = i.entries.filter((e) => e.role === "memory" && (!e.span || (e.span[0] <= i.span[1] && e.span[1] >= i.span[0])));
  if (memory.length === 0) return { events: [], blobs: {}, agree: [], recorded: [], contradictions: [] };
  const ids = new Set(memory.map((e) => e.id));
  const people = new Set(i.minds.map((p) => p.id));
  const beatIds = new Set(i.beats.map((b) => b.id));
  // A person as the answer names them: a character's id, else the one character by that name as an answer may write it (`sameName`), else anyone the story has met by that name or id (`personNamed`); anyone else as written.
  const personOf = (said: string): string => {
    const t = bareId(said);
    if (people.has(t)) return t;
    const named = i.minds.filter((p) => sameName(t, p.name));
    if (named.length === 1) return named[0]?.id ?? t;
    return (i.state ? personNamed(i.state, t) : null) ?? t;
  };
  const lines = i.beats.map((b) => `- ${b.id} (${b.act}; ${b.actors.join(", ") || "no one"}${b.place ? ` at ${b.place}` : ""}): ${i.blobs[b.what] ?? ""}${b.quotes && i.blobs[b.quotes] ? ` "${i.blobs[b.quotes]}"` : ""}`);
  const recordable = i.final ? "at the history's end, any entry may, if no chapter holds its event." : "in this chapter, only an entry whose span lies inside it may; leave the rest for later chapters.";
  const system = `${renderPrompt(BOOTSTRAP_TEXT.reconcile, i.texts, { chapter: String(i.chapter + 1), recordable })}\n\n${renderPrompt(BOOTSTRAP_TEXT.reconcileAnswer, i.texts, {})}`;
  const user = [
    `Chapter ${i.chapter + 1}, messages ${i.span[0] + 1}–${i.span[1] + 1}.`,
    `Characters: ${i.minds.map((p) => `${p.name} (${p.id})`).join(", ") || "none yet"}.`,
    `Beats:\n${lines.join("\n") || "(none)"}`,
    `Entries:\n${memory.map((e) => `## ${e.id} [${e.source}] ${e.title}${e.span ? ` (messages ${e.span[0] + 1}–${e.span[1] + 1})` : ""}\n${e.text}`).join("\n\n")}`,
  ].join("\n\n");
  const answer = await model("gm", [{ role: "system", content: system }, { role: "user", content: user }], { json: true, ...(i.signal ? { signal: i.signal } : {}) });
  const o = readAnswer("gm", answer).answer;
  if (!o) throw new DepthAnswerError("gm", answer.text, answer);
  const agree = (Array.isArray(o.agree) ? o.agree : []).flatMap((a) => (isRecord(a) && ids.has(text(a.entry)) ? [{ entry: text(a.entry), beats: strings(a.beats).filter((b) => beatIds.has(b)) }] : []));
  const contradictions = (Array.isArray(o.contradictions) ? o.contradictions : []).flatMap((c) => (isRecord(c) && ids.has(text(c.entry)) && text(c.why) !== "" ? [{ entry: text(c.entry), against: text(c.against), why: text(c.why) }] : []));
  const blobs: Record<string, string> = {};
  const events: PackEvent[] = [];
  const recorded: ReconcileOut["recorded"] = [];
  for (const r of Array.isArray(o.recorded) ? o.recorded : []) {
    if (!isRecord(r) || !ids.has(text(r.entry))) continue;
    const from = text(r.entry);
    const made: string[] = [];
    for (const [k, b] of (Array.isArray(r.beats) ? r.beats : []).entries()) {
      if (!isRecord(b) || text(b.what) === "") continue;
      const id = `bse_${hashParts("bootstrap.entry.beat", i.chatId, from, k, text(b.what)).slice(0, 12)}`;
      const quotes = spoken(b.quotes);
      const actors = [...new Set(strings(b.actors).map(personOf))];
      const when = text(b.when);
      const beat: Beat = {
        id,
        at: i.at,
        approx: true,
        order: k,
        place: text(b.place),
        actors,
        act: quotes !== "" ? "said" : "did",
        about: actors.map((entity) => ({ entity })),
        what: putText(blobs, text(b.what)),
        surface: putText(blobs, text(b.surface) || text(b.what)),
        ...(quotes !== "" ? { quotes: putText(blobs, quotes) } : {}),
        exposure: [...new Set(strings(b.knew).map(personOf))].map((who) => ({ who, channel: "record" as const, reach: "whole" as const, ...(people.has(who) ? { pending: true as const } : {}) })),
        by: { entry: from },
        uncertain: putText(blobs, `From an imported entry (${from}), not the history${when ? `; it says: ${when}` : ""}. Review it.`),
      };
      events.push({ type: STORY_BEAT, data: JSON.parse(JSON.stringify(beat)) as JsonObject });
      made.push(id);
    }
    if (made.length > 0) recorded.push({ entry: from, beats: made });
  }
  // Each decision readable beside what it landed: which entry agreed with which beats, which became beats, which contradicts, with the GM's why where it gave one.
  const whyOf = (entry: string, key: "agree" | "recorded"): string => {
    const found = (Array.isArray(o[key]) ? o[key] : []).find((x: unknown) => isRecord(x) && text(x.entry) === entry);
    return isRecord(found) && text(found.why) !== "" ? `: ${text(found.why)}` : ".";
  };
  const account = [
    ...agree.map((a) => `${a.entry} agrees with ${a.beats.join(", ") || "the chapter"}${whyOf(a.entry, "agree")}`),
    ...recorded.map((r) => `${r.entry} records what the history no longer holds, now ${r.beats.join(", ")}${whyOf(r.entry, "recorded")}`),
    ...contradictions.map((c) => `${c.entry} contradicts ${c.against || "the chapter"}: ${c.why}`),
  ].join("\n");
  const reasoning = [answer.reasoning ?? "", account].filter((s) => s !== "").join("\n\n");
  return { events, blobs, agree, recorded, contradictions, ...(reasoning !== "" ? { reasoning } : {}) };
}
