// Reads the test instance back, item by item, through today's build's own reads (the engine's page
// requests, its harness pages' requests, its CLI, Lumiverse's API), by the ids the run recorded, and
// writes what it found to `report.json` in the instance folder. It changes nothing. Only the deleted
// chat's run data and the hand-placed file are looked at on disk: no read of the build reaches them.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openContext } from "./lib/context";
import { userStorage } from "./lib/env";
import { UNNAMED_FILE } from "./steps/leftovers";

const ctx = await openContext();
const id = (key: string): string | undefined => ctx.log.get<string>(key);
const out: { [item: string]: unknown } = {};

async function item(name: string, read: () => Promise<unknown>): Promise<void> {
  try {
    out[name] = await read();
  } catch (error) {
    out[name] = { error: error instanceof Error ? error.message : String(error) };
  }
}

type Doc = { [part: string]: unknown };
const filled = (doc: Doc): string[] => Object.keys(doc).filter((k) => {
  const v = doc[k];
  return v !== null && v !== undefined && (typeof v !== "object" || Object.keys(v as object).length > 0);
});

try {
  const worldId = id("worldId") ?? "";
  const bookId = id("bookId") ?? "";
  const entryId = id("entryId") ?? "";
  const chats = Object.fromEntries(["classic", "agents", "harness", "branch"].map((k) => [k, id(`chat:${k}`) ?? ""]));

  await item("1 world", async () => {
    const got = await ctx.socket.lre<{ world: Doc & { lore: { [id: string]: Doc }; maps: { [id: string]: Doc } }; revision: string; history: { revision: string; source: string; note?: string }[] }>("lre.world", { op: "get", worldId });
    const draft = await ctx.socket.lre<{ stored: boolean; version: number; base: string | null }>("lre.editor", { op: "get", worldId, base: null });
    const jobs = await ctx.socket.lre<{ jobs?: { jobId?: string; kind?: string; status?: string }[] }>("lre.job", { op: "list", worldId });
    const lore = Object.values(got.world.lore).filter((l) => l.secret === true || l.visibility === "known_by").map((l) => ({ id: l.id, holders: l.holders ?? null, gate: l.gate ?? null, visibility: l.visibility ?? null }));
    return { worldId, head: got.revision, history: got.history, parts: filled(got.world), maps: Object.values(got.world.maps).map((m) => ({ id: m.id, cellMeters: m.cellMeters })), lore, draft: { stored: draft.stored, version: draft.version }, jobs: jobs.jobs ?? [] };
  });

  await item("2 book", async () => {
    const entries = await ctx.socket.lre<{ entries?: { id: string; title: string; marks?: { knownTo: string[] }[]; lore?: unknown }[] }>("lre.lore", { op: "entries", bookId });
    const secrecy = await ctx.socket.lre<{ books?: { id: string; state: string }[] }>("lre.secrecy", { op: "books" });
    const minds = await ctx.cli.run<string | object>(["minds", chats.classic ?? "", "--spoilers"]);
    const text = typeof minds === "string" ? minds : JSON.stringify(minds);
    const fact = (n: number): string => `wi:${bookId}:${entryId}:${n}`;
    return { bookId, entries: entries.entries ?? [], secrecy: secrecy.books?.find((b) => b.id === bookId) ?? null, factsSeen: { [fact(0)]: text.includes(fact(0)), [fact(1)]: text.includes(fact(1)) } };
  });

  for (const [key, chatId] of Object.entries(chats)) {
    if (chatId === "") continue;
    await item(`3-5 chat ${key}`, async () => {
      const messages = await ctx.host.messages(chatId);
      const state = await ctx.player.state(chatId);
      const view = state.view as { status?: string; engine?: string; chips?: { id: string; kind: string }[]; staged?: unknown };
      return {
        chatId,
        engine: view.engine ?? null,
        status: view.status ?? null,
        staged: view.staged ?? null,
        chips: (view.chips ?? []).map((c) => c.id),
        messages: messages.map((m) => ({ id: m.id, user: m.is_user, swipes: m.swipes.length, shown: m.swipe_id, intent: ((m.extra as { spindle_metadata?: { lumi_rp_engine?: { action?: string; staged?: boolean } } } | undefined)?.spindle_metadata?.lumi_rp_engine?.action ?? null) })),
      };
    });
  }

  for (const key of ["agents", "harness"]) {
    const chatId = chats[key];
    if (chatId) await item(`6 review cards ${key}`, () => ctx.socket.lre("lre.review", { chatId, op: "get" }));
  }
  for (const key of ["classic", "harness"]) {
    const chatId = chats[key];
    if (chatId) await item(`9 assistant ${key}`, async () => {
      const view = await ctx.socket.lre<{ thread: { id: string; role: string; status?: string }[] }>("lre.assistant", { chatId, op: "get" });
      return view.thread.map((m) => ({ id: m.id, role: m.role, status: m.status ?? null }));
    });
  }

  await item("8 mind files and notebook (harness)", async () => {
    const area = await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId: chats.harness, area: "chat" });
    return (area.files ?? []).map((f) => f.path).filter((p) => p.startsWith("minds/") || p.startsWith("author/"));
  });
  await item("8 cast (harness)", () => ctx.socket.lre("lre.story", { chatId: chats.harness, op: "cast" }));

  await item("10 own definitions, texts, guidance", async () => {
    const defs = await ctx.socket.lah<{ agents: { id: string }[]; skills: { id: string }[] }>("lah.defs.get", {});
    const hello = await ctx.socket.lah<{ texts: { own: { [id: string]: string } } }>("lah.hello", {});
    const settings = await ctx.socket.lre<{ settings: { prompts: { texts: { [id: string]: string } } } }>("lre.settings.get");
    const guidance = await ctx.socket.lah<{ levels: { id: string; hash: string | null; text: string }[] }>("lah.guidance.get", { chatId: null });
    return { agent: defs.agents.some((a) => a.id === "tide_reader"), skill: defs.skills.some((s) => s.id === "harbor_round"), harnessTexts: Object.keys(hello.texts.own), engineTexts: settings.settings.prompts.texts, guidance: guidance.levels.find((l) => l.id === "user")?.hash ?? null };
  });

  await item("11 model choices", async () => {
    const { settings } = await ctx.socket.lre<{ settings: { helper: { connectionId: string | null }; agents: { main: { connectionId: string | null }; assistant: { connectionId: string | null } } } }>("lre.settings.get");
    return { helper: settings.helper.connectionId, main: settings.agents.main.connectionId, assistant: settings.agents.assistant.connectionId };
  });

  await item("13 MCP check-in", async () => {
    const view = await ctx.socket.lre<{ view?: { clients: { id: string; name: string; harness: string | null; host: string | null; seen: number }[] } }>("lre.agents", { op: "get" });
    return view.view?.clients.filter((c) => c.id === id("checkin")) ?? [];
  });

  await item("14 deleted chat's run data (disk)", async () => {
    const deleted = id("chat:deleted");
    if (deleted === undefined) return null;
    const runs = join(userStorage(ctx.env, ctx.userId), "runs", deleted);
    let gone = false;
    try {
      await ctx.host.chat(deleted);
    } catch {
      gone = true;
    }
    return { chatId: deleted, goneFromLumiverse: gone, files: existsSync(runs) ? readdirSync(runs) : [] };
  });

  await item("15 hand-placed file (disk)", async () => {
    const path = join(userStorage(ctx.env, ctx.userId), UNNAMED_FILE);
    return { path, exists: existsSync(path) };
  });

  writeFileSync(join(ctx.env.instanceDir, "report.json"), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(out, null, 1));
} finally {
  ctx.socket.close();
}
