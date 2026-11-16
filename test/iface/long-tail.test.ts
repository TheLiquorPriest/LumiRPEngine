// Today's tools the long tail keeps, found by name: each of the old engine's map and world-document tools has a carrier registered
// here, a tool of its own name or the operation or tool that takes its place. Every name is invented where it is not a tool's.

import { expect, test } from "bun:test";
import { OPERATION_NAMES } from "../../src/iface/apply";
import { ENGINE_TOOLS } from "../../src/iface/tools";

/** The old map tools and their carriers: a tool by the same name, a tool that took the job, or an operation of world_apply. */
const MAP_CARRIERS: Readonly<Record<string, { tool?: string; op?: string }>> = {
  world_map: { tool: "map_lay" },
  world_map_place: { tool: "world_map_place" },
  world_map_link: { tool: "world_map_link" },
  world_map_settings: { tool: "world_map_settings" },
  world_keep: { tool: "world_keep" },
  world_place: { op: "place" },
  world_path: { tool: "world_path" },
};

/** The old world-document tools: the ones this build keeps by name, and the two that wait on their services. */
const WORLD_DOCUMENT = ["world_put", "world_set", "world_patch", "world_read", "world_shape", "world_status", "world_history", "world_commit", "world_discard", "world_restore", "world_remove"];

test("each of the old map tools has its carrier registered, and map_edit sits beside map_lay", () => {
  const tools = new Set(ENGINE_TOOLS.map((t) => t.name));
  const ops = new Set<string>(OPERATION_NAMES);
  for (const [old, carrier] of Object.entries(MAP_CARRIERS)) {
    if (carrier.tool !== undefined) expect({ old, carried: tools.has(carrier.tool) }).toEqual({ old, carried: true });
    if (carrier.op !== undefined) expect({ old, carried: ops.has(carrier.op) }).toEqual({ old, carried: true });
  }
  expect(tools.has("map_edit")).toBe(true);
});

test("the world-document tools are searchable, and every one that writes asks under the engine lane", () => {
  const found = new Map(ENGINE_TOOLS.map((t) => [t.name, t]));
  for (const name of WORLD_DOCUMENT) expect({ name, there: found.has(name) }).toEqual({ name, there: true });
  for (const name of ["world_put", "world_set", "world_patch", "world_remove", "world_discard", "world_restore", "world_commit"]) expect(found.get(name)).toMatchObject({ tier: "write", lane: "engine" });
});
