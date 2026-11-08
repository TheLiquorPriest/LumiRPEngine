// The sandbox tools (`lre_sandbox_*`, DESIGN §23): a scratch copy of a chat on this machine, opened
// from its head behind the GM gate, played by the bundled engine with no model: typed turns, months
// fast-forwarded with a digest of each (an MCP server's advance stopping with a cursor once its time
// budget runs out), and reads as the GM view reads a chat. Nothing they do is written to the host, so
// read-only mode keeps them.

import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatExport } from "../shared/protocol";
import type { Args } from "../shared/tool-args";
import { intArg, neededText, textArg, textsArg, ToolError } from "../shared/tool-args";
import { LreError } from "./connection";
import { fitTurn } from "./offline";
import { BODY_LIMIT } from "../shared/tool-read";
import type { ToolResult } from "../shared/tool-answer";
import { json } from "../shared/tool-answer";
import { ADVANCE_MAX_DAYS, advance, closeSandbox, cutDigest, goOn, openList, openSandbox, playTurns, SANDBOX_BUDGET_MS, SANDBOX_MAX, SANDBOX_PARTS, sandboxGm, sandboxOf, TURNS_MAX, type Advance, type Sandbox, type SandboxTurn } from "./sandbox";
import type { ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";
import { gate, GM_ALL, GM_PICK_OPTIONS, GM_PICKS, gmRead, PAGING_USAGE, readOut, SPOILERS } from "../shared/chat-reads";

const SECTION = "A sandbox: a scratch copy of a chat";
/** `lre_sandbox_read`'s part that reads what the sandbox did: its turns and advances, every month's digest whole. */
const LOG = "log";

const SANDBOX: JsonObject = { type: "string", description: "The sandbox's id (sb1…), from lre_sandbox_open." };
const TURNS: JsonObject = { type: "array", items: { type: "string" }, minItems: 1, maxItems: TURNS_MAX, description: 'What the player types, one entry per turn, played by the engine alone as Playtest plays them ("walk to the market", "send $500 to Danny").' };
const DAYS: JsonObject = { type: "integer", minimum: 1, maximum: ADVANCE_MAX_DAYS, description: `How many days to move the clock on (1 to ${ADVANCE_MAX_DAYS}).` };
const CURSOR: JsonObject = { type: "string", description: "Instead of days: go on with an advance whose time ran out, to where it was going, from the cursor its answer gave." };

const sandboxIdOf = (args: Args): Sandbox => sandboxOf(neededText(args, "sandbox", "the sandbox's id (lre_sandbox_open gives it)"));

/** How long this session's advance runs before it stops with a cursor; null for no limit (the command line's, whose sandbox lasts one command). */
const budgetOf = (ctx: ToolContext): number | null => (ctx.sandboxBudgetMs === undefined ? SANDBOX_BUDGET_MS : ctx.sandboxBudgetMs);

function turnsOf(args: Args, needed: boolean): string[] {
  const turns = textsArg(args, "turns") ?? [];
  if (needed && turns.length === 0) throw new ToolError('Give turns: what the player types, one entry per turn (["look around", "send $500 to Danny"]).');
  if (turns.length > TURNS_MAX) throw new ToolError(`That is ${turns.length} turns; play at most ${TURNS_MAX} at once.`);
  return turns;
}

/** Turns as one answer holds them, each within its share of `room`: its reply and notes cut to fit (`fitTurn`), its money to the holders it moved most; the sandbox's log keeps each whole. */
function turnsOut(turns: readonly SandboxTurn[], room: number): JsonValue[] {
  const share = Math.floor(room / Math.max(1, turns.length));
  return turns.map((t) => JSON.parse(JSON.stringify({ ...fitTurn(t, Math.max(400, share - 700)), clock: t.clock, money: t.money.slice(0, 5), ...(t.money.length > 5 ? { moreMoney: t.money.length - 5 } : {}) })) as JsonValue);
}

/** An advance as one answer holds it: each month's lists cut as short as the answer needs, the whole of each kept in the sandbox's log; one whose time ran out says how to go on. */
function advanceOut(sb: Sandbox, a: Advance, room: number, budgetMs: number | null): JsonObject {
  const at = sb.log.findIndex((l) => "advance" in l && l.advance === a);
  const goes: JsonObject = a.goesOn !== undefined ? { until: a.goesOn.until, cursor: a.goesOn.cursor, next: `This call's time ran out (${(budgetMs ?? 0) / 1000} s, the server's --sandbox-budget): lre_sandbox_advance {sandbox: "${sb.id}", cursor: "${a.goesOn.cursor}"} goes on to ${a.goesOn.until}.` } : {};
  const head = { from: a.from, to: a.to, days: a.days, ...(a.stopped !== undefined ? { stopped: a.stopped } : {}), ...goes };
  const read = `Every month whole: lre_sandbox_read {sandbox: "${sb.id}", part: "${LOG}", pointer: "/${at}/advance/months"}.`;
  for (const cap of [8, 5, 3, 1, 0]) {
    const out = { ...head, months: a.months.map((m) => cutDigest(m, cap)), read };
    if (json(out).length <= room) return out;
  }
  return { ...head, months: a.months.map((m) => ({ month: m.month, from: m.from, to: m.to })), read };
}

async function openTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_sandbox_open", "copies everything in the chat, secrets, hidden people and places included");
  const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");
  const turns = turnsOf(args, false);
  const days = intArg(args, "days", 1, ADVANCE_MAX_DAYS);
  let exported: ChatExport;
  try {
    exported = await ctx.live().conn.request("lre.chat.export", { chatId });
  } catch (error) {
    if (error instanceof LreError && error.code === "not_world_chat") throw new ToolError(`Chat ${chatId} plays no world (or there is no such chat): lre_chats lists the chats that play one.`);
    throw error;
  }
  const sb = openSandbox(exported);
  const played = turns.length > 0 ? playTurns(sb, turns) : [];
  const budget = budgetOf(ctx);
  const moved = days !== undefined ? advance(sb, days, budget) : null;
  const opened = {
    sandbox: sb.id,
    chatId: sb.chatId,
    world: { id: sb.worldId, name: sb.world.name, revision: sb.revision },
    engine: exported.engine,
    clock: openList().find((o) => o.sandbox === sb.id)?.clock ?? null,
    note: "A scratch copy of the chat's head, on this machine: nothing done here reaches the chat or your Lumiverse, and no model runs. Fast-forward with lre_sandbox_advance, try typed turns with lre_sandbox_turns, read it with lre_sandbox_read, and close it with lre_sandbox_close.",
  };
  const shown = turnsOut(played, moved ? Math.floor(BODY_LIMIT * 0.4) : BODY_LIMIT - 2000);
  const room = BODY_LIMIT - json({ ...opened, turns: shown }).length;
  return { text: json({ ...opened, ...(played.length > 0 ? { turns: shown } : {}), ...(moved ? { advance: advanceOut(sb, moved, room, budget) } : {}), open: openList() }) };
}

async function turnsTool(args: Args): Promise<ToolResult> {
  const sb = sandboxIdOf(args);
  const played = playTurns(sb, turnsOf(args, true));
  return { text: json({ sandbox: sb.id, turns: turnsOut(played, BODY_LIMIT - 500) }) };
}

async function advanceTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const sb = sandboxIdOf(args);
  const days = intArg(args, "days", 1, ADVANCE_MAX_DAYS);
  const cursor = textArg(args, "cursor")?.trim();
  if (days !== undefined && cursor !== undefined) throw new ToolError("Give days or cursor, not both: a cursor goes on to where its advance was going.");
  if (days === undefined && (cursor === undefined || cursor === "")) throw new ToolError(`Give days: how many days to move the clock on (1 to ${ADVANCE_MAX_DAYS}); or cursor, from an advance whose time ran out.`);
  const budget = budgetOf(ctx);
  const moved = days !== undefined ? advance(sb, days, budget) : goOn(sb, cursor ?? "", budget);
  return { text: json({ sandbox: sb.id, ...advanceOut(sb, moved, BODY_LIMIT - 200, budget) }) };
}

async function readTool(args: Args): Promise<ToolResult> {
  const sb = sandboxIdOf(args);
  if (textArg(args, "part")?.trim() === LOG) {
    const picked = ["entity", "party", "account", "org", "kind", "compact"].filter((k) => args[k] !== undefined);
    if (picked.length > 0) throw new ToolError(`part ${LOG} reads what the sandbox did, not its GM view: give ${picked.join(", ")} without it.`);
    return readOut(sb.log, `what sandbox ${sb.id} did, oldest first: each typed turn and each advance with every month's digest`, args);
  }
  return gmRead(args, sandboxGm(sb));
}

async function closeTool(args: Args): Promise<ToolResult> {
  const sb = sandboxIdOf(args);
  closeSandbox(sb.id);
  return { text: json({ closed: sb.id, open: openList() }) };
}

export const SANDBOX_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_sandbox_open",
    description: `Open a sandbox: a scratch copy of a chat's head on this machine, played by the engine bundled here with no model, so nothing done in it reaches the chat or your Lumiverse. Fast-forward it months at a time to see what money does (lre_sandbox_advance: bills, pay, standing payments, postings by holder, month by month), try typed turns ("send $500 to Danny") with lre_sandbox_turns, read it as lre_gm reads a chat with lre_sandbox_read, and close it with lre_sandbox_close. turns and days here play at once after it opens (on the command line, a sandbox lasts one command). It copies everything, secrets included: needs spoilers: true. Refused when your Lumiverse runs another engine than this client bundles. At most ${SANDBOX_MAX} are open at once; each lasts until it is closed or this process ends.`,
    inputSchema: object({ chatId: { type: "string", description: "The chat to copy (lre_chats lists the chats that play a world)." }, spoilers: SPOILERS, turns: TURNS, days: { ...DAYS, description: `Then move its clock this many days on (1 to ${ADVANCE_MAX_DAYS}), as lre_sandbox_advance does: an advance whose time runs out answers a cursor to go on with there.` } }, ["chatId", "spoilers"]),
    write: false,
    run: openTool,
    cli: { command: "sandbox-open", section: SECTION, usage: "sandbox-open <chatId> --spoilers [--turn <text> …] [--days <n>]", summary: "Copy a chat into a sandbox here; play turns and days in it", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--turn": { arg: "turns", as: "many" }, "--days": { arg: "days", as: "int" } } },
  },
  {
    name: "lre_sandbox_turns",
    description: "Play typed turns in a sandbox, one after another, as Playtest plays them: the engine reads each by its lexicon, the names it says and the money it names (\"send $500 to Danny\" pays Danny), with no narrator and no model. Each turn answers what the player would see of it, the engine's notes, the clock after it and the money it moved by holder. Nothing reaches the chat.",
    inputSchema: object({ sandbox: SANDBOX, turns: TURNS }, ["sandbox", "turns"]),
    write: false,
    run: turnsTool,
    cli: { command: "sandbox-turns", section: SECTION, usage: "sandbox-turns <sandbox> --turn <text> [--turn …]", summary: "Play typed turns in a sandbox", positionals: ["sandbox"], needs: 1, options: { "--turn": { arg: "turns", as: "many" } } },
  },
  {
    name: "lre_sandbox_advance",
    description: `Move a sandbox's clock days on (1 to ${ADVANCE_MAX_DAYS}), a day at a time as Check world runs one, every interrupt at note so nothing stops it: schedules, plans, rules, tracks and money all run. Answers a digest of each calendar month: postings by holder (in, out, net), the bills loans and cards closed, paychecks, each standing payment's runs and how they ended, and what was dropped, failed or leaked (the narrator's sections are read at each month's end). A call stops at the start of a day once this server's time for it runs out (--sandbox-budget, ${SANDBOX_BUDGET_MS / 1000} s by default), answering until and a cursor: call again with the cursor instead of days to go on, as many times as it takes. A long advance cuts each month's lists to fit; part log of lre_sandbox_read holds every month whole. Nothing reaches the chat.`,
    inputSchema: object({ sandbox: SANDBOX, days: DAYS, cursor: CURSOR }, ["sandbox"]),
    write: false,
    run: advanceTool,
    cli: { command: "sandbox-advance", section: SECTION, usage: "sandbox-advance <sandbox> (--days <n> | --cursor <cursor>)", summary: "Fast-forward a sandbox, with a digest of each month", positionals: ["sandbox"], needs: 1, options: { "--days": { arg: "days", as: "int" }, "--cursor": { arg: "cursor", as: "text" } } },
  },
  {
    name: "lre_sandbox_read",
    description: `Read a sandbox as lre_gm reads a chat: with nothing else, its outline; part (one of ${SANDBOX_PARTS.join(", ")}, or ${GM_ALL}); entity, party (with account) or org by id or name; kind and compact for the entities; a pointer whose first token is a part, keyed below it (/money/danny_okafor/accounts); paged with offset, or from and limit. Part ${LOG} reads what the sandbox did instead: each typed turn and each advance with every month's digest whole. A sandbox has the world's parts alone: the chat's edits, held writes and minds stay the chat's.`,
    inputSchema: object({ sandbox: SANDBOX, part: { type: "string", enum: [...SANDBOX_PARTS, GM_ALL, LOG], description: `Only this part; ${GM_ALL}: every part at once; ${LOG}: what the sandbox did. Left out, with no entity, party, org or pointer either: the outline.` }, ...GM_PICKS }, ["sandbox"]),
    write: false,
    run: readTool,
    cli: { command: "sandbox-read", section: SECTION, usage: `sandbox-read <sandbox> [--part <part|${GM_ALL}|${LOG}> | --entity <id|name> | --party <id|name> [--account <id|name>] | --org <id|name>] [--kind <kind>] [--compact] ${PAGING_USAGE}`, summary: "Read a sandbox as the GM view reads a chat", positionals: ["sandbox"], needs: 1, options: { "--part": { arg: "part", as: "text" }, ...GM_PICK_OPTIONS } },
  },
  {
    name: "lre_sandbox_close",
    description: "Close a sandbox, letting its copy of the chat go. Answers the sandboxes still open.",
    inputSchema: object({ sandbox: SANDBOX }, ["sandbox"]),
    write: false,
    run: closeTool,
    cli: { command: "sandbox-close", section: SECTION, usage: "sandbox-close <sandbox>", summary: "Close a sandbox", positionals: ["sandbox"], needs: 1 },
  },
];
