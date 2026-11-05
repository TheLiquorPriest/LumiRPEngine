// The sandbox (`lre_sandbox_*`): a scratch copy of a Port Alder chat's head, played by the bundled
// engine. 62 days advance its clock, bill the player's auto loan twice and post their pay, month by
// month; an advance whose time runs out stops at a day's start with a cursor, and going on from it
// plays what one advance would; a typed "Send $500 to Danny" moves money in the sandbox alone; the
// real chat is unchanged; another engine on the host is refused, as are a fourth sandbox and a call
// without spoilers.

import { afterEach, describe, expect, test } from "bun:test";
import { advance, closeSandbox, openList, openSandbox, sandboxOf } from "../../src/cli/sandbox";
import { callTool } from "../../src/cli/tools";
import { isRecord } from "../../src/shared/json";
import type { ChatExport } from "../../src/shared/protocol";
import { cliRig } from "../support/cli-rig";

const LOAN = "acct_pov_auto_loan";
const DANNY = "danny_okafor";

async function portAlder() {
  const cli = await cliRig({ shipped: true });
  const created = await cli.call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const chatId = cli.rig.host.createChat("Morning.");
  await cli.call("lre_attach", { worldId: String(created.worldId), chatId });
  await cli.rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  const exported = (): Promise<ChatExport> => cli.conn.request("lre.chat.export", { chatId });
  /** A read tool's value at a pointer (the JSON after its header). */
  const read = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = await cli.raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.text}`);
    return JSON.parse(result.text.slice(result.text.indexOf("\n\n") + 2));
  };
  return { ...cli, chatId, exported, read };
}

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

afterEach(() => {
  for (const open of openList()) closeSandbox(String(open.sandbox));
});

describe("the sandbox", () => {
  test("62 days advance the clock, bill the loan twice and post pay, month by month; the chat is unchanged", async () => {
    const { chatId, call, exported, read } = await portAlder();
    const before = await exported();
    const opened = await call("lre_sandbox_open", { chatId, spoilers: true });
    const sandbox = String(opened.sandbox);
    expect(opened).toMatchObject({ chatId, world: { name: "Port Alder" } });
    const moved = await call("lre_sandbox_advance", { sandbox, days: 62 });
    expect(moved).toMatchObject({ sandbox, days: 62, from: opened.clock, to: expect.stringMatching(/^Sun 15 Nov 2026, /) });
    expect(moved.stopped).toBeUndefined();
    const months = list(moved.months);
    expect(months.map((m) => m.month)).toEqual(["Sep 2026", "Oct 2026", "Nov 2026"]);
    // Each month names its slowest processes, five at most, each with its time over the month.
    for (const m of months) {
      const slowest = String(m.slowest);
      expect(slowest).toStartWith("Slowest processes: ");
      const named = slowest.slice("Slowest processes: ".length).split(" · ");
      expect(named.length).toBeGreaterThan(0);
      expect(named.length).toBeLessThanOrEqual(5);
      for (const p of named) expect(p).toMatch(/^\S+ \d/);
    }
    // Each month whole, from the sandbox's log: its first entry is this advance.
    const whole = async (key: string): Promise<Record<string, unknown>[]> => (await Promise.all(months.map(async (_, i) => list(await read("lre_sandbox_read", { sandbox, part: "log", pointer: `/0/advance/months/${i}/${key}` }))))).flat();
    const bills = (await whole("bills")).filter((b) => b.id === LOAN);
    expect(bills.map((b) => [b.account, String(b.due).slice(0, 10)])).toEqual([
      ["Your auto loan", "Sat 10 Oct"],
      ["Your auto loan", "Tue 10 Nov"],
    ]);
    const paid = (await whole("pays")).filter((p) => p.worker === "Jordan Ellis");
    expect(paid.length).toBeGreaterThanOrEqual(8);
    expect(paid.every((p) => p.job === "Mechanic at Alder Automotive" && String(p.gross).startsWith("$"))).toBe(true);
    // Each month's postings by holder: the player's money moved in each.
    for (const [i] of months.entries()) expect(list(await read("lre_sandbox_read", { sandbox, part: "log", pointer: `/0/advance/months/${i}/postings` })).some((h) => h.holder === "Jordan Ellis")).toBe(true);
    // The sandbox's clock moved 62 days; the chat's didn't, nor anything else of it.
    expect(openList().find((o) => o.sandbox === sandbox)).toMatchObject({ days: 62, clock: moved.to });
    expect(await exported()).toEqual(before);
  }, 120_000);

  test("a clock that can't move stops an advance where it stands, saying why", async () => {
    const { exported } = await portAlder();
    const sb = openSandbox(await exported());
    sb.state.time.paused = true;
    const done = advance(sb, 3);
    expect(done.days).toBe(0);
    expect(done.stopped).toMatch(/^The clock stopped at .*: Timelapse not run/);
    expect(sb.log).toEqual([{ advance: done }]);
  }, 60_000);

  test("an advance whose time runs out stops at a day's start with a cursor; going on from it plays what one advance would", async () => {
    const { chatId, call, ctx, exported } = await portAlder();
    const one = openSandbox(await exported());
    const whole = advance(one, 8);
    const sandbox = String((await call("lre_sandbox_open", { chatId, spoilers: true })).sandbox);
    // No time at all: each call plays the one span it always plays, to the next midnight.
    const spent = { ...ctx, sandboxBudgetMs: 0 };
    const answers: Record<string, unknown>[] = [];
    let args: Record<string, unknown> = { sandbox, days: 8 };
    for (let i = 0; i < 12 && args.cursor !== null; i++) {
      const result = await callTool("lre_sandbox_advance", args, spent);
      expect(result.isError).toBeUndefined();
      const answer = JSON.parse(result.text) as Record<string, unknown>;
      answers.push(answer);
      args = { sandbox, cursor: typeof answer.cursor === "string" ? answer.cursor : null };
    }
    // From the morning: to midnight, seven whole days, then on to the same time eight days on.
    expect(answers).toHaveLength(9);
    for (const a of answers.slice(0, -1)) {
      expect(a).toMatchObject({ to: expect.stringMatching(/, 12:00 AM$/), until: whole.to });
      expect(a.next).toContain(`lre_sandbox_advance {sandbox: "${sandbox}", cursor: "${String(a.cursor)}"} goes on to ${whole.to}`);
    }
    expect(answers.at(-1)).toMatchObject({ from: answers.at(-2)?.to, to: whole.to });
    expect(answers.at(-1)?.cursor).toBeUndefined();
    // The same spans on the same seeds: the state one advance leaves, and the same bills and pay.
    const split = sandboxOf(sandbox);
    expect(split.state).toEqual(one.state);
    const of = (log: typeof split.log, key: "bills" | "pays"): unknown[] => log.flatMap((l): unknown[] => ("advance" in l ? l.advance.months.flatMap((m): unknown[] => m[key]) : []));
    expect([of(split.log, "bills"), of(split.log, "pays")]).toEqual([of(one.log, "bills"), of(one.log, "pays")]);
    expect(of(one.log, "pays").length).toBeGreaterThan(0);
    // A cursor goes on once, with this sandbox, and never beside days.
    const refused = async (cursorArgs: Record<string, unknown>): Promise<string> => {
      const result = await callTool("lre_sandbox_advance", { sandbox, ...cursorArgs }, spent);
      expect(result.isError).toBe(true);
      return result.text;
    };
    const last = String(answers.at(-2)?.cursor);
    expect(await refused({ cursor: last })).toContain("That advance is done");
    expect(await refused({ cursor: last, days: 2 })).toContain("Give days or cursor, not both");
    expect(await refused({ cursor: last.replace(sandbox, "sb99") })).toContain("goes on with sandbox sb99's advance");
    expect(await refused({ cursor: "tomorrow" })).toContain("isn't a cursor an advance gave");
    expect(await refused({})).toContain("Give days");
  }, 120_000);

  test('"Send $500 to Danny" moves money in the sandbox alone', async () => {
    const { chatId, call, read } = await portAlder();
    const dannyInChat = async (): Promise<unknown> => read("lre_gm", { chatId, spoilers: true, party: DANNY });
    const chatBefore = await dannyInChat();
    const opened = await call("lre_sandbox_open", { chatId, spoilers: true, turns: ["Send $500 to Danny"] });
    const [turn] = list(opened.turns);
    expect(turn?.notes).toEqual(expect.arrayContaining(["read as Pay"]));
    const money = list(turn?.money);
    expect(money.find((h) => h.holder === "Danny Okafor")).toMatchObject({ in: "$500.00", net: "+$500.00" });
    expect(money.find((h) => h.holder === "Jordan Ellis")).toMatchObject({ out: "$500.00", net: "-$500.00" });
    const sandbox = String(opened.sandbox);
    const dannyHere = await read("lre_sandbox_read", { sandbox, party: DANNY });
    expect(dannyHere).not.toEqual(chatBefore);
    expect(await dannyInChat()).toEqual(chatBefore);
    // The sandbox's log holds the turn as it answered it.
    expect(await read("lre_sandbox_read", { sandbox, part: "log", pointer: "/0/turn/user" })).toBe("Send $500 to Danny");
  }, 60_000);

  test("reads as lre_gm reads a chat: the outline, a part, one party by name; the chat's own parts stay the chat's", async () => {
    const { chatId, call, raw, read } = await portAlder();
    const sandbox = String((await call("lre_sandbox_open", { chatId, spoilers: true })).sandbox);
    const outline = await raw("lre_sandbox_read", { sandbox });
    expect(outline.text).toContain(`sandbox ${sandbox}`);
    expect(outline.text).not.toContain("held");
    const danny = await read("lre_sandbox_read", { sandbox, party: "Danny Okafor" });
    expect(isRecord(danny) && danny.party).toBe(DANNY);
    expect((await raw("lre_sandbox_read", { sandbox, part: "minds" })).isError).toBe(true);
    expect((await raw("lre_sandbox_read", { sandbox, org: "Nowhere Inc" })).text).toContain(`in sandbox ${sandbox}`);
  }, 60_000);

  test("is refused without spoilers, past three at once, for another engine, and once closed", async () => {
    const { chatId, call, raw, exported } = await portAlder();
    const gated = await raw("lre_sandbox_open", { chatId });
    expect(gated.isError).toBe(true);
    expect(gated.text).toContain("spoilers: true");
    expect(openList()).toEqual([]);
    const other = await exported();
    expect(() => openSandbox({ ...other, engine: "0.0.0-elsewhere" })).toThrow("bundles engine");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(String((await call("lre_sandbox_open", { chatId, spoilers: true })).sandbox));
    const fourth = await raw("lre_sandbox_open", { chatId, spoilers: true });
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toContain("3 sandboxes are open");
    const [first = ""] = ids;
    expect((await call("lre_sandbox_close", { sandbox: first })).open).toHaveLength(2);
    const gone = await raw("lre_sandbox_turns", { sandbox: first, turns: ["look around"] });
    expect(gone.isError).toBe(true);
    expect(gone.text).toContain(`There is no sandbox ${first}`);
    // Read-only mode keeps them: nothing they do is written to the host.
    expect((await raw("lre_sandbox_read", { sandbox: ids[1] }, true)).isError).toBeUndefined();
  }, 60_000);
});
