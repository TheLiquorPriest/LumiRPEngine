// Loads a chat bundle made by `long-chat.ts bundle` into a Lumiverse instance as the previous build left its chats: the chat's rows
// in Lumiverse's database (a narrator, the chat, every message with its swipes and the engine's records on them) and the extension's
// files in the user's storage (the world's revisions, the chat's journal). It imports nothing of this repository, so it runs on a
// server that has only Bun. Everything in the bundle is invented. It refuses a chat that is already there.
// Usage: bun bigchat-load.ts <bundle folder> --lumiverse <Lumiverse's data folder> --user <user id> [--extension lumi_rp_engine]

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface Bundle {
  character: { id: string; name: string; first_mes: string };
  chat: { id: string; name: string; metadata: string };
  messages: { id: string; index_in_chat: number; is_user: number; name: string; content: string; send_date: number; swipe_id: number; swipes: string; swipe_dates: string; extra: string }[];
  files: Record<string, string>;
}

interface WorldBundle {
  id: string;
  base: Record<string, unknown> & { lore: Record<string, unknown> };
  edits: { revision: string; edit: Record<string, unknown> | null }[];
  index: unknown;
  history: unknown;
}

const unzip = (file: string): unknown => JSON.parse(new TextDecoder().decode(Bun.gunzipSync(readFileSync(file))));

export async function loadBundle(folder: string, lumiverse: string, user: string, extension = "lumi_rp_engine"): Promise<{ chat: string; messages: number; revisions: number }> {
  const bundle = unzip(join(folder, "chat.json.gz")) as Bundle;
  const world = unzip(join(folder, "world.json.gz")) as WorldBundle;
  const storage = join(lumiverse, "users", user, "extensions", extension);
  if (!existsSync(join(lumiverse, "lumiverse.db"))) throw new Error(`No lumiverse.db in ${lumiverse}.`);
  const db = new Database(join(lumiverse, "lumiverse.db"));
  try {
    db.run("PRAGMA busy_timeout = 10000");
    if (db.query("SELECT 1 FROM chats WHERE id = ?").get(bundle.chat.id) !== null) throw new Error(`Chat ${bundle.chat.id} is already in ${lumiverse}.`);
    const now = Math.floor(Date.now() / 1000);
    // A row is written with the columns this Lumiverse's table has.
    const inserter = (table: string, names: readonly string[]) => {
      const have = new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      const kept = names.filter((n) => have.has(n));
      const query = db.query(`INSERT INTO ${table} (${kept.join(", ")}) VALUES (${kept.map(() => "?").join(", ")})`);
      return (row: Record<string, string | number>): void => {
        query.run(...kept.map((n) => row[n] ?? null));
      };
    };
    db.transaction(() => {
      if (db.query("SELECT 1 FROM characters WHERE id = ?").get(bundle.character.id) === null) inserter("characters", ["id", "name", "first_mes", "user_id", "created_at", "updated_at"])({ ...bundle.character, user_id: user, created_at: now, updated_at: now });
      inserter("chats", ["id", "character_id", "name", "metadata", "created_at", "updated_at", "user_id"])({ ...bundle.chat, character_id: bundle.character.id, created_at: now, updated_at: now, user_id: user });
      const message = inserter("messages", ["id", "chat_id", "index_in_chat", "is_user", "name", "content", "send_date", "swipe_id", "swipes", "extra", "created_at", "swipe_dates"]);
      for (const m of bundle.messages) message({ ...m, chat_id: bundle.chat.id, created_at: m.send_date });
    })();
  } finally {
    db.close();
  }
  const put = async (path: string, text: string): Promise<void> => {
    const file = join(storage, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  // Each revision is the base with its own edit, as the world's Build left it.
  for (const { revision, edit } of world.edits) await put(`worlds/${world.id}/rev/${revision}.json`, JSON.stringify(edit === null ? world.base : { ...world.base, lore: { ...world.base.lore, "pad-edit": edit } }));
  await put(`worlds/${world.id}/index.json`, JSON.stringify(world.index));
  await put(`worlds/${world.id}/history.json`, JSON.stringify(world.history));
  for (const [path, text] of Object.entries(bundle.files)) await put(path, text);
  return { chat: bundle.chat.id, messages: bundle.messages.length, revisions: world.edits.length };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { lumiverse: { type: "string" }, user: { type: "string" }, extension: { type: "string" } } });
  const folder = positionals[0];
  if (folder === undefined || values.lumiverse === undefined || values.user === undefined) {
    console.error("Usage: bun bigchat-load.ts <bundle folder> --lumiverse <Lumiverse's data folder> --user <user id> [--extension lumi_rp_engine]");
    process.exit(2);
  }
  const loaded = await loadBundle(resolve(folder), resolve(values.lumiverse), values.user, values.extension);
  console.log(`Loaded chat ${loaded.chat}: ${loaded.messages} messages, a world of ${loaded.revisions} revisions. Carry it into RPE (stopped) with: rpe migrate --chat ${loaded.chat} --lumiverse ${resolve(values.lumiverse)} --user ${values.user}`);
}
