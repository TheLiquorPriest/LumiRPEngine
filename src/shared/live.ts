// GM → Live (DESIGN §4.6): an agent turn as its agents work it, for the game master. Everything the
// turn's agents do lands here as it happens: each role run and each agent, with its role, its phase
// or stage and its model; each message an agent is sent; its reasoning, when the provider returns
// any; its answers; each tool call with its arguments, and each result; the writes its roles stage
// and what came of them (landed, held for the review card, refused with why, or dropped); its tokens
// and times; and how the run ended. GM data, shown only behind the GM gate and never on a player
// surface: the drawer's activity line (`Activity.agents`) stays as coarse as it was.
//
// The same entries make the turn's transcript (`transcriptText`), which its record keeps and GM →
// Workspace lists under `transcripts/`. Each turn's plan (`plan`) says, once its pre phase knows it,
// how each role stands: it runs, is kept, off, auto or none, with why (`shared/agent-pipeline.ts`).

import { agentLabel } from "./agent-settings";
import { PLAN_STATUS_WORDS, type PlanRow } from "./agent-pipeline";
import type { JsonObject } from "./json";

/** What an agent's call spent: tokens sent (of which read from the provider's cache) and written (of which reasoning). */
export interface LiveUsage {
  in: number;
  cachedIn: number;
  out: number;
  reasoningOut: number;
}

/** Where a staged write stands: staged by its role, landed at its phase's commit, held for the turn's review card, refused (with why), or dropped. */
export type LiveWriteOutcome = "staged" | "landed" | "held" | "refused" | "dropped";

/** Why staged writes were dropped: their run failed, a revision replaced its answer, the main agent's request went on without its run (its time ran out, or the main agent failed), or the turn's run ended (Cancel, a failure, a newer run). */
export type LiveDropWhy = "failed" | "replaced" | "unused" | "ended";

/** How a run ended: it closed on its reply, waits at a gate (a resume carries it on), failed, was cancelled, or was let go (a newer run of the chat, or past the turns kept). */
export type LiveEndState = "done" | "waiting" | "failed" | "cancelled" | "dropped";

/** Where in its turn a write was staged: before the plan, between the plan and the reply, or after the reply. */
export type LivePhase = "pre" | "plan" | "post";

/** One edit of the final review (DESIGN §4.6): the part of the narrator's prompt it changed, by id and name, what it did, the line it changed (none for an append) and the text it gave (none for a drop). */
export interface LiveReviewEdit {
  part: string;
  label: string;
  op: "replace" | "append" | "drop";
  line?: string;
  text?: string;
}

/** How the final review ended: it revised the prompt, left it as made, or failed, after which the prompt went unrevised or the turn stopped, as its settings say. */
export type LiveReviewOutcome = "revised" | "unchanged" | "unrevised" | "stopped";

/** One thing a turn's agents did, as the live view and the transcript tell it. */
export type LiveEntryBody =
  /** The turn moved on: its plan is made (`plan`), or the reply is in and read (`post`). */
  | { kind: "phase"; phase: LivePhase }
  /** A role run starts (C9): its id (what its writes name), its role, and how it runs: its agent, or its classic step's one call (prompt-only). */
  | { kind: "run"; run: string; role: string; via: "agent" | "prompt_only" }
  /** That run ended: answered (`ok`) or failed, with the code and words of why, what it spent and how long it took. */
  | { kind: "ran"; run: string; ok: boolean; via: "agent" | "prompt_only"; code?: string; reason?: string; usage: { in: number; out: number }; ms: number }
  /**
   * An agent starts work: its role, the run it works for (none: the main agent's), where in the turn
   * (its Diagnostics phase; the main agent's stage), its task, the connection and model it runs on
   * (null: the default connection, the connection's model) and its effort, what it is told first (its
   * system prompt and stable prefix), and how many messages of a conversation it takes up.
   */
  | { kind: "agent"; agent: string; role: string; run?: string; phase?: string; stage?: string; task?: string; model: string | null; connection: string | null; effort: string; system: string; prefix: string[]; history: number }
  /** A message the agent was sent. */
  | { kind: "message"; agent: string; text: string }
  /** One of its model's answers: its text, its reasoning when the provider returned any, the tools it calls with their arguments, what the call spent, the model that answered, why it finished and how long it took. */
  | { kind: "answer"; agent: string; text: string; reasoning?: string; calls: { id: string; name: string; args: JsonObject }[]; usage: LiveUsage; model: string; finish: string; ms: number }
  /** Its connection refused native tools: the round goes again with the tools as text. */
  | { kind: "tools_refused"; agent: string; reason: string; ms: number }
  /** A tool's result for one of its calls (`call`), as its model was sent it, and whether it is a failure. */
  | { kind: "result"; agent: string; call: string; name: string; text: string; error: boolean; ms: number }
  /** It stopped short of an answer: how, and why in the user's words. */
  | { kind: "stop"; agent: string; status: string; code: string; reason: string }
  /** It finished working its message: what it spent in all. */
  | { kind: "idle"; agent: string; usage: { in: number; out: number } }
  /** A write a role staged, by its operation's key: where it stands now, with its change in words while it is staged, and why it was refused or dropped. */
  | { kind: "write"; key: string; run: string; role: string; phase: LivePhase; outcome: LiveWriteOutcome; changeType?: string; lines?: string[]; code?: string; reason?: string; why?: LiveDropWhy }
  /** What stopped the turn: a role under `stop`, a classic call a stopping role made, or the main agent. */
  | { kind: "failed"; step: string; reason: string }
  /** The turn waits on the player at a gate; its resume carries it on. */
  | { kind: "wait" }
  /** The gate's resume took the turn up again. */
  | { kind: "resume" }
  /** The final review ended: how, each edit it made to the narrator's prompt, and why it failed when it did. */
  | { kind: "review"; outcome: LiveReviewOutcome; edits: LiveReviewEdit[]; reason?: string }
  /** The turn's plan, once its pre phase knows it: each role's line (`turnPlan`). */
  | { kind: "plan"; rows: PlanRow[] };

/** An entry with its place in the run's order and when it happened (epoch ms). */
export type LiveEntry = LiveEntryBody & { seq: number; at: number };

/** How and when a run ended, with why in words where the engine said. */
export interface LiveEnded {
  state: LiveEndState;
  at: number;
  reason?: string;
}

/**
 * A chat's latest agent run (a turn, a Retry read or Re-read edit's `read`, a Re-narrate or
 * Continue's `reply`) as GM → Live shows it: its id (its first key, kept when a generation takes the
 * prepared turn or a gate's resume carries it on), which pipeline worked it, the player's words it
 * answers, when it started, how it ended (null while it runs), and every entry so far, in order.
 */
export interface LiveView {
  turn: string;
  kind: "turn" | "read" | "reply";
  pipeline: "fixed" | "main";
  text: string;
  startedAt: number;
  ended: LiveEnded | null;
  entries: LiveEntry[];
}

/** What a page hears of a chat's live view (`lre.live.update`): a new run's view, whole, or what its run `turn` added since, with how it stands now. */
export type LiveChange = { view: LiveView } | { turn: string; entries: LiveEntry[]; ended: LiveEnded | null };

/**
 * A page's live view after a change it heard: a new run's view replaces it; entries for the run it
 * holds join it in order, any it holds already left out; `resync` when it can't follow (it holds
 * another run, or none, or entries went missing between), so the page asks for the view again.
 */
export function followLive(held: LiveView | null, change: LiveChange): LiveView | "resync" {
  if ("view" in change) return change.view;
  if (held === null || held.turn !== change.turn) return "resync";
  const last = held.entries.at(-1)?.seq ?? 0;
  const fresh = change.entries.filter((e) => e.seq > last);
  if (fresh.length > 0 && fresh[0] !== undefined && fresh[0].seq !== last + 1) return "resync";
  return { ...held, entries: fresh.length > 0 ? [...held.entries, ...fresh] : held.entries, ended: change.ended };
}

// ---------------------------------------------------------------- grouping

type Of<K extends LiveEntryBody["kind"]> = Extract<LiveEntry, { kind: K }>;

/** One agent of a group: how it started, each step of its work in order, and its end once it finished its message. */
export interface LiveAgentView {
  start: Of<"agent">;
  steps: (Of<"message"> | Of<"answer"> | Of<"tools_refused"> | Of<"result"> | Of<"stop">)[];
  idle: Of<"idle"> | null;
}

/** A staged write as its group shows it: its latest standing, with its change in words and the standings it went through. */
export interface LiveWriteView {
  key: string;
  role: string;
  phase: LivePhase;
  outcome: LiveWriteOutcome;
  changeType?: string;
  lines: string[];
  code?: string;
  reason?: string;
  why?: LiveDropWhy;
  history: LiveWriteOutcome[];
}

/** How a group stands: an agent still at work, done, failed, stopped short (a limit, the loop detector), or cancelled. */
export type LiveStatus = "working" | "done" | "failed" | "stopped" | "cancelled";

/**
 * A group of the live view: one role run with its agents and writes (a nested role's run, such as a
 * skip's minds, inside its parent's), or one agent outside any run (the main agent's stage, its
 * compaction), by when it first appeared.
 */
export interface LiveGroup {
  type: "group";
  key: string;
  role: string;
  label: string;
  seq: number;
  /** When it first appeared (epoch ms). */
  at: number;
  run: Of<"run"> | null;
  ran: Of<"ran"> | null;
  agents: LiveAgentView[];
  writes: LiveWriteView[];
  status: LiveStatus;
}

/** A mark between groups: the turn's phase moving on, what stopped it, its wait at a gate and its resume, how its final review ended, and its plan. */
export interface LiveMark {
  type: "mark";
  entry: Of<"phase"> | Of<"failed"> | Of<"wait"> | Of<"resume"> | Of<"review"> | Of<"plan">;
}

export type LiveItem = LiveGroup | LiveMark;

/** The view's groups and marks, each group where it first appeared. */
export function liveItems(view: LiveView): LiveItem[] {
  const groups = new Map<string, LiveGroup>();
  const marks: LiveMark[] = [];
  const agents = new Map<string, LiveAgentView>();
  const group = (key: string, role: string, first: LiveEntry): LiveGroup => {
    let g = groups.get(key);
    if (!g) {
      g = { type: "group", key, role, label: agentLabel(role), seq: first.seq, at: first.at, run: null, ran: null, agents: [], writes: [], status: "working" };
      groups.set(key, g);
    }
    return g;
  };
  // A nested role's run (`run>role`) sits in its parent's group where there is one.
  const runKey = (run: string): string => {
    const parent = run.split(">")[0] ?? run;
    return groups.has(run) ? run : groups.has(parent) ? parent : run;
  };
  for (const e of view.entries) {
    switch (e.kind) {
      case "phase":
      case "failed":
      case "wait":
      case "resume":
      case "review":
      case "plan":
        marks.push({ type: "mark", entry: e });
        break;
      case "run": {
        const g = group(e.run, e.role, e);
        g.run = e;
        break;
      }
      case "ran": {
        const g = groups.get(e.run);
        if (g) g.ran = e;
        break;
      }
      case "agent": {
        const g = e.run !== undefined ? group(runKey(e.run), e.role, e) : group(e.agent, e.role, e);
        const a: LiveAgentView = { start: e, steps: [], idle: null };
        g.agents.push(a);
        agents.set(e.agent, a);
        break;
      }
      case "message":
      case "answer":
      case "tools_refused":
      case "result":
      case "stop":
        agents.get(e.agent)?.steps.push(e);
        break;
      case "idle": {
        const a = agents.get(e.agent);
        if (a) a.idle = e;
        break;
      }
      case "write": {
        const g = group(runKey(e.run), e.role, e);
        const w = g.writes.find((x) => x.key === e.key);
        if (w) {
          w.outcome = e.outcome;
          w.history.push(e.outcome);
          if (e.lines !== undefined) w.lines = e.lines;
          if (e.changeType !== undefined) w.changeType = e.changeType;
          w.code = e.code;
          w.reason = e.reason;
          w.why = e.why;
        } else g.writes.push({ key: e.key, role: e.role, phase: e.phase, outcome: e.outcome, ...(e.changeType !== undefined ? { changeType: e.changeType } : {}), lines: e.lines ?? [], ...(e.code !== undefined ? { code: e.code } : {}), ...(e.reason !== undefined ? { reason: e.reason } : {}), ...(e.why !== undefined ? { why: e.why } : {}), history: [e.outcome] });
        break;
      }
    }
  }
  for (const g of groups.values()) g.status = groupStatus(g, view.ended !== null);
  return [...groups.values(), ...marks].sort((a, b) => (a.type === "group" ? a.seq : a.entry.seq) - (b.type === "group" ? b.seq : b.entry.seq));
}

/** A group's status: a run's by how it ended; an agent's by its stop, if it stopped short; still working until then, stopped once the run ended without it. */
function groupStatus(g: LiveGroup, ended: boolean): LiveStatus {
  if (g.ran) return g.ran.ok ? "done" : g.ran.code === "cancelled" ? "cancelled" : "failed";
  const last = g.agents.at(-1);
  if (g.run === null && last?.idle) {
    const stop = last.steps.findLast((s) => s.kind === "stop");
    if (stop?.kind !== "stop") return "done";
    return stop.status === "cancelled" ? "cancelled" : stop.status === "failed" ? "failed" : "stopped";
  }
  if (g.run === null && g.agents.length === 0) return "done";
  return ended ? "stopped" : "working";
}

/** What a group's agents spent in all: tokens in and out, and the model time of their calls (ms). */
export function groupSpent(g: LiveGroup): { in: number; out: number; ms: number } {
  let sent = 0;
  let wrote = 0;
  let ms = 0;
  for (const a of g.agents)
    for (const s of a.steps) {
      if (s.kind !== "answer") continue;
      sent += s.usage.in;
      wrote += s.usage.out;
      ms += s.ms;
    }
  return { in: sent, out: wrote, ms };
}

/** The model an agent ran on: the one its latest answer names, else the one its settings named; null for the connection's own, not yet heard. */
export function agentModel(a: LiveAgentView): string | null {
  const answered = a.steps.findLast((s) => s.kind === "answer");
  return answered?.kind === "answer" && answered.model !== "" ? answered.model : a.start.model;
}

// ---------------------------------------------------------------- the transcript

/** Words for how a write stands, as the transcript and the page say them. */
export const WRITE_OUTCOME_WORDS: Readonly<Record<LiveWriteOutcome, string>> = { staged: "staged", landed: "landed", held: "held for the review card", refused: "refused", dropped: "dropped" };

/** Why a write was dropped, in words. */
export const DROP_WORDS: Readonly<Record<LiveDropWhy, string>> = { failed: "its run failed", replaced: "a revision replaced its run", unused: "the turn went on without its run", ended: "the turn's run ended" };

/** How a run ended, in words. */
export const END_WORDS: Readonly<Record<LiveEndState, string>> = { done: "done", waiting: "waiting at a gate", failed: "failed", cancelled: "cancelled", dropped: "let go" };

/** A phase mark, in words. */
export const PHASE_WORDS: Readonly<Record<LivePhase, string>> = { pre: "Before the plan", plan: "The plan is made", post: "The reply is in: its read" };

/** How the final review ended, in words. */
export const REVIEW_OUTCOME_WORDS: Readonly<Record<LiveReviewOutcome, string>> = { revised: "The final review revised the narrator's prompt", unchanged: "The final review left the narrator's prompt as the engine made it", unrevised: "The final review failed: the narrator got its prompt unrevised", stopped: "The final review failed: the turn stopped" };

/** One edit of the final review in a line: its part, and what it did to which line. */
export function reviewEditWords(e: LiveReviewEdit): string {
  if (e.op === "append") return `${e.label}: added “${e.text ?? ""}”`;
  if (e.op === "drop") return `${e.label}: took out “${e.line ?? ""}”`;
  return `${e.label}: “${e.line ?? ""}” → “${e.text ?? ""}”`;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const count = (n: number): string => n.toLocaleString("en-US");

/** A call's usage in words: "1,204 in (800 cached) · 56 out (12 reasoning)". */
export function usageWords(u: { in: number; out: number; cachedIn?: number; reasoningOut?: number }): string {
  const cached = u.cachedIn ? ` (${count(u.cachedIn)} cached)` : "";
  const reasoning = u.reasoningOut ? ` (${count(u.reasoningOut)} reasoning)` : "";
  return `${count(u.in)} in${cached} · ${count(u.out)} out${reasoning}`;
}

/** A tool call in one line: its name and its arguments as JSON. */
export function callWords(c: { name: string; args: JsonObject }): string {
  return `${c.name} ${JSON.stringify(c.args)}`;
}

function fenced(text: string): string {
  const fence = text.includes("```") ? "~~~~" : "```";
  return `${fence}\n${text}\n${fence}`;
}

/**
 * The run's transcript as text (Markdown), as its record keeps it and GM → Workspace shows it: the
 * player's words and how the run went, then each group in the order it started, every agent's system
 * prompt (once per role while it stays the same), messages, reasoning, answers, tool calls with their
 * arguments and results, stops, tokens and times, each write and what came of it, the turn's phases,
 * waits and failures between, and how it ended.
 */
export function transcriptText(view: LiveView): string {
  const out: string[] = [];
  const kind = view.kind === "turn" ? "Agent turn" : view.kind === "read" ? "The reply read again" : "A reply's read";
  out.push(`# ${kind}`);
  if (view.text.trim() !== "") out.push(`Player: ${view.text}`);
  const ended = view.ended ? `ended ${END_WORDS[view.ended.state]} after ${seconds(view.ended.at - view.startedAt)}${view.ended.reason ? `: ${view.ended.reason}` : ""}` : "still running";
  out.push(`${view.pipeline === "main" ? "Main agent" : "Fixed pipeline"} · started ${new Date(view.startedAt).toISOString()} · ${ended}`);
  const told = new Map<string, string>();
  for (const item of liveItems(view)) {
    if (item.type === "mark") {
      const e = item.entry;
      if (e.kind === "phase") out.push(`--- ${PHASE_WORDS[e.phase]} (+${seconds(e.at - view.startedAt)}) ---`);
      else if (e.kind === "failed") out.push(`!!! The turn stopped at ${e.step}: ${e.reason}`);
      else if (e.kind === "wait") out.push(`--- Waiting on the player at a gate (+${seconds(e.at - view.startedAt)}) ---`);
      else if (e.kind === "resume") out.push(`--- Resumed (+${seconds(e.at - view.startedAt)}) ---`);
      else if (e.kind === "plan") out.push([`--- This turn's plan (+${seconds(e.at - view.startedAt)}) ---`, ...e.rows.map((r) => `- ${agentLabel(r.role)}: ${PLAN_STATUS_WORDS[r.status]}. ${r.why}`)].join("\n"));
      else out.push([`--- ${REVIEW_OUTCOME_WORDS[e.outcome]}${e.reason ? `: ${e.reason}` : ""} (+${seconds(e.at - view.startedAt)}) ---`, ...e.edits.map((edit) => `- ${reviewEditWords(edit)}`)].join("\n"));
      continue;
    }
    const spent = groupSpent(item);
    const via = item.run ? ` · ${item.run.via === "prompt_only" ? "prompt-only" : "agent"}` : "";
    out.push(`## ${item.label}${via} · ${item.status} · +${seconds(item.at - view.startedAt)}${spent.in + spent.out > 0 ? ` · ${usageWords(spent)}` : ""}`);
    if (item.ran && !item.ran.ok) out.push(`Failed (${item.ran.code ?? "error"}): ${item.ran.reason ?? ""}`);
    for (const a of item.agents) {
      const where = [a.start.stage ?? a.start.phase, a.start.task].filter((w) => w !== undefined && w !== "").join(" · ");
      out.push(`### ${agentLabel(a.start.role)}${where !== "" ? ` · ${where}` : ""} · ${agentModel(a) ?? "the connection's model"}${a.start.connection ? ` on ${a.start.connection}` : ""} · effort ${a.start.effort}`);
      const system = [...a.start.prefix, a.start.system].join("\n\n");
      if (told.get(a.start.role) === system) out.push("System prompt: as before.");
      else {
        told.set(a.start.role, system);
        out.push(`System prompt:\n${fenced(system)}`);
      }
      if (a.start.history > 0) out.push(`Takes up ${count(a.start.history)} message${a.start.history === 1 ? "" : "s"} of its session (GM → Workspace shows the session).`);
      for (const s of a.steps) {
        if (s.kind === "message") out.push(`Sent:\n${fenced(s.text)}`);
        else if (s.kind === "answer") {
          out.push(`Answered · ${s.model || "model"} · ${usageWords(s.usage)} · ${seconds(s.ms)} · ${s.finish || "stop"}`);
          if (s.reasoning) out.push(`Reasoning:\n${fenced(s.reasoning)}`);
          if (s.text.trim() !== "") out.push(fenced(s.text));
          for (const c of s.calls) out.push(`→ ${callWords(c)}`);
        } else if (s.kind === "result") out.push(`← ${s.name}${s.error ? " (failed)" : ""} · ${seconds(s.ms)}:\n${fenced(s.text)}`);
        else if (s.kind === "tools_refused") out.push(`Its connection refused native tools, so the round went again with them as text: ${s.reason}`);
        else out.push(`Stopped (${s.status}, ${s.code}): ${s.reason}`);
      }
      if (a.idle) out.push(`Finished its message · ${usageWords(a.idle.usage)}`);
    }
    for (const w of item.writes) {
      const why = w.outcome === "refused" ? `: ${w.reason ?? w.code ?? ""}` : w.outcome === "dropped" && w.why ? `: ${DROP_WORDS[w.why]}` : "";
      out.push(`- Write ${w.key.slice(0, 12)}${w.changeType ? ` (${w.changeType})` : ""}: ${w.history.map((o) => WRITE_OUTCOME_WORDS[o]).join(" → ")}${why}${w.lines.length > 0 ? `\n  ${w.lines.join("\n  ")}` : ""}`);
    }
  }
  if (view.ended) out.push(`## Ended: ${END_WORDS[view.ended.state]}${view.ended.reason ? `: ${view.ended.reason}` : ""}`);
  return `${out.join("\n\n")}\n`;
}
