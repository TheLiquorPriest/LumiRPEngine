// Where a recorded value comes from, how exact it is and how it stands (plan §6.6, §10.5). Every
// operation that makes a named thing or sets a value can carry them. One that names no source is
// applied and marked `unsourced`; an invention names its gap check and its consent where it has
// them, and is applied and marked so where it does not. Code checks none of it against the story.

import type { AgentRef, JsonObject, JsonValue } from "rp-harness/contract";
import { type ChangeInput, PRECISIONS, SOURCES, STANDINGS, type Precision, type Source, type Standing } from "../store/types";
import { TEXT } from "./kit";

/** What an agent may name as a source: every kind the store keeps but an import, which only a migration writes. */
export const SOURCE_KINDS = SOURCES.filter((s) => s !== "import");

/** The marks a write's answer can carry, which a rule's condition can name (`marked unsourced`). */
export const MARKS = Object.freeze({
  unsourced: "unsourced",
  invented: "invented",
  noGapCheck: "no-gap-check",
  noConsent: "no-consent",
});

/**
 * The schema of the three arguments every writing operation takes. It holds back nothing the code
 * reads: a source is its kind alone ("prose") or an object with its kind and what it cites, and a
 * precision or a standing is text. A value that is none of the choices is answered in the answers'
 * words, with the choices (`provenanceOf`), never refused before the code reads it.
 */
export const PROVENANCE_PROPERTIES: Record<string, JsonObject> = {
  source: { anyOf: [TEXT, { type: "object", properties: { from: TEXT, lore: TEXT, message: TEXT, roll: TEXT, gap_check: TEXT, consent: TEXT } }] },
  precision: TEXT,
  standing: TEXT,
};

/** A source as the call gave it: its kind and what it cites. */
export interface Cited {
  from: Source;
  lore?: string;
  message?: string;
  roll?: string;
  gapCheck?: string;
  consent?: string;
}

/** An operation's provenance as read: what the store keeps on each of its changes, and the marks its answer carries. */
export interface Provenance {
  source: Cited | null;
  precision: Precision | null;
  standing: Standing | null;
  marks: string[];
  /** How an invention's consent stands: cited, given by the run's lead's own write with its gap check, or none. */
  consent?: "cited" | "own-write" | "none";
}

/**
 * The provenance of what the engine fills in from the world itself (an account's authored opening, a
 * value drawn from the world's tables): no call said it, so it never carries a call's provenance. It
 * comes from the world's defaults and stands as assumed (plan §6.6), so the world state counts it
 * among what is not settled.
 */
export const FILLED_IN: Provenance = { source: { from: "default" }, precision: null, standing: "assumed", marks: [] };

/** Why provenance could not be read: which argument, and what it may be. */
export interface Unreadable {
  field: string;
  value: JsonValue;
  choices: readonly string[];
}

const text = (v: JsonValue | undefined): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** Reads `source`, `precision` and `standing` off an operation. Absent is fine; present and not one of the choices cannot be read. */
export function provenanceOf(op: JsonObject, agent: AgentRef): Provenance | Unreadable {
  const precision = op.precision;
  if (precision !== undefined && !(PRECISIONS as readonly JsonValue[]).includes(precision)) return { field: "precision", value: precision, choices: PRECISIONS };
  const standing = op.standing;
  if (standing !== undefined && !(STANDINGS as readonly JsonValue[]).includes(standing)) return { field: "standing", value: standing, choices: STANDINGS };
  const given = op.source;
  const marks: string[] = [];
  let source: Cited | null = null;
  let consent: Provenance["consent"];
  if (given === undefined || given === null) marks.push(MARKS.unsourced);
  else {
    const from = typeof given === "object" && !Array.isArray(given) ? given.from : given;
    if (!(SOURCE_KINDS as readonly JsonValue[]).includes(from ?? null)) return { field: "source.from", value: from ?? null, choices: SOURCE_KINDS };
    const cites = typeof given === "object" && !Array.isArray(given) ? given : {};
    source = { from: from as Source };
    const lore = text(cites.lore);
    const message = text(cites.message);
    const roll = text(cites.roll);
    const gapCheck = text(cites.gap_check);
    const cited = text(cites.consent);
    if (lore !== undefined) source.lore = lore;
    if (message !== undefined) source.message = message;
    if (roll !== undefined) source.roll = roll;
    if (gapCheck !== undefined) source.gapCheck = gapCheck;
    if (cited !== undefined) source.consent = cited;
    if (source.from === "invented") {
      marks.push(MARKS.invented);
      if (gapCheck === undefined) marks.push(MARKS.noGapCheck);
      // The run's lead consents by its own write that names its gap check (decision 8); anyone else cites the lead's consent.
      consent = cited !== undefined ? "cited" : agent.parent === undefined && gapCheck !== undefined ? "own-write" : "none";
      if (consent === "none") marks.push(MARKS.noConsent);
    }
  }
  return { source, precision: (precision as Precision | undefined) ?? null, standing: (standing as Standing | undefined) ?? null, marks, ...(consent !== undefined ? { consent } : {}) };
}

/** The provenance as an answer's data shows it. */
export function provenanceData(p: Provenance): JsonObject {
  const out: JsonObject = {};
  if (p.source) {
    const s: JsonObject = { from: p.source.from };
    if (p.source.lore !== undefined) s.lore = p.source.lore;
    if (p.source.message !== undefined) s.message = p.source.message;
    if (p.source.roll !== undefined) s.roll = p.source.roll;
    if (p.source.gapCheck !== undefined) s.gap_check = p.source.gapCheck;
    if (p.source.consent !== undefined) s.consent = p.source.consent;
    out.source = s;
  }
  if (p.precision !== null) out.precision = p.precision;
  if (p.standing !== null) out.standing = p.standing;
  if (p.consent !== undefined) out.consent = p.consent;
  return out;
}

/** What a write cites besides its source's kind, as the store keeps it on each change (`cite`); null when nothing is cited. */
export function citeOf(p: Provenance): JsonObject | null {
  const s = provenanceData(p).source;
  if (typeof s !== "object" || s === null || Array.isArray(s)) return null;
  const { from: _from, ...cites } = s;
  const out: JsonObject = { ...cites };
  if (p.consent !== undefined) out.consent_by = p.consent;
  return Object.keys(out).length > 0 ? out : null;
}

/** What a change keeps of a write's provenance (`stampOf`): the story's and the cast's writes carry it per write. */
export type Stamp = Pick<ChangeInput, "source" | "precision" | "standing" | "cite">;

/** The provenance as the store keeps it on a change: its source's kind (null: unsourced), how exact, how sure, and what it cites. */
export function stampOf(p: Provenance): Stamp {
  return { source: p.source?.from ?? null, precision: p.precision, standing: p.standing, cite: citeOf(p) };
}

/**
 * The provenance an item of a tool that records what it can read carries (`story_record`, `cast_update`, a character's own tools): an
 * argument of it that cannot be read is left out and returned with the choices it was one of, so the item is recorded without it and
 * the answer says so (a source left out is an unsourced write), never refused for it.
 */
export function provenanceLeniently(given: JsonObject, agent: AgentRef): { prov: Provenance; left: Unreadable[] } {
  const rest: JsonObject = { ...given };
  const left: Unreadable[] = [];
  for (;;) {
    const read = provenanceOf(rest, agent);
    if (!("field" in read)) return { prov: read, left };
    left.push(read);
    delete rest[read.field.split(".")[0] as string];
  }
}
