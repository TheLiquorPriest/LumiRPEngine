// The audit of what an agent can do on the harness engine (`docs/harness-tools.md`), walked: every
// tool its table names is one the harness lists and every tool the harness lists is in it, a
// surface an agent can create on can be read, a tier it gives is the tool's own, and a surface that
// is not an agent's says why. Then every tool it lists is called once with no arguments, as a
// model's first wrong call would be: each answers in words and none reaches a model.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_LISTED, type HarnessListed, type HarnessNeeds } from "../../src/backend/agents/tools/harness";
import { worldBuild } from "../../src/backend/agents/tools/harness-ports";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { authorEnv, call, memoryFiles, noModelCalls } from "./harness-cast-kit";
import { AUTHOR, beginTurn, harnessChat } from "./harness-driver";

const DOES = ["create", "read", "change", "remove"] as const;
const TIERS = ["read", "story", "gm", "author", "mind", "any"] as const;

/** One row of the table: a tool on a surface, or a surface that is not an agent's (`tool` null). */
interface Row {
  surface: string;
  tool: string | null;
  does: string[];
  what: string;
  tier: string | null;
}

/** A cell that names one thing in code, or holds the dash of a row with none. */
function coded(cell: string, where: string): string | null {
  if (cell === "—") return null;
  const named = /^`([a-z_]+)`$/.exec(cell)?.[1];
  if (named === undefined) throw new Error(`${where}: "${cell}" is neither a name in backticks nor a dash`);
  return named;
}

/** The table's rows. A surface is named with the page or request it is reached by on its first row: the name before the bracket is the surface. */
function rows(): Row[] {
  const doc = readFileSync(join(import.meta.dir, "../../docs/harness-tools.md"), "utf8");
  const table = doc.slice(doc.indexOf("## The table")).split("\n").filter((line) => line.startsWith("|"));
  return table.slice(2).map((line, i): Row => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const [surface, tool, does, what, tier] = cells;
    if (cells.length !== 5 || surface === undefined || tool === undefined || does === undefined || what === undefined || tier === undefined) throw new Error(`row ${i + 1} doesn't have five cells: ${line}`);
    return { surface: surface.split(" (")[0] ?? surface, tool: coded(tool, `row ${i + 1}`), does: does === "—" ? [] : does.split(",").map((d) => d.trim()), what, tier: coded(tier, `row ${i + 1}`) };
  });
}

const ROWS = rows();
const LISTED: ReadonlyMap<string, HarnessListed> = new Map(HARNESS_LISTED.map((t) => [t.name, t]));

describe("the audit of what an agent can do (docs/harness-tools.md)", () => {
  test("every tool the table names is one the harness lists, and every tool the harness lists is in the table", () => {
    const named = ROWS.flatMap((row) => (row.tool === null ? [] : [row.tool]));
    expect(named.filter((name) => !LISTED.has(name))).toEqual([]);
    expect(HARNESS_LISTED.map((t) => t.name).filter((name) => !named.includes(name))).toEqual([]);
    // A tool is listed once on a surface: a second row would say the same thing twice, or two things of one tool.
    const pairs = ROWS.flatMap((row) => (row.tool === null ? [] : [`${row.surface}: ${row.tool}`]));
    expect(pairs.filter((pair, i) => pairs.indexOf(pair) !== i)).toEqual([]);
    expect(ROWS.length).toBeGreaterThan(HARNESS_LISTED.length);
  });

  test("a surface an agent can create on, change or take from can be read", () => {
    const surfaces = [...new Set(ROWS.map((row) => row.surface))];
    for (const surface of surfaces) {
      const does = new Set(ROWS.filter((row) => row.surface === surface).flatMap((row) => row.does));
      for (const word of does) expect({ surface, word, known: (DOES as readonly string[]).includes(word) }).toEqual({ surface, word, known: true });
      // The turn's own tools change nothing that is read back: what a commit made is its own answer.
      if (does.size > 0 && surface !== "The turn") expect({ surface, read: does.has("read") }).toEqual({ surface, read: true });
    }
    expect(surfaces.length).toBeGreaterThan(20);
  });

  test("a tier the table gives is the tool's own: who may call it, as the registry says it and the bridge's gate holds every call to", () => {
    for (const row of ROWS) {
      if (row.tool === null) continue;
      const tool = LISTED.get(row.tool);
      if (!tool) continue;
      const where = `${row.surface}: ${row.tool}`;
      expect({ where, tier: row.tier, known: (TIERS as readonly (string | null)[]).includes(row.tier) }).toEqual({ where, tier: row.tier, known: true });
      expect({ where, tier: row.tier }).toEqual({ where, tier: tool.needs });
      // What only reads is said to read, and nothing else is.
      if (tool.tier === "read") expect({ where, does: row.does }).toEqual({ where, does: ["read"] });
      else expect({ where, onlyReads: row.does.length === 1 && row.does[0] === "read" }).toEqual({ where, onlyReads: false });
      expect(row.does.length).toBeGreaterThan(0);
      expect(row.what.length).toBeGreaterThan(15);
    }
  });

  test("a surface that is not an agent's says so, and why", () => {
    const closed = ROWS.filter((row) => row.tool === null);
    expect(closed.length).toBeGreaterThan(8);
    for (const row of closed) {
      expect({ surface: row.surface, does: row.does, tier: row.tier }).toEqual({ surface: row.surface, does: [], tier: null });
      expect({ surface: row.surface, says: /^Not (an agent's|the engine's on the harness): /.test(row.what), why: row.what.length > 80 }).toEqual({ surface: row.surface, says: true, why: true });
    }
  });

  test("every tool the table lists answers a call with no arguments in words, and reaches no model", async () => {
    const { rig, chatId, env } = await authorEnv();
    const full = { ...env, build: await worldBuild(rig.rt, chatId, rig.host.userId), files: memoryFiles() };
    for (const name of new Set(ROWS.flatMap((row) => (row.tool === null ? [] : [row.tool])))) {
      const out = await call(full, name, {});
      expect({ name, answered: out.text.trim().length > 0 }).toEqual({ name, answered: true });
    }
    noModelCalls(rig);
  });

  test("the bridge's gate holds every call to the tier the table gives: an agent below it is refused before the tool runs, tool by tool", async () => {
    const { rig, chatId } = await harnessChat();
    const turn = await beginTurn(rig, chatId, "I look around.");
    const note = (id: string, vars: Record<string, string>): string => renderPrompt(id, {}, vars);
    let calls = 0;
    /** One call with no arguments as the runtime sends it: by the run's main agent, or by an agent of `role` that the author started. */
    const answered = (name: string, role: string): Promise<{ text: string; error?: boolean }> => {
      const main = role === HARNESS_AGENT.author;
      return rig.rt.harness.tools.call({ name, args: {}, turn: turn.turn, chatId, agentId: main ? AUTHOR.id : `agent-${role}`, role, callId: `gate-${++calls}`, kind: turn.kind, main, above: main ? [] : [{ agentId: AUTHOR.id, role: AUTHOR.role }] }, new AbortController().signal);
    };
    /** What closed a call: one of the gate's own refusals, as it words each. A call the gate let through is open, whatever the tool then made of no arguments. */
    const closedBy = (name: string, out: { text: string; error?: boolean }): string => {
      if (out.error !== true) return "open";
      if (out.text === note(HARNESS_NOTE.authorOnly, { tool: name })) return "author";
      if (out.text === note(HARNESS_NOTE.notCharacter, { tool: name })) return "mind";
      return /^\{"refused":\{"code":"(no_writer|not_granted)"/.exec(out.text)?.[1] ?? "open";
    };
    /** What the table's tier closes a tool to: for an agent that only reads (the game master's ruling), one at the story's tier (the chronicler), and the author itself. */
    const closes = (needs: HarnessNeeds, role: string): string => {
      if (needs === "mind") return "mind";
      if (role === HARNESS_AGENT.author) return "open";
      if (needs === "author") return "author";
      if (needs === "gm") return role === HARNESS_AGENT.gm ? "no_writer" : "not_granted";
      return needs === "story" && role === HARNESS_AGENT.gm ? "no_writer" : "open";
    };
    const wrong: string[] = [];
    for (const tool of HARNESS_LISTED) {
      for (const role of [HARNESS_AGENT.gm, HARNESS_AGENT.chronicler, HARNESS_AGENT.author]) {
        const got = closedBy(tool.name, await answered(tool.name, role));
        if (got !== closes(tool.needs, role)) wrong.push(`${tool.name} (${tool.needs}) called by ${role}: ${got}`);
      }
    }
    expect(wrong).toEqual([]);
    await turn.finish("Quiet.");
    noModelCalls(rig);
  });
});
