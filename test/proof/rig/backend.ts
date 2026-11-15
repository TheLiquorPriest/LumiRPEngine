// A Lumiverse made up for the rig page's tests (PlanScenarios-2 items 7 and 8): it stands for the stand-in's server as far as the
// chat page calls it, which the stand-in does not yet serve whole (`standInGaps`): the sign-in, the lists of connections,
// personas and presets, a chat's messages, the player's line appended, a generation started, a reply streamed as
// `STREAM_TOKEN_RECEIVED` frames at delays a test sets, and its end. It has the shape the door takes (`Behind`: `base`, `fetch`,
// `open`), so the page, the door and the steps are the real ones and only the Lumiverse behind them is invented. The frames are
// Lumiverse's own (`ws/bus.ts:512-518`: `{event, payload, timestamp}`; `services/generate.service.ts:3320-3365` for the tokens).
// Nothing here is Lumiverse: every name is invented. The tests that rest on it say so; the stand-in's own tests are the ones
// that skip until the stand-in serves what they need.

import type { Socket, SocketEvents } from "../../../src/adapter/lumiverse/socket";
import type { Behind } from "../../../scripts/proof/rig/door";

export interface Reply {
  /** Ms from the generation's start to the first reasoning token, or null for a reply with none. */
  firstThinking: number | null;
  /** Ms from the start to the first word. */
  firstWord: number;
  /** Ms between one word and the next. */
  between: number;
  /** Ms from the last word to the generation's end. */
  end: number;
  words: string[];
}

export const REPLY: Reply = { firstThinking: 60, firstWord: 150, between: 40, end: 30, words: ["The", "lamp", "turns", "above", "you."] };

export interface Made extends Behind {
  /** What each Send carried to the generation route. */
  started: { chat_id: string; connection_id?: string; persona_id?: string; preset_id?: string }[];
  /** The lines the player's page appended. */
  appended: { name: string; content: string }[];
  /** The focus every socket said (`stream_focus`), in order. */
  focused: (string | null)[];
  reply: Reply;
  stopped: number;
  /** Sockets that stay silent after they are let in: no `stream_focus` is answered with a stream (a page that never says it shows the chat hears none). */
  stop(): void;
}

export const MADE_USER = "user-marlow";
export const MADE_CHAT = "chat-gannet";
const CONNECTIONS = [
  { id: "conn-plain", name: "Plain lamp", provider: "deepseek", model: "model-a" },
  { id: "conn-rpe", name: "RPE lamp", provider: "openai-compatible", model: "model-a" },
];
const PERSONAS = [{ id: "pers-traveller", name: "The traveller" }];
const PRESETS = [
  { id: "pre-other", name: "Other preset" },
  { id: "pre-lamp", name: "Lamp" },
];

export function madeLumiverse(reply: Reply = REPLY): Made {
  const sessions = new Set<string>();
  const tickets = new Set<string>();
  const sockets = new Set<{ events: SocketEvents; focus: string | null }>();
  const messages: { id: string; is_user: boolean; content: string; name: string }[] = [{ id: "m-greeting", is_user: false, content: "The lamp turns above you; the sea is loud tonight.", name: "Wren Hale" }];
  const timers = new Set<Timer>();
  let counter = 0;
  const made: Made = {
    base: "http://lumiverse.test:7860",
    started: [],
    appended: [],
    focused: [],
    reply,
    stopped: 0,
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    async fetch(url, init) {
      const path = new URL(url).pathname;
      const method = (init.method ?? "GET").toUpperCase();
      const headers = new Headers(init.headers);
      const body = init.body === undefined || init.body === null ? null : (JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer)) as Record<string, unknown>);
      const json = (value: unknown, status = 200): Response => Response.json(value, { status });
      if (path === "/api/auth/sign-in/username" && method === "POST") {
        if (body?.username !== "marlow" || body?.password !== "brass and lamp oil") return json({ message: "Invalid username or password" }, 401);
        const token = `tok${++counter}`;
        sessions.add(token);
        return json({ token, user: { id: MADE_USER, username: "marlow" } });
      }
      const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "")?.[1];
      if (bearer === undefined || !sessions.has(bearer)) return json({ error: "Unauthorized" }, 401);
      if (path === "/api/v1/ws-ticket") {
        const ticket = `ticket${++counter}`;
        tickets.add(ticket);
        return json({ ticket });
      }
      if (path === "/api/v1/connections") return json({ data: CONNECTIONS });
      if (path === "/api/v1/personas") return json({ data: PERSONAS });
      if (path === "/api/v1/presets") return json({ data: PRESETS });
      const one = /^\/api\/v1\/(connections|personas|presets)\/([^/]+)$/.exec(path);
      if (one !== null) {
        const found = ({ connections: CONNECTIONS, personas: PERSONAS, presets: PRESETS } as Record<string, { id: string; name: string }[]>)[one[1] ?? ""]?.find((r) => r.id === one[2]);
        return found === undefined ? json({ error: "Not found" }, 404) : json(found);
      }
      const chat = /^\/api\/v1\/chats\/([^/]+)\/messages$/.exec(path)?.[1];
      if (chat !== undefined && chat !== MADE_CHAT) return json({ error: "Not found" }, 404);
      if (chat !== undefined && method === "GET") return json({ data: messages, total: messages.length });
      if (chat !== undefined && method === "POST") {
        const line = { id: `m-${++counter}`, is_user: true, content: String(body?.content ?? ""), name: String(body?.name ?? "User") };
        made.appended.push({ name: line.name, content: line.content });
        messages.push(line);
        frame("MESSAGE_SENT", { chatId: MADE_CHAT, message: line });
        return json(line, 201);
      }
      if (path === "/api/v1/generate" && method === "POST") {
        if (typeof body?.chat_id !== "string") return json({ error: "chat_id is required" }, 400);
        made.started.push(body as Made["started"][number]);
        const generationId = `gen-${++counter}`;
        play(generationId);
        return json({ generationId, status: "streaming" });
      }
      if (path === "/api/v1/generate/stop" && method === "POST") {
        made.stopped++;
        made.stop();
        const id = typeof body?.generation_id === "string" ? body.generation_id : "";
        frame("GENERATION_STOPPED", { generationId: id, chatId: MADE_CHAT, content: current });
        return json({ stopped: true });
      }
      return json({ error: `no route ${method} ${path}` }, 404);
    },
    open(url, events): Socket {
      const ticket = new URL(url).searchParams.get("ticket") ?? "";
      const mine = { events, focus: null as string | null };
      setTimeout(() => {
        if (!tickets.delete(ticket)) {
          events.message(JSON.stringify({ event: "AUTH_ERROR", payload: {}, timestamp: Date.now() }));
          events.close(1008, "Invalid or expired ticket");
          return;
        }
        sockets.add(mine);
        events.message(JSON.stringify({ event: "CONNECTED", payload: { message: "Connected" }, timestamp: Date.now() }));
      }, 0);
      return {
        send(text) {
          const sent = JSON.parse(text) as { type?: string; chatId?: string | null };
          if (sent.type === "stream_focus") {
            mine.focus = sent.chatId ?? null;
            made.focused.push(mine.focus);
          }
        },
        close(code = 1000, reason = "") {
          sockets.delete(mine);
          setTimeout(() => events.close(code, reason), 0);
        },
      };
    },
  };
  /** What the current reply has streamed so far. */
  let current = "";

  /** One frame, to every socket: a stream token only to a socket that said it shows the chat. */
  function frame(event: string, payload: Record<string, unknown>): void {
    const text = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const s of sockets) if (event !== "STREAM_TOKEN_RECEIVED" || s.focus === payload.chatId) s.events.message(text);
  }

  function later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  function play(generationId: string): void {
    const r = made.reply;
    current = "";
    frame("GENERATION_STARTED", { generationId, chatId: MADE_CHAT });
    let offset = 0;
    if (r.firstThinking !== null) later(r.firstThinking, () => frame("STREAM_TOKEN_RECEIVED", { generationId, chatId: MADE_CHAT, token: "Hm.", type: "reasoning", offset: 0 }));
    r.words.forEach((word, i) => {
      later(r.firstWord + i * r.between, () => {
        const token = `${i === 0 ? "" : " "}${word}`;
        current += token;
        frame("STREAM_TOKEN_RECEIVED", { generationId, chatId: MADE_CHAT, token, offset });
        offset += token.length;
      });
    });
    later(r.firstWord + (r.words.length - 1) * r.between + r.end, () => {
      const id = `m-${++counter}`;
      messages.push({ id, is_user: false, content: current, name: "Wren Hale" });
      frame("GENERATION_ENDED", { generationId, chatId: MADE_CHAT, messageId: id, content: current });
    });
  }
  return made;
}
