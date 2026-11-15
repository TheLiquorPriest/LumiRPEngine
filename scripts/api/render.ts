// What `bun run api` writes from the route table (plan §4.4 l.308): the types every road to RPE calls it
// with (`src/shared/api/index.ts`: both shells, the command line, the MCP server), and the API reference
// (`docs/api.md`). Both are written from the declarations the server reads while it runs, in one order
// that does not depend on the order areas mount, so the same table always writes the same text.

import type { AnyShape, FieldShape, LiveKindDeclaration, LiveSocketDeclaration, Method, QueryFields, RouteGroup, RouteInfo } from "../../src/app";
import { JOINED_STATUS, joinedAnswer, METHODS, ROUTE_GROUPS } from "../../src/app";
import { ANSWER_STATUS, ANSWERS_PATH } from "../../src/app/answers";

/** The table as the generator reads it: every route, every live kind (the app's and the areas'), the live socket over them, and the server's own body limits as shipped. */
export interface Table {
  routes: readonly RouteInfo[];
  kinds: Readonly<Record<string, LiveKindDeclaration>>;
  socket: LiveSocketDeclaration;
  /** The largest body a route takes where it names none: a page's or the extension's route, and the provider endpoint's. */
  bodyBytes: number;
  providerBodyBytes: number;
}

/** Each group's heading in the reference, in the order of §4.4 l.309. */
const HEADINGS: Readonly<Record<RouteGroup, string>> = {
  provider: "The provider endpoint",
  chats: "Chats",
  turns: "Turns",
  state: "State",
  cast: "Cast",
  story: "Story",
  places: "Places",
  quests: "Quests",
  lore: "Lore",
  files: "Files",
  sessions: "Sessions",
  jobs: "Jobs",
  agents: "Agents",
  rules: "Rules",
  connections: "Connections",
  settings: "Settings",
  worlds: "Worlds",
  migration: "Migration",
  service: "Service",
  live: "The live socket",
  ui: "The web UI",
};

const ACCESS_WORDS: Readonly<Record<RouteInfo["access"], string>> = {
  public: "anyone who reaches RPE",
  page: "a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket",
  provider: "Lumiverse on RPE's connection (the provider key)",
  extension: "the light extension (its registration key)",
  command: "the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it",
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function fieldOf(f: AnyShape | FieldShape): { of: AnyShape; optional: boolean; doc: string | undefined } {
  return f.kind === "field" ? { of: f.of, optional: f.optional, doc: f.doc } : { of: f, optional: false, doc: undefined };
}

function sizeWords(bytes: number): string {
  if (bytes % 1048576 === 0) return `${bytes / 1048576} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

/**
 * The named shapes the table's declarations use, each written once in TypeScript. Two shapes given one
 * name must say the same: a name means one type wherever a page meets it.
 */
class Names {
  private readonly written = new Map<string, { doc: string; text: string }>();
  private readonly writing = new Set<string>();
  /** The previous build's types the table carries (`shape.carried`), by name: where the generated types take each from, and what it is. */
  private readonly taken = new Map<string, { from: string; doc: string }>();

  /** `s` in TypeScript: by its name where it has one (written once, below), else in full. */
  ts(s: AnyShape): string {
    if (s.kind === "carried") {
      const before = this.taken.get(s.name);
      if (before !== undefined && before.from !== s.from) throw new Error(`Two carried types are named ${s.name} and come from different modules: ${before.from} and ${s.from}.`);
      this.taken.set(s.name, { from: s.from, doc: s.doc ?? "" });
      return s.name;
    }
    if (s.name === undefined) return this.full(s);
    if (!this.writing.has(s.name)) {
      this.writing.add(s.name);
      const text = this.definition(s);
      const before = this.written.get(s.name);
      if (before !== undefined && before.text !== text) throw new Error(`Two shapes are named ${s.name} and say different things:\n${before.text}\n${text}`);
      this.written.set(s.name, { doc: s.doc ?? "", text });
    }
    return s.name;
  }

  /** The previous build's types the table carries, by name, each with the module it is taken from (relative to `src/shared/api/`) and what it is. */
  carried(): { name: string; from: string; doc: string }[] {
    return [...this.taken].map(([name, t]) => ({ name, ...t })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The named shapes, by name, each with what it is and its definition. */
  all(): { name: string; doc: string; text: string }[] {
    return [...this.written].map(([name, w]) => ({ name, ...w })).sort((a, b) => a.name.localeCompare(b.name));
  }

  private definition(s: AnyShape & { name?: string }): string {
    const name = s.name as string;
    if (s.kind === "object" && Object.keys(s.fields).length > 0) return `export interface ${name} {\n${this.fieldLines(s.fields, "  ")}}`;
    return `export type ${name} = ${this.full(s)};`;
  }

  /** An object's fields as an interface's lines, each with what it is where the declaration says. */
  fieldLines(fields: Readonly<Record<string, AnyShape | FieldShape>>, indent: string): string {
    return Object.entries(fields)
      .map(([name, f]) => {
        const { of, optional, doc } = fieldOf(f);
        return `${doc === undefined ? "" : `${indent}/** ${doc} */\n`}${indent}${key(name)}${optional ? "?" : ""}: ${this.ts(of)};\n`;
      })
      .join("");
  }

  private full(s: AnyShape): string {
    switch (s.kind) {
      case "text":
        return "string";
      case "number":
        return "number";
      case "yesNo":
        return "boolean";
      case "literal":
        return JSON.stringify(s.value);
      case "oneOf":
        return s.values.map((v) => JSON.stringify(v)).join(" | ");
      case "list": {
        const item = this.ts(s.of);
        const wrapped = item.includes(" | ") ? `(${item})[]` : `${item}[]`;
        return s.readonly ? `readonly ${wrapped}` : wrapped;
      }
      case "object": {
        const entries = Object.entries(s.fields);
        if (entries.length === 0) return "Record<string, never>";
        return `{ ${entries
          .map(([name, f]) => {
            const { of, optional } = fieldOf(f);
            return `${key(name)}${optional ? "?" : ""}: ${this.ts(of)}`;
          })
          .join("; ")} }`;
      }
      case "record":
        return `{ [key: string]: ${this.ts(s.of)} }`;
      case "union":
        return s.of.map((alternative) => this.ts(alternative)).join(" | ");
      case "json":
        return "JsonValue";
      case "nothing":
        return "void";
      case "carried":
        return s.name;
    }
  }
}

/** A route in the form that answers in JSON, with its declaration. */
interface JsonEntry {
  info: RouteInfo;
  group: RouteGroup;
  does: string;
  query: QueryFields;
  body: AnyShape | null;
  reply: AnyShape;
  paged: boolean;
  long: boolean;
  joined: boolean;
}

/** A raw route in the form, with what it answers. */
interface RawEntry {
  info: RouteInfo;
  group: RouteGroup;
  does: string;
  answers: string;
  joined: boolean;
}

function routeKey(info: RouteInfo): string {
  return `${info.method} ${info.path}`;
}

/** By path, then by method in the table's order of methods: an order no area's place in the composition changes. */
function byPath(a: RouteInfo, b: RouteInfo): number {
  return a.path === b.path ? METHODS.indexOf(a.method as Method) - METHODS.indexOf(b.method as Method) : a.path < b.path ? -1 : 1;
}

function entries(table: Table): { json: JsonEntry[]; raw: RawEntry[] } {
  const json: JsonEntry[] = [];
  const raw: RawEntry[] = [];
  for (const info of [...table.routes].sort(byPath)) {
    const d = info.declared;
    if ("answers" in d) raw.push({ info, group: d.group, does: d.does, answers: d.answers, joined: d.joined });
    else json.push({ info, group: d.group, does: d.does, query: d.query, body: d.body, reply: d.reply, paged: d.paged, long: d.long, joined: d.joined });
  }
  return { json, raw };
}

function paramsType(info: RouteInfo): string {
  return info.params.length === 0 ? "Record<string, never>" : `{ ${info.params.map((p) => `${key(p)}: string`).join("; ")} }`;
}

/** A route's query as a client gives it: what it declares, and for a route that pages, the size of the page and where it starts. */
function queryType(entry: JsonEntry, names: Names): string {
  const parts = Object.entries(entry.query).map(([name, f]) => {
    const { of, optional } = fieldOf(f);
    return `${key(name)}${optional ? "?" : ""}: ${names.ts(of)}`;
  });
  if (entry.paged) parts.push("limit?: number", "cursor?: string");
  return parts.length === 0 ? "Record<string, never>" : `{ ${parts.join("; ")} }`;
}

const TYPES_HEAD = `// RPE's API as its route table declares it: every route's params, query, body and reply, every kind the
// live socket carries, and the live socket's own messages and constants. Written by \`bun run api\`
// (scripts/api/) from the table the server runs, for every road to RPE: both shells, the command line,
// the MCP server. Do not edit it: a route's declaration is where a type changes, and \`bun run api\`
// writes this again. The reference for people is docs/api.md, written beside it.
`;

/** The live socket's constants as the generated types write them: where it is, how a page opens it and gives its token, the names it follows besides chats, and how RPE closes it; and the statuses of a joined turn's answer and of a long request's. */
function socketConstants(s: LiveSocketDeclaration): string[] {
  return [
    "/** Where a page opens the live socket, as a WebSocket. */",
    `export const LIVE_PATH = ${JSON.stringify(s.path)};`,
    "/** The protocol a page offers to open the live socket. */",
    `export const LIVE_PROTOCOL = ${JSON.stringify(s.protocol)};`,
    "/** A page that cannot set the Authorization header offers its token as a second protocol: this, then the token. */",
    `export const TOKEN_PROTOCOL_PREFIX = ${JSON.stringify(s.tokenProtocolPrefix)};`,
    `/** The code RPE closes a page's live socket with once the token it opened with has run out or been replaced, with the reason ${JSON.stringify(s.tokenEnded.reason)} */`,
    `export const LIVE_TOKEN_ENDED = ${s.tokenEnded.code};`,
    "/** Followed in place of a chat id: the user's jobs, in every chat and in none. */",
    `export const LIVE_JOBS = ${JSON.stringify(s.names.jobs)};`,
    "/** Followed in place of a chat id: what concerns the user and no one chat (the extension's status). */",
    `export const LIVE_USER = ${JSON.stringify(s.names.user)};`,
    "/** Followed in place of a chat id, before an address RPE gave the caller: an outside client's check-in. */",
    `export const LIVE_ADDRESS_PREFIX = ${JSON.stringify(s.names.addressPrefix)};`,
    "/** The status a route that takes a turn's id answers a turn joined to another with: its answer is a `JoinedAnswer`. */",
    `export const JOINED_STATUS = ${JOINED_STATUS};`,
    "/** The status a long route answers at once with `{ answer: <id> }`, and its answer's route while the work runs. */",
    `export const ANSWER_STATUS = ${ANSWER_STATUS};`,
    "/** Where a long route's answer is read, by the id it was answered with: `GET <this>/<id>`. */",
    `export const ANSWERS_PATH = ${JSON.stringify(ANSWERS_PATH)};`,
  ];
}

/** The generated types: one file that imports nothing, so the pages and the command line may both import it. */
export function renderTypes(table: Table): string {
  const names = new Names();
  const { json, raw } = entries(table);
  const routeLine = (e: JsonEntry): string => {
    const lines = [`  /** ${e.does} */`, `  ${JSON.stringify(routeKey(e.info))}: {`, `    params: ${paramsType(e.info)};`, `    query: ${queryType(e, names)};`, `    body: ${e.body === null ? "undefined" : names.ts(e.body)};`, `    reply: ${names.ts(e.reply)};`, `    paged: ${e.paged};`, `    long: ${e.long};`, `    joined: ${e.joined};`, "  };"];
    return lines.join("\n");
  };
  // The command line's routes answer on its socket alone, so a page's client is never given a call to one.
  const routeLines = json.filter((e) => e.info.access !== "command").map(routeLine);
  const commandLines = json.filter((e) => e.info.access === "command").map(routeLine);
  const rawLines = raw.map((e) => [`  /** ${e.does} */`, `  ${JSON.stringify(routeKey(e.info))}: {`, `    params: ${paramsType(e.info)};`, `    answers: ${JSON.stringify(e.answers)};`, `    joined: ${e.joined};`, "  };"].join("\n"));
  const kindLines = Object.entries(table.kinds).map(([kind, k]) => `  /** ${k.does}${k.key === undefined ? "" : ` A newer one replaces one a page has not taken yet (key "${k.key}").`} */\n  ${key(kind)}: ${names.ts(k.data)};`);
  // The socket's own messages, and the answer a joined turn gets, are named shapes: written once, with the rest, below.
  for (const message of [table.socket.asks, table.socket.answers, table.socket.batch, joinedAnswer]) names.ts(message);
  // The previous build's types a tunnel and the state view carry are taken from where they are defined, as types only.
  const taken = names.carried();
  const imports = [...new Set(taken.map((c) => c.from))].sort().map((from) => `import type { ${taken.filter((c) => c.from === from).map((c) => c.name).join(", ")} } from ${JSON.stringify(from)};`);
  const out = [
    TYPES_HEAD,
    ...(imports.length === 0 ? [] : [...imports, ""]),
    "/** Any JSON value. */",
    "export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };",
    "",
    ...names.all().flatMap((n) => [`/** ${n.doc} */`, n.text, ""]),
    "/** Every route in the form that answers in JSON, by its method and path pattern: its params, its query, its body, its reply, whether it pages, and whether it is long (answered at once with an id, its answer read from `ANSWERS_PATH`). */",
    `export interface ApiRoutes {\n${routeLines.join("\n")}\n}`,
    "",
    "/** The server's own command line's routes, which answer on its socket in the data folder alone (`command` access), in the same form; on that socket the routes of `ApiRoutes` that a page calls answer too, as the owner's. */",
    `export interface CommandRoutes ${commandLines.length === 0 ? "{}" : `{\n${commandLines.join("\n")}\n}`}`,
    "",
    "/** Every route in the form that answers in its own way (a stream, a socket, a file), and what it answers. */",
    `export interface RawRoutes {\n${rawLines.join("\n")}\n}`,
    "",
    "/** Every kind the live socket carries, the app's and the areas' own, and what each carries. */",
    `export interface LiveKinds {\n${kindLines.join("\n")}\n}`,
    "",
    "// The live socket's own constants (what a page sends on it is a LiveAsk, and what it is sent a LiveMessage, above), and the status of a joined turn's answer.",
    ...socketConstants(table.socket),
    "",
  ];
  return out.join("\n");
}

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

/** A type in the reference: a name links to its definition below; the rest is written out. */
function typeCell(s: AnyShape, names: Names): string {
  const text = names.ts(s);
  return s.name === undefined ? `\`${text}\`` : `[\`${text}\`](#${slug(text)})`;
}

/** The largest body a route takes: none on a GET; none on a DELETE that answers in JSON, nor on a route in the form that declares none. */
function bodyLimit(info: RouteInfo, table: Table): string {
  const declared = info.declared;
  if (info.method === "GET" || (info.method === "DELETE" && !info.raw) || (declared !== null && "reply" in declared && declared.body === null)) return "takes no body";
  if (info.maxBody !== null) return `at most ${sizeWords(info.maxBody)}`;
  return info.access === "provider" ? `the server's \`server.providerBodyBytes\` (${sizeWords(table.providerBodyBytes)} as shipped)` : `the server's \`server.bodyBytes\` (${sizeWords(table.bodyBytes)} as shipped)`;
}

function paramsCell(info: RouteInfo): string {
  return info.params.length === 0 ? "none" : info.params.map((p) => (p === "*" ? "`*` (the rest of the path)" : `\`${p}\``)).join(", ");
}

function queryCell(entry: JsonEntry, names: Names): string {
  const parts = Object.entries(entry.query).map(([name, f]) => {
    const { of, optional, doc } = fieldOf(f);
    return `\`${name}\`${optional ? " (may be left out)" : ""}: ${typeCell(of, names)}${doc === undefined ? "" : `, ${doc.replace(/\.$/, "")}`}`;
  });
  if (entry.paged) parts.push("`limit` (may be left out): `number`, the page's size", "`cursor` (may be left out): `string`, where the page starts: a page's `next`");
  return parts.length === 0 ? "none" : parts.join("<br>");
}

const REFERENCE_HEAD = `# RPE's API

Every route RPE's server holds, as its route table declares it, every kind its live socket carries, and the live socket's own messages. \`bun run api\` (\`scripts/api/\`) writes this page and \`src/shared/api/index.ts\`, the types the pages, the command line and the MCP server call RPE with, from the table the server runs. A route changes in its own declaration, and both are written again from it; a test fails while either is behind the table. Do not edit this page by hand.

Who may call a route: **public**, anyone who reaches RPE; **page**, a page of the Lumiverse user this RPE belongs to, with a page token or the web UI's token; **provider**, Lumiverse on RPE's connection, with the provider key; **extension**, the light extension, with its registration key.

Every request's body is held to its route's limit, whatever its method: one over it is refused with 413. A GET takes no body on any route, nor does a DELETE on a route that answers in JSON, so either is refused with 400 when it carries one. A route in the form that answers in JSON is held to its declaration before its code runs: a name or a value in its query that it does not declare, or a body it does not take, is refused with 400, and the answer's \`error\` says why. A route that answers in its own way (the provider endpoint, the extension's routes, the live socket, the web UI's files) is handed the request within its body limit, reads its query and its body itself, and says in its own words what it does not take. A route that takes a turn's id (in its path, its query or its body) says so in its listing, and answers a turn that was joined to another (a continue's held turn) as a fact: status 409 and \`{ "joined": { "turn", "joined" } }\`, naming the turn it joined, which is the one to ask for; a page follows it, and it is never a failure of the server. A route marked as a tunnel carries the previous build's messages as that build wrote them, until the pages that send them have routes of their own. A refusal is \`{ "error": "<why>" }\` on every route but the provider endpoint's, which answers as OpenAI does.

A route that pages takes \`limit\` and \`cursor\` in its query and answers \`{ items, next }\`: \`next\` is where the next page starts, given back as \`cursor\`, and null at the end. A cursor names the place after the last item a page gave, by that item's place in the list's own order, never by a count of items, so a walk over a list that changes between its pages neither repeats nor skips an item that stayed. A route refuses with 400 a cursor it did not give for that list: another route's, another list's, one changed, or one given before RPE last started.
`;

/** The live socket's own messages: how a page opens it and gives its token, what it sends and is sent, and how RPE closes it. */
function socketSection(s: LiveSocketDeclaration, names: Names): string[] {
  return [
    "## The live socket's messages",
    "",
    `A page opens \`${s.path}\` as a WebSocket, offering the protocol \`${s.protocol}\`. A page that cannot set the Authorization header offers its token as a second protocol: \`${s.tokenProtocolPrefix}\` and then the token. Every message, either way, is JSON. Besides chats, a page follows \`${s.names.jobs}\` (the user's jobs, in every chat and in none), \`${s.names.user}\` (what concerns the user and no one chat) and \`${s.names.addressPrefix}\` with an address RPE gave its caller.`,
    "",
    "| | |",
    "|---|---|",
    `| A page sends | ${typeCell(s.asks, names)} |`,
    `| A page is sent | ${typeCell(s.answers, names)} |`,
    `| A chat's events, as the relay hands them on | ${typeCell(s.batch, names)} |`,
    `| Closed | with the code ${s.tokenEnded.code} and the reason "${s.tokenEnded.reason}", once the token it opened with has run out or been replaced |`,
    "",
  ];
}

/** The API reference: each route under its §4.4 group, then the live socket's kinds and messages, then every named type. */
export function renderReference(table: Table): string {
  const names = new Names();
  const { json, raw } = entries(table);
  const sections: string[] = [];
  const groups = ROUTE_GROUPS.filter((g) => json.some((e) => e.group === g) || raw.some((e) => e.group === g));
  for (const group of groups) {
    const lines = [`## ${HEADINGS[group]}`, ""];
    const inGroup = [...json.filter((e) => e.group === group), ...raw.filter((e) => e.group === group)].sort((a, b) => byPath(a.info, b.info));
    for (const e of inGroup) {
      lines.push(`### \`${routeKey(e.info)}\``, "", e.does, "", "| | |", "|---|---|", `| Access | ${e.info.access}: ${ACCESS_WORDS[e.info.access]} |`, `| Body limit | ${bodyLimit(e.info, table)} |`, `| Params | ${paramsCell(e.info)} |`);
      if ("answers" in e) lines.push(`| Answers | ${e.answers} |`);
      else lines.push(`| Query | ${queryCell(e, names)} |`, `| Body | ${e.body === null ? "none" : typeCell(e.body, names)} |`, `| Reply | ${e.reply.kind === "nothing" ? "nothing (204)" : typeCell(e.reply, names)}${e.paged ? ", a page at a time" : ""} |`);
      if ("long" in e && e.long) lines.push(`| Long | over TCP it answers at once, status ${ANSWER_STATUS}, with \`{ answer: <id> }\`, and its reply is read from \`GET ${ANSWERS_PATH}/:id\` once ready |`);
      if (e.joined) lines.push(`| Also answers | status ${JOINED_STATUS}, ${typeCell(joinedAnswer, names)}: the turn is joined to another, and the turn it joined is the one to ask for |`);
      lines.push("");
    }
    sections.push(lines.join("\n"));
  }
  const kinds = ["## The live socket's kinds", "", "What a page following a chat on `/api/v1/live` is sent: each event is `{ chat, seq, kind, key?, at, data }`, numbered from 1 per chat, and `data` is what its kind carries.", "", "| Kind | Carries | What it says |", "|---|---|---|"];
  for (const [kind, k] of Object.entries(table.kinds)) kinds.push(`| \`${kind}\` | ${typeCell(k.data, names)} | ${k.does}${k.key === undefined ? "" : ` A newer one replaces one a page has not taken yet.`} |`);
  sections.push(kinds.join("\n"), "", socketSection(table.socket, names).join("\n"));
  const types = ["## Types", "", "Every type a route, a live kind or the live socket's messages name, as the generated types write it. `JsonValue` is any JSON value.", ""];
  for (const n of names.all()) types.push(`### \`${n.name}\``, "", n.doc, "", "```ts", n.text, "```", "");
  for (const c of names.carried()) types.push(`### \`${c.name}\``, "", c.doc, "", `Carried as the previous build wrote it: the type \`${c.name}\` of \`src/shared/${c.from.replace(/^\.\.\//, "")}.ts\`.`, "");
  const contents = ["## Contents", "", ...groups.map((g) => `- [${HEADINGS[g]}](#${slug(HEADINGS[g])})`), "- [The live socket's kinds](#the-live-sockets-kinds)", "- [The live socket's messages](#the-live-sockets-messages)", "- [Types](#types)", ""];
  return [REFERENCE_HEAD, contents.join("\n"), ...sections, types.join("\n")].join("\n");
}
