// The MCP servers that follow LumiRPEngine (DESIGN §23): the update notice at the top of the drawer
// and Settings → MCP server. Each server's line comes from its check-ins (pushed as servers check
// in, so a line turns as soon as one reloads); Update now asks one to reload. A server Lumiverse
// runs itself checks in like any other: this page calls none of Lumiverse's own routes, which are
// Lumiverse's rather than Spindle's, and a command set through them would run outside Spindle's sandbox.

import { useEffect } from "preact/hooks";
import type { AgentsView } from "../shared/agents";
import { useApp } from "./app";
import type { App } from "./app";
import { serverLine } from "./agents-view";
import { Banner, Button, Empty, List, ListRow, Section } from "./components";
import { useSelect } from "./store";

function copy(app: App, text: string): void {
  void navigator.clipboard.writeText(text).then(
    () => app.toast("Copied"),
    () => app.toast("The clipboard refused the copy", "error"),
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
            <span class="lre-field-help">{`Give your agent's harness this command for its lumirpengine server (claude mcp add lumirpengine -- ${view.setup.command}). It runs this extension's own copy, on the machine Lumiverse runs on, and takes each update's tools by itself. Sign in once first: node ${view.setup.core} login --url <your Lumiverse>. For Lumiverse itself to run it (its Settings → MCP Servers), add a Stdio server with the command node and the arguments ${view.setup.core}, mcp.`}</span>
            <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(app, view.setup?.command ?? "")}>
              Copy
            </Button>
          </div>
        )}
      </Section>
      <Section title={`Your MCP servers (this is build ${view.build})`} flush>
        <Servers view={view} forget />
      </Section>
    </div>
  );
}
