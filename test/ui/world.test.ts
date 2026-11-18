// The World page, read from its view as drawn: the tree at any level and depth, each value with where it
// comes from and the change that wrote it, the facts recorded under a value's key beside that value and
// apart from it; for a chat RPE has not played, that its world is shown as it stands now; and the reads
// behind it, which ask what the page shows and nothing after it has moved on.

import { describe, expect, test } from "bun:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { WorldReply } from "../../src/shared/api";
import { AppContext, type UiApp } from "../../src/ui/app";
import type { RpeClient } from "../../src/ui/client";
import { createGate } from "../../src/ui/gate";
import { readWorld, WORLD_START, WorldPage, type WorldQuery, type WorldResult, WorldView, type WorldViewProps } from "../../src/ui/pages/world";
import { settle } from "./asking";
import { openPage, type PageElement } from "./kept/dom";
import { CHAT, EARLIER, worldAt } from "./recorded";
import { elements, expand, press, textOf } from "./vnodes";

/** A gate with this chat's spoilers shown. */
function openGate() {
  const gate = createGate();
  gate.open(CHAT);
  return gate;
}

function worldView(answer: WorldReply | null, over: Partial<WorldViewProps> = {}): { text: string; tree: unknown; asked: WorldQuery[] } {
  const asked: WorldQuery[] = [];
  const props: WorldViewProps = { query: { ...WORLD_START, at: answer?.at ?? "world" }, answer, loading: false, problem: null, turns: EARLIER, gateOpen: true, onOpenGate: () => undefined, onCloseGate: () => undefined, onQuery: (next) => asked.push(next), ...over };
  const tree = expand(h(WorldView, props));
  return { text: textOf(tree), tree, asked };
}

/** The element of the tree that holds a level, and its parts by mark. */
function partOf(tree: unknown, mark: string, value: string) {
  const found = elements(tree).find((e) => e.props[mark] === value);
  if (found === undefined) throw new Error(`no ${mark}=${value}`);
  return found;
}

describe("the World page", () => {
  const point = worldAt("place:calder-point", 1);

  test("nothing of the tree's values or counts shows until the gate is opened", () => {
    const shut = worldView(point, { gateOpen: false });
    expect(shut.text).toContain("Spoilers are hidden");
    expect(shut.text).not.toContain("Calder Point");
    expect(shut.text).not.toContain("2 people");
    expect(elements(shut.tree).some((e) => typeof e.props["data-node"] === "string")).toBe(false);
  });

  test("the things browser mounts only with the gate open", () => {
    const slots = { things: h("p", { "data-mark": "browser" }, "the things browser") };
    expect(worldView(point, { gateOpen: false, slots }).text).not.toContain("the things browser");
    expect(worldView(point, { slots }).text).toContain("the things browser");
  });

  test("each value says where it comes from and what wrote it, and the facts under its key stand beside it, not in its place", () => {
    const { tree } = worldView(point);
    const lamp = partOf(partOf(tree, "data-node", "place:lamp-room").props.children, "data-key", "lamp");
    // A row reads its key, then where the value comes from, then the value.
    expect(textOf(lamp.props.children)).toContain("lampits own; exact, proposed, by the GM, turn 31dark");
    // The fact is shown beside the value it bears on; the value stays as recorded.
    expect(textOf(lamp.props.children)).toContain("fact lamp: the chimney glass cracked in the cold (vague, assumed, by a character, turn 31, by a3)");
    const room = textOf(partOf(tree, "data-node", "place:lamp-room").props.children);
    expect(room).toContain("keeperinherited from Calder PointMoira Vell");
    expect(room).toContain("weatherkept by the weather systemnorth wind, sleet");
    // A fact under a key no value has stands on its own.
    expect(room).toContain("Facts on it");
    expect(room).toContain("smell: paraffin and cold brass (exact, established, from the prose, turn 30)");
    expect(room).toContain("2 people · 2 things · 1 open · last changed on turn 31");
    expect(room).toContain("Ash will not leave until the lamp is explained.");
  });

  test("it opens any level, up or down, to any depth, with each level's own values or what it inherits too", () => {
    const shown = worldView(point);
    press(shown.tree, "Up a level");
    press(shown.tree, "The whole world");
    press(shown.tree, "More levels");
    press(shown.tree, "Fewer levels");
    press(shown.tree, "Its own");
    // A level below whose own levels the answer does not hold offers to open them.
    press(partOf(shown.tree, "data-node", "place:lamp-room"), "2 levels below");
    press(partOf(shown.tree, "data-node", "place:lamp-room"), "Open");
    expect(shown.asked).toEqual([
      { ...WORLD_START, at: "world" },
      { ...WORLD_START, at: "world" },
      { ...WORLD_START, at: "place:calder-point", depth: 2 },
      { ...WORLD_START, at: "place:calder-point", depth: 0 },
      { ...WORLD_START, at: "place:calder-point", values: "own" },
      { ...WORLD_START, at: "place:lamp-room" },
      { ...WORLD_START, at: "place:lamp-room" },
    ]);
    // The world, one level in: Calder Point holds a level the answer leaves out, the groups and what is elsewhere none.
    const top = worldView(worldAt("world", 1));
    expect(elements(top.tree).filter((e) => typeof e.props["data-node"] === "string").map((e) => e.props["data-node"])).toEqual(["world", "place:calder-point", "groups", "elsewhere"]);
    expect(top.text).toContain("1 level below");
    expect(top.text).not.toContain("Up a level");
  });

  test("no section stands in for what the page does not show, and older turns are read for \"As it stood\" while there are more", () => {
    const { tree, text } = worldView(point);
    expect(elements(tree).some((e) => e.props["data-section"] === "map")).toBe(false);
    expect(text).not.toContain("cannot show");
    expect(text).not.toContain("Older turns");
    let more = 0;
    const longer = worldView(point, { moreTurns: { more: true, onMore: () => more++ } });
    press(longer.tree, "Older turns");
    expect(more).toBe(1);
  });

  test("for a chat no turn of which RPE has played (one a migration imported), it says its world is shown as it stands now, in place of the turns to see it at", () => {
    const none = "No turn of this chat has been played on RPE yet, so its world is shown as it stands now.";
    const unplayed = worldView(worldAt("world", 1), { turns: [] });
    expect(unplayed.text).toContain(none);
    expect(elements(unplayed.tree).some((e) => e.type === "select")).toBe(false);
    // The world itself is shown all the same.
    expect(elements(unplayed.tree).some((e) => e.props["data-node"] === "place:calder-point")).toBe(true);
    // Turns not read yet, or not read at all, say nothing of whether any was played.
    for (const turns of [null, EARLIER]) {
      const shown = worldView(worldAt("world", 1), { turns });
      expect(shown.text).not.toContain(none);
      expect(elements(shown.tree).filter((e) => e.type === "option").length).toBe(1 + (turns?.length ?? 0));
    }
  });

  test("the reads behind it ask for what the page shows, as it stood at a turn when one is chosen; an answer after the page asked again is let go, and RPE's refusal is said in its words", async () => {
    const asked: { params: Readonly<Record<string, string>>; query: unknown; answer(value: unknown): void; fail(error: Error): void }[] = [];
    const client: Pick<RpeClient, "call"> = {
      call: ((_key: string, params: Readonly<Record<string, string>>, options?: { query?: unknown }) => {
        const { promise, resolve, reject } = Promise.withResolvers<unknown>();
        asked.push({ params, query: options?.query, answer: resolve, fail: reject });
        return promise;
      }) as RpeClient["call"],
    };
    const results: WorldResult[] = [];
    const stop = readWorld(client, CHAT, { at: "place:lamp-room", depth: 2, values: "own", turn: "turn-30" }, (r) => results.push(r));
    expect(asked[0]).toMatchObject({ params: { chat: CHAT }, query: { at: "place:lamp-room", depth: 2, values: "own", turn: "turn-30" } });
    stop();
    asked[0]?.answer(worldAt("place:lamp-room", 2));
    readWorld(client, CHAT, WORLD_START, (r) => results.push(r));
    expect(asked[1]?.query).toEqual({ at: "world", depth: 1, values: "all" });
    asked[1]?.fail(new Error("Nothing in the world of chat chat-calder is called world."));
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual([{ answer: null, problem: "Nothing in the world of chat chat-calder is called world." }]);
    expect(worldView(null, { problem: results[0]?.problem ?? null }).text).toContain("The world could not be read");
  });
});

describe("the World page as it reads the chat's turns", () => {
  test("it says no turn of the chat was played on RPE only once RPE answered with none; when the turns could not be read, it says nothing of it", async () => {
    const page = openPage();
    try {
      for (const [turns, said] of [[{ turns: [], more: false }, true], [new Error("RPE did not answer: Failed to fetch"), false]] as const) {
        const client = {
          call: ((key: string) => (key === "GET /api/v1/chats/:chat/turns" ? (turns instanceof Error ? Promise.reject(turns) : Promise.resolve(turns)) : key === "GET /api/v1/chats/:chat/world" ? Promise.resolve(worldAt("world", 1)) : Promise.reject(new Error("not read here")))) as RpeClient["call"],
        };
        const root = page.document.createElement("div") as PageElement;
        await act(() => {
          render(h(AppContext.Provider, { value: { client, gate: openGate(), kept: () => new Promise(() => undefined) } as unknown as UiApp }, h(WorldPage, { chat: CHAT })), root as unknown as HTMLElement);
        });
        // The reads begin once the page is drawn; their answers are drawn once they are in.
        await act(() => settle());
        expect(root.textContent).toContain("Calder Point");
        expect(root.textContent.includes("No turn of this chat has been played on RPE yet")).toBe(said);
        await act(() => render(null, root as unknown as HTMLElement));
      }
    } finally {
      page.close();
    }
  });
});
