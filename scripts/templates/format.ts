// A deterministic JSON layout for the committed starter worlds: every value that fits on a line
// stays on one, bigger objects and arrays break one child per line. Diffs stay readable and the
// default tables take a line per row.

import type { JsonValue } from "../../src/shared/json";

function compact(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(compact).join(", ")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${compact(x)}`).join(", ")}}`;
  return JSON.stringify(v);
}

export function formatJson(v: JsonValue, indent = 0, width = 150): string {
  const pad = "  ".repeat(indent);
  const flat = compact(v);
  if (typeof v !== "object" || v === null || flat.length + pad.length <= width) return flat;
  if (Array.isArray(v)) return `[\n${v.map((x) => `${pad}  ${formatJson(x, indent + 1, width)}`).join(",\n")}\n${pad}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${formatJson(x, indent + 1, width)}`).join(",\n")}\n${pad}}`;
}
