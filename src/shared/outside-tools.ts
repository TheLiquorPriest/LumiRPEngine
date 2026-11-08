// The tools LumiRPEngine serves outside clients (DESIGN §23; INC3-SPEC D4): what `lre.tools list`
// answers each with, the command line's mirror of one, and how a tool says it acts. Shared by the
// backend, which serves them (`backend/agents/tools/outside.ts`), and the `lumirpengine` CLI, which
// lists them beside its own and builds their commands from each one's mirror.

import type { JsonObject } from "./json";

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

/** How a write tool changes things, for MCP's tool annotations (a client may ask the user before a destructive call). */
export interface WriteHints {
  /** It can delete or overwrite what is there: a draft, a world, a chat's state. */
  destructive: boolean;
  /** Calling it again with the same arguments changes nothing more. */
  idempotent: boolean;
}

/** A tool's MCP annotations: read-only, or how it writes. None reaches past the user's own Lumiverse and files, so none is open-world. */
export function annotationsOf(write: false | WriteHints): JsonObject {
  if (write === false) return { readOnlyHint: true, openWorldHint: false };
  return { readOnlyHint: false, destructiveHint: write.destructive, idempotentHint: write.idempotent, openWorldHint: false };
}

/** Whether a listed tool only reads (its annotations say so): a read-only client lists and calls no other. */
export function readsOnly(tool: Pick<OutsideTool, "annotations">): boolean {
  return tool.annotations.readOnlyHint === true;
}

/**
 * A tool as LumiRPEngine lists it (`lre.tools list`): its name, its description in the user's words
 * where they wrote one (a registry text), its JSON Schema with no world's ids in it (`describe` fills
 * a chat's), its annotations, and for a tool with a command its command-line mirror.
 */
export interface OutsideTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
  cli?: CliMirror;
}

/** What a write tool answers a read-only client, on either side of the connection: nothing was done. */
export function readOnlyRefusal(name: string): string {
  return `${name} changes your worlds or chats, and this client runs read-only (--read-only or LRE_READ_ONLY=1): nothing was done.`;
}

/** The tool an outside agent asks for one tool's schema with a chat's ids filled in: an MCP client keeps the list it got when it connected. */
export const DESCRIBE_TOOL = "lre_tool_describe";
