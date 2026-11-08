// The loopback end to end (DEPTH-PLAN §9.2 B1): the real relay (src/cli/loopback-relay.ts) talks to
// the whole backend on the fake host through the dispatcher, as its socket would, with the chunks the
// bridge pushes to its session handed back to it; core's request is the fake host's own generation
// (guard, World Info, the turn tagger), read by core's vendored stream reader; the narrator's upstream
// is the fake host's scripted model. A turn streams the engine's progress and the narrator's
// reasoning, then the reply, and commits; Stop aborts the call and the narrator's call under it, and
// a send stopped before any text leaves no blank reply; a depth turn stopped after its prose
// streamed commits its cut scene, whichever word of the Stop comes first; a swipe plays as the swipe
// setting says, a Continue continues, an Impersonate runs no engine; a tool round goes on from the
// turn's one engine run; an untagged request runs as given, tools and non-stream included.
//
// Time is real: the bridge coalesces text on its own timer and the relay's answer is a live stream,
// so waits are on the events they name, or (where nothing announces the state) a short poll for it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { DepthCommit } from "../../src/backend/loopback/bridge";
import { toChain } from "../../src/backend/ledger-io";
import { LreError } from "../../src/cli/connection";
import type { CallFields, CallRequestType, RelayLink } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import { isRecord } from "../../src/shared/json";
import type { LoopbackResultBodies } from "../../src/shared/loopback";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import type { Generation, QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";
import type { CoreChunk } from "../cli/core-staging/llm/openai-stream";
import { coreGenerate, coreStream } from "../cli/core-staging/llm/openai-stream";

const SESSION = "5e55".repeat(8);
const PORT = 7861;
const NARRATOR = "You are the narrator of this story.";
const TOOL_RESULTS = "## Inline Council Tool Results";
const DICE = [{ type: "function", function: { name: "roll_dice", description: "Roll a die.", parameters: { type: "object", properties: { sides: { type: "number" } } } } }];

/** Polls for a state no event announces (the relay's calls, a deletion the ledger makes on its own queue). */
async function until(done: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(2);
  }
}

/** Resolves once the signal has aborted. */
function abortOf(signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) resolve();
  else signal.addEventListener("abort", () => resolve(), { once: true });
  return promise;
}

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

/** A world chat on the loopback connection, its relay registered, keyed and said hello; `narrator` answers every call whose prompt holds the chat's own system prompt. */
async function setup(narrator: (req: QuietRequest) => QuietScript | Promise<QuietScript>) {
  const rig = new Rig();
  const host = rig.host;
  host.connectionProfiles.push({ id: "conn-loop", name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: `http://127.0.0.1:${PORT}/v1` });
  host.contextConnectionId = "conn-loop";
  host.quietReply = (req) => (req.messages.some((m) => m.content.includes(NARRATOR)) ? narrator(req) : "{}");
  const link = new BackendLink(rig);
  const registered = await link.send("lre.loopback.register", { name: "sam", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: PORT });
  link.secret = isRecord(registered) && typeof registered.secret === "string" ? registered.secret : "";
  const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" })).page;
  const key = isRecord(page) && typeof page.minted === "string" ? page.minted : "";
  expect(key).toStartWith("lre_lk_");
  const report = { name: "sam", build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: PORT, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 };
  await link.send("lre.loopback.hello", { api: 1, report, open: [] });
  const relay = new Relay(link, { ...RELAY_DEFAULTS, listen: "127.0.0.1", port: PORT, mode: "user" }, { now: Date.now, id: () => crypto.randomUUID().replaceAll("-", ""), log: () => undefined, fingerprint: async () => "fp" });
  // Each chunk the bridge pushes to the relay's session reaches the relay once the frame has crossed its socket.
  const send = host.frontend.send;
  host.frontend.send = (message, userId, session) => {
    send(message, userId, session);
    if (message.type === "lre.loopback.chunk" && session === SESSION) queueMicrotask(() => relay.chunk(message));
  };
  const chatId = await rig.worldChat();
  return { rig, host, relay, key, chatId };
}

function post(relay: Relay, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) }));
}

/** Core's provider call for a generation: its final prompt, with the parameters the interceptors merged in (the turn's tag). */
function generation(relay: Relay, key: string, g: Generation, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Response> {
  return post(relay, key, { model: LOOPBACK_MODEL, stream: true, messages: g.prompt ?? [], ...g.parameters, ...extra }, signal);
}

/** What core's reader made of an answer: the reply's text, the thinking block, the finish, the tool calls. */
async function read(res: Response): Promise<{ content: string; reasoning: string; finish: string; tools: CoreChunk["tool_calls"] }> {
  let content = "";
  let reasoning = "";
  let finish = "";
  let tools: CoreChunk["tool_calls"];
  for await (const c of coreStream(res)) {
    content += c.token;
    reasoning += c.reasoning ?? "";
    if (c.finish_reason) finish = c.finish_reason;
    if (c.tool_calls) tools = c.tool_calls;
  }
  return { content, reasoning, finish, tools };
}

/** Reads the answer until `enough` says so, as core's reader shows it, then stops reading. */
async function readUntil(res: Response, enough: (seen: { content: string; reasoning: string }) => boolean): Promise<{ content: string; reasoning: string }> {
  const seen = { content: "", reasoning: "" };
  for await (const c of coreStream(res)) {
    seen.content += c.token;
    seen.reasoning += c.reasoning ?? "";
    if (enough(seen)) break;
  }
  return seen;
}

/** The chat's chain as the ledger reads it, each message with its record. */
async function chain(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  return core?.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))) ?? [];
}

/** The scenes the commits were handed, in order; `committed` resolves at the first. */
function watchCommits(rig: Rig): { seen: unknown[]; committed: Promise<void> } {
  const seen: unknown[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  const commit = rig.rt.beforeCommit.bind(rig.rt);
  rig.rt.beforeCommit = async (input) => {
    seen.push(input.scene);
    resolve();
    await commit(input);
  };
  return { seen, committed: promise };
}

describe("the loopback's bridge", () => {
  test("a turn: the relay's call runs the engine and the narrator, streams their thinking then the reply, and the reply commits", async () => {
    const { rig, host, relay, key, chatId } = await setup(() => ({ content: "Mira looks up from the counter and smiles.", reasoning: "She heard the bell over the door." }));
    host.sendUser(chatId, "I walk into the shop.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    // The guard let it straight on, and the tagger tagged it.
    expect(g.halted).toBeUndefined();
    expect(typeof g.parameters?.lre_turn).toBe("string");
    const { content, reasoning, finish } = await read(await generation(relay, key, g));
    expect(content).toBe("Mira looks up from the counter and smiles.");
    expect(finish).toBe("stop");
    expect(reasoning).toContain("LumiRPEngine is working out the turn");
    expect(reasoning).toContain("She heard the bell over the door.");
    // The narrator's prompt is the final body with today's sections placed.
    const narrated = host.quietCalls.find((r) => r.messages.some((m) => m.content.includes(NARRATOR)));
    expect(narrated?.messages.some((m) => m.content.includes("[Narrator rules]"))).toBe(true);
    await host.finish(g, content);
    expect((await chain(rig, chatId)).at(-1)?.ledger?.swipes["0"]?.status).toBe("ok");
    expect(relay.count).toBe(0);
  });

  test("Stop: core closing the request aborts the call and the narrator's call under it; the blank reply goes, and the next reply is no redo", async () => {
    // A narrator that never answers: only its signal ends it.
    let answer: (req: QuietRequest) => QuietScript | Promise<QuietScript> = () => Promise.withResolvers<QuietScript>().promise;
    const { rig, host, relay, key, chatId } = await setup((req) => answer(req));
    host.sendUser(chatId, "I wait by the door.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    const closed = new AbortController();
    await readUntil(await generation(relay, key, g, {}, closed.signal), (seen) => seen.reasoning.includes("The narrator is writing the reply"));
    closed.abort();
    await until(() => relay.count === 0 && host.quietStopped.length > 0);
    expect(host.quietStopped[0]).toContain("gave the call up");
    await host.stop(g, "");
    // Core left the reply it staged blank (D0a check 3): LumiRPEngine deleted it.
    await until(() => host.chat(chatId).messages.at(-1)?.isUser === true);
    expect(host.chat(chatId).messages.some((m) => !m.isUser && m.swipes.every((s) => s === ""))).toBe(false);
    // That deletion was LumiRPEngine's own: generating again is a new reply, not a redo of one the player deleted.
    answer = () => ({ content: "Nobody answers.", reasoning: "The house is quiet." });
    const again = await host.begin(chatId, { type: "normal" });
    const second = await read(await generation(relay, key, again));
    expect(second.content).toBe("Nobody answers.");
    expect(second.reasoning).not.toContain("Redoing the reply you deleted");
    await host.finish(again, second.content);
    expect((await chain(rig, chatId)).at(-1)?.ledger?.swipes["0"]?.status).toBe("ok");
  });

  test("Stop on a depth turn whose prose streamed: its cut scene commits, though the relay's word of the Stop came before core's", async () => {
    const { rig, host, relay, key, chatId } = await setup(() => "unused");
    const commits = watchCommits(rig);
    const scene: DepthCommit = { pre: [], read: [], blobs: {} };
    const stopping = Promise.withResolvers<void>();
    const cut = Promise.withResolvers<void>();
    // A depth turn renders its first moment, then stops between beats: what it hands back is cut where its last passage streamed.
    rig.rt.loopback.depth = async (ctx) => {
      ctx.sink.progress("The author is setting the scene");
      ctx.sink.content("The door gives under your shoulder.");
      await abortOf(ctx.signal);
      stopping.resolve();
      await cut.promise;
      return scene;
    };
    host.sendUser(chatId, "I shoulder the door.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    const closed = new AbortController();
    const { content } = await readUntil(await generation(relay, key, g, {}, closed.signal), (seen) => seen.content.endsWith("shoulder."));
    closed.abort();
    // The relay's abort reaches LumiRPEngine first; core's Stop comes while the scene is still being cut.
    await stopping.promise;
    await host.stop(g, content);
    cut.resolve();
    await commits.committed;
    await host.settle();
    expect(commits.seen).toEqual([scene]);
    const reply = (await chain(rig, chatId)).at(-1);
    expect(reply?.swipes).toEqual(["The door gives under your shoulder."]);
    expect(reply?.ledger?.swipes["0"]?.status).toBe("ok");
  });

  test("Stop on a depth turn before any passage streamed commits nothing, and its blank reply goes", async () => {
    const { rig, host, relay, key, chatId } = await setup(() => "unused");
    const commits = watchCommits(rig);
    const stopping = Promise.withResolvers<void>();
    rig.rt.loopback.depth = async (ctx) => {
      ctx.sink.progress("The author is setting the scene");
      await abortOf(ctx.signal);
      stopping.resolve();
      return { pre: [], read: [], blobs: {} };
    };
    host.sendUser(chatId, "I knock.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    const closed = new AbortController();
    await readUntil(await generation(relay, key, g, {}, closed.signal), (seen) => seen.reasoning.includes("The author is setting the scene"));
    closed.abort();
    await stopping.promise;
    await host.stop(g, "");
    await until(() => host.chat(chatId).messages.at(-1)?.isUser === true);
    await host.settle();
    expect(commits.seen).toEqual([]);
    expect((await chain(rig, chatId)).at(-1)?.swipes).toEqual(["I knock."]);
  });

  test("a swipe plays as the swipe setting says (Re-narrate as shipped, then Re-run), a Continue continues, and each commits", async () => {
    const replies = ["Mira looks up.", "Mira glances over.", "Mira turns around.", "She waves you in."];
    let n = 0;
    const { rig, host, relay, key, chatId } = await setup(() => ({ content: replies[n++] ?? "More.", reasoning: "Thinking it over." }));
    host.sendUser(chatId, "I walk in.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    await host.finish(g, (await read(await generation(relay, key, g))).content);
    // Re-narrate, the shipped swipe setting: the same beats, told afresh.
    const renarrate = await host.begin(chatId, { type: "swipe" });
    const told = await read(await generation(relay, key, renarrate));
    expect(told.reasoning).toContain("Re-narrating, as your swipe setting says");
    expect(told.content).toBe("Mira glances over.");
    await host.finish(renarrate, told.content);
    // Re-run once the setting says so: the scene plays again from the same moment.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "rerun" } }));
    const rerun = await host.begin(chatId, { type: "swipe" });
    const played = await read(await generation(relay, key, rerun));
    expect(played.reasoning).toContain("Re-running, as your swipe setting says");
    await host.finish(rerun, played.content);
    expect(host.head(chatId)?.swipes).toEqual(["Mira looks up.", "Mira glances over.", "Mira turns around."]);
    const swiped = (await chain(rig, chatId)).at(-1);
    expect([swiped?.ledger?.swipes["1"]?.status, swiped?.ledger?.swipes["2"]?.status]).toEqual(["ok", "ok"]);
    // A Continue goes on from where the reply ends.
    const more = await host.begin(chatId, { type: "continue" });
    const continued = await read(await generation(relay, key, more));
    expect(continued.reasoning).toContain("Continuing the reply from where it ends");
    await host.finish(more, continued.content);
    expect(host.head(chatId)?.swipes[2]).toBe("Mira turns around. She waves you in.");
    expect(relay.count).toBe(0);
  });

  test("an Impersonate runs no engine: the narrator writes the player's next message from the body as given", async () => {
    const { host, relay, key, chatId } = await setup(() => ({ content: "I step inside and close the door behind me." }));
    const before = host.quietCalls.length;
    const g = await host.begin(chatId, { type: "impersonate" });
    expect(typeof g.parameters?.lre_turn).toBe("string");
    const { content, reasoning } = await read(await generation(relay, key, g));
    expect(content).toBe("I step inside and close the door behind me.");
    expect(reasoning).toContain("Writing your character's next message");
    expect(reasoning).not.toContain("LumiRPEngine is working out the turn");
    await host.finish(g, content);
    // The narrator's was the only model call: no engine step ran.
    expect(host.quietCalls.length).toBe(before + 1);
    expect(host.quietCalls.at(-1)?.messages.some((m) => m.content.includes(NARRATOR))).toBe(true);
  });

  test("a tool round goes on from the turn's one engine run, and the reply commits", async () => {
    const { rig, host, relay, key, chatId } = await setup((req) =>
      req.messages.some((m) => m.content.includes(TOOL_RESULTS)) ? { content: "You rolled a 16: the lock gives.", reasoning: "Sixteen beats the lock." } : { content: "", toolCalls: [{ name: "roll_dice", args: { sides: 20 }, callId: "call_1" }] },
    );
    host.sendUser(chatId, "I pick the lock.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    const first = await read(await generation(relay, key, g, { tools: DICE, tool_choice: "auto" }));
    expect(first.finish).toBe("tool_calls");
    expect(first.tools).toEqual([{ name: "roll_dice", args: { sides: 20 }, call_id: "call_1" }]);
    const asked = host.quietCalls.find((r) => r.messages.some((m) => m.content.includes(NARRATOR)));
    expect(asked?.tools?.map((t) => t.name)).toEqual(["roll_dice"]);
    expect(asked?.toolChoice).toBe("auto");
    // Core ran the tool and calls again with the same tag, the results as a system message (D0a check 9).
    const results = { role: "system", content: `${TOOL_RESULTS}\nThe model requested council tool calls during generation. Use these results to continue the reply naturally.\n\n### roll dice\nThe d20 rolled 16.` };
    const second = await read(await generation(relay, key, g, { messages: [...(g.prompt ?? []), results], tools: DICE, tool_choice: "auto" }));
    expect(second.content).toBe("You rolled a 16: the lock gives.");
    expect(second.reasoning).toContain("The tools answered: the narrator goes on");
    expect(second.reasoning).not.toContain("LumiRPEngine is working out the turn");
    await host.finish(g, second.content);
    expect((await chain(rig, chatId)).at(-1)?.ledger?.swipes["0"]?.status).toBe("ok");
  });

  test("an untagged request runs as given on the narrator's connection: tools answered in kind, and without streaming as one answer", async () => {
    const { host, relay, key } = await setup((req) => (req.tools?.length ? { content: "", toolCalls: [{ name: "roll_dice", args: { sides: 6 }, callId: "call_9" }] } : { content: "Chapter two, in short: Mira finds the letter.", reasoning: "Summing up." }));
    const system = { role: "system", content: NARRATOR };
    const tooled = await read(await post(relay, key, { model: LOOPBACK_MODEL, stream: true, messages: [system, { role: "user", content: "Roll for me." }], tools: DICE, tool_choice: "required" }));
    expect(tooled.finish).toBe("tool_calls");
    expect(tooled.tools).toEqual([{ name: "roll_dice", args: { sides: 6 }, call_id: "call_9" }]);
    expect(host.quietCalls.at(-1)?.toolChoice).toBe("required");
    const res = await post(relay, key, { model: LOOPBACK_MODEL, stream: false, messages: [system, { role: "user", content: "Sum up chapter two." }] });
    expect(res.headers.get("content-type")).toContain("application/json");
    const answer = coreGenerate(await res.json());
    expect(answer.content).toBe("Chapter two, in short: Mira finds the letter.");
    expect(answer.reasoning).toBe("Summing up.");
    expect(relay.count).toBe(0);
  });

  test("a key that isn't a loopback key, and a world chat's turn with streaming off, are refused", async () => {
    const { host, relay, key, chatId } = await setup(() => "unused");
    const bad = await relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/models`, { headers: { authorization: "Bearer lre_lk_nope", host: `127.0.0.1:${PORT}` } }));
    expect(bad.status).toBe(401);
    const good = await relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/models`, { headers: { authorization: `Bearer ${key}`, host: `127.0.0.1:${PORT}` } }));
    expect(await good.json()).toEqual({ object: "list", data: [expect.objectContaining({ id: LOOPBACK_MODEL })] });
    host.sendUser(chatId, "Hello?");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    const off = await generation(relay, key, g, { stream: false });
    expect(JSON.stringify(await off.json())).toContain("streaming off");
    await host.stop(g, "");
  });
});
