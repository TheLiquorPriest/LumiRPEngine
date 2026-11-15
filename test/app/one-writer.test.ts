// One writer (plan §4.1): two processes never write RPE's database or its secrets file at once. While
// RPE is stopped, a command that writes takes the data folder's lock and is then the one writer; the
// server takes the same lock for as long as it runs, so `serve` waits for a command that holds it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import type { App } from "../../src/app";
import { connectionRoutes } from "../../src/app";
import { runCli } from "../../src/app/cli";
import { withWriter } from "../../src/app/commands/writer";
import { DataFolderBusy, lockHolder, takeFolderLock } from "../../src/app/data-folder";
import { isRecord } from "../../src/shared/json";
import { type Bed, cliIo, freePort, LUMIVERSE, makeBed, OWNER, testModelLayer, writeConfig } from "./helpers";

describe("one writer", () => {
  let bed: Bed;
  let port: number;

  beforeEach(async () => {
    bed = await makeBed();
    port = freePort();
    await mkdir(bed.paths.root, { recursive: true });
    await writeConfig(bed.paths, { port, lumiverse: { url: LUMIVERSE, user: OWNER } });
  });

  afterEach(async () => {
    await bed.remove();
  });

  /** Starts a command; its io is there to watch while it runs, and `done` is what it came to. */
  function start(argv: string[]): { io: ReturnType<typeof cliIo>; done: Promise<{ code: number; out: string; err: string }> } {
    const io = cliIo();
    return { io, done: runCli([...argv, "--data", bed.paths.root], io, { version: "1.0.0" }).then((code) => ({ code, out: io.outs.join("\n"), err: io.errs.join("\n") })) };
  }

  const rpe = (argv: string[]): Promise<{ code: number; out: string; err: string }> => start(argv).done;

  /**
   * Resolves once `condition` holds. The processes it watches are a lock's waiters, which poll the
   * lock on the real clock, so what they have said is awaited as it is said, not for a guessed time.
   */
  async function until(condition: () => boolean): Promise<void> {
    for (let tries = 0; tries < 2000 && !condition(); tries++) await Bun.sleep(5);
    expect(condition()).toBe(true);
  }

  test("with RPE stopped, a command writes under the data folder's lock; serve started meanwhile waits and says why; two commands at once write one after the other", async () => {
    // Another command holds the data folder: a command that writes waits for it, says so, and has made nothing, the database included, until it lets go.
    const holder = await takeFolderLock(bed.paths.root, "rpe backup", { waitMs: 0 });
    expect((await lockHolder(bed.paths.root))?.what).toBe("rpe backup");
    const key = start(["key"]);
    await until(() => key.io.errs.some((line) => line.includes("Waiting for rpe backup")));
    expect(existsSync(bed.paths.database)).toBe(false);
    holder.release();
    const made = await key.done;
    expect([made.code, made.err]).toEqual([0, "Waiting for rpe backup (process " + process.pid + "), which holds the data folder, to finish..."]);
    expect(made.err).toContain("Waiting for rpe backup");
    expect(made.out).toMatch(/\brpe_[0-9a-f]{64}\b/);
    expect(existsSync(bed.paths.database)).toBe(true);

    // A command held up for longer than the wait fails and says who holds the folder; nothing is written.
    await writeConfig(bed.paths, { port, lumiverse: { url: LUMIVERSE, user: OWNER }, commandLine: { waitMs: 100 } });
    const busy = await takeFolderLock(bed.paths.root, "rpe migrate", { waitMs: 0 });
    const refused = await rpe(["key", "web"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`held by rpe migrate (process ${process.pid})`);
    busy.release();
    expect((await rpe(["status"])).out).toContain("web none");

    // `serve` waits for the command that holds the folder, says so, and then runs.
    await writeConfig(bed.paths, { port, lumiverse: { url: LUMIVERSE, user: OWNER } });
    const held = await takeFolderLock(bed.paths.root, "rpe key", { waitMs: 0 });
    const serve = start(["serve"]);
    const { io } = serve;
    await until(() => io.errs.join("\n").includes(`Waiting for rpe key (process ${process.pid}), which holds the data folder, to finish`));
    expect(io.outs.join("\n")).not.toContain("listens on");
    held.release();
    await until(() => io.outs.some((line) => line.includes("listens on")));
    expect((await fetch(`http://127.0.0.1:${port}/api/v1/status`)).status).toBe(200);
    // While it runs it is the folder's holder: a second serve on the folder is refused with who holds it.
    await writeConfig(bed.paths, { port: freePort(), lumiverse: { url: LUMIVERSE, user: OWNER }, commandLine: { waitMs: 100 } });
    const again = await rpe(["serve"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("held by rpe serve");
    io.stop();
    expect((await serve.done).code).toBe(0);
    // And it lets go when it stops.
    (await takeFolderLock(bed.paths.root, "rpe key", { waitMs: 0 })).release();

    // Two commands at once write in turn: the second begins only once the first, which waits to hear it is held up, has ended.
    const log: string[] = [];
    const second = cliIo();
    const ctx = (what: string, io: ReturnType<typeof cliIo>) => ({ paths: bed.paths, config: bed.config(), io, version: "1.0.0", what });
    const writing = Promise.all([
      withWriter(ctx("rpe key", cliIo()), async () => {
        log.push("first begins");
        await until(() => second.errs.some((line) => line.includes("Waiting for rpe key")));
        log.push("first ends");
      }),
      // Asked once the first holds the folder.
      until(() => log.length > 0).then(() =>
        withWriter(ctx("rpe allow", second), async () => {
          log.push("second begins");
          log.push("second ends");
        }),
      ),
    ]);
    await writing;
    expect(log).toEqual(["first begins", "first ends", "second begins", "second ends"]);
  });

  test("a change of the user's own rows before the install names him writes nothing, not even the lock or the folder", async () => {
    await rm(bed.paths.root, { recursive: true, force: true });
    for (const argv of [["key"], ["allow", "format"]]) {
      const refused = await rpe(argv);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("RPE belongs to no Lumiverse user yet, so nothing was written");
    }
    expect(existsSync(bed.paths.root)).toBe(false);
  });

  test("a held data folder is refused in words that name the process holding it", async () => {
    const holder = await takeFolderLock(bed.paths.root, "rpe serve", { waitMs: 0 });
    const error = await takeFolderLock(bed.paths.root, "rpe key", { waitMs: 30 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataFolderBusy);
    expect(error instanceof Error ? error.message : "").toBe(`The data folder ${bed.paths.root} is held by rpe serve (process ${process.pid}), which did not let go in 30 ms: run this again once it has finished.`);
    holder.release();
    holder.release();
    (await takeFolderLock(bed.paths.root, "rpe key", { waitMs: 0 })).release();
  });
});

const ACCOUNT = { id: "user-reader-0001", username: "reader", password: "invented correct horse" };

/** Lumiverse's username sign-in, as far as the command line asks it: the session's token and the user. */
function signInStandIn(): { url: string; stop(): Promise<void> } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/auth/sign-in/username") return Response.json({ error: "Not found" }, { status: 404 });
      const body: unknown = await request.json();
      if (!isRecord(body) || body.username !== ACCOUNT.username || body.password !== ACCOUNT.password) return Response.json({ message: "Invalid username or password", code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 });
      const token = "invented-session-token-0123456789abcdef";
      return Response.json({ token, user: { id: ACCOUNT.id, name: ACCOUNT.username, username: ACCOUNT.username, email: "reader@example.invalid" } }, { headers: { "set-auth-token": token } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("one writer, while RPE runs", () => {
  let bed: Bed;
  let port: number;
  let lumiverse: ReturnType<typeof signInStandIn>;
  let running: { app: App; stop(): Promise<void> };

  beforeAll(() => {
    lumiverse = signInStandIn();
  });

  afterAll(async () => {
    await lumiverse.stop();
  });

  beforeEach(async () => {
    bed = await makeBed();
    port = freePort();
    await mkdir(bed.paths.root, { recursive: true });
    // A wait for the lock so short that a command that tried to write on its own would fail at once.
    await writeConfig(bed.paths, { port, lumiverse: { url: lumiverse.url, user: ACCOUNT.id }, commandLine: { waitMs: 150 } });
    const captured = Promise.withResolvers<App>();
    const io = cliIo();
    const served = runCli(["serve", "--data", bed.paths.root], io, {
      version: "1.0.0",
      areas: [
        {
          name: "probe",
          mount(a) {
            a.routes.add("probe", connectionRoutes(testModelLayer(a.models), () => ACCOUNT.id, a.log));
            captured.resolve(a);
          },
        },
      ],
    });
    const app = await captured.promise;
    for (let tries = 0; tries < 1000 && !io.outs.some((line) => line.includes("listens on")); tries++) await Bun.sleep(5);
    expect(io.outs.some((line) => line.includes("listens on"))).toBe(true);
    running = {
      app,
      stop: async () => {
        io.stop();
        expect(await served).toBe(0);
      },
    };
  });

  afterEach(async () => {
    await running.stop();
    await bed.remove();
  });

  async function rpe(argv: string[], answers: { secret?: string | null } = {}): Promise<{ code: number; out: string; err: string }> {
    const io = cliIo(answers);
    const code = await runCli([...argv, "--data", bed.paths.root], io, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
  }

  test("while RPE runs, every rpe command that changes something is written by the server's one queue, and the command's own process writes neither the database nor the secrets file", async () => {
    const { app } = running;
    const queued: string[] = [];
    const run = app.writes.run.bind(app.writes);
    spyOn(app.writes, "run").mockImplementation((write, label) => {
      queued.push(label ?? "a write");
      return run(write, label);
    });
    const kept: string[] = [];
    const write = app.secrets.write.bind(app.secrets);
    spyOn(app.secrets, "write").mockImplementation((part, value) => {
      kept.push(part);
      return write(part, value);
    });
    // The server holds the data folder, so a command that wrote on its own would wait for it in vain: each of these has to be the server's write.
    expect((await lockHolder(bed.paths.root))?.what).toBe("rpe serve");
    await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" });
    queued.length = 0;

    const key = await rpe(["key"]);
    expect(key.code).toBe(0);
    expect(key.out).toMatch(/\brpe_[0-9a-f]{64}\b/);
    expect(await app.auth.holds("provider", /\b(rpe_[0-9a-f]{64})\b/.exec(key.out)?.[1] ?? null)).toBe(true);
    expect(queued).toEqual(["the command line's change"]);

    expect((await rpe(["key", "web"])).code).toBe(0);
    const allowed = await rpe(["allow", "format"]);
    expect(allowed.code).toBe(0);
    expect(await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" })).toBe("on");
    expect((await rpe(["deny", "format"])).code).toBe(0);
    expect(await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" })).toBe("off");
    expect(queued.filter((label) => label === "the command line's change")).toHaveLength(4);

    const signed = await rpe(["lumiverse", "--url", lumiverse.url, "--user", ACCOUNT.username], { secret: ACCOUNT.password });
    expect(signed.code).toBe(0);
    expect(kept).toContain("lumiverse");
    expect(JSON.parse(await readFile(bed.paths.secrets, "utf8")).parts.lumiverse).toMatchObject({ username: ACCOUNT.username, user: ACCOUNT.id });

    const added = await rpe(["connection", "add", "--name", "Floor", "--provider", "deepseek", "--model", "deepseek-v4-flash"], { secret: "sk-invented-key-0123456789abcdef" });
    expect(added.code).toBe(0);
    expect((await rpe(["connection", "list"])).out).toContain("* Floor");
    expect((await rpe(["connection", "remove", "Floor"])).code).toBe(0);
    // No page token was made for the command line's calls: the socket is the credential.
    expect(app.db.query("SELECT count(*) AS n FROM page_token WHERE kind = 'page' AND made_by = 'command line'").get()).toEqual({ n: 0 });

    const status = await rpe(["status"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("Switches: 0 waiting, 0 on, 1 off");
    expect(status.out).toContain("Builds: ");
    // Nothing of the command line's took the folder from the server.
    expect((await lockHolder(bed.paths.root))?.what).toBe("rpe serve");
  });

  test("rpe lumiverse saving its sign-in while the server saves a provider key: both are in the secrets file after", async () => {
    const [signed, added] = await Promise.all([
      rpe(["lumiverse", "--url", lumiverse.url, "--user", ACCOUNT.username], { secret: ACCOUNT.password }),
      rpe(["connection", "add", "--name", "Floor", "--provider", "deepseek", "--model", "deepseek-v4-flash"], { secret: "sk-invented-key-0123456789abcdef" }),
    ]);
    expect([signed.code, added.code]).toEqual([0, 0]);
    const secrets = JSON.parse(await readFile(bed.paths.secrets, "utf8"));
    expect(secrets.parts.lumiverse).toMatchObject({ username: ACCOUNT.username, user: ACCOUNT.id });
    expect(JSON.stringify(secrets.parts.models)).toContain("sk-invented-key-0123456789abcdef");
  });
});
