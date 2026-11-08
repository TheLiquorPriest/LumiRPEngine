// The loopback relay's abort and reconnect (DEPTH-PLAN §9.2 B1, §3.6, §3.10). Stop: core force-closes
// the request, here a real client against Bun.serve with `idleTimeout: 0`, and the relay tells
// LumiRPEngine, never before the call's begin was answered. Reconnect: Lumiverse drops the relay's
// socket mid-call (the fake host restarts); the relay reconnects, says hello with the call and its
// last chunk, and the reply completes in core's reader with nothing lost or repeated, a gap asked for
// again. And the cases D0a found live (check 4): LumiRPEngine's worker restarting under a live
// socket, or going silent, ends the reply with words instead of hanging it.

import { describe, expect, test } from "bun:test";
import type { CallFields, CallRequestType, RelayLink, RelaySettings } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import { LoopbackLink } from "../../src/cli/loopback-link";
import type { LoopbackChunk, LoopbackRelayView, LoopbackResultBodies } from "../../src/shared/loopback";
import { loopbackUnready } from "../../src/shared/loopback";
import { coreStream } from "./core-staging/llm/openai-stream";
import { FakeLumiverse, USER } from "./fake-lumiverse";

type Payload = Record<string, unknown>;

async function until(done: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(1);
  }
}

const settings = (port: number): RelaySettings => ({ ...RELAY_DEFAULTS, listen: "127.0.0.1", port, mode: "user" });

let ids = 0;
const env = { now: Date.now, id: () => `${(++ids).toString(16).padStart(8, "0")}${"b".repeat(24)}`, log: () => undefined, fingerprint: async () => "fp" };

const BODY = { model: "lre-narrator", stream: true, lre_turn: "tok_live", messages: [{ role: "user", content: "[lre: the story so far]" }] };

describe("Stop", () => {
  test("core closing the request mid-stream aborts the call, and never before its begin was answered", async () => {
    const sent: { type: string; fields: Payload }[] = [];
    const gate: { open: (() => void) | null } = { open: null };
    const link: RelayLink = {
      up: true,
      out: null,
      refused: null,
      async request<T extends CallRequestType>(type: T, fields: CallFields<T>): Promise<LoopbackResultBodies[T]> {
        sent.push({ type, fields: fields as unknown as Payload });
        if (type === "lre.loopback.begin" && gate.open === null) {
          const { promise, resolve } = Promise.withResolvers<void>();
          gate.open = resolve;
          await promise;
        }
        return (type === "lre.loopback.begin" ? { turn: "turn-1" } : { aborted: true }) as LoopbackResultBodies[T];
      },
    };
    const config = settings(0);
    const relay = new Relay(link, config, env);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: relay.fetch });
    config.port = server.port ?? 0;
    try {
      const stop = new AbortController();
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer lk_test_key", "content-type": "application/json" }, body: JSON.stringify(BODY), signal: stop.signal });
      const reader = res.body?.getReader();
      // The role chunk is out before LumiRPEngine answered the begin.
      expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('"role":"assistant"');
      const call = String(sent.find((s) => s.type === "lre.loopback.begin")?.fields.call);
      stop.abort();
      await until(() => relay.count === 0);
      // Still unanswered: the abort waits for the begin, so it can't overtake it.
      expect(sent.map((s) => s.type)).toEqual(["lre.loopback.begin"]);
      gate.open?.();
      await until(() => sent.length === 2);
      expect(sent[1]).toEqual({ type: "lre.loopback.abort", fields: { call, reason: "closed" } });
    } finally {
      server.stop(true);
    }
  });
});

/** LumiRPEngine's bridge as the relay meets it on the fake host: it keeps each call's chunks until acked, and pushes them again on hello and resend. */
class FakeBridge {
  readonly received: Payload[] = [];
  /** Each call's chunks in order, as LumiRPEngine made them. */
  readonly chunks = new Map<string, LoopbackChunk[]>();
  /** Chunks not sent the first time (lost on the way). */
  readonly skip = new Set<number>();

  constructor(private readonly fake: FakeLumiverse) {
    const handle = fake.lre.handle.bind(fake.lre);
    fake.lre.handle = (r) => (typeof r.type === "string" && r.type.startsWith("lre.loopback.") ? this.handle(r) : handle(r));
  }

  of(type: string): Payload[] {
    return this.received.filter((r) => r.type === type).map(({ reqId: _r, lre: _l, type: _t, ...rest }) => rest);
  }

  /** LumiRPEngine makes the call's next chunks and pushes them to the relay's open socket (lost while none is open). */
  make(call: string, chunks: readonly LoopbackChunk[]): void {
    const held = this.chunks.get(call) ?? [];
    for (const chunk of chunks) {
      held.push(chunk);
      if (!this.skip.delete(held.length)) this.send(call, held.length, chunk);
    }
    this.chunks.set(call, held);
  }

  private send(call: string, seq: number, chunk: LoopbackChunk): void {
    this.fake.push({ type: "lre.loopback.chunk", call, seq, chunk });
  }

  private again(call: string, from: number): void {
    const held = this.chunks.get(call) ?? [];
    for (let seq = from; seq <= held.length; seq++) this.send(call, seq, held[seq - 1] as LoopbackChunk);
  }

  private handle(r: Payload): Payload {
    this.received.push(structuredClone(r));
    const reply = (body: Payload): Payload => ({ lre: 1, type: "lre.result", reqId: r.reqId, request: r.type, body });
    if (r.secret !== "relay-secret") return { lre: 1, type: "lre.error", reqId: r.reqId, code: "forbidden", message: "not a registered relay" };
    switch (r.type) {
      case "lre.loopback.hello": {
        // Each open call goes on from the chunk after the one the relay holds, once the hello is answered.
        const open = Array.isArray(r.open) ? (r.open as { call: string; seq: number }[]) : [];
        queueMicrotask(() => queueMicrotask(() => open.forEach((o) => this.again(o.call, o.seq + 1))));
        return reply({ relay: "rl_1", api: 1, build: "test", mode: "user", model: "lre-narrator", heartbeatMs: 60_000, lost: open.filter((o) => !this.chunks.has(o.call)).map((o) => o.call) });
      }
      case "lre.loopback.begin":
        this.chunks.set(String(r.call), this.chunks.get(String(r.call)) ?? []);
        return reply({ turn: "turn-1" });
      case "lre.loopback.resend":
        queueMicrotask(() => queueMicrotask(() => this.again(String(r.call), Number(r.from))));
        return reply({ last: this.chunks.get(String(r.call))?.length ?? null });
      case "lre.loopback.ack":
        return reply({ done: true });
      case "lre.loopback.abort":
        return reply({ aborted: true });
      case "lre.loopback.ping":
        // A worker that restarted holds none of its calls.
        return reply({ ok: true, lost: (Array.isArray(r.calls) ? (r.calls as string[]) : []).filter((c) => !this.chunks.has(c)) });
      default:
        return reply({ ok: true });
    }
  }
}

function relayOn(fake: FakeLumiverse, now: () => number = Date.now): { link: LoopbackLink; relay: Relay; bridge: FakeBridge } {
  const bridge = new FakeBridge(fake);
  const token = fake.session();
  const link = new LoopbackLink({ base: fake.base, credentials: () => ({ username: USER.username, token }), http: fake.http, openSocket: fake.openSocket, secret: "relay-secret", name: USER.username, build: "test", runtime: { bun: "/usr/local/bin/bun", script: "/var/lib/lumirpengine/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: 7861, now, log: () => undefined, timeoutMs: 3_000, probeMs: RELAY_DEFAULTS.probeMs, silentMs: RELAY_DEFAULTS.silentMs, crashMs: RELAY_DEFAULTS.crashMs });
  const relay = new Relay(link, settings(7861), { ...env, now });
  link.attach(relay);
  return { link, relay, bridge };
}

function post(relay: Relay): Promise<Response> {
  return relay.fetch(new Request("http://127.0.0.1:7861/v1/chat/completions", { method: "POST", headers: { host: "127.0.0.1:7861", authorization: "Bearer lk_test_key", "content-type": "application/json" }, body: JSON.stringify(BODY) }));
}

async function reply(res: Response): Promise<{ text: string; finish: string | undefined }> {
  let text = "";
  let finish: string | undefined;
  for await (const c of coreStream(res)) {
    text += c.token;
    finish = c.finish_reason ?? finish;
  }
  return { text, finish };
}

describe("reconnect", () => {
  test("a socket dropped mid-call: the relay says hello again with the call and its last chunk, and the reply completes", async () => {
    const fake = new FakeLumiverse();
    const { link, relay, bridge } = relayOn(fake);
    await link.connect();
    expect(bridge.of("lre.loopback.hello")).toEqual([{ secret: "relay-secret", api: 1, report: expect.objectContaining({ listen: "127.0.0.1", port: 7861, calls: 0 }), open: [] }]);

    const res = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 1);
    const call = String(bridge.of("lre.loopback.begin")[0]?.call);
    bridge.make(call, [{ kind: "content", text: "One. " }, { kind: "content", text: "Two. " }]);
    await until(() => relay.open()[0]?.seq === 2);

    // Lumiverse restarts: the socket is gone, and what LumiRPEngine makes meanwhile goes nowhere.
    fake.restart();
    bridge.make(call, [{ kind: "content", text: "Three. " }, { kind: "finish", finish: "stop" }]);
    expect(link.up).toBe(false);
    await until(() => {
      link.tick();
      relay.tick();
      return bridge.of("lre.loopback.hello").length === 2;
    });
    expect(bridge.of("lre.loopback.hello")[1]?.open).toEqual([{ call, seq: 2 }]);

    expect(await reply(res)).toEqual({ text: "One. Two. Three. ", finish: "stop" });
    await until(() => bridge.of("lre.loopback.ack").length === 1);
    expect(bridge.of("lre.loopback.ack")).toEqual([{ secret: "relay-secret", call, seq: 4 }]);
    expect(relay.count).toBe(0);
    link.close();
  });

  test("a chunk lost on the way is asked for again, and the one that came twice counts once", async () => {
    const fake = new FakeLumiverse();
    const { link, relay, bridge } = relayOn(fake);
    await link.connect();
    const res = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 1);
    const call = String(bridge.of("lre.loopback.begin")[0]?.call);
    bridge.skip.add(2);
    bridge.make(call, [{ kind: "content", text: "One. " }, { kind: "content", text: "Two. " }, { kind: "content", text: "Three. " }, { kind: "finish", finish: "stop" }]);
    expect(await reply(res)).toEqual({ text: "One. Two. Three. ", finish: "stop" });
    expect(bridge.of("lre.loopback.resend")).toEqual([{ secret: "relay-secret", call, from: 2 }]);
    link.close();
  });

  test("LumiRPEngine restarted and lost the call: the reply ends with words core shows, not a hang", async () => {
    const fake = new FakeLumiverse();
    const { link, relay, bridge } = relayOn(fake);
    await link.connect();
    const res = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 1);
    const call = String(bridge.of("lre.loopback.begin")[0]?.call);
    bridge.make(call, [{ kind: "content", text: "One. " }]);
    fake.restart();
    bridge.chunks.clear();
    await until(() => {
      link.tick();
      return relay.count === 0;
    });
    await expect(reply(res)).rejects.toThrow("LumiRPEngine restarted during this reply");
    link.close();
  });

  test("LumiRPEngine's worker restarted under a live socket: the next probe finds the call lost, and the reply ends", async () => {
    const fake = new FakeLumiverse();
    const clock = { now: Date.now() };
    const { link, relay, bridge } = relayOn(fake, () => clock.now);
    await link.connect();
    const res = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 1 && relay.open().length === 1);
    const call = String(bridge.of("lre.loopback.begin")[0]?.call);
    bridge.make(call, [{ kind: "content", text: "One. " }]);
    // The worker restarts: its calls are gone, and the socket stays up.
    bridge.chunks.clear();
    expect(link.up).toBe(true);
    clock.now += RELAY_DEFAULTS.probeMs;
    link.tick();
    await until(() => relay.count === 0);
    expect(bridge.of("lre.loopback.ping").at(-1)?.calls).toEqual([call]);
    await expect(reply(res)).rejects.toThrow("LumiRPEngine restarted during this reply");
    link.close();
  });

  test("LumiRPEngine stops answering: progress lines stop being restated, and the reply ends with words", async () => {
    const fake = new FakeLumiverse();
    const clock = { now: Date.now() };
    const { link, relay, bridge } = relayOn(fake, () => clock.now);
    await link.connect();
    const res = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 1 && relay.open().length === 1);
    const call = String(bridge.of("lre.loopback.begin")[0]?.call);
    bridge.make(call, [{ kind: "progress", text: "The author is setting the scene" }]);
    await until(() => relay.open()[0]?.seq === 1);
    // The worker hangs: nothing it is asked is answered.
    fake.silent.add("lre.loopback.ping");
    const step = (ms: number): void => {
      clock.now += ms;
      link.tick();
      relay.tick();
    };
    step(RELAY_DEFAULTS.probeMs);
    // The probe goes out; the hung worker never sees it.
    await until(() => fake.frames.some((f) => (f.payload as Payload | undefined)?.type === "lre.loopback.ping"));
    expect(bridge.of("lre.loopback.ping")).toEqual([]);
    // Unanswered past `silentMs`: out of reach, so a quiet minute gets a comment and no progress line.
    step(RELAY_DEFAULTS.progressMs);
    expect(link.out?.why).toBe("silent");
    expect(relay.count).toBe(1);
    step(RELAY_DEFAULTS.lostMs);
    expect(relay.count).toBe(0);
    const text = await new Response(res.body).text();
    expect(text).not.toContain("(1 min)");
    expect(text).toContain("LumiRPEngine stopped answering the loopback during this reply");
    link.close();
  });
});

/** Lumiverse's word on LumiRPEngine's lifecycle, which every socket gets (D0a check 4). */
function lifecycle(fake: FakeLumiverse, event: "SPINDLE_EXTENSION_LOADED" | "SPINDLE_EXTENSION_UNLOADED" | "SPINDLE_EXTENSION_ERROR", extra: Payload = {}): void {
  const { id, identifier, name } = fake.extension;
  for (const s of fake.sockets.filter((x) => x.open)) s.events.message(JSON.stringify({ event, payload: { extensionId: id, identifier, name, ...extra }, timestamp: Date.now() }));
}

describe("LumiRPEngine stopped or crashed", () => {
  test("Lumiverse stops it mid-reply: the reply ends at once; once it runs again the relay greets it and carries the next reply", async () => {
    const fake = new FakeLumiverse();
    const { link, relay, bridge } = relayOn(fake);
    await link.connect();
    const res = await post(relay);
    await until(() => relay.open().length === 1);
    // Another extension's lifecycle changes nothing.
    for (const s of fake.sockets.filter((x) => x.open)) s.events.message(JSON.stringify({ event: "SPINDLE_EXTENSION_UNLOADED", payload: { extensionId: "ext-other", identifier: "other_ext", name: "Other" } }));
    expect(relay.count).toBe(1);
    lifecycle(fake, "SPINDLE_EXTENSION_UNLOADED");
    expect(relay.count).toBe(0);
    await expect(reply(res)).rejects.toThrow("LumiRPEngine was stopped on Lumiverse");
    expect(link.out?.why).toBe("stopped");
    // Nothing is sent to a worker that isn't there.
    link.tick();
    expect(bridge.of("lre.loopback.hello").length).toBe(1);
    lifecycle(fake, "SPINDLE_EXTENSION_LOADED");
    await until(() => {
      link.tick();
      return link.up;
    });
    expect(bridge.of("lre.loopback.hello").length).toBe(2);
    const next = await post(relay);
    await until(() => bridge.of("lre.loopback.begin").length === 2);
    bridge.make(String(bridge.of("lre.loopback.begin")[1]?.call), [{ kind: "content", text: "Again." }, { kind: "finish", finish: "stop" }]);
    expect(await reply(next)).toEqual({ text: "Again.", finish: "stop" });
    link.close();
  });

  test("an error report: a worker that still answers carries on; one that doesn't crashed, and the reply ends within crashMs", async () => {
    const fake = new FakeLumiverse();
    const clock = { now: Date.now() };
    const { link, relay, bridge } = relayOn(fake, () => clock.now);
    await link.connect();
    const res = await post(relay);
    await until(() => relay.open().length === 1);
    // A survivable error: asked at once, it answers, and the reply goes on.
    lifecycle(fake, "SPINDLE_EXTENSION_ERROR", { error: "Unhandled rejection in a background job" });
    link.tick();
    await until(() => bridge.of("lre.loopback.ping").length === 1);
    clock.now += RELAY_DEFAULTS.crashMs;
    link.tick();
    relay.tick();
    expect(relay.count).toBe(1);
    // A fatal one: the worker is gone, nothing answers, and within crashMs the reply ends.
    fake.silent.add("lre.loopback.ping");
    lifecycle(fake, "SPINDLE_EXTENSION_ERROR", { error: "Runtime exited (code=1, signal=null)" });
    link.tick();
    clock.now += RELAY_DEFAULTS.crashMs;
    link.tick();
    expect(relay.count).toBe(0);
    await expect(reply(res)).rejects.toThrow("LumiRPEngine stopped with an error (Runtime exited (code=1, signal=null))");
    expect(link.out?.why).toBe("crashed");
    // Lumiverse never restarts a crashed one: a new reply is refused at once, in the same words.
    const refused = await post(relay);
    await expect(reply(refused)).rejects.toThrow("Lumiverse doesn't restart it by itself");
    expect(bridge.of("lre.loopback.begin").length).toBe(1);
    link.close();
  });
});

describe("what it answers", () => {
  test("only requests addressed to it: its own address and port, any loopback name for a loopback address, any name on a wildcard address", async () => {
    const link: RelayLink = {
      up: true,
      out: null,
      refused: null,
      request: async () => {
        throw new Error("nothing reaches LumiRPEngine here");
      },
    };
    const status = async (listen: string, host: string): Promise<number> => (await new Relay(link, { ...settings(7861), listen }, env).fetch(new Request(`http://${host}/healthz`, { headers: { host } }))).status;
    expect(await status("127.0.0.1", "127.0.0.1:7861")).toBe(200);
    expect(await status("127.0.0.1", "localhost:7861")).toBe(200);
    expect(await status("127.0.0.1", "[::1]:7861")).toBe(200);
    expect(await status("127.0.0.1", "evil.example:7861")).toBe(421);
    expect(await status("127.0.0.1", "127.0.0.1:7862")).toBe(421);
    // Another address of its own (--listen): the Host must name it too, so a name rebound to it is refused.
    expect(await status("192.168.1.20", "192.168.1.20:7861")).toBe(200);
    expect(await status("192.168.1.20", "evil.example:7861")).toBe(421);
    expect(await status("192.168.1.20", "192.168.1.20")).toBe(421);
    expect(await status("fd00::20", "[fd00::20]:7861")).toBe(200);
    expect(await status("relay.lan", "RELAY.lan:7861")).toBe(200);
    // A wildcard address names none of the machine's: any Host is answered, and the key and the Origin refusal stand in the way.
    expect(await status("0.0.0.0", "evil.example:7861")).toBe(200);
    expect(await status("::", "evil.example:7861")).toBe(200);
  });

  test("a body sent without Content-Length is counted as it arrives and refused at the cap, not read whole", async () => {
    const link: RelayLink = {
      up: true,
      out: null,
      refused: null,
      request: async () => {
        throw new Error("nothing reaches LumiRPEngine here");
      },
    };
    const relay = new Relay(link, { ...settings(7861), maxBodyBytes: 1024 }, env);
    let pulled = 0;
    const { promise: cancelled, resolve: cancel } = Promise.withResolvers<void>();
    // Endless: a relay that read it whole would never answer.
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new Uint8Array(256).fill(0x20));
      },
      cancel: () => cancel(),
    });
    const req = new Request("http://127.0.0.1:7861/v1/chat/completions", { method: "POST", headers: { host: "127.0.0.1:7861", authorization: "Bearer lk_test_key", "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await relay.fetch(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "too_large" } });
    expect(pulled).toBeLessThan(10);
    await cancelled;
  });
});

describe("after an update of LumiRPEngine", () => {
  test("a relay one build behind that said hello to this LumiRPEngine still carries depth; one not heard from since asks for its update", () => {
    // Cast, not typed: the view gains fields the gate never reads.
    const relay = (over: Partial<LoopbackRelayView>) => ({ relay: "rl-1", name: "lumi", mode: "user", build: "old", host: "box", listen: "127.0.0.1", port: 7861, registeredAt: 0, seenAt: null, report: null, signIn: false, update: true, lines: { update: null, login: null }, ...over }) as LoopbackRelayView;
    const page = (r: LoopbackRelayView): Parameters<typeof loopbackUnready>[0] => ({ relays: [r], shared: { operator: false, enabled: false }, key: { set: true, print: null, at: null }, connections: [{ id: "c1", name: "Loopback" }] });
    expect(loopbackUnready(page(relay({ seenAt: 1 })))).toBeNull();
    expect(loopbackUnready(page(relay({ seenAt: null })))).toBe("No relay of yours is running this build: update lumi with its line in Settings → Loopback.");
    expect(loopbackUnready(page(relay({ seenAt: 1, signIn: true })))).toContain("sign it in again");
  });
});
