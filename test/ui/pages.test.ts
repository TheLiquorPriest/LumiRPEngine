// What the pages show, read from their views as drawn: on Turn and Live the intent record and the
// agents' work stay behind the spoiler gate until the player opens it; the timings, the token counts and
// what went to the chat do not; Stop is there while a turn runs, for that run alone. The Turns list
// keeps to its chat. And the web shell's addresses.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { TurnsReply, TurnRow } from "../../src/shared/api";
import type { Route } from "../../src/ui/app";
import type { RpeClient } from "../../src/ui/client";
import { applyLive, applyRead, EMPTY_LIVE, runOf, runsOf } from "../../src/ui/live-model";
import { ChatsView } from "../../src/ui/pages/chats";
import { type FolderShown, NO_FOLDER, readFolder, readTurns, TURN_SECTIONS, TurnsView, TurnView, type TurnsRead, type TurnViewProps } from "../../src/ui/pages/turns";
import { siteStorage } from "../../src/ui/ui-settings";
import { hashOf, routeOfHash, storedTokens } from "../../src/ui/web";
import { liveTurn } from "../../src/ui/turn-model";
import { AUTHOR, CHAT, CHATS, continuedTurn, CONTINUED_REPLY, EARLIER, earlierTurn, GM, INTENT, LORE, MOIRA, RECORDED, RECORDS, REPLY, requestFile, RUN, RUN_FIRST, RUN_SECOND, TOTAL, turnAt } from "./recorded";
import { elements, expand, press, textOf } from "./vnodes";

const RULING = "Ruling: her story does not hold.";
const THINKING = "She lied to the harbourmaster";

/** Lets everything the page has waiting on a promise run. */
function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

function turnView(over: Partial<TurnViewProps> = {}): { text: string; tree: unknown; pressed: string[] } {
  const pressed: string[] = [];
  const turn = over.turn ?? turnAt();
  const props: TurnViewProps = {
    turn,
    runs: runsOf(applyRead(EMPTY_LIVE, turn), turn.id),
    problem: null,
    now: turn.timings.ended ?? 0,
    gateOpen: false,
    folder: NO_FOLDER,
    onOpenGate: () => pressed.push("open"),
    onCloseGate: () => pressed.push("close"),
    onBack: () => pressed.push("back"),
    onLive: () => pressed.push("live"),
    onRead: () => pressed.push("read"),
    onOpenFile: (name) => pressed.push(`file:${name}`),
    onOpenRequest: (name) => pressed.push(`request:${name}`),
    onCloseFile: () => pressed.push("close-file"),
    ...over,
  };
  const tree = expand(h(TurnView, props));
  return { text: textOf(tree), tree, pressed };
}

describe("the Turn page", () => {
  test("the intent record is hidden until the gate is opened", () => {
    const shut = turnView({ gateOpen: false });
    for (const line of INTENT.split("\n")) expect(shut.text).not.toContain(line);
    expect(shut.text).not.toContain(RULING);
    expect(shut.text).not.toContain(THINKING);
    expect(shut.text).toContain("Spoilers are hidden");
    press(shut.tree, "Show them for this chat");
    expect(shut.pressed).toEqual(["open"]);

    const open = turnView({ gateOpen: true });
    expect(open.text).toContain("Intent record");
    for (const line of INTENT.split("\n")) expect(open.text).toContain(line);
    expect(open.text).toContain(RULING);
    press(open.tree, "Hide them");
    expect(open.pressed).toEqual(["close"]);
  });

  test("its timings, token counts and what went to the chat show with the gate shut", () => {
    const { text } = turnView({ gateOpen: false });
    for (const label of ["Reached RPE", "The lead began", "First words to the chat", "Reply released", "The run ended", "Before the first words"]) expect(text).toContain(label);
    expect(text).toContain("35,690");
    expect(text).toContain("857");
    expect(text).toContain(REPLY.split("\n")[0] as string);
  });

  test("a turn tied to no message says why: not yet while it may still be, and no message once it ended with nothing released", () => {
    const stopped = earlierTurn("turn-28");
    if (stopped === null) throw new Error("the fixture has no turn-28");
    const untied = { ...stopped, message: null };
    expect([untied.status, untied.timings.released]).toEqual(["stopped", null]);
    const done = turnView({ turn: untied }).text;
    expect(done).toContain("no message");
    expect(done).not.toContain("not tied to a message yet");
    // Released, and not yet tied: Lumiverse has yet to say which message it saved.
    expect(turnView({ turn: { ...turnAt(), message: null } }).text).toContain("not tied to a message yet");
    expect(turnView({ turn: { ...turnAt(40), message: null } }).text).toContain("not tied to a message yet");
  });

  test("behind the gate: what the Author was given by name and its prompt's lore by id; nothing the page says of RPE's routes", () => {
    const shut = turnView({ gateOpen: false });
    expect(shut.text).not.toContain("prompt:all");
    expect(shut.text).not.toContain(LORE.map[1]);
    expect(shut.text).not.toContain("world-state.md");
    const open = turnView({ gateOpen: true });
    expect(open.text).toContain("What the Author was given");
    expect(open.text).toContain("author was given: prompt:all, story:brief, world:scene.");
    expect(open.text).toContain(`Lumiverse activated for its prompt: ${LORE.activated.join(", ")}`);
    expect(open.text).toContain(`Its lore map showed the Author: ${LORE.map.join(", ")}`);
    // The page makes no claim of its own about which routes RPE has.
    expect(open.text).not.toContain("Not available here yet");
    expect(open.text).not.toContain("has no route");
    // Each agent's model calls with their tools and results are drawn too.
    expect(open.text).toContain("2d6 = 4 + 1 = 5 against 8: it does not hold.");
    // A turn whose prompt had no lore says so.
    const earlier = earlierTurn("turn-30");
    if (earlier === null) throw new Error("the fixture has no turn-30");
    const bare = turnView({ turn: earlier, gateOpen: true }).text;
    expect(bare).toContain("Lumiverse activated for its prompt: no entry.");
    expect(bare).toContain("Its lore map showed the Author: no entry.");
  });

  test("with the gate open, every agent of the run is drawn, with its tokens", () => {
    const { text, tree } = turnView({ gateOpen: true });
    const agents = elements(tree).filter((e) => e.type === "details" && typeof e.props["data-agent"] === "string").map((e) => e.props["data-agent"]);
    expect(agents).toEqual(["a1", "a2", "a3"]);
    expect(text).toContain("Tokens by agent");
    expect(text).toContain("character, playing char-moira");
    expect(text).toContain("Rule rolls-say-why fired");
  });

  test("a section a later lane adds as a spoiler stays behind the gate", () => {
    const sections = [...TURN_SECTIONS, { id: "lanes", order: 999, title: "Changes in each lane", spoiler: true, body: () => "The lamp room's door: shut to open." }];
    expect(turnView({ sections, gateOpen: false }).text).not.toContain("The lamp room's door");
    expect(turnView({ sections, gateOpen: true }).text).toContain("The lamp room's door");
  });

  test("a turn a continue ran again shows each of its runs by its own id, what each sent to the chat, and each run's agents behind the gate", () => {
    const turn = continuedTurn();
    const shut = turnView({ turn, gateOpen: false });
    expect(shut.text).toContain("Its runs");
    expect(shut.text).toContain(`Run 1 of 2, ${RUN}.1: New reply, led by author`);
    expect(shut.text).toContain(`Run 2 of 2, ${RUN}.2: Continue, led by author`);
    // What the first run sent, from its own reply, and what the latest sent.
    expect(shut.text).toContain(REPLY.split("\n")[0] as string);
    expect(shut.text).toContain(CONTINUED_REPLY);
    expect(shut.text).not.toContain("is not shown");
    const open = turnView({ turn, gateOpen: true });
    const byRun = elements(open.tree)
      .filter((e) => e.props["data-run-of"] !== undefined && elements(e.props.children).some((c) => c.props["data-agent"] !== undefined))
      .map((e) => [e.props["data-run-of"], elements(e.props.children).flatMap((c) => (c.type === "details" && typeof c.props["data-agent"] === "string" ? [c.props["data-agent"]] : []))]);
    expect(byRun).toEqual([
      [RUN_FIRST, ["a1", "a2", "a3"]],
      [RUN_SECOND, ["a1"]],
    ]);
  });

  test("behind the gate: the turn's folder as RPE lists it, each file opened on demand, and what each agent's first call was sent", () => {
    const files = [
      { name: "briefing.md", bytes: 2_048, folder: false },
      { name: "transcripts", bytes: 900, folder: true },
      { name: requestFile(AUTHOR, 1), bytes: 900, folder: false },
      { name: "world-state.md", bytes: 512, folder: false },
    ];
    const folder: FolderShown = { files, problem: null, open: null };
    expect(turnView({ folder, gateOpen: false }).text).not.toContain("world-state.md");
    const open = turnView({ folder, gateOpen: true });
    for (const name of ["briefing.md", "world-state.md", requestFile(AUTHOR, 1)]) expect(open.text).toContain(name);
    press(open.tree, "world-state.md");
    // Each agent's first call, by the request file the run names for it: its request is rebuilt by RPE, not read as a file.
    for (const agent of [AUTHOR, GM, MOIRA]) press(open.tree, `${agent.definition} (${agent.id}), call 1`);
    expect(open.pressed).toEqual(["file:world-state.md", ...[AUTHOR, GM, MOIRA].map((a) => `request:${requestFile(a, 1)}`)]);

    // A request rebuilt exactly as it was sent is laid out as its messages, in order, each said to be the turn's files or added to them.
    const request = {
      same: true,
      messages: [
        { role: "system", text: "You are the Author of this story.", block: "opening" },
        { role: "user", text: "Ash: Why did the lamp go dark?", block: "prompt" },
      ],
      tools: [{ name: "todo" }],
    };
    const sent = turnView({ gateOpen: true, folder: { ...folder, open: { name: requestFile(AUTHOR, 1), text: null, request, problem: null } } });
    expect(sent.text).toContain("systemaddedopeningYou are the Author of this story.");
    expect(sent.text).toContain("userthe turn's filespromptAsh: Why did the lamp go dark?");
    // One that does not rebuild to what was sent shows none of it.
    const unsure = turnView({ gateOpen: true, folder: { ...folder, open: { name: requestFile(AUTHOR, 1), text: null, request: { ...request, same: false, messages: [] }, problem: null } } });
    expect(unsure.text).toContain("This request cannot be shown as it was sent");
    // Any other file is its text as written; one RPE would not give says why in its words.
    const state = turnView({ gateOpen: true, folder: { ...folder, open: { name: "world-state.md", text: "## The lamp room\nDusk; wind from the north.", request: null, problem: null } } });
    expect(state.text).toContain("## The lamp room\nDusk; wind from the north.");
    press(state.tree, "Close");
    expect(state.pressed).toEqual(["close-file"]);
    const refused = "Turn turn-31's folder has no file notes.md.";
    expect(turnView({ gateOpen: true, folder: { ...folder, open: { name: "notes.md", text: null, request: null, problem: refused } } }).text).toContain(refused);
  });

  test("the turn's folder is read when asked for, a file by its path; only the file open now is shown, and nothing once the page has left", async () => {
    const asked: { key: string; params: Readonly<Record<string, string>>; answer(value: unknown): void; fail(error: Error): void }[] = [];
    const client: Pick<RpeClient, "call"> = {
      call: ((key: string, params: Readonly<Record<string, string>>) => {
        const { promise, resolve, reject } = Promise.withResolvers<unknown>();
        asked.push({ key, params, answer: resolve, fail: reject });
        return promise;
      }) as RpeClient["call"],
    };
    const shown: FolderShown[] = [];
    const folder = readFolder(client, CHAT, RUN, (now) => shown.push(now));
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/chats/:chat/turns/:turn/files", params: { chat: CHAT, turn: RUN } });
    asked[0]?.answer({ files: [{ name: "world-state.md", bytes: 512, folder: false }] });
    await settle();
    expect(shown.at(-1)).toEqual({ files: [{ name: "world-state.md", bytes: 512, folder: false }], problem: null, open: null });
    folder.open("world-state.md");
    expect(asked[1]).toMatchObject({ key: "GET /api/v1/chats/:chat/turns/:turn/files/*", params: { chat: CHAT, turn: RUN, "*": "world-state.md" } });
    // Another file is opened before the first comes: the first's answer is let go.
    folder.open("briefing.md");
    asked[1]?.answer({ name: "world-state.md", text: "Dusk." });
    await settle();
    expect(shown.at(-1)?.open).toEqual({ name: "briefing.md", text: null, request: null, problem: null });
    asked[2]?.fail(new Error("Turn turn-31's folder has no file briefing.md."));
    await settle();
    expect(shown.at(-1)?.open).toEqual({ name: "briefing.md", text: null, request: null, problem: "Turn turn-31's folder has no file briefing.md." });
    folder.close();
    expect(shown.at(-1)?.open).toBeNull();
    folder.open("turn.json");
    folder.stop();
    const told = shown.length;
    asked[3]?.answer({ name: "turn.json", text: "{}" });
    await settle();
    expect(shown.length).toBe(told);
  });

  test("while it runs, the page shows what the live road has said since the turn was read", () => {
    const read = turnAt(20);
    expect(read.status).toBe("running");
    const heard = RECORDED.slice(20).reduce(applyLive, applyRead(EMPTY_LIVE, read));
    const shown = liveTurn(read, runOf(heard, RUN_FIRST));
    expect(shown.status).toBe("released");
    expect(shown.usage).toEqual(TOTAL);
    expect(shown.timings.released).toBe(RECORDS.find((r) => r.event.kind === "released")?.at as number);
    expect(shown.timings.ended).toBe(RECORDS.at(-1)?.at as number);
    const midway = liveTurn(read, runOf(RECORDED.slice(20, 54).reduce(applyLive, applyRead(EMPTY_LIVE, read)), RUN_FIRST));
    expect(midway.status).toBe("running");
    expect(midway.usage.calls).toBe(4);
    expect(turnView({ turn: shown, gateOpen: false }).text).toContain("Reply released");
  });
});

describe("the Turns page", () => {
  test("when the turns could not be read, it says so, and not that there are none", () => {
    const text = textOf(expand(h(TurnsView, { turns: [], more: false, loading: false, problem: "RPE did not answer: Failed to fetch", onOpen: () => undefined, onMore: () => undefined })));
    expect(text).toContain("RPE did not answer: Failed to fetch");
    expect(text).not.toContain("No turn played");
  });

  test("a chat a migration imported and RPE has not played: the Chats page says so where a last turn's time would be and opens it, and its Turns page says no turn of it was played on RPE", () => {
    const unplayed = CHATS.chats.find((c) => !c.played);
    if (unplayed === undefined) throw new Error("the recorded chats hold no unplayed chat");
    const opened: string[] = [];
    const list = expand(h(ChatsView, { chats: CHATS.chats, problem: null, onOpen: (chat) => opened.push(chat), onPlay: () => undefined, onRead: () => undefined }));
    const row = elements(list).find((e) => e.props["data-chat"] === unplayed.id);
    expect(textOf(row?.props.children)).toBe(`${unplayed.name}Imported, not played on RPE yet`);
    (row?.props.onClick as () => void)();
    expect(opened).toEqual([unplayed.id]);
    const text = textOf(expand(h(TurnsView, { turns: [], more: false, loading: false, problem: null, onOpen: () => undefined, onMore: () => undefined })));
    expect(text).toContain("No turn played on RPE yet");
    expect(text).toContain("A turn shows here once RPE plays a reply in this chat.");
  });

  test("older turns asked for in one chat never show in the chat the page has moved to", async () => {
    const asked: { chat: string; before: string | undefined; answer(list: TurnsReply): void }[] = [];
    const client: Pick<RpeClient, "call"> = {
      call: ((_key: string, params: { chat: string }, options?: { query?: { before?: string } }) => {
        const { promise, resolve } = Promise.withResolvers<TurnsReply>();
        asked.push({ chat: params.chat, before: options?.query?.before, answer: resolve });
        return promise;
      }) as RpeClient["call"],
    };
    const inFirst: TurnsRead[] = [];
    const first = readTurns(client, CHAT, 30, (read) => inFirst.push(read));
    asked[0]?.answer({ turns: EARLIER.slice(0, 2), more: true });
    await settle();
    expect(inFirst.at(-1)?.turns.map((t) => t.id)).toEqual(["turn-30", "turn-29"]);
    first.more();
    expect(asked[1]).toMatchObject({ chat: CHAT, before: "turn-29" });
    // Lumiverse opens another chat before the older turns come: the page reads that chat's turns instead.
    first.stop();
    const shownBefore = inFirst.length;
    const inSecond: TurnsRead[] = [];
    readTurns(client, "chat-orchard", 30, (read) => inSecond.push(read));
    asked[2]?.answer({ turns: [{ ...EARLIER[0], id: "turn-o1" } as (typeof EARLIER)[number]], more: false });
    await settle();
    asked[1]?.answer({ turns: EARLIER.slice(2), more: false });
    await settle();
    expect(inFirst.length).toBe(shownBefore);
    expect(inSecond.at(-1)?.turns.map((t) => t.id)).toEqual(["turn-o1"]);
  });

  test("a run that begins or ends reads the newest turns again and puts them in front of those held: the list never empties while it reads, older turns read further back stay, a turn run again moves up, and a page that does not reach the turns held stands alone", async () => {
    const asked: { before: string | undefined; answer(list: TurnsReply): void }[] = [];
    const client: Pick<RpeClient, "call"> = {
      call: ((_key: string, _params: { chat: string }, options?: { query?: { before?: string } }) => {
        const { promise, resolve } = Promise.withResolvers<TurnsReply>();
        asked.push({ before: options?.query?.before, answer: resolve });
        return promise;
      }) as RpeClient["call"],
    };
    const [t30, t29, t28] = EARLIER as [TurnRow, TurnRow, TurnRow];
    const t31: TurnRow = { ...t30, id: "turn-31" };
    const shown: TurnsRead[] = [];
    const reader = readTurns(client, CHAT, 30, (read) => shown.push(read));
    asked[0]?.answer({ turns: [t30, t29], more: true });
    await settle();
    reader.more();
    expect(asked[1]?.before).toBe("turn-29");
    asked[1]?.answer({ turns: [t28], more: false });
    await settle();
    const ids = (): string[] | undefined => shown.at(-1)?.turns.map((t) => t.id);
    expect(ids()).toEqual(["turn-30", "turn-29", "turn-28"]);
    const held = shown.length;

    reader.refresh();
    expect(asked[2]?.before).toBeUndefined();
    // Nothing is shown while it reads: the list stands as it was.
    expect(shown.length).toBe(held);
    asked[2]?.answer({ turns: [t31, t30], more: true });
    await settle();
    expect(ids()).toEqual(["turn-31", "turn-30", "turn-29", "turn-28"]);
    expect(shown.at(-1)).toMatchObject({ more: false, loading: false });

    reader.refresh();
    asked[3]?.answer({ turns: [t29, t31], more: true });
    await settle();
    expect(ids()).toEqual(["turn-29", "turn-31", "turn-30", "turn-28"]);

    reader.refresh();
    asked[4]?.answer({ turns: [{ ...t30, id: "turn-90" }, { ...t30, id: "turn-89" }], more: true });
    await settle();
    expect(ids()).toEqual(["turn-90", "turn-89"]);
    expect(shown.at(-1)?.more).toBe(true);
    expect(shown.slice(held).every((read) => read.turns.length > 0 && !read.loading)).toBe(true);
    reader.stop();
  });
});

describe("the web shell's addresses", () => {
  test("each page's address leads back to it", () => {
    const routes: Route[] = [{ page: "chats" }, { page: "live", chat: CHAT }, { page: "turns", chat: "chat a/b" }, { page: "turns", chat: CHAT, at: ["turn-31"] }];
    for (const route of routes) expect(routeOfHash(hashOf(route))).toEqual(route);
    expect(routeOfHash("")).toEqual({ page: "chats" });
    expect(routeOfHash("#/chats/x/nowhere/at/all")).toEqual({ page: "live", chat: "x" });
  });
});

describe("the web shell's storage", () => {
  test("where the browser refuses the site its storage, the shell still starts, and keeps the token for the page alone", () => {
    const refusing = (): Storage => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    expect(siteStorage(refusing)).toBeNull();
    const tokens = storedTokens(siteStorage(refusing));
    expect(tokens.get()).toBeNull();
    tokens.set("rpw_kept-here");
    expect(tokens.get()).toBe("rpw_kept-here");
  });
});
