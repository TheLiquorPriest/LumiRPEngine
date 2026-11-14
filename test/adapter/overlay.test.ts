// Laying the tag's message list over the body Lumiverse sends (STANDALONE-PLAN §4.2, §18.1 row 0.4),
// over many invented prompts. The bodies are made by Lumiverse's own steps, copied in the stand-in
// (`test/standin/steps.ts`): post-processing in each of its modes, the blank filter, collapse, and the
// OpenAI-compatible body. The list is the extension's own (`listedMessage`).

import { describe, expect, test } from "bun:test";
import { overlay, readBodyMessages, rebuild, type BodyMessage } from "../../src/adapter/lumiverse/overlay";
import { historyCut, textHash } from "../../src/adapter/lumiverse/wire";
import { listedMessage } from "../../src/ext/prompt";
import type { PromptMessageDTO } from "../../src/ext/spindle";
import { applyPostProcessing, buildBody, collapse, dropBlank, type LlmMessage, type LlmPart } from "../standin/steps";

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
    // A body's texts: each message's role and its text parts (a plain text is one); and its pictures, by their data.
    const texts = (messages: BodyMessage[]): { role: string; texts: string[] }[] => messages.map((m) => ({ role: m.role, texts: Array.isArray(m.content) ? m.content.filter((p) => !m.media.includes(p)).map((p) => (p as { text: string }).text) : [m.content] }));
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
        const match = possible.find((p) => Bun.deepEquals(texts(p), texts(made)));
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
});
