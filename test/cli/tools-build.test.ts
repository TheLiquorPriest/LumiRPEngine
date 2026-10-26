// Lore, jobs, the rest of Build and a chat's map through the agent's tools,
// against the real backend.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { toolsFor } from "../../src/cli/tools";
import { cliRig } from "../support/cli-rig";
import type { Rig } from "../support/rig";

/** The JSON a read tool answers after its header line. */
const body = (text: string): unknown => JSON.parse(text.slice(text.indexOf("\n\n") + 2));

async function draftOf(rig: Rig, worldId: string): Promise<WorldDoc> {
  return (await rig.rt.worlds.working(worldId, rig.host.userId)) as WorldDoc;
}

/** A World Info entry as the host's UI writes one. */
const bookEntry = (comment: string, content: string) => ({ comment, content, keys: [comment.toLowerCase()], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} });

describe("lore through the tools", () => {
  test("books and their entries read as a pin picker has them; a world's pins read now, a chat's only behind spoilers; Save to lore writes the draft", async () => {
    const { rig, call, raw } = await cliRig();
    const bookId = await rig.host.books.create("Harbor lore", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, bookEntry("The pier", "Boats tie up here."), rig.host.userId);
    expect((await call("lre_lore_books")).books).toEqual([{ id: bookId, name: "Harbor lore", attached: false, character: false, added: null }]);
    expect((body((await raw("lre_lore_entries", { bookId })).text) as { entries: unknown[] }).entries).toEqual([expect.objectContaining({ id: entryId, disabled: false })]);

    const chatId = await rig.worldChat();
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    await call("lre_edit", { worldId, ops: [{ op: "add", path: "/lorePins", value: { characters: { dev: [{ book: bookId, entry: entryId }] }, places: {} } }] });
    const pins = body((await raw("lre_lore_pins", { worldId })).text) as { characters: Record<string, { status: string; source: string }[]> };
    expect(pins.characters.dev).toEqual([expect.objectContaining({ status: "ok", source: "Harbor lore" })]);
    const gated = await raw("lre_lore_pins", { chatId });
    expect(gated.isError).toBe(true);
    expect(gated.text).toContain("spoilers: true");
    expect((await raw("lre_lore_pins", { chatId, spoilers: true })).isError).toBeUndefined();

    await rig.turn(chatId, "I look at the pier.", "Gulls wheel over the pier at dawn.");
    const saved = await call("lre_lore_save", { chatId });
    expect(saved.worldId).toBe(worldId);
    const id = String(saved.id);
    expect((await draftOf(rig, worldId)).lore[id]).toMatchObject({ content: "Gulls wheel over the pier at dawn.", source: { kind: "chat", chatId } });
  });
});

describe("jobs through the tools", () => {
  test("an indexing job is started, followed and read; its proposals apply to the draft as Build's review does, in one write; a book's later edit shows as drift", async () => {
    const { rig, call, raw } = await cliRig();
    const worldId = await rig.newWorld();
    const bookId = await rig.host.books.create("Market book", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, bookEntry("Night market", "Stalls open at dusk on the pier."), rig.host.userId);
    rig.host.quietReply = () => JSON.stringify({ entries: [{ key: "night_market", title: "Night market", aliases: ["the market"], topics: ["Harbor life"], terms: ["stalls"], links: [], confidence: 0.9, source: entryId }] });
    const started = await call("lre_job_start", { worldId, kind: "index_book", bookId });
    const jobId = String(started.jobId);
    const jobs = (await call("lre_jobs", { worldId })).jobs as { jobId: string; status: string; result: { proposals: number } | null }[];
    expect(jobs).toEqual([expect.objectContaining({ jobId, status: "done" })]);
    const proposals = body((await raw("lre_job", { worldId, jobId, pointer: "/result/proposals" })).text) as { id: string; key: string }[];
    expect(proposals.length).toBeGreaterThan(0);

    const version = (await rig.rt.worlds.edit({ lre: 1, type: "lre.editor", reqId: "", worldId, base: null, op: "get" }, rig.host.userId)).version;
    const applied = await call("lre_job_apply", { worldId, jobId, expectVersion: version });
    expect(applied.applied).toEqual(proposals.map((p) => p.id));
    const draft = await draftOf(rig, worldId);
    for (const p of proposals) expect(draft.lore[p.key]).toBeDefined();
    expect(Object.keys(draft.loreIndex.topics)).toContain("harbor_life");

    // The book's entry changed since it was indexed: the drift says so, with its text now.
    const entry = (await rig.host.books.entries(bookId, rig.host.userId))[0];
    rig.host.editEntry(entry?.id ?? "", { content: "Stalls open at noon now." });
    const drift = body((await raw("lre_lore_drift", { worldId })).text) as { drift: Record<string, { status: string; content?: string }> };
    expect(Object.values(drift.drift)).toEqual([expect.objectContaining({ status: "changed", content: "Stalls open at noon now." })]);

    await call("lre_job_dismiss", { jobId });
    expect((await call("lre_jobs", { worldId })).jobs).toEqual([]);
  });

  test("a job is told what its kind takes, before anything is sent", async () => {
    const { raw } = await cliRig();
    const wrong = await raw("lre_job_start", { worldId: "w_x", kind: "playtest", days: 2 });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("playtest doesn't take days");
  });

  test("a routines job is started for the people named; its counts say what has problems, and an apply takes only what has none unless named", async () => {
    const { rig, call, raw } = await cliRig({ shipped: true });
    const worldId = String((await call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" })).worldId);
    const anchor = { lore: "lore_anchor", quote: "a Thursday trivia night that gets competitive" };
    rig.host.quietReply = () =>
      JSON.stringify({
        routines: [
          { owner: "danny_okafor", id: "trivia", label: "Trivia night", activity: "socialize", kind: "fixed", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor", source: anchor, confidence: 0.8 },
          { owner: "danny_okafor", id: "quiz", label: "Quiz night", activity: "socialize", kind: "fixed", at: "19:00", minutes: 120, days: { weekdays: [2] }, place: "quiz_barn", source: anchor, confidence: 0.8 },
        ],
        schedules: [],
      });
    const none = await raw("lre_job_start", { worldId, kind: "propose_routines", owners: [] });
    expect(none.isError).toBe(true);
    expect(none.text).toContain("owners names at least one person or group");
    const jobId = String((await call("lre_job_start", { worldId, kind: "propose_routines", owners: ["danny_okafor"] })).jobId);
    const jobs = (await call("lre_jobs", { worldId })).jobs as { jobId: string; input: unknown; result: unknown }[];
    expect(jobs).toEqual([expect.objectContaining({ jobId, input: { owners: ["danny_okafor"] }, result: { proposals: 2, byCollection: { routines: 2 }, withProblems: 1 } })]);
    const proposals = body((await raw("lre_job", { worldId, jobId, pointer: "/result/proposals" })).text) as { id: string; key: string; owner: string; problems?: string[] }[];
    expect(proposals.map((p) => [p.key, p.owner, p.problems])).toEqual([
      ["danny_okafor_trivia", "danny_okafor", undefined],
      ["danny_okafor_quiz", "danny_okafor", ["Routine danny_okafor_quiz, block quiz: there's no place quiz_barn; it happens at home."]],
    ]);
    const applied = await call("lre_job_apply", { worldId, jobId });
    expect(applied.applied).toEqual(["routines:danny_okafor_trivia"]);
    const draft = await draftOf(rig, worldId);
    expect(Object.keys(draft.routines ?? {})).toEqual(["danny_okafor_trivia"]);
    // Named, a proposal with problems is applied all the same: the author has looked at it.
    expect((await call("lre_job_apply", { worldId, jobId, proposals: ["routines:danny_okafor_quiz"] })).applied).toEqual(["routines:danny_okafor_quiz"]);
  });
});

describe("the rest of Build through the tools", () => {
  test("a profile previews, then applies in one write; the sheet preview reads the draft's ruleset; the head lints", async () => {
    const { rig, call } = await cliRig({ shipped: true });
    const worldId = String((await call("lre_world_create", { name: "Brindle", template: "fantasy_town" })).worldId);
    const preview = await call("lre_profile", { worldId, profile: "fifth", preview: true });
    expect((preview.add as unknown[]).length).toBeGreaterThan(0);
    expect((await draftOf(rig, worldId)).ruleset?.profile).not.toBe("fifth");
    const applied = await call("lre_profile", { worldId, profile: "fifth" });
    expect((await draftOf(rig, worldId)).ruleset?.profile).toBe("fifth");
    expect(applied.version).toBe(1);
    const read = await call("lre_lint", { worldId });
    expect(read).toMatchObject({ worldId, lint: { errors: 0 } });
  });

  test("the sheet preview builds the draft's ruleset on the point of view", async () => {
    const { call, raw } = await cliRig({ shipped: true });
    const worldId = String((await call("lre_world_create", { name: "Brindle", template: "fantasy_town" })).worldId);
    await call("lre_profile", { worldId, profile: "fifth" });
    const sheet = body((await raw("lre_sheet", { worldId })).text) as { sheet: { title: string; rows: unknown[] }[] };
    expect(sheet.sheet.length).toBeGreaterThan(0);
  });
});

describe("a chat's map through the tools", () => {
  test("Walk here is judged without moving anyone; the display is kept beside the chat", async () => {
    const { rig, call, raw } = await cliRig({ shipped: true });
    const worldId = String((await call("lre_world_create", { name: "Brindle", template: "fantasy_town" })).worldId);
    const chatId = rig.host.createChat("Good morning.");
    await call("lre_attach", { worldId, chatId });
    const walk = await call("lre_map_walk", { chatId, x: 0, y: 0 });
    expect(typeof walk.minutes).toBe("number");
    expect(await call("lre_map_display", { chatId, display: "fog" })).toEqual({ chatId, display: "fog" });
    const panels = (await rig.rt.view(chatId, rig.host.userId)).panels as Record<string, unknown>;
    const map = panels["space.map"];
    expect(isRecord(map) ? map.display : null).toBe("fog");
    expect((await raw("lre_map_display", { chatId, display: "satellite" })).isError).toBe(true);
  });
});

describe("read-only mode", () => {
  test("hides the lore, job, Build and map tools that write, and keeps the ones that read", () => {
    const listed = toolsFor(true).map((t) => t.name);
    for (const name of ["lre_lore_save", "lre_job_start", "lre_job_apply", "lre_job_cancel", "lre_job_dismiss", "lre_profile", "lre_map_display"]) expect(listed).not.toContain(name);
    for (const name of ["lre_lore_books", "lre_lore_entries", "lre_lore_pins", "lre_lore_drift", "lre_jobs", "lre_job", "lre_lint", "lre_sheet", "lre_map_walk"]) expect(listed).toContain(name);
  });

  test("refuses a write before anything is sent", async () => {
    const { rig, raw } = await cliRig();
    const worldId = await rig.newWorld();
    const refused = await raw("lre_job_start", { worldId, kind: "index_text", text: "The pier." }, true);
    expect(refused.isError).toBe(true);
    expect(await rig.jobs.list(worldId, rig.host.userId)).toEqual([]);
  });
});
