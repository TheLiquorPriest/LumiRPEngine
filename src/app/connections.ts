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
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "./routes";
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

// What the routes take and answer. A connection is the model layer's (`rp-harness/contract`): each of its
// types the routes carry is declared field by field here, so the pages' types and the reference say what a
// page sends and is sent, and each is held to RPH's own type, so a change to it in RPH stops this compiling
// until the declaration says the same.
const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const auth = shape.named("ConnectionAuth", "How a connection signs its calls: with its own key, with the sign-in to its provider, or with nothing.", shape.oneOf("key", "signin", "none"));
const effort = shape.named("Effort", "How hard a model reasons on a call.", shape.oneOf("off", "minimal", "low", "medium", "high", "xhigh", "max"));
const limitsEntry = shape.named("ModelLimitsEntry", "A model's limits as entered or reported: its context window and its longest answer, in tokens.", shape.object({ contextWindow: opt(N), maxTokens: opt(N) }));
const limit = shape.named("ModelLimit", "One limit of a model, in tokens, and where it came from.", shape.object({ tokens: N, from: shape.oneOf("user", "pi", "connection") }));
const limits = shape.named("ModelLimits", "A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it.", shape.object({ contextWindow: shape.nullable(limit), maxTokens: shape.nullable(limit) }));
/** A connection as the layer shows it, but for its key. */
const viewFields = {
  id: T,
  name: T,
  provider: shape.field(T, "The provider kind the layer offers (anthropic, deepseek, openai-compatible, …)."),
  auth,
  baseUrl: opt(T, "Where its calls go instead of the provider's own address."),
  api: opt(T, "The API a compatible server speaks, where it may speak more than one."),
  model: opt(T, "Its model, for an agent whose definition names none."),
  effort: opt(effort, "Its own effort, for an agent that names none."),
  serialTools: opt(shape.literal(true), "It takes one tool call per answer."),
  messageThreads: opt(shape.literal(true), "Message threads are on."),
  retries: opt(N, "How many times a call that failed before any answer arrived is tried again; 2 when absent."),
  limits: opt(shape.record(limitsEntry), "What the user entered as each model's limits, by model id."),
  reported: opt(shape.record(limitsEntry), "What the connection's server reported as each model's limits, by model id."),
  headers: opt(shape.list(shape.object({ name: T, set: shape.yesNo() })), "Its headers by name, and whether each has a value; never a value."),
  default: shape.yesNo(),
  signedIn: opt(shape.yesNo(), "For a connection that signs in: whether the sign-in holds."),
} as const;
const providers = { default: shape.nullable(T), providers: shape.list(shape.named("ProviderOffer", "A provider the Connections page offers, how its connections may sign their calls, the APIs it speaks, and whether a connection of it must give its address.", shape.object({ id: T, name: T, auth: shape.list(auth), apis: shape.list(T), needsBaseUrl: shape.yesNo() }))) } as const;
const tested = { ok: { ok: shape.literal(true), ms: N, model: T }, failed: { ok: shape.literal(false), ms: N, error: T } } as const;
const connectionView = shape.object({ ...viewFields, key: shape.nullable(shape.object({ set: shape.yesNo(), last4: shape.nullable(T) })) });
const connectionInput = shape.named(
  "ConnectionInput",
  "A connection to save, whole: with the id of one that exists it replaces that one, and a field left out (or null) is cleared; headers left out keep the stored ones.",
  shape.object({
    id: opt(T),
    name: shape.text({ blank: false }),
    provider: shape.text({ blank: false }),
    auth,
    baseUrl: opt(shape.nullable(T)),
    api: opt(shape.nullable(T)),
    model: opt(shape.nullable(T)),
    effort: opt(shape.nullable(effort)),
    headers: opt(shape.nullable(shape.record(shape.nullable(T))), "Exactly these headers, a text setting a value and null keeping the stored one; null takes them all away."),
    serialTools: opt(shape.nullable(shape.yesNo())),
    messageThreads: opt(shape.nullable(shape.yesNo())),
    retries: opt(shape.nullable(N)),
    limits: opt(shape.nullable(shape.record(limitsEntry)), "The user's limits for its models, by model id; null clears them."),
  }),
);
// The layer's own types, held to these declarations.
const connectionList = shape.object({ connections: shape.list(connectionView), ...providers });
const connectionTest = shape.union(shape.object(tested.ok), shape.object(tested.failed));
type ViewMirrored = Holds<Exactly<Infer<typeof connectionView>, ConnectionView>>;
type ListMirrored = Holds<Exactly<Infer<typeof connectionList>, ConnectionList>>;
type TestMirrored = Holds<Exactly<Infer<typeof connectionTest>, ConnectionTest>>;
type LimitsMirrored = Holds<Exactly<Infer<typeof limits>, ModelLimits>>;
type InputMirrored = Holds<Exactly<Infer<typeof connectionInput>, ConnectionInput>>;

const connectionShown = shape.named(
  "ConnectionShown",
  "A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them.",
  shape.object({ ...viewFields, key: shape.nullable(shape.object({ set: shape.yesNo() })), limitsInForce: shape.nullable(limits) }),
);
/** A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them. */
export type ConnectionShown = Infer<typeof connectionShown>;

const connectionsShown = shape.named("ConnectionsShown", "The connections as shown, the default, and the providers offered.", shape.object({ connections: shape.list(connectionShown), ...providers }));
export type ConnectionsShown = Infer<typeof connectionsShown>;

const connectionTested = shape.named(
  "ConnectionTested",
  "A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them.",
  shape.union(shape.object({ ...tested.ok, limits: shape.nullable(limits) }), shape.object({ ...tested.failed, limits: shape.nullable(limits) })),
);
/** A connection's test: whether the provider answered and the model it named, or its words; and that model's limits where RPH knows them. */
export type ConnectionTested = Infer<typeof connectionTested>;

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

const saveConnection = shape.named(
  "SaveConnection",
  "A connection to save, and its key: left out keeps the key there is, null takes it away.",
  shape.object({ connection: connectionInput, key: opt(shape.nullable(shape.text({ blank: false }))) }),
);
/** A connection to save, and its key: absent keeps the key there is, null takes it away. */
export type SaveConnection = Infer<typeof saveConnection>;

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
      group: "connections",
      does: "The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered.",
      reply: connectionsShown,
      handle: async () => {
        const list = await api.list();
        return { ...list, connections: await Promise.all(list.connections.map((c) => shown(api, c))) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/connections",
      access: "page",
      group: "connections",
      does: "Adds a connection, with its key when it has one.",
      body: saveConnection,
      reply: connectionShown,
      handle: async ({ body }) => {
        if (body.connection.id !== undefined) throw new RouteError(400, "A new connection has no id: to change one, PUT /api/v1/connections/<its id>.");
        return await shown(api, await layer(() => api.save(body.connection, body.key)));
      },
    }),
    route({
      method: "PUT",
      path: "/api/v1/connections/:id",
      access: "page",
      group: "connections",
      does: "Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null.",
      body: saveConnection,
      reply: connectionShown,
      handle: async ({ params, body }) => await shown(api, await layer(() => api.save({ ...body.connection, id: params.id }, body.key))),
    }),
    route({ method: "DELETE", path: "/api/v1/connections/:id", access: "page", group: "connections", does: "Removes a connection, and its key.", reply: shape.nothing(), handle: ({ params }) => layer(() => api.remove(params.id)) }),
    route({ method: "PUT", path: "/api/v1/connections/:id/default", access: "page", group: "connections", does: "Makes a connection the default.", reply: shape.nothing(), handle: ({ params }) => layer(() => api.setDefault(params.id)) }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/test",
      access: "page",
      group: "connections",
      does: "Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits.",
      reply: connectionTested,
      handle: async ({ params, signal }) => {
        const test = await api.test(params.id, signal);
        if (test.ok) return { ...test, limits: await limitsOf(api, params.id, test.model) };
        return { ...test, error: withoutKey(test.error, await keyOf(params.id)), limits: null };
      },
    }),
  ] as const;
}
