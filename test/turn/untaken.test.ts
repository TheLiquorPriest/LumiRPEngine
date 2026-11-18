import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { insertPageToken } from "../../src/app/auth";
import type { AnyShape, FieldShape, RouteInfo } from "../../src/app";
import { CHARACTER, openTurnBed, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** Two chats Lumiverse holds alike: RPE takes one on and never touches it, and never takes the other on. */
const UNTAKEN = "chat-quay";
const TAKEN = "chat-attic";

/** A value each required query field takes, so that the route's own code answers and not the form. */
function queryOf(info: RouteInfo): string {
  if (!("query" in info.declared)) return "";
  const asked = new URLSearchParams();
  for (const [name, f] of Object.entries(info.declared.query)) {
    const field = f as AnyShape | FieldShape;
    if (field.kind === "field" && field.optional) continue;
    const s = field.kind === "field" ? field.of : field;
    asked.set(name, s.kind === "oneOf" ? s.values[0]! : s.kind === "number" ? "1" : s.kind === "yesNo" ? "true" : s.kind === "literal" ? String(s.value) : "none");
  }
  const text = asked.toString();
  return text === "" ? "" : `?${text}`;
}

test("a read of a chat RPE does not hold answers as an untouched chat reads, and makes nothing: no row, no folder, no line of it anywhere", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  for (const id of [UNTAKEN, TAKEN]) b.host.addChat({ id, user: USER, name: "The quay", character: CHARACTER, messages: [{ id: `m-${id}`, role: "assistant", content: "The tide is out." }] });
  await b.turns.take(USER, TAKEN);
  const { token } = await b.app.writes.run((db) => insertPageToken(db, USER, "extension", 60_000, Date.now()));

  const ask = async (info: RouteInfo, chat: string): Promise<{ status: number; body: string }> => {
    const path = info.path
      .split("/")
      .map((s) => (s === ":chat" ? chat : s === "*" ? "none.md" : s.startsWith(":") ? "none" : s))
      .join("/");
    const sends = info.method !== "GET" && info.method !== "DELETE" && "body" in info.declared && info.declared.body !== null;
    const res = await fetch(`${b.listening.url}${path}${queryOf(info)}`, {
      method: info.method,
      headers: { authorization: `Bearer ${token}`, ...(sends ? { "content-type": "application/json" } : {}) },
      ...(sends ? { body: "{}" } : {}),
    });
    // An untouched chat's seed is its own: the one RPE draws when it takes the chat on, and the chat's id where it holds none.
    return { status: res.status, body: (await res.text()).replaceAll(chat, "<chat>").replace(/"seed":"[^"]*"/g, '"seed":"…"') };
  };

  const reads = b.app.routes.list().filter((r) => r.path.startsWith("/api/v1/chats/:chat/") && !r.takesChat && !r.raw);
  expect(reads.length).toBeGreaterThan(0);
  const differs: unknown[] = [];
  for (const info of reads) {
    const untaken = await ask(info, UNTAKEN);
    const taken = await ask(info, TAKEN);
    if (untaken.status === taken.status && untaken.body === taken.body) continue;
    // Where the two answers part, with a little of each around it.
    let at = 0;
    while (at < untaken.body.length && untaken.body[at] === taken.body[at]) at++;
    const near = (text: string): string => text.slice(Math.max(0, at - 80), at + 120);
    differs.push({ route: `${info.method} ${info.path}`, untaken: { status: untaken.status, near: near(untaken.body) }, taken: { status: taken.status, near: near(taken.body) } });
  }
  expect(differs).toEqual([]);

  // Nothing of it was made: no row, no folder, and its id in no row of RPE's database.
  expect(b.turns.store.user(USER).chat(UNTAKEN)).toBeNull();
  expect(b.turns.chats.folders(USER, UNTAKEN)).toBeNull();
  const tables = b.app.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const holding = tables.filter(({ name }) => {
    const columns = b.app.db.query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${name}')`).all();
    return columns.some((c) => b.app.db.query(`SELECT 1 FROM "${name}" WHERE CAST("${c.name}" AS TEXT) LIKE ? LIMIT 1`).get(`%${UNTAKEN}%`) !== null);
  });
  expect(holding.map((t) => t.name)).toEqual([]);
  expect((await readdir(b.app.paths.root, { recursive: true })).filter((p) => p.includes(UNTAKEN))).toEqual([]);
});
