// The bootstrap on the pages: on a chat's Story page, the six facts of "done enough" as the route gives
// them (each with its counts, or not known with the page's words for why), with no verdict on any of
// them, since whether the record is done enough is the bootstrap skill's to say; the chat's bootstrap
// jobs with how each stands; and a start for each choice of how much to relive, the word passed to the
// route as said; on the Migration page, the start for every chat the migration carried, with which
// started and which were refused, and why. Every name and number here is made up.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { type BatchShown, BatchOffer, type BootstrapShown, BootstrapView, NO_BATCH, NO_BOOTSTRAP, readBootstrap, startCarried } from "../../src/ui/pages/bootstrap";
import { MigrationView } from "../../src/ui/pages/migration";
import { askingClient, settle } from "./asking";
import { BATCH as ANSWER, BOOT, job } from "./bootstrap-recorded";
import { MIGRATED } from "./migration-recorded";
import { CHAT } from "./records-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function view(shown: Partial<BootstrapShown>) {
  const started: unknown[] = [];
  const tree = expand(h(BootstrapView, { shown: { ...NO_BOOTSTRAP, loading: false, chat: BOOT, ...shown }, onStart: (relive) => started.push(relive) }));
  return { tree, text: textOf(tree), started };
}

const fact = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-fact"] === id)?.props.children);

describe("the bootstrap on a chat's page", () => {
  test("the six facts in the skill's order, each with its counts, or not known in the page's words; none says whether it holds", () => {
    const { tree } = view({});
    expect(elements(tree).flatMap((e) => (typeof e.props["data-fact"] === "string" ? [e.props["data-fact"]] : []))).toEqual(["lore", "history", "cast", "story", "horizon", "principals"]);
    expect(fact(tree, "lore")).toBe("The lore index12 entries, 12 indexed as they stand, 0 indexed at an earlier revision");
    expect(fact(tree, "history")).toBe("The history the window leaves outnot knownIts records could not be read; RPE's log says what failed.");
    expect(fact(tree, "cast")).toBe("The cast3 characters, 2 castNot cast: Tobin Reede");
    expect(fact(tree, "story")).toContain("1 premise, 1 chapter, 2 scenes, 5 beats");
    expect(fact(tree, "story")).toContain("2 threads (1 open), 0 arcs, 1 reading of the player");
    expect(fact(tree, "story")).toContain("0 of 1 principal with an arc");
    expect(fact(tree, "horizon")).toBe("The horizon2 entries, 1 naming a place or thing of the world; story time kept");
    expect(fact(tree, "principals")).toBe("Each principal's base and memoriesOdile Holt: base seed; 0 memories");
    expect(textOf(elements(tree).find((e) => e.props["data-facts"] === "true")?.props.children)).not.toMatch(/\bhold/);
  });

  test("the chat's bootstrap jobs with how each stands, what each was given, and a report as the text it is", () => {
    const { tree } = view({});
    const jobs = elements(tree).filter((e) => typeof e.props["data-job"] === "string");
    expect(jobs.map((e) => e.props["data-job"])).toEqual(["job-1", "job-2", "job-0"]);
    expect(textOf(jobs[0]?.props.children)).toContain("done");
    expect(textOf(jobs[0]?.props.children)).toContain("Relive: outline · stops at 200,000 tokens sent and written");
    expect(elements(jobs[0]?.props.children).find((e) => e.type === "pre")?.props.children).toBe("Recorded the premise, one chapter and the cast.");
    expect(textOf(jobs[1]?.props.children)).toContain("running");
    expect(textOf(jobs[1]?.props.children)).toContain("Relive: as the skill decides");
    expect(textOf(jobs[2]?.props.children)).toContain("no longer held by the harness");
  });

  test("each start passes its choice of how much to relive as said, or none; a refusal is shown in RPE's words", () => {
    const { tree, started } = view({});
    for (const words of ["outline", "key moments", "all", "as the skill decides"]) press(tree, words);
    expect(started).toEqual(["outline", "key moments", "all", null]);
    expect(banners(view({ refused: "A bootstrap job of this chat is under way." }).tree)).toEqual([{ title: "Not started", text: "Not startedA bootstrap job of this chat is under way." }]);
  });

  test("it reads the facts and jobs; a start posts the word, or an empty body, and reads again; what comes back once the page left is let go", async () => {
    const { client, asked } = askingClient();
    const shown: BootstrapShown[] = [];
    const reader = readBootstrap(client, CHAT, (s) => shown.push(s));
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/chats/:chat/bootstrap", params: { chat: CHAT } });
    asked[0]?.answer(BOOT);
    await settle();
    reader.start("key moments");
    expect(asked[1]).toMatchObject({ key: "POST /api/v1/chats/:chat/bootstrap", body: { relive: "key moments" } });
    asked[1]?.answer(job("job-3", "queued"));
    await settle();
    expect(asked[2]?.key).toBe("GET /api/v1/chats/:chat/bootstrap");
    expect(shown.at(-1)).toMatchObject({ starting: false, started: { id: "job-3" } });
    reader.start(null);
    expect(asked[3]?.body).toEqual({});
    asked[3]?.fail(new Error("A bootstrap job of this chat is under way."));
    await settle();
    expect(shown.at(-1)?.refused).toBe("A bootstrap job of this chat is under way.");
    const count = shown.length;
    reader.stop();
    asked[2]?.answer(BOOT);
    await settle();
    expect(shown.length).toBe(count);
  });
});

describe("the bootstrap on the Migration page", () => {
  test("the offer shows for a run that carried chats, and not for one that carried none; it says which started and which were refused, and why", () => {
    const pressed: unknown[] = [];
    const offered = expand(h(MigrationView, { read: { shown: MIGRATED, loading: false, problem: null }, batch: { shown: NO_BATCH, onStart: (relive) => pressed.push(relive) } }));
    press(offered, "all");
    expect(pressed).toEqual(["all"]);
    const none = expand(h(MigrationView, { read: { shown: { ...MIGRATED, chats: MIGRATED.chats.filter((c) => c.outcome === "not imported") }, loading: false, problem: null }, batch: { shown: NO_BATCH, onStart: () => undefined } }));
    expect(elements(none).some((e) => e.props["data-section"] === "bootstrap")).toBe(false);
    const answered = textOf(expand(h(BatchOffer, { shown: { busy: false, answer: ANSWER, problem: null }, onStart: () => undefined })));
    expect(answered).toContain("Started (1)chat-calderjob job-9, running");
    expect(answered).toContain("Refused (1)chat-harbourA bootstrap job of this chat is under way.");
  });

  test("it asks the batch route for every chat the migration carried, with the word as said", async () => {
    const { client, asked } = askingClient();
    const heard: BatchShown[] = [];
    startCarried(client, "outline", (s) => heard.push(s));
    expect(asked[0]).toMatchObject({ key: "POST /api/v1/bootstrap", body: { chats: "migrated", relive: "outline" } });
    asked[0]?.answer(ANSWER);
    await settle();
    expect(heard.at(-1)).toEqual({ busy: false, answer: ANSWER, problem: null });
    startCarried(client, null, () => undefined);
    expect(asked[1]?.body).toEqual({ chats: "migrated" });
  });
});
