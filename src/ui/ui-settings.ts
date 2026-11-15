// What the page reads of its own settings (the group declared in `src/shared/page-settings.ts`): how long
// it waits for RPE's addresses and the extension, when it renews its token, how it tries a closed socket
// again, how it follows a long request, and the page's own counts and ticks. RPE holds them: the
// extension hands the whole group with its start-up facts (the page cannot call RPE before it has a
// road), and once the page is connected it reads them from the settings route, again whenever a
// setting is saved. Until it has them a page uses the defaults, except for the start wait, which
// governs the wait for the very facts that carry the group: that one the browser keeps from the last
// time RPE gave it.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { PAGE_DEFAULTS, PAGE_KEY_PREFIX, PAGE_SETTING_DEFS, type PageSettings, pageSettingsOf } from "../shared/page-settings";
import type { RpeClient } from "./client";
import { createStore, type Readable, useSelect } from "./store";

/** Where the browser keeps the start wait RPE last gave this page. */
export const START_WAIT_KEY = "rpe:page-start-ms";

/** The page's settings, as the shell holds them. */
export interface UiSettings {
  readonly values: Readable<PageSettings>;
  /** Lumiverse's address as RPE holds it (an install fact the settings route lists), once read; null before, and where RPE holds none. */
  readonly lumiverse: Readable<string | null>;
  /** Takes the group as RPE gave it (a mapping from each setting's key to its value); nothing changes when there is none. */
  take(group: unknown): void;
  /** Reads the group from RPE's settings route through `client` now, and again each time the client reaches RPE and each time `reread` is asked; the returned function stops. */
  follow(client: Pick<RpeClient, "call" | "state">): () => void;
  /** Reads the group again, now: after a setting was saved. */
  reread(): void;
}

/** The browser's storage for this site, read through `open`; null where the browser refuses it (one that blocks site data throws on the very read) or has none. */
export function siteStorage(open: () => Storage | undefined): Storage | null {
  try {
    return open() ?? null;
  } catch {
    return null;
  }
}

/** The storage the page's settings are kept in: all it needs of the browser's. */
type Keeping = Pick<Storage, "getItem" | "setItem"> | null;

function keptStart(storage: Keeping): number {
  let kept: string | null = null;
  try {
    kept = storage?.getItem(START_WAIT_KEY) ?? null;
  } catch {
    kept = null;
  }
  return pageSettingsOf({ [PAGE_SETTING_DEFS.startMs.key]: kept === null ? null : Number(kept) }).startMs;
}

/** The page's settings over `storage`, which keeps the start wait between visits (null: kept for this page alone). */
export function createUiSettings(storage: Keeping): UiSettings {
  const store = createStore<PageSettings>({ ...PAGE_DEFAULTS, startMs: keptStart(storage) });
  const lumiverse = createStore<string | null>(null);
  let reader: (() => void) | null = null;
  const take = (group: unknown): void => {
    if (group === undefined || group === null) return;
    const next = pageSettingsOf(group);
    const now = store.get();
    if ((Object.keys(next) as (keyof PageSettings)[]).every((name) => next[name] === now[name])) return;
    store.set(next);
    if (next.startMs !== now.startMs) {
      try {
        storage?.setItem(START_WAIT_KEY, String(next.startMs));
      } catch {
        // Kept for this page only.
      }
    }
  };
  return {
    values: store,
    lumiverse,
    take,
    follow(client) {
      let asked = 0;
      const read = (): void => {
        const { phase } = client.state.get();
        if (phase !== "direct" && phase !== "relay") return;
        const mine = ++asked;
        client.call("GET /api/v1/settings", {}).then(
          (reply) => {
            if (mine !== asked) return;
            take(Object.fromEntries(reply.settings.filter((s) => s.key.startsWith(PAGE_KEY_PREFIX)).map((s) => [s.key, s.value])));
            const address = reply.facts.find((fact) => fact.key === "lumiverse.url")?.value;
            lumiverse.set(typeof address === "string" ? address : null);
          },
          // The settings stay as they were: the next time the page reaches RPE reads them again.
          () => undefined,
        );
      };
      reader = read;
      const off = client.state.subscribe(read);
      read();
      return () => {
        off();
        if (reader === read) reader = null;
        asked++;
      };
    },
    reread: () => reader?.(),
  };
}

/** What a shell gives its pages; outside one a page reads the defaults. */
export const UiSettingsContext = createContext<UiSettings>(createUiSettings(null));

export function useUiSettings(): UiSettings {
  return useContext(UiSettingsContext);
}

/** One of the page's settings by its name in `PageSettings`, read again when settings change. */
export function useUiSetting<K extends keyof PageSettings>(name: K): PageSettings[K] {
  return useSelect(useUiSettings().values, (values) => values[name]);
}
