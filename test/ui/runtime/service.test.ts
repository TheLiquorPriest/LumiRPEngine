// How RPE runs, its log and its timings on Runtime: a service offers Restart and a hand-started RPE does not; the
// log's address holds its filter; the timings say each part with its middle, slowest and latest time.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { ServiceHow, ServiceLog, ServiceTimings } from "../../../src/shared/api";
import { logAt, logFilterOf } from "../../../src/ui/pages/runtime";
import { LogView, moreLines } from "../../../src/ui/pages/runtime/logs";
import { canRestart, NO_RESTART, ServiceView } from "../../../src/ui/pages/runtime/service";
import { TimingsView } from "../../../src/ui/pages/runtime/timings";
import { banners, elements, expand, press, textOf } from "../vnodes";

const HOW: ServiceHow = { runs: "service", unit: "rpe-ann.service", since: 1_800_000_000_000, listens: ["http://127.0.0.1:7777"], build: "a1b2c3d4", fellBack: null, restart: "none" };

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
    const tree = expand(h(ServiceView, { how: { ...HOW, fellBack: "The new build did not start twice." }, problem: null, restart: { busy: false, problem: null, answer: { running: "a1b2c3d4", disk: null, broken: null, extension: null, agree: true, restart: "waiting", words: "RPE restarts once the job running ends." } }, onRestart: () => undefined }));
    expect(banners(tree).map((b) => b.title)).toEqual(["Restart", "The known-good copy was put back"]);
    expect(textOf(tree)).toContain("RPE restarts once the job running ends.");
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
