// The archive's JSON rounds past setup (Y8): the author's steps, its poll and its reflection, and the
// GM's truth links, each may search and quote the chat's archive before it answers, and then completes.

import { describe, expect, test } from "bun:test";
import type { ArchiveQuery, ArchiveQuoteRequest } from "../../src/shared/archive";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { ArchiveSource } from "../../src/backend/depth/archive-tools";
import type { ModelPort } from "../../src/backend/depth/port";
import { authorPoll, authorReflect, authorStep } from "../../src/backend/depth/scene/author";
import { truthLink } from "../../src/backend/depth/truth-link";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const LINE = "The kettle was still warm when she left.";

type Answering = ModelPort & { calls: { role: string; last: string }[] };
type Recorded = ArchiveSource & { asked: string[] };

/** A model that answers each call with the next recorded answer, keeping every call's role and last message. */
function answering(...answers: unknown[]): Answering {
  const calls: { role: string; last: string }[] = [];
  const port = (async (role, messages) => {
    calls.push({ role, last: String(messages.at(-1)?.content ?? "") });
    return { text: JSON.stringify(answers.shift() ?? {}) };
  }) as Answering;
  port.calls = calls;
  return port;
}

/** An archive of one message, recording what it was asked. */
function archive(): Recorded {
  const asked: string[] = [];
  return {
    asked,
    async search(q: ArchiveQuery) {
      asked.push(`search ${q.text ?? ""}`);
      return { total: 1, hits: [{ messageId: "m1", index: 0, isUser: false, swipeId: 0, swipe: "m1:0" as never, storyTime: null, places: [], people: [], beats: [], exposure: [], score: 1, snippet: "the kettle", span: [0, 10] }] };
    },
    async quote(r: ArchiveQuoteRequest) {
      asked.push(`quote ${r.messageId}`);
      return { messageId: "m1", index: 0, isUser: false, swipeId: 0, swipe: "m1:0" as never, storyTime: null, span: [0, LINE.length], text: LINE, truncated: false };
    },
  };
}

const reads = { archive: [{ tool: "archive_search", text: "kettle" }, { tool: "archive_quote", message: "m1" }] };
const notebook = { files: {}, pinned: [] };

/** The read's result came back to the model in its second call, and the archive was asked both. */
function readBack(model: Answering, src: Recorded): void {
  expect(src.asked).toEqual(["search kettle", "quote m1"]);
  expect(model.calls.length).toBe(2);
  expect(model.calls[1]?.last).toContain("What the archive gave");
  expect(model.calls[1]?.last).toContain(LINE);
  expect(model.calls[1]?.last).toContain("1 found");
}

describe("the archive's rounds past setup", () => {
  test("the author's step reads the archive, then takes its step", async () => {
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const model = answering(reads, { beats: [], end: "He answers now." });
    const src = archive();
    const out = await authorStep({ world: w, state: s, texts: {}, pov: w.pov, model, notebook, scene: { id: "sc1", place: "cafe", cast: [], staging: [], beats: [] }, decided: [], played: [], left: 3, archive: src });
    readBack(model, src);
    expect(out.end).toBe("He answers now.");
    expect(out.reads?.length).toBe(2);
  });

  test("the author's poll reads the archive, then polls", async () => {
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const model = answering(reads, { catchup: [], reflect: [] });
    const src = archive();
    const out = await authorPoll({ world: w, state: s, texts: {}, pov: w.pov, model, notebook, beats: [], kept: [], minutes: 5, due: [], pending: [], predictions: [], signals: [], sceneEnded: false, sinceChapter: 1, cadence: "turns", archive: src });
    readBack(model, src);
    expect(out.catchup).toEqual([]);
    expect(out.reads?.length).toBe(2);
  });

  test("the author's reflection reads the archive, then revises its notebook", async () => {
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const model = answering(reads, { files: [{ path: "notebook/story.md", text: "The kettle matters." }] });
    const src = archive();
    const out = await authorReflect({ world: w, state: s, texts: {}, pov: w.pov, model, notebook, depth: "scene", beats: [], becoming: [], chapter: 0, through: "m1", signals: [], archive: src });
    readBack(model, src);
    expect(out.reads?.length).toBe(2);
    expect(out.events.length).toBeGreaterThan(0);
  });

  test("the GM's truth links read the archive as the GM, then link", async () => {
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const model = answering(reads, { facts: [{ ref: "f1", claim: "The kettle was warm", about: [], truth: "true", matters: "She left in a hurry" }], links: [] });
    const src = archive();
    const out = await truthLink({ registry: reg, world: w, state: s, texts: {}, beats: [], beliefs: [], msg: "m2", archive: src }, model);
    readBack(model, src);
    expect(model.calls.map((c) => c.role)).toEqual(["gm", "gm"]);
    expect(out.events.map((e) => e.type)).toEqual(["minds.fact"]);
    expect(out.reasoning).toContain("The GM reads the archive");
  });

  test("no archive: one answer, as before", async () => {
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const model = answering({ catchup: [], reflect: [] });
    await authorPoll({ world: w, state: s, texts: {}, pov: w.pov, model, notebook, beats: [], kept: [], minutes: 5, due: [], pending: [], predictions: [], signals: [], sceneEnded: false, sinceChapter: 1, cadence: "turns" });
    expect(model.calls.length).toBe(1);
  });
});
