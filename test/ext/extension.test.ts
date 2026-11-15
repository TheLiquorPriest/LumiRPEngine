// The light extension and RPE's adapter, end to end through a stand-in Lumiverse (STANDALONE-PLAN
// §4.2, §9.6, §18.1 row 0.4). Each test says what reached the model, what Lumiverse stored, and what
// RPE was asked and handed.

import { describe, expect, test } from "bun:test";
import { textOf as textKey } from "../../src/backend/lore-secrets";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { KeptOut } from "../../src/ext/fail-closed";
import { Generations } from "../../src/ext/generations";
import { promptInterceptor } from "../../src/ext/prompt";
import { worldInfoInterceptor } from "../../src/ext/question";
import { PRIORITY } from "../../src/ext/start";
import { ALL, FERRY_SECRET, FERRY_SHOWN, INDEXED_SECRET, PUBLIC_LORE, PRESET, promptText, Rig, RPE, USER, VAULT_SECRET } from "./rig";
import { settle } from "../standin/clock";

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
    expect(turn.tag.lore.map((l) => l.id).sort()).toEqual(["e-ferry", "e-public"]);
    expect(turn.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: 7, remembered: false, byRpe: 0 });
    expect(turn.layout.complete).toBe(true);
    expect(historyOf(turn)).toEqual(["m8", "m9", "m10", "m11"]);
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

  test("with RPE slow, its answer is given up at three seconds and every marked passage and copy stays out; RPE then cuts the window on receipt", async () => {
    const rig = await new Rig({ questionDelayMs: 5_000 }).start();
    const out = await rig.generate("conn-rpe");
    expect(out.worldInfo.ms).toBeGreaterThanOrEqual(2_900);
    expect(out.worldInfo.ms).toBeLessThan(3_500);
    expect(out.error).toBeNull();
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(bodyText(out.body)).not.toContain(kept);

    const turn = rig.turns[0]!;
    expect(turn.tag.cut).toEqual({ answered: false, remembered: null, removed: 0 });
    expect(turn.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: null, remembered: false, byRpe: 7 });
    expect(historyOf(turn)).toEqual(["m8", "m9", "m10", "m11"]);
    const played = promptText(turn.prompt);
    for (const i of LEFT_OUT) expect(played).not.toContain(label(i));
    // With no answer to cut by, Lumiverse sent the whole history and stored it beside the reply.
    expect(out.stored!.messages.map((m) => m.content).join("\n")).toContain(label(1));
  });

  test("past Lumiverse's own limit for a World Info interceptor the extension's answer is not waited for, and the unmarked copy of a secret reaches the prompt: why the deadline is well inside it", async () => {
    const rig = await new Rig({ questionDelayMs: 1_000, deadlineMs: 400 }).start();
    rig.lv.worldInfoTimeoutMs = 200;
    const out = await rig.generate("conn-other");
    expect(out.worldInfo.ms).toBeLessThan(400);
    const text = bodyText(rig.otherBodies[0]!);
    expect(text).toContain(VAULT_SECRET);
    // Lumiverse strips a marked passage by itself.
    expect(text).not.toContain(FERRY_SECRET);
  });

  test("for a user with no registration (RPE has not registered yet, or is not theirs), RPE is not asked, and every marked passage and every copy of one still stays out of the prompt", async () => {
    const rig = await new Rig().start();
    rig.lv.chats.set("chat-wren", { ...rig.chat, id: "chat-wren", user: "user-wren" });
    const out = await rig.lv.generate({ chat: "chat-wren", connection: "conn-other", preset: PRESET.id });
    expect(out.error).toBeNull();
    expect(rig.questions).toEqual([]);
    const text = bodyText(rig.otherBodies[0]!);
    for (const kept of [FERRY_SECRET, VAULT_SECRET]) expect(text).not.toContain(kept);
    // Only RPE knows that one is secret, and nothing marks it.
    for (const shown of [PUBLIC_LORE, INDEXED_SECRET, "The ferry crosses the bay at dawn."]) expect(text).toContain(shown);
  });

  test("what RPE last kept out of a chat stays out when RPE stops answering, though no mark says it is secret; a restarted extension knows only the marks", async () => {
    const rig = await new Rig().start();
    await rig.generate("conn-rpe");
    rig.rpeDown();
    await rig.generate("conn-other");
    const remembered = bodyText(rig.otherBodies[0]!);
    for (const kept of [INDEXED_SECRET, VAULT_SECRET, FERRY_SECRET]) expect(remembered).not.toContain(kept);
    expect(remembered).toContain(PUBLIC_LORE);

    await rig.restart();
    await rig.generate("conn-other");
    const fresh = bodyText(rig.otherBodies[1]!);
    expect(fresh).toContain(INDEXED_SECRET);
    for (const kept of [VAULT_SECRET, FERRY_SECRET]) expect(fresh).not.toContain(kept);
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
  for (const post of MODES) {
    for (const collapse of [false, true]) {
      test(`post-processing "${post || "none"}", collapse ${collapse ? "on" : "off"}: every part of the body is accounted for by the tag`, async () => {
        const rig = await new Rig({ postProcessing: post, collapse, prefill: PREFILL, picture: true }).start();
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
        expect(historyOf(turn)).toEqual(["m8", "m9", "m10", "m11"]);
        // The prefill is the body's last part, as the tag listed it: the partial assistant message that ends the prompt.
        expect(turn.tag.messages.at(-1)).toMatchObject({ role: "assistant", partial: true, hash: textHash(PREFILL) });
        const last = turn.layout.messages.at(-1)!.parts.at(-1)!;
        expect([last.role, last.kind, last.hash]).toEqual(["assistant", "other", textHash(PREFILL)]);
        expect(promptText([turn.prompt.at(-1)!]).endsWith(PREFILL)).toBe(true);
      });

      test(`post-processing "${post || "none"}", collapse ${collapse ? "on" : "off"}: a window RPE cuts on receipt gives the prompt Lumiverse makes when the extension cuts`, async () => {
        const options = { postProcessing: post, collapse, prefill: PREFILL, picture: true };
        const cutByExtension = await new Rig(options).start();
        await cutByExtension.generate("conn-rpe");
        const cutByRpe = await new Rig({ ...options, windowFailsAtQuestion: true }).start();
        await cutByRpe.generate("conn-rpe");
        const [a, b] = [cutByExtension.turns[0]!, cutByRpe.turns[0]!];
        expect(a.tag.cut).toMatchObject({ answered: true });
        expect(b.tag.cut).toEqual({ answered: false, remembered: null, removed: 0 });
        expect(b.cut.byRpe).toBe(7);
        expect(b.prompt).toEqual(a.prompt);
        expect(b.layout.messages.map((m) => m.parts.map((p) => [p.kind, p.source?.id ?? null, p.start, p.end]))).toEqual(a.layout.messages.map((m) => m.parts.map((p) => [p.kind, p.source?.id ?? null, p.start, p.end])));
      });
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
    expect(turn.tag.messages.at(-1)).toMatchObject({ role: "user", history: true, source: { id: "m11" } });
  });

  test("the second reply's layout names the prompt's blocks from the breakdown Lumiverse stored after the first", async () => {
    const rig = await new Rig().start();
    await rig.generate("conn-rpe");
    await rig.generate("conn-rpe");
    const layout = rig.turns[1]!.layout;
    expect(layout.blocksFrom).toBe("breakdown");
    expect(layout.preset).toEqual({ id: PRESET.id, name: PRESET.name });
    const named = layout.messages.flatMap((m) => m.parts.flatMap((p) => p.blocks.map((b) => [p.kind, layout.blocks[b.block]!.name])));
    expect(named).toEqual(expect.arrayContaining([["other", "Main"], ["other", "Style"], ["other", "Depth note"], ["lore", "The bay"]]));
  });
});

describe("the prompt interceptor's own faults, dry runs and permissions", () => {
  /** The extension's two interceptors registered by hand, with the generations they pair by given. */
  function handWired(rig: Rig, generations: Generations, isRpe: (connection: string) => boolean): void {
    const ext = rig.lv.install(ALL);
    const road = { base: RPE, headers: { "x-rpe-extension": "rpe-extension-key" } };
    ext.registerWorldInfoInterceptor(worldInfoInterceptor({ road: async () => road, proxy: (url, init) => ext.cors(url, init), generations, keptOut: new KeptOut(16), deadlineMs: 3_000, log: () => undefined }), PRIORITY);
    ext.on("GENERATION_STARTED", (payload, user) => generations.started(payload, user));
    ext.registerInterceptor(promptInterceptor({ generations, isRpe, granted: (p) => ext.permissions.has(p), log: () => undefined }), { priority: PRIORITY, required: true });
  }

  test("a fault in the interceptor stops a reply on RPE's connection with a line saying why, and a reply on another connection goes through untouched", async () => {
    const rig = new Rig();
    class Lost extends Generations {
      override take(): never {
        throw new Error("the generation's facts were lost");
      }
    }
    handWired(rig, new Lost(16), (c) => c === "conn-rpe");
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
    handWired(rig, new Generations(16), () => {
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
    rig.ext.grant("generation_parameters");
    await settle();
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
    rig.ext.grant("interceptor");
    await rig.generate("conn-rpe");
    expect(rig.turns).toHaveLength(1);
  });

  test("without generation the extension hears no generation start and asks nothing, so a reply on RPE's connection is stopped; the grant registers the question and the listener", async () => {
    const rig = await new Rig({ granted: ALL.filter((p) => p !== "generation") }).start();
    const stopped = await rig.generate("conn-rpe");
    expect(stopped.error).toBe("RPE could not tell which generation this prompt belongs to, so it stopped the reply. Send it again.");
    expect(rig.questions).toHaveLength(0);
    rig.ext.grant("generation");
    const played = await rig.generate("conn-rpe");
    expect(played.error).toBeNull();
    expect(rig.questions).toHaveLength(1);
    expect(rig.turns[0]!.cut.byExtension).toBe(7);
  });
});

describe("a reply asked for whole", () => {
  test("with the preset's streaming switch off, a reply on RPE's connection still comes to RPE as a stream, so a long turn can be kept alive; one on another connection keeps the switch", async () => {
    const rig = await new Rig({ streaming: false }).start();
    const ours = await rig.generate("conn-rpe");
    expect(ours.error).toBeNull();
    expect(ours.body?.stream).toBe(true);
    expect(ours.body?._streaming).toBeUndefined();
    expect(rig.turns[0]?.stream).toBe(true);
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
    expect(turn.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: 7, remembered: false, byRpe: 0 });
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

  test("under prompt post-processing, with a part Lumiverse adds after the extension, that chat is not refused: the extension made the cut RPE could not make on receipt", async () => {
    const options = { postProcessing: "merge", council: COUNCIL };
    // With no cut from the extension, RPE must cut on receipt, cannot tell the council's part from the rest, and refuses.
    const uncut = await new Rig({ ...options, windowFailsAtQuestion: true }).start();
    const refused = await uncut.generate("conn-rpe");
    expect(refused.error).toContain("could not tell this prompt's parts apart");

    const rig = await new Rig({ ...options, secretsFail: true }).start();
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe("The tide turns.");
    const turn = rig.turns[0]!;
    expect(turn.cut).toEqual({ keep: { id: "m8", index: 8 }, byExtension: 7, remembered: false, byRpe: 0 });
    expect(promptText(turn.prompt)).toContain(COUNCIL);
    for (const i of LEFT_OUT) expect(promptText(turn.prompt)).not.toContain(label(i));
  });
});
