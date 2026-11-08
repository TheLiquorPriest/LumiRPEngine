// A tool kept in a file of its own (tools-config.ts and the like): its definition, its
// implementation and its command-line mirror together, so a new surface is one import in
// tools.ts. The command line reads the mirror declaratively; commands.ts turns it into a command.

import type { JsonObject } from "../shared/json";
import type { CliMirror } from "../shared/outside-tools";
import type { Args } from "../shared/tool-args";
import type { ToolResult } from "../shared/tool-answer";
import type { ToolContext, ToolDef } from "./tools";

/** A tool with its implementation and its command. */
export interface ToolModule extends ToolDef {
  run(args: Args, ctx: ToolContext): Promise<ToolResult>;
  cli: CliMirror;
}

/** A closed object schema. */
export const object = (properties: JsonObject, required: string[] = []): JsonObject => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });
