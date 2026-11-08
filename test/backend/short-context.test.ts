// The narrator's short context (DEPTH-PLAN §3.13, §9.2 B2): the composed prompt's parts and order
// under each way of taking the preset; blocks placed at a depth inside the history keep their depth
// within the recent window; no history message beyond the window reaches the narrator; sections land
// in their entries' marks, and where today's book would have put them when the prompt holds no mark;
// the prompt is joined as core joined the final body. End to end, a chat on depth with a long history
// narrates through the loopback from its preset and its recent window alone.

import { describe, expect, test } from "bun:test";
import type { PromptMessage, QuietMessage } from "../../src/backend/host";
import { markOf, turnEntries, withSections, type PlacedSection } from "../../src/backend/loopback/compose";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { depthSettingsOf } from "../../src/shared/depth-settings";
import { shortContext, type ShortContextInput } from "../../src/backend/loopback/short-context";
import { LreError } from "../../src/cli/connection";
import type { CallFields, CallRequestType, RelayLink } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import { isRecord } from "../../src/shared/json";
import type { LoopbackResultBodies } from "../../src/shared/loopback";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import { coreStream } from "../cli/core-staging/llm/openai-stream";
import { Rig } from "../support/rig";

const sys = (content: string): PromptMessage => ({ role: "system", content, history: false, worldInfo: false });
const wi = (content: string): PromptMessage => ({ role: "system", content, history: false, worldInfo: true });
const said = (role: "user" | "assistant", content: string): PromptMessage => ({ role, content, history: true, worldInfo: false });

/**
 * A preset's prompt as the tagger sees it: its system prompt, the card with the Scene section's mark
 * at the preset's outlet, World Info holding only the mark of an entry no section fills, six
 * messages of history (the greeting first, the player's message last) with World Info at depth 4
 * and an author's note at depth 2 inside it, World Info at depth 0 after it, and the jailbreak.
 */
const PROMPT: PromptMessage[] = [
  sys("Main prompt."),
  sys(`Card: Mira keeps the shop.\n${markOf("e-scene")}`),
  wi(markOf("e-unfilled")),
  said("assistant", "h1: The bell rings."),
  said("user", "h2: I look around."),
  wi("Deep lore: the shop is old."),
  said("assistant", "h3: Dust on every shelf."),
  said("user", "h4: I pick up a lamp."),
  sys("Author's note: keep it slow."),
  said("assistant", "h5: Mira watches you."),
  said("user", "h6: How much for this?"),
  wi("Lore at depth 0: prices are haggled."),
  sys("Jailbreak: stay in character."),
];

const SECTIONS: PlacedSection[] = [
  { label: "Scene", text: "[Scene] The shop, at noon.", entry: "e-scene", at: "front" },
  { label: "People", text: "[People] Mira, behind the counter.", entry: "e-people", at: { depth: 1, role: "system" } },
  { label: "Narrator rules", text: "[Narrator rules] The player's word comes first.", entry: "e-rules", at: "front" },
];

const asBody = (prompt: readonly PromptMessage[]): QuietMessage[] => prompt.map((m) => ({ role: m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system", content: m.content }));

function input(over: Partial<ShortContextInput> = {}): ShortContextInput {
  return { prompt: PROMPT, body: asBody(PROMPT), sections: SECTIONS, window: { messages: 3, tokens: 8000 }, absorption: "keep", ...over };
}

const PART = "## This moment\nMira names a price.";
const shown = (messages: readonly QuietMessage[]): string[] => messages.map((m) => `${m.role}: ${m.content}`);
const HISTORY = PROMPT.filter((m) => m.history).map((m) => m.content);

describe("the depth narrator's short context", () => {
  test("Keep it: every block outside the history stays, the history is the recent window with the blocks inside it at their depth, and the narrator's part closes the window", () => {
    const { frame, read } = shortContext(input());
    expect(shown(frame(PART))).toEqual([
      "system: Main prompt.",
      "system: Card: Mira keeps the shop.\n[Scene] The shop, at noon.",
      // The World Info that held only an unfilled entry's mark is gone; the rules had no mark, so they open the window.
      "system: [Narrator rules] The player's word comes first.",
      // Deeper than the window: at its start.
      "system: Deep lore: the shop is old.",
      "user: h4: I pick up a lamp.",
      "system: Author's note: keep it slow.",
      "assistant: h5: Mira watches you.",
      "system: [People] Mira, behind the counter.",
      "user: h6: How much for this?",
      "system: Lore at depth 0: prices are haggled.",
      `system: ${PART}`,
      "system: Jailbreak: stay in character.",
    ]);
    // Each of the three messages kept is 7 tokens.
    expect(read).toEqual({ messages: 3, tokens: 21, left: 3, blocks: 6 });
    // Each call is the same context with its own part.
    expect(frame("another").at(-2)).toEqual({ role: "system", content: "another" });
  });

  test("no history message beyond the window reaches the narrator, whatever the window holds", () => {
    for (const messages of [0, 1, 3, 6, 50]) {
      const sent = shortContext(input({ window: { messages, tokens: 8000 } })).frame(PART).map((m) => m.content);
      expect(HISTORY.filter((h) => sent.includes(h))).toEqual(HISTORY.slice(HISTORY.length - Math.min(messages, HISTORY.length)));
    }
    // The tokens bound it too, counted from the latest message.
    const sent = shortContext(input({ window: { messages: 10, tokens: 18 } })).frame(PART).map((m) => m.content);
    expect(HISTORY.filter((h) => sent.includes(h))).toEqual(["h5: Mira watches you.", "h6: How much for this?"]);
  });

  test("with no window, every block from inside the history goes where the window would start, before the part", () => {
    expect(shown(shortContext(input({ window: { messages: 0, tokens: 8000 } })).frame(PART)).slice(2)).toEqual([
      "system: [Narrator rules] The player's word comes first.",
      "system: Deep lore: the shop is old.",
      "system: Author's note: keep it slow.",
      "system: Lore at depth 0: prices are haggled.",
      "system: [People] Mira, behind the counter.",
      `system: ${PART}`,
      "system: Jailbreak: stay in character.",
    ]);
  });

  test("Pick blocks is gone (Spindle gives no preset block identity): a stored choice of it reads as Keep it", () => {
    expect(depthSettingsOf({ absorption: "pick" }).absorption).toBe("keep");
    expect(depthSettingsOf({ absorption: "narrator" }).absorption).toBe("narrator");
  });

  test("LRE's only: the window, the sections where today's book would put them, and the part; no block of the preset", () => {
    expect(shown(shortContext(input({ absorption: "narrator" })).frame(PART))).toEqual([
      "system: [Scene] The shop, at noon.\n\n[Narrator rules] The player's word comes first.",
      "user: h4: I pick up a lamp.",
      "assistant: h5: Mira watches you.",
      "system: [People] Mira, behind the counter.",
      "user: h6: How much for this?",
      `system: ${PART}`,
    ]);
  });

  test("the prompt is joined as core joined the final body: same-role neighbours merged, or one system message", () => {
    const merged = shortContext(input({ body: asBody(PROMPT).slice(0, 9) })).frame(PART);
    expect(merged.every((m, i) => i === 0 || merged[i - 1]?.role !== m.role)).toBe(true);
    expect(merged[0]?.content).toBe("Main prompt.\n\nCard: Mira keeps the shop.\n[Scene] The shop, at noon.\n\n[Narrator rules] The player's word comes first.\n\nDeep lore: the shop is old.");
    const single = shortContext(input({ body: [{ role: "system", content: "everything" }] })).frame(PART);
    expect(single).toHaveLength(1);
    expect(single[0]?.role).toBe("system");
    expect(single[0]?.content.startsWith("Main prompt.\n\n")).toBe(true);
    expect(single[0]?.content.endsWith(`${PART}\n\nJailbreak: stay in character.`)).toBe(true);
  });

  test("a prompt with no history: the part comes after every block", () => {
    const prompt = [sys("Main prompt."), sys("Jailbreak.")];
    expect(shown(shortContext({ prompt, body: asBody(prompt), sections: [], window: { messages: 4, tokens: 8000 }, absorption: "keep" }).frame(PART))).toEqual(["system: Main prompt.", "system: Jailbreak.", `system: ${PART}`]);
  });
});

const SESSION = "b2b2".repeat(8);
const PORT = 7864;
const SYSTEM_PROMPT = "You are the narrator of this story.";
const PASSAGE = "A bell rings over the door as you come in.";

/** The relay's link: each request a frame of its own session, answered as the dispatcher answers it. */
class BackendLink implements RelayLink {
  up = true;
  out = null;
  refused: string | null = null;
  secret = "";

  constructor(private readonly rig: Rig) {}

  async request<T extends CallRequestType>(type: T, fields: CallFields<T>): Promise<LoopbackResultBodies[T]> {
    return (await this.send(type, fields as unknown as Record<string, unknown>)) as LoopbackResultBodies[T];
  }

  async send(type: string, fields: Record<string, unknown>): Promise<unknown> {
    const reply = await this.rig.send({ type, secret: this.secret, ...fields }, SESSION);
    if (reply.type === "lre.error") throw new LreError(reply.code, reply.message, []);
    if (reply.type !== "lre.result") throw new Error(`no result to ${type}`);
    return reply.body;
  }
}

/** The depth calls answered by what each holds: the GM's reading of the player's turn, the author's setup, the narrator's moment and the GM's check; anything else gets nothing. */
function answer(text: string): string {
  if (text.includes("What the player wrote, verbatim:")) return JSON.stringify({ beats: [{ kind: "act", act: "said", what: "He walks into the shop and says hello.", surface: "He walks in and says hello.", words: /What the player wrote, verbatim:\n(.*)/.exec(text)?.[1] ?? "", quotes: "Hello?" }], signals: [] });
  if (text.includes("His beats, as the GM wrote them:")) {
    const pov = /\[([^\]]+)\] \(the player character\)/.exec(text)?.[1] ?? "";
    return JSON.stringify({ scene: {}, cast: [], staging: [], exposure: [], beats: [{ what: "The bell over the door rings as he comes in.", surface: "A bell rings over the door.", exposure: [{ who: pov, channel: "hearing", reach: "whole" }] }], next: [], end: "He has come in: the player speaks next." });
  }
  if (text.includes("## The beats of its moment")) return JSON.stringify({ faithful: true });
  if (text.includes("## This moment")) return PASSAGE;
  return "{}";
}

/** A chat on depth with twelve messages of history before its player's message, its turn played through the loopback: the narrator's calls, and the thinking block. */
async function depthTurn(absorption: "keep" | "narrator"): Promise<{ narrator: QuietMessage[][]; reasoning: string; earlier: string[] }> {
  const rig = new Rig({ shipped: true });
  const host = rig.host;
  host.connectionProfiles.push({ id: "conn-loop", name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: `http://127.0.0.1:${PORT}/v1` });
  host.contextConnectionId = "conn-loop";
  const narrator: QuietMessage[][] = [];
  host.quietReply = (req) => {
    const text = req.messages.map((m) => m.content).join("\n");
    if (text.includes("## This moment")) narrator.push(req.messages);
    return answer(text);
  };
  rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { absorption } } }));
  const link = new BackendLink(rig);
  const registered = await link.send("lre.loopback.register", { name: "sam", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: PORT });
  if (!isRecord(registered) || typeof registered.secret !== "string") throw new Error("the relay wasn't registered");
  link.secret = registered.secret;
  const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" })).page;
  if (!isRecord(page) || typeof page.minted !== "string") throw new Error("no loopback key was minted");
  const key = page.minted;
  const report = { name: "sam", build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: PORT, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 };
  await link.send("lre.loopback.hello", { api: 1, report, open: [] });
  const relay = new Relay(link, { ...RELAY_DEFAULTS, listen: "127.0.0.1", port: PORT, mode: "user" }, { now: Date.now, id: () => crypto.randomUUID().replaceAll("-", ""), log: () => undefined, fingerprint: async () => "fp" });
  const send = host.frontend.send;
  host.frontend.send = (message, userId, session) => {
    send(message, userId, session);
    if (message.type === "lre.loopback.chunk" && session === SESSION) queueMicrotask(() => relay.chunk(message));
  };

  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = host.createChat("Morning.");
  // The story before depth: messages the chat holds, each an earlier line.
  const earlier = Array.from({ length: 12 }, (_, i) => `Earlier line ${i + 1}: the rain keeps on.`);
  earlier.forEach((text, i) => host.append(host.chat(chatId), { id: `old${i}`, isUser: i % 2 === 0, name: i % 2 === 0 ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} }));
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));

  host.sendUser(chatId, "I walk into the shop. Hello?");
  await host.settle();
  const g = await host.begin(chatId, { type: "normal" });
  const res = await relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify({ model: LOOPBACK_MODEL, stream: true, messages: g.prompt ?? [], lre_turn: g.parameters?.lre_turn }) }));
  let content = "";
  let reasoning = "";
  for await (const c of coreStream(res)) {
    content += c.token;
    reasoning += c.reasoning ?? "";
  }
  expect(content).toBe(PASSAGE);
  await host.finish(g, content);
  return { narrator, reasoning, earlier };
}

describe("a chat on depth with a long history, through the loopback", () => {
  test("Keep it: the narrator reads the preset's prompt and the recent window, never the history before it", async () => {
    const { narrator, reasoning, earlier } = await depthTurn("keep");
    expect(narrator.length).toBeGreaterThan(0);
    for (const messages of narrator) {
      const texts = messages.map((m) => m.content);
      expect(texts[0]).toBe(SYSTEM_PROMPT);
      // Settings → Depth's window ships at 4 messages: the last three earlier lines and the player's message.
      expect(earlier.filter((line) => texts.includes(line))).toEqual(earlier.slice(-3));
      expect(texts).not.toContain("Morning.");
      // Today's sections come in as state: the scene and the people here, never the engine's Outline or Outcome, whose telling the beats take over.
      expect(texts.some((t) => t.startsWith("[Scene]"))).toBe(true);
      expect(texts.filter((t) => /^\[(Outline|Outcome|Montage|Stance|Minds|Who knows what)\]/.test(t))).toEqual([]);
      expect(messages.at(-2)?.content).toBe("I walk into the shop. Hello?");
      expect(messages.at(-1)?.role).toBe("system");
      expect(messages.at(-1)?.content).toContain("## This moment");
    }
    expect(reasoning).toContain("The narrator reads your preset as it is, the chat's last 4 messages");
    // The greeting and the nine earlier lines before the window.
    expect(reasoning).toContain("The 10 earlier messages stay out of its prompt.");
  });

  test("LRE's only: the narrator reads its own template and the recent window, without the preset's prompt", async () => {
    const { narrator, reasoning, earlier } = await depthTurn("narrator");
    expect(narrator.length).toBeGreaterThan(0);
    for (const messages of narrator) {
      const texts = messages.map((m) => m.content);
      expect(texts).not.toContain(SYSTEM_PROMPT);
      expect(earlier.filter((line) => texts.includes(line))).toEqual(earlier.slice(-3));
      expect(messages.at(-1)?.content).toContain("## This moment");
    }
    expect(reasoning).toContain("The narrator reads LumiRPEngine's own template instead of your preset");
  });
});

describe("where a loopback prompt's sections go", () => {
  const ns = (data: Record<string, string>) => ({ [LEDGER_NAMESPACE]: data });
  const CANDIDATES = [
    { id: "slot-scene", extensions: ns({ slot: "scene", placed: "chat_depth:system:1:from_end" }) },
    { id: "twin-scene", extensions: ns({ twin: "scene" }) },
    { id: "slot-people", extensions: ns({ slot: "people", placed: "chat_depth:system:1:from_end" }) },
    { id: "twin-people", extensions: ns({ twin: "people" }) },
    { id: "rules", extensions: ns({ narrator: "rules" }) },
    { id: "rules-outlet", extensions: ns({ narrator: "outlet" }) },
    { id: "user-lore", extensions: {} },
  ];

  test("the entries a turn fills are chosen as the engine run chooses them: a section's twin where the preset holds its outlet, else its own entry", () => {
    expect(turnEntries(CANDIDATES, new Set(["lre_scene", "lre_narrator"]))).toEqual(["twin-scene", "slot-people", "rules-outlet"]);
    expect(turnEntries(CANDIDATES, new Set())).toEqual(["slot-scene", "slot-people", "rules"]);
    expect(turnEntries([{ id: "user-lore", extensions: {} }], new Set(["lre_scene"]))).toEqual([]);
  });

  test("a section lands in its entry's mark wherever core put it, inside a preset block included; a chat off depth keeps its whole history", () => {
    const body: QuietMessage[] = [
      { role: "system", content: `World state:\n${markOf("twin-scene")}\nEnd of state.` },
      { role: "user", content: "h1" },
      { role: "system", content: markOf("slot-people") },
      { role: "user", content: "h2" },
    ];
    const sections: PlacedSection[] = [
      { label: "Scene", text: "[Scene] The shop.", entry: "twin-scene", at: "front" },
      { label: "Narrator rules", text: "[Narrator rules] Yours first.", entry: "rules", at: "front" },
    ];
    expect(withSections(body, { count: 4, history: [1, 3], first: "h1", last: "h2" }, sections).map((m) => m.content)).toEqual(["World state:\n[Scene] The shop.\nEnd of state.", "[Narrator rules] Yours first.", "h1", "h2"]);
  });
});
