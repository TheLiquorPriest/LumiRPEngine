// How RPE runs, its log and its timings on Runtime: a service offers Restart and a hand-started RPE does not; the
// log's address holds its filter; the timings say each part with its middle, slowest and latest time.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { askingClient, settle } from "../asking";
import type { ServiceHow, ServiceLog, ServiceTimings } from "../../../src/shared/api";
import { logAt, logFilterOf } from "../../../src/ui/pages/runtime";
import { LogView, moreLines } from "../../../src/ui/pages/runtime/logs";
import { canRestart, NO_RESTART, ServiceView, watchRestart } from "../../../src/ui/pages/runtime/service";
import { TimingsView } from "../../../src/ui/pages/runtime/timings";
import { banners, elements, expand, press, textOf } from "../vnodes";

const MIB = 1024 * 1024;
const HOW: ServiceHow = {
  runs: "service",
  unit: "rpe-ann.service",
  since: 1_800_000_000_000,
  listens: ["http://127.0.0.1:7777"],
  build: "a1b2c3d4",
  fellBack: null,
  restart: "none",
  memory: {
    holds: 300 * MIB,
    heap: { used: 60 * MIB, total: 90 * MIB },
    outside: 20 * MIB,
    buffers: 2 * MIB,
    allocator: 150 * MIB,
    peak: 420 * MIB,
    threads: 2,
    kept: [{ name: "Session files kept read", count: 3, chars: 1200 }],
    service: { holds: 512 * MIB, peak: 700 * MIB, limit: 2048 * MIB },
  },
};

describe("how RPE runs", () => {
  test("a service shows its unit and offers Restart; one started by hand, or one already restarting, does not", () => {
    let pressed = 0;
    const tree = expand(h(ServiceView, { how: HOW, problem: null, restart: NO_RESTART, onRestart: () => pressed++ }));
    expect(textOf(tree)).toContain("rpe-ann.service");
    press(tree, "Restart");
    expect(pressed).toBe(1);
    expect(canRestart({ ...HOW, runs: "by hand", unit: null, restart: "by hand" })).toBe(false);
    expect(canRestart({ ...HOW, restart: "waiting" })).toBe(false);
    const waiting = expand(h(ServiceView, { how: { ...HOW, restart: "waiting" }, problem: null, restart: { busy: false, answer: null, problem: null }, onRestart: () => undefined }));
    expect(textOf(waiting)).toContain("waiting for the turns and jobs running to end");
  });

  test("a fall back to the known-good copy and the restart's own answer are said in their words", () => {
    const tree = expand(h(ServiceView, { how: { ...HOW, fellBack: "The new build did not start twice." }, problem: null, restart: { busy: false, problem: null, answer: { running: "a1b2c3d4", disk: null, broken: null, extension: null, agree: true, restart: "waiting", update: null, words: "RPE restarts once the job running ends." } }, onRestart: () => undefined }));
    expect(banners(tree).map((b) => b.title)).toEqual(["Restart", "The known-good copy was put back"]);
    expect(textOf(tree)).toContain("RPE restarts once the job running ends.");
  });

  test("the memory RPE holds is said, and against its service's limit where it runs as one", () => {
    const words = textOf(expand(h(ServiceView, { how: HOW, problem: null, restart: NO_RESTART, onRestart: () => undefined })));
    expect(words).toContain("300.0 MB");
    expect(words).toContain("at most 420.0 MB since it started; 2 worker threads running");
    expect(words).toContain("512.0 MB of 2.0 GB");
    expect(words).toContain("60.0 MB of a heap of 90.0 MB; 20.0 MB its objects own outside it (2.0 MB of that in buffers); the allocator holds 150.0 MB");
    expect(words).toContain("Session files kept read: 3, holding 1,200 characters");
    let pressed = 0;
    const freed = expand(h(ServiceView, { how: HOW, problem: null, restart: NO_RESTART, onRestart: () => undefined, onFree: () => pressed++, freed: { busy: false, problem: null, answer: { before: HOW.memory, after: { ...HOW.memory, holds: 120 * MIB }, ms: 40 } } }));
    press(freed, "Free what can be freed now");
    expect(pressed).toBe(1);
    expect(textOf(freed)).toContain("RPE held 300.0 MB before and 120.0 MB after");
    const byHand = textOf(expand(h(ServiceView, { how: { ...HOW, runs: "by hand", unit: null, restart: "by hand", memory: { ...HOW.memory, service: null } }, problem: null, restart: NO_RESTART, onRestart: () => undefined })));
    expect(byHand).toContain("300.0 MB");
    expect(byHand).not.toContain("Against its service's limit");
  });

  test("after a restart the page waits for a process that started later, then says it is back, on which build, and how long it took; a read that fails while RPE is down is tried again", async () => {
    let clock = 10_000;
    const timers: { fire: (() => void)[] } = { fire: [] };
    const poll = {
      every: 500,
      timers: {
        now: () => clock,
        setTimeout: (fn: () => void) => {
          timers.fire.push(fn);
          return timers.fire.length;
        },
        clearTimeout: () => undefined,
      } as unknown as Parameters<typeof watchRestart>[3]["timers"],
    };
    const { client, asked } = askingClient();
    const back: { build: string; tookMs: number }[] = [];
    watchRestart(client, HOW.since, 4_000, poll, (b) => back.push(b));
    const next = async (answer: "down" | ServiceHow): Promise<void> => {
      timers.fire.shift()?.();
      const call = asked.at(-1);
      if (answer === "down") call?.fail(new Error("RPE did not answer"));
      else call?.answer(answer);
      await settle();
    };
    await next("down");
    await next({ ...HOW });
    expect(back).toEqual([]);
    clock = 16_500;
    await next({ ...HOW, since: HOW.since + 12_000, build: "e5f6a7b8" });
    expect(back).toEqual([{ build: "e5f6a7b8", tookMs: 12_500 }]);
    expect(timers.fire).toEqual([]);
    const tree = expand(h(ServiceView, { how: HOW, problem: null, restart: { busy: false, problem: null, waiting: true, back: back[0], answer: { running: "e5f6a7b8", disk: null, broken: null, extension: null, agree: true, restart: "restarting", update: null, words: "RPE is restarting now; this page is back in a few seconds." } }, onRestart: () => undefined }));
    expect(textOf(tree)).toContain("RPE is back on build e5f6a7b8; the restart took 12.5 s.");
    expect(textOf(tree)).not.toContain("this page is back in a few seconds");
    const waiting = expand(h(ServiceView, { how: HOW, problem: null, restart: { busy: false, problem: null, waiting: true, answer: { running: "a1b2c3d4", disk: null, broken: null, extension: null, agree: true, restart: "waiting", update: null, words: "RPE is restarting." } }, onRestart: () => undefined }));
    expect(textOf(waiting)).toContain("Waiting for RPE to answer again");
  });
});

describe("RPE's log", () => {
  test("its filter is the page's address and comes back from it", () => {
    expect(logAt({ job: "j1", area: "bootstrap" })).toEqual(["log", "area", "bootstrap", "job", "j1"]);
    expect(logFilterOf(["log", "area", "bootstrap", "job", "j1", "level", "loud"])).toEqual({ area: "bootstrap", job: "j1" });
    expect(logFilterOf(["timings"])).toBeNull();
  });

  const LINE = { at: 1_800_000_000_000, level: "error" as const, message: "The job stopped.", area: "bootstrap", chat: "c1", turn: "t1", job: "j1", fields: { why: "no connection" } };
  const log: ServiceLog = { lines: [LINE], kept: 2000 };

  test("a line opens whole with what it names, and older lines are offered only while RPE keeps more", () => {
    const tree = expand(h(LogView, { filter: { job: "j1" }, log, asked: 1, loading: false, problem: null, onFilter: () => undefined, onMore: () => undefined, onTurn: () => undefined }));
    const text = textOf(tree);
    expect(text).toContain("chat c1 · turn t1 · job j1");
    expect(text).toContain("no connection");
    expect(elements(tree).some((e) => e.type === "button" && textOf(e.props.children) === "Older lines")).toBe(true);
    expect(moreLines(log, 200)).toBe(false);
    expect(moreLines({ lines: [LINE], kept: 1 }, 1)).toBe(false);
  });
});

describe("the timings", () => {
  test("each part with how many turns it was in and its middle, slowest and latest time", () => {
    const timings: ServiceTimings = { turns: 100, parts: [{ part: "to the first word", turns: 98, median: 1200, slowest: 31_000, latest: 900 }] };
    const text = textOf(expand(h(TimingsView, { timings, loading: false, problem: null, chat: null, ofChat: false, onScope: () => undefined })));
    expect(text).toContain("to the first word");
    expect(text).toContain("middle 1.2 s");
    expect(text).toContain("slowest 31.0 s");
  });
});
