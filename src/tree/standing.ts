// What RPH itself makes of the files of a chat's view (plan §5.2, §14 Files): which rule it holds out
// because what its `needs:` names is not in force, or because its header does not parse, what it found
// wrong with a file in its own words, and which agents' stacks each instruction file and rule joins
// (a file `instructions:` names joins every stack it reaches). RPH is the one that lists them (its rules,
// its definitions and their stacks, what it found wrong with a file that runs or calls out); this asks
// it and hands the answer to the listing, so the page shows a file as RPH will find it.

import type { DefinitionView, ExternalEntry, RuleView, StackPart, SwitchState } from "rp-harness/contract";
import type { TreeFileEntry } from "./catalog";

/** What the tree reads of RPH's own listing of the files in force for a chat's view (or, with no chat, the shipped and global levels). */
export interface GuidanceReads {
  rules(): Promise<readonly RuleView[]>;
  definitions(): Promise<readonly DefinitionView[]>;
  stack(agent: string): Promise<readonly StackPart[]>;
  /** Everything the files name that runs a command or calls out, as RPH lists it (`Harness.external`): the hooks in force among them, each with where its command stands, and what keeps one from working, in RPH's words. */
  external(): Promise<readonly ExternalEntry[]>;
}

/** What RPH says of one file. */
export interface FileStanding {
  held: "needs" | "broken" | null;
  problems: string[];
  joins: string[];
  /** For a hooks file: each hook of it RPH runs, by name, with where its command stands. */
  hooks: Map<string, SwitchState>;
}

/** RPH's standing of every file it has something to say of, by its path in the chat's view. */
export async function rphStanding(reads: GuidanceReads): Promise<Map<string, FileStanding>> {
  const [external, rules, definitions] = await Promise.all([reads.external(), reads.rules(), reads.definitions()]);
  const out = new Map<string, FileStanding>();
  const at = (path: string): FileStanding => {
    const found = out.get(path) ?? { held: null, problems: [], joins: [], hooks: new Map() };
    out.set(path, found);
    return found;
  };
  for (const e of external) {
    if (e.problem !== undefined) at(e.path).problems.push(e.problem);
    if (e.kind === "hook") at(e.path).hooks.set(e.name, e.state);
  }
  for (const r of rules) if (r.why === "needs" || r.why === "broken") at(r.path).held = r.why;
  const stacks = await Promise.all(definitions.filter((d) => !d.off).map(async (d) => [d.name, await reads.stack(d.name)] as const));
  for (const [agent, stack] of stacks) {
    for (const e of stack) if (e.left === undefined && e.kind !== "definition" && e.kind !== "given" && !at(e.path).joins.includes(agent)) at(e.path).joins.push(agent);
  }
  return out;
}

/** An entry as RPH stands to it: RPH's words about it, the agents whose stacks it joins, a rule it holds out is not in force, and where each of its hooks' commands stands. */
export function withStanding(entry: TreeFileEntry, standing: ReadonlyMap<string, FileStanding>): TreeFileEntry {
  const s = standing.get(entry.path);
  const guided = entry.item !== null && /^(agents|skills|rules)\//.test(entry.item);
  const held = s?.held ?? (guided && (s?.problems.length ?? 0) > 0 ? "broken" : null);
  const hooks = entry.hooks?.map((h) => {
    const state = s?.hooks.get(h.name);
    return state === undefined ? h : { ...h, state };
  });
  return { ...entry, applies: entry.applies && held === null, held, problems: s?.problems ?? [], joins: s?.joins ?? [], ...(hooks === undefined ? {} : { hooks }) };
}
