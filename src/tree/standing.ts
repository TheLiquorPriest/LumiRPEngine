// What RPH itself makes of the files of a chat's view (plan §5.2, §14 Files): which rule it holds out
// because what its `needs:` names is not in force, or because its header does not parse, what it found
// wrong with each file in its own words, and which agents' stacks each instruction file and rule joins
// (a file `instructions:` names joins every stack it reaches). RPH is the one that loads guidance; this
// asks it and hands the answer to the listing, so the page shows a file as RPH will find it.

import type { Guidance } from "rp-harness";
import type { TreeFileEntry } from "./catalog";

/** What RPH says of one file. */
export interface FileStanding {
  held: "needs" | "broken" | null;
  problems: string[];
  joins: string[];
}

/** RPH's standing of every file it has something to say of, by its path in the chat's view. */
export async function rphStanding(guidance: Guidance): Promise<Map<string, FileStanding>> {
  const [problems, rules, definitions] = await Promise.all([guidance.problems(), guidance.rules(), guidance.definitions()]);
  const out = new Map<string, FileStanding>();
  const at = (path: string): FileStanding => {
    const found = out.get(path) ?? { held: null, problems: [], joins: [] };
    out.set(path, found);
    return found;
  };
  for (const p of problems) at(p.path).problems.push(p.line === undefined ? p.message : `Line ${p.line}: ${p.message}`);
  for (const r of rules) if (r.why === "needs" || r.why === "broken") at(r.path).held = r.why;
  const stacks = await Promise.all(definitions.filter((d) => !d.off).map(async (d) => [d.name, await guidance.stack(d.name)] as const));
  for (const [agent, stack] of stacks) {
    for (const e of stack.entries) if (e.left === undefined && e.kind !== "definition" && !at(e.path).joins.includes(agent)) at(e.path).joins.push(agent);
  }
  return out;
}

/** An entry as RPH stands to it: RPH's words about it, the agents whose stacks it joins, and a rule it holds out is not in force. */
export function withStanding(entry: TreeFileEntry, standing: ReadonlyMap<string, FileStanding>): TreeFileEntry {
  const s = standing.get(entry.path);
  const guided = entry.item !== null && /^(agents|skills|rules)\//.test(entry.item);
  const held = s?.held ?? (guided && (s?.problems.length ?? 0) > 0 ? "broken" : null);
  return { ...entry, applies: entry.applies && held === null, held, problems: s?.problems ?? [], joins: s?.joins ?? [] };
}
