// Runs texts through a Lumiverse host's own macro evaluator, twice, as prompt assembly can (a message still holding `{{` after the first pass is evaluated again). The evaluator
// runs in a child `bun` process inside the host checkout named by `LRE_HOST_REPO`, so its imports
// resolve there and stay out of this project's typecheck. Without a checkout the test using this
// is skipped with that reason; the lexer-contract test runs everywhere.

import { existsSync } from "node:fs";

/** The host checkout (`LRE_HOST_REPO`), when one is configured and present. */
export const HOST_REPO = process.env.LRE_HOST_REPO && existsSync(`${process.env.LRE_HOST_REPO}/src/macros/index.ts`) ? process.env.LRE_HOST_REPO : null;

export interface TwoPassResult {
  first: string;
  second: string;
  /** Variables any pass set (a `setvar` that ran). */
  vars: Record<string, string>;
}

const probe = (repo: string): string => `
import { evaluate, initMacros, registry } from ${JSON.stringify(`${repo}/src/macros/index.ts`)};
initMacros();
const blank = (keys) => Object.fromEntries(keys.map((k) => [k, ""]));
const envOf = () => ({
  commit: true,
  names: { ...blank(["group", "groupNotMuted", "groupOthers", "groupLastSpeaker"]), user: "Alice", char: "Bob", notChar: "Alice", charGroupFocused: "Bob", groupMemberCount: "0", isGroupChat: "no", isNarrator: "no", groupCardMode: "solo" },
  character: blank(["name", "description", "personality", "scenario", "persona", "personaSubjectivePronoun", "personaObjectivePronoun", "personaPossessivePronoun", "personaReflexivePronoun", "personaPossessivePronounStandalone", "mesExamples", "mesExamplesRaw", "systemPrompt", "postHistoryInstructions", "depthPrompt", "creatorNotes", "version", "creator", "firstMessage"]),
  chat: { id: "probe", messageCount: 1, lastMessage: "", lastMessageName: "", lastUserMessage: "", lastCharMessage: "", lastMessageId: 0, firstIncludedMessageId: 0, lastSwipeId: 0, currentSwipeId: 0, rejectedSwipe: "" },
  system: { model: "probe", maxPrompt: 0, maxContext: 0, maxResponse: 0, lastGenerationType: "normal", isMobile: false },
  variables: { local: new Map(), global: new Map(), chat: new Map() },
  dynamicMacros: {},
  extra: { messages: [] },
});
const texts = JSON.parse(process.env.LRE_PROBE_TEXTS ?? "[]");
const out = [];
for (const text of texts) {
  const env = envOf();
  const first = (await evaluate(text, env, registry)).text;
  const second = (await evaluate(first, env, registry)).text;
  const vars = {};
  for (const scope of ["local", "global", "chat"]) for (const [k, v] of env.variables[scope]) vars[k] = String(v);
  out.push({ first, second, vars });
}
console.log(JSON.stringify(out));
`;

/** Each text after two host evaluator passes, with the variables they set. Throws when the host checkout can't run it. */
export function hostTwoPass(repo: string, texts: readonly string[]): TwoPassResult[] {
  const run = Bun.spawnSync({ cmd: ["bun", "-e", probe(repo)], cwd: repo, env: { ...process.env, LRE_PROBE_TEXTS: JSON.stringify(texts) }, stdout: "pipe", stderr: "pipe" });
  const lines = run.stdout.toString().trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (run.exitCode !== 0 || !last.startsWith("[")) throw new Error(`host macro probe failed in ${repo} (exit ${run.exitCode}): ${run.stderr.toString().slice(0, 400)}`);
  return JSON.parse(last) as TwoPassResult[];
}
