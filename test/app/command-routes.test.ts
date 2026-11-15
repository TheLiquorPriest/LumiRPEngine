// The command line's routes (plan §4.4, §16): they answer on the server's own socket, which only its
// owner can open, and on nothing else, and what they write goes through the server's own queue and
// secrets file.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import type { App, RunningServer } from "../../src/app";
import { COMMAND_PATHS } from "../../src/app/command-routes";
import { commandSocketPath } from "../../src/app/data-folder";
import { bearer, type Bed, makeBed, makeKey, OWNER } from "./helpers";

describe("the command line's routes", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open();
    server = await app.start();
  });

  afterEach(async () => {
    await bed.remove();
  });

  const onSocket = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`http://rpe.local${path}`, { method, unix: commandSocketPath(bed.paths.root), headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const switchPath = (name: string): string => COMMAND_PATHS.switches.replace(":name", encodeURIComponent(name));

  /** Every route of the command line, each with a body it takes. */
  const asks: { method: string; path: string; body?: unknown }[] = [
    { method: "POST", path: COMMAND_PATHS.keys, body: { kind: "provider" } },
    { method: "POST", path: COMMAND_PATHS.takenKeys, body: { hash: "a".repeat(64) } },
    { method: "PUT", path: switchPath("format"), body: { state: "on" } },
    { method: "PUT", path: COMMAND_PATHS.lumiverse, body: { set: { connection: "conn-1" } } },
    { method: "GET", path: COMMAND_PATHS.status },
  ];

  test("each command route answers on the server's own socket and on nothing else: not on its TCP address, not through the relay, not to a page token or a web session", async () => {
    expect(server.commandSocket).toBe(commandSocketPath(bed.paths.root));
    // The socket is the owner's alone.
    expect((await stat(commandSocketPath(bed.paths.root))).mode & 0o077).toBe(0);
    await app.switches.check("format", "hook", "fmt --write {file}");

    for (const ask of asks) {
      const answered = await onSocket(ask.method, ask.path, ask.body);
      expect([ask.path, answered.status < 300]).toEqual([ask.path, true]);
    }

    // On the TCP listener, to whoever asks and with whatever credential the server gives out: the relay's own is the extension's key.
    const { token } = await app.auth.mintPageToken(OWNER, "extension");
    const credentials = [{}, bearer(token), bearer(await makeKey(app, "web")), bearer(await makeKey(app, "extension")), bearer(await makeKey(app, "provider"))];
    for (const ask of asks) {
      for (const headers of credentials) {
        const res = await fetch(`${server.url}${ask.path}`, { method: ask.method, headers: { ...headers, ...(ask.body === undefined ? {} : { "content-type": "application/json" }) }, ...(ask.body === undefined ? {} : { body: JSON.stringify(ask.body) }) });
        expect([ask.method, ask.path, res.status]).toEqual([ask.method, ask.path, 404]);
      }
    }
  });

  test("a key is made through the server's queue, the one before it stops working, and a kind RPE makes itself is refused", async () => {
    const first = await (await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider" })).json();
    expect(first).toMatchObject({ kind: "provider", ends: null });
    const key: string = first.key;
    expect(key).toMatch(/^rpe_[0-9a-f]{64}$/);
    const second = await (await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider" })).json();
    expect(await app.auth.holds("provider", key)).toBe(false);
    expect(await app.auth.holds("provider", second.key)).toBe(true);
    // RPE makes its extension's key at every start itself; one made by hand would cut the extension off.
    expect((await onSocket("POST", COMMAND_PATHS.keys, { kind: "extension" })).status).toBe(400);
    // A key the caller made is taken in its own form only.
    expect((await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider", key: "rpe_short" })).status).toBe(400);
    const own = `rpe_${"b".repeat(64)}`;
    expect(await (await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider", key: own })).json()).toMatchObject({ key: own });
    // The provider key of today's connection, taken by its hash, is the one key: no new one is asked for, though the install may hand over a key of its own for a connection of its own.
    expect((await onSocket("POST", COMMAND_PATHS.takenKeys, { hash: "c".repeat(64) })).status).toBe(204);
    expect(await app.auth.holds("provider", own)).toBe(false);
    const refused = await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("would make going back harder");
    expect((await onSocket("POST", COMMAND_PATHS.keys, { kind: "provider", key: `rpe_${"d".repeat(64)}` })).status).toBe(200);
  });

  test("a switch is switched on or off by the command line alone, and an unknown name says what is listed", async () => {
    expect(await app.switches.check("format", "hook", "fmt --write {file}")).toBe("waiting");
    const on = await (await onSocket("PUT", switchPath("format"), { state: "on" })).json();
    expect(on).toMatchObject({ entry: { name: "format", kind: "hook", state: "on" }, listed: [{ name: "format", state: "on" }] });
    expect(await app.switches.check("format", "hook", "fmt --write {file}")).toBe("on");
    expect(await (await onSocket("PUT", switchPath("format"), { state: "off" })).json()).toMatchObject({ entry: { state: "off" } });
    expect(await (await onSocket("PUT", switchPath("nothing-of-the-kind"), { state: "on" })).json()).toEqual({ entry: null, listed: [{ name: "format", state: "off" }] });
    expect((await onSocket("PUT", switchPath("format"), { state: "maybe" })).status).toBe(400);
    // The server's own connection stays guarded: only the command's switching gives way, and not for what runs after it.
    await expect(app.writes.run((db) => db.run("UPDATE switch SET state = 'on'"))).rejects.toThrow("Only the command line on the server");
  });

  test("the Lumiverse sign-in and the config's Lumiverse block are kept by the server, and the status says keys, switches and builds", async () => {
    const signIn = { username: "player", user: OWNER, token: "invented-session-token", savedAt: 1 };
    expect((await onSocket("PUT", COMMAND_PATHS.lumiverse, { signIn, set: { url: "http://127.0.0.1:7860", connection: "conn-1", models: ["rpe", "rpe-two"] }, listens: { address: "127.0.0.1", port: 7900 } })).status).toBe(204);
    expect(JSON.parse(await readFile(bed.paths.secrets, "utf8"))).toMatchObject({ parts: { lumiverse: signIn } });
    expect(JSON.parse(await readFile(bed.paths.config, "utf8"))).toMatchObject({ address: "127.0.0.1", port: 7900, lumiverse: { url: "http://127.0.0.1:7860", connection: "conn-1", models: ["rpe", "rpe-two"] } });
    // Null takes a value out, and a sign-in of null forgets the kept one.
    expect((await onSocket("PUT", COMMAND_PATHS.lumiverse, { signIn: null, set: { connection: null } })).status).toBe(204);
    expect(JSON.parse(await readFile(bed.paths.secrets, "utf8")).parts.lumiverse).toBeUndefined();
    expect(JSON.parse(await readFile(bed.paths.config, "utf8")).lumiverse.connection).toBeUndefined();
    // A config this build refuses is not written.
    expect((await onSocket("PUT", COMMAND_PATHS.lumiverse, { listens: { address: "127.0.0.1", port: 70000 } })).status).toBe(400);

    await makeKey(app, "extension");
    await onSocket("POST", COMMAND_PATHS.keys, { kind: "web" });
    await app.switches.check("format", "hook", "fmt --write {file}");
    const status = await (await onSocket("GET", COMMAND_PATHS.status)).json();
    expect(status.keys.map((k: { kind: string }) => k.kind).sort()).toEqual(["extension", "web"]);
    expect(status.switches).toMatchObject([{ name: "format", state: "waiting" }]);
    expect(status.builds).toContain("RPE runs build 1.0.0");
    expect(JSON.stringify(status)).not.toMatch(/rpw_[0-9a-f]{64}|rpx_[0-9a-f]{64}/);
  });
});
