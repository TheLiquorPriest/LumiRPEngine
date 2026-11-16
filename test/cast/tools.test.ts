import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalAnswer, ApprovalAsk, HostTool, JsonObject, LanePermission, ToolResult } from "rp-harness/contract";
import { castTools, type CastDeps } from "../../src/cast/index";
import { charactersOf, pinCasting } from "../../src/cast/record";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import { CHAT, openTable, type Table, USER } from "./rig";

const patterns = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "cast-answers.md"), "utf8"), "cast-answers.md").patterns();

function texts(r: ToolResult): string[] {
  return r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Every sentence of an answer is a line of the answers' file: none is written in code. */
function wordsFromFiles(r: ToolResult): void {
  for (const text of texts(r)) if (!isJson(text)) expect({ text, fromFile: patterns.some((p) => p.test(text)) }).toEqual({ text, fromFile: true });
  for (const rep of r.reports ?? []) expect({ rep, fromFile: patterns.some((p) => p.test(rep)) }).toEqual({ rep, fromFile: true });
}

function dataOf(r: ToolResult): JsonObject {
  const found = texts(r).find(isJson);
  if (found === undefined) throw new Error(`no data in ${JSON.stringify(r.content)}`);
  return JSON.parse(found) as JsonObject;
}

const ops = (r: ToolResult): JsonObject[] => dataOf(r).operations as JsonObject[];

interface Bench {
  t: Table;
  tools: Map<string, HostTool>;
  call(name: string, args: JsonObject, turn?: string | null): Promise<ToolResult>;
}

async function bench(more: Partial<CastDeps> = {}): Promise<Bench> {
  const t = await openTable();
  t.shelf.put("card", "card-bram", "Bram Holloway", "c1");
  t.shelf.put("entry", "e-112", "The Gilded Hart", "r1");
  const deps: CastDeps = { store: t.store, writes: t.writes, files: shippedTexts(), sources: t.shelf.reader, now: () => 7, ...more };
  const tools = new Map((await castTools(deps)).map((x) => [x.name, x]));
  const call = async (name: string, args: JsonObject, turn: string | null = null): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const scope = { user: USER, chat: CHAT, session: "s-1", ...(turn !== null ? { turn } : {}) };
    return tool.run(args, { scope, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined });
  };
  return { t, tools, call };
}

/** An approvals port as the user set it, with every question it was asked and every lane it was asked about kept. */
function approvals(permission: LanePermission, answer: ApprovalAnswer = { go: true }): { port: { permission(scope: unknown, lane: string): Promise<LanePermission>; ask(scope: unknown, ask: ApprovalAsk): Promise<ApprovalAnswer> }; asked: ApprovalAsk[]; lanes: string[] } {
  const asked: ApprovalAsk[] = [];
  const lanes: string[] = [];
  return {
    asked,
    lanes,
    port: {
      permission: async (_scope, lane) => {
        lanes.push(lane);
        return permission;
      },
      ask: async (_scope, ask) => {
        asked.push(ask);
        return answer;
      },
    },
  };
}

/** A new character's record in one call, in the casting skill's order: sources, base, then the casting; its history linked to a beat the story holds. */
const makeBram = (beat = ""): JsonObject => ({
  operations: [
    { op: "bind", who: "Bram", card: "card-bram" },
    { op: "bind", who: "Bram", entry: "e-112", defines: "background" },
    { op: "base", who: "Bram", seed: "An innkeeper who keeps his head down.", soul: "Wants a quiet life; will not lie to a guest.", inner_voice: "Counts things when nervous.", background: "Born in the inn's cellar." },
    { op: "cast", who: "Bram", as: "supporting", line: "The innkeeper of the Gilded Hart.", why: "The letter thread hangs on him." },
    { op: "growth", who: "Bram", text: "No longer trusts a sealed letter.", cause: "The forged seal." },
    { op: "history", who: "Bram", text: "Handed Wren the sealed letter and would not meet her eye.", beats: [beat] },
    { op: "relationship", who: "Bram", with: "Wren", text: "She pays on time. I would not cross her.", trust: 40, fear: 10 },
    { op: "knowledge", who: "Bram", text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter." },
  ],
});

describe("cast_update", () => {
  test("writes many operations in one call, a character it casts known to all of them, and answers what each wrote and how that part now stands", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const beat = await b.t.beat(turn, "The letter changes hands.", "that evening");
    const r = await b.call("cast_update", makeBram(beat), turn.id);
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    const [card, entry, base, cast, growth, history, rel, know] = ops(r);
    const bram = charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "";
    expect(bram).toMatch(/^c-\d+$/);
    for (const o of ops(r)) expect(o.who).toEqual({ id: bram, name: "Bram" });
    // Each answer says how that part stands once the whole call is written.
    expect(card?.wrote).toEqual({ card: "card-bram" });
    expect(entry?.wrote).toEqual({ entry: "e-112", defines: "background" });
    for (const bound of [card, entry]) {
      expect(bound?.now).toEqual([
        { kind: "card", id: "card-bram", title: "Bram Holloway" },
        { kind: "entry", id: "e-112", defines: "background", title: "The Gilded Hart" },
      ]);
    }
    expect(base?.now).toEqual({
      seed: { text: "An innkeeper who keeps his head down.", version: 1 },
      soul: { text: "Wants a quiet life; will not lie to a guest.", version: 1 },
      inner_voice: { text: "Counts things when nervous.", version: 1 },
      background: { text: "Born in the inn's cellar.", version: 1 },
      growth: [{ text: "No longer trusts a sealed letter.", cause: "The forged seal.", date: "Sat 1 Mar 2031, 8:00 AM" }],
    });
    expect(cast?.now).toEqual({ as: "supporting", line: "The innkeeper of the Gilded Hart." });
    expect(growth?.id).toMatch(/^g-[0-9a-f]+$/);
    expect(growth?.now).toMatchObject({ text: "No longer trusts a sealed letter.", cause: "The forged seal.", since: null, touched: null });
    expect(history?.now).toMatchObject({ text: "Handed Wren the sealed letter and would not meet her eye.", beats: [beat] });
    expect(rel?.now).toMatchObject({ with: "Wren", text: "She pays on time. I would not cross her.", trust: 40, fear: 10 });
    expect(know?.now).toMatchObject({ text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter." });
    // Each source was read from Lumiverse once for the whole call.
    expect(b.t.shelf.reads.filter((x) => x === "entry:e-112")).toHaveLength(1);

    // Every part reads back through cast_query, once the reply is tied.
    await b.t.tie(turn);
    const q = dataOf(await b.call("cast_query", { who: "bram" }));
    expect(q.character).toEqual({ id: bram, name: "Bram", casting: { as: "supporting", line: "The innkeeper of the Gilded Hart." } });
    expect(q.sources).toEqual(entry?.now ?? null);
    expect(q.base).toEqual(base?.now ?? null);
    expect(q.growth).toEqual([expect.objectContaining({ text: "No longer trusts a sealed letter.", since: 1, touched: 1 })]);
    expect(q.mind).toEqual([]);
    expect(q.relationships).toEqual([expect.objectContaining({ with: "Wren", trust: 40 })]);
    expect(q.knowledge).toEqual([expect.objectContaining({ how: "He saw it on the letter." })]);
    expect(q.history).toEqual([expect.objectContaining({ beats: [beat] })]);
  });

  test("anything it cannot read refuses the whole call, and nothing is written", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    const r = await b.call(
      "cast_update",
      {
        operations: [
          { op: "knowledge", who: "Bram", text: "The cellar floods in spring." },
          { op: "befriend", who: "Bram" },
          { op: "relationship", who: "Hale", with: "Wren", text: "Owes her." },
          { op: "bind", who: "Bram", entry: "e-404" },
          { op: "relationship", who: "Bram", with: "Wren", trust: 400 },
          { op: "growth", who: "Bram", id: "g-999", cause: "Nothing." },
          { op: "cast", who: "Bram", as: "lead" },
        ],
      },
      turn.id,
    );
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    const said = texts(r).join("\n");
    // A name the cast does not hold is no reason to refuse; the rest is.
    for (const part of ["Operation 2: op cannot be read", "Lumiverse holds no entry e-404", "trust runs from -100 to 100", "has no growth \"g-999\"", "Operation 7 (cast): as \"lead\" is not one of what a as can hold: extra, principal, supporting", "Nothing was written"]) expect(said).toContain(part);
    expect(said).not.toContain("Hale");
    expect(b.t.record(turn).of(charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "", "knowledge")).toEqual([]);
    expect(charactersOf(b.t.db, USER, [CHAT]).map((c) => c.name)).toEqual(["Bram"]);

    // A call with no turn is recorded as changes of no turn, the chat's own: it binds, draws and writes growth alike.
    const outside = await b.call("cast_update", { operations: [{ op: "base", who: "Bram", seed: "An innkeeper." }, { op: "growth", who: "Bram", text: "Grew bolder." }] });
    expect(outside.error).toBeUndefined();
    expect(ops(outside)[0]?.now).toMatchObject({ seed: { text: "An innkeeper.", version: 1 } });
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "growth" }, null)).growth).toEqual([expect.objectContaining({ text: "Grew bolder." })]);
  });

  test("a relationship and a piece of knowledge it writes in a turn are gone after that turn is swiped, and back when the swipe is shown again", async () => {
    const b = await bench();
    await b.t.play();
    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, first.id);
    await b.t.tie(first);
    const played = await b.t.begin();
    await b.call(
      "cast_update",
      {
        operations: [
          { op: "relationship", who: "Bram", with: "Wren", text: "I owe her my life now.", warmth: 70 },
          { op: "knowledge", who: "Bram", text: "Wren can pick a lock.", how: "Watched her open the cellar." },
        ],
      },
      played.id,
    );
    await b.t.tie(played);
    const read = async () => dataOf(await b.call("cast_query", { who: "Bram" }));
    expect((await read()).relationships).toEqual([expect.objectContaining({ with: "Wren", warmth: 70 })]);

    const again = await b.t.swipe();
    await b.t.tie(again, "another reply");
    const swiped = await read();
    expect(swiped.relationships).toEqual([]);
    expect(swiped.knowledge).toEqual([]);
    expect(swiped.character).toMatchObject({ casting: { as: "principal" } });

    await b.t.showSwipe(played);
    const back = await read();
    expect(back.relationships).toEqual([expect.objectContaining({ text: "I owe her my life now.", warmth: 70 })]);
    expect(back.knowledge).toEqual([expect.objectContaining({ text: "Wren can pick a lock." })]);
  });

  test("the tool asks the user nothing and reads no permission: the harness's gate holds the story lane before the call, once", async () => {
    // Handed an approvals port anyway (as a host might), under Confirm with a no, and under Never.
    for (const permission of ["confirm", "never"] as const) {
      const user = approvals(permission, { go: false, reason: "Not yet." });
      const b = await bench({ ...({ approvals: user.port } as object) });
      const turn = await b.t.begin();
      const r = await b.call("cast_update", makeBram(), turn.id);
      wordsFromFiles(r);
      expect(r.error).toBeUndefined();
      expect(user.asked).toEqual([]);
      expect(user.lanes).toEqual([]);
      expect(charactersOf(b.t.db, USER, [CHAT]).map((x) => x.name)).toEqual(["Bram"]);
    }
  });

  test("a casting the player pinned stands: the Author's is kept, and the answer says the pin stands", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "supporting" }] }, turn.id);
    const bram = charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "";
    await b.t.writes.run((db) => pinCasting(db, USER, bram, "supporting"));
    const r = await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    wordsFromFiles(r);
    expect(ops(r)[0]?.now).toEqual({ as: "supporting", pinned: true });
    expect(r.reports).toEqual(["Operation 1 (cast): the player pinned Bram as supporting, and that stands. Your casting is kept for when the pin is taken away."]);
    expect(b.t.record(turn).castingOf(bram)?.as).toBe("principal");
  });
});

describe("cast_query", () => {
  test("lists who is cast on the path; reads a part by who it is toward and by words, a page at a time; every version with history", async () => {
    const b = await bench({ settings: { queryItems: 2 } });
    const turn = await b.t.begin();
    expect(texts(await b.call("cast_query", {}, turn.id))).toEqual(["No one is cast on this path yet."]);
    await b.call("cast_update", makeBram(), turn.id);
    await b.call(
      "cast_update",
      {
        operations: [
          { op: "cast", who: "Hale", as: "extra", line: "The toll keeper." },
          { op: "relationship", who: "Bram", with: "Hale", text: "A cheat with a badge." },
          { op: "knowledge", who: "Bram", text: "Hale takes a cut of every toll." },
          { op: "knowledge", who: "Bram", text: "The toll is two silver." },
          { op: "base", who: "Bram", seed: "An innkeeper who has stopped keeping his head down." },
        ],
      },
      turn.id,
    );
    const list = dataOf(await b.call("cast_query", {}, turn.id));
    expect(list.cast).toEqual([
      expect.objectContaining({ name: "Bram", casting: "supporting", line: "The innkeeper of the Gilded Hart." }),
      expect.objectContaining({ name: "Hale", casting: "extra", line: "The toll keeper." }),
    ]);

    const toward = dataOf(await b.call("cast_query", { who: "Bram", part: "relationships", with: "hale" }, turn.id));
    expect(Object.keys(toward)).toEqual(["character", "relationships"]);
    expect(toward.relationships).toEqual([expect.objectContaining({ with: "Hale", text: "A cheat with a badge." })]);
    const byWords = dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge", words: "TOLL silver" }, turn.id));
    expect(byWords.knowledge).toEqual([expect.objectContaining({ text: "The toll is two silver." })]);

    const page = await b.call("cast_query", { who: "Bram", part: "knowledge" }, turn.id);
    wordsFromFiles(page);
    expect((dataOf(page).knowledge as JsonObject[]).map((k) => k.text)).toEqual(["The reeve's seal has a chipped corner.", "Hale takes a cut of every toll."]);
    expect(texts(page).at(-1)).toBe("1 more in knowledge. Ask again with skip 2 to see them.");
    const next = dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge", skip: 2 }, turn.id));
    expect((next.knowledge as JsonObject[]).map((k) => k.text)).toEqual(["The toll is two silver."]);

    const versions = dataOf(await b.call("cast_query", { who: "Bram", part: "base", history: true }, turn.id));
    expect((versions.base as JsonObject).seed).toEqual([
      { version: 1, text: "An innkeeper who keeps his head down.", by: "author" },
      { version: 2, text: "An innkeeper who has stopped keeping his head down.", by: "author" },
    ]);

    const unknown = await b.call("cast_query", { who: "Odile" }, turn.id);
    expect(unknown.error).toBe(true);
    expect(texts(unknown)).toEqual(["There is no Odile in the cast; the nearest names are Hale, Bram."]);
  });
});

describe("cast_update answers as the engine's tools do", () => {
  test("a binding that is not there is already so; a source Lumiverse lacks, a history id and a beat that are not there come back with the nearest; a word outside a list comes back with the list and where to write it", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const beat = await b.t.beat(turn, "The letter changes hands.", "that evening");
    await b.call("cast_update", makeBram(beat), turn.id);

    const ok = await b.call(
      "cast_update",
      {
        operations: [
          { op: "bind", who: "Bram", card: "card-wren", drop: true },
          { op: "history", who: "Bram", text: "Kept the cellar key.", beats: [beat.toUpperCase(), "b-404"] },
          { op: "relationship", who: "Bram", with: "Wren", text: "Warm.", affection: 70 },
        ],
      },
      turn.id,
    );
    expect(ok.error).toBeUndefined();
    wordsFromFiles(ok);
    const said = (ok.reports ?? []).join("\n");
    expect(said).toContain("Bram has no card card-wren bound, which was already so; nothing changed.");
    expect(said).toContain("the story holds no beat b-404, so it is not linked; the nearest beats are");
    expect(said).toContain('dimension "affection" is not one of what a dimension can hold:');
    expect(said).toContain("write it in text");
    const history = ops(ok)[1]?.now as JsonObject;
    expect(history.beats).toEqual([beat]);

    const refused = await b.call("cast_update", { operations: [{ op: "bind", who: "Bram", entry: "e-11" }, { op: "history", who: "Bram", id: "h-9", text: "x" }, { op: "cast", who: "Bram", as: "lead" }] }, turn.id);
    expect(refused.error).toBe(true);
    wordsFromFiles(refused);
    const why = texts(refused).join("\n");
    expect(why).toContain("Lumiverse holds no entry e-11. The nearest entry ids bound in this chat: e-112.");
    expect(why).toContain("The nearest Bram has: h-");
    expect(why).toContain("as \"lead\" is not one of what a as can hold: extra, principal, supporting. Whatever you meant by it, write it in line");

    const glimpsed = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "glimpsed" }] }, turn.id);
    expect(glimpsed.error).toBe(true);
    expect(texts(glimpsed).join("\n")).toContain('reach "glimpsed" is not one of what a reach can hold: none, part, told, whole. Whatever you meant by it, write it in content');
  });

  test("a throw in a cast tool is answered as a fault, logged and kept in the call's details, never left bare", async () => {
    const b = await bench({ sources: () => Promise.reject(new Error("the shelf broke")) });
    const failed: unknown[] = [];
    b.t.store.env.failed = (f) => void failed.push(f);
    const turn = await b.t.begin();
    const r = await b.call("cast_update", { operations: [{ op: "bind", who: "Bram", card: "card-bram" }] }, turn.id);
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    expect(texts(r)).toEqual(["cast_update failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded."]);
    expect(((r.details as JsonObject).fault as JsonObject).error).toBe("the shelf broke");
    expect(failed).toHaveLength(1);
  });

  test("knowledge about a quest, or one of its stages by its ref or its label, is kept by the ref", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "He knows who carries it.", about: ["The sealed letter", "errand/Delivered", "quest:errand/asked", "errand/lost"] }] }, turn.id);
    expect(r.error).toBeUndefined();
    expect((ops(r)[0]?.now as JsonObject).about_refs).toEqual(["quest:errand", "quest:errand/done", "quest:errand/asked"]);
    expect((r.reports ?? []).join("\n")).toContain("errand/lost names nothing in the world; the nearest are Asked, Delivered");
  });
});
