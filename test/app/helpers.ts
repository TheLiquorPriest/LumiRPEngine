// What the app's tests share: a data folder of its own for each test, the app opened on it and
// listening on a free loopback port, a clock the test moves by hand, the command line's input and
// output, a stand-in for RPH's model layer, and a WebSocket client made from a bare TCP socket, which
// can stop reading to play a slow page.

import type { Socket } from "bun";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionsDoc, ConnectionView, ModelsPort, SecretsDoc, StoredConnection } from "rp-harness/contract";
import type { App, AppConfig, Area, ConnectionsApi, DataPaths, RunningServer } from "../../src/app";
import { dataPaths, lineLog, openApp } from "../../src/app";
import type { KeyKind } from "../../src/app/auth";
import type { CliIO } from "../../src/app/cli";
import { configOf } from "../../src/app/config";
import { isRecord } from "../../src/shared/json";

export const OWNER = "user-owner";
export const LUMIVERSE = "http://127.0.0.1:7860";

export interface Bed {
  root: string;
  paths: DataPaths;
  clock: { now: number };
  logs: string[];
  config(extra?: Record<string, unknown>): AppConfig;
  open(options?: { version?: string; areas?: readonly Area[]; config?: Record<string, unknown>; ui?: string | null }): Promise<App>;
  remove(): Promise<void>;
}

export async function makeBed(): Promise<Bed> {
  const root = await mkdtemp(join(tmpdir(), "rpe-app-"));
  const paths = dataPaths(join(root, "data"));
  const clock = { now: Date.UTC(2026, 10, 13, 12, 0, 0) };
  const logs: string[] = [];
  const opened: App[] = [];
  const config = (extra: Record<string, unknown> = {}): AppConfig => configOf({ port: 0, lumiverse: { url: LUMIVERSE, user: OWNER }, ...extra }, {}, "the test's config");
  return {
    root,
    paths,
    clock,
    logs,
    config,
    async open(options = {}) {
      const app = await openApp({ paths, config: config(options.config), version: options.version ?? "1.0.0", areas: options.areas ?? [], ui: options.ui ?? null, now: () => clock.now, log: lineLog((line) => logs.push(line), () => clock.now) });
      opened.push(app);
      return app;
    },
    async remove() {
      for (const app of opened) await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Makes a key of `kind` through the app's own write queue, as the command line would on its connection. */
export async function makeKey(app: App, kind: KeyKind): Promise<string> {
  return (await app.auth.makeKey(kind)).key;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** A port free on loopback now, for a config that must name one. */
export function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

export async function writeConfig(paths: DataPaths, config: Record<string, unknown>): Promise<void> {
  await writeFile(paths.config, JSON.stringify(config));
}

/** The command line's input and output, kept for the test; `secret` answers what the user would type. */
export function cliIo(answers: { secret?: string | null } = {}): CliIO & { outs: string[]; errs: string[]; stop(): void } {
  const outs: string[] = [];
  const errs: string[] = [];
  const stop = Promise.withResolvers<void>();
  return {
    outs,
    errs,
    out: (line) => outs.push(line),
    err: (line) => errs.push(line),
    env: {},
    home: tmpdir(),
    now: () => Date.UTC(2026, 10, 13, 12, 0, 0),
    secret: async () => answers.secret ?? null,
    stopped: () => stop.promise,
    stop: () => stop.resolve(),
    fetch: (url, init) => fetch(url, init),
  };
}

/** A user's connection's key as the layer's secrets document keeps it (`keys`, by connection id); null where it has none. */
export function storedKey(port: ModelsPort): (user: string, id: string) => Promise<string | null> {
  return async (user, id) => {
    const doc = await port.loadSecrets({ user });
    const key = isRecord(doc) && isRecord(doc.keys) ? doc.keys[id] : undefined;
    return typeof key === "string" ? key : null;
  };
}

/**
 * A stand-in for RPH's model layer, for the routes' tests: it keeps each user's two documents through
 * the app's `ModelsPort`, as the real layer does, and shows a connection as `ConnectionView` says, a
 * key's last four characters and never the key.
 */
export function testModelLayer(port: ModelsPort): ConnectionsApi {
  let made = 0;
  const load = async (user: string): Promise<{ doc: ConnectionsDoc; secrets: SecretsDoc }> => ({
    doc: ((await port.loadConnections({ user })) as ConnectionsDoc | null) ?? { v: 1, default: null, connections: [] },
    secrets: ((await port.loadSecrets({ user })) as SecretsDoc | null) ?? { v: 1, keys: {}, signins: {} },
  });
  const view = (c: StoredConnection, doc: ConnectionsDoc, secrets: SecretsDoc): ConnectionView => {
    const { headers, ...rest } = c;
    const key = secrets.keys[c.id];
    return {
      ...rest,
      default: doc.default === c.id,
      key: c.auth === "key" ? { set: key !== undefined, waiting: false } : null,
      ...(headers === undefined ? {} : { headers: Object.entries(headers).map(([name, value]) => ({ name, set: value !== null })) }),
    };
  };
  return {
    async list(user) {
      const { doc, secrets } = await load(user);
      return { connections: doc.connections.map((c) => view(c, doc, secrets)), default: doc.default, providers: [] };
    },
    async save(user, input, key) {
      const { doc, secrets } = await load(user);
      const id = input.id ?? `connection-${++made}`;
      const at = doc.connections.findIndex((c) => c.id === id);
      if (input.id !== undefined && at === -1) throw new Error("That connection is no longer there.");
      const stored: StoredConnection = { id, name: input.name, provider: input.provider, auth: input.auth, ...(input.model ? { model: input.model } : {}), ...(input.effort ? { effort: input.effort } : {}) };
      if (at === -1) doc.connections.push(stored);
      else doc.connections[at] = stored;
      doc.default ??= id;
      if (typeof key === "string") secrets.keys[id] = key;
      if (key === null) delete secrets.keys[id];
      await port.saveConnections({ user }, doc);
      await port.saveSecrets({ user }, secrets);
      return view(stored, doc, secrets);
    },
    async remove(user, id) {
      const { doc, secrets } = await load(user);
      doc.connections = doc.connections.filter((c) => c.id !== id);
      if (doc.default === id) doc.default = null;
      delete secrets.keys[id];
      await port.saveConnections({ user }, doc);
      await port.saveSecrets({ user }, secrets);
    },
    async setDefault(user, id) {
      const { doc } = await load(user);
      doc.default = id;
      await port.saveConnections({ user }, doc);
    },
    // It calls no provider and knows no model: the routes' tests of a test and of limits run on RPH's own layer.
    test: async () => ({ ok: false, ms: 0, error: "This stand-in calls no provider." }),
    limits: async () => ({ contextWindow: null, maxTokens: null, pictures: null, asked: ["contextWindow", "maxTokens", "pictures"] }),
  };
}

/** A WebSocket client over a bare TCP socket: it can stop reading, so the server meets a page that has fallen behind. */
export interface RawSocket {
  status: number;
  /** Text messages received, in order. */
  messages: string[];
  /** Resolves once the messages received so far satisfy `test`. */
  waitFor(test: (messages: readonly string[]) => boolean): Promise<void>;
  send(text: string): void;
  pause(): void;
  resume(): void;
  close(): void;
}

export async function rawSocket(server: RunningServer, path: string, protocols: readonly string[]): Promise<RawSocket> {
  let buffer = Buffer.alloc(0);
  let handshake: string | null = null;
  const messages: string[] = [];
  const waiting: { test: (messages: readonly string[]) => boolean; resolve: () => void }[] = [];
  const opened = Promise.withResolvers<void>();
  const parse = (): void => {
    if (handshake === null) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      handshake = buffer.subarray(0, end).toString("latin1");
      buffer = buffer.subarray(end + 4);
      opened.resolve();
    }
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = (buffer[0] ?? 0) & 0x0f;
      let length = (buffer[1] ?? 0) & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        at = 10;
      }
      if (buffer.length < at + length) return;
      if (opcode === 1) {
        messages.push(buffer.subarray(at, at + length).toString("utf8"));
        for (const waiter of waiting.filter((w) => w.test(messages))) {
          waiting.splice(waiting.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
      buffer = buffer.subarray(at + length);
    }
  };
  const socket: Socket<undefined> = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      data(_socket, chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        parse();
      },
    },
  });
  socket.write(
    [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${server.port}`, "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`, "Sec-WebSocket-Version: 13", `Sec-WebSocket-Protocol: ${protocols.join(", ")}`, "", ""].join("\r\n"),
  );
  await opened.promise;
  const status = Number(/^HTTP\/1\.1 (\d+)/.exec(handshake ?? "")?.[1] ?? 0);
  return {
    status,
    messages,
    waitFor(test) {
      if (test(messages)) return Promise.resolve();
      const met = Promise.withResolvers<void>();
      waiting.push({ test, resolve: met.resolve });
      return met.promise;
    },
    send(text) {
      const payload = Buffer.from(text, "utf8");
      const mask = randomBytes(4);
      const head = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
      const masked = Buffer.from(payload.map((byte, i) => byte ^ (mask[i % 4] ?? 0)));
      socket.write(Buffer.concat([head, mask, masked]));
    },
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    close: () => socket.end(),
  };
}
