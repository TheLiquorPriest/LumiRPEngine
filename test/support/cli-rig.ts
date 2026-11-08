// The CLI's tools over the real backend (the Rig: runtime and dispatcher on the fake host), as one
// signed-in client: what a tool sends is checked against what LumiRPEngine actually answers.

import { expect } from "bun:test";
import type { Connection, HostDescription } from "../../src/cli/connection";
import type { RequestFields, RequestType } from "../../src/shared/protocol";
import { LreError } from "../../src/cli/connection";
import { Live } from "../../src/cli/live";
import type { ToolResult } from "../../src/shared/tool-answer";
import { isRecord } from "../../src/shared/json";
import type { ToolContext } from "../../src/cli/tools";
import { callTool } from "../../src/cli/tools";
import { KeyedQueue } from "../../src/shared/keyed-queue";
import type { FrontendToBackend, ResultBodies } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import type { RigOptions } from "./rig";
import { Rig } from "./rig";

/** The tools' connection, straight into the Rig's dispatcher as one session that said hello as this client. */
export class RigConnection implements Connection {
  private seq = 0;
  constructor(private readonly rig: Rig) {}

  private async send(request: Record<string, unknown>): Promise<unknown> {
    const reqId = `cli${++this.seq}`;
    const before = this.rig.host.sent.length;
    await this.rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, this.rig.host.userId, CLI_SESSION);
    await this.rig.host.settle();
    const reply = this.rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
    if (!reply) throw new Error(`no reply to ${String(request.type)}`);
    if (reply.type === "lre.error") throw new LreError(reply.code, reply.message, reply.lint ?? []);
    return reply.type === "lre.result" ? reply.body : null;
  }

  hello(): Promise<unknown> {
    return this.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } });
  }

  async request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
    return (await this.send({ type, ...fields })) as ResultBodies[T];
  }

  describe(): Promise<HostDescription> {
    throw new Error("not used");
  }

  close(): void {}
}

/** The frontend session the client's requests come from. */
export const CLI_SESSION = "s_cli";

export interface CliRig {
  rig: Rig;
  conn: RigConnection;
  ctx: ToolContext;
  /**
   * The request types LumiRPEngine was asked as the client's session, in order: those the client sent
   * and those a served tool sent in process for it (DESIGN §23), never `lre.tools` itself.
   */
  asked: string[];
  /** A tool's answer as data; a tool error fails the test with its text. */
  call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** A tool's answer as it comes, error or not. */
  raw(name: string, args?: Record<string, unknown>, readOnly?: boolean): Promise<ToolResult>;
}

/** The live tools over a fresh Rig, as one signed-in client. */
export async function cliRig(options: RigOptions = {}): Promise<CliRig> {
  const rig = new Rig(options);
  const asked: string[] = [];
  const serve = rig.dispatch.serve.bind(rig.dispatch);
  rig.dispatch.serve = (raw, userId, session, send) => {
    if (session === CLI_SESSION && isRecord(raw) && typeof raw.type === "string" && raw.type !== "lre.tools") asked.push(raw.type);
    return serve(raw, userId, session, send);
  };
  const conn = new RigConnection(rig);
  expect(await conn.hello()).toMatchObject({ accepted: true });
  const live = new Live(conn);
  const queue = new KeyedQueue();
  const ctx: ToolContext = { readFile: () => "", readOnly: false, live: () => live, serialize: (k, w) => queue.run(k, w) };
  const raw = (name: string, args: Record<string, unknown> = {}, readOnly = false): Promise<ToolResult> => callTool(name, args, { ...ctx, readOnly });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.text}`);
    return JSON.parse(result.text) as Record<string, unknown>;
  };
  return { rig, conn, ctx, asked, call, raw };
}
