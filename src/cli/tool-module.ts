// A tool kept in a file of its own (tools-config.ts and the like): its definition, its
// implementation and its command-line mirror together, so a new surface is one import in
// tools.ts. The command line reads the mirror declaratively; commands.ts turns it into a command.

import type { JsonObject } from "../shared/json";
import type { Args } from "./args";
import type { ToolResult } from "./report";
import type { ToolContext, ToolDef } from "./tools";

/** How one option's text becomes the argument it fills. */
export type CliValue =
  /** Text as given. */
  | "text"
  /** A whole number. */
  | "int"
  /** A switch: present is true. */
  | "flag"
  /** JSON inline (it starts with `[`, `{` or `"`, or is a number, true, false or null) or a file holding it. */
  | "json"
  /** Texts separated by commas. */
  | "list"
  /** Repeated: each use adds one text to a list. */
  | "many";

/** How the command line spells a tool's arguments: each positional and option names the argument it fills. */
export interface CliMirror {
  command: string;
  /** The heading the usage text lists it under ("Settings and presets"); commands with the same heading are listed together. */
  section: string;
  /** Its usage line, after the program's name. */
  usage: string;
  /** What the usage text says it does, in a few words. */
  summary: string;
  /** The arguments the positionals fill, in order. With `rest`, the last takes every remaining positional, joined by spaces. */
  positionals?: readonly string[];
  rest?: true;
  /** How many positionals it needs at least. */
  needs?: number;
  /** `--option` → the argument it fills and how its text reads. */
  options?: Readonly<Record<string, { arg: string; as: CliValue }>>;
}

/** A tool with its implementation and its command. */
export interface ToolModule extends ToolDef {
  run(args: Args, ctx: ToolContext): Promise<ToolResult>;
  cli: CliMirror;
}

/** A closed object schema. */
export const object = (properties: JsonObject, required: string[] = []): JsonObject => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });
