// An invented world on the shipped packs, a store on its own database behind the application's
// write queue, and the engine's tools over the shipped guidance. Every name here is made up.

import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { HostTool, JsonObject, JsonValue, ToolCtx, ToolResult } from "rp-harness/contract";
import { WriteQueue } from "../../src/app/database";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { BLANK_REVISION } from "../../src/store/blank";
import { migrateStore } from "../../src/store/schema";
import { openStore } from "../../src/store/store";
import type { UserStore } from "../../src/store/store";
import type { TurnRow } from "../../src/store/types";
import { BESTIARY_SCHEMA, BESTIARY_TABLE, type DueList, type EngineDeps, engineTools, Lines, SHIPPED_GUIDANCE, shippedTexts, stateScan } from "../../src/iface/index";
import { inventedWorld } from "../store/fixtures";

export const USER = "user-a";
export const CHAT = "chat-a";

let shared: Registry | null = null;
export function registry(): Registry {
  shared ??= createRegistry(ALL_PACKS);
  return shared;
}

/** The store lane's invented world, with money kept as accounts, a sheet value, and a bestiary of two rows. */
export function world(): WorldDoc {
  const w = inventedWorld();
  w.realism.levels.money = 2;
  w.entities.bram = { ...w.entities.bram, fields: { ...w.entities.bram?.fields, mood: "steady" } } as WorldDoc["entities"][string];
  w.tables[BESTIARY_TABLE] = {
    id: BESTIARY_TABLE,
    pack: "combat",
    schema: BESTIARY_SCHEMA,
    revision: "test",
    label: "Bestiary",
    columns: {},
    rows: {
      town_guard: { name: "Town guard", kind: "character", tier: "background", fields: { mood: "bored" }, carries: ["spear"], description: "A guard of the watch." },
      wolf: { name: "Grey wolf", kind: "character", tier: "background", fields: {}, carries: [] },
    },
  };
  return w;
}

/** What falls due, as the state lane would list it: an arrival an hour into any span. */
export const DUE: DueList = {
  due: (_state, span, at) => [{ at: span.from + 60, kind: "arrival", where: at ?? "world", who: ["tam"], what: { arriving: "the carter from the far road" } }],
};

export interface Rig {
  s: UserStore;
  writes: WriteQueue;
  turn: TurnRow;
  tools: Map<string, HostTool>;
  deps: EngineDeps;
  call(name: string, args: JsonObject, agent?: { id: string; definition: string; parent?: string }): Promise<ToolResult>;
}

/** The tools on a chat of `doc`, or of the blank world a chat that names none plays (`"blank"`). */
export async function rig(more: Partial<EngineDeps> = {}, doc: WorldDoc | "blank" = world()): Promise<Rig> {
  const revision = doc === "blank" ? BLANK_REVISION : hashJson(doc);
  const db = new Database(":memory:");
  migrateStore(db);
  const store = openStore({ db, registry: registry(), worlds: (r: string) => (doc !== "blank" && r === revision ? doc : undefined) });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat(doc === "blank" ? { id: CHAT } : { id: CHAT, world: doc.id, revision }));
  const turn = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
  const deps: EngineDeps = { store: s, env: store.env, writes, files: shippedTexts(), search: stateScan, due: DUE, ...more };
  const tools = new Map((await engineTools(deps)).map((t) => [t.name, t]));
  const call = async (name: string, args: JsonObject, agent = { id: "gm-1", definition: "gm", parent: "author-1" }): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: turn.id }, agent, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  return { s, writes, turn, tools, deps, call };
}

/** The data part of an answer: its first part that is JSON. */
export function dataOf(r: ToolResult): JsonObject {
  for (const part of r.content) {
    if (part.type !== "text") continue;
    try {
      const v = JSON.parse(part.text) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as JsonObject;
    } catch {
      // Not data: a line.
    }
  }
  throw new Error(`no data in ${JSON.stringify(r.content)}`);
}

export function texts(r: ToolResult): string[] {
  return r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
}

const answerPatterns = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers").patterns();

/** Every part of an answer is data (JSON or the store's tree) or a line of the answers' file, and every report a line. */
export function wordsFromFiles(r: ToolResult): void {
  const kinds = (r.details as { parts?: string[] } | undefined)?.parts ?? [];
  texts(r).forEach((text, i) => {
    if (kinds[i] === "data" || kinds[i] === "tree") return;
    expect(answerPatterns.some((p) => p.test(text))).toBe(true);
  });
  for (const rep of r.reports ?? []) expect(answerPatterns.some((p) => p.test(rep))).toBe(true);
}

/** The answer says `words` in its text and reports nothing, so a closing call that came back so ends the turn. */
export function saidNotReported(r: ToolResult, words: string): void {
  expect(r.reports).toBeUndefined();
  expect(texts(r).some((x) => x.includes(words))).toBe(true);
}
