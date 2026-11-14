// The shipped prompt parts as the agents' guidance loads them: the shipped level of a folder host, so a
// test lays a block out with the very file the user can edit. Holds no tests.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type LinesPart, loadGuidance, type TemplatePart } from "rp-harness";
import { createFolderHost } from "rp-harness/hosts/folder";

const PROMPTS = resolve(import.meta.dir, "../../guidance/.prompts");

export interface ShippedParts {
  template(name: string): TemplatePart;
  lines(name: string): LinesPart;
  remove(): void;
}

/** Loads the shipped prompt parts `names` names. */
export async function shippedParts(names: readonly string[]): Promise<ShippedParts> {
  const dir = mkdtempSync(join(tmpdir(), "rpe-migrate-parts-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  for (const name of names) copyFileSync(join(PROMPTS, `${name}.md`), join(dir, "files", "defaults", ".prompts", `${name}.md`));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const guidance = loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" });
  const problems = await guidance.problems();
  if (problems.length > 0) throw new Error(`The shipped parts did not load: ${JSON.stringify(problems)}`);
  const parts = new Map(await Promise.all(names.map(async (name) => [name, await guidance.part(name)] as const)));
  return {
    template(name) {
      const part = parts.get(name);
      if (part?.format !== "template") throw new Error(`The shipped ${name} part did not load as a template.`);
      return part;
    },
    lines(name) {
      const part = parts.get(name);
      if (part?.format !== "lines") throw new Error(`The shipped ${name} part did not load as lines.`);
      return part;
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
