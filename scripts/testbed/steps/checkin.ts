// Item 13: an outside harness's check-in in `agents.json` (DESIGN §23, `backend/agents.ts`). An
// outside agent harness runs the engine's own MCP server (`lumirpengine mcp`) over stdio; the server
// connects at the client's `initialize` and checks in with its builds, its machine and the harness's
// name, and the engine keeps that check-in in the user's storage. This step is that harness: it runs
// the installed extension's server as the user whose command line is signed in, initializes as a
// harness of its own name, lists the tools and calls `lre_status`, then reads the line back from
// Settings → MCP server's own request. The second user's steps check in the same way, as that user.

import { cliPath } from "../lib/env";
import type { Ctx, Step } from "../lib/context";
import { UserCli } from "../lib/instance/context";
import { say } from "../lib/record";

/** What a check-in needs of a user's context: that user's command line and page session, and the run's log. */
export type CheckinCtx = Pick<Ctx, "socket" | "cli" | "env" | "log">;

/** The harness this step plays: the name its MCP client gives itself at `initialize`. */
export const HARNESS = "testbed-harness";

interface ClientView {
  id: string;
  name: string;
  host: string | null;
  harness: string | null;
  kit: string | null;
  seen: number;
  state: string;
}

async function listed(ctx: CheckinCtx, harness: string): Promise<ClientView | undefined> {
  const answer = await ctx.socket.lre<{ view?: { clients: ClientView[] } }>("lre.agents", { op: "get" });
  return answer.view?.clients.find((c) => c.harness === harness);
}

/** One MCP session over the server's stdio: each request a line, each answer a line. */
async function harnessSession(ctx: CheckinCtx, harness: string): Promise<{ tools: number; status: string }> {
  if (!(ctx.cli instanceof UserCli)) throw new Error("a check-in runs today's command line as one of the instance's users (lib/instance/context.ts)");
  const server = Bun.spawn([process.execPath, cliPath(ctx.env), "mcp"], {
    env: ctx.cli.environment(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const answers = new Map<number, (value: { result?: { [key: string]: unknown }; error?: { message: string } }) => void>();
  const reader = (async () => {
    let buffer = "";
    for await (const chunk of server.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line === "") continue;
        const message = JSON.parse(line) as { id?: number; result?: { [key: string]: unknown }; error?: { message: string } };
        if (typeof message.id === "number") answers.get(message.id)?.(message);
      }
    }
  })();
  let next = 0;
  const call = (method: string, params: { [key: string]: unknown }): Promise<{ result?: { [key: string]: unknown }; error?: { message: string } }> => {
    const id = ++next;
    const { promise, resolve } = Promise.withResolvers<{ result?: { [key: string]: unknown }; error?: { message: string } }>();
    answers.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  };
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: harness, version: "1.0.0" } });
  if (init.error) throw new Error(`initialize: ${init.error.message}`);
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = await call("tools/list", {});
  const status = await call("tools/call", { name: "lre_status", arguments: {} });
  server.stdin.end();
  await Promise.race([server.exited, Bun.sleep(10_000)]);
  server.kill();
  await reader.catch(() => undefined);
  const first: unknown = Array.isArray(status.result?.content) ? status.result.content[0] : undefined;
  const content = first !== null && typeof first === "object" && "text" in first && typeof first.text === "string" ? first.text : JSON.stringify(status.error ?? status.result);
  return { tools: Array.isArray(tools.result?.tools) ? tools.result.tools.length : 0, status: content };
}

/** Checks `harness` in as the user `ctx` belongs to, unless its check-in is there already; keeps its id under `key`. */
export async function checkInAs(ctx: CheckinCtx, harness: string, step: string, key: string): Promise<void> {
  const before = await listed(ctx, harness);
  if (before !== undefined) {
    say(`the check-in of ${harness} is there already (${before.id})`);
    ctx.log.set(key, before.id);
    return;
  }
  const session = await harnessSession(ctx, harness);
  say(`the MCP server listed ${session.tools} tools; lre_status: ${session.status.replace(/\s+/g, " ").slice(0, 160)}`);
  const after = await listed(ctx, harness);
  if (after === undefined) throw new Error(`the engine shows no check-in from ${harness} after its session`);
  ctx.log.set(key, after.id);
  ctx.log.log({ step, action: "created", kind: "mcp check-in (agents.json)", id: after.id, name: `${after.name} for ${after.harness} on ${after.host}`, detail: { kit: after.kit, state: after.state } });
}

export const checkin: Step = {
  name: "checkin",
  makes: "an outside harness's check-in with the engine's MCP server (agents.json)",
  run: (ctx) => checkInAs(ctx, HARNESS, "checkin", "checkin"),
};
