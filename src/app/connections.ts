// The model layer's connections and their secrets, kept for RPH (plan §13.2; `ModelsPort` in
// `rp-harness/contract`), and the routes the Connections page and `rpe connection` use.
//
// RPH's model layer holds the rules and writes both documents; RPE keeps each exactly as the layer
// gives it, where the plan puts it. The connections document (names, providers, models, efforts,
// limits, and the names of the headers each connection's calls send) is the `models` key of the file
// tree's `RPE-global.yml`, read and edited with the rest of the global config, and read from the file
// each time it is asked for, so a hand edit counts. The secrets document (each connection's key and
// its headers' values, and the sign-ins) is part `models` of the secrets file and nowhere else.
//
// The routes go through the model layer (`ModelsApi`), never round it: it is the documents' one
// writer. A key is written through them and never read back: what they return shows only whether a
// key is set, none of the key itself. A connection is shown with its model's limits as RPH uses them
// (the user's override, else pi's, else what the provider's server reported), and tested with one
// small call, whose answer never carries the key, even where the provider's words repeat it.

import type { ConnectionInput, ConnectionList, ConnectionTest, ConnectionView, ModelLimits, ModelsApi, ModelsPort } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { DataPaths } from "./config";
import { OneAtATime, readText, writeWhole } from "./disk";
import { route, RouteError } from "./routes";
import type { SecretsFile } from "./secrets";
import { configWrites, withTopLevelKey, yamlMapping } from "./yaml";

/** The key of `RPE-global.yml` the connections document is kept under. */
export const MODELS_KEY = "models";
const SECRETS_PART = "models";
/**
 * Where this port once kept the headers' values itself, by connection id, taking them out of the
 * connections it wrote. Read until the layer's next save has moved them, then taken away.
 */
const EARLIER_HEADERS_PART = "headers";

/** The connections document as the file holds it; a connection written the earlier way gets its headers' values back, in the form the layer reads and moves at its next save. */
function withEarlierHeaders(doc: unknown, earlier: JsonValue | null): unknown {
  if (!isRecord(doc) || !Array.isArray(doc.connections) || !isRecord(earlier)) return doc;
  return {
    ...doc,
    connections: doc.connections.map((c: unknown) => (isRecord(c) && typeof c.id === "string" && c.headers === undefined && Object.hasOwn(earlier, c.id) ? { ...c, headers: earlier[c.id] } : c)),
  };
}

/** Where RPH's model layer keeps its two documents: `RPE-global.yml`'s `models`, and the secrets file. */
export function modelsPort(paths: DataPaths, secrets: SecretsFile): ModelsPort {
  const writes = new OneAtATime();
  return {
    async loadConnections() {
      const text = await readText(paths.globalConfig);
      const doc = text === null ? undefined : yamlMapping(text, paths.globalConfig)[MODELS_KEY];
      return doc === undefined ? null : withEarlierHeaders(doc, await secrets.read(EARLIER_HEADERS_PART));
    },
    saveConnections(doc) {
      return writes.run(() =>
        // The Settings routes write the same file.
        configWrites(paths.globalConfig).run(async () => {
          const text = (await readText(paths.globalConfig)) ?? "";
          await writeWhole(paths.globalConfig, withTopLevelKey(text, MODELS_KEY, doc, paths.globalConfig));
          // A save of the layer's has moved the earlier values, into its secrets (which it saves first) or, where it could not, into this document.
          if ((await secrets.read(EARLIER_HEADERS_PART)) !== null) await secrets.write(EARLIER_HEADERS_PART, null);
        }),
      );
    },
    loadSecrets: () => secrets.read(SECRETS_PART),
    saveSecrets: (doc) => {
      // The contract's secrets document is JSON by its own definition (it is kept anywhere and given back as it was).
      const json = doc as unknown as JsonValue;
      return writes.run(() => secrets.write(SECRETS_PART, json));
    },
  };
}

/** What the routes need of the model layer: `harness.models`. */
export type ConnectionsApi = Pick<ModelsApi, "list" | "save" | "remove" | "setDefault" | "test" | "limits">;

/** A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them. */
export type ConnectionShown = Omit<ConnectionView, "key"> & { key: { set: boolean } | null; limitsInForce: ModelLimits | null };

export interface ConnectionsShown extends Omit<ConnectionList, "connections"> {
  connections: ConnectionShown[];
}

/** A connection's test: whether the provider answered and the model it named, or its words; and that model's limits where RPH knows them. */
export type ConnectionTested = ConnectionTest & { limits: ModelLimits | null };

/** A model's limits as RPH uses them; null for a connection whose model RPH cannot place (a provider no longer offered, say). */
async function limitsOf(api: ConnectionsApi, id: string, model?: string): Promise<ModelLimits | null> {
  try {
    return await api.limits(id, model);
  } catch {
    return null;
  }
}

async function shown(api: ConnectionsApi, view: ConnectionView): Promise<ConnectionShown> {
  const { key, ...rest } = view;
  return { ...rest, key: key === null ? null : { set: key.set }, limitsInForce: view.model === undefined ? null : await limitsOf(api, view.id) };
}

/** A provider's words with the key taken out, and the end of it a provider shows of one ("sk-…abcd"). */
function withoutKey(words: string, key: string | null): string {
  if (key === null || key === "") return words;
  return words.replaceAll(key, "(the key)").replaceAll(key.slice(-4), "…");
}

/** A connection's key as the layer's secrets document keeps it (`keys`, by connection id); null where it has none. */
export function storedKey(port: ModelsPort): (id: string) => Promise<string | null> {
  return async (id) => {
    const doc = await port.loadSecrets();
    const key = isRecord(doc) && isRecord(doc.keys) ? doc.keys[id] : undefined;
    return typeof key === "string" ? key : null;
  };
}

/** A connection to save, and its key: absent keeps the key there is, null takes it away. */
export interface SaveConnection {
  connection: ConnectionInput;
  key?: string | null;
}

function saveBody(value: unknown): SaveConnection {
  if (!isRecord(value) || !isRecord(value.connection)) throw new RouteError(400, 'Send {"connection": {…}, "key": "…"}: the connection, and its key when it has a new one.');
  const { name, provider, auth } = value.connection;
  if (typeof name !== "string" || name.trim() === "") throw new RouteError(400, "A connection needs a name.");
  if (typeof provider !== "string" || provider.trim() === "") throw new RouteError(400, "A connection needs a provider.");
  if (auth !== "key" && auth !== "signin" && auth !== "none") throw new RouteError(400, 'A connection signs its calls with "key", "signin" or "none".');
  const key = value.key;
  if (key !== undefined && key !== null && (typeof key !== "string" || key.trim() === "")) throw new RouteError(400, "A key is text. Leave it out to keep the one there is, or send null to take it away.");
  // Its other fields are the model layer's to check: it holds the rules for what a connection may say.
  const connection = value.connection as unknown as ConnectionInput;
  return { connection, ...(key === undefined ? {} : { key }) };
}

/** The layer's call, its refusal sent back in its own words, which never repeat a key. */
async function layer<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new RouteError(400, error instanceof Error ? error.message : String(error));
  }
}

/**
 * The routes to list, add, change and remove a connection, choose the default and test one, over the
 * model layer. `keyOf` gives a connection's stored key, only so that a test's answer can be cleared of it.
 */
export function connectionRoutes(api: ConnectionsApi, keyOf: (id: string) => Promise<string | null>) {
  return [
    route({
      method: "GET",
      path: "/api/v1/connections",
      access: "page",
      handle: async (): Promise<ConnectionsShown> => {
        const list = await api.list();
        return { ...list, connections: await Promise.all(list.connections.map((c) => shown(api, c))) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/connections",
      access: "page",
      body: saveBody,
      handle: async ({ body }): Promise<ConnectionShown> => {
        if (body.connection.id !== undefined) throw new RouteError(400, "A new connection has no id: to change one, PUT /api/v1/connections/<its id>.");
        return await shown(api, await layer(() => api.save(body.connection, body.key)));
      },
    }),
    route({ method: "PUT", path: "/api/v1/connections/:id", access: "page", body: saveBody, handle: async ({ params, body }): Promise<ConnectionShown> => await shown(api, await layer(() => api.save({ ...body.connection, id: params.id }, body.key))) }),
    route({ method: "DELETE", path: "/api/v1/connections/:id", access: "page", handle: ({ params }): Promise<void> => layer(() => api.remove(params.id)) }),
    route({ method: "PUT", path: "/api/v1/connections/:id/default", access: "page", handle: ({ params }): Promise<void> => layer(() => api.setDefault(params.id)) }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/test",
      access: "page",
      handle: async ({ params, signal }): Promise<ConnectionTested> => {
        const tested = await api.test(params.id, signal);
        if (tested.ok) return { ...tested, limits: await limitsOf(api, params.id, tested.model) };
        return { ...tested, error: withoutKey(tested.error, await keyOf(params.id)), limits: null };
      },
    }),
  ] as const;
}
