// How a tool answers, on either side of the connection (DESIGN §23): the command line's own tools
// and the ones LumiRPEngine serves outside clients (`lre.tools`) answer alike. Every answer is text,
// JSON for data; a refusal is an error result whose words say what to do instead, with the lint
// behind a refused write in severity order.

import type { LintIssue } from "./protocol";

/**
 * One tool's answer. `isError`: the call was refused or failed (MCP's tool error). `failed`: the
 * call worked and found the world failing (a check with errors), which the command line exits 1 on.
 */
export interface ToolResult {
  text: string;
  isError?: true;
  failed?: true;
}

/** A tool's data, as the text of its answer. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

const RANK: Record<LintIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

export interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
  /** The first issues, errors first. */
  first: LintIssue[];
  /** How many more there are beyond `first`. */
  more: number;
}

export function lintSummary(issues: readonly LintIssue[], shown = 12): LintSummary {
  const sorted = ranked(issues);
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
    first: sorted.slice(0, shown),
    more: Math.max(0, sorted.length - shown),
  };
}

/** Issues as an answer lists them: errors, then warnings, then infos, each in the engine's order; those `first` holds lead (the new ones). */
export function ranked(issues: readonly LintIssue[], first?: ReadonlySet<LintIssue>): LintIssue[] {
  return [...issues].sort((a, b) => Number(first?.has(b) === true) - Number(first?.has(a) === true) || RANK[a.severity] - RANK[b.severity]);
}

/** What a call answers when LumiRPEngine refused one of its requests (`lre.error`): the refusal's code and words, and the lint behind a refused write. */
export function refusedText(code: string, message: string, lint: readonly LintIssue[]): string {
  return `LumiRPEngine refused it (${code}): ${message}${lint.length > 0 ? `\n${json(lintSummary(lint, 30))}` : ""}`;
}

/** What a call answers when its tool failed in a way it doesn't word itself. */
export function failedText(error: unknown): string {
  return `The tool failed: ${error instanceof Error ? error.message : String(error)}`;
}
