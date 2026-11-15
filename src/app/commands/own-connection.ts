// RPE's own connection in Lumiverse, as `rpe up` makes it.

import { newKeyText } from "../auth";
import type { AppConfig } from "../config";
import { type LumiverseCall, settleConnection, type SettledConnection } from "../../adapter/lumiverse/install-calls";
import { withWriter, type WriterContext } from "./writer";

/**
 * RPE's own connection in Lumiverse, made or brought into line at `apiUrl` (up.ts), its id kept first in
 * `lumiverse.connections`, what was done said. Its key is in force only once Lumiverse holds it, so a
 * refusal leaves the key before it working.
 */
export async function ownConnection(call: LumiverseCall, apiUrl: string, line: WriterContext, current: AppConfig): Promise<SettledConnection & { moved: boolean }> {
  // The config as the sign-in left it: it names the user the keys are made for.
  const ctx = { ...line, config: current };
  const { io } = ctx;
  const hadKey = (await withWriter(ctx, (ops) => ops.status())).keys.some((k) => k.kind === "provider");
  const fresh: { key: string | null } = { key: null };
  const known = current.lumiverse.connections[0] ?? null;
  const settled = await settleConnection(call, known, { apiUrl, models: current.lumiverse.models, hasKey: hadKey, makeKey: () => (fresh.key = newKeyText("provider")) });
  const key = fresh.key;
  const moved = settled.id !== known;
  if (key !== null || moved) {
    await withWriter(ctx, async (ops) => {
      if (key !== null) await ops.makeKey({ kind: "provider", key });
      if (moved) await ops.saveLumiverse({ set: { connections: [settled.id, ...current.lumiverse.connections.slice(1)] } });
    });
  }
  const named = `"${settled.name}" (${settled.id})`;
  if (settled.todays !== null) io.out(`The connection ${settled.todays} that RPE's config named is the one today's build made for its runtime: it is left as it is, for going back.`);
  if (settled.made) io.out(`Made RPE's connection in Lumiverse, ${named}: OpenAI-compatible, at ${apiUrl}, with a new provider key only it holds.`);
  else if (settled.changed.length > 0) io.out(`Brought RPE's connection in Lumiverse, ${named}, up to date: ${settled.changed.join(", ")}.`);
  else io.out(`RPE's connection in Lumiverse, ${named}, is already as it should be.`);
  if (settled.newKey && hadKey) io.out("A new provider key was made for it, and the one before it no longer works.");
  return { ...settled, moved };
}
