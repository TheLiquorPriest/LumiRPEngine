// What every family's test shares: the rig's invented world with a change or two of its own (a
// level a family needs), a plain search by words over the searchable tools' descriptions, and the
// check that every sentence of an answer is a line of the answers' file.

import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { join } from "node:path";
import type { HostTool, JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { WriteQueue } from "../../../src/app/database";
import { hashJson } from "../../../src/shared/hash";
import type { WorldDoc } from "../../../src/shared/world";
import { migrateStore } from "../../../src/store/schema";
import { openStore } from "../../../src/store/store";
import { type EngineDeps, engineTools, Lines, SHIPPED_GUIDANCE, shippedTexts, stateScan, toolText } from "../../../src/iface/index";
import { SEARCHABLE_TOOLS } from "../../../src/iface/searchable";
import { CHAT, dataOf, PORTS, type Rig, registry, texts, USER, world } from "../rig";

/** The rig over its invented world, changed first by `edit`. */
export async function familyRig(edit: (w: WorldDoc) => void = () => undefined): Promise<Rig> {
  const doc = world();
  edit(doc);
  const revision = hashJson(doc);
  const db = new Database(":memory:");
  migrateStore(db);
  const env = { registry: registry(), worlds: (r: string) => (r === revision ? doc : undefined) };
  const store = openStore({ db, ...env });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat({ id: CHAT, world: doc.id, revision }));
  const turn = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
  const deps: EngineDeps = { store: s, env, writes, files: shippedTexts(), search: stateScan, ...PORTS };
  const tools = new Map<string, HostTool>((await engineTools(deps)).map((t) => [t.name, t]));
  const call = async (name: string, args: JsonObject, agent = { id: "gm-1", definition: "gm", parent: "author-1" }): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: turn.id }, agent, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  return { s, writes, turn, tools, deps, call };
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== ""));

/** Each searchable tool's description, from its file. */
export async function descriptions(): Promise<Map<string, string>> {
  const files = shippedTexts();
  const out = new Map<string, string>();
  for (const t of SEARCHABLE_TOOLS) {
    const text = await files.read("tools", t.name);
    if (text !== undefined) out.set(t.name, toolText(text, t.name).description);
  }
  return out;
}

/** A plain search by words: the tools whose descriptions share the most of the words, best first (by the share of words in common). */
export function searchByWords(query: string, docs: ReadonlyMap<string, string>): string[] {
  const q = words(query);
  const scored = [...docs].map(([name, text]) => {
    const d = words(text);
    const common = [...q].filter((w) => d.has(w)).length;
    return { name, score: common / new Set([...q, ...d]).size };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((s) => s.name);
}

/** Every tool of a family is found first by a search on its own description's words. */
export async function eachFoundByItsWords(names: readonly string[]): Promise<void> {
  const docs = await descriptions();
  for (const name of names) {
    const said = docs.get(name);
    expect(said).toBeDefined();
    expect(searchByWords(said ?? "", docs)[0]).toBe(name);
  }
}

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers");
const patterns = lines.patterns();

/** Every part of an answer is data or a line of the answers' file, and every report a line. */
export function wordsFromFiles(r: ToolResult): void {
  const kinds = (r.details as { parts?: string[] } | undefined)?.parts ?? [];
  texts(r).forEach((text, i) => {
    if (kinds[i] === "data" || kinds[i] === "tree") return;
    expect(patterns.some((p) => p.test(text))).toBe(true);
  });
  for (const rep of r.reports ?? []) expect(patterns.some((p) => p.test(rep))).toBe(true);
}

/** The one operation of a searchable write's answer. */
export function opOf(r: ToolResult): JsonObject {
  return (dataOf(r).operations as JsonObject[])[0] ?? {};
}

/** A write applied and answered in full: its operation applied in its lane, what changed, how each touched thing now stands, and words only from files. */
export function appliedInFull(r: ToolResult, lane: string, changed = true): JsonObject {
  expect(r.error).toBeUndefined();
  const data = dataOf(r);
  const op = opOf(r);
  // An operation that recorded nothing (it was so already) did not apply; one that recorded changes applied them.
  expect(op.applied).toBe(Array.isArray(op.changes));
  expect(op.lane).toBe(lane);
  expect(Array.isArray(data.changed)).toBe(true);
  expect(Array.isArray(data.now)).toBe(true);
  if (changed) {
    expect((data.changed as JsonObject[]).length).toBeGreaterThan(0);
    expect((data.now as JsonObject[]).length + (data.changed as JsonObject[]).filter((c) => c.at === "world").length).toBeGreaterThan(0);
  }
  wordsFromFiles(r);
  return data;
}

export const SRC = { source: { from: "prose", message: "m-1" } } as const;
