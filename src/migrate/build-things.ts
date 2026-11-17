// Build's own things today's build kept in his storage (STANDALONE-PLAN §15.2, "Build jobs and their proposals; lore ids; secrecy
// backups"): each job of `jobs.json` as an ended Build job with what it had, its proposals still to review (one the file kept as running
// reads as interrupted), and each secrecy undo copy (`secrecy/<hash>.json`) as its book's, so Restore still puts the book back; both through
// Build's own writers of a carried thing. A run writes nothing to today's data: a `jobs.json` or an undo copy that does not read is listed
// among what could not be read, kept whole in the backup and counted archived, and nothing is made from it. A later run puts a job or a copy
// again only where RPE's is still what a run put: one he reviewed, applied, restored or dismissed in RPE since stands. Today's lore index ids
// (`lore-ids.json`) are archived by their rule (`classify.ts`): RPE numbers lore entries its own way.

import type { Database } from "bun:sqlite";
import { writeCarriedJob } from "../build/jobs/carried";
import { writeCarriedSecrecy } from "../build/lore/carried";
import { hashJson } from "../shared/hash";
import { hasOwn, isRecord, type JsonObject } from "../shared/json";
import type { JobKind, JobProposal, JobResult, JobSummary } from "../shared/jobs";
import type { LintIssue } from "../shared/lint";
import { WORLD_COLLECTIONS } from "../worlds/worlds";
import type { PutPrints } from "./connections";
import type { MigrationReport } from "./report";
import type { Today } from "./today";

/** What a run did with Build's things. */
export interface BuildCarried {
  /** Jobs written into Build's jobs, ended, their proposals to review. */
  jobs: number;
  /** Of them, jobs the file kept as running, carried as interrupted. */
  interrupted: number;
  /** Undo copies written as their books'. */
  secrecy: number;
  /** Jobs and undo copies he changed or removed in RPE since a run put them: left as RPE has them. */
  keptInRpe: number;
  /** Files that do not read, listed among what could not be read and counted archived. */
  unreadable: number;
}

const JOBS_FILE = "jobs.json";
const SECRECY_FILE = /^secrecy\/[0-9a-f]{32}\.json$/;

const KINDS: Readonly<Record<JobKind, true>> = { import_lore: true, refine: true, describe_map: true, propose_routines: true, playtest: true, check_world: true, index_text: true };
const STATUSES: Readonly<Record<JobSummary["status"], true>> = { running: true, done: true, failed: true, cancelled: true, interrupted: true };
const SEVERITIES: Readonly<Record<LintIssue["severity"], true>> = { error: true, warning: true, info: true };

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** A proposal as today's reader takes it. */
function isProposal(raw: unknown): raw is JobProposal {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.collection !== "string" || !hasOwn(WORLD_COLLECTIONS, raw.collection) || typeof raw.key !== "string" || !hasOwn(raw, "value")) return false;
  if (typeof raw.source !== "string" || typeof raw.confidence !== "number") return false;
  if ((raw.note !== undefined && typeof raw.note !== "string") || (raw.pack !== undefined && typeof raw.pack !== "string") || (raw.owner !== undefined && typeof raw.owner !== "string")) return false;
  if (raw.problems !== undefined && !strings(raw.problems)) return false;
  if (raw.sourceNames !== undefined && !(isRecord(raw.sourceNames) && Object.values(raw.sourceNames).every((n) => typeof n === "string"))) return false;
  return raw.index === undefined || (isRecord(raw.index) && strings(raw.index.terms) && Array.isArray(raw.index.topics) && raw.index.topics.every((t) => isRecord(t) && typeof t.id === "string" && typeof t.label === "string"));
}

/** A job's result as today's reader takes it: entries of another shape left out. */
function resultOf(raw: unknown): JobResult | undefined {
  if (!isRecord(raw)) return undefined;
  if (Array.isArray(raw.proposals)) return { proposals: (structuredClone(raw.proposals) as unknown[]).filter(isProposal), ...(isRecord(raw.next) ? { next: structuredClone(raw.next) as JsonObject } : {}) };
  if (!Array.isArray(raw.turns) || !Array.isArray(raw.lint)) return undefined;
  const ms = (v: unknown): { processMs?: Record<string, number> } => {
    const kept = isRecord(v) ? Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] >= 0) : [];
    return kept.length > 0 ? { processMs: Object.fromEntries(kept) } : {};
  };
  const turns = raw.turns.flatMap((t) => (isRecord(t) && typeof t.user === "string" && typeof t.reply === "string" && Array.isArray(t.notes) ? [{ user: t.user, reply: t.reply, notes: t.notes.filter((n): n is string => typeof n === "string"), ...ms(t.processMs) }] : []));
  const lint = raw.lint.flatMap((l) => (isRecord(l) && typeof l.severity === "string" && hasOwn(SEVERITIES, l.severity) && typeof l.path === "string" && typeof l.code === "string" && typeof l.message === "string" ? [{ severity: l.severity as LintIssue["severity"], path: l.path, code: l.code, message: l.message }] : []));
  return { turns, lint };
}

/** One job as today's reader takes it, or null for one it leaves out. */
function jobOf(raw: unknown): JobSummary | null {
  if (!isRecord(raw) || typeof raw.jobId !== "string" || typeof raw.kind !== "string" || !hasOwn(KINDS, raw.kind) || typeof raw.worldId !== "string" || typeof raw.status !== "string" || !hasOwn(STATUSES, raw.status)) return null;
  if (typeof raw.progress !== "number" || typeof raw.at !== "number" || !isRecord(raw.input)) return null;
  const result = resultOf(raw.result);
  return {
    jobId: raw.jobId,
    kind: raw.kind as JobKind,
    worldId: raw.worldId,
    status: raw.status as JobSummary["status"],
    progress: Math.max(0, Math.min(1, raw.progress)),
    ...(typeof raw.message === "string" ? { message: raw.message } : {}),
    ...(result ? { result } : {}),
    input: structuredClone(raw.input) as JsonObject,
    at: raw.at,
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Build's job `id` as its table holds it now, as one print; null where it holds none. */
function jobPrint(db: Database, user: string, id: string): string | null {
  const row = db.query<Record<string, unknown>, [string, string]>("SELECT status, progress, message, input, result, at FROM build_job WHERE user = ? AND id = ?").get(user, id);
  return row === null ? null : hashJson(row);
}

/** The undo copy of `book` as Build's table holds it now, as one print; null where it holds none. */
function secrecyPrint(db: Database, user: string, book: string): string | null {
  const row = db.query<{ body: string }, [string, string]>("SELECT body FROM build_secrecy WHERE user = ? AND book = ?").get(user, book);
  return row === null ? null : hashJson(row.body);
}

/**
 * Carries Build's jobs and secrecy undo copies of `today` into Build's tables in `db`, each where RPE's copy is none a run did not put, or
 * still what a run put (`earlier`); a file that does not read is listed in `report.unreadable` and its item counted archived.
 */
export async function carryBuildThings(input: { today: Today; report: MigrationReport; db: Database; user: string; earlier: PutPrints }): Promise<{ carried: BuildCarried; put: Map<string, string> }> {
  const { today, report, db, user, earlier } = input;
  const out: BuildCarried = { jobs: 0, interrupted: 0, secrecy: 0, keptInRpe: 0, unreadable: 0 };
  const put = new Map<string, string>();
  const items = report.items.filter((i) => i.where === "user storage" && i.row === "build-jobs" && i.fate === "carried");
  /** Puts one thing whose print is read by `print`, where RPE's is none a run did not put or still the run's. */
  const putOne = (what: string, print: () => string | null, write: () => void): boolean => {
    const was = earlier.get(what);
    const now = print();
    if (!(was === undefined ? now === null : now === was)) {
      out.keptInRpe++;
      return false;
    }
    db.transaction(write)();
    const after = print();
    if (after !== null) put.set(what, after);
    return true;
  };
  const damaged = (item: (typeof items)[number], why: string): void => {
    report.unreadable.push({ path: `user storage: ${item.path}`, why });
    item.fate = "archived";
    item.note = why;
    out.unreadable++;
  };
  for (const item of items) {
    const text = await today.userView.read(item.path);
    if (text === null) continue;
    if (item.path === JOBS_FILE) {
      const raw = parsed(text);
      if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.jobs)) {
        damaged(item, "Build's jobs file does not read as today's jobs; no job is made from it, and it is kept whole in the backup");
        continue;
      }
      for (const job of raw.jobs.flatMap((j) => jobOf(j) ?? [])) {
        if (!putOne(`build job ${job.jobId}`, () => jobPrint(db, user, job.jobId), () => writeCarriedJob(db, user, job))) continue;
        out.jobs++;
        if (job.status === "running") out.interrupted++;
      }
    } else if (SECRECY_FILE.test(item.path)) {
      const raw = parsed(text);
      const book = isRecord(raw) && typeof raw.bookId === "string" && raw.bookId !== "" ? raw.bookId : null;
      if (book === null) {
        damaged(item, "a secrecy undo copy that does not read or names no book, so nothing could be restored from it; kept whole in the backup");
        continue;
      }
      if (putOne(`secrecy ${book}`, () => secrecyPrint(db, user, book), () => void writeCarriedSecrecy(db, user, text))) out.secrecy++;
    }
  }
  return { carried: out, put };
}
