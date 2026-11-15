// Connections: the model layer's two documents kept exactly as it gives them, each user's under his
// own name, where the plan puts them (the connections, with their headers' names, in the global config;
// every key, sign-in and header value in the secrets file and nowhere else); documents written before,
// which name no user, moved under the install's user at the first start; a file written the earlier
// way, with the headers' values kept apart, read in the form the layer moves at its next save; the
// user's own lines in the global config kept as they wrote them; and routes that add, change, list
// and remove a connection for the owner without ever giving a key back. The route tests start the
// server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YAML } from "bun";
import { createHarness } from "rp-harness";
import type { ConnectionsDoc, SecretsDoc } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import type { App, RunningServer } from "../../src/app";
import { connectionRoutes, prepareDataFolder } from "../../src/app";
import { walk } from "../../src/app/archive";
import { bearer, type Bed, makeBed, makeKey, OWNER, storedKey, testModelLayer } from "./helpers";

const KEY = "sk-invented-key-0123456789abcdef";
const HEADER_VALUE = "proxy-secret-value-fedcba9876543210";
/** The owner's scope, as the model layer gives it; and a user this RPE does not belong to. */
const MINE = { user: OWNER };
const OTHER = "user-tamsin";

const FLOOR = { id: "floor", name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", limits: { "deepseek-v4-flash": { contextWindow: 128_000 } } };
const LOCAL = { id: "local", name: "Local server", provider: "openai-compatible", auth: "none", baseUrl: "http://127.0.0.1:1234/v1", reported: { "local-model": { maxTokens: 4096 } } };
const SIGNINS = { anthropic: { type: "oauth", access: "invented-access", refresh: "invented-refresh", expires: 1 } };
// As the layer gives them (RPH `src/model/book.ts`): a connection's headers by name alone, their values with the secrets by the connection's id. The contract's document types do not say so yet.
const DOC = { v: 1, default: "floor", connections: [{ ...FLOOR, headers: ["X-Proxy-Token", "X-Dropped"] }, LOCAL] } as unknown as ConnectionsDoc;
const SECRETS = { v: 1, keys: { floor: KEY }, headers: { floor: { "X-Proxy-Token": HEADER_VALUE } }, signins: SIGNINS } as unknown as SecretsDoc;

/** Every file of the tree agents see, as text. */
async function treeText(app: App): Promise<string> {
  const files = await walk(app.paths.files);
  return (await Promise.all(files.map((f) => readFile(join(app.paths.files, f.path), "utf8")))).join("\n");
}

/** The connection routes as the composition mounts them: over a layer, for the user the app's config names. */
function routesOf(app: App) {
  return connectionRoutes(testModelLayer(app.models), () => app.config.lumiverse.user ?? "", app.log);
}

describe("connections", () => {
  let bed: Bed;
  let app: App;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open({ areas: [{ name: "connections", mount: (a) => a.routes.add("connections", routesOf(a)) }] });
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("each document is given back exactly as the layer gave it: the connections, with their headers' names, in the global config; keys, sign-ins and header values in the secrets file alone", async () => {
    await app.models.saveSecrets(MINE, SECRETS);
    await app.models.saveConnections(MINE, DOC);
    expect(await app.models.loadConnections(MINE)).toEqual(DOC);
    expect(await app.models.loadSecrets(MINE)).toEqual(SECRETS);
    const global = await readFile(app.paths.globalConfig, "utf8");
    for (const kept of ["Floor model", "deepseek-v4-flash", "X-Proxy-Token"]) expect(global).toContain(kept);
    const tree = await treeText(app);
    for (const secret of [KEY, HEADER_VALUE, "invented-refresh"]) expect(tree).not.toContain(secret);
    const secrets = await readFile(app.paths.secrets, "utf8");
    for (const secret of [KEY, HEADER_VALUE, "invented-refresh"]) expect(secrets).toContain(secret);
    expect(statSync(app.paths.secrets).mode & 0o777).toBe(0o600);
    expect(statSync(app.paths.root).mode & 0o777).toBe(0o700);
  });

  test("a file written the earlier way gives the headers' values back in the connections, and once the layer has saved, none are left in the old place", async () => {
    // The earlier way: the connections without their headers, and the values apart, by connection id.
    await writeFile(app.paths.globalConfig, YAML.stringify({ models: { v: 1, default: "floor", connections: [FLOOR, LOCAL] } }, null, 2));
    await writeFile(app.paths.secrets, JSON.stringify({ v: 1, parts: { models: { v: 1, keys: { floor: KEY }, signins: SIGNINS }, headers: { floor: { "X-Proxy-Token": HEADER_VALUE, "X-Dropped": null } } } }));
    expect(await app.models.loadConnections(MINE)).toEqual({ v: 1, default: "floor", connections: [{ ...FLOOR, headers: { "X-Proxy-Token": HEADER_VALUE, "X-Dropped": null } }, LOCAL] });
    // The layer's next save moves them: its secrets first, the values with them, then the connections with the names alone.
    await app.models.saveSecrets(MINE, SECRETS);
    await app.models.saveConnections(MINE, DOC);
    expect(await app.models.loadConnections(MINE)).toEqual(DOC);
    expect(await app.models.loadSecrets(MINE)).toEqual(SECRETS);
    expect(Object.keys(JSON.parse(await readFile(app.paths.secrets, "utf8")).parts)).toEqual(["models"]);
    expect(await treeText(app)).not.toContain(HEADER_VALUE);
  });

  test("the user's own lines in the global config are kept as they wrote them", async () => {
    const mine = ["# My global settings.", "off:", "  - WORLD.md", "", "# The connections, kept by RPE:", "models:", "  # an old note under the block", "  v: 1", "  connections: []", "", "# How much history the prompt keeps.", "history:", "  keep: 40", ""].join("\n");
    await Bun.write(app.paths.globalConfig, mine);
    await app.models.saveConnections(MINE, DOC);
    await app.models.saveConnections(MINE, { ...DOC, default: "local" });
    const lines = (await readFile(app.paths.globalConfig, "utf8")).split("\n");
    expect(lines.slice(0, 5)).toEqual(["# My global settings.", "off:", "  - WORLD.md", "", "# The connections, kept by RPE:"]);
    expect(lines.slice(-5)).toEqual(["", "# How much history the prompt keeps.", "history:", "  keep: 40", ""]);
    const read = YAML.parse(lines.join("\n")) as Record<string, unknown>;
    expect(read.off).toEqual(["WORLD.md"]);
    expect(read.history).toEqual({ keep: 40 });
    expect(await app.models.loadConnections(MINE)).toEqual({ ...DOC, default: "local" });
  });

  test("a connection saved for one user is not listed for another, and its key is not given for another", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rpe-connections-"));
    // A host serves one user, so each user's layer stands on its own host; both are over RPE's one port.
    const host = await createFolderHost({ dir: join(dir, "owner"), user: OWNER });
    const otherHost = await createFolderHost({ dir: join(dir, "other"), user: OTHER });
    try {
      // RPH's own model layer over RPE's port; nothing here calls a provider.
      const fetch = (async () => Response.json({}, { status: 401 })) as unknown as typeof globalThis.fetch;
      const layer = createHarness({ ...host, models: app.models }, { fetch }).models;
      const otherLayer = createHarness({ ...otherHost, models: app.models }, { fetch }).models;
      const mine = await layer.save(OWNER, { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash" }, KEY);
      expect((await otherLayer.list(OTHER)).connections).toEqual([]);
      expect(await storedKey(app.models)(OTHER, mine.id)).toBeNull();
      const theirs = await otherLayer.save(OTHER, { name: "Local server", provider: "openai-compatible", auth: "none", baseUrl: "http://127.0.0.1:1234/v1" });
      expect([(await layer.list(OWNER)).connections.map((c) => c.id), (await otherLayer.list(OTHER)).connections.map((c) => c.id)]).toEqual([[mine.id], [theirs.id]]);
      expect([await storedKey(app.models)(OWNER, mine.id), await storedKey(app.models)(OTHER, mine.id)]).toEqual([KEY, null]);
      // Each one's document stands under his own name in the global config.
      const global = YAML.parse(await readFile(app.paths.globalConfig, "utf8")) as { models: Record<string, ConnectionsDoc> };
      expect(Object.fromEntries(Object.entries(global.models).map(([user, doc]) => [user, doc.connections.map((c) => c.id)]))).toEqual({ [OWNER]: [mine.id], [OTHER]: [theirs.id] });
    } finally {
      await host.close();
      await otherHost.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("today's documents, which name no user, stand under the install's user after the first start, and nothing is left outside him", async () => {
    const fresh = await makeBed();
    try {
      await prepareDataFolder(fresh.paths);
      // As a build before this one left them: the connections document itself under `models`, the secrets document itself in its part, and the headers' values the earlier way.
      const earlier = { floor: { "X-Proxy-Token": HEADER_VALUE, "X-Dropped": null } };
      const older = { v: 1, default: "floor", connections: [FLOOR, LOCAL] };
      await writeFile(fresh.paths.globalConfig, YAML.stringify({ history: { keep: 40 }, models: older }, null, 2));
      await writeFile(fresh.paths.secrets, JSON.stringify({ v: 1, parts: { models: { v: 1, keys: { floor: KEY }, signins: SIGNINS }, headers: earlier, lumiverse: { token: "invented-session" } } }));
      const opened = await fresh.open();
      expect(YAML.parse(await readFile(fresh.paths.globalConfig, "utf8"))).toEqual({ history: { keep: 40 }, models: { [OWNER]: older } });
      expect(JSON.parse(await readFile(fresh.paths.secrets, "utf8")).parts).toEqual({ models: { [OWNER]: { v: 1, keys: { floor: KEY }, signins: SIGNINS } }, headers: { [OWNER]: earlier }, lumiverse: { token: "invented-session" } });
      // His, as the layer reads them; nobody else's.
      expect(await opened.models.loadConnections(MINE)).toEqual({ ...older, connections: [{ ...FLOOR, headers: earlier.floor }, LOCAL] });
      expect(await opened.models.loadSecrets(MINE)).toEqual({ v: 1, keys: { floor: KEY }, signins: SIGNINS });
      expect([await opened.models.loadConnections({ user: OTHER }), await opened.models.loadSecrets({ user: OTHER })]).toEqual([null, null]);
    } finally {
      await fresh.remove();
    }
  });

  describe("the routes", () => {
    let server: RunningServer;
    let page: Record<string, string>;

    beforeEach(async () => {
      server = await app.start();
      page = { ...bearer(await makeKey(app, "web")), "content-type": "application/json" };
    });

    test("add, change, list and remove a connection, and never give a key back, nor any of it", async () => {
      const added = await fetch(`${server.url}/api/v1/connections`, { method: "POST", headers: page, body: JSON.stringify({ connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash" }, key: KEY }) });
      expect(added.status).toBe(200);
      const addedText = await added.text();
      expect(addedText).not.toContain(KEY.slice(-4));
      const view = JSON.parse(addedText) as { id: string; key: { set: boolean; waiting: boolean } };
      expect(view.key).toEqual({ set: true, waiting: false });
      const changed = await fetch(`${server.url}/api/v1/connections/${view.id}`, { method: "PUT", headers: page, body: JSON.stringify({ connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-pro" } }) });
      expect(await changed.json()).toMatchObject({ model: "deepseek-v4-pro", key: { set: true } });
      expect((await fetch(`${server.url}/api/v1/connections/${view.id}/default`, { method: "PUT", headers: page })).status).toBe(204);
      const listed = await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).text();
      expect(listed).not.toContain(KEY.slice(-4));
      expect(JSON.parse(listed)).toMatchObject({ default: view.id, connections: [{ id: view.id, model: "deepseek-v4-pro", default: true }] });
      expect(await treeText(app)).not.toContain(KEY);
      expect(await readFile(app.paths.secrets, "utf8")).toContain(KEY);
      expect((await fetch(`${server.url}/api/v1/connections/${view.id}`, { method: "DELETE", headers: page })).status).toBe(204);
      expect(await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).json()).toMatchObject({ connections: [] });
      expect(await readFile(app.paths.secrets, "utf8")).not.toContain(KEY);
    });

    test("every connection route acts for the owner, and a call made in another user's scope finds none of his connections", async () => {
      // Another user's connection and key, kept under his own name.
      await app.models.saveConnections({ user: OTHER }, { v: 1, default: "theirs", connections: [{ id: "theirs", name: "Their server", provider: "openai-compatible", auth: "key", baseUrl: "http://127.0.0.1:1234/v1" }] } as unknown as ConnectionsDoc);
      await app.models.saveSecrets({ user: OTHER }, { v: 1, keys: { theirs: "sk-theirs-invented-0000" } } as unknown as SecretsDoc);
      const theirs = async () => [await app.models.loadConnections({ user: OTHER }), await app.models.loadSecrets({ user: OTHER })];
      const before = await theirs();
      const body = (connection: unknown) => JSON.stringify({ connection });
      const answers = [
        // A user named in the query or the body is no part of what a route takes.
        await fetch(`${server.url}/api/v1/connections?user=${OTHER}`, { headers: page }),
        await fetch(`${server.url}/api/v1/connections`, { method: "POST", headers: page, body: JSON.stringify({ user: OTHER, connection: { name: "Mine", provider: "deepseek", auth: "none" } }) }),
        // His connection's id, asked for by the owner's credential: each route acts on the owner's connections alone.
        await fetch(`${server.url}/api/v1/connections/theirs/default`, { method: "PUT", headers: page }),
        await fetch(`${server.url}/api/v1/connections/theirs/test`, { method: "POST", headers: page }),
        await fetch(`${server.url}/api/v1/connections/theirs`, { method: "PUT", headers: page, body: body({ name: "Mine", provider: "deepseek", auth: "none" }) }),
        await fetch(`${server.url}/api/v1/connections/theirs`, { method: "DELETE", headers: page }),
      ];
      expect(answers[1]?.status).toBe(400);
      for (const answer of answers) {
        const text = await answer.text();
        expect({ url: answer.url, his: text.includes("Their server") || text.includes("sk-theirs") }).toEqual({ url: answer.url, his: false });
      }
      expect(await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).text()).not.toContain("Their server");
      expect(await theirs()).toEqual(before);
    });

    test("refuse what is not a connection, a new one with an id, and a caller without a page's token", async () => {
      const post = (body: unknown, headers = page) => fetch(`${server.url}/api/v1/connections`, { method: "POST", headers, body: JSON.stringify(body) });
      expect((await post({ connection: { provider: "deepseek", auth: "key" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "password" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "key" }, key: "" })).status).toBe(400);
      expect((await post({ connection: { id: "chosen", name: "x", provider: "deepseek", auth: "none" } })).status).toBe(400);
      expect((await post({ connection: { name: "x", provider: "deepseek", auth: "none" } }, { "content-type": "application/json" })).status).toBe(401);
      expect((await fetch(`${server.url}/api/v1/connections/nowhere`, { method: "PUT", headers: page, body: JSON.stringify({ connection: { name: "x", provider: "deepseek", auth: "none" } }) })).status).toBe(400);
    });
  });
});
