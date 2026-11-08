// The outside clients LumiRPEngine serves its tools to (`lre.tools`, DESIGN §23) are remembered per
// user, by session, while their sessions are open (the depth release's security review, M2): another
// user's hellos, however many, never evict one; past the cap only the user's own least recently used
// session goes, a session that keeps asking staying; and a session that closed is forgotten.

import { expect, test } from "bun:test";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

/** Sends a request as an account, from one of its sessions, and waits for its reply. */
async function sendAs(rig: Rig, userId: string, session: string, request: Record<string, unknown>): Promise<BackendToFrontend> {
  const reqId = `as-${crypto.randomUUID()}`;
  const before = rig.host.sent.length;
  await rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, userId, session);
  await rig.host.settle();
  const reply = rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
  if (!reply) throw new Error(`no reply to ${String(request.type)}`);
  return reply;
}

test("another user's hellos never evict a user's outside client; past the cap only the user's own least recently used goes, and a closed session is forgotten", async () => {
  const rig = new Rig();
  const me = rig.host.userId;
  const hello = (userId: string, session: string) => sendAs(rig, userId, session, { type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.1.0" } });
  const list = (userId: string, session: string) => sendAs(rig, userId, session, { type: "lre.tools", op: "list" });
  await hello(me, "s_mcp");
  expect((await list(me, "s_mcp")).type).toBe("lre.result");
  // Mallory's CLI in a loop: a new session's hello each time.
  for (let i = 0; i < 300; i++) await hello("mallory", `s_mallory_${i}`);
  expect((await list(me, "s_mcp")).type).toBe("lre.result");
  // The user's own command line, run by an agent harness: 40 sessions while the MCP server keeps asking.
  for (let i = 0; i < 40; i++) {
    await hello(me, `s_cli_${i}`);
    if (i % 8 === 7) expect((await list(me, "s_mcp")).type).toBe("lre.result");
  }
  expect((await list(me, "s_mcp")).type).toBe("lre.result");
  expect(await list(me, "s_cli_0")).toMatchObject({ type: "lre.error", code: "forbidden" });
  expect((await list(me, "s_cli_39")).type).toBe("lre.result");
  // A session that closed is forgotten: its client is gone.
  rig.host.closeSession("s_mcp");
  await rig.host.settle();
  expect(await list(me, "s_mcp")).toMatchObject({ type: "lre.error", code: "forbidden" });
});
