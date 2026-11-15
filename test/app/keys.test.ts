// Keys as Appendix B keeps them: the provider key in `provider_key`, the web token and the extension's
// registration in `page_token` with their maker and their end, and no key's text anywhere, in the
// database or in what `rpe status` says.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { newKeyText, secretHash, takeKeyHash } from "../../src/app/auth";
import { runCli } from "../../src/app/cli";
import { rawRoute } from "../../src/app";
import { openDatabase } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { APP_MIGRATIONS } from "../../src/app/schema";
import { type Bed, cliIo, LUMIVERSE, makeBed, OWNER, writeConfig } from "./helpers";

describe("keys", () => {
  let bed: Bed;

  beforeEach(async () => {
    bed = await makeBed();
    await mkdir(bed.paths.root, { recursive: true });
    await writeConfig(bed.paths, { lumiverse: { url: LUMIVERSE, user: OWNER } });
  });

  afterEach(async () => {
    await bed.remove();
  });

  async function rpe(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const io = cliIo();
    const code = await runCli([...argv, "--data", bed.paths.root], io, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
  }

  test("after the migration every key in force still opens what it opened; the provider key is in provider_key, the web token and the extension's key in page_token with their maker and end, and app_key is gone", async () => {
    const keys = { provider: newKeyText("provider"), retiredProvider: newKeyText("provider"), extension: newKeyText("extension"), web: newKeyText("web"), retiredWeb: newKeyText("web"), today: "lumiah-key-of-todays-connection" };
    // The database as the build before left it: the app's first two steps, keys of three kinds in one table, a key of each kind retired.
    const older = openDatabase(bed.paths.database, 1000);
    try {
      const before = new Migrations();
      before.add("app", APP_MIGRATIONS.slice(0, 2));
      migrate(older, before, { user: OWNER, version: "0.9.0", backups: bed.paths.backups, now: () => 1 });
      const insert = (hash: string, kind: string, last4: string, made: number, retired: number | null): void => {
        older.run("INSERT INTO app_key (user, hash, kind, last4, made, retired) VALUES (?, ?, ?, ?, ?, ?)", [OWNER, hash, kind, last4, made, retired]);
      };
      insert(secretHash(keys.provider), "provider", keys.provider.slice(-4), 10, null);
      insert(secretHash(keys.retiredProvider), "provider", keys.retiredProvider.slice(-4), 5, 9);
      insert(secretHash(keys.today), "provider", "", 8, null);
      insert(secretHash(keys.extension), "extension", keys.extension.slice(-4), 11, null);
      insert(secretHash(keys.web), "web", keys.web.slice(-4), 12, null);
      insert(secretHash(keys.retiredWeb), "web", keys.retiredWeb.slice(-4), 6, 11);
      older.run("INSERT INTO page_token (hash, user, made_by, made, expires) VALUES ('t1', ?, 'extension', 13, 99)", [OWNER]);
    } finally {
      older.close();
    }

    const app = await bed.open();
    expect(app.migrated.applied.map((m) => `${m.area} ${m.version}`)).toEqual(["app 3"]);
    for (const key of [keys.provider, keys.today]) expect(app.auth.holds("provider", key)).toBe(true);
    expect(app.auth.holds("provider", keys.retiredProvider)).toBe(false);
    expect(app.auth.holds("extension", keys.extension)).toBe(true);
    expect(app.auth.holds("web", keys.web)).toBe(true);
    expect(app.auth.holds("web", keys.retiredWeb)).toBe(false);
    expect(app.auth.pageUser(keys.web)).toBe(OWNER);
    // The extension's key is no page's credential, and a page token keeps working while it is in time.
    expect(app.auth.pageUser(keys.extension)).toBeNull();

    const tables = app.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
    expect(tables).toContain("provider_key");
    expect(tables).toContain("page_token");
    expect(tables).not.toContain("app_key");
    expect(app.db.query("SELECT hash, last4, made, taken FROM provider_key ORDER BY made").all()).toEqual([
      { hash: secretHash(keys.today), last4: "", made: 8, taken: 1 },
      { hash: secretHash(keys.provider), last4: keys.provider.slice(-4), made: 10, taken: 0 },
    ]);
    // The web token and the extension's key, each with its maker and no end; the page token as it was.
    expect(app.db.query("SELECT kind, made_by, made, expires FROM page_token ORDER BY made").all()).toEqual([
      { kind: "extension", made_by: "rpe start", made: 11, expires: null },
      { kind: "web", made_by: "command line", made: 12, expires: null },
      { kind: "page", made_by: "extension", made: 13, expires: 99 },
    ]);
    // Every row of both says whose it is.
    for (const table of ["provider_key", "page_token"]) expect(app.db.query(`SELECT DISTINCT user FROM ${table}`).all()).toEqual([{ user: OWNER }]);
  });

  test("a web token made with auth.webKeyDays set carries its end; a new key of a kind takes the one before it away, a key taken from today's connection staying until all", async () => {
    await writeConfig(bed.paths, { lumiverse: { url: LUMIVERSE, user: OWNER }, auth: { webKeyDays: 30 } });
    const web = await rpe(["key", "web"]);
    expect(web.out).toContain("It works until 2026-12-13 12:00 UTC.");
    const db = new Database(bed.paths.database, { readonly: true });
    try {
      expect(db.query("SELECT kind, made_by, made, expires FROM page_token").all()).toEqual([{ kind: "web", made_by: "command line", made: Date.UTC(2026, 10, 13, 12), expires: Date.UTC(2026, 11, 13, 12) }]);
    } finally {
      db.close();
    }
    const again = await rpe(["key", "web"]);
    expect(/\b(rpw_[0-9a-f]{64})\b/.exec(again.out)?.[1]).not.toBe(/\b(rpw_[0-9a-f]{64})\b/.exec(web.out)?.[1]);
    const after = new Database(bed.paths.database, { readonly: true });
    try {
      expect(after.query("SELECT count(*) AS n FROM page_token WHERE kind = 'web'").get()).toEqual({ n: 1 });
    } finally {
      after.close();
    }
  });

  test("status lists the provider key, the web token's end, and no key's text", async () => {
    const provider = /\b(rpe_[0-9a-f]{64})\b/.exec((await rpe(["key"])).out)?.[1] ?? "";
    const web = /\b(rpw_[0-9a-f]{64})\b/.exec((await rpe(["key", "web"])).out)?.[1] ?? "";
    expect(provider).not.toBe("");
    expect(web).not.toBe("");
    const shown = await rpe(["status"]);
    expect(shown.out).toContain(`provider ends ${provider.slice(-4)} (made 2026-11-13)`);
    expect(shown.out).toContain("web made 2026-11-13, no end");
    expect(shown.out).toContain("extension none");
    // Nothing of a key but the provider key's last four characters: not its text, not its hash, not the end of the web token.
    for (const secret of [provider, web]) {
      expect(shown.out).not.toContain(secret);
      expect(shown.out).not.toContain(secretHash(secret));
    }
    expect(shown.out).not.toContain(web.slice(-4));
    expect(shown.out + shown.err).not.toMatch(/rp[epwx]_[0-9a-f]{64}/);
  });

  test("after the swap one provider key opens the provider endpoint, the one today's connections hold", async () => {
    const provider = (): Promise<string> => rpe(["key"]).then((r) => /\b(rpe_[0-9a-f]{64})\b/.exec(r.out)?.[1] ?? "");
    const own = await provider();
    const todays = "lumiah-key-of-todays-connection";
    const app = await bed.open({ config: { port: 0 }, areas: [{ name: "probe", mount: (a) => a.routes.add("probe", [rawRoute({ method: "GET", path: "/v1/models", access: "provider", group: "provider", does: "A test's model list.", answers: "a model list", raw: () => Response.json({ object: "list", data: [] }) })]) }] });
    const server = await app.start();
    const models = (key: string): Promise<number> => fetch(`${server.url}/v1/models`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.status);
    expect(await models(own)).toBe(200);
    // The swap takes the key today's connections hold: RPE's own earlier key stops with it, and it is the one key.
    await app.writes.run((db) => takeKeyHash(db, OWNER, secretHash(todays), app.now()));
    expect(await models(todays)).toBe(200);
    expect(await models(own)).toBe(401);
    expect(app.db.query("SELECT taken FROM provider_key").all()).toEqual([{ taken: 1 }]);
    expect((await rpe(["status"])).out).toContain("provider taken from today's connection (taken 2026-11-13)");
  });

  test("after the swap rpe key provider makes no key and says why; before any swap it makes the one key and the one before stops", async () => {
    const first = await rpe(["key", "provider"]);
    const second = await rpe(["key", "provider"]);
    const [one, two] = [first, second].map((r) => /\b(rpe_[0-9a-f]{64})\b/.exec(r.out)?.[1] ?? "");
    expect(one).not.toBe(two);
    const db = new Database(bed.paths.database, { readonly: true });
    try {
      expect(db.query("SELECT hash, taken FROM provider_key").all()).toEqual([{ hash: secretHash(two ?? ""), taken: 0 }]);
    } finally {
      db.close();
    }
    const app = await bed.open();
    await app.writes.run((db2) => takeKeyHash(db2, OWNER, secretHash("lumiah-key-of-todays-connection"), app.now()));
    for (const argv of [["key", "provider"], ["key", "provider", "all"]]) {
      const refused = await rpe(argv);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("the one key that opens RPE's provider endpoint is the one your connection in Lumiverse already holds");
      expect(refused.err).toContain("would make going back harder");
      expect(refused.out).toBe("");
    }
    expect(app.db.query("SELECT count(*) AS n FROM provider_key").get()).toEqual({ n: 1 });
    // The web key is no part of that.
    expect((await rpe(["key", "web"])).code).toBe(0);
  });
});
