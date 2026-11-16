// The world-document tools: a world's draft is read, shaped, changed and committed through the world service, the world's own checks
// refuse what they refuse, and the writes are the engine lane's. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { engineTools } from "../../../src/iface/index";
import { WorldService } from "../../../src/worlds/service";
import { CHAT, dataOf, rig, texts, USER } from "../rig";

const log = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

test("a world's draft is read, shaped, changed and committed; a refusal keeps the draft as it was", async () => {
  const t = await rig();
  const worlds = new WorldService({ store: { user: () => t.s, env: t.deps.env }, writes: t.writes, log });
  const tools = new Map((await engineTools({ ...t.deps, worlds })).map((x) => [x.name, x]));
  const run = async (name: string, args: JsonObject): Promise<ToolResult> => {
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: t.turn.id }, agent: { id: "gm-1", definition: "gm" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tools.get(name)!.run(args, ctx);
  };
  expect(tools.get("world_put")).toMatchObject({ lane: "engine", tier: "write" });
  expect(tools.get("world_read")).toMatchObject({ tier: "read" });

  const made = await worlds.create(USER, "Fernwick", "fantasy_town");
  const world = made.world.id;

  const status = dataOf(await run("world_status", { world }));
  expect(status).toMatchObject({ world, behind: false, stored: false });

  const shape = dataOf(await run("world_shape", { world, collection: "entities" }));
  expect(Number(shape.items)).toBeGreaterThan(0);

  const put = await run("world_put", { world, collection: "kinds", id: "lamplighter", value: { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} } });
  expect(put.error).toBeUndefined();
  expect(dataOf(put)).toMatchObject({ put: { collection: "kinds", id: "lamplighter" }, draft: { stored: true } });
  expect(dataOf(await run("world_read", { world, at: "/kinds/lamplighter" })).value).toMatchObject({ label: "Lamplighter" });

  // A value too long for one answer is outlined.
  const outline = dataOf(await run("world_read", { world }));
  expect(outline.outline ?? outline.value).toBeDefined();

  // What the world's own checks refuse is told, and the draft stands as it was.
  const bad = await run("world_set", { world, part: "calendar", value: { nonsense: true } });
  expect(bad.error).toBe(true);
  expect(texts(bad).join(" ")).toContain("draft stands as it was");

  const nothing = await run("world_read", { world, at: "/entities/nobody" });
  expect(nothing.error).toBe(true);
  expect(texts(nothing).join(" ")).toContain("holds nothing at /entities/nobody");

  const committed = await run("world_commit", { world, note: "a lamplighter" });
  expect(committed.error).toBeUndefined();
  const history = dataOf(await run("world_history", { world })).revisions as JsonObject[];
  expect(history[0]).toMatchObject({ note: "a lamplighter", source: "agent" });
});
