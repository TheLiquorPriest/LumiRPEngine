// The way in (DESIGN §23) against a fake host: the messages a user sees when the session ended, the extension is stopped or missing, or the password is wrong.

import { describe, expect, test } from "bun:test";
import type { Http } from "../../src/cli/connection";
import { HostConnection, LiveError, sessionOf, signIn } from "../../src/cli/connection";
import { client, FakeLumiverse, USER } from "./fake-lumiverse";

/** The fake host, except that the session route answers `status` (with `headers`, named in any case, and `body`). */
function sessionAnswers(fake: FakeLumiverse, status: number, headers: Record<string, string> = {}, body = ""): Http {
  const named = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return async (req) => (req.url.endsWith("/api/auth/get-session") ? { status, header: (name) => named.get(name.toLowerCase()) ?? null, text: body } : fake.http(req));
}

describe("the connection", () => {
  test("a session the host no longer has asks for lumirpengine login, without signing in again", async () => {
    const fake = new FakeLumiverse();
    const { conn, token } = client(fake);
    fake.tokens.delete(token);
    const error = await conn.request("lre.world", { op: "list" }).catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("login");
    expect(error instanceof Error && error.message).toContain(`lumirpengine login --url ${fake.base}`);
    expect(fake.requests.some((r) => r.url.endsWith("/sign-in/username"))).toBe(false);
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

  test("a wrong password says so and warns about the lockout", async () => {
    const fake = new FakeLumiverse();
    const error = await signIn(fake.http, fake.base, USER.username, "wrong").catch((e: unknown) => e);
    expect(error instanceof LiveError && error.problem).toBe("login");
    expect(error instanceof Error && error.message).toContain("locks your address out");
  });

  test("only a 401 or an answer without a session means signed out; a lockout and an outage say what they are", async () => {
    const fake = new FakeLumiverse();
    const token = fake.session();
    expect(await sessionOf(fake.http, fake.base, token)).toEqual({ valid: true, expiresAt: "2026-10-25T18:00:00.000Z" });
    expect(await sessionOf(fake.http, fake.base, "tok_nobody")).toEqual({ valid: false, expiresAt: null });
    expect(await sessionOf(sessionAnswers(fake, 401), fake.base, token)).toEqual({ valid: false, expiresAt: null });
    // A lockout covers every route; telling the user to sign in again would only make it longer.
    const locked = await sessionOf(sessionAnswers(fake, 429, { "Retry-After": "900" }, JSON.stringify({ error: "Too many failed login attempts" })), fake.base, token).catch((e: unknown) => e);
    expect(locked instanceof LiveError && locked.problem).toBe("locked");
    expect(locked instanceof Error && locked.message).toContain("every request from this address for about 15 minutes: Too many failed login attempts");
    expect(locked instanceof Error && locked.message).not.toContain("Sign in again");
    const down = await sessionOf(sessionAnswers(fake, 502), fake.base, token).catch((e: unknown) => e);
    expect(down instanceof LiveError && down.problem).toBe("unreachable");
    expect(down instanceof Error && down.message).toContain("answered 502");
    // The status a tool reports then: the session's state unknown, not "signed out".
    const conn = new HostConnection({ base: fake.base, credentials: () => ({ username: USER.username, token }), http: sessionAnswers(fake, 429, { "Retry-After": "60" }), openSocket: fake.openSocket, client: { name: "lumirpengine", version: "0.0.1" } });
    const described = await conn.describe();
    expect(described.session).toEqual({ valid: null, expiresAt: null });
    expect(described.problem).toContain("for about 1 minute");
  });
});
