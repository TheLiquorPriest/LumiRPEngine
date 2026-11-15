// The command line `rpe`: `serve` runs the server until it is told to stop; `key` shows a new key once
// and keeps only its hash; `backup` makes one private archive of the database and the file tree;
// `status` says what this RPE is; and `connection` works through the running server's API. Each
// test that needs a server starts it in-process on a free loopback port.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, RunningServer } from "../../src/app";
import { connectionRoutes, rawRoute } from "../../src/app";
import { invokedAs, runLine } from "../../src/app/commands/run-line";
import { dataPaths, defaultDataFolder } from "../../src/app/config";
import { runCli, USAGE } from "../../src/app/cli";
import { bearer, type Bed, cliIo, freePort, LUMIVERSE, makeBed, OWNER, testModelLayer, writeConfig } from "./helpers";

describe("rpe", () => {
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

  async function rpe(argv: string[], answers: { secret?: string | null } = {}): Promise<{ code: number; out: string; err: string }> {
    const io = cliIo(answers);
    const code = await runCli([...argv, "--data", bed.paths.root], io, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
  }

  /** The app on the data folder and port the command line reads, with a provider endpoint and the connection routes mounted. */
  async function serving(): Promise<{ app: App; server: RunningServer }> {
    const app = await bed.open({
      config: { port },
      areas: [
        {
          name: "probe",
          mount(a) {
            a.routes.add("probe", [rawRoute({ method: "POST", path: "/v1/chat/completions", access: "provider", group: "provider", does: "A test's provider endpoint.", answers: "a chat completion", raw: () => Response.json({ object: "chat.completion" }) }), ...connectionRoutes(testModelLayer(a.models), () => OWNER, a.log)]);
          },
        },
      ],
    });
    return { app, server: await app.start() };
  }

  test("serve runs RPE in the foreground until it is told to stop", async () => {
    const io = cliIo();
    const served = runCli(["serve", "--data", bed.paths.root], io, { version: "1.0.0" });
    const status = async (): Promise<number> => (await fetch(`http://127.0.0.1:${port}/api/v1/status`)).status;
    let answered = 0;
    for (let tries = 0; tries < 400 && answered !== 200; tries++) answered = await status().catch(async () => (await Bun.sleep(10), 0));
    expect(answered).toBe(200);
    expect(io.outs.join("\n")).toContain(`listens on http://127.0.0.1:${port}`);
    expect(io.outs.join("\n")).toContain("There is no provider key yet");
    io.stop();
    expect(await served).toBe(0);
    expect(await status().catch(() => 0)).toBe(0);
  });

  test("key shows a new provider key once, keeps only its hash, and the one before it stops working", async () => {
    const first = await rpe(["key"]);
    expect(first.code).toBe(0);
    const key = /\b(rpe_[0-9a-f]{64})\b/.exec(first.out)?.[1] ?? "";
    expect(key).not.toBe("");
    expect(new TextDecoder().decode(await readFile(bed.paths.database))).not.toContain(key.slice(4));
    const { server } = await serving();
    const completion = (k: string) => fetch(`${server.url}/v1/chat/completions`, { method: "POST", headers: { ...bearer(k), "content-type": "application/json" }, body: "{}" });
    expect((await completion(key)).status).toBe(200);
    const second = await rpe(["key"]);
    const next = /\b(rpe_[0-9a-f]{64})\b/.exec(second.out)?.[1] ?? "";
    expect((await completion(key)).status).toBe(401);
    expect((await completion(next)).status).toBe(200);
    expect((await rpe(["key", "admin"])).code).toBe(2);
  });

  test("rpe key takes provider and web; extension is answered with why: RPE makes its extension's key itself at every start", async () => {
    const asked = await rpe(["key", "extension"]);
    expect(asked.code).toBe(1);
    expect(asked.err).toContain("RPE makes its extension's key itself at every start and hands it over");
    expect(asked.out).toBe("");
    expect(existsSync(bed.paths.database)).toBe(false);
    expect((await rpe(["key", "web"])).out).toMatch(/\brpw_[0-9a-f]{64}\b/);
    expect((await rpe(["help"])).out).not.toContain("extension|");
  });

  test("key web says when the key it prints runs out, and status lists it: no end as shipped, auth.webKeyDays after it is made when set", async () => {
    expect((await rpe(["key", "web"])).out).toContain("It has no end: it works until a new web key replaces it.");
    expect((await rpe(["status"])).out).toMatch(/web made 2026-11-13, no end/);
    await writeConfig(bed.paths, { port, lumiverse: { url: LUMIVERSE, user: OWNER }, auth: { webKeyDays: 30 } });
    expect((await rpe(["key", "web"])).out).toContain("It works until 2026-12-13 12:00 UTC.");
    expect((await rpe(["status"])).out).toMatch(/web made 2026-11-13, runs out 2026-12-13 12:00 UTC/);
  });

  test("backup makes one private archive of the database and the file tree, and never writes over one", async () => {
    const { app } = await serving();
    await app.writes.run((db) => db.run("INSERT INTO page_token (hash, user, kind, made_by, made, expires) VALUES ('h', 'u', 'page', 'extension', 1, 2)"));
    await mkdir(join(bed.paths.files, "chats", "a-chat"), { recursive: true });
    await writeFile(join(bed.paths.files, "chats", "a-chat", "WORLD.md"), "# A world\n");
    await writeFile(bed.paths.globalConfig, "history:\n  keep: 40\n");
    const out = join(bed.root, "made.tar");
    const made = await rpe(["backup", "--out", out]);
    expect(made.code).toBe(0);
    expect(made.out).toContain("2 files of the tree");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const files = await new Bun.Archive(await readFile(out)).files();
    expect([...files.keys()].sort()).toEqual(["files/RPE-global.yml", "files/chats/a-chat/WORLD.md", "rpe.db"]);
    expect(await files.get("files/chats/a-chat/WORLD.md")?.text()).toBe("# A world\n");
    const copied = join(bed.root, "copied.db");
    await Bun.write(copied, (await files.get("rpe.db")?.bytes()) ?? new Uint8Array());
    const db = new Database(copied, { readonly: true });
    try {
      expect(db.query("SELECT user FROM page_token").all()).toEqual([{ user: "u" }]);
    } finally {
      db.close();
    }
    const again = await rpe(["backup", "--out", out]);
    expect(again.code).toBe(1);
    expect((await rpe(["backup"])).out).toContain(join(bed.paths.backups, "rpe-backup-20261113T120000Z.tar"));
  });

  test("status says where RPE listens, whether it answers, its keys and what waits to be switched on", async () => {
    expect((await rpe(["status"])).out).toContain("not answering");
    const { app } = await serving();
    await rpe(["key"]);
    await app.switches.state(app.auth.owner, { kind: "hook", name: "format", target: "fmt --write {file}" });
    const shown = await rpe(["status"]);
    expect(shown.code).toBe(0);
    expect(shown.out).toContain(`Listens on: http://127.0.0.1:${port}, answering (RPE 1.0.0)`);
    expect(shown.out).toContain(`for user ${OWNER}`);
    expect(shown.out).toMatch(/provider ends [0-9a-f]{4}/);
    expect(shown.out).toContain("waiting: format (hook) runs or calls fmt --write {file}. Switch it on with: rpe allow format");
  });

  test("connection adds, lists and removes through the running server, asking for the key and never showing it", async () => {
    expect((await rpe(["connection", "list"])).err).toContain("RPE is not answering");
    const { app } = await serving();
    const key = "sk-invented-key-0123456789abcdef";
    const added = await rpe(["connection", "add", "--name", "Floor", "--provider", "deepseek", "--model", "deepseek-v4-flash", "--effort", "high"], { secret: key });
    expect(added.code).toBe(0);
    expect(added.out).toContain("Added Floor");
    const listed = await rpe(["connection", "list"]);
    expect(listed.out).toContain("* Floor");
    expect(listed.out).toContain("key set");
    expect(listed.out + added.out).not.toContain(key.slice(-4));
    expect(await readFile(app.paths.secrets, "utf8")).toContain(key);
    expect((await rpe(["connection", "add", "--name", "Keyless", "--provider", "deepseek"], { secret: null })).err).toContain("needs one");
    expect((await rpe(["connection", "remove", "Floor"])).code).toBe(0);
    expect((await rpe(["connection", "list"])).out).toContain("No connections yet");
    // The command line's own token is let go once its call is done.
    expect(app.db.query("SELECT count(*) AS n FROM page_token WHERE kind = 'page' AND made_by = 'command line'").get()).toEqual({ n: 0 });
  });

  test("a word or flag it does not take is refused with its usage", async () => {
    expect((await rpe(["launch"])).code).toBe(2);
    const flag = await rpe(["status", "--port", "1"]);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain("does not take --port");
    expect((await rpe(["deny"])).code).toBe(2);
  });

  test("version prints the build's id alone, reading no data folder and asking nothing over the network", async () => {
    const nowhere = join(bed.root, "no-data-here");
    for (const argv of [["version"], ["--version"]]) {
      const io = { ...cliIo(), env: { RPE_DATA: nowhere }, fetch: (): Promise<Response> => Promise.reject(new Error("version asked over the network")) };
      expect(await runCli(argv, io, { version: "a1b2c3d4" })).toBe(0);
      expect(io.outs).toEqual(["rpe a1b2c3d4"]);
      expect(io.errs).toEqual([]);
    }
    expect(existsSync(nowhere)).toBe(false);
    expect((await rpe(["version"])).code).toBe(2);
  });

  test("every command the usage names is answered from its own file, and no command's file imports another's", () => {
    const names = [...new Set([...USAGE.matchAll(/^ {2}rpe ([a-z]+)\b/gm)].map((m) => m[1] ?? ""))];
    expect(names).toEqual(["up", "down", "serve", "status", "version", "lumiverse", "key", "connection", "allow", "deny", "backup", "migrate", "check"]);
    // `allow` and `deny` are the two directions of one switch.
    const stem = (name: string): string => (name === "allow" || name === "deny" ? "switch" : name);
    const folder = join(import.meta.dir, "../../src/app/commands");
    const dispatcher = readFileSync(join(import.meta.dir, "../../src/app/cli.ts"), "utf8");
    const stems = new Set(names.map(stem));
    for (const name of stems) {
      expect(existsSync(join(folder, `${name}.ts`))).toBe(true);
      expect(dispatcher).toContain(`from "./commands/${name}"`);
      const text = readFileSync(join(folder, `${name}.ts`), "utf8");
      for (const imported of [...text.matchAll(/from "\.\/([\w-]+)"/g)].map((m) => m[1] ?? "")) {
        // `up` runs the swap from its own part, `swap-up`, which is not a command of its own.
        expect(stems.has(imported) ? `${name} imports ${imported}` : "").toBe("");
      }
    }
  });

  test("every line the command line prints for the owner to run is a whole line it takes, beginning with the Bun and the app file that started it and naming a data folder that is not the default", async () => {
    const io = { ...cliIo(), invoked: invokedAs("/opt/bun dir/bun", "/srv/rpe/dist/rpe.js") };
    expect(runLine(io, bed.paths, "key", "web")).toBe(`'/opt/bun dir/bun' /srv/rpe/dist/rpe.js key web --data ${bed.paths.root}`);
    expect(runLine(cliIo(), dataPaths(defaultDataFolder({}, tmpdir())), "status")).toBe("rpe status");
  });
});
