// What the author's, the GM's and the historian's stages share (DEPTH-PLAN §5): their texts as
// blobs, the beats as a role reads them, and how a stage asks its model. A stage never lands what it
// makes: it returns its events and the blobs they name, and its caller puts the blobs and lands the
// events (the bootstrap, a depth turn), so a test answers the model with recorded text.

import { renderPrompt } from "../prompts";
import type { PromptTexts } from "../../shared/prompts";
import { blobHash } from "../../shared/stores";
import { exposureChannels, type Beat, type Staging } from "../../shared/story";
import type { WorldDoc } from "../../shared/world";
import type { WorldState } from "../../engine/state";
import { calendarOf, formatClock } from "../../engine/calendar";
import { own } from "../../engine/pack-kit";
import type { DepthRole } from "../../shared/depth-settings";
import type { EntityId } from "../../shared/ids";
import { povOf } from "../../shared/character-engine";
import { cutShort } from "../agents/runtime";
import { answerRead, type ModelPort, type PortAnswer, type PortUsage } from "./port";
import { MISREAD_SAID_CHARS, PAST_ANSWER, WHOLE_ANSWER, type Misread } from "../../shared/misread";

/** A beat with its texts, as the stages read and make them (the beat holds only their hashes). */
export interface BeatText {
  beat: Beat;
  what: string;
  surface: string;
  quotes?: string;
}

/** A staging with its texts. */
export interface StagingText {
  staging: Staging;
  where: string;
  doing: string;
  occluded?: string;
}

/** The texts a stage made, by hash: its caller puts each before it lands the events that name them. */
export type Blobs = Record<string, string>;

/** Words a model answered: one string, or a list of strings (as DeepSeek writes quotes), joined in order with a space; trimmed, "" when none. */
export function spoken(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (!Array.isArray(v)) return "";
  return v.flatMap((s) => (typeof s === "string" && s.trim() !== "" ? [s.trim()] : [])).join(" ");
}

/** Whether a model left a field empty (missing, null, blank, an empty list or object): never a misread. */
function blank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === "object" && Object.keys(v).length === 0;
}

/** What a field held, as JSON, cut at `MISREAD_SAID_CHARS`. */
function saidOf(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > MISREAD_SAID_CHARS ? `${s.slice(0, MISREAD_SAID_CHARS - 1)}…` : s;
}

/**
 * One model answer as its stage reads it, field by field (the shared parser): each read takes a field
 * in the shapes models write it and tells the call's keeper (`PortAnswer.misread`) of every field it
 * couldn't keep as written, by its path in the answer, so the answer's raw text is kept beside those
 * fields and only then (the raw-against-saved audit). Reading a name as the id of the one person it
 * names, an id in brackets as the id, a list of words joined, is reading it as written; a value the
 * model left empty is never misread.
 */
export class Reading {
  /** The fields it didn't keep as written, in order. */
  readonly misread: Misread[] = [];

  constructor(private readonly reply: Pick<PortAnswer, "misread"> = {}) {}

  /** `field` held `v`, which isn't kept (`why`, where the stage says). */
  drop(field: string, v: unknown, why?: string): void {
    if (!blank(v)) this.tell({ field, said: saidOf(v), ...(why !== undefined ? { why } : {}) });
  }

  /** `field` held `v`, kept as `as` (`why`, where the stage says). */
  change(field: string, v: unknown, as: unknown, why?: string): void {
    if (!blank(v)) this.tell({ field, said: saidOf(v), as: saidOf(as), ...(why !== undefined ? { why } : {}) });
  }

  /** The whole answer, `text`, couldn't be read (`why`): told even when it said nothing, so its keeper keeps it. */
  unread(text: string, why: string): void {
    this.tell({ field: WHOLE_ANSWER, said: saidOf(text), why });
  }

  private tell(m: Misread): void {
    this.misread.push(m);
    this.reply.misread?.([m]);
  }

  /** A text, trimmed; "" when it held none, or held something else (dropped). */
  text(field: string, v: unknown): string {
    if (typeof v === "string") return v.trim();
    this.drop(field, v);
    return "";
  }

  /** Words (`spoken`): one string, or a list of strings joined in order; an item that isn't words is dropped. */
  words(field: string, v: unknown): string {
    if (Array.isArray(v)) for (const [i, s] of v.entries()) if (typeof s !== "string") this.drop(`${field}[${i}]`, s);
    if (typeof v !== "string" && !Array.isArray(v)) this.drop(field, v);
    return spoken(v);
  }

  /** A list; empty when it held none, or held something else (dropped). */
  list(field: string, v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    this.drop(field, v);
    return [];
  }

  /** An object; null when it held none, or held something else (dropped). */
  record(field: string, v: unknown): Record<string, unknown> | null {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    this.drop(field, v);
    return null;
  }

  /** The texts of a list, trimmed, blanks left out; an item that isn't a text is dropped. */
  texts(field: string, v: unknown): string[] {
    return this.list(field, v).flatMap((x, i) => {
      const t = this.text(`${field}[${i}]`, x);
      return t !== "" ? [t] : [];
    });
  }

  /** One of `values`, as written; `fallback` when it held none, or held something else (changed). */
  pick<T extends string>(field: string, v: unknown, values: readonly T[], fallback: T): T {
    if (typeof v === "string" && (values as readonly string[]).includes(v)) return v as T;
    if (!blank(v)) this.change(field, v, fallback);
    return fallback;
  }

  /** A finite number; null when it held none, or held something else (dropped). */
  number(field: string, v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    this.drop(field, v);
    return null;
  }

  /** true or false; false when it held none, or held something else (changed). */
  flag(field: string, v: unknown): boolean {
    if (typeof v === "boolean") return v;
    if (!blank(v)) this.change(field, v, false);
    return false;
  }
}

/** Keeps `text` among `blobs` and gives its hash. */
export function putText(blobs: Blobs, text: string): string {
  const hash = blobHash(text);
  blobs[hash] = text;
  return hash;
}

/** What every stage gives back besides its own parts: the model's reasoning and what the call cost. */
export interface StageCost {
  reasoning?: string;
  usage?: PortUsage;
}

/**
 * The answer's own account of its choice, trimmed: its "why", or, in an answer recorded before the
 * texts asked for "why", its "reasoning"; "" when it gave neither. A text whose "why" is something of
 * its own (an edit's meaning, a draft's reading) reads it there and only "reasoning" as the account.
 */
export function answerWhy(answer: Record<string, unknown>): string {
  for (const v of [answer.why, answer.reasoning]) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return "";
}

/** What a failed answer cost and how it ended, as its error says it. */
function answerFailure(role: DepthRole, answer: string, reply: Pick<PortAnswer, "finish" | "usage">): string {
  const cut = cutShort(reply.finish);
  const u = reply.usage;
  const spent = u ? `${u.tokensOut.toLocaleString("en-US")} tokens out${u.reasoningOut !== undefined ? `, ${u.reasoningOut.toLocaleString("en-US")} of them reasoning` : ""}; ` : "";
  return `the ${role}'s answer ${cut ? "was cut off at its answer room" : "wasn't the JSON object it was asked for"} (${spent}its text ${cut ? "stopped after" : "ran to"} ${answer.length.toLocaleString("en-US")} characters)`;
}

/**
 * A model's answer as its stage reads it: the JSON object it holds (`answerRead`), with the
 * `Reading` its fields are read through. Null where it holds none: the call's keeper is told the
 * whole answer couldn't be read and why (cut off at its room, or not JSON), so the answer is kept as
 * written, as any misread answer is; the stage fails or goes without it, as its own rule says. What
 * an answer wrote past its object's end (LIVE3 lane 1b: a stray `}`, a tool tag, a `</br>`) is read
 * without, its keeper told (`PAST_ANSWER`).
 */
export function readAnswer(role: DepthRole, reply: Pick<PortAnswer, "text" | "finish" | "usage" | "misread">): { answer: Record<string, unknown> | null; read: Reading } {
  const read = new Reading(reply);
  const got = answerRead(reply.text);
  if (!got) read.unread(reply.text, answerFailure(role, reply.text, reply));
  else if (got.past !== "") read.drop(PAST_ANSWER, got.past, `the ${role}'s answer wrote on past its JSON object's end: the object was read without it`);
  return { answer: got?.answer ?? null, read };
}

/** A model answer that wasn't the JSON object its text asks for, or was cut off at its answer room: the stage fails, closed, and its caller may run it again. */
export class DepthAnswerError extends Error {
  /** The provider ended the answer at its room (`cutShort`): it stopped mid-answer. */
  readonly cut: boolean;
  constructor(
    readonly role: DepthRole,
    readonly answer: string,
    /** How the call ended and what it cost; `capped`: its room was already held to what its model takes. */
    readonly reply: Pick<PortAnswer, "finish" | "usage" | "capped"> = {},
  ) {
    super(answerFailure(role, answer, reply));
    this.cut = cutShort(reply.finish);
    this.name = "DepthAnswerError";
  }
}

/** A role's answer as `askRole` gives it: the JSON object, the `Reading` its stage reads it through, the reasoning and what the call cost. */
export interface Asked extends StageCost {
  answer: Record<string, unknown>;
  read: Reading;
}

/**
 * Asks `role` with its editable system text (`id`, the user's wording or the shipped one, `world`
 * and `pov` filled: the player character in force, D-10, unless the caller names him) and the data it
 * reads, for one JSON object, with the `Reading` its stage reads it through; an answer that holds none
 * fails (`DepthAnswerError`), its keeper told (`readAnswer`).
 */
export async function askRole(model: ModelPort, role: DepthRole, id: string, input: { world: WorldDoc; state: Readonly<WorldState>; texts: PromptTexts; data: string; pov?: EntityId; maxTokens?: number; signal?: AbortSignal }): Promise<Asked> {
  const pov = input.pov ?? povOf(input.world, input.state);
  const system = renderPrompt(id, input.texts, { world: input.world.name, pov: own(input.state.entities, pov)?.name ?? pov });
  const reply = await model(role, [{ role: "system", content: system }, { role: "user", content: input.data }], { json: true, ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}), ...(input.signal ? { signal: input.signal } : {}) });
  const { answer, read } = readAnswer(role, reply);
  if (!answer) throw new DepthAnswerError(role, reply.text, reply);
  return { answer, read, ...(reply.reasoning ? { reasoning: reply.reasoning } : {}), ...(reply.usage ? { usage: reply.usage } : {}) };
}

/** An id as a model may write one back: bare, in brackets (`[mira]`), or spelled out (`id: mira`). */
export function bareId(v: string): string {
  return v.trim().replace(/^\[([^[\]]+)\]$/, "$1").replace(/^id:\s*/i, "").trim();
}

/**
 * A name as an answer may write it, for looking it up: case aside, and spelled as an id (`jordan_ellis`,
 * `jordan-ellis`) read as the words it spells, as a model that writes ids from names does. Every stage
 * reads a person or a place an answer names by it (`sameName`, `personNamed`, `placeNamed`).
 */
export const nameKey = (name: string): string => name.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/** Whether `said` writes `name` (`nameKey`); a blank names nothing. */
export function sameName(said: string, name: string): boolean {
  const key = nameKey(said);
  return key !== "" && key === nameKey(name);
}

/** A person's, place's or thing's name for a role's data, with its id spelled out, as the role must name it back: `Mira (id: mira)`. */
export function named(world: WorldDoc, state: Readonly<WorldState>, id: string): string {
  const name = own(state.entities, id)?.name ?? own(world.places, id)?.name;
  return name && name !== id ? `${name} (id: ${id})` : `id: ${id}`;
}

/**
 * The one person a name in a model's answer names, when it names exactly one: their id, their full
 * name, or a first name no one else in the world has, each as an answer may write it (`nameKey`);
 * null otherwise. Bookkeeping for an answer that wrote a name where it was asked for an id; who did
 * what stays the model's reading.
 */
export function personNamed(state: Readonly<WorldState>, name: string): string | null {
  const t = bareId(name);
  if (t === "") return null;
  if (own(state.entities, t)) return t;
  const entries = Object.entries(state.entities).filter(([, e]) => typeof e.name === "string" && e.name.trim() !== "");
  const whole = entries.filter(([, e]) => sameName(t, e.name));
  if (whole.length === 1) return whole[0]?.[0] ?? null;
  const first = entries.filter(([, e]) => sameName(t, e.name.trim().split(/\s+/)[0] ?? ""));
  return whole.length === 0 && first.length === 1 ? (first[0]?.[0] ?? null) : null;
}

/** The one place a name in a model's answer names: its id, else the one place by that name as an answer may write it (`nameKey`); null otherwise. */
export function placeNamed(world: WorldDoc, name: string): string | null {
  const t = bareId(name);
  if (t === "") return null;
  if (own(world.places, t)) return t;
  const hits = Object.entries(world.places).filter(([, p]) => sameName(t, p.name));
  return hits.length === 1 ? (hits[0]?.[0] ?? null) : null;
}

/** A beat as the author, the GM and the historian read it: when, where, who, what happened and who perceived it, by every way it reached them. */
export function beatLine(world: WorldDoc, state: Readonly<WorldState>, b: BeatText): string {
  const { beat } = b;
  const exposure = beat.exposure.map((x) => `${named(world, state, x.who)} by ${exposureChannels(x).join(" and ")}${x.reach === "partial" ? ", in part" : ""}`).join("; ");
  const quotes = b.quotes ? ` Words: “${b.quotes}”` : "";
  return `- [${beat.id}] ${formatClock(calendarOf(world), beat.at)}${beat.approx ? " (approx.)" : ""}, ${named(world, state, beat.place)}; ${beat.act} by ${beat.actors.map((a) => named(world, state, a)).join(", ") || "no one"}: ${b.what}${quotes} Perceived by: ${exposure || "no one"}.`;
}

/** A stage asked again once when its answer can't be read (as the turn's stages are); a second failure is the caller's. */
export async function twice<T>(ask: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  try {
    return await ask();
  } catch (error) {
    if (!(error instanceof DepthAnswerError) || signal?.aborted) throw error;
    return ask();
  }
}

/** Beats with their texts, from the user's blobs, as the author reads them; a text the blobs lack reads empty. */
export async function beatTexts(rt: { readonly blobs: { get(userId: string, hash: string): Promise<string | null> } }, userId: string, beats: readonly Beat[]): Promise<BeatText[]> {
  const out: BeatText[] = [];
  for (const beat of beats) {
    const quotes = beat.quotes !== undefined ? await rt.blobs.get(userId, beat.quotes) : null;
    out.push({ beat, what: (await rt.blobs.get(userId, beat.what)) ?? "", surface: (await rt.blobs.get(userId, beat.surface)) ?? "", ...(quotes !== null ? { quotes } : {}) });
  }
  return out;
}
