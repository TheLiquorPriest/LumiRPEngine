// The engine's tools on an invented chat with the places' area and a reader of the lore it holds: bound entries and their revisions, as a test sets them.

import { Database } from "bun:sqlite";
import type { HostTool, JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { WriteQueue } from "../../src/app/database";
import { PLACE_STORE_AREA } from "../../src/places/fold";
import type { PlaceBinding, PlaceSourcesReader } from "../../src/places/sources";
import { migrateStore, openStore, type TurnRow, type UserStore } from "../../src/store";
import { QUEST_STORE_AREA } from "../../src/quests";
import { STORY_STORE_AREA } from "../../src/story/fold";
import { type EngineDeps, engineTools, shippedTexts, stateScan } from "../../src/iface/index";
import { hashJson } from "../../src/shared/hash";
import { CHAT, PORTS, registry, USER, world } from "../iface/rig";

/** The lore a test holds: the entries bound to each place and each entry's title and revision now. */
export interface InventedLore extends PlaceSourcesReader {
  bound: Map<string, PlaceBinding[]>;
  entries: Map<string, { title: string; revision: string }>;
}

export function inventedLore(): InventedLore {
  const bound = new Map<string, PlaceBinding[]>();
  const entries = new Map<string, { title: string; revision: string }>();
  return {
    bound,
    entries,
    bindings: (_user, place) => bound.get(place) ?? [],
    entry: async (_scope, entry) => entries.get(entry) ?? null,
  };
}

export interface PlacesRig {
  s: UserStore;
  writes: WriteQueue;
  turn: TurnRow;
  lore: InventedLore;
  deps: EngineDeps;
  tools: Map<string, HostTool>;
  call(name: string, args: JsonObject): Promise<ToolResult>;
  store: ReturnType<typeof openStore>;
}

export async function placesRig(more: Partial<EngineDeps> = {}): Promise<PlacesRig> {
  const doc = world();
  const revision = hashJson(doc);
  const db = new Database(":memory:");
  migrateStore(db);
  const store = openStore({ db, registry: registry(), worlds: (r: string) => (r === revision ? doc : undefined), areas: [STORY_STORE_AREA, QUEST_STORE_AREA, PLACE_STORE_AREA] });
  const writes = new WriteQueue(db, 10);
  const s = store.user(USER);
  await writes.run(() => s.createChat({ id: CHAT, world: doc.id, revision }));
  const turn = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
  const lore = inventedLore();
  const deps: EngineDeps = { store: s, env: store.env, writes, files: shippedTexts(), search: stateScan, ...PORTS, placeSources: lore, ...more };
  const tools = new Map((await engineTools(deps)).map((t) => [t.name, t]));
  const call = async (name: string, args: JsonObject): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: turn.id }, agent: { id: "gm-1", definition: "gm", parent: "author-1" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  return { s, writes, turn, lore, deps, tools, call, store };
}
