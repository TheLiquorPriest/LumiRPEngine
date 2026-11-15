// The Story page, read from its view as drawn and from its reads: the timeline in the chat's order with
// its summaries and what is current; the story model, the horizon and the futures behind the spoiler
// gate; a list read further back by the route's own paging, the older items added before those held;
// a strike shows the item as it stands now, in place; a refusal in RPE's words. And its place.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { StoryStruck } from "../../src/ui/api";
import { PAGES } from "../../src/ui/page-list";
import { NO_STORY, listsOf, readStory, type StoryShown, StoryView } from "../../src/ui/pages/story";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { askingClient, settle } from "./asking";
import { CHAT, OLDER_BEATS, STORY, THREAD } from "./records-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function view(shown: Partial<StoryShown>, gateOpen = false) {
  const pressed: unknown[] = [];
  const tree = expand(
    h(StoryView, {
      shown: { ...NO_STORY, loading: false, answer: STORY, lists: listsOf(STORY), ...shown },
      gateOpen,
      onOpenGate: () => pressed.push("open"),
      onCloseGate: () => pressed.push("close"),
      onFurther: (part) => pressed.push(["further", part]),
      onStrike: (ask) => pressed.push(ask),
    }),
  );
  return { tree, text: textOf(tree), pressed };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);
const order = (tree: unknown): string[] => elements(elements(tree).find((e) => e.props["data-section"] === "timeline")).flatMap((e) => (typeof e.props["data-entry"] === "string" ? [e.props["data-entry"]] : []));

describe("the Story page", () => {
  test("the timeline in the chat's order, a chapter before the scene it opens and the scene before its beats, each with where it lies, its summary, and what is now", () => {
    const { tree } = view({});
    expect(order(tree)).toEqual(["ch-1", "sc-1", "bt-3", "sc-2", "bt-4"]);
    const timeline = section(tree, "timeline");
    expect(timeline).toContain("Odile takes the ferry out in a storm.");
    expect(timeline).toContain("messages 0 to 6");
    expect(timeline).toContain("messages 7 to open");
    expect(timeline).toContain("message 4");
    expect(timeline).toContain("closed");
    expect(textOf(elements(tree).find((e) => e.props["data-entry"] === "sc-2")?.props.children)).toContain("now");
    expect(timeline).toContain("1 chapter, 2 scenes and 5 beats in all; each list reads 2 at a time.");
  });

  test("the story model, the horizon and the futures stay behind the spoiler gate until it is opened", () => {
    const shut = view({});
    expect(shut.text).not.toContain(THREAD);
    expect(shut.text).not.toContain("The Reeve's Hall");
    expect(shut.text).not.toContain("spring fair");
    expect(shut.text).toContain("The story model, the horizon and the futures are what the Author plans");
    press(shut.tree, "Show them for this chat");
    expect(shut.pressed).toEqual(["open"]);
    const open = view({}, true);
    expect(section(open.tree, "threads")).toContain(THREAD);
    expect(section(open.tree, "premise")).toContain("A river town and the one ferry across it.");
    expect(section(open.tree, "horizon")).toContain("the reeve's hallThe Reeve's Hall");
    expect(section(open.tree, "horizon")).toContain("a storm upriver");
    expect(section(open.tree, "futures")).toContain("The reeve is found out at the spring fair.");
    expect(section(open.tree, "arcs")).toContain("None recorded.");
  });

  test("a list with older items offers to read them, and only that list", () => {
    const { tree, pressed } = view({});
    press(tree, "Older beats (3 more)");
    expect(pressed).toEqual([["further", "beat"]]);
    expect(elements(tree).filter((e) => e.type === "button" && textOf(e.props.children).startsWith("Older"))).toHaveLength(1);
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
    const struck = { ...(OLDER_BEATS.timeline.beat.items[0] as StoryStruck["item"]), struck: true };
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

  test("read again when a run begins or ends, each list keeps what was read further back of it, with the newest page after it; a newest page that does not reach the items held stands alone", async () => {
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

    // A run wrote one beat more: the newest page now ends with it.
    const held = STORY.timeline.beat.items as [StoryStruck["item"], StoryStruck["item"]];
    const fifth = { ...held[1], id: "bt-5", from: 10, to: 10 };
    reader.refresh();
    asked[2]?.answer({ ...STORY, timeline: { ...STORY.timeline, beat: { items: [held[1], fifth], total: 6, before: 4, after: 0 } } });
    await settle();
    expect(beats()?.items.map((i) => i.id)).toEqual(["bt-1", "bt-2", "bt-3", "bt-4", "bt-5"]);
    expect(beats()).toMatchObject({ total: 6, before: 1, after: 0 });
    expect(shown.at(-1)?.lists?.scene).toEqual(STORY.timeline.scene);

    reader.refresh();
    asked[3]?.answer({ ...STORY, timeline: { ...STORY.timeline, beat: { items: [{ ...fifth, id: "bt-9" }, { ...fifth, id: "bt-10" }], total: 10, before: 8, after: 0 } } });
    await settle();
    expect(beats()?.items.map((i) => i.id)).toEqual(["bt-9", "bt-10"]);
    expect(beats()?.before).toBe(8);
    reader.stop();
  });

  test("Story is a chat's page in both shells, behind More on a narrow bar, with its own address", () => {
    expect(PAGES.find((n) => n.id === "story")).toMatchObject({ shells: ["web", "drawer"], needsChat: true, often: false });
    expect(routeOfHash(hashOf({ page: "story", chat: CHAT }))).toEqual({ page: "story", chat: CHAT });
  });
});
