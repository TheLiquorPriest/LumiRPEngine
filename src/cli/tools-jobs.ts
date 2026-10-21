// The tools for Build's background jobs (DESIGN §9.6, §9.7, §4.2): start one on the user's
// Lumiverse, follow it, read what it found, and apply the proposals you accept to the world's
// draft, as Build's review does. A model job (Import from lore, the lore indexing jobs, Refine,
// Describe a map) asks the user's helper model and costs its calls; Playtest and Check world run
// the engine alone on the host's background lane. Nothing a job proposes changes the world until
// it is applied, and applying writes the draft only: a commit makes it the head.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { pointerOf } from "../shared/json-patch";
import { addToLoreIndex, loreIndexJson, loreSourceOf } from "../shared/lore";
import type { JobKind, JobProposal, JobSummary } from "../shared/protocol";
import type { Args } from "./args";
import { intArg, neededText, textArg, textsArg, ToolError } from "./args";
import { editTool } from "./live";
import { clip, readAt } from "./read";
import type { ToolResult } from "./report";
import { json, lintSummary } from "./report";
import type { ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";

/** What each kind takes, and how it is told: the arguments beside worldId and kind. */
const KINDS: Readonly<Record<JobKind, { needs: readonly string[]; takes: readonly string[]; about: string }>> = {
  import_lore: { needs: ["bookIds"], takes: ["bookIds"], about: "Import from lore: entities, places and facts proposed from World Info books (bookIds, at most 64)" },
  index_book: { needs: ["bookId"], takes: ["bookId"], about: "Index a World Info book: a lore entry for each book entry with text, keeping the book's text, with aliases, topics, links and lookup terms (bookId)" },
  index_text: { needs: ["text"], takes: ["text"], about: "Index this text: lore entries in the text's own words, marked written by the AI (text)" },
  refine: { needs: ["instructions"], takes: ["instructions"], about: "Build / Refine with AI: world edits for a request in words (instructions, at most 4,000 characters)" },
  describe_map: { needs: ["scope", "prose"], takes: ["scope", "prose", "mapId"], about: "Describe a map: a map of a place drawn from a description (scope: the place's id; prose; mapId, by default <scope>_map)" },
  playtest: { needs: ["turns"], takes: ["turns"], about: "Playtest: typed turns through the engine from the world's start, no narrator (turns, at most 50)" },
  check_world: { needs: [], takes: ["days"], about: "Check world: whole days simulated from the start (days 1–14, default 3)" },
};

const KIND_NAMES = Object.keys(KINDS) as JobKind[];
const INPUTS = ["bookIds", "bookId", "text", "instructions", "scope", "prose", "mapId", "turns", "days"] as const;

const WORLD_ID: JsonObject = { type: "string", description: "The world's id (w_…), from lre_worlds." };
const JOB_ID: JsonObject = { type: "string", description: "The job's id (lre_job_start answers it; lre_jobs lists them)." };
const EXPECT_VERSION: JsonObject = { type: "integer", minimum: 0, description: "The draft version you last read: refused if the draft has moved on since, so a change you haven't seen is never overwritten." };

const worldIdOf = (args: Args): string => neededText(args, "worldId", "the world's id (lre_worlds lists them)");

function jobInput(kind: JobKind, args: Args): JsonObject {
  const spec = KINDS[kind];
  const stray = INPUTS.filter((k) => args[k] !== undefined && !spec.takes.includes(k));
  if (stray.length > 0) throw new ToolError(`${kind} doesn't take ${stray.join(", ")}. ${spec.about}.`);
  const missing = spec.needs.filter((k) => args[k] === undefined);
  if (missing.length > 0) throw new ToolError(`${kind} needs ${missing.join(" and ")}. ${spec.about}.`);
  const input: JsonObject = {};
  const bookIds = textsArg(args, "bookIds");
  if (bookIds !== undefined) {
    if (bookIds.length === 0 || bookIds.length > 64) throw new ToolError("bookIds names 1 to 64 World Info books (lre_lore_books lists them).");
    input.bookIds = bookIds;
  }
  const turns = textsArg(args, "turns");
  if (turns !== undefined) {
    if (turns.length === 0 || turns.length > 50) throw new ToolError('turns is 1 to 50 things the player types ("look around", "walk to the market").');
    input.turns = turns;
  }
  for (const key of ["bookId", "text", "instructions", "scope", "prose", "mapId"] as const) {
    const value = textArg(args, key);
    if (value !== undefined) input[key] = value;
  }
  const days = intArg(args, "days", 1, 14);
  if (days !== undefined) input.days = days;
  return input;
}

/** A job in a few lines: what it is, where it stands, and what it found, without the proposals themselves. */
function summaryOf(job: JobSummary): JsonObject {
  const result = job.result;
  let found: JsonObject | null = null;
  if (result !== undefined && "proposals" in result) {
    const byCollection: Record<string, number> = {};
    for (const p of result.proposals) byCollection[p.collection] = (byCollection[p.collection] ?? 0) + 1;
    found = { proposals: result.proposals.length, byCollection };
  } else if (result !== undefined) found = { turns: result.turns.length, lint: JSON.parse(JSON.stringify(lintSummary(result.lint, 5))) as JsonValue };
  const input = JSON.parse(JSON.stringify(job.input, (_key, value: unknown) => (typeof value === "string" ? clip(value, 200) : value))) as JsonValue;
  return { jobId: job.jobId, kind: job.kind, status: job.status, progress: job.progress, ...(job.message !== undefined ? { message: job.message } : {}), at: new Date(job.at).toISOString(), input, result: found };
}

async function jobOf(ctx: ToolContext, worldId: string, jobId: string): Promise<JobSummary> {
  const jobs = (await ctx.live().conn.request("lre.job", { op: "list", worldId })).jobs ?? [];
  const job = jobs.find((j) => j.jobId === jobId);
  if (job) return job;
  throw new ToolError(`World ${worldId} keeps no job ${jobId}. Its jobs: ${jobs.map((j) => `${j.jobId} (${j.kind}, ${j.status})`).join(", ") || "none"}. A job that ended is kept with the last few; one dismissed is gone.`);
}

/** The value a proposal writes: an AI-written lore entry counts as reviewed once applied, as Build's Apply has it. */
function reviewed(p: JobProposal): JsonValue {
  const value = p.value;
  return p.collection === "lore" && isRecord(value) && loreSourceOf(value.source).kind === "ai" ? { ...value, source: { kind: "ai", status: "accepted" } } : value;
}

async function applyTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const jobId = neededText(args, "jobId", "the job's id (lre_jobs lists them)");
  const picked = textsArg(args, "proposals");
  const expected = intArg(args, "expectVersion", 0, Number.MAX_SAFE_INTEGER);
  const job = await jobOf(ctx, worldId, jobId);
  if (job.status === "running") throw new ToolError(`Job ${jobId} is still running (${Math.round(job.progress * 100)}%): apply its proposals once it ends (lre_jobs says when).`);
  if (job.result === undefined || !("proposals" in job.result)) throw new ToolError(`Job ${jobId} (${job.kind}) proposes nothing to apply${job.result === undefined ? "" : ": it reports a run, which lre_job reads"}.`);
  const proposals = job.result.proposals;
  const unknown = (picked ?? []).filter((id) => !proposals.some((p) => p.id === id));
  if (unknown.length > 0) throw new ToolError(`Job ${jobId} has no proposal ${unknown.join(", ")}. Its proposals: ${clip(proposals.map((p) => p.id).join(", "), 2000)}.`);
  const chosen = picked === undefined ? proposals : proposals.filter((p) => picked.includes(p.id));
  if (chosen.length === 0) throw new ToolError(`Job ${jobId} has no proposals left to apply.`);
  if (chosen.length > 450) throw new ToolError(`That is ${chosen.length} proposals; apply at most 450 at once (name them with proposals).`);
  const draft = await ctx.live().draft(worldId);
  if (expected !== undefined && draft.version !== expected) throw new ToolError(`Nothing applied: the draft of ${worldId} is at version ${draft.version}, not ${expected}. It was written since you read it (by the user in Build, or another agent). Read it again (lre_draft), then apply against version ${draft.version}.`);
  const doc = draft.draft as unknown as Record<string, unknown>;
  const ops: JsonObject[] = [];
  // A collection the draft doesn't have yet (no maps, say) is made first, so each item can go into it.
  for (const collection of new Set(chosen.map((p) => p.collection))) if (!isRecord(doc[collection])) ops.push({ op: "add", path: pointerOf([collection]), value: {} });
  for (const p of chosen) ops.push({ op: "add", path: pointerOf([p.collection, p.key]), value: reviewed(p) });
  // The lookup terms and topics accepted lore entries join, merged into the draft's table in the same write.
  const filed = chosen.filter((p) => p.collection === "lore" && p.index !== undefined && (p.index.terms.length > 0 || p.index.topics.length > 0));
  if (filed.length > 0) {
    const merged = filed.reduce((index, p) => (p.index ? addToLoreIndex(index, p.key, p.index) : index), draft.draft.loreIndex);
    ops.push({ op: "add", path: "/loreIndex", value: loreIndexJson(merged) });
  }
  // One patch at the version read: all of it lands or none, and a write in between is refused, not overwritten.
  const edit = await editTool(ctx.live(), { worldId, ops, expectVersion: draft.version }, ctx.serialize);
  if (edit.isError) return edit;
  const report = JSON.parse(edit.text) as JsonObject;
  return { text: json({ jobId, applied: chosen.map((p) => p.id), ...report, next: "The proposals are in the draft (Build's too): check it with lre_draft, then lre_commit." }) };
}

export const JOB_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_job_start",
    description: `Start one of Build's background jobs on a world, on your Lumiverse; it answers the job's id at once and runs on. Kinds: ${KIND_NAMES.map((k) => `${k}: ${KINDS[k].about}`).join("; ")}. A model job asks your helper model (Settings → Helper model) and costs its calls; playtest and check_world run the engine alone, on the world's draft, like lre_playtest and lre_check_world but on the host. Follow it with lre_jobs; read what it found with lre_job; apply proposals with lre_job_apply. Nothing changes until you apply.`,
    inputSchema: object(
      {
        worldId: WORLD_ID,
        kind: { type: "string", enum: KIND_NAMES, description: "Which job." },
        bookIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64, description: "import_lore: the World Info books to read (lre_lore_books)." },
        bookId: { type: "string", description: "index_book: the book to index." },
        text: { type: "string", description: "index_text: the text to split into lore entries." },
        instructions: { type: "string", maxLength: 4000, description: "refine: what to change, in words." },
        scope: { type: "string", description: "describe_map: the id of the place the map draws." },
        prose: { type: "string", description: "describe_map: the place's description, to draw from." },
        mapId: { type: "string", description: "describe_map: the map's id (default <scope>_map)." },
        turns: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: "playtest: what the player types, one entry per turn." },
        days: { type: "integer", minimum: 1, maximum: 14, description: "check_world: days to simulate (default 3)." },
      },
      ["worldId", "kind"],
    ),
    write: { destructive: false, idempotent: false },
    run: async (args, ctx) => {
      const worldId = worldIdOf(args);
      const kind = neededText(args, "kind", `which job: ${KIND_NAMES.join(", ")}`);
      if (!hasOwn(KINDS, kind)) throw new ToolError(`There is no job ${kind}. Jobs: ${KIND_NAMES.join(", ")}.`);
      const job = kind as JobKind;
      const body = await ctx.live().conn.request("lre.job", { op: "start", kind: job, worldId, input: jobInput(job, args) });
      return { text: json({ jobId: body.jobId ?? null, kind: job, worldId, next: "It runs on your Lumiverse: lre_jobs shows its progress; when it is done, lre_job reads what it found." }) };
    },
    cli: {
      command: "job-start",
      section: "Jobs",
      usage: "job-start <worldId> <kind> [--book <id> …] [--book-id <id>] [--text <t>] [--instructions <t>] [--scope <placeId>] [--prose <t>] [--map-id <id>] [--turn <t> …] [--days <n>]",
      summary: "Start a Build job: import_lore, index_book, index_text, refine, describe_map, playtest, check_world",
      positionals: ["worldId", "kind"],
      needs: 2,
      options: { "--book": { arg: "bookIds", as: "many" }, "--book-id": { arg: "bookId", as: "text" }, "--text": { arg: "text", as: "text" }, "--instructions": { arg: "instructions", as: "text" }, "--scope": { arg: "scope", as: "text" }, "--prose": { arg: "prose", as: "text" }, "--map-id": { arg: "mapId", as: "text" }, "--turn": { arg: "turns", as: "many" }, "--days": { arg: "days", as: "int" } },
    },
  },
  {
    name: "lre_jobs",
    description: "A world's kept jobs, oldest first: the running ones and the last few that ended, each with its kind, status (running, done, failed, cancelled, or interrupted: it was running when the extension stopped, and holds what it had proposed by then), progress (0 to 1), message, input, and what it found in counts (proposals by collection, or a run's turns and lint).",
    inputSchema: object({ worldId: WORLD_ID }, ["worldId"]),
    write: false,
    run: async (args, ctx) => {
      const worldId = worldIdOf(args);
      const jobs = (await ctx.live().conn.request("lre.job", { op: "list", worldId })).jobs ?? [];
      return { text: json({ worldId, jobs: jobs.map(summaryOf) }) };
    },
    cli: { command: "jobs", section: "Jobs", usage: "jobs <worldId>", summary: "A world's jobs and their progress", positionals: ["worldId"], needs: 1 },
  },
  {
    name: "lre_job",
    description: 'One job whole at a JSON Pointer: its input and its result, the proposals (each with its id, collection, key, the value it writes, its source, confidence and note, and for lore its lookup terms and topics) or a run\'s turns (what the player typed, the engine\'s reply and notes) and lint. Large parts come back as an outline: "/result/proposals/0" reads one proposal.',
    inputSchema: object({ worldId: WORLD_ID, jobId: JOB_ID, pointer: { type: "string", description: 'A JSON Pointer into the job: "/result/proposals", "/result/turns/2".' }, offset: { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it." } }, ["worldId", "jobId"]),
    write: false,
    run: async (args, ctx) => {
      const worldId = worldIdOf(args);
      const jobId = neededText(args, "jobId", "the job's id (lre_jobs lists them)");
      const job = await jobOf(ctx, worldId, jobId);
      const read = readAt(job, { what: `job ${jobId} (${job.kind}, ${job.status})`, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
      return read.ok ? { text: read.text } : { text: read.text, isError: true };
    },
    cli: { command: "job", section: "Jobs", usage: "job <worldId> <jobId> [--pointer <p>] [--offset <n>]", summary: "One job's input and result", positionals: ["worldId", "jobId"], needs: 2, options: { "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_job_apply",
    description:
      "Apply a job's proposals to the world's draft, as Build's review does when you Apply what you accepted: each one's value goes into its collection under its key (replacing an item there by that key), an AI-written lore entry counts as reviewed, and accepted lore entries' lookup terms and topics join the draft's lookup table. All of them land in one write or none do. proposals names the ones you accept (default: all of them). The draft is the user's Build draft too: pass expectVersion. Answers what changed, as lre_edit does; commit it with lre_commit.",
    inputSchema: object({ worldId: WORLD_ID, jobId: JOB_ID, proposals: { type: "array", items: { type: "string" }, minItems: 1, description: "The ids of the proposals you accept (lre_job lists them); default all." }, expectVersion: EXPECT_VERSION }, ["worldId", "jobId"]),
    write: { destructive: true, idempotent: true },
    run: applyTool,
    cli: { command: "job-apply", section: "Jobs", usage: "job-apply <worldId> <jobId> [--proposal <id> …] [--expect-version <n>]", summary: "Apply a job's proposals to the draft", positionals: ["worldId", "jobId"], needs: 2, options: { "--proposal": { arg: "proposals", as: "many" }, "--expect-version": { arg: "expectVersion", as: "int" } } },
  },
  {
    name: "lre_job_cancel",
    description: "Stop a running job. What a model job had proposed by then stays with it, to review and apply; nothing is applied.",
    inputSchema: object({ jobId: JOB_ID }, ["jobId"]),
    write: { destructive: false, idempotent: true },
    run: async (args, ctx) => {
      const jobId = neededText(args, "jobId", "the job's id (lre_jobs lists them)");
      await ctx.live().conn.request("lre.job", { op: "cancel", jobId });
      return { text: json({ jobId, cancelled: true }) };
    },
    cli: { command: "job-cancel", section: "Jobs", usage: "job-cancel <jobId>", summary: "Stop a running job", positionals: ["jobId"], needs: 1 },
  },
  {
    name: "lre_job_dismiss",
    description: "Forget a job that has ended, with its result: its proposals can't be applied after. A running job must be cancelled first.",
    inputSchema: object({ jobId: JOB_ID }, ["jobId"]),
    write: { destructive: true, idempotent: true },
    run: async (args, ctx) => {
      const jobId = neededText(args, "jobId", "the job's id (lre_jobs lists them)");
      await ctx.live().conn.request("lre.job", { op: "dismiss", jobId });
      return { text: json({ jobId, dismissed: true }) };
    },
    cli: { command: "job-dismiss", section: "Jobs", usage: "job-dismiss <jobId>", summary: "Forget a job that has ended", positionals: ["jobId"], needs: 1 },
  },
];
