// The JSON Patch examples of docs/AGENT-GUIDE.md, read from the page itself, so the tests check
// what an agent copies rather than a copy of it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../src/shared/json";

const PAGE = readFileSync(join(import.meta.dir, "../../docs/AGENT-GUIDE.md"), "utf8");

/** The sections whose examples are written against the modern starter, applied in this order. */
export const GUIDE_SECTIONS = ["Character minds", "Money"];

/** The section under the `## ` heading `title`, up to the next one. */
export function guideSection(title: string): string {
  const found = PAGE.split("\n## ").find((s) => s.startsWith(`${title}\n`));
  if (found === undefined) throw new Error(`docs/AGENT-GUIDE.md has no section "${title}"`);
  return found;
}

/** Every JSON block of a section that is a JSON Patch (a list of operations), in page order. */
export function guidePatches(title: string): unknown[][] {
  const blocks = [...guideSection(title).matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] ?? "null") as unknown);
  return blocks.filter((b): b is unknown[] => Array.isArray(b) && b.every((op) => isRecord(op) && typeof op.op === "string"));
}
