// Port Alder on agents, played a turn at a time as the Curator's purchase tests play it (ITEMS-SPEC
// §7): the fixed pipeline's roles agent-backed, Danny and Priya beside the player character, each
// role's agent answering in its contract with nothing in it, the reply's read proposing what a test
// says, and the Curator's agent answering each of its calls as its script says. Starter-world names
// only.

import { expect } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import type { WorldState } from "../../src/engine/state";
import { heldBy } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { QuietScript } from "./fake-host";
import { alderChat, DANNY, PRIYA, type Put, stateOf } from "./mind-chat";
import type { Rig } from "./rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";

/** The role whose agent made a call, as its system prompt names it; null for a classic call. */
export const roleOf = (req: QuietRequest): string | null => /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;

/** A tool call as a model makes one. */
export const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });

/** What the tools gave back, on the call that sends their results. */
export const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));

/** A role agent's answer in its contract, with nothing in it, and a classic call's. */
function quietRole(role: string | null, req: QuietRequest): QuietScript {
  const all = req.messages.map((m) => m.content).join("\n");
  if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
  if (role === "curator") return JSON.stringify({ proposals: [] });
  if (role === "knowledge") return JSON.stringify({ facts: [], learned: [], inferred: [], doubted: [] });
  if (role === "minds") return JSON.stringify({ monologue: "Nothing yet.", depiction: "looks up", intent: "Wait.", reactions: [], mood: "calm" });
  if (role === "memory") return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [] });
  if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [], where: null });
  return "{}";
}

/** Port Alder on agents, Danny and Priya beside the player character; `setup` writes into the world's draft before its commit. */
export async function curatorChat(rig: Rig, setup: (put: Put) => Promise<void> = async () => {}): Promise<string> {
  const chatId = await alderChat(rig, setup, [DANNY, PRIYA]);
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  return chatId;
}

/** One turn as a test plays it. */
export interface CuratedTurn {
  said: string;
  reply: string;
  /** What the reply's read proposes; those of the Curator's types it holds aside for the Curator. */
  read?: JsonObject[];
  /** The Curator's agent's answer to its `n`th call (from 0). */
  curator(req: QuietRequest, n: number): QuietScript;
}

/** One turn played: the player says `said`, the read and the Curator answer as `turn` says, and the reply is `reply`. The state it leaves, and every call the Curator's agent made. */
export async function curatedTurn(rig: Rig, chatId: string, turn: CuratedTurn): Promise<{ state: WorldState; curator: QuietRequest[] }> {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req) => {
    const role = roleOf(req);
    if (role === "curator") {
      asked.push(req);
      return turn.curator(req, asked.length - 1);
    }
    if (role === "read") return JSON.stringify({ proposals: turn.read ?? [], where: null });
    return quietRole(role, req);
  };
  rig.host.sendUser(chatId, turn.said);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  await rig.host.finish(g, turn.reply);
  expect(rig.rt.ledger.errors).toEqual([]);
  return { state: (await stateOf(rig, chatId)).state, curator: asked };
}

/** The "Bought …" lines on the player character's own accounts' journals, oldest first: the account, the memo and what each charged. */
export function boughtLines(state: WorldState, pov: string): { account: string; memo: string; cents: number }[] {
  const journal = state.packs.economy?.journal;
  const out: { account: string; memo: string; cents: number; at: number }[] = [];
  for (const [account, entries] of Object.entries(journal && typeof journal === "object" && !Array.isArray(journal) ? journal : {})) {
    if (!heldBy(state.entities, account, pov)) continue;
    for (const j of Array.isArray(entries) ? entries : []) {
      if (!j || typeof j !== "object" || Array.isArray(j) || typeof j.memo !== "string" || !j.memo.startsWith("Bought ")) continue;
      out.push({ account, memo: j.memo, cents: typeof j.cents === "number" ? Math.abs(j.cents) : 0, at: typeof j.at === "number" ? j.at : 0 });
    }
  }
  return out.sort((x, y) => x.at - y.at).map(({ account, memo, cents }) => ({ account, memo, cents }));
}
