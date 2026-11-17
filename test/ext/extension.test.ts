// The light extension and RPE's adapter, end to end through a stand-in Lumiverse (STANDALONE-PLAN
// §4.2, §9.6, §18.1 row 0.4). Each test says what reached the model, what Lumiverse stored, and what
// RPE was asked and handed.

import { describe, expect, test } from "bun:test";
import { textOf as textKey } from "../../src/secrecy/lore-secrets";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { Generations } from "../../src/ext/generations";
import { promptInterceptor } from "../../src/ext/prompt";
import { worldInfoInterceptor } from "../../src/ext/question";
import { PRIORITY } from "../../src/ext/start";
import { QUESTION_WAIT_MS as DEADLINE_MS } from "../../src/adapter/lumiverse/settings";
import { ALL, FERRY_SECRET, FERRY_SHOWN, harborBooks, INDEXED_SECRET, PUBLIC_LORE, PRESET, promptText, Rig, RPE, USER, VAULT_SECRET, type RigOptions } from "./rig";
import { FakeClock, settle } from "../standin/clock";
import { WORLD_INFO_INTERCEPTOR_TIMEOUT_MS } from "../standin/lore";
import { installRpe } from "../standin/install";

const label = (i: number): string => `HIST-${String(i).padStart(2, "0")}`;
const WINDOW = [8, 9, 10, 11];
const LEFT_OUT = [0, 1, 2, 3, 4, 6, 7];

function bodyText(body: Record<string, unknown> | null): string {
  return promptText(Array.isArray(body?.messages) ? (body.messages as { content: unknown }[]) : []);
}

function historyOf(turn: { layout: { messages: { parts: { kind: string; source?: { id: string } }[] }[] } }): string[] {
  return turn.layout.messages.flatMap((m) => m.parts.filter((p) => p.kind === "history").map((p) => p.source?.id ?? "?"));
}

describe("the question before lore activates", () => {
  test("RPE is asked once, before lore activates; its secrets go in as it words them, the history is cut at the first message it keeps, and the request is tagged", async () => {
    const rig = await new Rig().start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    expect(out.reply).toMatchObject({ content: "The tide turns.", reasoning: "Thinking about the bay." });

    expect(rig.questions).toHaveLength(1);
    const q = rig.questions[0]!;
    const announced = rig.lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { generationId: string; targetMessageId: string };
    expect(q).toMatchObject({ user: USER, chat: "chat-harbor", purpose: "prompt", generation: { id: out.generationId!, type: "normal", speaker: { id: "char-ilsa", name: "Ilsa" } } });
    // The path the prompt is built from: the empty message being written is not on it.
    expect(q.path.map((s) => s.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11"]);
    expect(q.path.every((s) => s.swipe === 0)).toBe(true);
    // Text goes only with an entry that carries marks; every entry carries its text key.
    expect(q.entries.find((e) => e.id === "e-ferry")?.content).toContain("{{// Secret (known to Ilsa)");
    expect(q.entries.find((e) => e.id === "e-public")).toEqual({ id: "e-public", book: "book-harbor", disabled: false, key: textKey(PUBLIC_LORE) });

    const sent = bodyText(out.body);
    expect(sent).toContain(FERRY_SHOWN);
    expect(sent).toContain(PUBLIC_LORE);
    for (const kept of [VAULT_SECRET, INDEXED_SECRET]) expect(sent).not.toContain(kept);

    // What Lumiverse stores beside the reply holds only the window.
    const stored = out.stored!.messages.map((m) => m.content).join("\n");
    for (const i of WINDOW) expect(stored).toContain(label(i));
    for (const i of LEFT_OUT) expect(stored).not.toContain(label(i));

    const turn = rig.turns[0]!;
    expect(turn.tag).toMatchObject({ user: USER, chat: "chat-harbor", generation: out.generationId!, kind: "new", connection: "conn-rpe", preset: PRESET.id, target: { message: announced.targetMessageId, swipe: 0 }, speaker: { id: "char-ilsa", name: "Ilsa" } });
    expect(turn.lore.map((l) => l.id).sort()).toEqual(["e-ferry", "e-public"]);
    expect(turn.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: 7, byRpe: 0, told: true, notices: [] });
    expect(turn.layout.complete).toBe(true);
    // The player's last two lines, sent in a row, reach the interceptor as one message with the first one's id and number, the second
    // one's words inside it (`prompt-assembly.service.ts:3456-3461`, `:6754-6843`).
    expect(historyOf(turn)).toEqual(["m8", "m9", "m10"]);
    expect(turn.tag.messages.find((m) => m.source?.id === "m10")).toMatchObject({ role: "user", history: true, source: { id: "m10", index: 10 }, hash: textHash("HIST-10 I watch the shore.\n\nHIST-11 And I wait.") });
    expect(turn.tag.messages.some((m) => m.source?.id === "m11")).toBe(false);
  });

  test("with RPE stopped, every marked passage and every copy of one stays out at once, and a chat on another connection goes on with its whole prompt", async () => {
    const rig = await new Rig().start();
    rig.rpeDown();
    const out = await rig.generate("conn-rpe");
    expect(out.worldInfo.ms).toBeLessThan(500);
    // The reply cannot be played without RPE, and says so.
    expect(out.error).toContain("Unable to connect");
    const tried = bodyText(out.body);
    expect(tried).toContain("The ferry crosses the bay at dawn.");
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(tried).not.toContain(kept);

    const other = await rig.generate("conn-other");
    expect(other.error).toBeNull();
    expect(other.reply?.content).toBe("Another model's reply.");
    const body = rig.otherBodies[0]!;
    expect(body.rpe_turn).toBeUndefined();
    const text = bodyText(body);
    for (const i of [...LEFT_OUT, ...WINDOW]) expect(text).toContain(label(i));
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(text).not.toContain(kept);
  });

  test("with RPE slow, its answer is given up at the shipped three seconds, well inside Lumiverse's ten; every marked passage and copy stays out; RPE then cuts the window on receipt", async () => {
    // The extension's own three seconds pass in the process's time; Lumiverse's ten run on the clock the test holds, which moves only to run the worker's later tasks, so
    // its limit is the same ten seconds as ships and cannot come before the extension's answer is given up.
    const clock = new FakeClock();
    const rig = await new Rig({ questionDelayMs: 5_000, clock }).start();
    const began = performance.now();
    const generating = rig.generate("conn-rpe");
    let done = false;
    void generating.then(() => (done = true));
    while (!done) {
      await clock.advance(0);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    const out = await generating;
    const waited = performance.now() - began;
    expect(DEADLINE_MS).toBe(3_000);
    expect(waited).toBeGreaterThanOrEqual(DEADLINE_MS - 100);
    expect(waited).toBeLessThan(DEADLINE_MS + 500);
    expect(DEADLINE_MS).toBeLessThan(WORLD_INFO_INTERCEPTOR_TIMEOUT_MS);
    expect(rig.lv.log).not.toContain("World-info interceptor timed out after 10s; skipping");
    expect(out.worldInfo.ms).toBeLessThan(WORLD_INFO_INTERCEPTOR_TIMEOUT_MS);
    expect(out.error).toBeNull();
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(bodyText(out.body)).not.toContain(kept);

    const turn = rig.turns[0]!;
    expect(turn.tag.cut).toEqual({ answered: false });
    expect(turn.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: null, byRpe: 7, told: true, notices: [] });
    expect(historyOf(turn)).toEqual(["m8", "m9", "m10"]);
    const played = promptText(turn.prompt);
    for (const i of LEFT_OUT) expect(played).not.toContain(label(i));
    // With no answer to cut by, Lumiverse sent the whole history and stored it beside the reply.
    expect(out.stored!.messages.map((m) => m.content).join("\n")).toContain(label(1));
  });

  test("past Lumiverse's own limit for a World Info interceptor the extension's answer is not waited for, and the unmarked copy of a secret reaches the prompt: why the deadline is well inside it", async () => {
    // Lumiverse's own ten seconds, on the clock the test moves, against an extension told to wait eleven for RPE, which answers at twelve.
    const clock = new FakeClock();
    const rig = await new Rig({ questionDelayMs: 12_000, deadlineMs: 11_000, clock }).start();
    const generating = rig.generate("conn-other");
    // RPE's delay is set when the generation reaches the interceptor, which asks the question.
    for (let i = 0; i < 1_000 && rig.questions.length === 0; i++) await new Promise<void>((resolve) => setTimeout(resolve, 1));
    await clock.advance(10_000);
    const out = await generating;
    expect(out.error).toBeNull();
    expect(rig.lv.log).toContain("World-info interceptor timed out after 10s; skipping");
    const text = bodyText(rig.otherBodies[0]!);
    expect(text).toContain(VAULT_SECRET);
    // Lumiverse strips a marked passage by itself.
    expect(text).not.toContain(FERRY_SECRET);
  });

  test("for a user with no registration (RPE has not registered yet, or is not theirs), RPE is not asked, and every marked passage and every copy of one still stays out of the prompt", async () => {
    const rig = await new Rig().start();
    // Another user of the same Lumiverse, with the harbor's books of their own and a character of their own: Lumiverse reads a user's own books alone.
    for (const book of harborBooks("user-wren", "-wren")) rig.lv.library.addBook(book);
    rig.lv.addChat({ ...rig.chat, id: "chat-wren", user: "user-wren", character: { id: "char-ilsa-wren", name: "Ilsa", extensions: { world_book_ids: ["book-card-wren"] } }, metadata: { chat_world_book_ids: ["book-harbor-wren"] } });
    const out = await rig.lv.generate({ chat: "chat-wren", connection: "conn-other", preset: PRESET.id });
    expect(out.error).toBeNull();
    expect(rig.questions).toEqual([]);
    const text = bodyText(rig.otherBodies[0]!);
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(text).not.toContain(kept);
    // Only RPE knows that one is secret, and nothing marks it.
    for (const shown of [PUBLIC_LORE, INDEXED_SECRET, "The ferry crosses the bay at dawn."]) expect(text).toContain(shown);
  });

  test("nothing is kept from one generation to the next: with RPE stopped, a running worker and a restarted one answer the same, by the marks alone", async () => {
    const rig = await new Rig().start();
    await rig.generate("conn-rpe");
    rig.rpeDown();
    await rig.generate("conn-other");
    const running = bodyText(rig.otherBodies[0]!);
    // Only RPE knows the indexed entry is secret, and nothing marks it: with no answer it goes in.
    expect(running).toContain(INDEXED_SECRET);
    for (const kept of [VAULT_SECRET, FERRY_SECRET]) expect(running).not.toContain(kept);
    expect(running).toContain(PUBLIC_LORE);

    await rig.restart();
    await rig.generate("conn-other");
    const restarted = bodyText(rig.otherBodies[1]!);
    expect(restarted).toContain(INDEXED_SECRET);
    for (const kept of [VAULT_SECRET, FERRY_SECRET]) expect(restarted).not.toContain(kept);
  });

  test("a swipe is tagged as one, aimed at the swipe Lumiverse made, and the message it replaces is not on the path RPE is asked about", async () => {
    const rig = await new Rig().start();
    const first = await rig.generate("conn-rpe");
    const reply = (rig.lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { targetMessageId: string }).targetMessageId;
    expect(first.error).toBeNull();
    const swipe = await rig.generate("conn-rpe", { type: "swipe" });
    expect(swipe.error).toBeNull();
    expect(rig.turns[1]!.tag).toMatchObject({ kind: "swipe", target: { message: reply, swipe: 1 } });
    expect(rig.questions[1]!.path.map((s) => s.id)).not.toContain(reply);
  });
});

describe("the request's parts, told apart", () => {
  const MODES = ["", "merge", "semi", "strict", "single"];
  /** The preset's prefill, which Lumiverse sends as a partial last message (`prompt-assembly.service.ts:4183-4192`). */
  const PREFILL = "PREFILL-HARBOR Ilsa looks up from the nets and";
  /**
   * The joins Lumiverse makes inside its assembly, before the interceptor sees the prompt (`prompt-assembly.service.ts:4210`,
   * `:7129-7231`): the player's two last lines are joined in every case (`:6754-6843`); the preset may also squash its system messages,
   * write the speakers' names into the text, and send system as the user's.
   */
  const JOINED: { name: string; completion: NonNullable<RigOptions["completion"]> }[] = [
    { name: "queued lines joined", completion: {} },
    { name: "queued lines joined, system messages squashed, names in content", completion: { squashSystemMessages: true, namesBehavior: 2 } },
    { name: "queued lines joined, squashed, names in content, system as user", completion: { squashSystemMessages: true, namesBehavior: 2, useSystemPrompt: false } },
  ];
  for (const post of MODES) {
    for (const collapse of [false, true]) {
      for (const { name, completion } of JOINED) {
        const mode = `post-processing "${post || "none"}", collapse ${collapse ? "on" : "off"}, ${name}`;
        test(`${mode}: every part of the body is accounted for by the tag`, async () => {
          const rig = await new Rig({ postProcessing: post, collapse, prefill: PREFILL, picture: true, completion }).start();
          const out = await rig.generate("conn-rpe");
          expect(out.error).toBeNull();
          const turn = rig.turns[0]!;
          expect(turn.layout.complete).toBe(true);
          expect(turn.cut.byRpe).toBe(0);
          turn.layout.messages.forEach((m, k) => {
            const text = promptText([turn.prompt[k]!]);
            expect(m.length).toBe(text.length);
            let at = 0;
            for (const part of m.parts) {
              expect(part.kind).not.toBe("unknown");
              // Between two parts stands only what Lumiverse put there when it joined them.
              expect(["", "\n\n"]).toContain(text.slice(at, part.start));
              expect(textHash(text.slice(part.start, part.end))).toBe(part.hash);
              at = part.end;
            }
            expect(text.slice(at)).toBe("");
          });
          expect(historyOf(turn)).toEqual(["m8", "m9", "m10"]);
          // The prefill is the body's last part, as the tag listed it: the partial assistant message that ends the prompt, the
          // character's name before it where the preset writes names into the text (`:7196-7208`, after the prefill at `:4183-4192`).
          const prefill = completion.namesBehavior === 2 ? `Ilsa: ${PREFILL}` : PREFILL;
          expect(turn.tag.messages.at(-1)).toMatchObject({ role: "assistant", partial: true, hash: textHash(prefill) });
          const last = turn.layout.messages.at(-1)!.parts.at(-1)!;
          expect([last.role, last.kind, last.hash]).toEqual(["assistant", "other", textHash(prefill)]);
          expect(promptText([turn.prompt.at(-1)!]).endsWith(PREFILL)).toBe(true);
        });

        test(`${mode}: a window RPE cuts on receipt gives the prompt Lumiverse makes when the extension cuts`, async () => {
          const options = { postProcessing: post, collapse, prefill: PREFILL, picture: true, completion };
          const cutByExtension = await new Rig(options).start();
          await cutByExtension.generate("conn-rpe");
          const cutByRpe = await new Rig({ ...options, windowFailsAtQuestion: true }).start();
          await cutByRpe.generate("conn-rpe");
          const [a, b] = [cutByExtension.turns[0]!, cutByRpe.turns[0]!];
          expect(a.tag.cut).toMatchObject({ answered: true });
          expect(b.tag.cut).toEqual({ answered: false });
          // Counted by the chat's rows (`receipt.ts`): m11, inside m10's message, counts as a message of the window.
          expect(b.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byRpe: 7 });
          expect(b.prompt).toEqual(a.prompt);
          expect(b.layout.messages.map((m) => m.parts.map((p) => [p.kind, p.source?.id ?? null, p.start, p.end]))).toEqual(a.layout.messages.map((m) => m.parts.map((p) => [p.kind, p.source?.id ?? null, p.start, p.end])));
        });
      }
    }
  }

  test("an empty prefill sends nothing: no message ends the prompt but the player's, and the tag lists no partial one", async () => {
    // `prompt-assembly.service.ts:4159-4162`, `:4183`: with no "Start Reply With" and an empty prefill, no assistant message is pushed.
    const rig = await new Rig({ prefill: "" }).start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    const sent = out.body!.messages as { role: string; content: unknown }[];
    expect(sent.at(-1)).toMatchObject({ role: "user" });
    expect(promptText([sent.at(-1)!])).toContain("HIST-11 And I wait.");
    const turn = rig.turns[0]!;
    expect(turn.tag.messages.some((m) => m.partial === true)).toBe(false);
    expect(turn.tag.messages.at(-1)).toMatchObject({ role: "user", history: true, source: { id: "m10" } });
  });

  test("the second reply's layout names the prompt's blocks from the breakdown Lumiverse stored after the first", async () => {
    const rig = await new Rig().start();
    await rig.generate("conn-rpe");
    await rig.generate("conn-rpe");
    const layout = rig.turns[1]!.layout;
    expect(layout.blocksFrom).toBe("breakdown");
    expect(layout.preset).toEqual({ id: PRESET.id, name: PRESET.name });
    const named = layout.messages.flatMap((m) => m.parts.flatMap((p) => p.blocks.map((b) => [p.kind, layout.blocks[b.block]!.name])));
    // Lore is named as Lumiverse names it, by its position and its label: with no marker in the preset, "before" goes just before the
    // history (`prompt-assembly.service.ts:3728-3741`, `:6612-6617`).
    expect(named).toEqual(expect.arrayContaining([["other", "Main"], ["other", "Style"], ["other", "Depth note"], ["lore", "World Info Before (auto): The bay"]]));
  });
});

describe("the prompt interceptor's own faults, dry runs and permissions", () => {
  /** The extension's two interceptors registered by hand in a worker an admin installed and enabled, with the generations they pair by given. */
  async function handWired(rig: Rig, generations: Generations, isRpe: (connection: string) => boolean): Promise<void> {
    await installRpe(rig.lv, {
      code: (ext) => {
        const road = { base: RPE, headers: { "x-rpe-extension": "rpe-extension-key" } };
        ext.registerWorldInfoInterceptor(worldInfoInterceptor({ road: async () => ({ ...road, waitMs: 3_000, logChars: 200 }), proxy: (url, init) => ext.cors(url, init), generations, log: () => undefined }), PRIORITY);
        ext.on("GENERATION_STARTED", (payload, user) => generations.started(payload, user));
        ext.registerInterceptor(promptInterceptor({ generations, whose: async (connection) => ({ rpe: isRpe(connection) }), granted: (p) => ext.permissions.has(p), log: () => undefined, stopped: () => undefined }), { priority: PRIORITY, required: true });
      },
    });
  }

  test("a fault in the interceptor stops a reply on RPE's connection with a line saying why, and a reply on another connection goes through untouched", async () => {
    const rig = new Rig();
    class Lost extends Generations {
      override take(): never {
        throw new Error("the generation's facts were lost");
      }
    }
    await handWired(rig, new Lost(), (c) => c === "conn-rpe");
    const stopped = await rig.generate("conn-rpe");
    expect(stopped.error).toBe("RPE stopped this reply before it was sent, because its extension failed: the generation's facts were lost");
    expect(stopped.body).toBeNull();
    expect(rig.turns).toHaveLength(0);

    const other = await rig.generate("conn-other");
    expect(other.error).toBeNull();
    expect(rig.otherBodies[0]!.rpe_turn).toBeUndefined();
    expect(bodyText(rig.otherBodies[0]!)).toContain(label(1));
  });

  test("when the extension cannot tell whose connection a reply is on, the reply goes through untouched: another chat's is played as before, and one on RPE's connection arrives untagged and is passed on", async () => {
    const rig = new Rig();
    await handWired(rig, new Generations(), () => {
      throw new Error("the registration could not be read");
    });
    const other = await rig.generate("conn-other");
    expect(other.error).toBeNull();
    expect(bodyText(rig.otherBodies[0]!)).toContain(label(1));
    const untagged = await rig.generate("conn-rpe");
    expect(untagged.error).toBeNull();
    expect(untagged.reply?.content).toBe("An untagged reply.");
    expect(rig.passed).toHaveLength(1);
    expect(rig.turns).toHaveLength(0);
  });

  test("a dry run is neither cut nor tagged, and the reply after it is paired and cut as ever", async () => {
    const rig = await new Rig().start();
    const dry = await rig.generate("conn-rpe", { dryRun: true });
    expect(dry.parameters?.rpe_turn).toBeUndefined();
    for (const i of [...LEFT_OUT, ...WINDOW]) expect(promptText(dry.prompt)).toContain(label(i));
    expect(rig.turns).toHaveLength(0);
    const real = await rig.generate("conn-rpe");
    expect(real.error).toBeNull();
    expect(rig.turns[0]!.cut.byExtension).toBe(7);
  });

  test("without generation_parameters a notice says so and a reply on RPE's connection is stopped rather than sent untagged; the grant clears the notice and replies are played", async () => {
    const rig = await new Rig({ granted: ALL.filter((p) => p !== "generation_parameters") }).start();
    expect(rig.notice()).toEqual(["generation_parameters"]);
    const stopped = await rig.generate("conn-rpe");
    expect(stopped.error).toContain("generation_parameters");
    expect(stopped.body).toBeNull();
    await rig.grant("generation_parameters");
    expect(rig.notice()).toBeNull();
    const played = await rig.generate("conn-rpe");
    expect(played.error).toBeNull();
    expect(rig.turns).toHaveLength(1);
  });

  test("without interceptor Lumiverse never calls the extension, so its notice stays up and a reply arrives untagged; the grant registers the interceptor", async () => {
    const rig = await new Rig({ granted: ALL.filter((p) => p !== "interceptor") }).start();
    expect(rig.notice()).toEqual(["interceptor"]);
    await rig.generate("conn-rpe");
    expect(rig.passed).toHaveLength(1);
    await rig.grant("interceptor");
    await rig.generate("conn-rpe");
    expect(rig.turns).toHaveLength(1);
  });

  test("without generation the extension hears no generation start and asks nothing, so a reply on RPE's connection is stopped; the grant registers the question and the listener", async () => {
    const rig = await new Rig({ granted: ALL.filter((p) => p !== "generation") }).start();
    const stopped = await rig.generate("conn-rpe");
    expect(stopped.error).toBe("RPE stopped this reply: its extension could not pair this prompt with a generation it heard begin, as when Lumiverse started the extension again while the generation was under way. Send it again.");
    expect(rig.questions).toHaveLength(0);
    await rig.grant("generation");
    const played = await rig.generate("conn-rpe");
    expect(played.error).toBeNull();
    expect(rig.questions).toHaveLength(1);
    expect(rig.turns[0]!.cut.byExtension).toBe(7);
  });

  test("Lumiverse stops the extension mid-generation: the generation fails in RPE's chat and in another, whatever the extension answers after, and the restarted extension plays on", async () => {
    const rig = await new Rig().start();
    rig.lv.addChat({ id: "chat-quay", user: USER, character: { id: "char-quay", name: "Quay" }, messages: [{ id: "q0", role: "user", content: "QUAY-0 I walk the quay." }] });
    // Both generations are in the extension's interceptor, which is slow to answer.
    const release = rig.holdInterceptor();
    const here = rig.generate("conn-rpe");
    const there = rig.generate("conn-other", { chat: "chat-quay" });
    for (let i = 0; i < 2_000 && rig.interceptorAsked < 2; i++) await new Promise<void>((resolve) => setTimeout(resolve, 1));
    expect(rig.interceptorAsked).toBe(2);
    await rig.restart();
    const [ours, theirs] = await Promise.all([here, there]);
    // A required interceptor fails the generation it was called for when Lumiverse stops its worker, in any chat (plan §4.2).
    for (const out of [ours, theirs]) {
      expect(out.error).toBe("Extension worker stopped");
      expect(out.body).toBeNull();
    }
    expect(rig.turns).toHaveLength(0);
    expect(rig.otherBodies).toHaveLength(0);
    // What the old worker answers now is dropped, and the restarted extension is called for the next generation.
    release();
    const played = await rig.generate("conn-rpe");
    expect(played.error).toBeNull();
    expect(rig.turns).toHaveLength(1);
    expect(rig.interceptorAsked).toBe(3);
  });
});

describe("a reply asked for whole", () => {
  test("with the preset's streaming switch off, a reply on RPE's connection comes to RPE whole, as asked, and is held under ten minutes; one on another connection keeps the switch", async () => {
    const rig = await new Rig({ streaming: false }).start();
    const ours = await rig.generate("conn-rpe");
    expect(ours.error).toBeNull();
    expect(ours.body?.stream).toBe(false);
    expect(rig.turns[0]?.whole).toBe(true);
    expect(rig.turns[0]?.hold).toBeLessThan(600_000);
    expect(ours.reply).toMatchObject({ content: "The tide turns.", reasoning: "Thinking about the bay." });
    const theirs = await rig.generate("conn-other");
    expect(theirs.body?.stream).toBe(false);
    expect(theirs.reply?.content).toBe("Another model's reply.");
  });
});

describe("RPE's secrets failing", () => {
  const COUNCIL = "COUNCIL-BLOCK The council weighed the ferry against the tide.";

  test("with a window set, the extension still cuts where RPE says and keeps every marked secret out by its own verdict; RPE says so once for the chat", async () => {
    const rig = await new Rig({ secretsFail: true }).start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    const turn = rig.turns[0]!;
    expect(turn.tag.cut).toEqual({ answered: true, keep: { id: "m8", index: 8 }, removed: 7 });
    expect(turn.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: 7, byRpe: 0 });
    // What Lumiverse stores beside the reply holds only the window.
    const stored = out.stored!.messages.map((m) => m.content).join("\n");
    for (const i of WINDOW) expect(stored).toContain(label(i));
    for (const i of LEFT_OUT) expect(stored).not.toContain(label(i));
    // Every marked passage and every copy of one stays out, as with no answer; the rest goes in.
    const sent = bodyText(out.body);
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(sent).not.toContain(kept);
    for (const shown of ["The ferry crosses the bay at dawn.", PUBLIC_LORE]) expect(sent).toContain(shown);

    // The next reply: the first one's message is on the path now, so the window starts one later.
    await rig.generate("conn-rpe");
    expect(rig.turns[1]!.tag.cut).toEqual({ answered: true, keep: { id: "m9", index: 9 }, removed: 8 });
    expect(rig.rpeLog.filter((line) => line.includes("could not work out its lore's secrets"))).toEqual([expect.stringContaining("chat chat-harbor:")]);
  });

  test("under prompt post-processing, with a part Lumiverse adds after the extension, no chat is refused: the extension's cut, or RPE's on receipt, leaves the council's part where it stood", async () => {
    const options = { postProcessing: "merge", council: COUNCIL };
    // With no cut from the extension, RPE cuts on receipt by the tag's list over the body, the council's part kept as text no listed
    // message accounts for (R-103).
    const uncut = await new Rig({ ...options, windowFailsAtQuestion: true }).start();
    const cutOnReceipt = await uncut.generate("conn-rpe");
    expect(cutOnReceipt.error).toBeNull();
    expect(uncut.turns[0]!.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: null, byRpe: 7, told: true, joining: { post: "merge", collapse: false, from: "settings" }, notices: [] });

    const rig = await new Rig({ ...options, secretsFail: true }).start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe("The tide turns.");
    const turn = rig.turns[0]!;
    expect(turn.cut).toMatchObject({ keep: { id: "m8", index: 8 }, byExtension: 7, byRpe: 0 });
    // RPE's cut on receipt gives the prompt Lumiverse makes when the extension cuts.
    const byExtension = await new Rig(options).start();
    await byExtension.generate("conn-rpe");
    expect(uncut.turns[0]!.prompt).toEqual(byExtension.turns[0]!.prompt);
    expect(promptText(uncut.turns[0]!.prompt)).toContain(COUNCIL);
    expect(promptText(turn.prompt)).toContain(COUNCIL);
    for (const i of LEFT_OUT) expect(promptText(turn.prompt)).not.toContain(label(i));
  });
});
