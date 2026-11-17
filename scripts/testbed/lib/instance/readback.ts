// The instance read back as the instance's user, by today's build's own reads (`rows.ts`) and
// Lumiverse's: what the run was made on, the world part by part with which revision each chat plays,
// and every row of STANDALONE-PLAN §15.2. It changes nothing: a chat holding item 4's planted cases
// is read only through Lumiverse's own API, never through the engine, whose reader would set its
// files aside or replace its journal.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context";
import type { Json } from "../record";
import type { InstanceEnv } from "./env";
import { checksum, failures, type ReportDoc, type RowReport } from "./report-doc";
import { ROWS } from "./rows";
import { emptyParts, partSizes, revisionNumbers, unknownParts } from "./world-check";

/** The chats whose revision the report names, by the keys the run recorded them under. A chat deleted in Lumiverse is not among them: no read reaches it. */
const CHAT_KEYS = ["classic", "agents", "harness", "branch", "set-aside", "reader-cases"] as const;

/** A row that holds nothing on today's build by its own definition, and why: it is listed with what was read, and does not fail the report. */
const ABSENT_BY: { readonly [row: string]: string } = {
  registration: "RPE's registration with its light extension exists only once the new extension has run (STANDALONE-PLAN §15.2); today's build never writes it",
};

/** A row that waits on another package before it can hold anything: listed, not failed (the lead's ruling of 15 Nov). */
const WAITS_FOR: { readonly [row: string]: string } = {
  browser: "the live driver's browser profile: the package that owns it sets the keys there and records them under browser:prefs (PlanScenarios-5)",
};

/** Facts the rows do not hold, each with the code that makes it so. */
const NOTES: { readonly [key: string]: string } = {
  otherUserStorage:
    "The second user's files are in the per-user layout only: Lumiverse's Extensions page installs an extension with operator scope (Lumiverse src/routes/spindle.routes.ts:197-203), and so today's build keeps only system files in the per-extension layout (RPE main src/backend/agents.ts:51,234-251; src/backend/spindle-host.ts:439).",
  userTidy:
    "The tidy-up has no setting at the user's level in today's build: its Settings patch answers \"there is no setting tidy\" (seen on the bed; READINGS R-201), though RPE main src/shared/settings.ts:697-710 declares UserSettings.tidy. It is made where today's build has it: the world's own switch (packs.gear.config.tidy.auto, src/shared/things.ts:512,599,678) and the chat's own choice and leave-alone list (stores-kept, stores-tidy-left).",
};

function revisionOf(metadata: { [key: string]: unknown } | undefined): string | null {
  const own = metadata?.lumi_rp_engine;
  return own !== null && typeof own === "object" && "revision" in own && typeof own.revision === "string" ? own.revision : null;
}

export async function readBack(ctx: Ctx, env: InstanceEnv): Promise<ReportDoc> {
  const id = (key: string): string | undefined => ctx.log.get<string>(key);
  const worldId = id("worldId");
  if (worldId === undefined) throw new Error("the run recorded no world");
  const got = await ctx.socket.lre<{ world: { [part: string]: unknown }; revision: string; history: { revision: string }[] }>("lre.world", { op: "get", worldId });
  const draft = await ctx.socket.lre<{ stored: boolean }>("lre.editor", { op: "get", worldId, base: null });
  const playedBy: { [chat: string]: string | null } = {};
  const chatIds: { [chat: string]: string } = {};
  for (const key of CHAT_KEYS) {
    const chatId = id(`chat:${key}`);
    if (chatId === undefined) continue;
    chatIds[key] = chatId;
    playedBy[key] = revisionOf((await ctx.host.chat(chatId)).metadata);
  }
  const rows: { [row: string]: RowReport } = {};
  for (const row of ROWS) {
    const absentBy = ABSENT_BY[row.id];
    const waitsFor = WAITS_FOR[row.id];
    try {
      const read = await row.read(ctx, env);
      rows[row.id] = { today: row.today, made: row.made, ...read, ...(absentBy !== undefined ? { absentBy } : {}), ...(waitsFor !== undefined ? { waitsFor } : {}) };
    } catch (error) {
      rows[row.id] = { today: row.today, made: row.made, via: "", found: 0, facts: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    run: { build: id("build:commit") ?? null, branch: id("build:branch") ?? null, lumiverse: id("lumiverse:commit") ?? null, ids: { owner: id("user:owner") ?? null, other: id("user:other") ?? null } },
    notes: { ...NOTES },
    world: {
      parts: partSizes(got.world),
      empty: emptyParts(got.world),
      unknown: unknownParts(got.world),
      revisions: got.history.length,
      // Not under `played`, which the comparison keeps for what the model chose: which revision each chat plays is the script's.
      chatRevision: revisionNumbers(got.history, playedBy),
      draft: draft.stored,
      ids: { worldId, head: got.revision, history: got.history.map((h) => h.revision), chats: chatIds } satisfies Json,
    },
    rows,
  };
}

/**
 * What a golden copy keeps beside it, as fields a later package reads (the live driver's restore
 * refuses a copy whose `waiting` is not empty): the read-back's checksum, the rows that wait on
 * another package, and whether every other row read something back.
 */
export interface ReportRecord {
  checksum: string;
  waiting: string[];
  passes: boolean;
}

/** Writes `report.json`, `report.sha256` and `report.record.json` into the instance folder; returns the record. */
export function writeReport(env: InstanceEnv, doc: ReportDoc): ReportRecord {
  const record: ReportRecord = {
    checksum: checksum(doc),
    waiting: Object.entries(doc.rows).flatMap(([id, row]) => (row.waitsFor !== undefined && row.found === 0 ? [id] : [])).sort(),
    passes: failures(doc).length === 0,
  };
  writeFileSync(join(env.instanceDir, "report.json"), `${JSON.stringify(doc, null, 1)}\n`, { mode: 0o600 });
  writeFileSync(join(env.instanceDir, "report.sha256"), `${record.checksum}\n`, { mode: 0o600 });
  writeFileSync(join(env.instanceDir, "report.record.json"), `${JSON.stringify(record, null, 1)}\n`, { mode: 0o600 });
  return record;
}
