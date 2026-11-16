// The Story page, read from its view as drawn and from its reads: the timeline in the chat's order with
// its summaries and what is current; the story model, the horizon and the futures behind the spoiler
// gate; a list read further back by the route's own paging, the older items added before those held;
// a strike shows the item as it stands now, in place; a refusal in RPE's words. And its place.

import { describe, expect, test } from "bun:test";
import type { ComponentChildren } from "preact";
import { h } from "preact";
import type { StoryStrikeReply } from "../../src/shared/api";
import { PAGES } from "../../src/ui/page-list";
import { NO_STORY, listsOf, readStory, type StoryShown, StoryView } from "../../src/ui/pages/story";
import { CoverageView, hiddenIn, needsEye } from "../../src/ui/pages/story/coverage";
import { missingIds, Prose } from "../../src/ui/pages/story/timeline";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { askingClient, settle } from "./asking";
import { CHAT, OLDER_BEATS, STORY, THREAD } from "./records-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function view(shown: Partial<StoryShown>, gateOpen = false, gated?: ComponentChildren) {
  const pressed: unknown[] = [];
  const tree = expand(
    h(StoryView, {
      shown: { ...NO_STORY, loading: false, answer: STORY, lists: listsOf(STORY), ...shown },
      gateOpen,
      onOpenGate: () => pressed.push("open"),
      onCloseGate: () => pressed.push("close"),
      onFurther: (part) => pressed.push(["further", part]),
      onStrike: (ask) => pressed.push(ask),
      gated,
    }),
  );
  return { tree, text: textOf(tree), pressed };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);

describe("the Story page", () => {
  test("what the Author keeps of the story stays behind the spoiler gate until it is opened: the timeline and what covers it, the model, the horizon and the futures", () => {
    const gated = h("p", { "data-timeline-slot": true }, "THE TIMELINE");
    const shut = view({}, false, gated);
    expect(shut.text).not.toContain("THE TIMELINE");
    expect(shut.text).not.toContain(THREAD);
    expect(shut.text).not.toContain("The Reeve's Hall");
    expect(shut.text).not.toContain("spring fair");
    expect(shut.text).toContain("The Author's timeline and summaries, the story model");
    press(shut.tree, "Show them for this chat");
    expect(shut.pressed).toEqual(["open"]);
    const open = view({}, true, gated);
    expect(open.text).toContain("THE TIMELINE");
    expect(section(open.tree, "threads")).toContain(THREAD);
    expect(section(open.tree, "premise")).toContain("A river town and the one ferry across it.");
    expect(section(open.tree, "horizon")).toContain("the reeve's hallshown 1 level deepThe Reeve's Hall");
    expect(section(open.tree, "horizon")).toContain("a storm upriver");
    expect(section(open.tree, "futures")).toContain("The reeve is found out at the spring fair.");
    expect(section(open.tree, "arcs")).toContain("None recorded.");
  });

  test("it reads the record; further back it asks the route for that list past what it holds and adds what comes before it; a strike shows the item as it stands now in place; a refusal is said in RPE's words", async () => {
    const { client, asked } = askingClient();
    const shown: StoryShown[] = [];
    const reader = readStory(client, CHAT, (s) => shown.push(s));
    expect(asked[0]?.key).toBe("GET /api/v1/chats/:chat/story");
    asked[0]?.answer(STORY);
    await settle();
    reader.further("beat");
    expect(asked[1]).toMatchObject({ key: "GET /api/v1/chats/:chat/story", query: { part: "beat", skip: 2 } });
    asked[1]?.answer(OLDER_BEATS);
    await settle();
    const beats = shown.at(-1)?.lists?.beat;
    expect(beats?.items.map((i) => i.id)).toEqual(["bt-1", "bt-2", "bt-3", "bt-4"]);
    expect(beats?.before).toBe(1);
    // Every other list is as first read.
    expect(shown.at(-1)?.lists?.scene).toEqual(STORY.timeline.scene);

    reader.strike({ id: "bt-1", struck: true });
    expect(asked[2]).toMatchObject({ key: "POST /api/v1/chats/:chat/story/strike", body: { id: "bt-1", struck: true } });
    const struck = { ...(OLDER_BEATS.timeline.beat.items[0] as StoryStrikeReply["item"]), struck: true };
    asked[2]?.answer({ changed: true, item: struck });
    await settle();
    expect(shown.at(-1)?.lists?.beat.items.map((i) => [i.id, i.struck])).toEqual([
      ["bt-1", true],
      ["bt-2", false],
      ["bt-3", false],
      ["bt-4", false],
    ]);
    expect(banners(view(shown.at(-1) ?? {}).tree)[0]?.title).toBe("Struck");

    reader.strike({ id: "bt-2", struck: true });
    asked[3]?.fail(new Error("A turn of this chat is running; strike it once it ends."));
    await settle();
    expect(banners(view(shown.at(-1) ?? {}).tree)).toContainEqual({ title: "Not done", text: "Not doneA turn of this chat is running; strike it once it ends." });
    reader.stop();
  });

  test("read again when a run begins or ends, a list read further back is read back to its depth, so an item the record dropped is gone and the rest stay", async () => {
    const { client, asked } = askingClient();
    const shown: StoryShown[] = [];
    const reader = readStory(client, CHAT, (s) => shown.push(s));
    asked[0]?.answer(STORY);
    await settle();
    reader.further("beat");
    asked[1]?.answer(OLDER_BEATS);
    await settle();
    const beats = () => shown.at(-1)?.lists?.beat;
    expect(beats()?.items.map((i) => i.id)).toEqual(["bt-1", "bt-2", "bt-3", "bt-4"]);

    // A run wrote one beat more, and the record no longer holds bt-1 and bt-2: the newest page is read, then the page before it back to the depth held.
    const held = STORY.timeline.beat.items as [StoryStrikeReply["item"], StoryStrikeReply["item"]];
    const fifth = { ...held[1], id: "bt-5", from: 10, to: 10 };
    reader.refresh();
    asked[2]?.answer({ ...STORY, timeline: { ...STORY.timeline, beat: { items: [held[1], fifth], total: 5, before: 3, after: 0 } } });
    await settle();
    expect(asked[3]).toMatchObject({ key: "GET /api/v1/chats/:chat/story", query: { part: "beat", skip: 2 } });
    asked[3]?.answer({ ...STORY, timeline: { ...STORY.timeline, beat: { items: [held[0]], total: 5, before: 0, after: 0 } } });
    await settle();
    expect(beats()?.items.map((i) => i.id)).toEqual([held[0].id, held[1].id, "bt-5"]);
    expect(shown.at(-1)?.lists?.scene).toEqual(STORY.timeline.scene);
    reader.stop();
  });

  test("Story is a chat's page in both shells, behind More on a narrow bar, with its own address", () => {
    expect(PAGES.find((n) => n.id === "story")).toMatchObject({ shells: ["web", "drawer"], needsChat: true, often: false });
    expect(routeOfHash(hashOf({ page: "story", chat: CHAT }))).toEqual({ page: "story", chat: CHAT });
  });
});

describe("the timeline's prose and what the record covers", () => {
  const message = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, chat: CHAT, index: 0, role: "assistant" as const, name: "Odile", text, swipe: 0, swipes: 1, ...over });
  const row = (id: string, ids: string[]) => ({ kind: "beat" as const, item: { ...(STORY.timeline.beat.items[0] as StoryStrikeReply["item"]), id }, chapter: null, scene: null, messages: ids.map((m, i) => ({ number: i, id: m })) });

  test("a beat shows the text of its messages beside it, and only the messages not yet read are asked for", () => {
    const held = new Map([["m1", message("m1", "Odile takes the ferry out in a storm.") as never]]);
    expect(missingIds([row("bt-1", ["m1", "m2"]), row("bt-2", ["m2", "m3"])], held)).toEqual(["m2", "m3"]);
    const text = textOf(expand(h(Prose, { row: row("bt-1", ["m1", "m2"]), messages: held })));
    expect(text).toContain("Message 0 · Odile");
    expect(text).toContain("Odile takes the ferry out in a storm.");
    expect(text).toContain("Reading it…");
  });

  test("a stretch left uncovered or with beats and no summary is listed, with its hidden messages; one covered and summarized is not", () => {
    const coverage = { chat: CHAT, messages: 60, edge: 30, hiddenReadable: false, hidden: [12, 40], above: 4, stretches: [{ from: 0, to: 9, covered: true, beats: true, summarized: true, window: false }, { from: 10, to: 19, covered: false, beats: false, summarized: false, window: false }, { from: 20, to: 29, covered: true, beats: true, summarized: false, window: false }] };
    expect(coverage.stretches.map(needsEye)).toEqual([false, true, true]);
    expect(hiddenIn({ from: 10, to: 19 }, coverage.hidden)).toBe(1);
    const text = textOf(expand(h(CoverageView, { coverage, shownAtOnce: 30 })));
    expect(text).toContain("Messages 10 to 19");
    expect(text).toContain("1 hidden message");
    expect(text).toContain("4 messages above the window's edge are not covered");
    expect(text).toContain("agents may not read hidden messages in this chat");
  });
});
