// The hint for the names of a prompt's blocks (`src/adapter/lumiverse/hint.ts`) and the raw layout it goes into (`layout.ts`): a reply never waits
// for a dry run, the dry run is asked as the generation played, a delete sends the hint to a dry run, a breakdown that lands later is used by the next
// turn, and the layout carries the preset's revision and marks a summary. Every chat, preset and line is invented.

import { describe, expect, test } from "bun:test";
import { Hints } from "../../src/adapter/lumiverse/hint";
import { rawLayout } from "../../src/adapter/lumiverse/layout";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import type { LvPreset } from "../../src/adapter/lumiverse/rows";
import type { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { textHash, type Tag } from "../../src/adapter/lumiverse/wire";

const entries = (name: string) => [{ name, type: "block", role: "system", content: `${name} text.`, blockId: `b-${name}` }];
const breakdown = (name: string) => ({ presetId: "preset-1", presetName: "Plain", entries: entries(name) });
/** A turn's layout made with no names for its blocks, of one system message, and that message as it was passed on. */
const unnamed = (text: string) => ({ layout: rawLayout(tag(), [{ role: "system", content: text, text, media: 0, places: [] }], true, null, "100.3"), prompt: [{ role: "system", content: text }] });

function tag(over: Partial<Tag> = {}): Tag {
  return {
    v: 1,
    user: "user-tamsin",
    chat: "chat-1",
    generation: "g1",
    kind: "new",
    target: { message: null, swipe: null },
    speaker: { id: null, name: null },
    connection: "conn-1",
    preset: "preset-1",
    persona: null,
    cut: { answered: false },
    secrecy: { by: "rpe" },
    question: null,
    messages: [],
    ...over,
  };
}

/** Reads that hold one breakdown (or none) and one preset, and a session whose dry run is answered when the test says. */
function bed(stored: unknown) {
  let has = stored;
  const preset: LvPreset = { id: "preset-1", name: "Plain", provider: "", engine: "", parameters: {}, promptOrder: [], prompts: {}, metadata: {}, revision: 3, updatedAt: 100 };
  const reads = { breakdown: async () => has, preset: async () => preset } as unknown as LumiverseReads;
  const asked: { path: string; body: Record<string, unknown> }[] = [];
  let answer: (value: unknown) => void = () => undefined;
  const session = {
    json: (_method: string, path: string, body: Record<string, unknown>) => {
      asked.push({ path, body });
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  } as unknown as LumiverseSession;
  const hints = new Hints({ reads, session, log: () => undefined });
  return { hints, asked, answer: (v: unknown) => answer(v), store: (v: unknown) => (has = v) };
}

const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the hint for the names of a prompt's blocks", () => {
  test("a first turn with no stored breakdown starts at once, and the dry run's names reach the next turn's layout", async () => {
    const b = bed(null);
    const first = await b.hints.forReply(tag());
    expect(first).toEqual({ hint: null, revision: "100.3" });
    // One dry run, beside the turn.
    expect(b.asked).toHaveLength(1);
    expect(b.asked[0]?.path).toBe("/api/v1/generate/dry-run");
    await b.hints.forReply(tag());
    expect(b.asked).toHaveLength(1);
    b.answer(breakdown("Main"));
    await later();
    const next = await b.hints.forReply(tag());
    expect(next.hint?.blocks.map((x) => x.name)).toEqual(["Main"]);
    const turn = unnamed("Main text.");
    const named = b.hints.named("chat-1", turn.layout, turn.prompt);
    expect(named.blocksFrom).toBe("dry-run");
    expect(named.blocks.map((x) => x.name)).toEqual(["Main"]);
    expect(named.messages[0]?.parts[0]?.blocks).toEqual([{ block: 0, start: 0, end: 10 }]);
    expect(b.asked).toHaveLength(1);
  });

  test("a swipe's dry run is asked as a swipe of that message by its speaker", async () => {
    const b = bed(null);
    await b.hints.forReply(tag({ kind: "swipe", target: { message: "m7", swipe: 1 }, speaker: { id: "char-a", name: "Mara" } }));
    expect(b.asked[0]?.body).toMatchObject({ chat_id: "chat-1", generation_type: "swipe", message_id: "m7", target_character_id: "char-a", preset_id: "preset-1", connection_id: "conn-1" });
  });

  test("a stopped generation leaves no breakdown and the one before is used; after a delete the hint comes from a dry run; a breakdown that lands after is used by the next turn", async () => {
    const b = bed(breakdown("Before"));
    expect((await b.hints.forReply(tag())).hint?.blocks.map((x) => x.name)).toEqual(["Before"]);
    expect(b.asked).toHaveLength(0);
    b.hints.deleted("chat-1");
    // Lumiverse dropped the breakdowns of every later message: what is stored is of a prompt that is gone.
    expect((await b.hints.forReply(tag())).hint).toBeNull();
    expect(b.asked).toHaveLength(1);
    b.answer(breakdown("After delete"));
    await later();
    expect((await b.hints.forReply(tag())).hint?.blocks.map((x) => x.name)).toEqual(["After delete"]);
    expect(b.asked).toHaveLength(1);
    // The next reply's breakdown is pushed when it lands.
    await b.hints.heard("GENERATION_BREAKDOWN_READY", { chatId: "chat-1", messageId: "m9", breakdown: breakdown("Landed") });
    const landed = unnamed("Landed text.");
    expect(b.hints.named("chat-1", landed.layout, landed.prompt).blocks.map((x) => x.name)).toEqual(["Landed"]);
    b.store(breakdown("Landed"));
    expect((await b.hints.forReply(tag())).hint?.blocks.map((x) => x.name)).toEqual(["Landed"]);
  });
});

describe("the raw layout", () => {
  const laid = [{ role: "system", content: "Summary of earlier turns.", text: "Summary of earlier turns.", media: 0, places: [{ member: 0, start: 0, end: 25 }] }];

  test("a preset edited between two turns gives a new revision in the layout, and Lumiverse's memory summary in the prompt is marked a summary", () => {
    const listed = tag({ messages: [{ role: "system", length: 25, hash: textHash("Summary of earlier turns."), history: true, summary: true }] });
    const one = rawLayout(listed, laid, true, null, "100.3");
    const two = rawLayout(listed, laid, true, null, "101.4");
    expect([one.preset?.revision, two.preset?.revision]).toEqual(["100.3", "101.4"]);
    expect(one.messages[0]?.parts[0]).toMatchObject({ kind: "history", summarized: true });
  });
});
