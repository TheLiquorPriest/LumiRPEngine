// `rpe lumiverse`, against a stand-in that answers as Lumiverse's sign-in route does. A good password
// writes the address, the user's id, the database and the connection to the config, and the sign-in
// (never the password) to the secrets part the adapter reads; a refused password and an address that
// does not answer say so and change nothing; the token is never shown; and a running RPE is told to
// restart to take it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../../src/app/archive";
import { runCli } from "../../src/app/cli";
import { isRecord } from "../../src/shared/json";
import { type Bed, cliIo, freePort, makeBed, writeConfig } from "./helpers";

const ACCOUNT = { id: "user-reader-0001", username: "reader", password: "invented correct horse" };

interface StandIn {
  url: string;
  /** Every sign-in asked for, with the headers that matter to Lumiverse's checks. */
  signIns: { body: unknown; origin: string | null; cookie: string | null }[];
  /** The session tokens it gave, in order. */
  tokens: string[];
  stop(): Promise<void>;
}

/**
 * Lumiverse's username sign-in as Better Auth answers it (`auth/index.ts:90,114,143` in Lumiverse;
 * `better-auth/dist/plugins/username/index.mjs:158-161` for the answer, `error-codes.mjs:5` for the
 * refusal): the session's token and the user, with the token also in `set-auth-token`; or 401.
 */
function standIn(): StandIn {
  const signIns: StandIn["signIns"] = [];
  const tokens: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/auth/sign-in/username") return Response.json({ error: "Not found" }, { status: 404 });
      const body: unknown = await request.json();
      signIns.push({ body, origin: request.headers.get("origin"), cookie: request.headers.get("cookie") });
      if (!isRecord(body) || body.username !== ACCOUNT.username || body.password !== ACCOUNT.password) return Response.json({ message: "Invalid username or password", code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 });
      const token = `invented-session-token-${tokens.length + 1}-0123456789abcdef`;
      tokens.push(token);
      return Response.json({ token, user: { id: ACCOUNT.id, name: ACCOUNT.username, username: ACCOUNT.username, email: "reader@example.invalid" } }, { headers: { "set-auth-token": token } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, signIns, tokens, stop: () => server.stop(true) };
}

describe("rpe lumiverse", () => {
  let lumiverse: StandIn;
  let bed: Bed;
  let lumiverseDb: string;

  beforeAll(() => {
    lumiverse = standIn();
  });

  afterAll(async () => {
    await lumiverse.stop();
  });

  beforeEach(async () => {
    bed = await makeBed();
    lumiverse.signIns.length = 0;
    // An invented file in the place of Lumiverse's database: the command only needs it to be there.
    lumiverseDb = join(bed.root, "lumiverse.db");
    await writeFile(lumiverseDb, "");
  });

  afterEach(async () => {
    await bed.remove();
  });

  async function rpe(argv: string[], password: string | null = null): Promise<{ code: number; out: string; err: string }> {
    const io = cliIo({ secret: password });
    const code = await runCli([...argv, "--data", bed.paths.root], io, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
  }

  /** Every file under the test's folder with its text, to see that nothing changed. */
  async function everything(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const file of await walk(bed.root)) out.set(file.path, await readFile(join(bed.root, file.path), "utf8"));
    return out;
  }

  test("a good password writes where RPE belongs and keeps the sign-in the adapter reads, never the password, and never shows the token", async () => {
    const made = await rpe(["lumiverse", "--url", `${lumiverse.url}/`, "--user", "reader", "--database", lumiverseDb, "--connection", "connection-7"], ACCOUNT.password);
    expect(made).toMatchObject({ code: 0 });
    expect(lumiverse.signIns).toEqual([{ body: { username: "reader", password: ACCOUNT.password }, origin: null, cookie: null }]);
    const token = lumiverse.tokens.at(-1) ?? "";
    expect(JSON.parse(await readFile(bed.paths.config, "utf8")).lumiverse).toEqual({ url: lumiverse.url, user: ACCOUNT.id, database: lumiverseDb, connection: "connection-7" });
    expect(JSON.parse(await readFile(bed.paths.secrets, "utf8")).parts.lumiverse).toEqual({ username: "reader", token, user: ACCOUNT.id, savedAt: expect.any(Number) });
    for (const text of (await everything()).values()) expect(text).not.toContain(ACCOUNT.password);
    expect(made.out).toContain(`Signed in to Lumiverse at ${lumiverse.url} as reader. This RPE belongs to that Lumiverse user (${ACCOUNT.id}).`);
    const shown = await rpe(["lumiverse"]);
    expect(shown.code).toBe(0);
    for (const line of [`Lumiverse: ${lumiverse.url}`, `User: ${ACCOUNT.id}`, `Database: ${lumiverseDb}`, "RPE's connection in Lumiverse: connection-7", `Signed in: as reader (user ${ACCOUNT.id}) since`]) expect(shown.out).toContain(line);
    expect(made.out + made.err + shown.out + shown.err).not.toContain(token);
  });

  test("a refused password says so and changes nothing", async () => {
    const first = await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader"], "a wrong password");
    expect(first.code).toBe(1);
    expect(first.err).toContain("Lumiverse refused that username or password: Invalid username or password.");
    expect(existsSync(bed.paths.root)).toBe(false);
    expect((await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader", "--connection", "connection-7"], ACCOUNT.password)).code).toBe(0);
    const before = await everything();
    const refused = await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader", "--connection", "connection-9"], "a wrong password");
    expect(refused.code).toBe(1);
    expect(await everything()).toEqual(before);
    // No password, and a password given on the line, sign nobody in.
    expect((await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader"], null)).err).toContain("needs the password");
    expect((await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader", "--password", ACCOUNT.password])).code).toBe(2);
    expect(await everything()).toEqual(before);
  });

  test("an address that does not answer says so and changes nothing", async () => {
    const nobody = `http://127.0.0.1:${freePort()}`;
    const before = await everything();
    const unanswered = await rpe(["lumiverse", "--url", nobody, "--user", "reader", "--database", lumiverseDb], ACCOUNT.password);
    expect(unanswered.code).toBe(1);
    expect(unanswered.err).toContain(`Lumiverse at ${nobody} cannot be reached`);
    expect(await everything()).toEqual(before);
    expect(lumiverse.signIns).toEqual([]);
  });

  test("a running RPE is told to restart to take it", async () => {
    const port = freePort();
    await mkdir(bed.paths.root, { recursive: true });
    await writeConfig(bed.paths, { port, lumiverse: { url: lumiverse.url, user: null } });
    await (await bed.open({ config: { port } })).start();
    const told = await rpe(["lumiverse", "--url", lumiverse.url, "--user", "reader"], ACCOUNT.password);
    expect(told.code).toBe(0);
    expect(told.out).toContain(`RPE is running at http://127.0.0.1:${port}: restart it`);
    expect(JSON.parse(await readFile(bed.paths.config, "utf8"))).toMatchObject({ port, lumiverse: { url: lumiverse.url, user: ACCOUNT.id } });
  });

  test("an RPE that belongs to another Lumiverse user is not signed in to, by rpe lumiverse or rpe up, and nothing is written", async () => {
    await mkdir(bed.paths.root, { recursive: true });
    await writeConfig(bed.paths, { lumiverse: { url: lumiverse.url, user: "user-before" } });
    const before = await everything();
    const words = `This RPE belongs to the Lumiverse user user-before, and this run is for ${ACCOUNT.id}: one RPE serves one Lumiverse user. Nothing was stopped or changed.`;
    for (const argv of [
      ["lumiverse", "--url", lumiverse.url, "--user", "reader"],
      ["up", "--url", lumiverse.url, "--user", "reader"],
    ]) {
      const refused = await rpe(argv, ACCOUNT.password);
      expect(refused.code).toBe(1);
      expect(refused.err).toBe(words);
      expect(await everything()).toEqual(before);
    }
    // Lumiverse took the password both times: the refusal is of whose RPE this is.
    expect(lumiverse.signIns).toHaveLength(2);
  });
});
