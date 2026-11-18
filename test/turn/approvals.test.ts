// RPE's approvals port (plan §6.8): each lane's permission as the chat's config sets it, a question kept and answered, and one taken down when the run stops.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { FilesPort, Log } from "rp-harness/contract";
import { Approvals } from "../../src/turn/approvals";
import { HARNESS_MIGRATIONS } from "../../src/turn/tables";

const SCOPE = { user: "user-a", chat: "chat-a", session: "s-1", turn: "t-1" };
const AGENT = { id: "author-1", definition: "author" };

/** A chat whose own config says `chat`, over the shipped and global levels that say nothing; `idle` says which calls would only answer that they do nothing. */
function port(chat: string, idle?: (scope: unknown, tool: string) => Promise<boolean>) {
  const db = new Database(":memory:");
  for (const step of HARNESS_MIGRATIONS.filter((s) => s.version === 21)) db.run(step.sql);
  const files = {
    layers: async () => [{ level: "chat", mount: "chats/chat-a/", config: "RPE.yml" }],
    read: async () => ({ status: "read", text: chat }),
  } as unknown as Pick<FilesPort, "layers" | "read">;
  const log = { warn: () => undefined, error: () => undefined, info: () => undefined, debug: () => undefined } as unknown as Log;
  const writes = { run: async <T>(write: (d: Database) => T): Promise<T> => write(db) };
  return new Approvals({ db, writes, files, log, now: () => 1000, ...(idle === undefined ? {} : { idle }) });
}

const ask = { agent: AGENT, callId: "call-1", tool: "world_apply", lane: "engine", args: {}, at: 1000 };

describe("the approvals port", () => {
  test("a lane is Auto unless the chat's config sets it, and Never or Confirm as it is set", async () => {
    expect(await port("").permission(SCOPE, "engine")).toBe("auto");
    const set = port("permissions:\n  engine: never\n  story: confirm\n");
    expect(await set.permission(SCOPE, "engine")).toBe("never");
    expect(await set.permission(SCOPE, "story")).toBe("confirm");
    expect(await set.permission(SCOPE, "external")).toBe("auto");
  });

  test("a question waits for his word and goes ahead on go; with no, the reason is the answer; a stop takes it down", async () => {
    const approvals = port("");
    const go = approvals.ask(SCOPE, ask, new AbortController().signal);
    await Bun.sleep(5);
    const [waiting] = approvals.waitingIn("user-a", "chat-a");
    expect(waiting?.tool).toBe("world_apply");
    expect(await approvals.answer("user-a", waiting?.id ?? "", { go: true })).toEqual({ ok: true });
    expect(await go).toEqual({ go: true });
    expect(approvals.ofTurn("user-a", "chat-a", "t-1")[0]?.state).toBe("answered");

    const no = approvals.ask(SCOPE, { ...ask, callId: "call-2" }, new AbortController().signal);
    await Bun.sleep(5);
    await approvals.answer("user-a", approvals.waitingIn("user-a", "chat-a")[0]?.id ?? "", { go: false, reason: "not now" });
    expect(await no).toEqual({ go: false, reason: "not now" });

    const stop = new AbortController();
    const held = approvals.ask(SCOPE, { ...ask, callId: "call-3" }, stop.signal);
    await Bun.sleep(5);
    stop.abort(new Error("the turn stopped"));
    await expect(held).rejects.toThrow("the turn stopped");
    await Bun.sleep(5);
    expect(approvals.waitingIn("user-a", "chat-a")).toEqual([]);
    expect(approvals.ofTurn("user-a", "chat-a", "t-1").map((q) => q.state)).toEqual(["answered", "answered", "taken_down"]);
  });

  test("a call that would only answer that it does nothing here is let through with no question, and any other call of the lane still waits", async () => {
    const approvals = port("permissions:\n  external: confirm\n", async (_scope, tool) => tool === "web_search");
    expect(await approvals.ask(SCOPE, { ...ask, tool: "web_search", lane: "external" }, new AbortController().signal)).toEqual({ go: true });
    expect(approvals.ofTurn("user-a", "chat-a", "t-1")).toEqual([]);
    const held = approvals.ask(SCOPE, { ...ask, callId: "call-2", tool: "mcp_call", lane: "external" }, new AbortController().signal);
    const { promise: turned, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await turned;
    expect(approvals.waitingIn("user-a", "chat-a").map((q) => q.tool)).toEqual(["mcp_call"]);
    await approvals.answer("user-a", approvals.waitingIn("user-a", "chat-a")[0]?.id ?? "", { go: true });
    expect(await held).toEqual({ go: true });
  });
});
