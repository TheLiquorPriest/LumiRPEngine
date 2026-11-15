// The turn lane's own ports against their parts of RPH's contract kit: the prompt port, with each of the
// kit's prompts laid out as RPE lays out a request it receives (the tag's list of messages over the body,
// and Lumiverse's breakdown as the hint for names); the facts the lane counts; the harness's own state;
// and the trace, into the turn's folder in RPE's real tree. The kit has no part for the events port.

import { join } from "node:path";
import { runKitPart } from "rp-harness/testing/kit";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { LiveHub } from "../../src/app/live";
import { migrate, Migrations } from "../../src/app/migrations";
import { rawLayout } from "../../src/adapter/lumiverse/layout";
import type { LaidMessage } from "../../src/adapter/lumiverse/overlay";
import { type Tag, type TagMessage, textHash } from "../../src/adapter/lumiverse/wire";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore, STORE_MIGRATIONS } from "../../src/store";
import { FactsRegistry, HARNESS_MIGRATIONS, kvStore, PROMPT_MIGRATIONS, turnFacts, turnPrompts, turnTrace } from "../../src/turn";
import { textOf } from "../../src/turn/request";
import { layTree } from "../tree/fixtures";

/** RPE's database under `place`, with the turn lane's tables and the store's, and its write queue. */
function database(place: string) {
  const db = openDatabase(join(place, "rpe.db"), 2_000);
  const migrations = new Migrations();
  migrations.add("store", STORE_MIGRATIONS);
  migrations.add("prompt", PROMPT_MIGRATIONS);
  migrations.add("harness", HARNESS_MIGRATIONS);
  migrate(db, migrations, { version: "turn-kit", backups: join(place, "backups"), now: () => 0 });
  const writes = new WriteQueue(db, 50);
  return {
    db,
    writes,
    async close() {
      await writes.close();
      db.close();
    },
  };
}

runKitPart("RPE's prompt port", "prompt", async (seed, place) => {
  const { db, writes, close } = database(place);
  const prompts = turnPrompts(db, writes, () => 0);
  for (const [at, p] of seed.prompts.entries()) {
    // Each message as the interceptor listed it, and the body as Lumiverse sent it, nothing joined.
    const messages: TagMessage[] = p.messages.map((m) => {
      const text = textOf(m);
      return { role: m.role, length: text.length, hash: textHash(text), ...(m.kind === "history" ? { history: true as const } : {}), ...(m.kind === "lore" ? { lore: true as const } : {}), ...(m.source !== undefined ? { source: m.source } : {}) };
    });
    const tag: Tag = {
      v: 1,
      user: seed.scope.user,
      chat: seed.scope.chat,
      generation: `kit-generation-${at}`,
      kind: "new",
      target: { message: null, swipe: null },
      speaker: { id: null, name: null },
      connection: "kit-connection",
      preset: seed.preset.id,
      persona: null,
      cut: { answered: true, keep: null, removed: 0 },
      messages,
      lore: [],
    };
    const laid: LaidMessage[] = p.messages.map((m, i) => {
      const text = textOf(m);
      return { role: m.role, content: m.content, text, media: 0, places: [{ member: i, start: 0, end: text.length }] };
    });
    const layout = rawLayout(tag, laid, true, { from: "breakdown", presetId: seed.preset.id, presetName: seed.preset.name ?? null, blocks: p.blocks });
    await writes.run((d) => prompts.keep(d, { user: seed.scope.user, turn: p.turn, chat: seed.scope.chat, layout, lore: [], cut: tag.cut, summarized: [], at }));
  }
  return { prompt: prompts, close };
});

runKitPart("RPE's turn facts", "facts", async (_seed, place) => {
  const { db, close } = database(place);
  const facts = new FactsRegistry();
  // The kit's turns have no runs: what a turn recorded is counted whole, and none owes anything.
  facts.add(turnFacts(openStore({ db, registry: createRegistry(ALL_PACKS), worlds: () => undefined, fingerprint: "turn-kit" }), () => null, async () => undefined));
  return { facts, close };
});

runKitPart("RPE's harness state", "store", async (_seed, place) => {
  const { db, writes, close } = database(place);
  return { store: kvStore(db, writes), close };
});

runKitPart("RPE's trace", "trace", async (seed, place) => {
  const tree = await layTree(seed, place);
  const live = new LiveHub({ queueEvents: 100, now: () => 0 });
  const quiet = () => undefined;
  const trace = turnTrace({ live, files: tree.port, runStarted: quiet, log: { debug: quiet, info: quiet, warn: quiet, error: quiet } });
  return {
    trace,
    async close() {
      await trace.flush();
      await tree.close();
    },
  };
});
