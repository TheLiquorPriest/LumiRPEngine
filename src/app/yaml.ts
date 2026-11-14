// One top-level key of a YAML file the user also edits (`RPE-global.yml`), changed without touching
// the rest of the file: the user's comments, order and layout elsewhere stay as they wrote them.

import { YAML } from "bun";

/** `value` as JSON with every object's keys sorted, so two values compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The YAML document in `text` as a mapping; `{}` for an empty file. Throws for text that is not one mapping. */
export function yamlMapping(text: string, where: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (error) {
    throw new Error(`${where} is not YAML that RPE can read (${error instanceof Error ? error.message : String(error)}): fix it, then try again.`);
  }
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${where} must hold one mapping of names to values.`);
  return doc as Record<string, unknown>;
}

/**
 * `text` with its top-level `key` set to `value`. The key's own block (its line, and the indented
 * and blank lines under it) is replaced, or added at the end; every other line is kept as it was.
 * When that would not read back as the same document with only `key` changed (a layout this does
 * not follow, such as a flow-style block running over lines at the margin), the document is written
 * whole instead, which keeps every value but not the comments.
 */
export function withTopLevelKey(text: string, key: string, value: unknown, where: string): string {
  const before = yamlMapping(text, where);
  const wanted = { ...before, [key]: value };
  // Bun writes a space after a key whose value starts on the next line; it is left off.
  const block = YAML.stringify({ [key]: value }, null, 2).replace(/:[ ]+$/gm, ":").replace(/\n+$/, "").split("\n");
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  let next: string[];
  if (at === -1) {
    const kept = text.replace(/\n+$/, "");
    next = kept === "" ? block : [...kept.split("\n"), "", ...block];
  } else {
    let end = at + 1;
    while (end < lines.length && (lines[end] === "" || /^[ \t]/.test(lines[end] ?? ""))) end++;
    while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end--;
    next = [...lines.slice(0, at), ...block, ...lines.slice(end)];
  }
  const spliced = `${next.join("\n").replace(/\n+$/, "")}\n`;
  let reread: unknown = null;
  try {
    reread = YAML.parse(spliced);
  } catch {
    // Read below as a mismatch.
  }
  if (canonical(reread ?? {}) === canonical(wanted)) return spliced;
  return YAML.stringify(wanted, null, 2).replace(/:[ ]+$/gm, ":");
}
