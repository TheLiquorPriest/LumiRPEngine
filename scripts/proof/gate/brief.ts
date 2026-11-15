// The review brief (PlanScenarios-5 item 6; plan §18.3 l.1976, §18.4 l.2005; decision 87): what an independent reviewer is given at every wave's end and for the final review. It holds the
// plan's sections, `INTENT.md`, the wave's whole diff between two named commits (the result that ships, never a snapshot of a tree still changing), and the gap ids claimed closed with their
// file and line. It holds nothing of the lanes' reasoning or reports, and no list of what not to report: the reviewers re-check every claimed gap against the code and may report anything
// missing. The two commits are whole (40 hex digits), exist in the repository, and the first is an ancestor of the second.

import { WHOLE_COMMIT, type GapClaim } from "../checkpoint/wave";

export interface BriefInput {
  wave: number;
  /** The plan's sections the reviewer reads in full, as the plan names them (`§17.0 l.1745-1753`). */
  sections: readonly string[];
  /** Where the plan and `INTENT.md` are, as paths the reviewer opens. */
  plan: string;
  intent: string;
  /** The repository the diff is of, and the two commits it lies between. */
  repo: string;
  from: string;
  to: string;
  gaps: readonly GapClaim[];
}

/** A git command's output in `repo`, or why it gave none. */
export type Git = (repo: string, args: string[]) => { out: string } | { failed: string };

export const git: Git = (repo, args) => {
  const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  return done.exitCode === 0 ? { out: done.stdout.toString() } : { failed: done.stderr.toString().trim() || `git ${args.join(" ")} exited ${done.exitCode}` };
};

/** Why the brief cannot be made as the plan asks it; empty when it can. */
export function briefProblems(input: BriefInput, run: Git = git): string[] {
  const problems: string[] = [];
  for (const [name, commit] of [["from", input.from], ["to", input.to]] as const) {
    if (!WHOLE_COMMIT.test(commit)) problems.push(`the ${name} commit is not a whole commit (40 hex digits): ${commit === "" ? "none is named" : commit}`);
    else if ("failed" in run(input.repo, ["cat-file", "-e", `${commit}^{commit}`])) problems.push(`the ${name} commit ${commit} is not a commit of ${input.repo}`);
  }
  if (problems.length > 0) return problems;
  if (input.from === input.to) problems.push("the two commits are one: a wave's diff lies between two");
  else if ("failed" in run(input.repo, ["merge-base", "--is-ancestor", input.from, input.to])) problems.push("the first commit is not an ancestor of the second, so the diff between them is not the wave's");
  if (input.sections.length === 0) problems.push("no section of the plan is named for the reviewer to read");
  for (const gap of input.gaps) if (gap.file.trim() === "" || !Number.isInteger(gap.line) || gap.line < 1) problems.push(`the gap ${gap.id} has no file and line`);
  return problems;
}

/** The brief, as text. It throws, naming each problem, where it cannot be made. */
export function brief(input: BriefInput, run: Git = git): string {
  const problems = briefProblems(input, run);
  if (problems.length > 0) throw new Error(`the review brief for wave ${input.wave} cannot be made: ${problems.join("; ")}`);
  const stat = run(input.repo, ["diff", "--stat", input.from, input.to]);
  const changed = "out" in stat ? stat.out.trimEnd() : "(the list of changed files could not be read)";
  const gaps = input.gaps.length === 0 ? ["None is claimed closed in this wave."] : input.gaps.map((g) => `- ${g.id}: ${g.file}:${g.line}`);
  return [
    `# Review of wave ${input.wave}`,
    "",
    "You review the changes of this wave independently. Read the plan's sections and the intent first, then the diff.",
    "",
    "## The plan and the intent",
    "",
    `The plan is \`${input.plan}\`. Read these sections of it in full:`,
    "",
    ...input.sections.map((s) => `- ${s}`),
    "",
    `The intent is \`${input.intent}\`.`,
    "",
    "## The changes",
    "",
    `The wave's whole diff lies between two commits of \`${input.repo}\`, the result that ships:`,
    "",
    `- from ${input.from}`,
    `- to ${input.to}`,
    "",
    `Read it with \`git -C ${input.repo} diff ${input.from} ${input.to}\`. The files it changes:`,
    "",
    "```",
    changed,
    "```",
    "",
    "## The gaps claimed closed",
    "",
    ...gaps,
    "",
    "## What you do",
    "",
    "Check each gap claimed closed against the code at the second commit, at the file and line named. Report anything that is missing or wrong, whether it is among the gaps claimed or not: each finding with its file and line, what the plan requires there, and what the code does.",
    "",
  ].join("\n");
}
