// The lore in a prompt, checked on receipt (`src/adapter/lumiverse/lore-check.ts`): with the extension on its own fail-closed verdict, RPE's verdict is applied to the lore
// in the prompt before any agent is given it. End to end on the rig (a stand-in Lumiverse, the extension, RPE's side of the road), and on the check alone for what the rig
// does not script. Every name, book and line is invented.

import { describe, expect, test } from "bun:test";
import { KeptAnswers } from "../../src/adapter/lumiverse/answer";
import { createLoreCheck } from "../../src/adapter/lumiverse/lore-check";
import type { LaidMessage } from "../../src/adapter/lumiverse/overlay";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import { textHash, type SecrecyVerdict, type Tag } from "../../src/adapter/lumiverse/wire";
import { FakeClock } from "../standin/clock";
import { FERRY_SHOWN, INDEXED_SECRET, promptText, Rig } from "../ext/rig";

describe("on the rig, with RPE late", () => {
  test("with RPE late, a book entry one of the world's own secrets was indexed from is in the prompt Lumiverse stored and in no agent's request", async () => {
    // RPE answers after the extension's three seconds are up: the extension applies its own fail-closed verdict, which cannot know the indexed entry.
    const clock = new FakeClock();
    const rig = await new Rig({ questionDelayMs: 5_000, clock }).start();
    const generating = rig.generate("conn-rpe");
    let done = false;
    void generating.then(() => (done = true));
    while (!done) {
      await clock.advance(0);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    const out = await generating;
    expect(out.error).toBeNull();
    const turn = rig.turns[0]!;
    expect(turn.tag.secrecy).toMatchObject({ by: "extension" });
    // Lumiverse's own prompt holds it; no agent is given it.
    expect(out.stored!.messages.map((m) => m.content).join("\n")).toContain(INDEXED_SECRET);
    expect(promptText(turn.prompt)).not.toContain(INDEXED_SECRET);
    // The ferry's secret reads as RPE's verdict words it, where the extension's own left it out.
    expect(promptText(turn.prompt)).toContain(FERRY_SHOWN);
    // The turn says what the check did, and the layout still tells each part's stretch.
    expect(turn.cut.lore).toMatchObject({
      checked: true,
      removed: [{ id: "e-indexed", book: "book-harbor", title: "The mayor" }],
      reworded: [{ id: "e-ferry", book: "book-harbor", title: "The ferry" }],
      turnedOn: [],
      notFound: [],
    });
    for (const m of turn.layout.messages) for (const part of m.parts) expect(part.end).toBeLessThanOrEqual(m.length);
  });

  test("with RPE's answer taken as it stands, nothing is checked", async () => {
    const rig = await new Rig().start();
    await rig.generate("conn-rpe");
    expect(rig.turns[0]!.tag.secrecy).toEqual({ by: "rpe" });
    expect(rig.turns[0]!.cut.lore).toBeNull();
  });
});

const tag: Tag = {
  v: 1,
  user: "user-a",
  chat: "chat-a",
  generation: "gen-a",
  kind: "new",
  target: { message: "m2", swipe: 0 },
  speaker: { id: "char-a", name: "Mara" },
  connection: "conn-rpe",
  preset: null,
  persona: null,
  cut: { answered: false },
  messages: [{ role: "user", length: 6, hash: textHash("Hello."), history: true, source: { id: "m1", index: 1 } }],
  secrecy: { by: "extension", why: "RPE gave no answer in time" },
  question: null,
};

const entry = (id: string, content: string, over: Record<string, unknown> = {}) => ({ id, book: "book-1", comment: `Title ${id}`, content, disabled: false, extensions: {}, ...over });

/** The check on its own, over invented books and a scripted secrecy rule. */
function checkOf(entries: ReturnType<typeof entry>[], secrecy: () => Promise<SecrecyVerdict>, answers = new KeptAnswers()) {
  const reads = {
    chat: async () => ({ id: "chat-a", user: "user-a", character: "char-a", name: "A", metadata: { chat_world_book_ids: ["book-1"] }, updatedAt: 0 }),
    character: async () => ({ id: "char-a", extensions: {} }),
    persona: async () => null,
    defaultPersona: async () => null,
    setting: async () => null,
    entries: async () => entries,
  } as unknown as LumiverseReads;
  const macros = {
    resolve: async (text: string) => ({ text, diagnostics: [] }),
    resolveBatch: async (templates: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, v.replaceAll("{{char}}", "Mara")])),
  };
  return createLoreCheck({ user: "user-a", reads, receipt: secrecy, answers, macros });
}

const message = (role: string, text: string, places: LaidMessage["places"] = []): LaidMessage => ({ role, content: text, text, media: 0, places });
const verdict = (over: Partial<SecrecyVerdict>): SecrecyVerdict => ({ disabled: [], enabled: [], mutated: [], ...over });

describe("the check on its own", () => {
  test("an entry stood inside a block Lumiverse joined, with its macros resolved, is taken out with its line break, the stretches after it moved; another is worded otherwise", async () => {
    const block = "Before.\nMara keeps the key.\nThe tide is low.\nAfter.";
    const check = checkOf([entry("e1", "{{char}} keeps the key."), entry("e2", "The tide is low."), entry("e3", "Nothing to do.")], async () => verdict({ disabled: ["e1"], mutated: [{ id: "e2", content: "The tide is high." }] }));
    const out = await check(tag, [message("system", block, [{ member: 0, start: 0, end: block.length }]), message("user", "Hello.")], [{ id: "e1", book: "book-1", bookName: null, title: "", how: null, told: false }], new AbortController().signal);
    expect(out.messages.map((m) => m.text)).toEqual(["Before.\nThe tide is high.\nAfter.", "Hello."]);
    expect(out.messages[0]).toMatchObject({ content: "Before.\nThe tide is high.\nAfter.", changed: true, places: [{ member: 0, start: 0, end: 32 }] });
    expect(out.record).toMatchObject({ checked: true, removed: [{ id: "e1" }], reworded: [{ id: "e2" }], notFound: [], turnedOn: [] });
  });

  test("an entry that stood as a message of its own, and went whole, leaves no blank message", async () => {
    const check = checkOf([entry("e1", "A secret of its own.")], async () => verdict({ disabled: ["e1"] }));
    const out = await check(tag, [message("system", "A secret of its own."), message("user", "Hello.")], [], new AbortController().signal);
    expect(out.messages.map((m) => m.text)).toEqual(["Hello."]);
  });

  test("an entry the verdict turns on is recorded, not added", async () => {
    const check = checkOf([entry("e1", "Kept off by its author.", { disabled: true }), entry("e2", "Plain.")], async () => verdict({ enabled: ["e1"] }));
    const messages = [message("system", "Plain."), message("user", "Hello.")];
    const out = await check(tag, messages, [], new AbortController().signal);
    expect(out.messages).toEqual(messages);
    expect(out.record).toMatchObject({ checked: true, removed: [], reworded: [], turnedOn: [{ id: "e1", book: "book-1", title: "Title e1" }] });
  });

  test("an entry Lumiverse activated whose text is not in the prompt is on the record as not found; one it never inserted is not", async () => {
    const check = checkOf([entry("e1", "Text that is not there."), entry("e2", "Nor this.")], async () => verdict({ disabled: ["e1", "e2"] }));
    const out = await check(tag, [message("system", "Something else.")], [{ id: "e1", book: "book-1", bookName: null, title: "", how: "keyword", told: true }], new AbortController().signal);
    expect(out.record).toMatchObject({ checked: true, removed: [], notFound: [{ id: "e1" }] });
  });

  test("the verdict RPE answered late with is the one applied, and the secrecy rules are not asked again; none kept, they are asked at the tag's point", async () => {
    const answers = new KeptAnswers();
    answers.keep("chat-a", "gen-a", { v: 1, secrecy: verdict({ disabled: ["e1"] }), cut: null });
    let asked = 0;
    const check = checkOf([entry("e1", "Hidden line.")], async () => (asked++, verdict({})), answers);
    const first = await check(tag, [message("system", "Hidden line.\nKept line.")], [], new AbortController().signal);
    expect(first.record).toMatchObject({ checked: true, verdict: "late", removed: [{ id: "e1" }] });
    expect(first.messages.map((m) => m.text)).toEqual(["Kept line."]);
    expect(asked).toBe(0);
    const second = await check(tag, [message("system", "Hidden line.")], [], new AbortController().signal);
    expect(second.record).toMatchObject({ checked: true, verdict: "now", removed: [] });
    expect(asked).toBe(1);
  });

  test("secrets that could not be worked out are on the turn's record, not only in the log; the prompt goes as the extension left it", async () => {
    const check = checkOf([entry("e1", "Hidden line.")], async () => {
      throw new Error("the world's state could not be read");
    });
    const messages = [message("system", "Hidden line.")];
    const out = await check(tag, messages, [], new AbortController().signal);
    expect(out.record).toEqual({ checked: false, why: "the world's state could not be read" });
    expect(out.messages).toEqual(messages);
  });

  test("where the extension applied RPE's own verdict, nothing is checked and nothing asked", async () => {
    let asked = 0;
    const check = checkOf([entry("e1", "Hidden line.")], async () => (asked++, verdict({ disabled: ["e1"] })));
    const messages = [message("system", "Hidden line.")];
    const out = await check({ ...tag, secrecy: { by: "rpe" } }, messages, [], new AbortController().signal);
    expect(out).toEqual({ messages, record: null, lore: [] });
    expect(asked).toBe(0);
  });

  test("each activated entry's text is told as the prompt carries it, macros resolved; one taken out, or not found in the prompt, has none", async () => {
    const entries = [entry("e1", "Hidden line."), entry("e2", "The tide is low."), entry("e3", "{{char}} rings the bell."), entry("e4", "Not in the prompt.")];
    const told = (id: string) => ({ id, book: "book-1", bookName: null, title: "", how: null, told: false });
    const lore = ["e1", "e2", "e3", "e4"].map(told);
    const block = "Hidden line.\nThe tide is low.\nMara rings the bell.";
    // The extension applied its own verdict: RPE's takes e1 out and words e2 otherwise.
    const check = checkOf(entries, async () => verdict({ disabled: ["e1"], mutated: [{ id: "e2", content: "The tide is high." }] }));
    const byExtension = await check(tag, [message("system", block)], lore, new AbortController().signal);
    expect(byExtension.lore.map((l) => l.text)).toEqual([undefined, "The tide is high.", "Mara rings the bell.", undefined]);
    // RPE's own verdict was applied by the extension, and kept for the generation: the prompt holds each entry as that verdict worded it.
    const answers = new KeptAnswers();
    answers.keep("chat-a", "gen-a", { v: 1, secrecy: verdict({ mutated: [{ id: "e2", content: "The tide is high." }] }), cut: null });
    const own = await checkOf(entries, async () => verdict({}), answers)({ ...tag, secrecy: { by: "rpe" } }, [message("system", "Hidden line.\nThe tide is high.\nMara rings the bell.")], lore, new AbortController().signal);
    expect(own.record).toBeNull();
    expect(own.lore.map((l) => l.text)).toEqual(["Hidden line.", "The tide is high.", "Mara rings the bell.", undefined]);
  });
});
