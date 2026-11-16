// The model layer's connections and their secrets, kept for RPH (plan §13.2; `ModelsPort` in
// `rp-harness/contract`), and the routes the Connections page and `rpe connection` use.
//
// RPH's model layer holds the rules and writes both documents; RPE keeps each exactly as the layer
// gives it, where the plan puts it, and each user's under his own name (READINGS R-52): one user's
// connections, keys and sign-ins are never given for another. The connections document (names,
// providers, models, efforts, limits, and the names of the headers each connection's calls send) is
// the user's entry under the `models` key of the file tree's `RPE-global.yml`, read and edited with the
// rest of the global config, and read from the file each time it is asked for, so a hand edit counts.
// The secrets document (each connection's key and its headers' values, and the sign-ins) is the
// user's entry in part `models` of the secrets file and nowhere else. Documents written before, which
// name no user, are the install's user's: they are moved under him at the first start
// (`ownModels`, before anything reads them), and read as his wherever one is still found.
//
// The routes go through the model layer (`ModelsApi`), never round it: it is the documents' one
// writer. They act for the user this RPE belongs to, never for one a caller names. A key is written
// through them and never read back: what they return shows only whether a key is set, none of the
// key itself. A connection is shown with its model's limits as RPH uses them (the user's override,
// else pi's, else what the provider's server reported), or why they could not be read, which is
// logged; and tested with one small call, whose answer never carries the key: RPH's model layer
// takes every secret out of a provider's words, and nothing here does it again.

import type { ConnectionInput, ConnectionList, ConnectionTest, ConnectionView, Log, ModelLimits, ModelsApi, ModelsPort, SignInProvider, SignInStart, SignInState, UserScope } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { DataPaths } from "./config";
import { OneAtATime, oneFileAtATime, readText, writeWhole } from "./disk";
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "./routes";
import type { SecretsFile } from "./secrets";
import { withTopLevelKey, yamlMapping } from "./yaml";

/** The key of `RPE-global.yml` the connections documents are kept under, each under its user. */
export const MODELS_KEY = "models";

/** Where the connections are, on RPE's own server. */
export const CONNECTIONS_PATH = "/api/v1/connections";

const SECRETS_PART = "models";
/**
 * Where this port once kept the headers' values itself, by connection id, taking them out of the
 * connections it wrote. Read until the layer's next save has moved them, then taken away.
 */
const EARLIER_HEADERS_PART = "headers";

type ByUser = Record<string, JsonValue>;

/** A mapping whose every value is a mapping: documents kept by user (a document of the layer's holds `v`, a number). */
function mappingsOnly(held: JsonValue): boolean {
  return isRecord(held) && Object.values(held).every(isRecord);
}

/** The earlier headers' values kept by user: by user, then by connection id, then by header (written before, by connection id, a header's value is text or null). */
function headersByUser(held: JsonValue): boolean {
  return isRecord(held) && Object.values(held).every(mappingsOnly);
}

/** What is held, by user: as it is where it is kept so; a document written before, which names no user, the install's user's (nobody's while the install names none). */
function byUser(held: JsonValue | undefined | null, owner: string | null, kept: (held: JsonValue) => boolean): ByUser {
  if (held === undefined || held === null) return {};
  if (kept(held)) return held as ByUser;
  return owner === null || owner === "" ? {} : { [owner]: held };
}

/** The user a save is for: a scope that names none keeps nothing (READINGS R-179: nothing is kept without a user). */
function userOf(scope: UserScope): string {
  if (scope.user === "") throw new Error("A call of the model layer's documents names no user, so nothing is kept for it.");
  return scope.user;
}

/** The connections document as the file holds it; a connection written the earlier way gets its headers' values back, in the form the layer reads and moves at its next save. */
function withEarlierHeaders(doc: unknown, earlier: JsonValue | null): unknown {
  if (!isRecord(doc) || !Array.isArray(doc.connections) || !isRecord(earlier)) return doc;
  return {
    ...doc,
    connections: doc.connections.map((c: unknown) => (isRecord(c) && typeof c.id === "string" && c.headers === undefined && Object.hasOwn(earlier, c.id) ? { ...c, headers: earlier[c.id] } : c)),
  };
}

/** The connections documents of `RPE-global.yml`'s text, by user. */
function connectionsIn(text: string | null, paths: DataPaths, owner: string | null): ByUser {
  return text === null ? {} : byUser(yamlMapping(text, paths.globalConfig)[MODELS_KEY] as JsonValue | undefined, owner, mappingsOnly);
}

/**
 * Moves the documents written before, which name no user, under the install's user (`owner`), as older rows take the user in the step
 * that adds the column (READINGS R-179): the connections document, the secrets document and the headers' values kept the earlier way.
 * Run at the first start, before anything reads them; documents kept by user already are left as they are, and so is everything while
 * the install names no user. A file that does not read is left as it is, and the log says why: the layer's reads say what is wrong with it.
 */
export async function ownModels(paths: DataPaths, secrets: SecretsFile, owner: string | null, log: Log): Promise<void> {
  if (owner === null || owner === "") return;
  try {
    await oneFileAtATime(paths.globalConfig, async () => {
      const text = await readText(paths.globalConfig);
      const held = text === null ? undefined : (yamlMapping(text, paths.globalConfig)[MODELS_KEY] as JsonValue | undefined);
      if (text === null || held === undefined || held === null || mappingsOnly(held)) return;
      await writeWhole(paths.globalConfig, withTopLevelKey(text, MODELS_KEY, { [owner]: held }, paths.globalConfig));
    });
  } catch (error) {
    log.warn("the connections in RPE-global.yml were not moved under the install's user", { error: error instanceof Error ? error.message : String(error) });
  }
  try {
    for (const [part, kept] of [
      [SECRETS_PART, mappingsOnly],
      [EARLIER_HEADERS_PART, headersByUser],
    ] as const) {
      const held = await secrets.read(part);
      if (held !== null && !kept(held)) await secrets.write(part, { [owner]: held });
    }
  } catch (error) {
    log.warn("the secrets of the connections were not moved under the install's user", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Where RPH's model layer keeps each user's two documents: his entry of `RPE-global.yml`'s `models`, and his of the secrets file's part. `owner`: the install's user, whose a document that names none is. */
export function modelsPort(paths: DataPaths, secrets: SecretsFile, owner: () => string | null): ModelsPort {
  const writes = new OneAtATime();
  const earlierHeaders = async (): Promise<ByUser> => byUser(await secrets.read(EARLIER_HEADERS_PART), owner(), headersByUser);
  return {
    async loadConnections(scope) {
      const doc = connectionsIn(await readText(paths.globalConfig), paths, owner())[scope.user];
      return doc === undefined ? null : withEarlierHeaders(doc, (await earlierHeaders())[scope.user] ?? null);
    },
    async saveConnections(scope, doc) {
      const user = userOf(scope);
      await writes.run(() =>
        // The Settings routes and the Files page write the same file, under its one lock.
        oneFileAtATime(paths.globalConfig, async () => {
          const text = (await readText(paths.globalConfig)) ?? "";
          const held = connectionsIn(text, paths, owner());
          await writeWhole(paths.globalConfig, withTopLevelKey(text, MODELS_KEY, { ...held, [user]: doc }, paths.globalConfig));
          // A save of the layer's has moved the user's earlier values, into its secrets (which it saves first) or, where it could not, into this document.
          const { [user]: moved, ...others } = await earlierHeaders();
          if (moved !== undefined) await secrets.write(EARLIER_HEADERS_PART, Object.keys(others).length === 0 ? null : others);
        }),
      );
    },
    async loadSecrets(scope) {
      return byUser(await secrets.read(SECRETS_PART), owner(), mappingsOnly)[scope.user] ?? null;
    },
    async saveSecrets(scope, doc) {
      const user = userOf(scope);
      // The contract's secrets document is JSON by its own definition (it is kept anywhere and given back as it was).
      const json = doc as unknown as JsonValue;
      await writes.run(async () => secrets.write(SECRETS_PART, { ...byUser(await secrets.read(SECRETS_PART), owner(), mappingsOnly), [user]: json }));
    },
  };
}

/** What the routes need of the model layer: `harness.models`. */
export type ConnectionsApi = Pick<ModelsApi, "list" | "save" | "remove" | "setDefault" | "test" | "limits" | "signIn">;

// What the routes take and answer. A connection is the model layer's (`rp-harness/contract`): each of its
// types the routes carry is declared field by field here, so the pages' types and the reference say what a
// page sends and is sent, and each is held to RPH's own type, so a change to it in RPH stops this compiling
// until the declaration says the same.
const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const auth = shape.named("ConnectionAuth", "How a connection signs its calls: with its own key, with the sign-in to its provider, or with nothing.", shape.oneOf("key", "signin", "none"));
const effort = shape.named("Effort", "How hard a model reasons on a call.", shape.oneOf("off", "minimal", "low", "medium", "high", "xhigh", "max"));
const limitsEntry = shape.named("ModelLimitsEntry", "A model's figures as entered or reported: its context window and its longest answer, in tokens, and whether it takes pictures.", shape.object({ contextWindow: opt(N), maxTokens: opt(N), pictures: opt(shape.yesNo()) }));
const figureFrom = shape.oneOf("user", "pi", "connection");
const limit = shape.named("ModelLimit", "One limit of a model, in tokens, and where it came from.", shape.object({ tokens: N, from: figureFrom }));
const pictures = shape.named("ModelPictures", "Whether a model takes pictures, and where that came from.", shape.object({ takes: shape.yesNo(), from: figureFrom }));
const figure = shape.named("ModelFigure", "A figure of a model the Connections page asks for where nobody has given it.", shape.oneOf("contextWindow", "maxTokens", "pictures"));
const limits = shape.named(
  "ModelLimits",
  "A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it; and the figures nobody has given, in the order the page asks for them.",
  shape.object({ contextWindow: shape.nullable(limit), maxTokens: shape.nullable(limit), pictures: shape.nullable(pictures), asked: shape.list(figure) }),
);
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
const connectionView = shape.object({ ...viewFields, key: shape.nullable(shape.object({ set: shape.yesNo(), waiting: shape.yesNo() })) });
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

const limitsProblem = opt(shape.nullable(T), "Why its model's limits could not be read; null where they were read, each of them known or not.");
const connectionShown = shape.named(
  "ConnectionShown",
  "A connection as the routes show it: whether a key is set and nothing of the key; its model's limits as RPH uses them, null where nobody knows them; and why they could not be read, where they could not.",
  shape.object({ ...viewFields, key: shape.nullable(shape.object({ set: shape.yesNo(), waiting: opt(shape.yesNo(), "The key is kept and waits until the owner allows the place it now goes to; its calls fail in words until then.") })), limitsInForce: shape.nullable(limits), limitsProblem }),
);
/** A connection as the routes show it: whether a key is set and nothing of the key; its model's limits as RPH uses them, null where nobody knows them; and why they could not be read. */
export type ConnectionShown = Infer<typeof connectionShown>;

const connectionsShown = shape.named("ConnectionsShown", "The connections as shown, the default, and the providers offered.", shape.object({ connections: shape.list(connectionShown), ...providers }));
export type ConnectionsShown = Infer<typeof connectionsShown>;

const connectionTested = shape.named(
  "ConnectionTested",
  "A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them, or why they could not be read.",
  shape.union(shape.object({ ...tested.ok, limits: shape.nullable(limits), limitsProblem }), shape.object({ ...tested.failed, limits: shape.nullable(limits) })),
);
/** A connection's test: whether the provider answered and the model it named, or its words; and that model's limits where RPH knows them, or why they could not be read. */
export type ConnectionTested = Infer<typeof connectionTested>;

/** A model's limits as RPH uses them, or why they could not be read (a provider no longer offered, a catalogue that failed), which is logged. */
async function limitsOf(api: ConnectionsApi, log: Log, user: string, id: string, model?: string): Promise<{ limits: ModelLimits | null; problem: string | null }> {
  try {
    return { limits: await api.limits(user, id, model), problem: null };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    log.warn("a connection's model limits could not be read", { connection: id, ...(model === undefined ? {} : { model }), error: problem });
    return { limits: null, problem };
  }
}

async function shown(api: ConnectionsApi, log: Log, user: string, view: ConnectionView): Promise<ConnectionShown> {
  const { key, ...rest } = view;
  const read = view.model === undefined ? { limits: null, problem: null } : await limitsOf(api, log, user, view.id);
  return { ...rest, key: key === null ? null : { set: key.set, waiting: key.waiting }, limitsInForce: read.limits, limitsProblem: read.problem };
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

// Signing in to a provider (plan §13.2 "sign-in for Anthropic and OpenAI"), over RPH's `SignInApi`: the token is kept in the
// secrets file by the model layer and is in no answer and no log (§16); a page is given only the flow, the address to open,
// and how the sign-in stands.
const signInStart = shape.named(
  "SignInStart",
  "A sign-in started: its flow, to finish with what the user pastes back or to cancel; the address the user opens to sign in; and what to know first.",
  shape.object({ flow: T, url: T, note: T }),
);
const signInState = shape.named(
  "SignInState",
  "Where a provider's sign-in stands: signed in or not, until when its token holds (RPH renews it when a call needs it), the flow open for it, and why its last flow ended without signing in.",
  shape.object({ provider: shape.oneOf("anthropic", "openai"), signedIn: shape.yesNo(), until: shape.nullable(N), flow: shape.nullable(T), ended: shape.nullable(T) }),
);
type StartMirrored = Holds<Exactly<Infer<typeof signInStart>, SignInStart>>;
type StateMirrored = Holds<Exactly<Infer<typeof signInState>, SignInState>>;

/** The provider a connection signs in to; refused for a connection that does not sign in, or whose provider has no sign-in. */
async function signInProvider(api: ConnectionsApi, user: string, id: string): Promise<SignInProvider> {
  const connection = (await api.list(user)).connections.find((c) => c.id === id);
  if (connection === undefined) throw new RouteError(404, `There is no connection ${id}.`);
  if (connection.auth !== "signin") throw new RouteError(400, `The connection ${connection.name} does not sign in to its provider: set it to sign in first.`);
  if (connection.provider !== "anthropic" && connection.provider !== "openai") throw new RouteError(400, `${connection.name}'s provider, ${connection.provider}, has no sign-in; Anthropic and OpenAI have.`);
  return connection.provider;
}

/**
 * The routes to list, add, change and remove a connection, choose the default and test one, and to sign one in to its provider
 * and out, over the model layer, each for the user this RPE belongs to (`owner`), whoever the caller's credential names. `log`
 * hears of a model's limits that could not be read.
 */
export function connectionRoutes(api: ConnectionsApi, owner: () => string, log: Log) {
  return [
    route({
      method: "GET",
      path: CONNECTIONS_PATH,
      access: "page",
      group: "connections",
      does: "The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered.",
      reply: connectionsShown,
      handle: async () => {
        const user = owner();
        const list = await api.list(user);
        return { ...list, connections: await Promise.all(list.connections.map((c) => shown(api, log, user, c))) };
      },
    }),
    route({
      method: "POST",
      path: CONNECTIONS_PATH,
      access: "page",
      group: "connections",
      does: "Adds a connection, with its key when it has one.",
      body: saveConnection,
      reply: connectionShown,
      handle: async ({ body }) => {
        if (body.connection.id !== undefined) throw new RouteError(400, "A new connection has no id: to change one, PUT /api/v1/connections/<its id>.");
        return await shown(api, log, owner(), await layer(() => api.save(owner(), body.connection, body.key)));
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
      handle: async ({ params, body }) => await shown(api, log, owner(), await layer(() => api.save(owner(), { ...body.connection, id: params.id }, body.key))),
    }),
    route({ method: "DELETE", path: "/api/v1/connections/:id", access: "page", group: "connections", does: "Removes a connection, and its key.", reply: shape.nothing(), handle: ({ params }) => layer(() => api.remove(owner(), params.id)) }),
    route({ method: "PUT", path: "/api/v1/connections/:id/default", access: "page", group: "connections", does: "Makes a connection the default.", reply: shape.nothing(), handle: ({ params }) => layer(() => api.setDefault(owner(), params.id)) }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/test",
      access: "page",
      group: "connections",
      does: "Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits.",
      reply: connectionTested,
      handle: async ({ params, signal }) => {
        const user = owner();
        const test = await api.test(user, params.id, signal);
        if (!test.ok) return { ...test, limits: null };
        const read = await limitsOf(api, log, user, params.id, test.model);
        return { ...test, limits: read.limits, limitsProblem: read.problem };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/connections/:id/signin",
      access: "page",
      group: "connections",
      does: "Where the sign-in of a connection that signs in to its provider stands: signed in or not, until when, its open flow.",
      reply: signInState,
      handle: async ({ params }) => {
        const user = owner();
        const provider = await signInProvider(api, user, params.id);
        return await layer(() => api.signIn(user).state(provider));
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/signin",
      access: "page",
      group: "connections",
      does: "Starts signing a connection in to its provider: the flow, and the address the user opens to sign in.",
      reply: signInStart,
      handle: async ({ params }) => {
        const user = owner();
        const provider = await signInProvider(api, user, params.id);
        return await layer(() => api.signIn(user).start(provider));
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/signin/finish",
      access: "page",
      group: "connections",
      does: "Finishes a sign-in with what the user pasted back, and says how it stands; the token is kept by the model layer and never answered.",
      body: shape.object({ flow: shape.text({ blank: false }), code: shape.text({ blank: false }) }),
      reply: signInState,
      // The provider is asked to trade the code for a token, which may take longer than the relay waits.
      long: true,
      handle: async ({ params, body }) => {
        const user = owner();
        await signInProvider(api, user, params.id);
        return await layer(() => api.signIn(user).finish(body.flow, body.code));
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/connections/:id/signin/cancel",
      access: "page",
      group: "connections",
      does: "Cancels a sign-in's open flow; nothing of it is kept.",
      body: shape.object({ flow: shape.text({ blank: false }) }),
      reply: shape.nothing(),
      handle: async ({ params, body }) => {
        const user = owner();
        await signInProvider(api, user, params.id);
        await layer(() => api.signIn(user).cancel(body.flow));
      },
    }),
    route({
      method: "DELETE",
      path: "/api/v1/connections/:id/signin",
      access: "page",
      group: "connections",
      does: "Signs a connection's provider out: its tokens are forgotten.",
      reply: shape.nothing(),
      handle: async ({ params }) => {
        const user = owner();
        const provider = await signInProvider(api, user, params.id);
        await layer(() => api.signIn(user).out(provider));
      },
    }),
  ] as const;
}
