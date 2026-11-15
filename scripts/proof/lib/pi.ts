// The three places pi's loop fell short, re-checked against the pinned pi and RPH as they now stand
// (PlanGates-24 item 4; plan §18.1 row 0.2's fail column, "you are told before wave 1, with the choice of
// fixing around pi or keeping LumiAH's loop for now"; §13.3, §13.7). Phase 0's report (`P0Loop`, §5) found
// them on pi 1.5.2: a stop that pi alone does not carry through, follow-ups pi still reads after a batch
// that ended the run, and sampling pi-ai applies only on OpenAI-compatible connections. This file asks each
// of the installed source for what that finding stood on, by the line it is on now (never by a line number
// written here), and for what RPH does around it; it says plainly where a finding no longer reads as it did.
// A probe is a pattern and a place: nothing here runs pi.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";

/** Where the installed sources are: pi's loop package, pi-ai, and RPH as RPE has it pinned. */
export interface Roots {
  core: string;
  ai: string;
  rph: string;
}

/** The root a probe reads under. */
export type In = keyof Roots;

/** One thing a source is asked for: a pattern on one line of a file (a folder: of any `.js` or `.ts` file below it, declarations aside). */
export interface Probe {
  in: In;
  /** Below the root: a file, or a folder. */
  path: string;
  /** Tested on each line. */
  pattern: RegExp;
  /** What finding it stands for, in words. */
  what: string;
}

/** What one probe found now. */
export interface Found {
  what: string;
  /** The file and line where it was found, below its root, with the line itself; null where it was not found. */
  at: string | null;
  text: string | null;
}

/** One finding of Phase 0 about pi's loop. */
export interface LoopFinding {
  id: "terminate-follow-up" | "stop" | "sampling";
  title: string;
  /** What the plan says of it, in the plan's own place. */
  plan: string;
  /** What pi does, as the finding states it: each probe is a thing it stands on. */
  pi: readonly Probe[];
  /** What RPH does around it. */
  around: readonly Probe[];
}

export const LOOP_FINDINGS: readonly LoopFinding[] = [
  {
    id: "stop",
    title: "A stop is not carried through by pi's own abort",
    plan: '§13.3 "Stop": `abort()`, and three things pi leaves undone that RPH does: it does not wait for a tool that ignores the stop; it drops events pi had already queued and lets no further model request start; and it closes any tool call left without a result, so the transcript can be continued later.',
    pi: [
      { in: "core", path: "dist/agent-loop.js", pattern: /await prepared\.tool\.execute\(/, what: "pi awaits a tool until it settles, whatever the stop says" },
      { in: "core", path: "dist/agent-loop.js", pattern: /createErrorToolResult\("Operation aborted"\)/, what: 'a tool call the stop cut off is answered with pi\'s own words, "Operation aborted"' },
      { in: "ai", path: "dist/api/transform-messages.js", pattern: /No result provided/, what: 'a tool call left without a result is answered "No result provided" when the transcript is sent again' },
    ],
    around: [
      { in: "rph", path: "src/loop/runner.ts", pattern: /this\.#pi\.abort\(\)/, what: "RPH aborts pi's call at a stop" },
      { in: "rph", path: "src/loop/runner.ts", pattern: /pi waits on a tool until it settles; a stop does not/, what: "RPH's stop does not wait on a tool" },
      { in: "rph", path: "src/loop/runner.ts", pattern: /last\.stopReason === "aborted" \|\| last\.stopReason === "error"/, what: "RPH takes a message that was cut short or failed out of the transcript, so pi's own words are never kept" },
    ],
  },
  {
    id: "terminate-follow-up",
    title: "pi still reads follow-ups after a batch that ended the run",
    plan: "§13.3 \"A turn in one call\" and \"Rules at a run's end\": a tool result can set `terminate`, and the run ends without another model call when every result in the batch does; pi still reads follow-ups after such a batch, so a rule due at the run's end goes in as a follow-up and costs exactly one more call.",
    pi: [
      { in: "core", path: "dist/agent-loop.js", pattern: /hasMoreToolCalls = !executedToolBatch\.terminate/, what: "a batch whose every result sets terminate leaves no tool call to go on with" },
      { in: "core", path: "dist/agent-loop.js", pattern: /getFollowUpMessages/, what: "and the loop still asks for follow-up messages once the batch is in" },
    ],
    around: [
      { in: "rph", path: "src/loop/runner.ts", pattern: /return \{ terminate: true \}/, what: "RPH sets terminate on a closing call that came back clean" },
      { in: "rph", path: "src/loop/runner.ts", pattern: /this\.#pi\.followUp\(/, what: "what is due at the run's end goes in as a follow-up, which gives the agent exactly one more call" },
    ],
  },
  {
    id: "sampling",
    title: "pi-ai applies sampling per request only on OpenAI-compatible connections",
    plan: '§13.3 "Throttles per connection, sampling per call": around the model call RPH passes to the loop; §10.2: the preset\'s sampling and length limit apply exactly only to a narrator\'s call, and the Author\'s own sampling is a setting.',
    pi: [{ in: "ai", path: "dist/types.d.ts", pattern: /OpenAI-compatible adapters \(completions, responses, Azure responses\); other APIs ignore it/, what: "the sampling parameters pi does not model (top_p, top_k, min_p, the penalties) are applied by OpenAI-compatible adapters only; other APIs ignore them" }],
    around: [
      { in: "rph", path: "src/model/call.ts", pattern: /setAll\(payload, sampling, \{ top_p: "top_p", top_k: "top_k" \}\)/, what: "RPH sets them in the request's own fields for Anthropic" },
      { in: "rph", path: "src/model/call.ts", pattern: /setAll\(payload, sampling, \{ top_p: "topP"/, what: "and for the others whose request names them its own way" },
      { in: "rph", path: "src/model/call.ts", pattern: /samplingParams: rest/, what: "and passes them to pi as `samplingParams` for an OpenAI-compatible connection" },
    ],
  },
];

/** Every source file below a folder, the declarations and maps left out. */
function sources(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".map")) out.push(path);
  }
  return out;
}

/** The first line a probe's pattern is found on, below its root, or null: a file is read as it is, a folder through every source below it. */
export function search(roots: Roots, probe: Probe): Found {
  const root = roots[probe.in];
  const place = join(root, probe.path);
  if (!existsSync(place)) return { what: probe.what, at: null, text: null };
  const files = statSync(place).isDirectory() ? sources(place) : [place];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    const at = lines.findIndex((line) => probe.pattern.test(line));
    if (at !== -1) return { what: probe.what, at: `${file.slice(root.length + 1)}:${at + 1}`, text: (lines[at] as string).trim().slice(0, 240) };
  }
  return { what: probe.what, at: null, text: null };
}

/** One finding as it stands now. */
export interface Rechecked {
  id: LoopFinding["id"];
  title: string;
  plan: string;
  /** What pi does now and what RPH does around it, each found or not. */
  pi: Found[];
  around: Found[];
  /** Whether the finding reads now as it did: every probe of pi found, and everything RPH does around it still done. */
  holds: boolean;
}

/** The version of a package in a root, or null. */
export function versionOf(root: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return isRecord(parsed) && typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Each finding asked of the installed sources, in the findings' order. */
export function recheck(roots: Roots, findings: readonly LoopFinding[] = LOOP_FINDINGS): Rechecked[] {
  return findings.map((f) => {
    const pi = f.pi.map((p) => search(roots, p));
    const around = f.around.map((p) => search(roots, p));
    return { id: f.id, title: f.title, plan: f.plan, pi, around, holds: [...pi, ...around].every((found) => found.at !== null) };
  });
}

/** The installed sources the findings are asked of, below RPE's repository: pi's loop package and pi-ai as `package.json` pins them, and RPH as RPE has it pinned. */
export function installedRoots(repo: string): Roots {
  return { core: join(repo, "node_modules", "@earendil-works", "pi-agent-core"), ai: join(repo, "node_modules", "@earendil-works", "pi-ai"), rph: join(repo, "node_modules", "rp-harness") };
}
