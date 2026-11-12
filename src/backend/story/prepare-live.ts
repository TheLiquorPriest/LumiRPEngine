// The prepared start as it runs, for the live view in Play → Now's card (`lre.prepareLive`,
// `shared/prepare-live.ts`): where it stands, who is at work on it, how far it has come, what it has
// taken and cost, and what happened.
//
// A page asks for it every few seconds for hours, so it reads only what is cheap to read: the
// preparation's file (`readPrepare`), one page of the chat's jobs as LumiAH lists them, and the list
// of the chat's own files (who has an outline and a profile; whether the scene and the notebook were
// written since the plan). Never the chat's messages, its World Info or the story's record, each of
// which loads the whole chat: what the view says of those the tools wrote into the file as they
// worked (the chat as the plan found it, whom each stretch reached and who relived it, the log). A
// file older than one of those keeps none of it, and the view says so rather than guess.
//
// Everything is derived from what is stored, so a page reloaded, or opened again tomorrow, shows the
// same: the stage, who is at work and how far it has come from the file and the jobs; the trail from
// the file's log and the jobs' own times.

import { AUTHOR_FILE, HARNESS_AGENT } from "../../shared/harness-texts";
import type { ChatId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import { type PrepareGoing, type PrepareLive, type PrepareLiveView, type PreparePrincipalLine, type PrepareRole, type PrepareRunLine, type PrepareRunState, PREPARE_STAGES, type PrepareStage, type PrepareStageState, type PrepareStretchLine, type PrepareStretchState, type PrepareTrailEntry } from "../../shared/prepare-live";
import type { PrepareDepth } from "../../shared/story-pages";
import type { Runtime } from "../runtime";
import { mindPath } from "./minds";
import { depthOf, estimateOf, type JobRow, planned, type PrepareChat, type PrepareLogEntry, type PrepareState, type PrepareStretch, preparing, readPrepare, spentOf, unanswered, waits, within } from "./prepare";

// ---------------------------------------------------------------- the runs

/** A job of LumiAH's as the view reads it from the chat's list: what the card reads of it, with who it runs as, who started it, its times and why it stopped. */
interface Run extends JobRow {
  /** Which instance of its agent it is (a character's agent: the person). */
  as: string | null;
  /** The job whose agent started it. */
  parent: string | null;
  /** The job it was started again from. */
  again: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  workedMs: number;
  stoppedAt: "allowance" | "day" | null;
}

const word = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

function runOf(raw: unknown): Run | null {
  if (!isRecord(raw)) return null;
  const id = word(raw.id);
  const state = word(raw.state);
  if (id === null || state === null) return null;
  const usage = isRecord(raw.usage) ? raw.usage : {};
  return {
    id,
    state,
    agent: word(raw.agent) ?? "",
    as: word(raw.as),
    paused: raw.paused === true || state === "paused",
    byUser: isRecord(raw.by) && raw.by.who === "user",
    plan: word(raw.plan),
    parent: word(raw.parent),
    again: word(raw.again),
    createdAt: count(raw.createdAt) ?? 0,
    startedAt: count(raw.startedAt),
    endedAt: count(raw.endedAt),
    workedMs: count(raw.workedMs) ?? 0,
    tokens: (count(usage.in) ?? 0) + (count(usage.out) ?? 0),
    calls: count(usage.calls) ?? 0,
    reason: word(raw.reason),
    stoppedAt: raw.stoppedAt === "allowance" || raw.stoppedAt === "day" ? raw.stoppedAt : null,
  };
}

/** A run that hasn't ended: waiting for its place, at work, or held. */
const UNDER_WAY: readonly string[] = ["queued", "running", "paused"];

/** A run that ended before its work was done: failed, cut off by a restart, out of what it may spend, or the reply it worked for gone. */
const STOPPED: readonly string[] = ["failed", "interrupted", "spent", "off_path"];

const RUN_STATES: readonly PrepareRunState[] = ["queued", "running", "paused", "failed", "interrupted", "spent", "off_path", "cancelled"];

/** The preparation's own runs among the chat's (`runs`, the latest first): the player's jobs that keep its file, and every job an agent of one started, however far down. */
function preparationRuns(runs: readonly Run[]): Run[] {
  const ours = new Set(runs.filter(preparing).map((r) => r.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of runs) {
      if (ours.has(r.id) || r.parent === null || !ours.has(r.parent)) continue;
      ours.add(r.id);
      grew = true;
    }
  }
  return runs.filter((r) => ours.has(r.id));
}

/** Who a run is, from the agent it runs as: a character's agent is the principal it was started as. */
function roleOf(run: Run): { role: PrepareRole; who: string | null } {
  if (run.agent === HARNESS_AGENT.author) return { role: "author", who: null };
  if (run.agent === HARNESS_AGENT.historian) return { role: "historian", who: null };
  if (run.agent === HARNESS_AGENT.character && run.as !== null) return { role: "principal", who: run.as };
  return { role: "other", who: run.as };
}

/** The chat's latest runs, as LumiAH lists them (the latest first), at most `most`; and whether the user holds every job. */
async function runsOf(core: NonNullable<Runtime["harness"]["core"]>, at: { chatId: ChatId; userId: UserId }, most: number): Promise<{ runs: Run[]; held: boolean }> {
  const page = await core.ask(at.userId, "jobs.list", { chatId: at.chatId, cursor: null, limit: most }, { chat: at.chatId });
  const rows: unknown[] = isRecord(page) && Array.isArray(page.jobs) ? page.jobs : [];
  return { runs: rows.flatMap((raw) => runOf(raw) ?? []), held: isRecord(page) && page.paused === true };
}

/** The trail's lines a run of the preparation gives: the author's runs begun and ended; any run stopped before its work was done, with LumiAH's reason, or started again; a run cancelled where the file keeps no log of its own that says so. */
function runTrail(run: Run, logged: boolean): PrepareTrailEntry[] {
  const { role, who } = roleOf(run);
  const of = { role, agent: run.agent, ...(who !== null ? { who } : {}) };
  const out: PrepareTrailEntry[] = [];
  if (run.again !== null && role !== "author") out.push({ at: run.createdAt, what: "run_again", ...of });
  if (role === "author" && run.startedAt !== null) out.push({ at: run.startedAt, what: "run_started", ...of });
  if (run.endedAt === null) return out;
  if (STOPPED.includes(run.state)) out.push({ at: run.endedAt, what: "run_stopped", ...of, ...(run.reason !== null ? { text: run.reason } : {}) });
  else if (run.state === "cancelled" && !logged) out.push({ at: run.endedAt, what: "run_cancelled", ...of });
  else if (run.state === "done" && role === "author") out.push({ at: run.endedAt, what: "run_ended", ...of });
  return out;
}

// ---------------------------------------------------------------- the stretches and the chat

/** A stretch as far as it has come: once recorded, done when everyone it reached relived it, as of the file's last look; recorded alone where the file doesn't say whom it reached; one planned outside the depth the preparation goes to (`depth`), left out. */
function stretchLine(s: PrepareStretch, depth: PrepareDepth): PrepareStretchLine {
  const kept = s.state === "recorded" && s.reached !== undefined;
  const relivers = kept ? (s.reached ?? []) : s.who;
  const relived = kept ? relivers.filter((p) => (s.relived ?? []).includes(p)) : null;
  const state: PrepareStretchState =
    s.state === "planned" ? (within(s, depth) ? "waiting" : "left") : s.state === "open" ? "reading" : s.state === "dropped" ? "dropped" : relived === null ? "recorded" : relived.length === relivers.length ? "done" : "reliving";
  return { id: s.id, from: s.from, to: s.to, state, beats: s.beats.length, through: s.through, key: s.key === true, relivers: [...relivers], relived };
}

type Span = [number, number];

/** Spans of message numbers within `first` to `last`, made one where they overlap or touch, in order. */
function merged(spans: readonly Span[], first: number, last: number): Span[] {
  const out: Span[] = [];
  const within = spans.map(([from, to]): Span => [Math.max(from, first), Math.min(to, last)]).filter(([from, to]) => from <= to);
  for (const [from, to] of within.sort((a, b) => a[0] - b[0])) {
    const end = out.at(-1);
    if (end && from <= end[1] + 1) end[1] = Math.max(end[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** How many numbers merged spans hold. */
const measure = (spans: readonly Span[]): number => spans.reduce((n, [from, to]) => n + to - from + 1, 0);

/** Of the chat's messages as the plan found them: those of the stretches done, those a summary covers beside them, and the rest. */
function messagesOf(chat: PrepareChat, lines: readonly PrepareStretchLine[]): NonNullable<PrepareLive["messages"]> {
  const relived = merged(
    lines.filter((s) => s.state === "done").map((s): Span => [s.from, s.to]),
    chat.first,
    chat.last,
  );
  const covered = merged(
    chat.covered.map((c): Span => [c.from, c.to]),
    chat.first,
    chat.last,
  );
  let both = 0;
  for (const [cf, ct] of covered) for (const [rf, rt] of relived) both += Math.max(0, Math.min(ct, rt) - Math.max(cf, rf) + 1);
  const done = Math.min(chat.messages, measure(relived));
  const filled = Math.min(chat.messages - done, measure(covered) - both);
  return { total: chat.messages, relived: done, filled, neither: chat.messages - done - filled };
}

// ---------------------------------------------------------------- the stages

/** What the stages are worked out from. */
interface StageFacts {
  plan: PrepareState | null;
  done: boolean;
  lines: readonly PrepareStretchLine[];
  principals: readonly PreparePrincipalLine[];
  scene: boolean;
  notebook: boolean;
}

/**
 * Each stage as it stands, and the one it is at: the first neither done nor skipped. Reading lasts
 * until a plan is written; planning again while the player's words wait for the author's answer;
 * waiting while the plan waits for their word (none needed: skipped); reliving until every stretch is
 * recorded and relived (a new chat, or a plan with none: skipped); filling in until every principal
 * has a profile and, with a past, an outline; setting the scene until the scene and the notebook are
 * written since the plan, and until the author closes the preparation; ready once it did.
 */
function stagesOf(f: StageFacts): { stage: PrepareStage; stages: { id: PrepareStage; state: PrepareStageState }[] } {
  const { plan } = f;
  const open = plan !== null && unanswered(plan).length > 0;
  const live = f.lines.filter((s) => s.state !== "dropped" && s.state !== "left");
  const facts: Record<PrepareStage, PrepareStageState> = {
    reading: plan === null ? "now" : "done",
    planning: plan === null ? "ahead" : open ? "now" : "done",
    waiting: plan === null || open ? "ahead" : !plan.word.asked ? "skipped" : plan.word.approved ? "done" : "now",
    reliving: plan !== null && (plan.kind === "new" || live.length === 0) ? "skipped" : plan !== null && live.every((s) => s.state === "done" || s.state === "recorded") ? "done" : "ahead",
    filling: plan !== null && f.principals.every((p) => p.profile && p.outline !== false) ? "done" : "ahead",
    scene: plan !== null && f.scene && f.notebook ? "done" : "ahead",
    ready: f.done ? "done" : "ahead",
  };
  if (f.done) return { stage: "ready", stages: PREPARE_STAGES.map((id) => ({ id, state: facts[id] === "skipped" ? "skipped" : "done" })) };
  // Past every other stage, the author closes the preparation as it sets the scene.
  const at = PREPARE_STAGES.find((id) => id !== "ready" && facts[id] !== "done" && facts[id] !== "skipped") ?? "scene";
  return { stage: at, stages: PREPARE_STAGES.map((id) => ({ id, state: id === at ? "now" : facts[id] === "now" ? "ahead" : facts[id] })) };
}

// ---------------------------------------------------------------- time

/** The log's entries that halt the reliving (a pause, a stop, a cancel, the player's words, which send the plan back to wait for their word), and those that let it go on. */
const HALTS: readonly PrepareLogEntry["what"][] = ["paused", "stopped", "cancelled", "said"];
const GOES: readonly PrepareLogEntry["what"][] = ["resumed", "carried", "approved", "reopened"];

/**
 * A rough time left for the stretches not yet done, at the pace of those done so far: from the first
 * stretch opened to the last done, less the time it was halted, over how many were done in it. A
 * stretch is done when the last of those it reached relived it, else when it was recorded, as the log
 * says. Null before one is done, or where the file keeps no log.
 */
function leftOf(log: readonly PrepareLogEntry[], lines: readonly PrepareStretchLine[]): PrepareLive["left"] {
  const starts = log.filter((e) => e.what === "opened").map((e) => e.at);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const timed = lines.flatMap((s) => {
    if (s.state !== "done") return [];
    const times = log.filter((e) => e.stretch === s.id && (e.what === "relived" || e.what === "recorded")).map((e) => e.at);
    return times.length > 0 && Math.max(...times) >= start ? [Math.max(...times)] : [];
  });
  const remaining = lines.filter((s) => s.state === "waiting" || s.state === "reading" || s.state === "reliving").length;
  if (timed.length === 0 || remaining === 0) return null;
  const end = Math.max(...timed);
  let held = 0;
  let since: number | null = null;
  for (const e of log) {
    if (e.at < start || e.at > end) continue;
    if (HALTS.includes(e.what)) since ??= e.at;
    else if (GOES.includes(e.what) && since !== null) {
      held += e.at - since;
      since = null;
    }
  }
  if (since !== null) held += end - since;
  const active = end - start - held;
  return active > 0 ? { ms: Math.round((active / timed.length) * remaining), stretches: remaining } : null;
}

// ---------------------------------------------------------------- the view

/** The view with nothing to show: no preparation on the chat, or none that can be read now. */
const nothing = (at: number, every: number): PrepareLiveView => ({ at, live: false, every, prep: null });

/**
 * The chat's preparation as it runs. `live` while a run of it is at work or waits for its place, and
 * for two asks after its latest run ended while it is stopped and not done, so a run that starts the
 * next by itself is seen; not while it is held, waits for the player's word or is done.
 */
export async function prepareLive(rt: Runtime, at: { chatId: ChatId; userId: UserId }): Promise<PrepareLiveView> {
  const now = Date.now();
  const { prepare: dials } = (await rt.settings.get(at.userId)).story;
  if ((await rt.chatKnowledge.engine(at.chatId, at.userId)) !== "harness") return nothing(now, dials.watchSeconds);
  const core = rt.harness.core;
  const files = rt.harness.files?.(at) ?? null;
  if (core === null || files === null) return nothing(now, dials.watchSeconds);
  const [file, listed, chatFiles] = await Promise.all([readPrepare(files), runsOf(core, at, dials.watchRuns), files.list("")]);
  const runs = preparationRuns(listed.runs);
  const state = file.state;
  if (file.damaged || (state === null && runs.length === 0)) return nothing(now, dials.watchSeconds);
  const plan = state !== null && planned(state) ? state : null;
  const done = state !== null && state.done !== null;
  const log = state?.log ?? [];
  const versions = new Map(chatFiles.map((f) => [f.path, f.version]));
  const depth: PrepareDepth = plan !== null ? depthOf(plan) : "all";
  const lines = (plan?.stretches ?? []).map((s) => stretchLine(s, depth));
  const underWay = runs.filter((r) => UNDER_WAY.includes(r.state));
  const opened = lines.find((s) => s.state === "reading") ?? null;
  const lineOf = (r: Run, stretch: string | null): PrepareRunLine => {
    const live = r.state === "running" ? (core.spent?.(at.userId, r.id) ?? null) : null;
    return { id: r.id, ...roleOf(r), agent: r.agent, state: RUN_STATES.find((s) => s === r.state) ?? "failed", stretch, since: r.startedAt ?? r.createdAt, endedAt: r.endedAt, used: live ? { tokens: live.in + live.out, calls: live.calls } : { tokens: r.tokens, calls: r.calls }, reason: r.reason, stoppedAt: r.stoppedAt, inside: null };
  };
  // A historian's run is on the stretch open; a principal's on the first recorded stretch that reached them which they haven't taken in yet.
  const atWork = underWay.map((r) => lineOf(r, r.agent === HARNESS_AGENT.historian ? (opened?.id ?? null) : (lines.find((s) => s.state === "reliving" && r.agent === HARNESS_AGENT.character && r.as !== null && s.relivers.includes(r.as) && !(s.relived ?? []).includes(r.as))?.id ?? null)));
  // The historian handed a stretch inside the author's run: at work while that run is, on the stretch open, since it was opened.
  const author = atWork.find((r) => r.role === "author");
  if (opened !== null && author !== undefined && !atWork.some((r) => r.role === "historian")) {
    atWork.push({ id: author.id, role: "historian", who: null, agent: HARNESS_AGENT.historian, state: author.state, stretch: opened.id, since: log.findLast((e) => e.what === "opened" && e.stretch === opened.id)?.at ?? null, endedAt: null, used: null, reason: null, stoppedAt: null, inside: author.id });
  }
  // The author first, then the historian, the principals in the plan's order and anyone else.
  const rank = (r: PrepareRunLine): number => (r.role === "author" ? 0 : r.role === "historian" ? 1 : r.role === "principal" ? 2 + Math.max(0, plan?.principals.findIndex((p) => p.id === r.who) ?? 0) : 10_000);
  atWork.sort((a, b) => rank(a) - rank(b));
  // The last run of each of them, where it stopped before its work was done and nothing of theirs ran since.
  const latest = new Map<string, Run>();
  for (const r of runs) {
    const key = `${r.agent}\u0000${r.as ?? ""}`;
    if ((latest.get(key)?.createdAt ?? -1) < r.createdAt) latest.set(key, r);
  }
  const stopped = done ? [] : [...latest.values()].filter((r) => STOPPED.includes(r.state)).map((r) => lineOf(r, null));
  const principals: PreparePrincipalLine[] = (plan?.principals ?? []).map((p) => {
    const theirs = lines.filter((s) => s.state !== "dropped" && s.state !== "left" && s.relivers.includes(p.id));
    return {
      id: p.id,
      planned: theirs.length,
      relived: theirs.some((s) => s.state === "recorded") ? null : theirs.filter((s) => (s.relived ?? []).includes(p.id)).length,
      outline: plan?.kind === "new" ? null : versions.has(mindPath(p.id, "outline")),
      profile: versions.has(mindPath(p.id, "core")),
      atWork: underWay.some((r) => r.agent === HARNESS_AGENT.character && r.as === p.id),
    };
  });
  // Written since the plan: the file is there, at another version than the plan found.
  const scene = versions.has(AUTHOR_FILE.scene) && versions.get(AUTHOR_FILE.scene) !== plan?.marks.scene;
  const notebook = versions.has(AUTHOR_FILE.notebook) && versions.get(AUTHOR_FILE.notebook) !== plan?.marks.notebook;
  const { stage, stages } = stagesOf({ plan, done, lines, principals, scene, notebook });
  const held = underWay.some((r) => r.paused) || (listed.held && underWay.length > 0);
  const going: PrepareGoing = done
    ? "done"
    : !held && underWay.some((r) => r.state === "running")
      ? "running"
      : !held && underWay.some((r) => r.state === "queued")
        ? "queued"
        : underWay.length > 0
          ? "held"
          : plan !== null && waits(plan) && unanswered(plan).length === 0
            ? "waiting"
            : "stopped";
  const logged = state?.log !== undefined;
  const trail = [
    ...log.map((e): PrepareTrailEntry => ({ at: e.at, what: e.what, ...(e.stretch !== undefined ? { stretch: e.stretch } : {}), ...(e.who !== undefined ? { who: e.who } : {}), ...(e.text !== undefined ? { text: e.text } : {}), ...(e.count !== undefined ? { count: e.count } : {}) })),
    ...runs.flatMap((r) => runTrail(r, logged)),
  ]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
    .map(({ e }) => e);
  const firsts = [...log.slice(0, 1).map((e) => e.at), ...runs.map((r) => r.createdAt).filter((t) => t > 0)];
  const lastEnd = Math.max(0, ...runs.map((r) => r.endedAt ?? 0));
  const prep: PrepareLive = {
    kind: state?.kind ?? null,
    depth: plan?.depth !== undefined ? { chosen: depth, recommended: plan.depth.recommended, picked: plan.word.depth !== undefined } : null,
    stage,
    stages,
    going,
    runs: [...atWork, ...stopped],
    stretches: lines,
    principals,
    messages: plan?.chat !== undefined ? messagesOf(plan.chat, lines) : null,
    relivedAt: plan?.relivedAt ?? null,
    reach: (plan?.stretches ?? []).every((s) => s.state !== "recorded" || s.reached !== undefined),
    scene,
    notebook,
    startedAt: firsts.length > 0 ? Math.min(...firsts) : null,
    endedAt: done ? (log.findLast((e) => e.what === "finished")?.at ?? (lastEnd > 0 ? lastEnd : null)) : null,
    workedMs: runs.filter((r) => r.agent === HARNESS_AGENT.author).reduce((n, r) => n + r.workedMs, 0),
    left: done ? null : leftOf(log, lines),
    spent: spentOf(core, at, listed.runs, state?.runs ?? []).tokens,
    estimate: plan !== null ? estimateOf(plan) : null,
    cap: state?.word.cap ?? null,
    trail,
    logged,
    names: Object.fromEntries((plan?.principals ?? []).map((p) => [p.id, p.name])),
  };
  // Asked again while a run is at work or waits for its place, and for two asks past its latest run's end while it is stopped: a run started by itself shows.
  const ended = going === "stopped" && lastEnd > 0 && now - lastEnd <= 2 * dials.watchSeconds * 1000;
  return { at: now, live: going === "running" || going === "queued" || ended, every: dials.watchSeconds, prep };
}
