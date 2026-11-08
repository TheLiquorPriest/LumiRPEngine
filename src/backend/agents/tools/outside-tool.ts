// One tool LumiRPEngine serves outside clients (DESIGN §23; INC3-SPEC D4) that the chat's own page
// has the requests of: the chat tools and the lore tools an MCP server ran in the client before
// (`lre_chat_state` … `lre_routine_edit`, `lre_lore_*`). Each runs here with the caller's own
// requests, answered in process by the dispatcher's handlers as the caller's session (`OutsideContext`),
// so it reads and writes exactly as it did over the connection and answers as it did.

import type { JsonObject } from "../../../shared/json";
import type { CliMirror, WriteHints } from "../../../shared/outside-tools";
import type { ErrorCode, LintIssue, RequestFields, RequestType, ResultBodies } from "../../../shared/protocol";
import type { ToolResult } from "../../../shared/tool-answer";
import type { Args } from "../../../shared/tool-args";

/** What a served tool runs with: the caller's requests, and one chat's writes one at a time. */
export interface OutsideContext {
  /** Sends one request as the caller's session would, answered in process; a refusal (`lre.error`) rejects with a `Refusal`. */
  request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]>;
  /** Runs one chat's (or world's) writes of this caller one after another, keys side by side. */
  serialize<T>(key: string, work: () => Promise<T>): Promise<T>;
}

/** A chat or lore tool: its schema (its description is the registry text `tool.<name>`), whether and how it writes, its command, and its implementation. */
export interface OutsideToolDef {
  name: string;
  inputSchema: JsonObject;
  /** Changes worlds or chats (refused to a read-only client), and how; false for a tool that only reads. */
  write: false | WriteHints;
  cli?: CliMirror;
  run(args: Args, ctx: OutsideContext): Promise<ToolResult>;
}

/** LumiRPEngine refused one of a tool's requests (its `lre.error`): its code, its words and the lint behind a refused write, as a client's connection gets them. */
export class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly lint: readonly LintIssue[] = [],
  ) {
    super(message);
    this.name = "Refusal";
  }
}
