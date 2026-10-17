// Performance gate (DESIGN §18.5): main-process prompt assembly cost on a large world chat with the extension
// on versus off, on a dev host. Imports a 1,000-message chat attached to an existing world (its
// ChatRun and engine book in the chat metadata, as `lre.world attach` writes them), times dry runs
// with the extension enabled, disabled and re-enabled, then deletes the chat. No model calls.
// Usage: bun scripts/perf/assembly.ts <worldId> [messages]
// Host settings come from the environment (scripts/host/lib.ts), plus LRE_OWNER_ID (the world's
// owner), LRE_CHARACTER_ID (the character the chat is imported under) and, optionally,
// LRE_EVIDENCE_DIR (where the JSON report is written).

import { readFileSync, writeFileSync } from "node:fs";
import { api, dataDir, env, IDENTIFIER, signIn } from "../host/lib";

const OWNER = env("LRE_OWNER_ID");
const CHARACTER = env("LRE_CHARACTER_ID");
const EVIDENCE = process.env.LRE_EVIDENCE_DIR;
const worldId = process.argv[2];
const count = Number(process.argv[3] ?? 1000);
if (!worldId) throw new Error("usage: assembly.ts <worldId> [messages]");

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
};

const index = JSON.parse(readFileSync(`${dataDir()}/users/${OWNER}/extensions/${IDENTIFIER}/worlds/${worldId}/index.json`, "utf8")) as { head: string; loreBookId: string | null };
await signIn();
const list = await api("GET", "/api/v1/spindle");
const ext = (list.data as { extensions?: { id: string; identifier: string }[] }).extensions?.find((e) => e.identifier === IDENTIFIER);
if (!ext) throw new Error(`${IDENTIFIER} is not installed`);

const LINE = "You wipe down the counter while the coffee machine hisses; outside, the street slowly fills with the morning commute and somebody's dog barks twice.";
const messages = Array.from({ length: count }, (_, i) => ({ is_user: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", content: i % 2 === 1 ? `I keep working (${i}).` : `${LINE} (${i})`, send_date: 1792190000 + i }));
const imported = await api("POST", "/api/v1/chats/import", {
  character_id: CHARACTER,
  chat: { name: `LRE assembly bench ${count}`, metadata: { lumi_rp_engine: { v: 1, worldId, revision: index.head, runSeed: "bench-assembly", startedAt: 0 }, chat_world_book_ids: index.loreBookId ? [index.loreBookId] : [] } },
  messages,
});
const chatId = (imported.data as { chat_id?: string }).chat_id;
if (imported.status !== 201 || !chatId) throw new Error(`import failed: ${imported.status} ${JSON.stringify(imported.data)}`);

const sample = async (): Promise<number[]> => {
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await api("POST", "/api/v1/generate/dry-run", { chat_id: chatId });
    if (r.status !== 200) throw new Error(`dry run ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    xs.push(r.ms);
  }
  return xs.slice(3);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let report: Record<string, unknown> = {};
try {
  const enabled = await sample();
  await api("POST", `/api/v1/spindle/${ext.id}/disable`);
  await pause(1500);
  const disabled = await sample();
  await api("POST", `/api/v1/spindle/${ext.id}/enable`);
  await pause(3000);
  const reenabled = await sample();
  report = {
    at: new Date().toISOString(),
    messages: count,
    enabledMedianMs: Math.round(median(enabled)),
    enabledP95Ms: Math.round(p95(enabled)),
    disabledMedianMs: Math.round(median(disabled)),
    disabledP95Ms: Math.round(p95(disabled)),
    reenabledMedianMs: Math.round(median(reenabled)),
    overheadMedianMs: Math.round(median(enabled) - median(disabled)),
  };
} finally {
  await api("POST", `/api/v1/spindle/${ext.id}/enable`);
  await api("DELETE", `/api/v1/chats/${chatId}`);
}
console.log(JSON.stringify(report, null, 1));
if (EVIDENCE) writeFileSync(`${EVIDENCE}/assembly-${Date.now()}.json`, JSON.stringify(report, null, 2));
