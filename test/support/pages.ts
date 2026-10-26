// Lumiverse pages over the fake host, each the engine's real protocol client, carried as Lumiverse
// carries them. A page's request reaches the dispatcher only while its socket is open and Lumiverse
// has authenticated it; otherwise Lumiverse drops it without a word (frontend/src/ws/client.ts
// `send`, src/ws/handler.ts `SPINDLE_BACKEND_MSG`). A push reaches the pages it names (one session,
// or every page of the user) that are connected; one sent to a page that isn't is lost, and
// Lumiverse tells the engine that page closed (src/spindle/worker-host.ts, a failed targeted send).

import { ProtocolClient } from "../../src/frontend/protocol-client";
import type { Timers } from "../../src/frontend/protocol-client";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import type { Rig } from "./rig";

/** One turn of the event loop (as the engine's `giveWay`). */
export function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

export interface Page {
  readonly session: string;
  readonly client: ProtocolClient;
  /** Every request the page sent, carried or dropped. */
  readonly sent: FrontendToBackend[];
  /** Every message that reached it. */
  readonly received: BackendToFrontend[];
  /** Whether Lumiverse carries its messages both ways: the socket is open and authenticated. */
  connected: boolean;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** The socket drops: Lumiverse tells the engine the page closed. */
  drop(): void;
}

/** Timers that never fire unless a test fires them (`fire`), so no request times out by itself. */
export class HeldTimers implements Timers {
  private readonly timers: { fn: () => void; live: boolean }[] = [];
  set(fn: () => void): unknown {
    const timer = { fn, live: true };
    this.timers.push(timer);
    return timer;
  }
  clear(handle: unknown): void {
    for (const timer of this.timers) if (timer === handle) timer.live = false;
  }
  /** Fires every timer still set. */
  fire(): void {
    for (const timer of this.timers.splice(0)) if (timer.live) timer.fn();
  }
}

export class Pages {
  readonly timers = new HeldTimers();
  private readonly pages = new Map<string, Page>();
  private readonly inflight = new Set<Promise<void>>();

  /** `rig` is the backend now running; a test that restarts it sets the new one. */
  constructor(public rig: Rig) {
    const host = rig.host;
    const send = host.frontend.send;
    host.frontend.send = (message, userId, session) => {
      send(message, userId, session);
      for (const page of this.pages.values()) {
        if (session !== undefined && session !== page.session) continue;
        if (page.connected) {
          const copy = structuredClone(message);
          // The network: the page reads it after what the backend is doing now.
          queueMicrotask(() => {
            if (!page.connected) return;
            page.received.push(copy);
            this.handlers.get(page.session)?.(copy);
          });
        } else if (session !== undefined) host.closeSession(page.session);
      }
    };
  }

  private readonly handlers = new Map<string, (payload: unknown) => void>();

  /** A page with session id `session`, connected and on screen, that has said nothing yet. */
  open(session: string): Page {
    const sent: FrontendToBackend[] = [];
    let n = 0;
    const page: Page = {
      session,
      sent,
      received: [],
      connected: true,
      visible: true,
      drop: () => {
        if (!page.connected) return;
        page.connected = false;
        this.rig.host.closeSession(session);
      },
      client: new ProtocolClient(
        {
          send: (payload) => {
            sent.push(structuredClone(payload));
            if (!page.connected) return;
            const handled = this.rig.dispatch.handle(structuredClone(payload), this.rig.host.userId, session).finally(() => this.inflight.delete(handled));
            this.inflight.add(handled);
          },
          subscribe: (handler) => {
            this.handlers.set(session, handler);
            return () => this.handlers.delete(session);
          },
        },
        { timers: this.timers, newReqId: () => `${session}-${(n += 1)}` },
      ),
    };
    page.client.visible = () => page.visible;
    this.pages.set(session, page);
    return page;
  }

  /** Waits until the pages' requests are answered, the host's events delivered and the pushes read. */
  async settle(): Promise<void> {
    for (let round = 0; round < 1000; round++) {
      await this.rig.host.settle();
      await tick();
      if (this.inflight.size === 0) {
        await this.rig.host.settle();
        await tick();
        if (this.inflight.size === 0) return;
      }
      await Promise.all([...this.inflight]);
    }
    throw new Error("the pages never settled");
  }
}
