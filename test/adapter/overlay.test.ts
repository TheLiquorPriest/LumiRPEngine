// Laying the tag's message list over the body Lumiverse sends (STANDALONE-PLAN §4.2, §18.1 row 0.4),
// over many invented prompts. The bodies are made by Lumiverse's own steps, copied in the stand-in
// (`test/standin/steps.ts`): post-processing in each of its modes, the blank filter, collapse, and the
// OpenAI-compatible body; and, before the interceptor, the joins Lumiverse makes inside its assembly
// (`test/standin/assembly.ts`): queued sends joined, system messages squashed, names written into the
// text, system sent as the user's. The list is the extension's own (`listedMessage`).

import { describe, expect, test } from "bun:test";
import { overlay, readBodyMessages, rebuild, type BodyMessage } from "../../src/adapter/lumiverse/overlay";
import { historyCut, textHash } from "../../src/adapter/lumiverse/wire";
import { listedMessage } from "../../src/ext/prompt";
import type { PromptMessageDTO } from "../../src/ext/spindle";
import { applyCompletionSettings, mergeQueuedUserMessages } from "../standin/assembly";
import { applyPostProcessing, buildBody, collapse, dropBlank, textOf, type LlmMessage, type LlmPart } from "../standin/steps";

type Prompt = (LlmMessage & PromptMessageDTO)[];

/** A small seeded generator (mulberry32), so a failure can be run again. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An invented prompt: system blocks, lore standing alone, chat history in order with a note spliced
 * in, blank messages, two messages of one role running together, a picture or two (some with their
 * text split around it), and sometimes a trailing prefill.
 */
function inventPrompt(rand: () => number, n: number): Prompt {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const words = ["harbor", "lantern", "salt", "tide", "rope", "gull", "dock", "fog", "keel", "bell"];
  const sentence = (k: number): string => `${pick(words)}-${k} ${pick(words)} ${pick(words)}.`;
  const out: Prompt = [];
  let index = 0;
  for (let k = 0; k < n; k++) {
    const kind = rand();
    const role = pick(["system", "user", "assistant"] as const);
    const blank = rand() < 0.12;
    const text = blank ? pick(["", " ", "   "]) : rand() < 0.3 ? `${sentence(k)}\n\n${sentence(k + 100)}` : sentence(k);
    if (kind < 0.25) out.push({ role: "system", content: text });
    else if (kind < 0.4) out.push({ role: "system", content: text, __isWorldInfoEntry: true });
    else {
      const history = { __isChatHistory: true, sourceMessageId: `msg-${index}`, sourceIndexInChat: index };
      index += 1 + (rand() < 0.2 ? 1 : 0);
      if (!blank && role === "user" && rand() < 0.25) {
        const image: LlmPart = { type: "image", data: `aW1n${k}`, mime_type: "image/png" };
        const content: LlmPart[] = rand() < 0.5 ? [{ type: "text", text }, image] : [{ type: "text", text: `${sentence(k)} ` }, image, { type: "text", text }];
        out.push({ role, content, ...history });
      } else out.push({ role: role === "system" ? "user" : role, content: text, ...history });
    }
  }
  if (rand() < 0.4) out.push({ role: "assistant", content: pick(["", "Then", " "]), partial: true });
  return out;
}

const MODES = ["", "merge", "semi", "strict", "single"];

/** The body Lumiverse sends for a prompt handed on by the interceptors: its steps after them, then the connection's body. */
function lumiverse(prompt: Prompt, post: string, collapseOn: boolean): BodyMessage[] {
  let sent = structuredClone(prompt) as LlmMessage[];
  if (post) applyPostProcessing(sent, post);
  sent = dropBlank(sent);
  if (collapseOn) collapse(sent);
  return readBodyMessages(buildBody("model", sent, {}, true).messages)!;
}

/** A body's texts: each message's role and its text parts (a plain text is one), its pictures left out. */
function bodyTexts(messages: BodyMessage[]): { role: string; texts: string[] }[] {
  return messages.map((m) => ({ role: m.role, texts: Array.isArray(m.content) ? m.content.filter((p) => !m.media.includes(p)).map((p) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")) : [m.content] }));
}

/**
 * An invented prompt as Lumiverse's assembly holds it before its own joins: system blocks and lore standing alone before and after
 * the history, then the history in order (`__chatHistorySource` and its source, `prompt-assembly.service.ts:220-235`), in which the
 * player's lines often come several in a row (sends queued while a reply was written) and now and then with a picture, the numbers
 * skipping where a message was deleted; and sometimes a trailing prefill.
 */
function inventAssembled(rand: () => number, n: number): LlmMessage[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const words = ["harbor", "lantern", "salt", "tide", "rope", "gull", "dock", "fog", "keel", "bell"];
  const sentence = (k: number): string => `${pick(words)}-${k} ${pick(words)} ${pick(words)}.`;
  const fixed = (k: number): LlmMessage => (rand() < 0.3 ? { role: "system", content: sentence(k), __worldInfoSource: true } : { role: pick(["system", "system", "user"] as const), content: rand() < 0.3 ? `${sentence(k)}\n\n${sentence(k + 100)}` : sentence(k) });
  const out: LlmMessage[] = [];
  let k = 0;
  for (let i = Math.floor(rand() * 4); i > 0; i--) out.push(fixed(k++));
  let index = 0;
  for (let i = 2 + Math.floor(rand() * n); i > 0; i--) {
    const role = rand() < 0.55 ? ("user" as const) : ("assistant" as const);
    const text = sentence(k++);
    const content: string | LlmPart[] = role === "user" && rand() < 0.2 ? [{ type: "text", text }, { type: "image", data: `aW1n${k}`, mime_type: "image/png" }] : text;
    out.push({ role, content, __chatHistorySource: true, __sourceMessageId: `msg-${index}`, __sourceIndexInChat: index });
    index += 1 + (rand() < 0.2 ? 1 : 0);
  }
  for (let i = Math.floor(rand() * 3); i > 0; i--) out.push(fixed(k++));
  if (rand() < 0.5) out.push({ role: "assistant", content: `Then-${k}`, partial: true });
  return out;
}

/** An assembled message as the interceptor is handed it: its marks as the worker host gives them (`spindle/worker-host.ts:3186-3196`). */
function handedOf(m: LlmMessage): LlmMessage & PromptMessageDTO {
  const history = m.__chatHistorySource === true ? { __isChatHistory: true, ...(typeof m.__sourceMessageId === "string" ? { sourceMessageId: m.__sourceMessageId } : {}), ...(typeof m.__sourceIndexInChat === "number" ? { sourceIndexInChat: m.__sourceIndexInChat } : {}) } : {};
  return { ...m, ...history, ...(m.__worldInfoSource === true ? { __isWorldInfoEntry: true } : {}) };
}

describe("the tag's list over the body", () => {
  test("under every post-processing mode, with collapse off and on, every stretch of every body message is one listed message or a separator, and every listed message is found or was blank", () => {
    const rand = seeded(20261113);
    for (let round = 0; round < 250; round++) {
      const prompt = inventPrompt(rand, 4 + Math.floor(rand() * 18));
      const tag = prompt.map(listedMessage);
      for (const post of MODES) {
        for (const collapseOn of [false, true]) {
          const body = lumiverse(prompt, post, collapseOn);
          const laid = overlay(tag, body);
          expect({ round, post, collapseOn, complete: laid.complete }).toEqual({ round, post, collapseOn, complete: true });
          const seen: number[] = [];
          for (const m of laid.messages) {
            let at = 0;
            for (const p of m.places) {
              expect(["", "\n\n"]).toContain(m.text.slice(at, p.start));
              seen.push(p.member);
              at = p.end;
            }
            expect(m.text.slice(at)).toBe("");
          }
          // In order, each once; the ones not seen in the text were blank.
          expect(seen).toEqual([...seen].sort((a, b) => a - b));
          expect(new Set(seen).size).toBe(seen.length);
          for (const m of tag.keys()) if (!seen.includes(m)) expect(tag[m]!.blank === true || (tag[m]!.media ?? 0) > 0).toBe(true);
        }
      }
    }
  });

  test("a listed message's stretch holds exactly its text where Lumiverse kept it whole", () => {
    const rand = seeded(7);
    for (let round = 0; round < 100; round++) {
      const prompt = inventPrompt(rand, 10);
      const tag = prompt.map(listedMessage);
      for (const post of MODES) {
        const laid = overlay(tag, lumiverse(prompt, post, false));
        for (const m of laid.messages) for (const p of m.places) if (tag[p.member]!.parts === undefined || post !== "") expect(textHash(m.text.slice(p.start, p.end))).toBe(tag[p.member]!.hash);
      }
    }
  });

  test("history left out after Lumiverse joined the prompt gives the body Lumiverse makes when the interceptor leaves it out first, by a way of joining that explains the body received; a picture Lumiverse dropped in a join does not come back", () => {
    const rand = seeded(424242);
    const settings = MODES.flatMap((post) => [false, true].map((collapseOn) => ({ post, collapseOn })));
    const shown = (messages: BodyMessage[]): { role: string; content: unknown }[] => messages.map((m) => ({ role: m.role, content: m.content }));
    // A body's pictures, by their data.
    const pictures = (messages: BodyMessage[]): string[] => messages.flatMap((m) => m.media.map((p) => JSON.stringify(p)));
    for (let round = 0; round < 250; round++) {
      const prompt = inventPrompt(rand, 4 + Math.floor(rand() * 18));
      const tag = prompt.map(listedMessage);
      const history = tag.flatMap((t) => (t.source ? [t.source] : []));
      if (history.length === 0) continue;
      const keep = history[Math.floor(rand() * history.length)]!;
      const left = new Set(historyCut(tag.map((t) => ({ history: t.history === true, index: t.source?.index ?? null })), keep));
      for (const { post, collapseOn } of settings) {
        const received = lumiverse(prompt, post, collapseOn);
        const made = rebuild(overlay(tag, received), tag, left).map((m) => readBodyMessages([{ role: m.role, content: m.content }])![0]!);
        // Every setting that would have sent this same body; each makes its own body without the history left out.
        const alike = settings.filter((s) => Bun.deepEquals(shown(lumiverse(prompt, s.post, s.collapseOn)), shown(received)));
        const possible = alike.map((s) => lumiverse(prompt.filter((_, i) => !left.has(i)), s.post, s.collapseOn));
        const match = possible.find((p) => Bun.deepEquals(bodyTexts(p), bodyTexts(made)));
        expect({ round, post, collapseOn, found: match !== undefined }).toEqual({ round, post, collapseOn, found: true });
        // Every picture still in the body received stays where Lumiverse would have it; none other appears.
        const had = new Set(pictures(received));
        expect(pictures(made)).toEqual(pictures(match!).filter((p) => had.has(p)));
      }
    }
  });

  test("a message Lumiverse adds after the interceptors (a council's deliberation) is told apart as one no listed message accounts for, and the rest still is", () => {
    const rand = seeded(99);
    const prompt = inventPrompt(rand, 12);
    const tag = prompt.map(listedMessage);
    const body = lumiverse(prompt, "", false);
    // Spliced four from the end after the pipeline (`generate.service.ts:2881-2893`).
    const at = Math.max(0, body.length - 4);
    body.splice(at, 0, { role: "system", content: "COUNCIL notes", text: "COUNCIL notes", textParts: null, media: [] });
    const laid = overlay(tag, body);
    expect(laid.complete).toBe(false);
    expect(laid.missing).toEqual([]);
    expect(laid.messages.map((m, i) => (m.places.length === 0 ? i : -1)).filter((i) => i >= 0)).toEqual([at]);
  });

  test("on prompts Lumiverse joined before the interceptor (queued lines, squashed system messages, names in content, system as user), under every mode every listed message is found once and in order, and the history left out gives the body Lumiverse makes", () => {
    const rand = seeded(5150);
    const settings = MODES.flatMap((post) => [false, true].map((collapseOn) => ({ post, collapseOn })));
    const ids = (messages: LlmMessage[]): string[] => messages.flatMap((m) => (typeof m.__sourceMessageId === "string" ? [m.__sourceMessageId] : []));
    let joinedRounds = 0;
    for (let round = 0; round < 200; round++) {
      const assembled = inventAssembled(rand, 4 + Math.floor(rand() * 14));
      const before = ids(assembled);
      const start = assembled.findIndex((m) => m.__chatHistorySource === true);
      mergeQueuedUserMessages(assembled, start, assembled.filter((m) => m.__chatHistorySource === true).length);
      applyCompletionSettings(assembled, { squashSystemMessages: rand() < 0.5, useSystemPrompt: rand() < 0.3 ? false : undefined, namesBehavior: ([0, 1, 2] as const)[Math.floor(rand() * 3)] }, { user: "User", character: "Ilsa" });
      const prompt = assembled.map(handedOf);
      const tag = prompt.map(listedMessage);
      // A line joined into the one before it is in no listed message: the list is what the interceptor saw.
      const joinedIds = before.filter((id) => !ids(assembled).includes(id));
      if (joinedIds.length > 0) joinedRounds++;
      for (const id of joinedIds) expect(tag.some((t) => t.source?.id === id)).toBe(false);
      for (const [i, t] of tag.entries()) expect(t.hash).toBe(textHash(textOf(prompt[i]!)));
      const history = tag.flatMap((t) => (t.source ? [t.source] : []));
      const keep = history[Math.floor(rand() * history.length)]!;
      const left = new Set(historyCut(tag.map((t) => ({ history: t.history === true, index: t.source?.index ?? null })), keep));
      for (const { post, collapseOn } of settings) {
        const body = lumiverse(prompt, post, collapseOn);
        const laid = overlay(tag, body);
        expect({ round, post, collapseOn, complete: laid.complete }).toEqual({ round, post, collapseOn, complete: true });
        const seen: number[] = [];
        for (const m of laid.messages) {
          let at = 0;
          for (const p of m.places) {
            expect(["", "\n\n"]).toContain(m.text.slice(at, p.start));
            seen.push(p.member);
            at = p.end;
          }
          expect(m.text.slice(at)).toBe("");
        }
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(new Set(seen).size).toBe(seen.length);
        // History left out of the joined prompt on receipt gives the body Lumiverse makes when the interceptor leaves it out first, by a
        // way of joining that explains the body received.
        const made = rebuild(laid, tag, left).map((m) => readBodyMessages([{ role: m.role, content: m.content }])![0]!);
        const alike = settings.filter((s) => Bun.deepEquals(bodyTexts(lumiverse(prompt, s.post, s.collapseOn)), bodyTexts(body)));
        const possible = alike.map((s) => lumiverse(prompt.filter((_, i) => !left.has(i)), s.post, s.collapseOn));
        expect({ round, post, collapseOn, found: possible.some((p) => Bun.deepEquals(bodyTexts(p), bodyTexts(made))) }).toEqual({ round, post, collapseOn, found: true });
      }
    }
    // The rounds are not empty of what they test: most had queued lines joined.
    expect(joinedRounds).toBeGreaterThan(100);
  });
});
