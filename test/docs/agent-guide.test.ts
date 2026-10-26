// docs/AGENT-GUIDE.md's minds, money and routines sections, held to the engine. Their JSON Patch examples,
// taken from the page itself and applied in order to the modern starter as lre_edit would: the
// world still loads, they bring in no lint error or warning, and it still conforms to the
// published schema. An agent copies these, so a wrong field name or a refused value here is a
// broken world there. And the money features' levels, which an agent toggles by them.

import { describe, expect, test } from "bun:test";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { STARTER_WORLDS } from "../../src/packs/index";
import { FEATURE_DEFS } from "../../src/shared/finance";
import { isRecord, type JsonValue } from "../../src/shared/json";
import { applyPatch, getAt, parsePointer, readOp } from "../../src/shared/json-patch";
import type { WorldDoc } from "../../src/shared/world";
import { checkSchema, lint, load, MAP_SCHEMA, pathText, type Schema } from "../../src/cli/local-engine";
import { GUIDE_SECTIONS as SECTIONS, guidePatches as patches, guideSection } from "../support/agent-guide";

// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = schemaJson as unknown as Schema;

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

  test("none of them replaces what the starter has: each add lands on a key that isn't there yet", () => {
    let doc = modern() as unknown as JsonValue;
    const replaced: string[] = [];
    for (const title of SECTIONS) {
      for (const ops of patches(title)) {
        for (const [n, raw] of ops.entries()) {
          const op = readOp(raw, n);
          // An add onto a key that exists replaces it whole: a starter's flow or asset map would be lost.
          if (op.op === "add" && !op.path.endsWith("/-") && getAt(doc, parsePointer(op.path)) !== undefined) replaced.push(`${title}: ${op.path}`);
          doc = applyPatch(doc, [op]);
        }
      }
    }
    expect(replaced).toEqual([]);
  });

  test("every id the entities they add or change name is in the world, so none reads as an outside party by mistake", () => {
    const world = modern();
    let doc = world as unknown as JsonValue;
    for (const title of SECTIONS) for (const ops of patches(title)) doc = applyPatch(doc, ops.map((op, n) => readOp(op, n)));
    const after = doc as unknown as WorldDoc;
    const touched = Object.values(after.entities).filter((e) => JSON.stringify(e) !== JSON.stringify(world.entities[e.id]));
    expect(touched.length).toBeGreaterThan(0);
    const assets = after.packs.economy?.config.assets;
    // An id is lower snake_case; an outside party, payee or customer is named in words, with spaces or capitals.
    const idShaped = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_]+$/.test(v);
    const missing: string[] = [];
    const entity = (where: string, v: unknown): void => {
      if (idShaped(v) && !(v in after.entities)) missing.push(`${where}: ${v}`);
    };
    const place = (where: string, v: unknown): void => {
      if (typeof v === "string" && !(v in after.places)) missing.push(`${where}: ${v}`);
    };
    for (const e of touched) {
      const f = e.fields;
      for (const key of ["account", "worker", "autopay_from", "from", "to", "business", "customer", "operating_account", "holder", "link"]) entity(`${e.id}.${key}`, f[key]);
      // An employer may also be a place: the business trading there.
      if (!(idShaped(f.employer) && f.employer in after.places)) entity(`${e.id}.employer`, f.employer);
      place(`${e.id}.workplace`, f.workplace);
      for (const p of Array.isArray(f.places) ? f.places : []) place(`${e.id}.places`, p);
      if (typeof f.asset === "string" && !(isRecord(assets) && f.asset in assets)) missing.push(`${e.id}.asset: ${f.asset}`);
      for (const o of Array.isArray(f.owners) ? f.owners : []) if (isRecord(o)) entity(`${e.id}.owners`, o.party);
      for (const key of ["splits", "deductions"]) for (const s of Array.isArray(f[key]) ? f[key] : []) if (isRecord(s)) entity(`${e.id}.${key}`, s.to);
    }
    expect(missing).toEqual([]);
  });
});

describe("the agent guide's money features", () => {
  test("the table puts each feature at the level it runs from, and the toggles say how low each goes, as the engine has them", () => {
    const money = guideSection("Money");
    // `| Money 3 | what runs | `flows`, `cards`… |`: each feature's id in the row of its level.
    const listed = [...money.matchAll(/^\| Money (\d) \| [^|]+ \| (.+) \|$/gm)].flatMap(([, level, ids]) => [...(ids ?? "").matchAll(/`([a-z_]+)`/g)].map(([, id]) => [id ?? "", Number(level)] as const));
    expect(listed.map(([id]) => id).sort()).toEqual(Object.keys(FEATURE_DEFS).sort());
    expect(Object.fromEntries(listed)).toEqual(Object.fromEntries(Object.entries(FEATURE_DEFS).map(([id, d]) => [id, d.on])));
    const lowest = /down to its floor: Money 2 for (.+?), Money 3 for the rest/.exec(money)?.[1] ?? "";
    expect([...lowest.matchAll(/`([a-z_]+)`/g)].map(([, id]) => id).sort()).toEqual(Object.keys(FEATURE_DEFS).filter((id) => FEATURE_DEFS[id as keyof typeof FEATURE_DEFS].floor === 2).sort());
    expect(Object.values(FEATURE_DEFS).filter((d) => d.floor !== 2 && d.floor !== 3)).toEqual([]);
  });
});
