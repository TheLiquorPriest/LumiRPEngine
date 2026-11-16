// Which model each kind of work uses (STANDALONE-PLAN §15.2, "Which model each kind of work uses"): every place today's
// build names a connection (a setting of the engine's `settings.json`, of LumiAH's settings, or an agent definition of
// his own) is found, whatever the key is called, and each is matched with a connection RPE holds: the one of the same
// id (the runtime's connections are carried under their own ids), or, where the name is a connection of Lumiverse's,
// the one of the same provider, model and address. A choice that finds one is carried to it (his own agents' headers
// name it); the rest are listed, and that work uses RPE's default connection until he picks. Nothing here changes
// today's data or RPE's: it only reads, and says.

import type { ProfileRow } from "../adapter/lumiverse/migration-reads";
import { isRecord } from "../shared/json";
import { IMPORTED_AGENTS } from "./own-files";
import { lumiahOwn } from "./settings";

/** Where RPE keeps the work a choice is for: his own agent's attached file, whose header's `model:` takes a connection of RPE's; or none, RPE having no setting of the same meaning (the old engines' helper and story models, LumiAH's built-in agents, a connection's throttle), where the choice is listed only. */
export type ModelPlace = { agent: string; path: string } | null;

/** The place of his own agent `id`: its attached file below the user's level. */
const agentPlace = (id: string): ModelPlace => ({ agent: id, path: `${IMPORTED_AGENTS}/${id}.md` });

/** A place that names a connection: where it is, the connection's id as named, the model named beside it, and RPE's place for that work. */
export interface Named {
  where: string;
  connection: string;
  model: string | null;
  to: ModelPlace;
}

/** A connection RPE holds, as much of it as says what it is. */
export interface RpeConnection {
  id: string;
  name: string;
  provider: string;
  model?: string;
  baseUrl?: string;
}

/** A choice with what became of it: the connection of RPE's it is carried to and how that was found, or why none was. */
export interface ModelChoice extends Named {
  carried: { id: string; name: string; how: "same id" | "same provider, model and address" } | null;
  why: string | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** Every connection a settings document names, by the dotted path of its key (`connectionId` beside a `model`, and a connection's id as a key of a table of connections). */
function walk(value: unknown, at: string, prefix: string, out: Named[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${at}.${i}`, prefix, out));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, v] of Object.entries(value)) {
    const path = at === "" ? key : `${at}.${key}`;
    if (key === "connectionId" && text(v) !== null) out.push({ where: `${prefix}${path}`, connection: v as string, model: text(value.model), to: null });
    else if (path === "core.connections.throttles" && isRecord(v)) for (const id of Object.keys(v)) out.push({ where: `${prefix}${path}.${id}`, connection: id, model: null, to: null });
    else walk(v, path, prefix, out);
  }
}

/**
 * Every place today's settings and definitions name a connection: the engine's `settings.json`, LumiAH's settings as he set them
 * (`harness/settings.json`, the agents' own among them) and the agent definitions of his own in it.
 */
export function findChoices(engine: unknown, harness: unknown): Named[] {
  const out: Named[] = [];
  const defs = isRecord(harness) && isRecord(harness.definitions) && isRecord(harness.definitions.agents) ? harness.definitions.agents : {};
  walk(engine, "", "settings.json: ", out);
  walk(lumiahOwn(harness), "", "harness/settings.json: ", out);
  // An agent of his own takes its model where its header says it; what he set for it in LumiAH's settings stands over its definition's, so it is that place too.
  for (const c of out) {
    const id = /^harness\/settings\.json: core\.agents\.([^.]+)\.connectionId$/.exec(c.where)?.[1];
    if (id !== undefined && Object.hasOwn(defs, id)) c.to = agentPlace(id);
  }
  for (const [id, def] of Object.entries(defs)) if (isRecord(def) && text(def.connectionId) !== null) out.push({ where: `agent ${id} of his own`, connection: def.connectionId as string, model: text(def.model), to: agentPlace(id) });
  return out;
}

/** An address, as its origin and path without a trailing slash; null where there is none or it does not read. */
function addressOf(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** The connections of RPE's that are of this provider and model, and, where both name an address, the same one. */
function samePlace(rpe: readonly RpeConnection[], provider: string, model: string, url: string | undefined): RpeConnection[] {
  const address = addressOf(url);
  return rpe
    .filter((c) => c.provider === provider && c.model === model && (address === null ? addressOf(c.baseUrl) === null : addressOf(c.baseUrl) === address))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One place matched with RPE's connections. */
export type Matcher = (named: Named) => ModelChoice;

/**
 * Matches a place with a connection of RPE's. One that names a connection RPE holds under that id is carried to it, unless it names a
 * model that connection is not on and RPE holds another of the same provider and address on that model; otherwise a connection of
 * Lumiverse's, found by id, is carried to the connection RPE holds for the same provider, model (the choice's own, else the connection's)
 * and address.
 */
export function matcherOf(profiles: readonly ProfileRow[], rpe: readonly RpeConnection[]): Matcher {
  return (n) => {
    const held = rpe.find((c) => c.id === n.connection);
    const profile = profiles.find((p) => p.id === n.connection);
    const asked = (c: RpeConnection, how: "same id" | "same provider, model and address"): ModelChoice => ({ ...n, carried: { id: c.id, name: c.name, how }, why: null });
    if (held !== undefined) {
      if (n.model === null || held.model === n.model) return asked(held, "same id");
      const other = samePlace(rpe, held.provider, n.model, held.baseUrl)[0];
      return other !== undefined ? asked(other, "same provider, model and address") : { ...n, carried: null, why: `it asks for the model ${n.model}, and RPE's connection ${held.name} is on ${held.model ?? "its own model"}; RPE has none of that provider and address on it` };
    }
    if (profile === undefined) return { ...n, carried: null, why: "it names a connection that neither RPE nor Lumiverse holds" };
    const model = n.model ?? profile.model;
    const same = samePlace(rpe, profile.provider === "custom" ? "openai-compatible" : profile.provider, model, profile.url)[0];
    return same !== undefined ? asked(same, "same provider, model and address") : { ...n, carried: null, why: `RPE has no connection for ${profile.provider}${model === "" ? "" : ` and ${model}`} (${profile.name} in Lumiverse)` };
  };
}

/** The connections of RPE's document as the models port gives it, as much of each as says what it is: what is not a connection is left out. */
export function connectionsOf(doc: unknown): RpeConnection[] {
  const list = isRecord(doc) && Array.isArray(doc.connections) ? doc.connections : [];
  return list.flatMap((c: unknown) => {
    if (!isRecord(c) || text(c.id) === null || text(c.provider) === null) return [];
    return [{ id: c.id as string, name: text(c.name) ?? (c.id as string), provider: c.provider as string, ...(text(c.model) !== null ? { model: c.model as string } : {}), ...(text(c.baseUrl) !== null ? { baseUrl: c.baseUrl as string } : {}) }];
  });
}
