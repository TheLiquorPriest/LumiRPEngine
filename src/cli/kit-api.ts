// The contract between lumirpengine's core and an agent kit (DESIGN §23): what the core loads, its
// own kit (dist/agent-kit.js beside it) or the one the extension ships, and what it gives the kit
// for each call. Both sides are built from this file; KIT_API (shared/agents.ts) counts its
// breaking changes, so a core refuses a kit of another level rather than load it.

import { KIT_API } from "../shared/agents";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { CliIO, RunResult } from "./commands";
import type { Connection } from "./connection";

/** A tool as MCP lists it. */
export interface KitTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
}

/** A tool's answer: text, a refusal the agent reads (`isError`), or a call that worked and found the world failing (`failed`). */
export interface KitResult {
  text: string;
  isError?: true;
  failed?: true;
}

/** What a session gives the kit: the same object for every call of the session, whichever kit runs it. */
export interface KitContext {
  readFile(path: string): string;
  /** The connection to the signed-in Lumiverse; throws a LiveError when this client isn't signed in. */
  connection(): Connection;
  readOnly: boolean;
  /** Runs one world's (or chat's) writes one at a time; the session's own, so a reload never reorders them. */
  serialize<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface AgentKit {
  /** The contract it implements: KIT_API. */
  readonly api: number;
  /** The build it came from. */
  readonly build: string;
  /** Its version, the engine and world format it bundles, and the agent API its tools need of LumiRPEngine. */
  readonly versions: { cli: string; engine: string; worldFormat: string; agentApi: number };
  /** The tools, without the write tools when read-only. */
  tools(readOnly: boolean): readonly KitTool[];
  /** Whether it has a tool of that name, listed or not. */
  has(name: string): boolean;
  /** Runs one tool; never throws. */
  call(name: string, args: unknown, ctx: KitContext): Promise<KitResult>;
}

/** The kit a core ships with also runs the command line. */
export interface BundledKit extends AgentKit {
  run(argv: readonly string[], io: CliIO): Promise<RunResult>;
}

/** What `mcp` starts with, as the command line read it. */
export interface McpOptions {
  readOnly: boolean;
  /** `--pin` (or LRE_PIN_KIT): keep the bundled kit rather than follow the extension's. */
  pin: boolean;
  /** The Lumiverse to use; throws a LiveError when there is none to pick (not signed in, or signed in to several). */
  base(): string;
  /** Each request's limit: null for none, undefined for the default. */
  timeoutMs: number | null | undefined;
}

/** A module's kit, or why it has none this core can use. */
export function kitOf(module: unknown): AgentKit | string {
  const kit = isRecord(module) ? module.kit : undefined;
  if (!isRecord(kit)) return "it exports no kit";
  if (kit.api !== KIT_API) return `it is kit API ${String(kit.api)}, and this lumirpengine reads kit API ${KIT_API}`;
  const versions = kit.versions;
  if (typeof kit.build !== "string" || !isRecord(versions) || typeof versions.agentApi !== "number" || typeof kit.tools !== "function" || typeof kit.has !== "function" || typeof kit.call !== "function") return "it isn't a whole kit";
  return kit as unknown as AgentKit;
}

/** The core's own kit, or why it can't run: it must run the command line as well. */
export function bundledKitOf(module: unknown): BundledKit | string {
  const kit = kitOf(module);
  if (typeof kit === "string") return kit;
  return "run" in kit && typeof kit.run === "function" ? (kit as BundledKit) : "it runs no command line";
}
