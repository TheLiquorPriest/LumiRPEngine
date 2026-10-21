// The MCP servers that follow LumiRPEngine (DESIGN §23): the update notice at the top of the drawer
// and Settings → MCP server. Each server's line comes from its last check-in (pushed as servers
// check in, so a line turns as soon as one reloads); Update now asks one to reload. The servers
// Lumiverse runs itself (Settings → MCP servers) are read from Lumiverse's own API, same-origin as
// this page, and can be restarted or switched to the extension's own copy from here.

import { useEffect, useState } from "preact/hooks";
import type { AgentsView } from "../shared/agents";
import { useApp } from "./app";
import type { App } from "./app";
import type { McpProfile, ProfileKind } from "./agents-view";
import { extensionArgs, lumirpengineProfiles, serverLine } from "./agents-view";
import { Banner, Button, Empty, List, ListRow, Section } from "./components";
import { useSelect } from "./store";

/** Lumiverse's MCP server routes (`/api/v1/mcp-servers`): the owner's or an admin's, with the page's own session. */
async function lumiverse<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> {
  const res = await fetch(new URL(`/api/v1/mcp-servers${path}`, location.origin), { method, credentials: "include", cache: "no-store", headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(res.status === 403 ? "Only Lumiverse's owner or an admin sees its MCP servers." : `Lumiverse answered ${res.status}.`);
  return (await res.json()) as T;
}

function copy(app: App, text: string): void {
  void navigator.clipboard.writeText(text).then(
    () => app.toast("Copied"),
    () => app.toast("The clipboard refused the copy", "error"),
  );
}

const KIND: Record<ProfileKind, string> = { extension: "runs the extension's own copy", npm: "runs an npm install of lumirpengine", npx: "runs lumirpengine with npx" };

/** The servers Lumiverse runs itself: Restart, and for an npm or npx copy, a switch to the extension's own. */
function LumiverseRun(props: { view: AgentsView }) {
  const app = useApp();
  const [found, setFound] = useState<{ profile: McpProfile; kind: ProfileKind }[] | string | null>(null);
  const core = props.view.setup?.core ?? null;
  const load = () =>
    void lumiverse<{ data: McpProfile[] }>("?limit=1000").then(
      (page) => setFound(lumirpengineProfiles(page.data, core)),
      (error: unknown) => setFound(error instanceof Error ? error.message : String(error)),
    );
  useEffect(load, [core]);
  if (found === null || (Array.isArray(found) && found.length === 0)) return null;
  if (typeof found === "string") return <p class="lre-field-help" data-lre-lumiverse-mcp="unreadable">{`Lumiverse's own MCP servers can't be read here: ${found}`}</p>;
  const restart = (id: string, name: string) =>
    lumiverse(`/${id}/reconnect`, "POST").then(
      () => app.toast(`${name} restarted`),
      (error: unknown) => app.toast(`${name} didn't restart: ${error instanceof Error ? error.message : String(error)}`, "error"),
    );
  return (
    <List>
      {found.map(({ profile, kind }) => (
        <div key={profile.id} data-lre-lumiverse-mcp={kind}>
          <ListRow icon="refresh" title={`Lumiverse's “${profile.name}”`} subtitle={`${KIND[kind]}${profile.is_enabled ? "" : " (switched off)"}`} />
          <div class="lre-row-actions">
            {profile.is_enabled ? (
              <Button size="sm" variant="secondary" onClick={() => void restart(profile.id, profile.name)}>
                Restart
              </Button>
            ) : null}
            {kind !== "extension" && core !== null ? (
              <Button size="sm" variant="ghost" onClick={() => void lumiverse(`/${profile.id}`, "PUT", { command: "node", args: extensionArgs(profile, core) }).then(() => restart(profile.id, profile.name).then(load), (error: unknown) => app.toast(`${profile.name} wasn't switched: ${error instanceof Error ? error.message : String(error)}`, "error"))}>
                Use the extension's copy
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </List>
  );
}

/** Each server's line, with Update now, the commands that fix it, and (in Settings) Forget. */
function Servers(props: { view: AgentsView; forget?: boolean }) {
  const app = useApp();
  if (props.view.clients.length === 0) return <Empty icon="info">No MCP server has checked in from this account yet.</Empty>;
  return (
    <List>
      {props.view.clients.map((client) => {
        const line = serverLine(client, props.view);
        return (
          <div key={client.id} data-lre-mcp-server={line.state}>
            <ListRow icon={line.state === "updated" ? "check" : "info"} title={<span class="lre-set-caveat">{line.text}</span>} subtitle={client.connected ? "Connected" : `Last seen ${new Date(client.seen).toLocaleString()}`} />
            <div class="lre-row-actions">
              {line.update ? (
                <Button size="sm" variant="primary" onClick={() => void app.request({ type: "lre.agents", op: "update", client: client.id }).then((r) => r && app.toast("Asked it to reload: its line turns once it has"))}>
                  Update now
                </Button>
              ) : null}
              {line.copy.map((c) => (
                <Button key={c.label} size="sm" variant="secondary" onClick={() => copy(app, c.text)}>
                  {c.label}
                </Button>
              ))}
              {props.forget ? (
                <Button size="sm" variant="ghost" onClick={() => void app.request({ type: "lre.agents", op: "forget", client: client.id }).then((r) => r?.view && app.agents.set(r.view))}>
                  Forget
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </List>
  );
}

/** The notice after an update, at the top of the drawer until dismissed. */
export function UpdateNotice() {
  const app = useApp();
  const view = useSelect(app.agents, (v) => v);
  if (view === null || view.notice === null) return null;
  return (
    <div class="lre-update-notice" data-lre-update-notice>
      <Banner
        tone="info"
        title="LumiRPEngine updated"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void app.request({ type: "lre.agents", op: "dismiss" }).then((r) => r?.view && app.agents.set(r.view))}>
            Dismiss
          </Button>
        }
      >
        <p>{`Now build ${view.notice.build} (it was ${view.notice.previous}). Your MCP servers:`}</p>
        <Servers view={view} />
        <LumiverseRun view={view} />
      </Banner>
    </div>
  );
}

/** Settings → MCP server: the setup that follows the extension, and each server as it stands. */
export function McpServerPage() {
  const app = useApp();
  const view = useSelect(app.agents, (v) => v);
  useEffect(() => {
    void app.request({ type: "lre.agents", op: "get" }).then((r) => r?.view && app.agents.set(r.view));
  }, []);
  if (view === null) return <Empty>Loading your MCP servers…</Empty>;
  return (
    <div class="lre-stack" data-lre-settings-page="mcp">
      <Section title="Set one up that follows LumiRPEngine">
        {view.setup === null ? (
          <Empty icon="info">This LumiRPEngine was built without an agent kit, so there is nothing to follow.</Empty>
        ) : (
          <div class="lre-field" data-lre-mcp-setup>
            <code class="lre-num">{view.setup.command}</code>
            <span class="lre-field-help">{`Give your agent's harness this command for its lumirpengine server (claude mcp add lumirpengine -- ${view.setup.command}). It runs this extension's own copy, on the machine Lumiverse runs on, and takes each update's tools by itself. Sign in once first: node ${view.setup.core} login --url <your Lumiverse>.`}</span>
            <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(app, view.setup?.command ?? "")}>
              Copy
            </Button>
          </div>
        )}
      </Section>
      <Section title={`Your MCP servers (this is build ${view.build})`} flush>
        <Servers view={view} forget />
      </Section>
      <LumiverseRun view={view} />
    </div>
  );
}
