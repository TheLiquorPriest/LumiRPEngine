// GM → Depth → Turn rendered with no DOM (DEPTH-PLAN §7, §9.1): one reply's staging, its beats with
// who decided and who perceived each, each passage with its drafts and checks, and the turn's model
// calls; nothing hidden: a live call's answer that wasn't JSON is kept as the model wrote it, with
// why, on its call. The body is walked as a tree, its own components rendered in place.

import { expect, test } from "bun:test";
import type { VNode } from "preact";
import { DepthAnswerError } from "../../src/backend/depth/common";
import type { ModelPort } from "../../src/backend/depth/port";
import { ask } from "../../src/backend/depth/scene/author";
import { Narration } from "../../src/backend/depth/scene/narration";
import { watch } from "../../src/backend/depth/scene/realtime";
import { reporting } from "../../src/backend/depth/scene/reporting";
import type { TurnSink } from "../../src/backend/loopback/sink";
import type { LoopbackModelCall } from "../../src/shared/loopback";
import { WHOLE_ANSWER, type CallMisread } from "../../src/shared/misread";
import { SCENE_TEXT } from "../../src/shared/scene-prompts";
import type { DepthSceneView } from "../../src/shared/scene-view";
import { blobHash } from "../../src/shared/stores";
import { HostSelect, IdText } from "../../src/frontend/components";
import { TurnBody } from "../../src/frontend/depth/turn";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { propsOf, type Props } from "../support/tree";

/** The host's controls and the ids (they hold hooks) stay as elements; every other component renders in place. */
const OPAQUE = new Set<unknown>([HostSelect, IdText]);

function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const v = node as VNode<Props>;
  if (typeof v.type === "function" && !OPAQUE.has(v.type)) return { ...v, props: { ...v.props, children: render((v.type as (p: Props) => unknown)(v.props)) } };
  return { ...v, props: { ...v.props, children: render(v.props.children) } };
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

const VIEW: DepthSceneView = {
  reply: { messageId: "m4", swipeId: 1, index: 4, at: "3 May, 14:05" },
  replies: [
    { messageId: "m4", swipeId: 1, index: 4, at: "3 May, 14:05" },
    { messageId: "m2", swipeId: 0, index: 2, at: "3 May, 13:50" },
  ],
  pov: { id: "you", name: "Alex Rivera" },
  staging: [{ who: "you", name: "Alex Rivera", where: "by the counter", doing: "waiting for coffee" }],
  beats: [
    { id: "b1", at: "3 May, 14:05", place: "Daybreak Café", act: "said", actors: ["Maya Chen"], decided: "character", what: "Maya tells him they're closed, though they aren't.", surface: "Maya, back turned, says they're closed.", quotes: "We're closed.", exposure: [{ who: "you", name: "Alex Rivera", channel: "hearing", reach: "whole", pending: false }], passage: 1 },
    { id: "b2", at: "3 May, 14:05", place: "Daybreak Café", act: "did", actors: ["Jordan Price"], decided: "author", what: "Jordan pockets the receipt.", surface: "A hand moves to a coat pocket.", exposure: [{ who: "maya", name: "Maya Chen", channel: "sight", reach: "partial", pov: "Something white goes into his coat.", pending: true }], passage: null },
  ],
  told: [{ index: 1, beats: ["b1"], text: "Maya keeps her back to you. “We're closed.”", drafts: [{ text: "Maya smiles. “We're closed.”", faithful: false, notes: "- “Maya smiles”: the beat has her turned away" }, { text: "Maya keeps her back to you. “We're closed.”", faithful: true }], asked: [] }],
  takes: [{ who: "maya", name: "Maya Chen", at: "3 May, 14:05", beat: 1, lived: 1, text: "Not him again. Say we're closed and don't turn around." }],
  provenance: { calls: [{ role: "narrator", connection: "conn-1", model: "deepseek-v4-flash", requestId: "gen-7", promptTokens: 900, completionTokens: 120, ms: 4200 }], turnMs: 61_000, firstContentMs: 12_000 },
};

test("the turn inspector shows a reply's whole scene, each play's take, each passage's checks and its model calls with their request ids", () => {
  const picked: string[] = [];
  const tree = render(TurnBody({ view: VIEW, busy: false, onPick: (id) => picked.push(id), onJump: () => {} }));
  const text = textOf(tree);
  for (const shown of ["Maya tells him they're closed, though they aren't.", "“We're closed.”", "Something white goes into his coat.", "not lived yet", "No passage rendered it: nothing of it reached Alex Rivera.", "Draft 2", "the beat has her turned away", "deepseek-v4-flash", "gen-7", "first passage after", "Not him again. Say we're closed and don't turn around.", "played beat 1"]) expect(text).toContain(shown);
  expect(textOf(render(TurnBody({ view: { ...VIEW, takes: [] }, busy: false, onPick: () => {}, onJump: () => {} })))).toContain("No character played this turn as its own agent.");
  expect(propsOf(tree, "div").filter((p) => p["data-lre-depth-beat"] !== undefined).map((p) => p["data-lre-depth-beat"])).toEqual(["b1", "b2"]);
  const select = propsOf(tree, HostSelect)[0] as { onChange(value: string): void; options: { value: string }[] } | undefined;
  expect(select?.options.map((o) => o.value)).toEqual(["m4", "m2"]);
  select?.onChange("m2");
  expect(picked).toEqual(["m2"]);
  expect(textOf(render(TurnBody({ view: { ...VIEW, reply: null }, busy: false, onPick: () => {}, onJump: () => {} })))).toContain("No scene yet");
});

test("a live call's answer that wasn't JSON is kept as the model wrote it, and the turn inspector shows it on its call with why", async () => {
  // The turn's sink as the bridge keeps it: each call reported, and the misread a call's parse told kept beside it for its record.
  const calls: LoopbackModelCall[] = [];
  const kept = new Map<LoopbackModelCall, CallMisread>();
  const sink: TurnSink = { progress: () => {}, reasoning: () => {}, content: () => {}, call: (c) => void calls.push(c), misread: (c, m) => void kept.set(c, m) };
  const answers: Record<string, string[]> = {
    author: ["I'd rather set this scene in prose."],
    watch: ["Nothing to flag; carry on."],
    narrator: ["Maya turns away."],
    check: ["Looks faithful to me.", "Still faithful."],
  };
  const raw: ModelPort = async (role) => ({ text: answers[role]?.shift() ?? "", usage: { tokensIn: 10, tokensOut: 7 } });
  const model = reporting(raw, sink, () => 0);
  const world = modernUsWorld("w", "R");
  const state = startState(world);

  // The author's step fails on it; the watch reads it as none; the GM's check, asked again, lets the passage stream unchecked.
  await expect(ask({ world, state, texts: {}, pov: world.pov, model }, SCENE_TEXT.step, "data")).rejects.toBeInstanceOf(DepthAnswerError);
  const watched = await watch(model, { world, state, pc: world.pov, with: "maya", staging: new Map(), conversation: [], notebook: "", line: "Coffee?", texts: {} });
  expect(watched.answer).toBeNull();
  const what = "Maya turns her back.";
  const narration = new Narration({ model, sink, throughOf: () => 0 }, { world, state, texts: {}, pov: world.pov, settings: { redrafts: 2, thinking: "whole" }, asks: false, signal: new AbortController().signal });
  narration.add({ beats: [{ beat: { id: "b1", at: 600, order: 0, place: "cafe", actors: ["maya"], act: "did", about: [], what: blobHash(what), surface: blobHash(what), exposure: [{ who: world.pov, channel: "sight", reach: "whole" }], by: { turn: "t1", decided: "character" } }, what, surface: what }], mark: 0 });
  expect((await narration.drain()).told[0]?.faithful).toBeNull();

  // Every call but the narrator's keeps its answer whole, as written, with why it couldn't be read.
  const provenance = calls.map((c) => {
    const misread = kept.get(c);
    return misread ? { ...c, misread } : { ...c };
  });
  expect(provenance.map((c) => [c.role, c.misread?.raw ?? null, c.misread?.fields.map((f) => [f.field, f.why?.split(" (")[0]])])).toEqual([
    ["author", "I'd rather set this scene in prose.", [[WHOLE_ANSWER, "the author's answer wasn't the JSON object it was asked for"]]],
    ["watch", "Nothing to flag; carry on.", [[WHOLE_ANSWER, "the watch's answer wasn't the JSON object it was asked for"]]],
    ["narrator", null, undefined],
    ["check", "Looks faithful to me.", [[WHOLE_ANSWER, "the check's answer wasn't the JSON object it was asked for"]]],
    ["check", "Still faithful.", [[WHOLE_ANSWER, "the check's answer wasn't the JSON object it was asked for"]]],
  ]);

  // The turn inspector shows each such call flagged, why, and the answer as the model wrote it.
  const tree = render(TurnBody({ view: { ...VIEW, provenance: { calls: provenance, turnMs: 9000, firstContentMs: null } }, busy: false, onPick: () => {}, onJump: () => {} }));
  const text = textOf(tree);
  for (const shown of ["I'd rather set this scene in prose.", "Nothing to flag; carry on.", "Looks faithful to me.", "Still faithful.", "The answer as the model wrote it", "the watch's answer wasn't the JSON object it was asked for (7 tokens out; its text ran to 26 characters)"]) expect(text).toContain(shown);
  expect(propsOf(tree, "div").filter((p) => p["data-lre-depth-misread"] !== undefined)).toHaveLength(4);
});
