// The model layer's connections and their secrets, kept for RPH (plan §13.2; `ModelsPort` in
// `rp-harness/contract`), and the routes the Connections page and `rpe connection` use.
//
// RPH's model layer holds the rules and writes both documents; RPE keeps them where the plan puts
// them. The connections document (names, providers, models, efforts, limits) is the `models` key of
// the file tree's `RPE-global.yml`, read and edited with the rest of the global config. Everything
// secret is in the secrets file and nowhere else: each connection's key and the sign-ins (part
// `models`), and the values of each connection's headers (part `headers`), which can carry a
// credential and would otherwise sit in a file agents can read.
//
// The routes go through the model layer (`ModelsApi`), never round it: it is the documents' one
// writer and keeps them in memory, so a change made to the files beside it would be lost. A key is
// written through them and never read back: what they return shows only whether a key is set.

import type { ConnectionInput, ConnectionList, ConnectionView, ModelsApi, ModelsPort } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { DataPaths } from "./config";
import { OneAtATime, readText, writeWhole } from "./disk";
import { route, RouteError } from "./routes";
import type { SecretsFile } from "./secrets";
import { withTopLevelKey, yamlMapping } from "./yaml";

/** The key of `RPE-global.yml` the connections document is kept under. */
export const MODELS_KEY = "models";
const SECRETS_PART = "models";
const HEADERS_PART = "headers";

/** The connections document as the layer gave it, its headers' values back in place from the secrets file. */
function withHeaders(doc: unknown, headers: JsonValue | null): unknown {
  if (!isRecord(doc) || !Array.isArray(doc.connections) || !isRecord(headers)) return doc;
  return {
    ...doc,
    connections: doc.connections.map((c: unknown) => (isRecord(c) && typeof c.id === "string" && Object.hasOwn(headers, c.id) ? { ...c, headers: headers[c.id] } : c)),
  };
}

/** Where RPH's model layer keeps its two documents: `RPE-global.yml`'s `models`, and the secrets file. */
export function modelsPort(paths: DataPaths, secrets: SecretsFile): ModelsPort {
  const writes = new OneAtATime();
  return {
    async loadConnections() {
      const text = await readText(paths.globalConfig);
      const doc = text === null ? undefined : yamlMapping(text, paths.globalConfig)[MODELS_KEY];
      return doc === undefined ? null : withHeaders(doc, await secrets.read(HEADERS_PART));
    },
    saveConnections(doc) {
      return writes.run(async () => {
        const headers: Record<string, JsonValue> = {};
        const connections = doc.connections.map(({ headers: values, ...connection }) => {
          if (values !== undefined) headers[connection.id] = values;
          return connection;
        });
        // The values first: a connection is never listed with headers whose values are missing.
        await secrets.write(HEADERS_PART, headers);
        const text = (await readText(paths.globalConfig)) ?? "";
        await writeWhole(paths.globalConfig, withTopLevelKey(text, MODELS_KEY, { ...doc, connections }, paths.globalConfig));
      });
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
export type ConnectionsApi = Pick<ModelsApi, "list" | "save" | "remove" | "setDefault">;

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

/** The routes to list, add, change and remove a connection, and to choose the default, over the model layer. */
export function connectionRoutes(api: ConnectionsApi) {
  return [
    route({ method: "GET", path: "/api/v1/connections", access: "page", handle: (): Promise<ConnectionList> => api.list() }),
    route({
      method: "POST",
      path: "/api/v1/connections",
      access: "page",
      body: saveBody,
      handle: ({ body }): Promise<ConnectionView> => {
        if (body.connection.id !== undefined) throw new RouteError(400, "A new connection has no id: to change one, PUT /api/v1/connections/<its id>.");
        return layer(() => api.save(body.connection, body.key));
      },
    }),
    route({ method: "PUT", path: "/api/v1/connections/:id", access: "page", body: saveBody, handle: ({ params, body }): Promise<ConnectionView> => layer(() => api.save({ ...body.connection, id: params.id }, body.key)) }),
    route({ method: "DELETE", path: "/api/v1/connections/:id", access: "page", handle: ({ params }): Promise<void> => layer(() => api.remove(params.id)) }),
    route({ method: "PUT", path: "/api/v1/connections/:id/default", access: "page", handle: ({ params }): Promise<void> => layer(() => api.setDefault(params.id)) }),
  ] as const;
}
