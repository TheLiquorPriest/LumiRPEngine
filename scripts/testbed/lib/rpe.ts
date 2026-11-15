// RPE's own account of its turns, as its Turn page reads it (`src/turn/routes.ts`, shapes in
// `src/ui/api.ts`): a chat's turns, one turn with its timings, usage and trace, and the chat's live
// events (`/api/v1/live`), of which only the model calls' streaming text is kept here, because the
// trace keeps no record of when a call's text began. Address and token come from the environment.

import type { TraceDelta } from "rp-harness/contract";
import type { LiveBatch, TurnReply, TurnRow, TurnsReply } from "../../../src/shared/api";

export class RpeApi {
  constructor(
    readonly base: string,
    readonly token: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const reply = await fetch(`${this.base}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` } });
    const text = await reply.text();
    if (!reply.ok) throw new Error(`RPE GET ${path}: ${reply.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  turns(chat: string, limit: number): Promise<TurnsReply> {
    return this.get<TurnsReply>(`/api/v1/chats/${encodeURIComponent(chat)}/turns?limit=${limit}`);
  }

  turn(chat: string, turn: string): Promise<TurnReply> {
    return this.get<TurnReply>(`/api/v1/chats/${encodeURIComponent(chat)}/turns/${encodeURIComponent(turn)}`);
  }

  /** The turn tied to Lumiverse's message `message`, once RPE has tied it (it does so when Lumiverse saves the reply); null if none is within `waitMs`. */
  async tiedTo(chat: string, message: string, waitMs: number): Promise<TurnRow | null> {
    const until = Date.now() + waitMs;
    for (;;) {
      const found = (await this.turns(chat, 20)).turns.find((t) => t.message === message);
      if (found !== undefined || Date.now() >= until) return found ?? null;
      await Bun.sleep(1000);
    }
  }

  /** The turn once its run has ended: the run can go on after the reply (plan §10.9). */
  async ended(chat: string, turn: string, waitMs: number): Promise<TurnReply> {
    const until = Date.now() + waitMs;
    for (;;) {
      const detail = await this.turn(chat, turn);
      if (detail.status !== "running" || Date.now() >= until) return detail;
      await Bun.sleep(2000);
    }
  }
}

/** One chat's live events, followed for the whole run: the model calls' streaming text, with when RPE got each piece. */
export class RpeLive {
  readonly deltas: TraceDelta[] = [];
  /** Live numbers the hub dropped because this reader fell behind: deltas between them are lost. */
  readonly missed: { from: number; to: number }[] = [];
  /** Set once the socket closed: nothing streamed after it was heard. */
  closed = false;

  private constructor(private readonly socket: WebSocket) {}

  static async follow(api: RpeApi, chat: string): Promise<RpeLive> {
    const url = new URL(api.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/v1/live";
    const socket = new WebSocket(url.toString(), ["rpe.live", `rpe.token.${api.token}`]);
    const out = new RpeLive(socket);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => reject(new Error("RPE's live socket did not start following within 30 s")), 30_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ op: "follow", chat })));
    socket.addEventListener("message", (message) => {
      const frame = JSON.parse(String(message.data)) as { type: string; message?: string } & Partial<LiveBatch>;
      if (frame.type === "following") {
        clearTimeout(timer);
        resolve();
      } else if (frame.type === "refused") {
        clearTimeout(timer);
        reject(new Error(`RPE's live socket refused: ${frame.message ?? ""}`));
      } else if (frame.type === "events") {
        if (frame.missed !== undefined) out.missed.push(frame.missed);
        for (const event of frame.events ?? []) if (event.kind === "delta") out.deltas.push(event.data as unknown as TraceDelta);
      }
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      out.closed = true;
      reject(new Error(`RPE's live socket closed (${event.code} ${event.reason})`));
    });
    await promise;
    return out;
  }

  close(): void {
    this.socket.close();
  }
}
