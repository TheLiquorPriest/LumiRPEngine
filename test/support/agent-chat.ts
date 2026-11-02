// A long agents chat as the perf script (`scripts/perf/agent-chat.ts`) and the perf regression test
// play it: Port Alder (the modern slice-of-life starter) with Danny and Priya beside the player
// character, minds on, on agents with the pipeline set to a main agent and every role an agent, as
// Settings ships them. Each turn's models are scripted: the main agent runs every role its stage asks
// for and commits once their results are in; each role answers in its contract with prose and
// reasoning about as long as a large model's; the scene writes a note every third turn. A swipe every
// fifteenth turn, a GM note every seventh and a question to the GM assistant every twelfth. Nothing
// in it comes from any player's data.

import { SCRATCH_READ } from "../../src/backend/agents/runtime";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import type { QuietScript } from "./fake-host";
import { alderChat, DANNY, PRIYA } from "./mind-chat";
import type { Rig } from "./rig";

/** The page the chat is played on. */
export const AGENT_CHAT_PAGE = "desk";
const SWIPE_EVERY = 15;
const GM_NOTE_EVERY = 7;
const ASK_EVERY = 12;

const ROLE = /You are the (\w+) agent of LumiRPEngine/;
const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
const INTERPRET = "You map a player's typed input";
const EXTRACT = "propose concrete state changes";
const COMPACTION = "You keep a main agent's session short";
const WORDS = ["harbor", "ledger", "window", "lantern", "bench", "market", "ferry", "garden", "workshop", "kettle", "bridge", "orchard", "counter", "parcel", "radio", "awning", "porch", "tide"];
const VERBS = ["check", "carry", "sort", "mend", "watch", "open", "close", "count"];

const word = (t: number): string => WORDS[t % WORDS.length] as string;

/** `n` sentences of neutral prose seeded by `t`. */
export function prose(t: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`The ${word(t + i)} by the ${word(t + i * 3)} ${i % 2 === 0 ? "catches the light" : "creaks in the wind"} as the ${word(t + i * 5)} settles.`);
  return out.join(" ");
}

/** The player's message on turn `t`. */
export function userText(t: number): string {
  return `I ${VERBS[t % VERBS.length]} the ${word(t)} near the ${word(t + 5)}, then look around (turn ${t}).`;
}

/** The narrator's reply: 4 to 8 kB. */
export function replyText(t: number, swipe: number): string {
  return `Turn ${t}, take ${swipe}. ${prose(t + swipe, 50 + ((t * 7 + swipe * 13) % 50))}`;
}

/** A large model's reasoning before it answers: about 700 characters. */
function reasoning(t: number, who: string): string {
  return `${who} thinks it over on turn ${t}. ${prose(t * 3, 8)}`;
}

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");
const stageOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";

/** A role agent's answer in its contract, with prose about as long as a large model's. */
function roleAnswer(role: string, req: QuietRequest, t: number): QuietScript {
  const all = sentOf(req);
  const think = { reasoning: reasoning(t, `The ${role} agent`) };
  const answer = (content: JsonObject): QuietScript => ({ content: JSON.stringify(content), ...think });
  if (role === "scene") {
    if (t % 3 === 0 && resultsOf(req).length === 0) return { content: "", toolCalls: [call("workspace_write", { path: `notes/scene-${t % 9}.md`, text: `# The ${word(t)}\n\n${prose(t, 12)}` }, `w${t}`)], ...think };
    return answer({ lore: [], notes: [`Danny is at the ${word(t)}, busy with the ${word(t + 1)}.`, `Priya waits by the ${word(t + 2)}.`] });
  }
  if (role === "knowledge") return answer({ facts: [], learned: [], inferred: [], doubted: [] });
  if (role === "minds") return answer({ monologue: `${prose(t + 7, 4)} Turn ${t}.`, depiction: `looks at the ${word(t)}`, intent: "Keep at the day's work.", reactions: [], mood: "calm" });
  if (role === "memory") return answer({ notes: [{ text: `Noticed the ${word(t)} by the ${word(t + 4)} on turn ${t}.`, salience: 3 }], commitments: [], resolved: [], plans: [] });
  if (all.includes(INTERPRET)) return answer({ action: null, params: {}, confidence: 0.9 });
  if (all.includes(EXTRACT)) return answer({ proposals: t % 3 === 0 ? [{ type: "time_advance", minutes: 10 }] : [], where: null });
  return answer({});
}

/** The main agent: it runs every role its stage asks for, each with a task, and commits once their results are in. */
function mainAnswer(req: QuietRequest, t: number, n: number): QuietScript {
  const think = { reasoning: reasoning(t, "The main agent") };
  if (resultsOf(req).length > 0) return { content: `Stage done on turn ${t}: ${prose(t + n, 2)}`, toolCalls: [call("commit", {}, `c${t}_${n}_commit`)], ...think };
  const roles = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
  return { content: "", toolCalls: roles.map((role) => call("run_role", { role, task: `Turn ${t}: do the ${role} work. ${prose(t + role.length, 3)}` }, `c${t}_${n}_${role}`)), ...think };
}

/** Every call of the chat's models, by the turn being played. */
export function scripted(turn: () => number): (req: QuietRequest) => QuietScript {
  let n = 0;
  return (req) => {
    const t = turn();
    n++;
    const tools = req.tools ?? [];
    if (tools.some((x) => x.name === "run_role")) return mainAnswer(req, t, n);
    const all = sentOf(req);
    if (all.includes(COMPACTION)) return `Summary through turn ${t}. ${prose(t, 30)}`;
    const role = ROLE.exec(req.messages[0]?.content ?? "")?.[1];
    if (role !== undefined) return roleAnswer(role, req, t);
    // The GM assistant: the one agent offered scratch_read beside the read tools outside a turn.
    if (tools.some((x) => x.name === SCRATCH_READ)) {
      if (resultsOf(req).length === 0) return { content: "", toolCalls: [call("workspace_write", { path: `learned/danny-${t}.md`, text: `Danny on turn ${t}: ${prose(t, 4)}` }, `a${t}`)], reasoning: reasoning(t, "The assistant") };
      return { content: `Noted what Danny did by turn ${t}. ${prose(t + 1, 5)}`, reasoning: reasoning(t, "The assistant") };
    }
    const system = req.messages[0]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) return JSON.stringify({ monologue: `${mind} turns over the ${word(t)} from turn ${t}.`, depiction: `${mind} glances at the ${word(t + 1)}`, intent: "Keep at the day's work.", reactions: [], plans: [], mood: "calm" });
    if (MEMORY.test(system)) return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });
    if (system.includes(INTERPRET)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (system.includes(EXTRACT)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
}

/** The chat, set up to be played: the main agent, each role an agent, no cap on a turn's tokens, and its page open on it. Its models are the host's (`scripted`). */
export async function agentChat(rig: Rig): Promise<string> {
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, turn: { tokensIn: "none", tokensOut: "none" } } } }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  rig.body(await rig.send({ type: "lre.hello", chatId }, AGENT_CHAT_PAGE));
  return chatId;
}

/** Turn `t` of the chat: the player's message and the reply, then the swipe, GM note or question to the GM assistant that falls on it. */
export async function playTurn(rig: Rig, chatId: string, t: number): Promise<void> {
  await rig.turn(chatId, userText(t), replyText(t, 0));
  if (t % SWIPE_EVERY === SWIPE_EVERY - 1) await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), replyText(t, 1));
  if (t % GM_NOTE_EVERY === 0) rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: `notes/gm-${t % 5}.md`, text: `# GM note, turn ${t}\n\n${prose(t + 11, 8)}` }));
  if (t % ASK_EVERY === ASK_EVERY - 1) {
    rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text: `What is Danny up to by turn ${t}? Note it.` }, AGENT_CHAT_PAGE));
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
  }
}
