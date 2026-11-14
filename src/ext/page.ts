// The page's end of the pipe (STANDALONE-PLAN §4.3, "Relay"): what the shared UI uses to reach RPE
// through the extension when the browser cannot reach RPE directly. One request, one whole answer;
// the follows of chats, renewed while followed, since RPE drops a follow nobody renews; and the live
// updates RPE sends for this page, put back together from their parts, in order. A list missing from
// the count (a frame lost on the way) is passed on as a reset: the page reads afresh. What the hub
// itself dropped for a page that fell behind, each batch says (`missed`).

import type { Clock } from "rp-harness/contract";
import { readToPage, type MissingPermission, type PipeResponse, type StartFacts, type ToPage } from "../adapter/lumiverse/pipe-wire";

/** The frontend's channel to the extension's backend (`ctx.sendToBackend`, `ctx.onBackendMessage`). */
export interface PageChannel {
  sendToBackend(payload: unknown): void;
  onBackendMessage(handler: (payload: unknown) => void): () => void;
}

export interface PageRoadSettings {
  /** How long a request waits for its answer: a little past Spindle's proxy's own 30 s. */
  requestMs: number;
  /** How often a followed chat's follow is asked again: well inside RPE's lease. */
  renewMs: number;
}

/** Fixed defaults: past the proxy's 30 s (`worker-host.ts:771`); a third of RPE's 60 s lease (`relay.ts`). */
export const PAGE_ROAD_DEFAULTS: PageRoadSettings = { requestMs: 35_000, renewMs: 20_000 };

export interface StartAnswer {
  facts: StartFacts | null;
  /** Why there are no facts, in words the page shows. */
  error?: string;
  missing: MissingPermission[];
}

export interface PageRequest {
  method: string;
  /** Under RPE's API: `/api/v1/…`. */
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PageRoad {
  start(): Promise<StartAnswer>;
  request(request: PageRequest): Promise<Omit<PipeResponse, "id">>;
  /** Follows a chat's live updates until `unfollow`; rejects with RPE's words when it refuses. */
  follow(chat: string): Promise<void>;
  unfollow(chat: string): Promise<void>;
  /** Every list of updates RPE sends this page, in order; `reset`: some were lost before it, so the page reads afresh. */
  onUpdates(handler: (updates: unknown[], reset: boolean) => void): () => void;
  onPermissions(handler: (missing: MissingPermission[]) => void): () => void;
  stop(): void;
}

type Timers = Pick<Clock, "setTimeout" | "clearTimeout">;
const realTimers: Timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export function pageRoad(channel: PageChannel, options: { timers?: Timers; settings?: Partial<PageRoadSettings> } = {}): PageRoad {
  const timers = options.timers ?? realTimers;
  const settings = { ...PAGE_ROAD_DEFAULTS, ...options.settings };
  let next = 0;
  const waiting = new Map<string, { resolve(answer: Omit<PipeResponse, "id">): void; reject(error: Error): void; timer: unknown }>();
  const starting: ((answer: StartAnswer) => void)[] = [];
  const followed = new Map<string, unknown>();
  const following = new Map<string, { resolve(): void; reject(error: Error): void }[]>();
  const updates = new Set<(updates: unknown[], reset: boolean) => void>();
  const permissions = new Set<(missing: MissingPermission[]) => void>();
  let lastSeq: number | null = null;
  let parts: { seq: number; pieces: string[]; reset: boolean } | null = null;

  const deliver = (list: unknown[], reset: boolean): void => {
    for (const handler of updates) handler(list, reset);
  };

  function live(frame: Extract<ToPage, { rpe: "live" }>): void {
    let reset = false;
    if (parts !== null && parts.seq !== frame.seq) {
      // The rest of a list never came.
      parts = null;
      reset = true;
    }
    if (parts === null) {
      if (lastSeq !== null && frame.seq !== lastSeq + 1) reset = true;
      lastSeq = frame.seq;
    }
    let data = frame.data;
    if (frame.part !== undefined) {
      if (parts === null) {
        if (frame.part.index !== 0) {
          deliver([], true);
          return;
        }
        parts = { seq: frame.seq, pieces: [], reset };
      }
      parts.pieces.push(frame.data);
      if (parts.pieces.length < frame.part.count) return;
      data = parts.pieces.join("");
      reset = parts.reset;
      parts = null;
    }
    let list: unknown;
    try {
      list = JSON.parse(data);
    } catch {
      deliver([], true);
      return;
    }
    deliver(Array.isArray(list) ? list : [], reset);
  }

  const off = channel.onBackendMessage((payload) => {
    const message = readToPage(payload);
    if (message === null) return;
    switch (message.rpe) {
      case "start":
        for (const settle of starting.splice(0)) settle({ facts: message.facts, ...(message.error !== undefined ? { error: message.error } : {}), missing: message.missing });
        for (const handler of permissions) handler(message.missing);
        return;
      case "response": {
        const w = waiting.get(message.id);
        if (w === undefined) return;
        waiting.delete(message.id);
        timers.clearTimeout(w.timer);
        w.resolve({ status: message.status, headers: message.headers, body: message.body });
        return;
      }
      case "following": {
        const w = following.get(message.chat)?.shift();
        if (w === undefined) return;
        if (message.error === undefined) w.resolve();
        else w.reject(new Error(message.error));
        return;
      }
      case "live":
        live(message);
        return;
      case "permissions":
        for (const handler of permissions) handler(message.missing);
        return;
    }
  });

  const ask = (chat: string, on: boolean): Promise<void> => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    following.set(chat, [...(following.get(chat) ?? []), { resolve, reject }]);
    channel.sendToBackend({ rpe: on ? "follow" : "unfollow", chat });
    return promise;
  };

  return {
    start() {
      const { promise, resolve } = Promise.withResolvers<StartAnswer>();
      starting.push(resolve);
      channel.sendToBackend({ rpe: "start" });
      return promise;
    },
    request(request) {
      const id = `r${++next}`;
      const { promise, resolve, reject } = Promise.withResolvers<Omit<PipeResponse, "id">>();
      const timer = timers.setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`RPE gave no answer through Lumiverse within ${Math.round(settings.requestMs / 1000)} s.`));
      }, settings.requestMs);
      waiting.set(id, { resolve, reject, timer });
      channel.sendToBackend({ rpe: "request", id, method: request.method, path: request.path, headers: request.headers ?? {}, ...(request.body !== undefined ? { body: request.body } : {}) });
      return promise;
    },
    async follow(chat) {
      if (!followed.has(chat)) {
        const renew = (): void => {
          followed.set(chat, timers.setTimeout(renew, settings.renewMs));
          ask(chat, true).catch(() => {
            // A renewal RPE refused is asked again at the next; the page heard why at the first.
          });
        };
        followed.set(chat, timers.setTimeout(renew, settings.renewMs));
      }
      await ask(chat, true);
    },
    async unfollow(chat) {
      const timer = followed.get(chat);
      if (timer !== undefined) timers.clearTimeout(timer);
      followed.delete(chat);
      await ask(chat, false);
    },
    onUpdates(handler) {
      updates.add(handler);
      return () => updates.delete(handler);
    },
    onPermissions(handler) {
      permissions.add(handler);
      return () => permissions.delete(handler);
    },
    stop() {
      off();
      for (const timer of followed.values()) timers.clearTimeout(timer);
      followed.clear();
      for (const w of waiting.values()) {
        timers.clearTimeout(w.timer);
        w.reject(new Error("The page closed."));
      }
      waiting.clear();
    },
  };
}
