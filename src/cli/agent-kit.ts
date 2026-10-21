// The agent kit (dist/agent-kit.js, DESIGN §23): every tool, with the guide, the docs, the schema,
// the starters and the engine they serve, and the command line, behind the core's contract
// (kit-api.ts). The core loads its own copy at start; an MCP server swaps in the copy the extension
// it is connected to ships whenever that is another build.

import { KIT_API } from "../shared/agents";
import { run } from "./commands";
import type { Connection } from "./connection";
import type { BundledKit, KitContext } from "./kit-api";
import { Live } from "./live";
import type { ToolContext } from "./tools";
import { annotationsOf, callTool, findTool, toolsFor } from "./tools";
import { BUILD, VERSIONS } from "./version";

/** Each session's tool context, made once; each connection's Live, which keeps the revisions read. */
const contexts = new WeakMap<KitContext, ToolContext>();
const lives = new WeakMap<Connection, Live>();

function toolContext(ctx: KitContext): ToolContext {
  const made = contexts.get(ctx);
  if (made !== undefined) return made;
  const context: ToolContext = {
    readFile: (path) => ctx.readFile(path),
    readOnly: ctx.readOnly,
    serialize: (key, work) => ctx.serialize(key, work),
    live: () => {
      const conn = ctx.connection();
      const live = lives.get(conn) ?? new Live(conn);
      lives.set(conn, live);
      return live;
    },
  };
  contexts.set(ctx, context);
  return context;
}

export const kit: BundledKit = {
  api: KIT_API,
  build: BUILD,
  versions: VERSIONS,
  tools: (readOnly) => toolsFor(readOnly).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: annotationsOf(t) })),
  has: (name) => findTool(name) !== undefined,
  call: (name, args, ctx) => callTool(name, args, toolContext(ctx)),
  run,
};
