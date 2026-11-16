// `story_record` as the Author met it live: a scene sent with everything the scene skills name, in
// the shapes a model sends them, played as the harness plays a call (checked and coerced by pi, then
// run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { Lines, SHIPPED_GUIDANCE, shippedTexts } from "../../src/iface/texts";
import { storyTools } from "../../src/story/index";
import { asHarnessPasses, CHAT, openTable, type Table, USER } from "./rig";

const patterns = Lines.parse(readFileSync(join(SHIPPED_GUIDANCE, ".prompts", "story-answers.md"), "utf8"), "story-answers.md").patterns();

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

/** Every sentence of an answer and of its reports is a line of the answers' file: none is written in code. */
function wordsFromFiles(r: ToolResult): void {
  for (const text of [...texts(r).filter((x) => !isJson(x)), ...(r.reports ?? [])]) expect({ text, fromFile: patterns.some((p) => p.test(text)) }).toEqual({ text, fromFile: true });
}

interface Bench {
  t: Table;
  /** The Author's call on a turn, as the harness plays it. */
  play(args: JsonObject, turn: string): Promise<ToolResult>;
}

/** Two exchanges played (messages m0 to m3), so a scene can start at an earlier one. */
async function bench(): Promise<Bench> {
  const t = await openTable();
  await t.play();
  await t.play();
  const tool = (await storyTools({ store: t.store, writes: t.writes, files: shippedTexts(), overlay: () => ({ unknown: "no lore here" }), now: () => 7 })).find((x) => x.name === "story_record") as HostTool;
  const play = (args: JsonObject, turn: string): Promise<ToolResult> =>
    tool.run(asHarnessPasses(tool, args), { scope: { user: USER, chat: CHAT, session: "s-1", turn }, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: "call-1", signal: new AbortController().signal, onUpdate: () => undefined });
  return { t, play };
}

/** The scene as it was sent live: who wants what, person by person; the ways it could end, as a list; its first message by its id. */
const SCENE: JsonObject = {
  op: "scene",
  new: true,
  title: "The lamp room",
  place: "Gull Skerry light",
  time: "Dusk, the first night of the gale",
  who: ["Marta Venn", "Ida Pell"],
  purpose: "Ida learns why the light went dark.",
  tension: "Marta hides the keeper's log; Ida will not leave without it.",
  wants: { "Marta Venn": "to keep the log shut", "Ida Pell": "the truth about the dark night" },
  ends: ["the lamp is lit", "the gale cuts the causeway"],
  from: "m2",
};

describe("story_record, as the Author met it live", () => {
  test("the scene seen live, with its purpose, tension, wants and ends, is recorded in one call with the beat beside it", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play({ operations: [SCENE, { op: "beat", text: "Marta bolts the lamp room door behind them.", who: "Marta Venn" }] }, turn.id);
    expect(r.error).toBeUndefined();
    // The scene's place is words that name no place of the invented world: kept as written, tied to none, and said once.
    expect(r.reports ?? []).toEqual(["Operation 1 (scene): the place Gull Skerry light names no place of this world, so it is kept as the words you wrote and tied to none."]);
    wordsFromFiles(r);
    const record = b.t.record(turn);
    expect(record.of("scene").map((x) => x.fields)).toEqual([
      {
        title: "The lamp room",
        place: "Gull Skerry light",
        time: "Dusk, the first night of the gale",
        who: ["Marta Venn", "Ida Pell"],
        purpose: "Ida learns why the light went dark.",
        tension: "Marta hides the keeper's log; Ida will not leave without it.",
        wants: '{"Marta Venn":"to keep the log shut","Ida Pell":"the truth about the dark night"}',
        ends: '["the lamp is lit","the gale cuts the causeway"]',
        first: "m2",
      },
    ]);
    expect(record.of("beat").map((x) => x.fields)).toEqual([{ text: "Marta bolts the lamp room door behind them.", who: ["Marta Venn"] }]);
  });

  test("what an operation does not read is left out and named once, with what it reads; the rest is recorded", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play({ operations: [{ op: "scene", new: true, title: "The causeway", mood: "grim", stakes: "Her boat.", from: "m-41" }, { op: "beat", text: "The tide turns." }] }, turn.id);
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    expect(r.reports).toEqual([
      'Operation 1 (scene): from names no message: you sent "m-41", and the chat\'s messages are numbered 0 to 4.',
      "Operation 1 (scene) was recorded without mood, stakes, from. It reads id, new, title, place, time, who, purpose, tension, wants, ends, summary, from, to, close, drop, why.",
    ]);
    const record = b.t.record(turn);
    expect(record.of("scene").map((x) => x.fields)).toEqual([{ title: "The causeway" }]);
    expect(record.of("beat").map((x) => x.fields.text)).toEqual(["The tide turns."]);
  });

  test("an operation that cannot be read at all is answered in the file's words with what it reads, never with the call or the schema, and nothing is recorded", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play({ operations: [SCENE, { op: "thread", id: "th-999", state: "Still open.", mood: "uneasy" }, { op: "sing" }] }, turn.id);
    expect(r.error).toBe(true);
    wordsFromFiles(r);
    expect(texts(r)).toEqual([
      'Operation 2 (thread): the story record on this path holds no thread "th-999".',
      "thread reads id, text, kind, state, stakes, who, payoff, hot, close, drop, why, and a new one needs text. It does not read mood.",
      'Operation 3: op cannot be read, you sent "sing". It is one of: premise, chapter, scene, beat, thread, arc, player, future, canon, retcon, record, overlay.',
      "premise reads text, tone, rules, role.",
      "chapter reads id, new, title, place, time, summary, from, to, close, drop, why.",
      "scene reads id, new, title, place, time, who, purpose, tension, wants, ends, summary, from, to, close, drop, why.",
      "beat reads id, text, who, place, time, message, from, to, drop, why, and a new one needs text.",
      "thread reads id, text, kind, state, stakes, who, payoff, hot, close, drop, why, and a new one needs text.",
      "arc reads who, began, stands, next, drop, why, and needs who.",
      "player reads id, text, kind, drop, why, and a new one needs text.",
      "future reads id, text, tier, due, standing, who, place, close, drop, why, and a new one needs text.",
      "canon reads id, text, who, message, drop, why, and a new one needs text.",
      "retcon reads id, text, why, of, drop, and a new one needs text.",
      "record reads intent, decided, why, rulings, consents, next.",
      "overlay reads entry, text, and needs entry, text.",
      "Nothing was recorded. Send the call again with that put right.",
    ]);
    expect(b.t.record(turn).items.size).toBe(0);
    // Sent with nothing, the call reaches the tool too, and is told what it takes.
    expect(texts(await b.play({}, turn.id))).toEqual(["operations cannot be read: send a list of operations."]);
  });

  test("a future due at a time given in words no date can be counted from is recorded with those words, shown as given, and said once", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play({ operations: [{ op: "beat", text: "The gale rises." }, { op: "future", text: "The lamp fails.", due: "midnight", tier: "2" }] }, turn.id);
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    expect(r.reports).toEqual([
      'Operation 2 (future): due is kept as you wrote it, "midnight", but holds no date that can be counted from, so it will not come up as due. A date and time (YYYY-MM-DD HH:MM), a clock time (18:30) or a span from now (two days) can be counted.',
    ]);
    expect(b.t.record(turn).of("future").map((x) => x.fields)).toEqual([{ text: "The lamp fails.", due: "midnight", tier: 2 }]);
    const [, future] = JSON.parse(texts(r).find(isJson) ?? "{}").operations as JsonObject[];
    expect((future?.wrote as JsonObject).due).toBe("midnight");
  });
});
