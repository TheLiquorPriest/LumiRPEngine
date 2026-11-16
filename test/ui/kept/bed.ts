// What the tests of the kept Build page share: a client whose one road is RPE's own Build route, run in
// this process over a fresh database (test/build-mode/bed.ts), and timers the test moves by hand.

import { buildRoutes, BuildService } from "../../../src/build";
import type { KeptTransport } from "../../../src/ui/kept/client";
import { type RpeClient, RpeError } from "../../../src/ui/client";
import type { Timers } from "../../../src/ui/roads";
import { GUIDANCE, makeBed, USER, words } from "../../build-mode/bed";
import { callRoute } from "../../app/call";

export { USER, words };

export interface RouteClient {
  client: Pick<RpeClient, "call">;
  /** Each call made, by its route key, with the body it sent. */
  asked: { key: string; body: unknown }[];
  /** The route's own method and path, as the pages' route map keys it. */
  route: string;
}

/** A client whose one road is RPE's own Build route; every body goes and comes back as JSON, as over a road. */
export function routeClient(): RouteClient {
  const bed = makeBed();
  const [post] = buildRoutes(new BuildService({ db: bed.db, writes: bed.writes, store: bed.store, log: bed.log, guidance: GUIDANCE }));
  const route = `${post.method} ${post.path}`;
  const asked: RouteClient["asked"] = [];
  const call = async (key: string, _params: unknown, options?: { body?: unknown }): Promise<unknown> => {
    asked.push({ key, body: options?.body });
    if (key !== route) throw new RpeError(404, `No route ${key}.`);
    const reply = await callRoute(post, { body: options?.body, user: USER });
    return JSON.parse(JSON.stringify(reply));
  };
  return { client: { call: call as RpeClient["call"] }, asked, route };
}

/** A transport that counts who subscribed and has not let go, so a test can see none is left (closing it lets nobody go). */
export function counted(transport: KeptTransport): { transport: KeptTransport; hearers(): number } {
  let hearers = 0;
  return {
    transport: {
      send: (message) => transport.send(message),
      subscribe(hearer) {
        hearers += 1;
        const off = transport.subscribe(hearer);
        let on = true;
        return () => {
          if (!on) return;
          on = false;
          hearers -= 1;
          off();
        };
      },
      takeRefusal: (reqId) => transport.takeRefusal(reqId),
      push: (payload) => transport.push(payload),
      live: (event) => transport.live(event),
      close: () => transport.close(),
    },
    hearers: () => hearers,
  };
}

export interface HandTimers extends Timers {
  /** Runs what falls due within `ms` from now, in order, moving the clock on. */
  advance(ms: number): void;
  /** How many are waiting to run. */
  waiting(): number;
}

export function handTimers(): HandTimers {
  let now = 0;
  let made = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      made += 1;
      due.set(made, { at: now + ms, run });
      return made;
    },
    clearTimeout(handle) {
      due.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (next === undefined) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].run();
      }
      now = until;
    },
    waiting: () => due.size,
  };
}
