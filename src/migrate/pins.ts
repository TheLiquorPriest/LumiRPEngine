// His pins (STANDALONE-PLAN §15.2 "Pins", R-174): a file pinned in today's build for a definition
// (LumiAH's `FileEntry.pins` on a chat's notes and on his `~/` files; the agents engine's pin on a
// workspace file) is a pin in RPE: an entry of `stack.pins` in the chat's `RPE.yml`, or in `RPE-global.yml`
// for a global note, naming the carried file as that level's view names it and the agent it is pinned
// for, so that agent is handed the file whole at the start of each run. A pin for today's lead agent
// (`main`) is the Author's; a pin for a definition RPE has an agent of that name for is that agent's;
// a pin for one of his own definitions is kept under its name (the definition is carried switched off,
// so nobody is handed it until he switches it on), and a pin for a role RPE has no agent for is
// pinned for the Author; the last two are listed with that said. A later run puts what an earlier run
// put and removes it where today's side no longer pins it; a pin he took out in RPE is not put again.

import { mkdir, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { readText, writeWhole } from "../app/disk";
import { withKeyAt, yamlMapping } from "../app/yaml";
import { isRecord } from "../shared/json";
import type { PinWanted } from "./own-files";

/** The agent today's lead agent is in RPE. */
const LEAD = "author";

/** What a run did with the pins of today's build. */
export interface PinsCarried {
  /** Pins written, each in its level's `stack.pins`. */
  carried: number;
  /** Pins for a role RPE has no agent for, pinned for the Author: the file and the role it was pinned for in today's build. */
  forAuthor: { file: string; role: string }[];
  /** Pins for one of his own definitions, which is carried switched off: the file and the definition. */
  forOwn: { file: string; agent: string }[];
  /** Pins an earlier run put that he took out in RPE since: not put again. */
  takenOut: number;
  /** Pins an earlier run put that today's side no longer pins: taken out. */
  removed: number;
}

/** The identity a run keeps of a pin it put: its level's config, its file and its agent. */
const keyOf = (config: string, file: string, agent: string): string => `pin ${config}\u0000${file}\u0000${agent}`;

/** The agents RPE ships: the files of the shipped level's agents folder, by name. */
async function shippedAgents(dir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(dir)).flatMap((f) => (f.endsWith(".md") ? [f.slice(0, -3)] : [])));
  } catch {
    return new Set();
  }
}

/**
 * Writes the pins `wanted` into the configs they name. `globalConfig` is `RPE-global.yml`, where a pin with no config goes; `shipped` is
 * the folder of the shipped agents; `own` the ids of his own definitions; `earlier` what earlier runs put (`putPrints`). Answers what
 * was done and the prints of what it put now (`keepPutPrints`).
 */
export async function carryPins(input: { wanted: readonly PinWanted[]; globalConfig: string; shipped: string; own: ReadonlySet<string>; earlier: ReadonlyMap<string, string> }): Promise<{ carried: PinsCarried; put: Map<string, string> }> {
  const known = await shippedAgents(input.shipped);
  const agentFor = (role: string): { agent: string; how: "own" | "ships" | "own definition" | "none" } => {
    if (role === "main") return { agent: LEAD, how: "own" };
    if (known.has(role)) return { agent: role, how: "ships" };
    if (input.own.has(role)) return { agent: role, how: "own definition" };
    return { agent: LEAD, how: "none" };
  };
  const out: PinsCarried = { carried: 0, forAuthor: [], forOwn: [], takenOut: 0, removed: 0 };
  const put = new Map<string, string>();
  const byConfig = new Map<string, { file: string; agent: string; role: string; how: string }[]>();
  for (const p of input.wanted) {
    const { agent, how } = agentFor(p.role);
    const config = p.config ?? input.globalConfig;
    const list = byConfig.get(config) ?? [];
    if (!list.some((x) => x.file === p.file && x.agent === agent)) list.push({ file: p.file, agent, role: p.role, how });
    byConfig.set(config, list);
  }
  // A config an earlier run put pins in is looked at again, to take out what today's side no longer pins.
  for (const key of input.earlier.keys()) {
    const config = /^pin ([^\u0000]*)\u0000/.exec(key)?.[1];
    if (config !== undefined && !byConfig.has(config)) byConfig.set(config, []);
  }
  for (const [config, wanted] of byConfig) {
    const text = (await readText(config)) ?? "";
    const where = config;
    const stack = yamlMapping(text, where).stack;
    const held = isRecord(stack) ? stack.pins : undefined;
    const now = (Array.isArray(held) ? held : []).flatMap((p) => (isRecord(p) && typeof p.file === "string" && typeof p.agent === "string" ? [{ ...p, file: p.file, agent: p.agent }] : []));
    const wantedKeys = new Set(wanted.map((w) => keyOf(config, w.file, w.agent)));
    // What an earlier run put here and today's side no longer pins goes, where it still stands.
    const gone = new Set([...input.earlier.keys()].filter((k) => k.startsWith(`pin ${config}\u0000`) && !wantedKeys.has(k)));
    const kept = now.filter((p) => !gone.has(keyOf(config, p.file, p.agent)));
    out.removed += now.length - kept.length;
    const added: { file: string; agent: string }[] = [];
    for (const w of wanted) {
      const key = keyOf(config, w.file, w.agent);
      put.set(key, "1");
      if (kept.some((p) => p.file === w.file && p.agent === w.agent)) continue;
      if (input.earlier.has(key)) {
        out.takenOut++;
        continue;
      }
      added.push({ file: w.file, agent: w.agent });
      out.carried++;
      if (w.how === "none") out.forAuthor.push({ file: w.file, role: w.role });
      else if (w.how === "own definition") out.forOwn.push({ file: w.file, agent: w.agent });
    }
    if (added.length === 0 && kept.length === now.length) continue;
    const list = [...kept.map((p) => ({ file: p.file, agent: p.agent })), ...added];
    await mkdir(dirname(config), { recursive: true });
    await writeWhole(config, withKeyAt(text, ["stack", "pins"], list.length > 0 ? list : undefined, where));
  }
  return { carried: out, put };
}
