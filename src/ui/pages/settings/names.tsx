// A setting by the name the Settings page gives it, for the pages that speak of one in a sentence or a label: the name, the unit and what no
// value means come from the settings route, read once for the page's client; the value in force never does (a page that shows one reads it).

import { useEffect, useState } from "preact/hooks";
import type { SettingView } from "../../../shared/api";
import { useApp } from "../../app";
import type { RpeClient } from "../../client";

const held = new WeakMap<object, Promise<ReadonlyMap<string, SettingView>>>();

/** The settings by key, read once for `client`; read again if the read failed. */
function settingsByKey(client: Pick<RpeClient, "call">): Promise<ReadonlyMap<string, SettingView>> {
  const kept = held.get(client);
  if (kept !== undefined) return kept;
  const read = client.call("GET /api/v1/settings", {}).then(
    (reply) => new Map(reply.settings.map((s) => [s.key, s] as const)),
    (error: unknown) => {
      held.delete(client);
      throw error;
    },
  );
  held.set(client, read);
  return read;
}

/** The setting `key` as the Settings page declares it; undefined until it is read, and where no setting has the key. */
export function useSettingView(key: string): SettingView | undefined {
  const app = useApp();
  const [view, setView] = useState<SettingView | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    settingsByKey(app.client).then(
      (all) => {
        if (alive) setView(all.get(key));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return view;
}

/** Every setting as the Settings page declares it, by key; null until it is read: for a page that draws its lines from plain props and so names several settings at once. */
export function useSettingMap(): ReadonlyMap<string, SettingView> | null {
  const app = useApp();
  const [all, setAll] = useState<ReadonlyMap<string, SettingView> | null>(null);
  useEffect(() => {
    let alive = true;
    settingsByKey(app.client).then(
      (read) => {
        if (alive) setAll(read);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return all;
}

/** The setting's own name, as the Settings page says it (its key, small, as the tooltip), in a sentence or a label. */
export function SettingName(props: { settingKey: string }) {
  const view = useSettingView(props.settingKey);
  return view === undefined ? <>the setting</> : <span title={props.settingKey}>{view.name}</span>;
}
