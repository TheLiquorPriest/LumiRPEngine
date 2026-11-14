// The command line `rpe`: `serve` runs the server until it is told to stop; `key` shows a new key once
// and keeps only its hash; `backup` makes one private archive of the database and the file tree;
// `status` says what this RPE is; and `connection` works through the running server's API. Each
// test that needs a server starts it in-process on a free loopback port.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { App, RunningServer } from "../../src/app";
import { connectionRoutes, rawRoute } from "../../src/app";
import { runCli } from "../../src/app/cli";
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
            a.routes.add("probe", [rawRoute({ method: "POST", path: "/v1/chat/completions", access: "provider", raw: () => Response.json({ object: "chat.completion" }) }), ...connectionRoutes(testModelLayer(a.models))]);
          },
        },
      ],
    });
    return { app, server: app.start() };
  }

  test("serve runs RPE in the foreground until it is told to stop", async () => {
    const io = cliIo();
    const served = runCli(["serve", "--data", bed.paths.root], io, { version: "1.0.0" });
    const status = async (): Promise<number> => (await fetch(`http://127.0.0.1:${port}/api/v1/status`)).status;
    let answered = 0;
    for (let tries = 0; tries < 200 && answered !== 200; tries++) answered = await status().catch(() => 0);
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
    expect((await rpe(["key", "extension"])).out).toMatch(/\brpx_[0-9a-f]{64}\b/);
    expect((await rpe(["key", "admin"])).code).toBe(2);
  });

  test("backup makes one private archive of the database and the file tree, and never writes over one", async () => {
    const { app } = await serving();
    await app.writes.run((db) => db.run("INSERT INTO page_token (hash, user, made_by, made, expires) VALUES ('h', 'u', 'extension', 1, 2)"));
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
    await app.switches.check("format", "hook", "fmt --write {file}");
    const shown = await rpe(["status"]);
    expect(shown.code).toBe(0);
    expect(shown.out).toContain(`Listens on: http://127.0.0.1:${port}, answering (RPE 1.0.0)`);
    expect(shown.out).toContain(`for user ${OWNER}`);
    expect(shown.out).toMatch(/provider ends [0-9a-f]{4}/);
    expect(shown.out).toContain("waiting: format (hook) runs fmt --write {file}. Switch it on with: rpe allow format");
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
    expect(listed.out).toContain(`key ending ${key.slice(-4)}`);
    expect(listed.out + added.out).not.toContain(key);
    expect(await readFile(app.paths.secrets, "utf8")).toContain(key);
    expect((await rpe(["connection", "add", "--name", "Keyless", "--provider", "deepseek"], { secret: null })).err).toContain("needs one");
    expect((await rpe(["connection", "remove", "Floor"])).code).toBe(0);
    expect((await rpe(["connection", "list"])).out).toContain("No connections yet");
    // The command line's own token is let go once its call is done.
    expect(app.db.query("SELECT count(*) AS n FROM page_token WHERE made_by = 'command line'").get()).toEqual({ n: 0 });
  });

  test("a word or flag it does not take is refused with its usage", async () => {
    expect((await rpe(["launch"])).code).toBe(2);
    const flag = await rpe(["status", "--port", "1"]);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain("does not take --port");
    expect((await rpe(["allow"])).code).toBe(2);
  });
});
