# RPE's API

Every route RPE's server holds, as its route table declares it, every kind its live socket carries, and the live socket's own messages. `bun run api` (`scripts/api/`) writes this page and `src/shared/api/index.ts`, the types the pages, the command line and the MCP server call RPE with, from the table the server runs. A route changes in its own declaration, and both are written again from it; a test fails while either is behind the table. Do not edit this page by hand.

Who may call a route: **public**, anyone who reaches RPE; **page**, a page of the Lumiverse user this RPE belongs to, with a page token or the web UI's token; **provider**, Lumiverse on RPE's connection, with the provider key; **extension**, the light extension, with its registration key.

Every request's body is held to its route's limit, whatever its method: one over it is refused with 413. A GET takes no body on any route, nor does a DELETE on a route that answers in JSON, so either is refused with 400 when it carries one. A route in the form that answers in JSON is held to its declaration before its code runs: a name or a value in its query that it does not declare, or a body it does not take, is refused with 400, and the answer's `error` says why. A route that answers in its own way (the provider endpoint, the extension's routes, the live socket, the web UI's files, and the raw routes not yet declared) is handed the request within its body limit, reads its query and its body itself, and says in its own words what it does not take. A route not yet declared that answers in JSON, listed at the end, is held to its access and its body limit, and to no declaration yet. A refusal is `{ "error": "<why>" }` on every route but the provider endpoint's, which answers as OpenAI does.

A route that pages takes `limit` and `cursor` in its query and answers `{ items, next }`: `next` is where the next page starts, given back as `cursor`, and null at the end. A cursor names the place after the last item a page gave, by that item's place in the list's own order, never by a count of items, so a walk over a list that changes between its pages neither repeats nor skips an item that stayed. A route refuses with 400 a cursor it did not give for that list: another route's, another list's, one changed, or one given before RPE last started.

## Contents

- [Connections](#connections)
- [Settings](#settings)
- [Service](#service)
- [The live socket](#the-live-socket)
- [The web UI](#the-web-ui)
- [The live socket's kinds](#the-live-sockets-kinds)
- [The live socket's messages](#the-live-sockets-messages)
- [Routes not yet declared](#routes-not-yet-declared)
- [Types](#types)

## Connections

### `GET /api/v1/connections`

The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`ConnectionsShown`](#connectionsshown) |

### `POST /api/v1/connections`

Adds a connection, with its key when it has one.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`SaveConnection`](#saveconnection) |
| Reply | [`ConnectionShown`](#connectionshown) |

### `PUT /api/v1/connections/:id`

Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `id` |
| Query | none |
| Body | [`SaveConnection`](#saveconnection) |
| Reply | [`ConnectionShown`](#connectionshown) |

### `DELETE /api/v1/connections/:id`

Removes a connection, and its key.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | nothing (204) |

### `PUT /api/v1/connections/:id/default`

Makes a connection the default.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | nothing (204) |

### `POST /api/v1/connections/:id/test`

Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | [`ConnectionTested`](#connectiontested) |

## Settings

### `GET /api/v1/settings`

Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, and the level and file it comes from.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose levels are read; left out or empty, the levels every chat shares |
| Body | none |
| Reply | [`SettingsReply`](#settingsreply) |

### `PUT /api/v1/settings`

Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`SettingsWrite`](#settingswrite) |
| Reply | [`SettingsReply`](#settingsreply) |

## Service

### `GET /api/v1/status`

Says that RPE answers here, and its build; nothing more, and no work to say it.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`Status`](#status) |

### `GET /api/v1/status/builds`

When RPE started, and the builds that meet at it, its app file read again.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`BuildsReply`](#buildsreply) |

### `GET /api/v1/status/session`

Whose the page's credential is, and when it ends.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`SessionReply`](#sessionreply) |

### `POST /api/v1/update`

"Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`BuildsStatus`](#buildsstatus) |

## The live socket

### `GET /api/v1/live`

The live socket: a page follows chats on it, and is sent each one's events in order (the live kinds), held to the token it opened with.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token) |
| Body limit | takes no body |
| Params | none |
| Answers | a WebSocket on the protocol rpe.live; 426 when the request is not a socket's, 400 when it offers protocols and not rpe.live |

## The web UI

### `GET /ui/*`

The web app's files, to anyone who reaches RPE; what a page then does is held to its own token by the API.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | takes no body |
| Params | `*` (the rest of the path) |
| Answers | a file of the built web app (its page, scripts and styles), or 404 with words saying why there is none |

## The live socket's kinds

What a page following a chat on `/api/v1/live` is sent: each event is `{ chat, seq, kind, key?, at, data }`, numbered from 1 per chat, and `data` is what its kind carries.

| Kind | Carries | What it says |
|---|---|---|
| `trace` | [`TraceRecord`](#tracerecord) | A record of RPH's trace, for a run played in the chat: every event of the run, as RPH gave it. |
| `delta` | [`TraceDelta`](#tracedelta) | A piece of a model call's text as it streams, for the live view; the call's call_ended record holds it whole. |
| `reply` | [`ReplyPiece`](#replypiece) | What went to the chat as the reply was written: its text, and the progress lines of its thinking block. |
| `state` | `Record<string, never>` | The chat's state changed, and a page reads it again. A newer one replaces one a page has not taken yet. |
| `handler_failed` | `{ op: string; error: string }` | An engine handler failed on a change, which is recorded as not applied: the operation, and the handler's error. |

## The live socket's messages

A page opens `/api/v1/live` as a WebSocket, offering the protocol `rpe.live`. A page that cannot set the Authorization header offers its token as a second protocol: `rpe.token.` and then the token. Every message, either way, is JSON.

| | |
|---|---|
| A page sends | [`LiveAsk`](#liveask) |
| A page is sent | [`LiveMessage`](#livemessage) |
| A chat's events, as the relay hands them on | [`LiveBatch`](#livebatch) |
| Closed | with the code 4401 and the reason "The page's token has run out or was replaced: open the live socket again with a new one.", once the token it opened with has run out or been replaced |

## Routes not yet declared

The table holds these as their areas wrote them before the route form: the server holds each to its access, its Origin and Host and its body limit, and its query, body and reply are not declared yet, so they are in no generated type.

| Route | Access | Area | Params | Body limit |
|---|---|---|---|---|
| `POST /api/v1/bootstrap` | page | bootstrap | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/build` | page | build | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats` | page | turn | none | takes no body |
| `POST /api/v1/chats/:chat/actions` | page | play | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/chats/:chat/actions/undo` | page | play | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/bootstrap` | page | bootstrap | `chat` | takes no body |
| `POST /api/v1/chats/:chat/bootstrap` | page | bootstrap | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/cast` | page | cast | `chat` | takes no body |
| `GET /api/v1/chats/:chat/cast/:character` | page | cast | `chat`, `character` | takes no body |
| `POST /api/v1/chats/:chat/cast/:character/strike` | page | cast | `chat`, `character` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/jobs` | page | turn | `chat` | takes no body |
| `POST /api/v1/chats/:chat/requests` | page | turn | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/chats/:chat/settle` | page | turn | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/state` | page | play | `chat` | takes no body |
| `GET /api/v1/chats/:chat/story` | page | story | `chat` | takes no body |
| `POST /api/v1/chats/:chat/story/strike` | page | story | `chat` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/turns` | page | turn | `chat` | takes no body |
| `GET /api/v1/chats/:chat/turns/:turn` | page | turn | `chat`, `turn` | takes no body |
| `GET /api/v1/chats/:chat/turns/:turn/files` | page | turn | `chat`, `turn` | takes no body |
| `GET /api/v1/chats/:chat/turns/:turn/files/*` | page | turn | `chat`, `turn`, `*` (the rest of the path) | takes no body |
| `POST /api/v1/chats/:chat/turns/:turn/stop` | page | turn | `chat`, `turn` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/chats/:chat/world` | page | turn | `chat` | takes no body |
| `POST /api/v1/ext/confirm` | extension | lumiverse | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/ext/live` | extension | lumiverse | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/ext/question` | extension | lumiverse | none | at most 8 MiB |
| `POST /api/v1/ext/start` | extension | lumiverse | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/files` | page | tree | none | takes no body |
| `GET /api/v1/files-diff/*` | page | tree | `*` (the rest of the path) | takes no body |
| `PUT /api/v1/files-off/*` | page | tree | `*` (the rest of the path) | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/files-prune` | page | tree | none | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/files-stack` | page | tree | none | takes no body |
| `GET /api/v1/files/*` | page | tree | `*` (the rest of the path) | takes no body |
| `PUT /api/v1/files/*` | page | tree | `*` (the rest of the path) | the server's `server.bodyBytes` (1 MiB as shipped) |
| `DELETE /api/v1/files/*` | page | tree | `*` (the rest of the path) | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/jobs` | page | turn | none | takes no body |
| `POST /api/v1/jobs/:job/cancel` | page | turn | `job` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `GET /api/v1/migration` | page | migration | none | takes no body |
| `GET /api/v1/status/extension` | page | lumiverse | none | takes no body |
| `GET /api/v1/storage` | page | tree | none | takes no body |
| `GET /api/v1/storage/notes` | page | tree | none | takes no body |
| `GET /api/v1/suggestions` | page | tree | none | takes no body |
| `POST /api/v1/suggestions/:id/accept` | page | tree | `id` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /api/v1/suggestions/:id/dismiss` | page | tree | `id` | the server's `server.bodyBytes` (1 MiB as shipped) |
| `POST /v1/chat/completions` | provider | lumiverse | none | the server's `server.providerBodyBytes` (32 MiB as shipped) |
| `GET /v1/models` | provider | lumiverse | none | takes no body |

## Types

Every type a route, a live kind or the live socket's messages name, as the generated types write it. `JsonValue` is any JSON value.

### `AgentRef`

One agent of a run: its handle, its definition, the agent that started it, its job, and the character it plays.

```ts
export interface AgentRef {
  id: string;
  definition: string;
  parent?: string;
  job?: string;
  plays?: string;
}
```

### `BuildsReply`

When RPE started (epoch milliseconds), and the builds that meet at it.

```ts
export interface BuildsReply {
  name: "rpe";
  version: string;
  started: number;
  builds: BuildsStatus;
}
```

### `BuildsStatus`

The builds that meet at RPE, as its builds route and "Update now" give them.

```ts
export interface BuildsStatus {
  /** The build this process runs. */
  running: string;
  /** The build of the app file on disk; null where there is no file, or it gives none. */
  disk: string | null;
  /** Why the file on disk gave no build: it is not there, does not start, or says something else. */
  broken: string | null;
  /** The extension's build as it said at its last registration; null before it has. */
  extension: string | null;
  /** Every build known is the running one, and the file on disk starts. */
  agree: boolean;
  restart: RestartState;
  /** All of it in a sentence or two, as `rpe status` prints it. */
  words: string;
}
```

### `CallPermission`

The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call.

```ts
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}
```

### `ConnectionAuth`

How a connection signs its calls: with its own key, with the sign-in to its provider, or with nothing.

```ts
export type ConnectionAuth = "key" | "signin" | "none";
```

### `ConnectionInput`

A connection to save, whole: with the id of one that exists it replaces that one, and a field left out (or null) is cleared; headers left out keep the stored ones.

```ts
export interface ConnectionInput {
  id?: string;
  name: string;
  provider: string;
  auth: ConnectionAuth;
  baseUrl?: string | null;
  api?: string | null;
  model?: string | null;
  effort?: Effort | null;
  /** Exactly these headers, a text setting a value and null keeping the stored one; null takes them all away. */
  headers?: { [key: string]: string | null } | null;
  serialTools?: boolean | null;
  messageThreads?: boolean | null;
  retries?: number | null;
  /** The user's limits for its models, by model id; null clears them. */
  limits?: { [key: string]: ModelLimitsEntry } | null;
}
```

### `ConnectionShown`

A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them.

```ts
export interface ConnectionShown {
  id: string;
  name: string;
  /** The provider kind the layer offers (anthropic, deepseek, openai-compatible, …). */
  provider: string;
  auth: ConnectionAuth;
  /** Where its calls go instead of the provider's own address. */
  baseUrl?: string;
  /** The API a compatible server speaks, where it may speak more than one. */
  api?: string;
  /** Its model, for an agent whose definition names none. */
  model?: string;
  /** Its own effort, for an agent that names none. */
  effort?: Effort;
  /** It takes one tool call per answer. */
  serialTools?: true;
  /** Message threads are on. */
  messageThreads?: true;
  /** How many times a call that failed before any answer arrived is tried again; 2 when absent. */
  retries?: number;
  /** What the user entered as each model's limits, by model id. */
  limits?: { [key: string]: ModelLimitsEntry };
  /** What the connection's server reported as each model's limits, by model id. */
  reported?: { [key: string]: ModelLimitsEntry };
  /** Its headers by name, and whether each has a value; never a value. */
  headers?: { name: string; set: boolean }[];
  default: boolean;
  /** For a connection that signs in: whether the sign-in holds. */
  signedIn?: boolean;
  key: { set: boolean } | null;
  limitsInForce: ModelLimits | null;
}
```

### `ConnectionsShown`

The connections as shown, the default, and the providers offered.

```ts
export interface ConnectionsShown {
  connections: ConnectionShown[];
  default: string | null;
  providers: ProviderOffer[];
}
```

### `ConnectionTested`

A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them.

```ts
export type ConnectionTested = { ok: true; ms: number; model: string; limits: ModelLimits | null } | { ok: false; ms: number; error: string; limits: ModelLimits | null };
```

### `Effort`

How hard a model reasons on a call.

```ts
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
```

### `JobView`

A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, and the limit it ended at.

```ts
export interface JobView {
  id: string;
  agent: string;
  brief: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled" | "off-path" | "interrupted";
  scope: Scope;
  startedBy: AgentRef | "user";
  started: number;
  ended?: number;
  usage: Usage;
  report?: string;
  limit?: LimitHit;
}
```

### `LayerLevel`

A level of the agents' tree: what ships, the user's own, a character's, a chat's.

```ts
export type LayerLevel = "shipped" | "global" | "character" | "chat";
```

### `LimitHit`

A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs.

```ts
export interface LimitHit {
  limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "depth" | "agents" | "jobs";
  per: "turn" | "agent" | "job" | "day";
  max: number;
  value: number;
  agent?: AgentRef;
  connection?: string;
}
```

### `LiveAsk`

What a page sends on the live socket: to follow a chat's events from its next one, or to stop.

```ts
export interface LiveAsk {
  op: "follow" | "unfollow";
  chat: string;
}
```

### `LiveBatch`

A chat's events in order, and the numbers of those the hub dropped before them for a page that fell behind: an events message without its type, as the relay hands it on.

```ts
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: LiveMissed;
}
```

### `LiveEvent`

One event of a chat as the live socket sends it: numbered from 1 per chat, of one of the kinds the socket carries, with that kind's data; an event of a kind declared with a key carries it.

```ts
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string } };
```

### `LiveMessage`

What the live socket sends a page: that following a chat began, with the number of the chat's last event then; a chat's events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent.

```ts
export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };
```

### `LiveMissed`

The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than live.queueEvents holds for it.

```ts
export interface LiveMissed {
  from: number;
  to: number;
}
```

### `ModelLimit`

One limit of a model, in tokens, and where it came from.

```ts
export interface ModelLimit {
  tokens: number;
  from: "user" | "pi" | "connection";
}
```

### `ModelLimits`

A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it.

```ts
export interface ModelLimits {
  contextWindow: ModelLimit | null;
  maxTokens: ModelLimit | null;
}
```

### `ModelLimitsEntry`

A model's limits as entered or reported: its context window and its longest answer, in tokens.

```ts
export interface ModelLimitsEntry {
  contextWindow?: number;
  maxTokens?: number;
}
```

### `PromptNotice`

What changed in the prompt's shape since the turn before, or that it is not mapped or could not be told apart.

```ts
export type PromptNotice = { kind: "changed"; marker: string } | { kind: "gone"; marker: string } | { kind: "unclaimed"; message: number; start: number; end: number } | { kind: "order"; markers: string[] } | { kind: "preset"; was: { id: string; name?: string; revision?: string } | null; now: { id: string; name?: string; revision?: string } | null } | { kind: "unmapped" } | { kind: "incomplete" };
```

### `ProviderOffer`

A provider the Connections page offers, how its connections may sign their calls, the APIs it speaks, and whether a connection of it must give its address.

```ts
export interface ProviderOffer {
  id: string;
  name: string;
  auth: ConnectionAuth[];
  apis: string[];
  needsBaseUrl: boolean;
}
```

### `Release`

The reply's release: whose text, in which form, the file for a file released, and its length.

```ts
export interface Release {
  by: AgentRef;
  form: "tags" | "message" | "narrator" | "narrator-live" | "file";
  path?: string;
  length: number;
}
```

### `ReplyPiece`

What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or one progress line of the chat's thinking block, counted from 0.

```ts
export type ReplyPiece = { run: string; from: number; text: string } | { run: string; line: number; progress: string };
```

### `RestartState`

Where a restart onto RPE's app file on disk stands: nothing to restart onto, waiting for the turns and jobs running, restarting, needed and not made while `update.restart` is off, or needed and not possible, RPE having been started by hand.

```ts
export type RestartState = "none" | "waiting" | "restarting" | "off" | "by hand";
```

### `RuleFiring`

A rule that fired: which, from where, at what moment, on what, what it did, and what the agent did next.

```ts
export interface RuleFiring {
  rule: string;
  path: string;
  level: LayerLevel;
  moment: "stream" | "tool-call" | "tool-result" | "after-message" | "run-end" | "turn-start" | "before-compaction" | "interval";
  watched?: "text" | "thinking" | "reply" | "arguments" | "result";
  agent: AgentRef;
  callId?: string;
  tool?: string;
  matched?: string;
  fact?: { name: string; value: { count: number; names?: string[]; by?: { [key: string]: number }; namesBy?: { [key: string]: string[] }; fields?: { [key: string]: JsonValue } } };
  action: "cut" | "remind" | "hold" | "follow-up" | "briefing" | "call";
  dropped?: string;
  then?: { did: "called"; tools: string[] } | { did: "wrote" } | { did: "released" } | { did: "ended" };
}
```

### `RunOutcome`

How a run ended, whether a reply was released, the limit or the failure, and what every agent of it spent.

```ts
export interface RunOutcome {
  status: "released" | "no-reply" | "stopped" | "limit" | "failed";
  released: boolean;
  limit?: LimitHit;
  error?: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed"; limit?: LimitHit; detail?: string };
  usage: Usage;
}
```

### `Sampling`

Sampling by its usual names, as a preset sets it; each one absent is the connection's own.

```ts
export interface Sampling {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  seed?: number;
  stop?: string[];
}
```

### `SaveConnection`

A connection to save, and its key: left out keeps the key there is, null takes it away.

```ts
export interface SaveConnection {
  connection: ConnectionInput;
  key?: string | null;
}
```

### `Scope`

Where work is: the user, the chat, the session, and the turn where it belongs to one.

```ts
export interface Scope {
  user: string;
  chat: string;
  session: string;
  turn?: string;
}
```

### `SessionReply`

Whose the page's credential is, and when it runs out (epoch milliseconds; null: it has no end).

```ts
export interface SessionReply {
  user: string;
  ends: number | null;
}
```

### `SettingsReply`

Each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); and every setting.

```ts
export interface SettingsReply {
  chat: string | null;
  files: ({ level: LayerLevel; file: string; problem: string | null })[];
  settings: SettingView[];
}
```

### `SettingsWrite`

A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`.

```ts
export interface SettingsWrite {
  level: LayerLevel;
  chat?: string | null;
  key: string;
  value?: JsonValue;
  none?: boolean;
}
```

### `SettingTakes`

What a level may set a setting to: a whole number or a number, at least `least` and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names.

```ts
export type SettingTakes = { type: "whole"; least: number; most?: number } | { type: "number"; least: number; most?: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };
```

### `SettingView`

A setting as the Settings page shows it.

```ts
export interface SettingView {
  /** As a config file writes it; a per-connection setting's names the connection. */
  key: string;
  /** The value in force. */
  value: JsonValue;
  default: JsonValue;
  /** The level whose file decides the value in force; null where no file does, and the default holds. */
  from: LayerLevel | null;
  /** That level's file, as the Files page names it. */
  file: string | null;
  takes: SettingTakes;
  /** What it takes, in words. */
  takesWords: string;
  /** What no value means, where the default is none or `~` may be set. */
  none: string | null;
  /** `~` may be set (`none: true` in a write). */
  orNone: boolean;
  /** The levels it may be set at here. */
  levels: LayerLevel[];
  /** For a per-connection setting, the connection it names; null for a name or id no connection has now. */
  connection?: { id: string; name: string } | null;
  /** A value a file sets that the setting does not take, and why: the default holds in its place. */
  passed: { value: JsonValue; why: string } | null;
}
```

### `Status`

That RPE answers here, and its build: nothing more.

```ts
export interface Status {
  name: "rpe";
  version: string;
}
```

### `ToolCallView`

A tool call a model made: the model's id for it, the tool, its arguments, and when the model began writing it, where the provider gave it in pieces.

```ts
export interface ToolCallView {
  id: string;
  name: string;
  args: JsonValue;
  began?: number;
}
```

### `ToolResult`

A tool's answer: what the model is shown, whether it failed, what it reports beyond it, its marks, and data for the live view.

```ts
export interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  error?: true;
  reports?: string[];
  marks?: string[];
  details?: JsonValue;
}
```

### `TraceDelta`

Text of a model call as it streams: what arrived since the last piece, never numbered.

```ts
export interface TraceDelta {
  run: string;
  agent: string;
  call: number;
  text?: string;
  thinking?: string;
  at: number;
}
```

### `TraceEvent`

What RPH did; each kind's fields are the facts of it.

```ts
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; session: string; given: string[] } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; closing: boolean; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "hook"; hook: string; on: "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end"; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "released"; release: Release } | { kind: "compacted"; session: string; before: number; after: number; keptTurns: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened"; from?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };
```

### `TraceRecord`

An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it.

```ts
export interface TraceRecord {
  seq: number;
  run: string;
  scope: Scope;
  at: number;
  agent: AgentRef;
  parent?: { agent: string; run: string; call: string };
  event: TraceEvent;
}
```

### `TurnKind`

What a generation asks for.

```ts
export type TurnKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";
```

### `Usage`

Model calls and their tokens: sent (cached ones included), read from and written to the cache, written, and of those the reasoning.

```ts
export interface Usage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
}
```
