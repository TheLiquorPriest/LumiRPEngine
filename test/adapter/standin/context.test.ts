// What the stand-in Lumiverse hands each extension's prompt interceptor in its context, held to Lumiverse's own source (staging at a70f4ed2;
// paths are Lumiverse's `src/`): the resolved preset's id, and of its metadata only the namespace of the extension that is handed it. Every name is
// invented.

import { describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import { StandIn, type Outcome } from "../../standin/lumiverse";

const USER = "user-ford";
const CHAT = "chat-ford";
const MODEL = "http://127.0.0.1:7897";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

function ford(metadata?: Record<string, unknown>): StandIn {
  const lv = new StandIn();
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT the ford runs."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-ford", { id: "preset-ford", name: "Ford", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a ford." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }], ...(metadata !== undefined ? { metadata } : {}) });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-ford", name: "Ford" }, messages: [{ id: "m0", role: "assistant", content: "GREET The ford is shallow." }] });
  return lv;
}

async function generate(lv: StandIn): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-ford" });
  expect(out.error).toBeNull();
  return out;
}

/** An interceptor of the extension installed under this identifier, which keeps the context it is handed, and may write on what it finds there. */
function keeping(lv: StandIn, identifier: string, scribble = false): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  lv.install(["interceptor"], identifier).registerInterceptor(async (messages, context) => {
    // What it is handed, less the signal that cancels it (which no copy can hold).
    const { signal: _signal, ...ctx } = context as Record<string, unknown>;
    seen.push(structuredClone(ctx));
    if (scribble && typeof ctx.presetMetadata === "object" && ctx.presetMetadata !== null) (ctx.presetMetadata as Record<string, unknown>).scribbled = true;
    return messages;
  }, {});
  return seen;
}

describe("the preset's metadata in an interceptor's context (`generate.service.ts:1226-1231`; `spindle/worker-host.ts:3173`, `:3200-3204`; `spindle/preset-metadata-context.ts`)", () => {
  test("each extension's interceptor context carries only its own namespace of the preset's metadata", async () => {
    const lv = ford({ "lumi-alpha": { note: "ALPHA-NOTE", nested: { deep: 1 } }, "lumi-beta": { note: "BETA-NOTE" }, source: "an import", promptVariables: { tone: "grim" } });
    const alpha = keeping(lv, "lumi-alpha", true);
    const beta = keeping(lv, "lumi-beta");
    const gamma = keeping(lv, "lumi-gamma");
    const owned = keeping(lv, "source");
    const hidden = keeping(lv, "_lumiverse_internal");
    await generate(lv);
    // Its own namespace, deep copied: what the first wrote on its copy (`scribbled`) is not on the preset's.
    expect(lv.presets.get("preset-ford")!.metadata).toEqual({ "lumi-alpha": { note: "ALPHA-NOTE", nested: { deep: 1 } }, "lumi-beta": { note: "BETA-NOTE" }, source: "an import", promptVariables: { tone: "grim" } });
    expect(alpha[0]!.presetMetadata).toEqual({ note: "ALPHA-NOTE", nested: { deep: 1 } });
    expect(beta[0]!.presetMetadata).toEqual({ note: "BETA-NOTE" });
    // An extension with no namespace, one named as a key Lumiverse's own editor keeps, and one named as its internal ones: none.
    for (const none of [gamma, owned, hidden]) expect(none[0]!.presetMetadata).toBeUndefined();
    // The full metadata is on none of them, and the preset's id is on every one.
    for (const seen of [alpha, beta, gamma, owned, hidden]) {
      expect(Object.keys(seen[0]!)).not.toContain("__spindlePresetMetadata");
      expect(seen[0]).toMatchObject({ presetId: "preset-ford", chatId: CHAT });
      expect(JSON.stringify(seen[0])).not.toContain("an import");
    }
    expect(JSON.stringify(beta[0])).not.toContain("ALPHA-NOTE");
  });

  test("a preset with no metadata leaves each extension none, and its identifier is its id unless one is given", async () => {
    const lv = ford();
    const plain = lv.install(["interceptor"]);
    expect(plain.identifier).toBe(plain.id);
    const seen = keeping(lv, "lumi-alpha");
    await generate(lv);
    expect(seen[0]!.presetMetadata).toBeUndefined();
    expect(Object.hasOwn(seen[0]!, "presetMetadata")).toBe(true);
  });
});
