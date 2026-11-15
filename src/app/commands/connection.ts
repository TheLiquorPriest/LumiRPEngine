// `rpe connection`: the model connections, through the running server's API.

import type { ConnectionInput, Effort } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { insertPageToken, NO_OWNER, secretHash } from "../auth";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import type { ConnectionShown, ConnectionsShown } from "../connections";
import { type Flags, UsageError } from "./args";
import { commandLineDatabase } from "./database";
import { serverUrl } from "./running";

type Api = (method: string, path: string, body?: unknown) => Promise<Response>;

/** Calls the running server's API as the user this RPE belongs to, with a token the command line makes for itself and lets go after. */
export async function withServer<T>(paths: DataPaths, config: AppConfig, io: CliIO, version: string, call: (api: Api) => Promise<T>): Promise<T> {
  const owner = config.lumiverse.user;
  if (owner === null) throw new Error(NO_OWNER);
  const db = commandLineDatabase(paths, config, version, io.now);
  const token = db.transaction(() => insertPageToken(db, owner, "command line", config.auth.commandLineSeconds * 1000, io.now())).immediate();
  const url = serverUrl(config);
  try {
    return await call(async (method, path, body) => {
      try {
        return await io.fetch(`${url}${path}`, {
          method,
          headers: { authorization: `Bearer ${token.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(config.commandLine.waitMs),
        });
      } catch {
        throw new Error(`RPE is not answering at ${url}: start it with \`rpe serve\`.`);
      }
    });
  } finally {
    db.run("DELETE FROM page_token WHERE hash = ?", [secretHash(token.token)]);
    db.close();
  }
}

/** The server's answer, or its refusal as an error in its own words. */
export async function replyOf<T>(res: Response): Promise<T> {
  if (res.status === 404) throw new Error("This RPE does not offer connections yet: the model layer is not mounted in it.");
  const text = await res.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  if (!res.ok) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `RPE answered ${res.status}.`);
  return body as T;
}

function tokenCount(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`--${flag} is a whole number of tokens.`);
  return Number(value);
}

export async function connectionCommand(words: readonly string[], flags: Flags, paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const sub = words[0];
  if (sub === "list" && words.length === 1) {
    const list = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionsShown>(await api("GET", "/api/v1/connections")));
    if (list.connections.length === 0) io.out("No connections yet: add one with `rpe connection add`.");
    for (const c of list.connections) {
      const key = c.key === null ? "signs with no key" : c.key.set ? "key set" : "no key set";
      io.out(`${c.default ? "*" : " "} ${c.name} (${c.id}): ${c.provider}${c.model === undefined ? "" : `, ${c.model}`}${c.effort === undefined ? "" : `, effort ${c.effort}`}, ${key}`);
    }
    return 0;
  }
  if (sub === "add" && words.length === 1) {
    const { name, provider, model } = flags;
    if (name === undefined || provider === undefined) throw new UsageError("rpe connection add needs --name and --provider.");
    const auth = flags.auth ?? "key";
    if (auth !== "key" && auth !== "signin" && auth !== "none") throw new UsageError("--auth is key, signin or none.");
    const contextWindow = tokenCount(flags["context-window"], "context-window");
    const maxTokens = tokenCount(flags["max-tokens"], "max-tokens");
    const limited = contextWindow !== undefined || maxTokens !== undefined;
    if (limited && model === undefined) throw new UsageError("Limits are a model's: give --model with them.");
    const connection: ConnectionInput = {
      name,
      provider,
      auth,
      ...(model === undefined ? {} : { model }),
      // The model layer checks the effort, as it checks every field of a connection.
      ...(flags.effort === undefined ? {} : { effort: flags.effort as Effort }),
      ...(flags["base-url"] === undefined ? {} : { baseUrl: flags["base-url"] }),
      ...(limited && model !== undefined ? { limits: { [model]: { ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxTokens === undefined ? {} : { maxTokens }) } } } : {}),
    };
    let key: string | null = null;
    if (auth === "key") {
      key = (await io.secret(`The key for ${name} (it is not shown): `))?.trim() ?? null;
      if (key === null || key === "") throw new Error("A connection that signs with a key needs one.");
    }
    const saved = await withServer(paths, config, io, version, async (api) => replyOf<ConnectionShown>(await api("POST", "/api/v1/connections", { connection, ...(key === null ? {} : { key }) })));
    io.out(`Added ${saved.name} (${saved.id}).`);
    return 0;
  }
  if (sub === "remove" && words.length === 2) {
    const which = words[1] ?? "";
    const removed = await withServer(paths, config, io, version, async (api) => {
      const list = await replyOf<ConnectionsShown>(await api("GET", "/api/v1/connections"));
      const matches = list.connections.filter((c) => c.id === which || c.name === which);
      const chosen = matches[0];
      if (chosen === undefined) throw new Error(`No connection is called "${which}".`);
      if (matches.length > 1) throw new Error(`More than one connection is called "${which}": give its id (${matches.map((c) => c.id).join(", ")}).`);
      await replyOf<undefined>(await api("DELETE", `/api/v1/connections/${encodeURIComponent(chosen.id)}`));
      return chosen;
    });
    io.out(`Removed ${removed.name} (${removed.id}).`);
    return 0;
  }
  throw new UsageError("rpe connection takes list, add or remove <name or id>.");
}
