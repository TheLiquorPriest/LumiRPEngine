// RPE's own web searcher (plan §6.8 `web_search`, §16; R-71, R-125): a search provider he sets on the Connections page, its address and
// its key kept together in the secrets file (part `web`), the key sent to that address alone (R-53: a key follows the address it was
// given for, so an address set anew takes no key but one given with it). Off until he sets one: RPH's `web_search` then answers that it
// is off, and nothing leaves the machine. A search asks `<address>?q=<words>&limit=<n>` and reads a JSON list of `{ url, title,
// snippet }` (or one under `results`), as RPH's folder host does; no redirect is followed, and the provider's answer is waited for as
// long as `web.timeout` says.

import type { SearchHit, WebSearchPort } from "rp-harness/contract";
import { type App, route, RouteError, shape } from "../app";
import type { ConfigRead } from "../app/config-read";
import { isRecord, type JsonValue } from "../shared/json";

/** The secrets file's part the provider is kept in. */
export const WEB_PART = "web";

const GLOBAL = ["shipped", "global"] as const;

export const WEB_SETTING_DEFS = {
  hits: { key: "web.hits", default: 10, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Web search hits", about: "The hits a web search gives when the agent names no number.", effect: "use" },
  timeout: { key: "web.timeout", default: 30, takes: { type: "number", least: 1 }, levels: GLOBAL, perConnection: false, name: "Web search wait", about: "Seconds a web search waits for the provider's answer before it says the search failed.", effect: "use" },
} as const;

/** The provider as the secrets file keeps it: its address, and the key given for that address, if any. */
interface WebProvider {
  address: string;
  key: string | null;
}

function providerOf(value: JsonValue | null): WebProvider | null {
  if (!isRecord(value) || typeof value.address !== "string" || value.address.trim() === "") return null;
  return { address: value.address, key: typeof value.key === "string" && value.key !== "" ? value.key : null };
}

export interface WebDeps {
  secrets: App["secrets"];
  /** The levels every chat shares, read at each search. */
  config(): ConfigRead;
}

export function webSearcher(deps: WebDeps): WebSearchPort {
  const provider = async (): Promise<WebProvider | null> => providerOf(await deps.secrets.read(WEB_PART));
  return {
    enabled: async () => (await provider()) !== null,
    async search(_scope, query) {
      const set = await provider();
      if (set === null) return [];
      const config = deps.config();
      const limit = query.limit ?? (config.value(WEB_SETTING_DEFS.hits) as number);
      const url = new URL(set.address);
      url.searchParams.set("q", query.text);
      url.searchParams.set("limit", String(limit));
      const headers: Record<string, string> = { accept: "application/json", ...(set.key !== null ? { authorization: `Bearer ${set.key}` } : {}) };
      const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout((config.value(WEB_SETTING_DEFS.timeout) as number) * 1000) });
      if (!response.ok) throw new Error(`The web search answered ${response.status}.`);
      const body: unknown = await response.json();
      const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.results) ? body.results : [];
      return list.slice(0, limit).flatMap((r): SearchHit[] => (isRecord(r) && typeof r.url === "string" ? [{ ref: r.url, title: typeof r.title === "string" ? r.title : r.url, snippet: typeof r.snippet === "string" ? r.snippet : "", how: "words" }] : []));
    },
  };
}

const T = shape.text();
const webShown = shape.named("WebProviderShown", "The web search provider he set, as the Connections page shows it: its address (null: none, so web_search is off) and whether a key is kept for it; never the key.", shape.object({ address: shape.nullable(T), key: shape.yesNo() }));
const webSet = shape.named(
  "WebProviderSet",
  "The web search provider he sets: its address (null takes it away and web_search is off), and a key for it (left out: the kept key stays only if the address is the same; null: no key).",
  shape.object({ address: shape.nullable(T), key: shape.optional(shape.nullable(T)) }),
);

/** The Connections page's routes of the web search provider: read it (never its key), and set or take it away (his own press). */
export function webRoutes(secrets: App["secrets"]) {
  const shown = (set: WebProvider | null) => ({ address: set?.address ?? null, key: set?.key !== null && set?.key !== undefined });
  return [
    route({
      method: "GET",
      path: "/api/v1/connections/web",
      access: "page",
      group: "connections",
      does: "The web search provider web_search asks: its address, and whether a key is kept for it.",
      reply: webShown,
      handle: async () => shown(providerOf(await secrets.read(WEB_PART))),
    }),
    route({
      method: "PUT",
      path: "/api/v1/connections/web",
      access: "page",
      group: "connections",
      does: "Sets the web search provider web_search asks, or takes it away; a key follows the address it was given for.",
      body: webSet,
      reply: webShown,
      handle: async ({ body }) => {
        if (body.address === null || body.address.trim() === "") {
          await secrets.write(WEB_PART, null);
          return shown(null);
        }
        let url: URL;
        try {
          url = new URL(body.address.trim());
        } catch {
          throw new RouteError(400, `${body.address} is not an address.`);
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new RouteError(400, `A web search provider is asked over http or https, not ${url.protocol}.`);
        const was = providerOf(await secrets.read(WEB_PART));
        const address = url.toString();
        const key = body.key === undefined ? (was?.address === address ? was.key : null) : body.key === null || body.key === "" ? null : body.key;
        const set: WebProvider = { address, key };
        await secrets.write(WEB_PART, { address, key });
        return shown(set);
      },
    }),
  ] as const;
}
