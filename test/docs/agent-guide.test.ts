// The JSON Patch examples in docs/AGENT-GUIDE.md's minds and money sections, taken from the page
// itself and applied in order to the modern starter as lre_edit would: the world still loads, they
// bring in no lint error or warning, and it still conforms to the published schema. An agent copies
// these, so a wrong field name or a refused value here is a broken world there.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { STARTER_WORLDS } from "../../src/packs/index";
import { isRecord, type JsonValue } from "../../src/shared/json";
import { applyPatch, readOp } from "../../src/shared/json-patch";
import type { WorldDoc } from "../../src/shared/world";
import { checkSchema, lint, load, MAP_SCHEMA, pathText, type Schema } from "../../src/studio-api";

const PAGE = readFileSync(join(import.meta.dir, "../../docs/AGENT-GUIDE.md"), "utf8");
// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = schemaJson as unknown as Schema;
const SECTIONS = ["Character minds", "Money"];

/** The section under the `## ` heading `title`, up to the next one. */
function section(title: string): string {
  const found = PAGE.split("\n## ").find((s) => s.startsWith(`${title}\n`));
  if (found === undefined) throw new Error(`docs/AGENT-GUIDE.md has no section "${title}"`);
  return found;
}

/** Every JSON block of a section that is a JSON Patch (a list of operations), in page order. */
function patches(title: string): unknown[][] {
  const blocks = [...section(title).matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] ?? "null") as unknown);
  return blocks.filter((b): b is unknown[] => Array.isArray(b) && b.every((op) => isRecord(op) && typeof op.op === "string"));
}

const modern = (): WorldDoc => {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (make === undefined) throw new Error("no modern starter");
  return make("w_guide", "Port Alder");
};

/** Lint's errors and warnings, each as `path code`, to compare a world before and after. */
const problems = (world: WorldDoc): string[] =>
  lint(world)
    .filter((i) => i.severity !== "info")
    .map((i) => `${i.path} ${i.code}: ${i.message}`);

describe("the agent guide's examples", () => {
  test("each section shows at least one patch to copy", () => {
    for (const title of SECTIONS) expect({ title, patches: patches(title).length > 0 }).toEqual({ title, patches: true });
  });

  test("applied in order to a starter, they load, bring in no lint error or warning, and conform to the schema", () => {
    const before = modern();
    let doc = before as unknown as JsonValue;
    for (const title of SECTIONS) for (const ops of patches(title)) doc = applyPatch(doc, ops.map((op, n) => readOp(op, n)));
    const loaded = load(doc);
    if (!loaded.ok) throw new Error(loaded.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
    const had = new Set(problems(before));
    expect(problems(loaded.world).filter((p) => !had.has(p))).toEqual([]);
    expect(checkSchema(WORLD_SCHEMA, loaded.world, [MAP_SCHEMA]).map((p) => `${pathText(p.path)}: ${p.message}`)).toEqual([]);
  });

  test("every id their entities name is in the starter, so none reads as an outside payer by mistake", () => {
    const world = modern();
    let doc = world as unknown as JsonValue;
    for (const title of SECTIONS) for (const ops of patches(title)) doc = applyPatch(doc, ops.map((op, n) => readOp(op, n)));
    const after = doc as unknown as WorldDoc;
    const added = Object.values(after.entities).filter((e) => !(e.id in world.entities));
    expect(added.length).toBeGreaterThan(0);
    const assets = after.packs.economy?.config.assets;
    const missing: string[] = [];
    for (const e of added) {
      const f = e.fields;
      // Fields that only ever hold an id; `from`, `to` and `employer` also take an outside party's name, which has spaces or capitals.
      for (const key of ["account", "worker", "autopay_from", "from", "to", "employer"]) {
        const v = f[key];
        if (typeof v === "string" && /^[a-z0-9_]+$/.test(v) && !(v in after.entities)) missing.push(`${e.id}.${key}: ${v}`);
      }
      if (typeof f.workplace === "string" && !(f.workplace in after.places)) missing.push(`${e.id}.workplace: ${f.workplace}`);
      if (typeof f.asset === "string" && !(isRecord(assets) && f.asset in assets)) missing.push(`${e.id}.asset: ${f.asset}`);
      for (const o of Array.isArray(f.owners) ? f.owners : []) if (isRecord(o) && typeof o.party === "string" && !(o.party in after.entities)) missing.push(`${e.id}.owners: ${o.party}`);
    }
    expect(missing).toEqual([]);
  });
});
