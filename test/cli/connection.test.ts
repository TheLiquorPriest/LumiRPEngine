// The way in (DESIGN §23) against a fake host: the access sequence as Lumiverse needs it, the
// waits and timeouts a host that never acknowledges anything needs, and the messages a user sees
// when the session ended or LumiRPEngine is too old.

import { describe, expect, test } from "bun:test";
import { HostConnection, LiveError, LreError, signIn } from "../../src/cli/connection";
import { AGENT_API } from "../../src/shared/protocol";
import { client, FakeLumiverse, USER } from "./fake-lumiverse";

/** Lets the fake's queued work run: every step of it is a microtask, so no clock is involved. */
async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe("the connection", () => {
  test("signs in once and uses the token as a bearer, with no Origin or Cookie anywhere", async () => {
    const fake = new FakeLumiverse();
    const token = await signIn(fake.http, fake.base, USER.username, USER.password);
    const conn = new HostConnection({ base: fake.base, username: USER.username, token, http: fake.http, openSocket: fake.openSocket, client: { name: "lumirpengine", version: "0.0.1" } });
    await conn.request("lre.world", { op: "list" });
    await conn.request("lre.world", { op: "list" });
    conn.close();
    expect(fake.requests.filter((r) => r.url.endsWith("/sign-in/username"))).toHaveLength(1);
    for (const r of fake.requests) expect(Object.keys(r.headers).filter((h) => /^(origin|cookie)$/i.test(h))).toEqual([]);
    expect(fake.requests.filter((r) => !r.url.includes("/api/auth/")).every((r) => r.headers.Authorization === `Bearer ${token}`)).toBe(true);
  });

  test("opens the socket as a widget with a fresh frontend session, and sends nothing before CONNECTED", async () => {
    const fake = new FakeLumiverse();
    fake.holdConnected = true;
    const { conn } = client(fake);
    const listed = conn.request("lre.world", { op: "list" });
    await settle();
    expect(fake.sockets).toHaveLength(1);
    expect(fake.sockets[0]?.frames).toEqual([]);
    expect(fake.sockets[0]?.dropped).toEqual([]);
    fake.release();
    await listed;
    const url = fake.sockets[0]?.url;
    expect(url?.protocol).toBe("ws:");
    expect(url?.pathname).toBe("/api/ws");
    expect(url?.searchParams.get("frontend_runtime")).toBe("widget");
    expect(url?.searchParams.get("frontend_session")).toMatch(/^[0-9a-f]{32}$/);
    // The hello names the client, and every frame leads with its type.
    const [hello] = fake.frames;
    expect(hello).toMatchObject({ type: "SPINDLE_BACKEND_MSG", extensionId: "ext-lre-1", payload: { lre: 1, type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } } });
    expect(Object.keys(hello ?? {})[0]).toBe("type");
    conn.close();
  });

  test("matches each answer to its request, whatever order they come in and whatever pushes come between", async () => {
    const fake = new FakeLumiverse();
    const a = fake.lre.seed("Alpha");
    const b = fake.lre.seed("Beta");
    const { conn } = client(fake);
    const [ra, rb, list] = await Promise.all([conn.request("lre.world", { op: "get", worldId: a.index.id }), conn.request("lre.world", { op: "get", worldId: b.index.id }), conn.request("lre.world", { op: "list" })]);
    expect([ra.world?.name, rb.world?.name, list.worlds?.length]).toEqual(["Alpha", "Beta", 2]);
    const refused = conn.request("lre.world", { op: "get", worldId: "w_none" });
    expect(refused).rejects.toBeInstanceOf(LreError);
    await refused.catch((e: unknown) => expect(e instanceof LreError && e.code).toBe("not_found"));
    conn.close();
  });

  // The connection's timeout runs on the real clock; a short one keeps this quick.
  test("a request the host never answers times out with a message that says a write may still have happened", async () => {
    const fake = new FakeLumiverse();
    const { conn } = client(fake, { timeoutMs: 80 });
    await conn.request("lre.world", { op: "list" });
    fake.silent.add("lre.editor");
    const started = Date.now();
    const error = await conn.request("lre.editor", { op: "get", worldId: "w_0001", base: null }).catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("timeout");
    expect(error instanceof Error && error.message).toContain("A change may still have been made");
    expect(Date.now() - started).toBeLessThan(1000);
    conn.close();
  });

  test("reconnects with a new ticket after the host closes the socket, and fails what was waiting", async () => {
    const fake = new FakeLumiverse();
    fake.lre.seed("Alpha");
    const { conn } = client(fake, { timeoutMs: 500 });
    await conn.request("lre.world", { op: "list" });
    fake.silent.add("lre.editor");
    const waiting = conn.request("lre.editor", { op: "get", worldId: "w_0001", base: null }).catch((e: unknown) => e);
    await settle();
    fake.restart();
    const error = await waiting;
    expect(error instanceof LiveError && error.problem).toBe("closed");
    fake.silent.clear();
    const again = await conn.request("lre.world", { op: "list" });
    expect(again.worlds).toHaveLength(1);
    expect(fake.sockets).toHaveLength(2);
    expect(fake.requests.filter((r) => r.url.endsWith("/ws-ticket"))).toHaveLength(2);
    // Each socket says hello on its own: the new session is a new client to the backend.
    expect(fake.lre.sent("lre.hello")).toHaveLength(2);
    conn.close();
  });

  test("a session the host no longer has asks for lumirpengine login, without signing in again", async () => {
    const fake = new FakeLumiverse();
    const { conn, token } = client(fake);
    fake.tokens.delete(token);
    const error = await conn.request("lre.world", { op: "list" }).catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("login");
    expect(error instanceof Error && error.message).toContain(`lumirpengine login --url ${fake.base}`);
    expect(fake.requests.some((r) => r.url.endsWith("/sign-in/username"))).toBe(false);
  });

  test("an LRE without the agent API is refused for tools but still described", async () => {
    const fake = new FakeLumiverse();
    fake.lre.agentApi = undefined;
    const { conn } = client(fake);
    const error = await conn.request("lre.world", { op: "list" }).catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("too_old");
    expect(error instanceof Error && error.message).toContain("Update LumiRPEngine on your Lumiverse");
    expect(fake.lre.sent("lre.world")).toEqual([]);
    const described = await conn.describe();
    expect(described).toMatchObject({ agentApi: null, extension: { status: "running" }, session: { valid: true } });
    expect(described.problem).toContain(`needs ${AGENT_API}`);
    conn.close();
  });

  test("a stopped extension and a missing one say so", async () => {
    const fake = new FakeLumiverse();
    fake.extension = { ...fake.extension, enabled: false, status: "stopped" };
    const stopped = await client(fake).conn.request("lre.world", { op: "list" }).catch((e: unknown) => e);
    expect(stopped instanceof LiveError && stopped.problem).toBe("not_running");
    fake.extension = { ...fake.extension, identifier: "something_else" };
    const missing = await client(fake).conn.request("lre.world", { op: "list" }).catch((e: unknown) => e);
    expect(missing instanceof LiveError && missing.problem).toBe("not_installed");
  });

  test("a frame over Lumiverse's 4 MiB limit is refused here, since the host would drop it without a word", async () => {
    const fake = new FakeLumiverse();
    const { conn } = client(fake);
    await conn.request("lre.world", { op: "list" });
    const huge = { format: "lre-world-v1", blob: "é".repeat(2_200_000) };
    const error = await conn.request("lre.world", { op: "import", file: huge }).catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("too_large");
    expect(fake.lre.sent("lre.world", "import")).toEqual([]);
    conn.close();
  });

  test("a wrong password says so and warns about the lockout", async () => {
    const fake = new FakeLumiverse();
    const error = await signIn(fake.http, fake.base, USER.username, "wrong").catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("login");
    expect(error instanceof Error && error.message).toContain("locks your address out");
  });
});
