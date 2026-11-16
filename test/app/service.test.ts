// The Runtime page's routes (plan §4.4 the `service` group, §14): how RPE runs and since when, a restart asked from a page (which, run by
// hand, says it cannot), RPE's own newest log lines by chat, turn or job with no secret in any, and how long the parts of the latest turns
// took. Every name, time and text is invented.

import { expect, test } from "bun:test";
import { serviceRoutes } from "../../src/app/service-routes";
import type { TurnTimes } from "../../src/app/service-timings";
import { bearer, makeBed, makeKey } from "./helpers";

const turn = (id: string, chat: string, at: number, to: number): TurnTimes => ({
  chat,
  turn: id,
  received: at,
  started: at + 40,
  firstWord: at + 40 + to,
  released: at + 40 + 2 * to,
  ended: at + 40 + 3 * to,
  intent: { from: at + 50, to: at + 60 },
  thinking: [{ from: at + 41, to: at + 45 }],
  intake: [{ step: "compare", from: at, to: at + 30 }],
  wait: null,
});

test("a page reads how RPE runs, its log lines of one turn with no secret in any, and the parts' times across the latest turns; a restart run by hand says it cannot", async () => {
  const bed = await makeBed();
  try {
    const asked: [string | null, number][] = [];
    const turns = [turn("t3", "c1", 3000, 100), turn("t2", "c1", 2000, 300), turn("t1", "c2", 1000, 200)];
    const app = await bed.open({
      areas: [
        {
          name: "service",
          mount: (a) =>
            a.routes.add(
              "service",
              serviceRoutes(a, async (_user, chat, limit) => {
                asked.push([chat, limit]);
                return turns.filter((t) => chat === null || t.chat === chat).slice(0, limit);
              }),
            ),
        },
      ],
    });
    const server = await app.start();
    const page = bearer(await makeKey(app, "web"));
    const get = async <T>(path: string): Promise<T> => (await (await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: page })).json()) as T;

    const how = await get<{ runs: string; unit: string | null; since: number; listens: string[]; build: string; restart: string }>("/api/v1/service");
    expect(how).toMatchObject({ runs: "by hand", unit: null, build: app.version, restart: "none" });
    expect(how.listens).toContain(server.url);
    expect(how.since).toBeLessThanOrEqual(Date.now());

    // Run from no file, RPE cannot restart itself: it says it was started by hand, and nothing is waiting.
    const restart = await fetch(`http://127.0.0.1:${server.port}/api/v1/service/restart`, { method: "POST", headers: page });
    expect(await restart.json()).toMatchObject({ restart: "by hand" });

    app.log.info("a turn began", { area: "turn", chat: "c1", turn: "t3", key: "rpe_inventedkeyvalue123", note: "sent with Bearer abcdefgh12345678" });
    app.log.warn("a job slipped", { area: "job", job: "j9" });
    const log = await get<{ lines: { message: string; level: string; area: string | null; turn: string | null; fields: Record<string, unknown> }[] }>("/api/v1/service/log?turn=t3");
    expect(log.lines.map((l) => [l.message, l.level, l.area, l.turn])).toEqual([["a turn began", "info", "turn", "t3"]]);
    expect(JSON.stringify(log)).not.toContain("inventedkeyvalue");
    expect(JSON.stringify(log)).not.toContain("abcdefgh12345678");
    expect((await get<{ lines: unknown[] }>("/api/v1/service/log?job=j9")).lines).toHaveLength(1);
    expect((await get<{ lines: unknown[] }>("/api/v1/service/log?level=warn")).lines).toHaveLength(1);

    const timings = await get<{ turns: number; parts: { part: string; turns: number; median: number; slowest: number; latest: number }[] }>("/api/v1/service/timings?limit=3");
    expect(timings.turns).toBe(3);
    expect(timings.parts.find((p) => p.part === "to the first word")).toEqual({ part: "to the first word", turns: 3, median: 200, slowest: 300, latest: 100 });
    expect(timings.parts.find((p) => p.part === "intake: compare")).toMatchObject({ turns: 3, median: 30 });
    expect((await get<{ turns: number }>("/api/v1/service/timings?chat=c1")).turns).toBe(2);
    expect(asked).toEqual([
      [null, 3],
      ["c1", 100],
    ]);
  } finally {
    await bed.remove();
  }
});
