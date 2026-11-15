// The place each key was given for, through a real run and RPE's next start (plan §16). RPH's model
// layer keeps, beside each connection's key and headers' values in the secrets, the place they were
// given for, and sends them nowhere else, across a restart too. A real run is the second writer of
// those secrets: it keeps the place of what it leaves as RPE has it, and writes the place of what it
// takes from today's build. Each test plays it through RPE's own two files and a model layer made
// again over them, as RPE's next start makes it, its calls refused by a recording `fetch`. Every
// name, address and key is invented.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "rp-harness";
import type { ConnectionsDoc, ModelsApi } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { dataPaths } from "../../src/app/config";
import { MODELS_KEY, modelsPort } from "../../src/app/connections";
import { SecretsFile } from "../../src/app/secrets";
import { withTopLevelKey } from "../../src/app/yaml";
import { migrate } from "../../src/migrate/migrate";
import { buildFixture, RUNTIME, SECRETS, STRAY, USER, type Fixture } from "./fixture";
import { TREE as tree } from "./tree";

const FIRST = "https://first.example.invalid/v1";
const ELSEWHERE = "https://elsewhere.example.invalid/v1";
const MOVED = "https://moved.example.invalid/v1";
const MOVED_KEY = "sk-invented-moved-9876543210";
const OPENAI_KEY = "sk-invented-openai-5432109876";

const origin = (url: string): string => new URL(url).origin;

async function withFixture(run: (fixture: Fixture, data: string) => Promise<void>): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await run(fixture, join(fixture.root, "rpe-data"));
  } finally {
    await fixture.remove();
  }
}

async function migrated(fixture: Fixture, data: string, hour: number): Promise<void> {
  const run = await migrate(fixture.sources, { data, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
  expect(run.ran).toBe(true);
}

/** One of today's runtime's two book files, as `change` leaves it. */
async function changeToday(fixture: Fixture, file: "connections.json" | "secrets.json", change: (doc: { connections: Record<string, unknown>[]; keys: Record<string, string> }) => void): Promise<void> {
  const path = join(fixture.sources.runtime?.dataDir ?? "", "runtimes", RUNTIME, file);
  const doc = JSON.parse(await readFile(path, "utf8")) as { connections: Record<string, unknown>[]; keys: Record<string, string> };
  change(doc);
  await writeFile(path, JSON.stringify(doc));
}

/** Today's first connection, `conn-1`, going to a server of the user's own at `address`. */
const atAddress =
  (address: string) =>
  (doc: { connections: Record<string, unknown>[] }): void => {
    Object.assign(doc.connections[0] ?? {}, { provider: "openai-compatible", baseUrl: address });
  };

/** `conn-1` moved to `address` in RPE's own file, as a page's save of `RPE-global.yml` moves it: nothing tells the model layer. */
async function movedInRpe(data: string, address: string): Promise<void> {
  const paths = dataPaths(data);
  const text = await readFile(paths.globalConfig, "utf8");
  // The file the runs wrote: its `models` holds the user's connections document under his name.
  const global = Bun.YAML.parse(text) as Record<typeof MODELS_KEY, Record<string, ConnectionsDoc>>;
  const doc = global[MODELS_KEY][USER] as ConnectionsDoc;
  const models = { ...doc, connections: doc.connections.map((c) => (c.id === "conn-1" ? { ...c, baseUrl: address } : c)) };
  await writeFile(paths.globalConfig, withTopLevelKey(text, MODELS_KEY, { ...global[MODELS_KEY], [USER]: models }, paths.globalConfig));
}

/** A call the model layer sent: where to, and every header it carried. */
interface Sent {
  url: string;
  headers: Record<string, string>;
}

/** RPH's model layer as RPE's next start makes it, over RPE's own two files; every call it sends is recorded and refused. */
async function started(data: string): Promise<{ models: ModelsApi; sent: Sent[]; close(): Promise<void> }> {
  const sent: Sent[] = [];
  const dir = await mkdtemp(join(tmpdir(), "rpe-key-places-"));
  const host = await createFolderHost({ dir, user: "u1" });
  const paths = dataPaths(data);
  const refusing = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    sent.push({ url: request.url, headers: Object.fromEntries(request.headers) });
    return Response.json({ error: { message: "Refused by the stand-in.", type: "invalid_request_error" } }, { status: 401 });
  };
  const harness = createHarness({ ...host, models: modelsPort(paths, new SecretsFile(paths.secrets), () => USER) }, { fetch: refusing as typeof fetch });
  return {
    models: harness.models,
    sent,
    close: async () => {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** What a test of `conn-1`, the Connections page's "Test it", sends. */
async function testCalls(data: string): Promise<{ sent: Sent[]; key: unknown }> {
  const layer = await started(data);
  try {
    await layer.models.test(USER, "conn-1");
    const shown = (await layer.models.list(USER)).connections.find((c) => c.id === "conn-1");
    return { sent: [...layer.sent], key: shown?.key };
  } finally {
    await layer.close();
  }
}

describe("the place each key was given for, through a real run and RPE's next start", () => {
  test("a run over a connection whose address was changed in RPE's file while RPE stood idle keeps the place its key was given for: RPE's next start sends its key and its header's value to no other address", async () => {
    await withFixture(async (fixture, data) => {
      await changeToday(fixture, "connections.json", atAddress(FIRST));
      await migrated(fixture, data, 9);
      // RPE starts on what the run carried: the key and the header's value go to the address they were given for.
      const first = await testCalls(data);
      expect(first.sent.map((s) => [origin(s.url), s.headers.authorization, s.headers["x-team"]])).toEqual([[origin(FIRST), `Bearer ${SECRETS.key}`, SECRETS.header]]);

      // A page moves the connection to another address in RPE's file, and RPE, idle, is stopped before it reads the file again. A later real run is made.
      await movedInRpe(data, ELSEWHERE);
      await migrated(fixture, data, 10);
      const next = await testCalls(data);
      expect(JSON.stringify(next.sent)).not.toContain(SECRETS.key);
      expect(JSON.stringify(next.sent)).not.toContain(SECRETS.header);
      expect(next.key).toEqual({ set: false, last4: null });

      // That start took the key away. A run after it fills today's key back in for the connection RPE keeps, with the place today's build gives it for, so the start after that sends it nowhere either.
      await migrated(fixture, data, 11);
      const after = await testCalls(data);
      expect(JSON.stringify(after.sent)).not.toContain(SECRETS.key);
      expect(JSON.stringify(after.sent)).not.toContain(SECRETS.header);
      expect(after.key).toEqual({ set: false, last4: null });
    });
  });

  test("a later run that takes today's new address for a connection whose key RPE holds as its own sends that key to no other address: the new address gets the key today's build gives it", async () => {
    await withFixture(async (fixture, data) => {
      await changeToday(fixture, "connections.json", atAddress(FIRST));
      await migrated(fixture, data, 9);
      // On today's side since: the connection moved to another server, with that server's key. RPE's copy of the connection is still the one the run put there, and RPE's key is the one given for the first server.
      await changeToday(fixture, "connections.json", atAddress(MOVED));
      await changeToday(fixture, "secrets.json", (doc) => (doc.keys["conn-1"] = MOVED_KEY));
      await migrated(fixture, data, 10);
      const next = await testCalls(data);
      expect(JSON.stringify(next.sent)).not.toContain(SECRETS.key);
      expect(next.sent.map((s) => [origin(s.url), s.headers.authorization, s.headers["x-team"]])).toEqual([[origin(MOVED), `Bearer ${MOVED_KEY}`, SECRETS.header]]);
    });
  });

  test("a later run over a connection moved on today's side to another provider, with a key of its own, after RPE had started: RPE's next start sends the old key to no one, and today's key is the one in force", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      // RPE starts on what the run carried: the DeepSeek key goes to DeepSeek.
      const first = await testCalls(data);
      expect(first.sent.map((s) => s.headers.authorization)).toEqual([`Bearer ${SECRETS.key}`]);
      // On today's side since: the connection moved to OpenAI, with an OpenAI key. RPE's copy of the connection is still the one the run put there.
      await changeToday(fixture, "connections.json", (doc) => Object.assign(doc.connections[0] ?? {}, { provider: "openai", model: "gpt-4o" }));
      await changeToday(fixture, "secrets.json", (doc) => (doc.keys["conn-1"] = OPENAI_KEY));
      await migrated(fixture, data, 10);
      const next = await testCalls(data);
      expect(JSON.stringify(next.sent)).not.toContain(SECRETS.key);
      expect(next.sent.map((s) => s.headers.authorization)).toEqual([`Bearer ${OPENAI_KEY}`]);
      expect(next.key).toEqual({ set: true, last4: OPENAI_KEY.slice(-4) });
    });
  });
});
