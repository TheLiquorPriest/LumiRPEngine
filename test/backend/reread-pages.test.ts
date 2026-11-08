// A chapter's re-read right after a depth reply (DEPTH-PLAN §4.5, W5): every beat since the last
// chapter is read, a page of Settings → Depth → Beats a reflection reads at a time, oldest first;
// each page reads the notebook as the pages before it left it and answers it with edits, and each
// page's revision is kept with its reasoning. Only the last page may close the chapter.

import { describe, expect, test } from "bun:test";
import type { ModelPort } from "../../src/backend/depth/port";
import { afterDepthReply, type AfterRt } from "../../src/backend/depth/scene/after";
import { defaultSettings } from "../../src/backend/settings-store";
import type { DepthRole } from "../../src/shared/depth-settings";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { NOTEBOOK_REVISE, notebookFiles, notebookOf, type NotebookEventData } from "../../src/engine/notebook";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

const said = (n: number): string => `Sam says line ${String(n).padStart(2, "0")} of the chapter.`;

function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort & { sent: Partial<Record<DepthRole, string[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const fn = (async (role, messages) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>> };
  fn.sent = sent;
  return fn;
}

const beat = (n: number): Beat => ({
  id: `b-${n}`,
  at: 100 + n,
  order: n,
  place: "home",
  actors: ["sam"],
  act: "said",
  about: [],
  what: blobHash(said(n)),
  surface: blobHash(said(n)),
  exposure: [],
  by: { turn: "t1", decided: "player" },
});

describe("a chapter's re-read, a page at a time", () => {
  test("a chapter past one page is read in pages, oldest first, every beat once, each page's revision kept with its reasoning", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>(Array.from({ length: 25 }, (_, i) => [blobHash(said(i + 1)), said(i + 1)]));
    const settings = defaultSettings();
    settings.depth.rereadBeats = 10;
    const rt: AfterRt = {
      host: h.host,
      registry: h.registry,
      blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
      settings: { get: async () => settings },
      ledger: h.service,
    };
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Tell me the whole of it, Sam.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // 25 beats since the chapter began: three pages of 10, 10 and 5.
    expect((await h.service.landLayer(chat, userId, { id: "chapter", basis, kind: "story.beat", events: Array.from({ length: 25 }, (_, i) => beatEvent(beat(i + 1))) })).status).toBe("landed");

    const model = port({
      author: [
        { author: { depth: "chapter", why: "the chapter turned" } },
        // The first page says the chapter ends: pages follow, so it can't.
        { why: "page one: Dev starts to listen", files: [{ path: "notebook/arcs/dev.md", text: "Dev starts to listen." }], chapter: { ends: true, title: "Too Soon" } },
        { why: "page two: a thread opens", files: [{ path: "notebook/threads.md", text: "The flood is coming." }] },
        { why: "page three: the chapter closes", files: [{ path: "notebook/arcs/dev.md", text: "Dev trusts Sam." }], chapter: { ends: true, title: "The Flood" } },
      ],
    });
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model });
    expect(out.failed).toEqual([]);
    expect(out.authorReflected).toBe("chapter");

    // The poll, then one call per page.
    const pages = (model.sent.author ?? []).slice(1);
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => expect(p).toContain(`this is page ${i + 1} of 3`));
    // Every beat read once, on its own page, oldest first.
    for (let n = 1; n <= 25; n++) {
      const on = pages.flatMap((p, i) => (p.includes(said(n)) ? [i] : []));
      expect(on).toEqual([Math.floor((n - 1) / 10)]);
    }
    expect(pages[0]?.indexOf(said(1))).toBeLessThan(pages[0]?.indexOf(said(10)) ?? -1);
    // Each page reads the notebook as the pages before it left it, and answers it with edits.
    expect(pages[1]).toContain("Dev starts to listen.");
    expect(pages[2]).toContain("The flood is coming.");
    expect(pages[0]).toContain("Pages follow, so the chapter can't end on this one.");
    expect(pages[2]).not.toContain("Pages follow");

    // Each page's revision is its own record, with its reasoning.
    const revisions = (await h.service.readEvents(chat, userId, [NOTEBOOK_REVISE])).filter((l) => "data" in l.event);
    expect(revisions.map((l) => ("data" in l.event ? (l.event.data as unknown as NotebookEventData).reason : null))).toEqual(["page one: Dev starts to listen", "page two: a thread opens", "page three: the chapter closes"]);
    expect(revisions.map((l) => l.reasoning)).toEqual([blobHash("page one: Dev starts to listen"), blobHash("page two: a thread opens"), blobHash("page three: the chapter closes")]);
    expect(new Set(revisions.map((l) => ("layer" in l.from ? l.from.layer : null))).size).toBe(3);

    const head = await h.service.foldAtBasis(chat, userId, basis);
    if (!head) throw new Error("no fold");
    // Only the last page closed the chapter; the edits of every page stand.
    expect(notebookOf(head.state).chapters.map((c) => c.title)).toEqual(["The Flood"]);
    expect(notebookFiles(head.state).map((f) => f.path).sort()).toEqual(["notebook/arcs/dev.md", "notebook/threads.md"]);
  });

  test("a stretch within one page is read in one call, as before", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>(Array.from({ length: 5 }, (_, i) => [blobHash(said(i + 1)), said(i + 1)]));
    const rt: AfterRt = {
      host: h.host,
      registry: h.registry,
      blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
      settings: { get: async () => defaultSettings() },
      ledger: h.service,
    };
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Go on.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "chapter", basis, kind: "story.beat", events: Array.from({ length: 5 }, (_, i) => beatEvent(beat(i + 1))) })).status).toBe("landed");
    const model = port({ author: [{ author: { depth: "chapter", why: "the chapter turned" } }, { why: "one look", files: [{ path: "notebook/arcs/dev.md", text: "Dev waits." }], chapter: { ends: true, title: "Waiting" } }] });
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model });
    expect(out.failed).toEqual([]);
    expect(model.sent.author).toHaveLength(2);
    expect(model.sent.author?.[1]).not.toContain("a page at a time");
    for (let n = 1; n <= 5; n++) expect(model.sent.author?.[1]).toContain(said(n));
  });
});
