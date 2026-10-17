// D4 re-measurement: the engine's real `extract` step (strict rules plus deterministic dedupe) on
// the 38 labeled narration fixtures of the extraction check (DESIGN §18.4), through the host's quiet
// API on the configured UI connection (Deepseek / deepseek-v4-flash; verified by name, provider and
// model before any call). Scoring uses that check's match rules per type. Writes per-type precision and recall to the output file.
// Usage: bun scripts/host/measure-extract.ts <fixtures.jsonl> <out.json> [--limit N]
// Host settings come from the environment (scripts/host/lib.ts).

import { readFileSync, writeFileSync } from "node:fs";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld } from "../../src/engine/authoring";
import { CallMeter, extract, Steps, type StepsHost } from "../../src/backend/steps";
import { api, signIn } from "./lib";

const FIXTURES = process.argv[2];
const OUT = process.argv[3];
if (!FIXTURES || !OUT || FIXTURES.startsWith("--") || OUT.startsWith("--")) throw new Error("usage: measure-extract.ts <fixtures.jsonl> <out.json> [--limit N]");
/** The meter and log key for this run's calls (the quiet API calls as the signed-in owner). */
const RUN_USER = "measure-extract";
const limitAt = process.argv.indexOf("--limit");
const LIMIT = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;

/** The fixtures' Maple Street, as a world document with the fixture ids. */
function mapleStreet(): WorldDoc {
  const w = blankWorld("w_maple", "Maple Street (Dayton OH, October 2026)");
  const person = (id: string, name: string, tier: "pov" | "principal" | "supporting" = "principal") => ({ id, kind: "person", name, tier, fields: {}, relations: [] });
  const thing = (id: string, kind: string, name: string) => ({ id, kind, name, tier: "background" as const, fields: {}, relations: [] });
  w.pov = "pc_sam";
  w.entities = {
    pc_sam: person("pc_sam", "Sam Reyes", "pov"),
    npc_dev: person("npc_dev", "Dev Patel (roommate)"),
    npc_rosie: person("npc_rosie", "Rosie Alvarez (diner owner)"),
    npc_mara: person("npc_mara", "Mara Kim (neighbor, mechanic)"),
    npc_lane: person("npc_lane", "Officer Jo Lane", "supporting"),
    npc_teen: person("npc_teen", "Tyler (16)", "supporting"),
    veh_civic: thing("veh_civic", "person", "Sam's Civic (car)"),
    veh_f150: thing("veh_f150", "person", "Mara's F-150 truck"),
    ...Object.fromEntries(["wallet", "phone", "keys_civic", "jacket", "backpack", "apron", "toolbox", "wrench", "ladder", "bike"].map((i) => [`it_${i}`, thing(`it_${i}`, "person", i.replace("_", " "))])),
    ...Object.fromEntries(
      [
        ["cash_sam", "Sam's cash"],
        ["acct_sam_checking", "Sam's checking"],
        ["acct_sam_savings", "Sam's savings"],
        ["card_sam", "Sam's card"],
        ["cash_dev", "Dev's cash"],
        ["acct_rosie_business", "Rosie's business account"],
      ].map(([id, name]) => [id, thing(id ?? "", "person", name ?? "")]),
    ),
  };
  w.places = Object.fromEntries(
    [
      ["pl_apartment", "Sam and Dev's apartment"],
      ["pl_hall", "apartment hallway"],
      ["pl_diner", "Rosie's Diner"],
      ["pl_garage", "Kim's Garage"],
      ["pl_gas", "Shell on Route 9"],
      ["pl_grocery", "FreshMart"],
      ["pl_park", "Riverside Park"],
      ["pl_bank", "First Ohio Bank"],
    ].map(([id, name]) => [id, { id: id ?? "", name: name ?? "", fields: {} }]),
  );
  w.start = { place: "pl_apartment", at: "2026-10-14T07:00" };
  return w;
}

// ---------------------------------------------------------------- scoring (DESIGN §18.4)

function near(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function tokenOverlap(a: unknown, b: unknown): number {
  const ta = new Set(String(a ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const tb = new Set(String(b ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.min(ta.size, tb.size);
}

function matches(want: JsonObject, got: JsonObject): boolean {
  if (want.type !== got.type) return false;
  switch (want.type) {
    case "time_advance": {
      const w = Number(want.minutes);
      const g = Number(got.minutes);
      return Number.isFinite(g) && Math.abs(g - w) <= Math.max(5, 0.25 * w);
    }
    case "location":
      return near(want.entity, got.entity) && near(want.place, got.place);
    case "purchase":
      return near(want.item, got.item) && (want.payer === undefined || near(want.payer, got.payer));
    case "transfer":
      return near(want.from, got.from) && near(want.to, got.to) && Math.abs(Number(want.amount) - Number(got.amount)) <= 0.01;
    case "give":
      return near(want.item, got.item) && near(want.from, got.from) && near(want.to, got.to);
    case "quantity":
      return near(want.entity, got.entity) && near(want.item, got.item) && Math.sign(Number(want.delta)) === Math.sign(Number(got.delta));
    case "condition":
      return near(want.entity, got.entity) && near(want.field, got.field) && Math.sign(Number(want.delta)) === Math.sign(Number(got.delta));
    case "regard":
      return near(want.from, got.from) && near(want.to, got.to) && Math.sign(Number(want.delta)) === Math.sign(Number(got.delta));
    case "knows":
      return near(want.who, got.who) && tokenOverlap(want.fact, got.fact) >= 0.5;
    case "spawn":
      return near(want.name, got.name);
    default:
      return false;
  }
}

// ---------------------------------------------------------------- run

await signIn();
const conns = await api("GET", "/api/v1/connections");
const list = isRecord(conns.data) && Array.isArray(conns.data.data) ? conns.data.data : Array.isArray(conns.data) ? conns.data : [];
const connection = list.find((c): c is JsonObject => isRecord(c) && c.name === "Deepseek" && c.provider === "deepseek" && c.model === "deepseek-v4-flash");
if (!connection || typeof connection.id !== "string") throw new Error("the Deepseek / deepseek-v4-flash connection is not configured; refusing to call any other model");
const connectionId = connection.id;

let calls = 0;
const host: StepsHost = {
  models: {
    async quiet(request, _userId, signal) {
      calls++;
      const parameters: Record<string, unknown> = { max_tokens: request.maxTokens };
      if (request.json) parameters.response_format = { type: "json_object" };
      const r = await api("POST", "/api/v1/generate/quiet", { connection_id: request.connectionId ?? connectionId, messages: request.messages, parameters }, signal);
      if (r.status !== 200 || !isRecord(r.data)) throw new Error(`quiet ${r.status}`);
      return { content: typeof r.data.content === "string" ? r.data.content : "", finishReason: typeof r.data.finish_reason === "string" ? r.data.finish_reason : "", tokens: 0 };
    },
    async decide() {
      throw new Error("extract never decides");
    },
  },
  log: (level, message) => console.error(`${level}: ${message}`),
};
const steps = new Steps(host, new CallMeter());
const world = mapleStreet();
const rows = readFileSync(FIXTURES, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as JsonObject)
  .slice(0, LIMIT);

const perType: Record<string, { tp: number; fp: number; fn: number }> = {};
const bump = (type: string, key: "tp" | "fp" | "fn"): void => {
  perType[type] ??= { tp: 0, fp: 0, fn: 0 };
  perType[type][key]++;
};
let mustNotHits = 0;
const out: JsonValue[] = [];
for (const f of rows) {
  const got = await extract(steps, String(f.narration), world, f.state ?? null, 0, [], null, RUN_USER, AbortSignal.timeout(90_000));
  const expected = (Array.isArray(f.expected) ? f.expected : []).filter((x): x is JsonObject => isRecord(x));
  const mustNot = (Array.isArray(f.must_not) ? f.must_not : []).filter((x): x is JsonObject => isRecord(x));
  const used = new Set<number>();
  for (const g of got) {
    const i = expected.findIndex((e, idx) => !used.has(idx) && matches(e, g));
    if (i >= 0) {
      used.add(i);
      bump(String(g.type), "tp");
    } else bump(String(g.type), "fp");
    if (mustNot.some((m) => m.type === g.type && Object.entries(m).every(([k, v]) => k === "type" || near(v, g[k])))) mustNotHits++;
  }
  expected.forEach((e, i) => {
    if (!used.has(i)) bump(String(e.type), "fn");
  });
  out.push({ id: f.id ?? null, expected, got });
  console.error(`${String(f.id)}: ${got.length} proposals`);
}
const summary: Record<string, JsonValue> = {};
let tp = 0;
let fp = 0;
let fn = 0;
for (const [type, c] of Object.entries(perType).sort()) {
  tp += c.tp;
  fp += c.fp;
  fn += c.fn;
  summary[type] = { ...c, precision: c.tp + c.fp > 0 ? Number((c.tp / (c.tp + c.fp)).toFixed(3)) : null, recall: c.tp + c.fn > 0 ? Number((c.tp / (c.tp + c.fn)).toFixed(3)) : null };
}
const report = { at: new Date().toISOString(), connection: { id: connectionId, name: "Deepseek", model: "deepseek-v4-flash" }, n: rows.length, calls, overall: { tp, fp, fn, precision: tp + fp ? Number((tp / (tp + fp)).toFixed(3)) : null, recall: tp + fn ? Number((tp / (tp + fn)).toFixed(3)) : null, mustNotHits }, perType: summary, rows: out };
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ n: report.n, calls, overall: report.overall, perType: summary }, null, 1));
