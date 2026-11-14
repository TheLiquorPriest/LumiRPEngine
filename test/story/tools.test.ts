import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalAnswer, ApprovalAsk, HostTool, JsonObject, LanePermission, ToolResult } from "rp-harness/contract";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import { type LoreOverlay, type StoryDeps, storyTools, STORY_TOOLS } from "../../src/story/index";
import { storyClock } from "../../src/story/kit";
import { CHAT, openTable, type Table, type TableOptions, USER } from "./rig";
import { settingClock } from "../../src/store/blank";
import { engine, tick } from "../store/fixtures";

const patterns = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "story-answers.md"), "utf8"), "story-answers.md").patterns();

function texts(r: ToolResult): string[] {
  return r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
}

/** Every sentence of an answer is a line of the answers' file: none is written in code. */
function wordsFromFiles(r: ToolResult): void {
  for (const text of texts(r)) {
    let json = false;
    try {
      JSON.parse(text);
      json = true;
    } catch {
      json = false;
    }
    if (!json) expect({ text, fromFile: patterns.some((p) => p.test(text)) }).toEqual({ text, fromFile: true });
  }
  for (const rep of r.reports ?? []) expect({ rep, fromFile: patterns.some((p) => p.test(rep)) }).toEqual({ rep, fromFile: true });
}

function dataOf(r: ToolResult): JsonObject {
  for (const text of texts(r)) {
    try {
      const v = JSON.parse(text) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as JsonObject;
    } catch {
      // A line, not data.
    }
  }
  throw new Error(`no data in ${JSON.stringify(r.content)}`);
}

const ops = (r: ToolResult): JsonObject[] => dataOf(r).operations as JsonObject[];

interface Bench {
  t: Table;
  tools: Map<string, HostTool>;
  call(name: string, args: JsonObject, turn?: string | null): Promise<ToolResult>;
}

async function bench(more: Partial<StoryDeps> = {}, table: TableOptions = {}): Promise<Bench> {
  const t = await openTable(table);
  const deps: StoryDeps = { store: t.store, writes: t.writes, files: shippedTexts(), now: () => 7, ...more };
  const tools = new Map((await storyTools(deps)).map((x) => [x.name, x]));
  const call = async (name: string, args: JsonObject, turn: string | null = null): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const scope = { user: USER, chat: CHAT, session: "s-1", ...(turn !== null ? { turn } : {}) };
    return tool.run(args, { scope, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined });
  };
  return { t, tools, call };
}

/** Approvals as the user set them, with every question asked and every lane whose permission was read kept. */
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

describe("story_record", () => {
  test("records many operations in one call and answers what each wrote and how its item now stands", async () => {
    const b = await bench();
    await b.t.play();
    const turn = await b.t.begin();
    const r = await b.call(
      "story_record",
      {
        operations: [
          { op: "scene", new: true, title: "The toll bridge", who: ["Wren", "Hale"], tension: "Hale wants double." },
          { op: "beat", text: "Hale names his price: two silver.", who: ["Hale"] },
          { op: "thread", text: "Who pays Hale's wages?", kind: "question", hot: true },
          { op: "scene", wants: "Wren wants across; Hale wants coin." },
          { op: "record", intent: "An action: Wren haggles.", decided: "Hale holds firm.", why: "He is owed." },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    const [scene, beat, thread, again, record] = ops(r);
    expect(scene?.id).toMatch(/^sc-\d+$/);
    // The later scene operation, naming no id, wrote to the scene the first one opened.
    expect(again?.id).toBe(scene?.id ?? "");
    expect(again?.now).toMatchObject({ title: "The toll bridge", who: ["Wren", "Hale"], tension: "Hale wants double.", wants: "Wren wants across; Hale wants coin.", from: 2, to: 2, touched: null });
    expect(beat?.wrote).toEqual({ text: "Hale names his price: two silver.", who: ["Hale"] });
    expect(beat?.now).toMatchObject({ text: "Hale names his price: two silver.", message: null });
    expect(thread?.now).toMatchObject({ text: "Who pays Hale's wages?", kind: "question", hot: true });
    expect(record?.id).toBe(`rec:${turn.id}`);

    // All in the record, on this turn; the chat's head sees it once the reply is tied.
    const rows = b.t.record(turn).items.get(String(beat?.id));
    expect(rows?.rows.map((x) => [x.turn, x.by, x.agent])).toEqual([[turn.id, "author", "author-1"]]);
    await b.t.tie(turn);
    const head = b.t.record();
    const tied = head.items.get(String(beat?.id));
    expect(tied && head.beatAt(tied)).toBe(3);
  });

  test("anything it cannot read refuses the whole call, and nothing is recorded", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.call(
      "story_record",
      {
        operations: [
          { op: "beat", text: "The bell rings." },
          { op: "thread", id: "th-999", state: "Still open." },
          { op: "beat", text: "A gull lands.", message: 40 },
          { op: "future", text: "Rain.", due: "when the moon is green" },
          { op: "arc", who: ["Wren", "Hale"], stands: "Tired." },
          { op: "chapter", title: "Never opened" },
          { op: "sing" },
        ],
      },
      turn.id,
    );
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    const said = texts(r).join("\n");
    for (const n of [2, 3, 5, 6, 7]) expect(said).toContain(`Operation ${n}`);
    // A time no date can be counted from is kept as words, so the future is no trouble.
    expect(said).not.toContain("Operation 1 ");
    expect(said).not.toContain("Operation 4 ");
    expect(said).toContain("Nothing was recorded");
    expect(b.t.record(turn).items.size).toBe(0);
  });

  test("a beat, a thread touch and a scene's summary recorded in a turn are gone after that turn is swiped", async () => {
    const b = await bench();
    const first = await b.t.begin();
    const opened = ops(await b.call("story_record", { operations: [{ op: "scene", new: true, title: "The ferry" }, { op: "thread", text: "Will the ferryman take coin?" }] }, first.id));
    await b.t.tie(first);
    const thread = String(opened[1]?.id);
    const second = await b.t.begin();
    await b.call("story_record", { operations: [{ op: "beat", text: "He bites the coin." }, { op: "thread", id: thread, state: "He took it." }, { op: "scene", summary: "Wren crosses for one silver.", close: true }] }, second.id);
    await b.t.tie(second);
    expect(dataOf(await b.call("story_query", { part: "beat" }))).toHaveProperty("beat");

    const swiped = await b.t.swipe();
    await b.t.tie(swiped, "another reply");
    expect(texts(await b.call("story_query", { part: "beat" }))).toEqual(["Nothing in the story record matches."]);
    const now = dataOf(await b.call("story_query", { id: thread, history: true }));
    expect(now.thread).toEqual([expect.objectContaining({ text: "Will the ferryman take coin?", history: [expect.objectContaining({ wrote: { text: "Will the ferryman take coin?" } })] })]);
    expect((now.thread as JsonObject[])[0]).not.toHaveProperty("state");
    const scene = (dataOf(await b.call("story_query", { part: "scene" })).scene as JsonObject[])[0];
    expect(scene).not.toHaveProperty("summary");
    expect(scene).not.toHaveProperty("closed");
  });

  test("the tool asks the user nothing and reads no permission: the harness's gate holds the story lane before the call, once", async () => {
    // Handed an approvals port anyway (as a host might), under Confirm with a no, and under Never.
    for (const permission of ["confirm", "never"] as const) {
      const user = approvals(permission, { go: false, reason: "Not yet." });
      const b = await bench({ ...({ approvals: user.port } as object) });
      // What the gate holds the call by: a write to the story lane.
      const tool = b.tools.get("story_record");
      expect([tool?.tier, tool?.lane]).toEqual(["write", "story"]);
      const turn = await b.t.begin();
      const r = await b.call("story_record", { operations: [{ op: "beat", text: "The lamp gutters." }] }, turn.id);
      wordsFromFiles(r);
      expect(r.error).toBeUndefined();
      expect(user.asked).toEqual([]);
      expect(user.lanes).toEqual([]);
      expect(b.t.record(turn).of("beat").map((x) => x.fields.text)).toEqual(["The lamp gutters."]);
    }
  });

  test("a scene operation that names no scene, when the current scene is closed, is refused and the closed scene is left as it was", async () => {
    const b = await bench();
    const first = await b.t.begin();
    const ford = String(ops(await b.call("story_record", { operations: [{ op: "scene", new: true, title: "The ford", who: ["Corvin"] }] }, first.id))[0]?.id);
    await b.t.tie(first);
    const second = await b.t.begin();
    await b.call("story_record", { operations: [{ op: "scene", summary: "Corvin is left at the ford.", close: true }] }, second.id);
    await b.t.tie(second);

    const third = await b.t.begin();
    const r = await b.call("story_record", { operations: [{ op: "beat", text: "The mill wheel creaks." }, { op: "scene", title: "The mill", who: ["Mira"] }] }, third.id);
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    const said = texts(r).join("\n");
    expect(said).toContain(`Operation 2 (scene): the current scene, ${ford}, is closed.`);
    expect(said).toContain("Nothing was recorded");
    const record = b.t.record(third);
    expect(record.of("beat")).toEqual([]);
    expect(record.items.get(ford)?.fields).toEqual({ title: "The ford", who: ["Corvin"], summary: "Corvin is left at the ford." });

    // Named by its id, the closed scene can still be written to; opened with new, a scene is new.
    const named = await b.call("story_record", { operations: [{ op: "scene", id: ford, summary: "Corvin waits at the ford." }, { op: "scene", new: true, title: "The mill" }] }, third.id);
    expect(named.error).toBeUndefined();
    expect(ops(named).map((o) => o.id)).toEqual([ford, expect.not.stringMatching(ford)]);
  });

  test("an overlay is the lore lane's write, made in the same write; an entry it does not know refuses the whole call", async () => {
    const written: JsonObject[] = [];
    const overlay: LoreOverlay = (db, input) => {
      if (input.entry !== "e-112") return { unknown: input.entry, near: ["e-112"] };
      written.push({ ...input, inWrite: db.query<{ query_only: number }, []>("PRAGMA query_only").get()?.query_only === 0 });
      return { written: { overlay: "ov-1", entry: input.entry } };
    };
    const b = await bench({ overlay });
    const turn = await b.t.begin();
    const r = await b.call("story_record", { operations: [{ op: "beat", text: "The east wing burns." }, { op: "overlay", entry: "e-112", text: "The east wing burned on this turn." }] }, turn.id);
    wordsFromFiles(r);
    expect(ops(r)[1]).toEqual({ n: 2, op: "overlay", entry: "e-112", wrote: { text: "The east wing burned on this turn." }, written: { overlay: "ov-1", entry: "e-112" } });
    // The overlay is the writer's, as its rows are, and takes the place after the beat before it.
    expect(written).toEqual([{ user: USER, chat: CHAT, turn: turn.id, entry: "e-112", note: "The east wing burned on this turn.", by: "author", agent: "author-1", job: null, ord: 1, inWrite: true }]);

    const refused = await b.call("story_record", { operations: [{ op: "beat", text: "Smoke over the roofs." }, { op: "overlay", entry: "e-404", text: "Gone." }] }, turn.id);
    expect(refused.error).toBe(true);
    wordsFromFiles(refused);
    expect(texts(refused).join("\n")).toContain("there is no lore entry e-404. Near: e-112.");
    expect(b.t.record(turn).of("beat").map((x) => x.fields.text)).toEqual(["The east wing burns."]);

    const none = await bench();
    const t2 = await none.t.begin();
    const without = await none.call("story_record", { operations: [{ op: "overlay", entry: "e-112", text: "Burned." }, { op: "beat", text: "Ash falls." }] }, t2.id);
    wordsFromFiles(without);
    expect(texts(without).join("\n")).toContain("keeps no lore overlays yet");
    expect(none.t.record(t2).of("beat")).toHaveLength(1);
  });

  test("a future's due time is read in story time, as the engine reads one, and shown in it", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.call("story_record", { operations: [{ op: "future", text: "The reeve's man calls.", due: "2031-03-01 10:30", tier: 2, standing: "proposed" }, { op: "future", text: "The ice breaks.", due: "2031-03-01 07:00" }] }, turn.id);
    wordsFromFiles(r);
    const [later, past] = ops(r);
    expect(later?.now).toMatchObject({ due: "Sat 1 Mar 2031, 10:30 AM", tier: 2, standing: "proposed" });
    expect(r.reports).toEqual(["Operation 2 (future): it falls due at Sat 1 Mar 2031, 7:00 AM, which is not after now (Sat 1 Mar 2031, 8:00 AM), so it is due at once."]);
    expect(past?.now).toMatchObject({ due: "Sat 1 Mar 2031, 7:00 AM" });
  });

  test("a chat that started with no world keeps story time on the blank world it plays on: a due time is read and a future falls due, and no date is shown while play has not set the clock", async () => {
    const b = await bench({}, { world: false });
    const turn = await b.t.begin();
    const r = await b.call("story_record", { operations: [{ op: "future", text: "The reeve's man calls.", due: "two hours" }] }, turn.id);
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    const clock = storyClock(b.t.store, USER, CHAT, turn.id);
    if (clock === null) throw new Error("a chat with no world plays on the blank world, which keeps a clock");
    // Read and kept two hours from now; a date nobody set is shown to nobody.
    expect(b.t.record(turn).items.get(String(ops(r)[0]?.id))?.fields.due).toBe(clock.now + 120);
    expect(ops(r)[0]?.now).not.toHaveProperty("due");
    // One not after now falls due at once, and the answer says so with no time in it.
    const past = await b.call("story_record", { operations: [{ op: "future", text: "The bell has rung.", due: "2026-01-01 07:00" }] }, turn.id);
    wordsFromFiles(past);
    expect(past.reports).toEqual(["Operation 1 (future): it falls due no later than now, so it is due at once."]);

    await b.t.write(turn, [{ part: "future", item: null, value: { text: "The ice breaks.", due: clock.now - 30 } }]);
    await b.t.tie(turn);
    const due = dataOf(await b.call("story_query", { due: true }));
    expect((due.future as JsonObject[]).map((x) => x.text).sort()).toEqual(["The bell has rung.", "The ice breaks."]);
    expect(due).not.toHaveProperty("now");
    expect((due.future as JsonObject[]).some((f) => "due" in f)).toBe(false);
  });

  test("once play has set the clock to a date and time in a chat with no world, the story shows its times; a move alone shows none", async () => {
    const b = await bench({}, { world: false });
    const turn = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(tick(60))));
    const moved = await b.call("story_record", { operations: [{ op: "future", text: "The ferry leaves.", due: "two days" }] }, turn.id);
    expect(moved.error).toBeUndefined();
    expect(ops(moved)[0]?.now).not.toHaveProperty("due");
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(settingClock(tick(60)))));
    const r = await b.call("story_record", { operations: [{ op: "future", text: "The reeve's man calls.", due: "two hours" }] }, turn.id);
    expect(r.error).toBeUndefined();
    const clock = storyClock(b.t.store, USER, CHAT, turn.id);
    const shown = clock?.text(clock.now + 120);
    expect(shown).toEqual(expect.any(String));
    expect(ops(r)[0]?.now).toMatchObject({ due: shown });

    await b.t.write(turn, [{ part: "future", item: null, value: { text: "The ice breaks.", due: (clock?.now ?? 0) - 30 } }]);
    await b.t.tie(turn);
    const due = dataOf(await b.call("story_query", { due: true }));
    expect(due.now).toEqual(expect.any(String));
    expect((due.future as JsonObject[])[0]).toMatchObject({ text: "The ice breaks.", due: expect.any(String) });
  });

  test("writes every part, and story_query reads each back as it stands", async () => {
    const b = await bench();
    await b.t.play();
    const turn = await b.t.begin();
    const wrote = await b.call(
      "story_record",
      {
        operations: [
          { op: "premise", text: "A courier's last season.", tone: "Wry.", rules: "No magic.", role: "Wren, the courier; no romance." },
          { op: "chapter", new: true, title: "The thaw", place: "The Hollow Vale", from: 0 },
          { op: "scene", new: true, title: "The inn", who: ["Wren", "Bram"], purpose: "Deliver.", tension: "Bram stalls.", wants: "Bram wants time.", ends: "The letter is read." },
          { op: "beat", text: "Wren hands over the letter.", who: ["Wren", "Bram"], message: 1 },
          { op: "thread", text: "What is in the letter?", kind: "setup", stakes: "Bram's lease.", payoff: "An eviction.", hot: true },
          { op: "arc", who: ["Bram"], began: "Settled.", stands: "Cornered.", next: "Flight." },
          { op: "player", text: "Will not play cruelty to animals.", kind: "line" },
          { op: "future", text: "The landlord's agent calls.", due: "two days", tier: 4, standing: "established", who: ["Bram"] },
          { op: "canon", text: "The inn is called the Wet Hen.", message: 1 },
          { op: "record", intent: "An action: deliver.", decided: "Bram stalls.", why: "His arc.", rulings: "None.", consents: "None.", next: "Open the letter." },
        ],
      },
      turn.id,
    );
    expect(wrote.error).toBeUndefined();
    wordsFromFiles(wrote);
    const canon = String(ops(wrote)[8]?.id);
    await b.call("story_record", { operations: [{ op: "retcon", text: "The inn is the Dry Hen.", why: "The sign was misread.", of: canon }] }, turn.id);

    const all = dataOf(await b.call("story_query", {}, turn.id));
    expect(Object.keys(all)).toEqual(["premise", "chapter", "scene", "beat", "thread", "arc", "player", "future", "canon", "retcon", "record"]);
    const one = (part: string): JsonObject => (all[part] as JsonObject[])[0] as JsonObject;
    expect(one("premise")).toMatchObject({ id: "premise", text: "A courier's last season.", role: "Wren, the courier; no romance." });
    expect(one("chapter")).toMatchObject({ title: "The thaw", place: "The Hollow Vale", from: 0, to: 2 });
    expect(one("scene")).toMatchObject({ title: "The inn", who: ["Wren", "Bram"], from: 2, to: 2, ends: "The letter is read." });
    expect(one("beat")).toMatchObject({ text: "Wren hands over the letter.", message: 1 });
    expect(one("thread")).toMatchObject({ kind: "setup", payoff: "An eviction.", hot: true });
    expect(one("arc")).toMatchObject({ id: "arc:bram", who: "Bram", stands: "Cornered." });
    expect(one("player")).toMatchObject({ kind: "line", text: "Will not play cruelty to animals." });
    expect(one("future")).toMatchObject({ due: "Mon 3 Mar 2031, 8:00 AM", tier: 4, standing: "established", who: ["Bram"] });
    expect(one("canon")).toMatchObject({ text: "The inn is called the Wet Hen.", message: 1 });
    expect(one("retcon")).toMatchObject({ of: canon, why: "The sign was misread." });
    expect(one("record")).toMatchObject({ id: `rec:${turn.id}`, decided: "Bram stalls.", next: "Open the letter.", message: null });
  });

  test("writing needs a turn; reading does not", async () => {
    const b = await bench();
    await b.t.play([{ part: "beat", item: null, value: { text: "Wren arrives." } }]);
    const r = await b.call("story_record", { operations: [{ op: "beat", text: "Late." }] });
    expect(r.error).toBe(true);
    expect(texts(r)).toEqual(["This call belongs to no turn, so nothing can be recorded. Reading needs no turn."]);
    expect(dataOf(await b.call("story_query", { part: "beat" })).beat).toEqual([expect.objectContaining({ text: "Wren arrives.", message: 1, touched: 1 })]);
  });
});

describe("story_query", () => {
  test("finds any part by range, by who is involved, by what is open, hot or due", async () => {
    const b = await bench();
    const clock = await b.t.begin();
    await b.call(
      "story_record",
      {
        operations: [
          { op: "scene", new: true, title: "Market", who: ["Wren", "Hale"] },
          { op: "beat", text: "Wren sells the wool.", who: ["Wren"] },
          { op: "thread", text: "Who sent Hale?", who: ["Hale"], hot: true },
          { op: "thread", text: "The missing ledger.", who: ["Bram"] },
          { op: "future", text: "The fair opens.", due: "2031-03-01 06:00" },
          { op: "future", text: "The thaw.", due: "2031-04-01 06:00" },
        ],
      },
      clock.id,
    );
    await b.t.tie(clock);
    const later = await b.t.begin();
    const shut = ops(await b.call("story_record", { operations: [{ op: "beat", text: "Hale leaves.", who: ["Hale"] }, { op: "thread", text: "A closed matter.", close: true }] }, later.id));
    await b.t.tie(later);

    const titles = (r: ToolResult, part: string): unknown[] => ((dataOf(r)[part] ?? []) as JsonObject[]).map((x) => x.text ?? x.title);
    expect(titles(await b.call("story_query", { part: "beat", from: 2 }), "beat")).toEqual(["Hale leaves."]);
    expect(titles(await b.call("story_query", { part: "beat", to: 1 }), "beat")).toEqual(["Wren sells the wool."]);
    const hale = dataOf(await b.call("story_query", { who: "hale" }));
    expect(Object.keys(hale)).toEqual(["scene", "beat", "thread"]);
    expect(titles(await b.call("story_query", { part: "thread", open: true }), "thread")).toEqual(["Who sent Hale?", "The missing ledger."]);
    expect(titles(await b.call("story_query", { hot: true }), "thread")).toEqual(["Who sent Hale?"]);
    const due = dataOf(await b.call("story_query", { due: true }));
    expect((due.future as JsonObject[]).map((x) => x.text)).toEqual(["The fair opens."]);
    expect(due.now).toBe("Sat 1 Mar 2031, 8:00 AM");
    expect(dataOf(await b.call("story_query", { id: String(shut[1]?.id) })).thread).toEqual([expect.objectContaining({ text: "A closed matter.", closed: true, touched: 3 })]);
  });

  test("answers with at most the set number of items, and says how many more match", async () => {
    const b = await bench({ settings: { queryItems: 2 } });
    const turn = await b.t.begin();
    await b.call("story_record", { operations: [1, 2, 3, 4].map((n) => ({ op: "beat", text: `Beat ${n}.` })) }, turn.id);
    const r = await b.call("story_query", { part: "beat" }, turn.id);
    wordsFromFiles(r);
    expect((dataOf(r).beat as JsonObject[]).map((x) => x.text)).toEqual(["Beat 1.", "Beat 2."]);
    expect(texts(r).at(-1)).toMatch(/^2 more match\./);
  });
});

describe("the story tools' files", () => {
  test("each tool's description and every argument's text come from its file", async () => {
    const b = await bench();
    expect([...b.tools.keys()]).toEqual(STORY_TOOLS.map((s) => s.name));
    for (const spec of STORY_TOOLS) {
      const file = readFileSync(join(SHIPPED_GUIDANCE, ".tools", `${spec.name}.md`), "utf8");
      const tool = b.tools.get(spec.name);
      expect(file).toContain(tool?.description ?? "-");
      const walk = (schema: JsonObject, path: string): void => {
        expect({ path, described: typeof schema.description === "string" }).toEqual({ path, described: true });
        const props = (schema.items as JsonObject | undefined)?.properties ?? schema.properties;
        if (props && typeof props === "object" && !Array.isArray(props)) for (const [name, inner] of Object.entries(props)) walk(inner as JsonObject, `${path}.${name}`);
      };
      for (const [name, inner] of Object.entries((tool?.parameters.properties ?? {}) as Record<string, JsonObject>)) walk(inner, name);
    }
  });
});
