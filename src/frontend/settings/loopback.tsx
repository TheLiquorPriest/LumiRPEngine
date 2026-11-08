// Settings → Loopback (DEPTH-PLAN §3.3, §3.4, §3.7, §3.11, §3.15), phone-first at 390 px, rows in the
// settings kit: what a world chat on the loopback needs. The one line that starts a relay for this
// server, its absolute paths filled in by the server, each with Copy; your loopback key, by its
// fingerprint, with Mint or Rotate, a new key shown once; each relay of yours (and the shared one):
// when it was last heard, where it listens, how it runs, its build, the scheduler and its session,
// with the line or button that fixes what is wrong (sign in again, update, Fix, Forget); the
// connections LumiRPEngine treats as the loopback, and how to make one, which Spindle can't (D0a
// check 6); the operator's shared relay (D-8); and how replies travel: the relay, since message
// sessions can't finish a reply LumiRPEngine composes (D0a check 8). `LoopbackBody` is hook-free,
// so tests press what it renders; `LoopbackSettingsPage` asks for the page and runs each press.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LOOPBACK_MODEL, relayBase, shellWord, type LoopbackPage, type LoopbackRelayView, type RelayReport, type SchedulerState } from "../../shared/loopback";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, HostSwitch, Section, useBusy } from "../components";
import { SettingRow } from "./kit";

/** What a press asks LumiRPEngine: the page again, a key minted or rotated, the shared relay allowed or not, a relay fixed or forgotten, or Test. */
export type LoopbackAct = { op: "get" } | { op: "mint" } | { op: "shared"; enabled: boolean } | { op: "fix"; relay: string } | { op: "forget"; relay: string } | { op: "test" };

const SCHEDULER_WORDS: Readonly<Record<SchedulerState, string>> = {
  excluded: "Kept out of your local-inference scheduler.",
  missing: "Missing from your local-inference scheduler's exclusions: a reply can wait behind itself there and never finish.",
  unavailable: "This Lumiverse has no local-inference scheduler setting, so there is nothing to keep it out of.",
  unknown: "Hasn't checked your local-inference scheduler yet.",
};

/** A moment in the page's words. */
function dateText(at: number | string): string {
  return new Date(at).toLocaleString();
}

/** How long ago, said shortly: "12 s ago", "3 min ago", "2 h ago", or the date. */
function agoText(ms: number, at: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `on ${dateText(at)}`;
}

/** How the relay runs, from what it said of itself. */
function runsText(report: RelayReport | null): string {
  const unit = report?.runtime.unit;
  if (!report) return "How it runs shows once it has said hello.";
  if (!unit) return "Runs in the foreground: it stops when its terminal closes.";
  return unit.scope === "system" ? `Runs as a system service, ${unit.name}: it survives logout and reboot.` : `Runs as a user service, ${unit.name}: it survives logout while lingering is on for its account.`;
}

/** What the relay's Lumiverse session is like. */
function sessionText(report: RelayReport, now: number): string {
  const { valid, expiresAt } = report.session;
  if (valid === false) return "Its Lumiverse session has ended.";
  if (valid === null || expiresAt === null) return "It couldn't ask Lumiverse about its session yet.";
  const left = Date.parse(expiresAt) - now;
  return left < 2 * 86_400_000 ? `Its Lumiverse session ends ${dateText(expiresAt)}; it renews daily while the relay runs.` : `Its Lumiverse session lasts until ${dateText(expiresAt)}, renewed daily while it runs.`;
}

/** A line to copy: what it is for, the line, Copy, and a word on it. */
function CopyLine(props: { id: string; label: string; text: string; help?: ComponentChildren; copy(text: string): void }) {
  return (
    <div class="lre-field lre-loopback-line" data-lre-loopback-copy={props.id}>
      <span class="label">{props.label}</span>
      <code class="lre-set-code">{props.text}</code>
      <Button size="sm" variant="secondary" icon="copy" label={`Copy: ${props.label}`} onClick={() => props.copy(props.text)}>
        Copy
      </Button>
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
    </div>
  );
}

/** The one line that starts a relay for this server, or what keeps the page from filling it in. */
function LineSection(props: { page: LoopbackPage; copy(text: string): void }) {
  const { line } = props.page;
  const missing = [
    ...(line.url === null ? ["This page couldn't tell the address you open Lumiverse at: put it after --url."] : []),
    ...(line.bun === null ? ["Lumiverse didn't say where its Bun is: use the path `command -v bun` prints for the account Lumiverse runs as."] : []),
    ...(line.script === null ? ["This LumiRPEngine was built without its command line (dist/lumirpengine.js), so there is no relay to start: install a build that has it."] : []),
  ];
  return (
    <Section title="Start the relay">
      <div class="lre-set-rows" data-lre-loopback-group="line">
        {line.command !== null && line.foreground !== null ? (
          <>
            <div class="lre-set-row">
              <CopyLine
                id="command"
                label="As a service"
                text={line.command}
                copy={props.copy}
                help={`Run it once in a terminal on the machine Lumiverse runs on. It runs as the account Lumiverse runs as${line.account !== null ? ` (${line.account}, by its sudo -u, from whichever account you paste it in)` : ""}, from / (--cwd /: Bun reads no bunfig.toml or .env from the directory you are in). It signs in as you, registers with LumiRPEngine, keeps its address out of your local-inference scheduler and installs a service for that account, which survives logout and reboot once lingering is on: it turns lingering on where the system lets it, or prints the line that does. Not with sudo alone: as root it would run files that account can change, so it refuses and says what to run instead.`}
              />
            </div>
            <div class="lre-set-row">
              <CopyLine id="foreground" label="In the foreground" text={line.foreground} copy={props.copy} help="The same relay, running until you close the terminal: handy to try it first." />
            </div>
          </>
        ) : (
          <div class="lre-set-row" data-lre-loopback-line-missing>
            <Banner tone="info" title="The line needs what this page can't fill in">
              <ul class="lre-loopback-steps">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Banner>
            <code class="lre-set-code">{`${line.account !== null ? `sudo -u ${shellWord(line.account)} ` : ""}${line.bun ?? "bun"} --cwd / ${line.script ?? "<LumiRPEngine's folder>/dist/lumirpengine.js"} loopback up --url ${line.url ?? "<the address you open Lumiverse at>"} --systemd`}</code>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Your loopback key: its fingerprint and age, Mint or Rotate, and a new key shown this once. */
function KeySection(props: { page: LoopbackPage; busy: boolean; act(act: LoopbackAct): void; copy(text: string): void }) {
  const { key, minted } = props.page;
  return (
    <Section title="Your loopback key">
      <div class="lre-set-rows" data-lre-loopback-group="key">
        {minted !== undefined ? (
          <div class="lre-set-row" data-lre-loopback-minted>
            <Banner tone="warn" title="Your new key, shown this once">
              Copy it into the loopback connection's API key now. LumiRPEngine keeps only its fingerprint, so Rotate is the only way to get a key again.
            </Banner>
            <CopyLine id="key" label="Loopback key" text={minted} copy={props.copy} />
          </div>
        ) : null}
        <SettingRow id="loopback.key" label="Key" changed={false} help={key.set ? "Rotate makes a new key at once, and the old one stops working: set the new one as the connection's API key." : "Mint one, then set it as the loopback connection's API key. Each user has a key of their own."} busy={props.busy}>
          <span class="lre-small">{key.set ? `Fingerprint ${key.print ?? ""}${key.at !== null ? ` · made ${dateText(key.at)}` : ""}` : "No key yet."}</span>
          <div class="lre-row-actions">
            <Button size="sm" variant={key.set ? "secondary" : "primary"} icon="key" busy={props.busy} onClick={() => props.act({ op: "mint" })}>
              {key.set ? "Rotate" : "Mint a key"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </Section>
  );
}

/** One relay: when it was last heard, where it listens, how it runs, its build, scheduler and session, and the fix for what is wrong. */
export function RelayRow(props: { relay: LoopbackRelayView; mine: boolean; build: string; now: number; busy: boolean; act(act: LoopbackAct): void; copy(text: string): void }) {
  const r = props.relay;
  const report = r.report;
  const heard = r.seenAt === null ? `Not heard from since LumiRPEngine started (registered ${dateText(r.registeredAt)}).` : `Last heard ${agoText(props.now - r.seenAt, r.seenAt)}.`;
  const requested = r.requestAt === null ? "No request carried since LumiRPEngine started." : `Last request ${agoText(props.now - r.requestAt, r.requestAt)}.`;
  const fixable = props.mine && report !== null && (report.scheduler === "missing" || report.scheduler === "unknown");
  return (
    <div class="lre-set-row" data-lre-loopback-relay={r.name}>
      <div class="lre-set-row-head">
        <span class="lre-set-row-label">{r.name}</span>
        <span class="lre-loopback-badges">
          {r.mode === "shared" ? <Badge tone="gm">Shared</Badge> : null}
          {r.signIn ? <Badge tone="warn">Sign-in needed</Badge> : r.update ? <Badge tone="accent">Update</Badge> : <Badge tone="pos">Running</Badge>}
        </span>
      </div>
      <ul class="lre-loopback-facts">
        <li>{requested}</li>
        <li>{heard}</li>
        <li>
          Listens at <span class="lre-set-code">{relayBase(r.listen, r.port)}</span>
          {r.host !== "" ? ` on ${r.host}` : ""}.
        </li>
        <li>{runsText(report)}</li>
        <li>{r.update ? `Build ${r.build || "unknown"}; LumiRPEngine is ${props.build}.` : `Build ${r.build || "unknown"}, as LumiRPEngine's.`}</li>
        {report ? <li>{SCHEDULER_WORDS[report.scheduler]}</li> : null}
        {report ? <li>{sessionText(report, props.now)}</li> : null}
        {report && report.calls > 0 ? <li>{report.calls === 1 ? "Carrying a reply now." : `Carrying ${report.calls} replies now.`}</li> : null}
      </ul>
      {r.signIn ? (
        <div data-lre-loopback-signin>
          <Banner tone="warn" title="Sign-in needed">
            It has gone quiet, or its Lumiverse session has ended. Sign it in again on the machine it runs on{r.lines.login === null ? `: lumirpengine loopback login --name ${r.name}` : ":"}
          </Banner>
          {r.lines.login !== null ? <CopyLine id={`login-${r.name}`} label="Sign in again" text={r.lines.login} copy={props.copy} /> : null}
        </div>
      ) : null}
      {r.update && r.lines.update !== null ? <CopyLine id={`update-${r.name}`} label="Update and restart" text={r.lines.update} help="Its copy is older than this LumiRPEngine: this line installs the new one and restarts it." copy={props.copy} /> : null}
      {fixable ? (
        <div data-lre-loopback-fix>
          <Banner
            tone="warn"
            actions={
              <Button size="sm" variant="primary" busy={props.busy} onClick={() => props.act({ op: "fix", relay: r.relay })}>
                Fix
              </Button>
            }
          >
            Fix asks the relay to put its address back in your scheduler's exclusions. Lumiverse applies the change within 5 seconds: wait that long before you generate.
          </Banner>
        </div>
      ) : null}
      {props.mine ? (
        <div class="lre-row-actions">
          <Button size="sm" variant="ghost" icon="trash" label={`Forget the relay ${r.name}`} disabled={props.busy} onClick={() => props.act({ op: "forget", relay: r.relay })}>
            Forget
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The connections LumiRPEngine treats as the loopback, how to make one, Test, and what keeps a world chat on it. */
function ConnectionSection(props: { page: LoopbackPage; busy: boolean; act(act: LoopbackAct): void; copy(text: string): void }) {
  const { connections, relays, shared, test } = props.page;
  const relay = relays.find((r) => r.mode === "user") ?? relays[0];
  const names = connections.map((c) => c.name);
  return (
    <Section
      title="The loopback connection"
      aside={
        <Button size="sm" variant="secondary" disabled={props.busy} onClick={() => props.act({ op: "test" })}>
          Test
        </Button>
      }
    >
      <div class="lre-set-rows" data-lre-loopback-group="connection">
        {test ? (
          <div data-lre-loopback-test={test.ok ? "ok" : "failed"}>
            <Banner tone={test.ok ? "info" : "warn"}>{test.text}</Banner>
          </div>
        ) : null}
        <p class="lre-set-note" data-lre-loopback-connections>
          {names.length > 0 ? `LumiRPEngine treats ${names.join(", ")} as the loopback.` : "None of your connections is the loopback yet."} A world chat on it plays its turn inside the reply; the narrator writes on the model you name in Settings → Depth → Narrator, never on the loopback.
        </p>
        <p class="lre-set-note" data-lre-loopback-pin>
          Opting a world chat into depth pins it to the loopback connection. Lumiverse's "always use the active connection" governs Edit and Send only, so the pin holds for replies, swipes, Continue and Impersonate. A reply generated on another connection runs no engine turn, and LumiRPEngine flags it under the message: switch the chat back to the loopback, or opt it out of depth in its Depth tab.
        </p>
        <div class="lre-set-row">
          <Disclosure summary="Make the loopback connection" defaultOpen={names.length === 0}>
            <ol class="lre-loopback-steps" data-lre-loopback-walkthrough>
              <li>In Lumiverse, open Connections and add one with the provider Custom (OpenAI-compatible).</li>
              <li>
                {relay ? (
                  <CopyLine id="base" label="Base URL" text={relayBase(relay.listen, relay.port)} copy={props.copy} />
                ) : (
                  "Base URL: the address the relay printed when it started (http://127.0.0.1:<its port>/v1 on this server)."
                )}
              </li>
              <li>API key: your loopback key, from above.</li>
              <li>
                <CopyLine id="model" label="Model" text={LOOPBACK_MODEL} copy={props.copy} />
              </li>
              <li>Save it and pick it as the world chat's connection. Its Test lists {LOOPBACK_MODEL} once the key checks out.</li>
            </ol>
            <p class="lre-small lre-muted">Spindle can't make or change a connection for an extension, so this one step is yours.{!shared.operator && shared.enabled ? " To use the operator's shared relay instead, give its address as the base URL; your own key still decides whose turn it is." : ""}</p>
          </Disclosure>
        </div>
      </div>
    </Section>
  );
}

/** Lumiverse in a container: the relay inside it as a second process, or a compose service sharing its network. */
function DockerSection(props: { page: LoopbackPage; copy(text: string): void }) {
  const { line } = props.page;
  const bun = line.bun ?? "<bun>";
  const script = line.script ?? "<LumiRPEngine's folder>/dist/lumirpengine.js";
  const inside = `${shellWord(bun)} --cwd / ${shellWord(script)} loopback up --url ${line.url ?? "<the address you open Lumiverse at>"}`;
  const compose = [
    "lumirpengine-loopback:",
    "  image: <Lumiverse's image>",
    '  network_mode: "service:lumiverse"',
    "  volumes: [<Lumiverse's data volume, mounted where it is in Lumiverse's service>]",
    `  command: ["${bun}", "${script}", "loopback", "serve", "--config", "<the config path loopback up printed>"]`,
    "  restart: always",
  ].join("\n");
  return (
    <Section title="Lumiverse in Docker" flush>
      <div class="lre-set-rows" data-lre-loopback-group="docker">
        <div class="lre-set-row">
          <Disclosure summary="Run the relay with Lumiverse in a container">
            <p class="lre-set-note">In a container there is no systemd, and Lumiverse's 127.0.0.1 is the container's own. Run the relay one of two ways; loopback up prints this too when it sees it is in a container.</p>
            <CopyLine id="docker-inside" label="Inside Lumiverse's container, as a second process" text={inside} help="Run it in Lumiverse's container, without --systemd." copy={props.copy} />
            <CopyLine id="docker-compose" label="As a compose service sharing Lumiverse's network" text={compose} help="127.0.0.1 is then the same for both. Run loopback up once inside the container first, so its config exists, and put the config path it printed in the command." copy={props.copy} />
          </Disclosure>
        </div>
      </div>
    </Section>
  );
}

/** No relay of yours is running: the warning at the top, with the line that starts one. */
function RelayDown(props: { page: LoopbackPage; copy(text: string): void }) {
  const { page } = props;
  const usable = page.relays.filter((r) => r.mode !== "shared" || page.shared.enabled);
  if (usable.some((r) => !r.signIn)) return null;
  return (
    <div data-lre-loopback-down>
      <Banner tone="warn" title="No relay is running">
        {usable.length === 0 ? "No relay of yours has registered, so a world chat on the loopback gets no reply." : "Every relay of yours has gone quiet or needs signing in again, so a world chat on the loopback gets no reply."} Start one on the machine Lumiverse runs on{page.line.command !== null ? " with this line:" : " with the line under Start the relay."}
      </Banner>
      {page.line.command !== null ? <CopyLine id="down-up" label="Start the relay" text={page.line.command} copy={props.copy} /> : null}
    </div>
  );
}

/** The page's body: everything above, hook-free. `now` is when the page is shown, for "last heard" and "last request". */
export function LoopbackBody(props: { page: LoopbackPage; now: number; busy: boolean; act(act: LoopbackAct): void; copy(text: string): void }) {
  const { page, busy } = props;
  const { shared } = page;
  return (
    <div class="lre-stack" data-lre-settings-page="loopback">
      <p class="lre-set-lead">The loopback lets a world chat play its turn inside the reply: give the chat the loopback connection, and LumiRPEngine runs the turn when Lumiverse asks for the reply, its thinking in the thinking block, then the narrator writes on your own model. It needs a small relay on the machine Lumiverse runs on, started once with the line below.</p>
      <RelayDown page={page} copy={props.copy} />
      <LineSection page={page} copy={props.copy} />
      <KeySection page={page} busy={busy} act={props.act} copy={props.copy} />
      <Section
        title="Your relays"
        aside={
          <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => props.act({ op: "get" })}>
            Refresh
          </Button>
        }
        flush
      >
        <div class="lre-set-rows" data-lre-loopback-group="relays">
          {page.relays.length === 0 ? (
            <p class="lre-set-note">No relay has registered yet: start one with the line above.</p>
          ) : (
            page.relays.map((relay) => <RelayRow key={relay.relay} relay={relay} mine={relay.mode === "user" || shared.operator} build={page.build} now={props.now} busy={busy} act={props.act} copy={props.copy} />)
          )}
        </div>
      </Section>
      <ConnectionSection page={page} busy={busy} act={props.act} copy={props.copy} />
      <DockerSection page={page} copy={props.copy} />
      <Section title="The shared relay" flush>
        <div class="lre-set-rows" data-lre-loopback-group="shared">
          {shared.operator ? (
            <SettingRow id="loopback.shared" label="Shared relay" bare changed={false} help="A shared relay runs under your account and carries every user's world-chat turns: it sees, and can drive, all of them. Off, each user runs a relay of their own, and loopback up --shared is refused." busy={busy}>
              <HostSwitch label="Allow a shared relay" checked={shared.enabled} disabled={busy} onChange={(enabled) => props.act({ op: "shared", enabled })} />
            </SettingRow>
          ) : (
            <p class="lre-set-note">{shared.enabled ? "The operator allows a shared relay: it carries a user's turns when their connection points at it, and their own key still decides whose turn it is." : "Each user runs a relay of their own: the operator hasn't allowed a shared one."}</p>
          )}
        </div>
      </Section>
      <Section title="How replies travel" flush>
        <div class="lre-set-rows" data-lre-loopback-group="transport">
          <p class="lre-set-note" data-lre-loopback-transport={page.transport}>
            Every reply of a world chat on the loopback goes through the relay: new replies, swipes, Continue and Impersonate.
            {page.sessions ? " This Lumiverse also has message sessions, but a session can't finish a reply LumiRPEngine writes passage by passage, so they aren't used." : ""}
            {page.enforced ? "" : " This Lumiverse doesn't stop a reply LumiRPEngine failed to tag, so while one of your world chats is replying on the loopback, LumiRPEngine refuses other requests through it rather than let that reply out unrecorded."}
          </p>
        </div>
      </Section>
    </div>
  );
}

/** How often the open page reads itself again: a relay's "last heard" and a connection made elsewhere show without Refresh. */
export const LOOPBACK_POLL_MS = 10_000;

/** What the page watches to read itself again: a timer while it is shown, and the tab coming back. */
export interface LoopbackWatchEnv {
  every(fn: () => void, ms: number): () => void;
  visible(): boolean;
  onShown(fn: () => void): () => void;
}

/** Reads the page again every `LOOPBACK_POLL_MS` while the tab is shown, and at once when it is shown again; returns the stop. */
export function watchLoopback(refresh: () => void, env: LoopbackWatchEnv): () => void {
  const stopTimer = env.every(() => {
    if (env.visible()) refresh();
  }, LOOPBACK_POLL_MS);
  const stopShown = env.onShown(() => {
    if (env.visible()) refresh();
  });
  return () => {
    stopTimer();
    stopShown();
  };
}

const BROWSER_WATCH: LoopbackWatchEnv = {
  every: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  visible: () => document.visibilityState !== "hidden",
  onShown: (fn) => {
    document.addEventListener("visibilitychange", fn);
    window.addEventListener("focus", fn);
    return () => {
      document.removeEventListener("visibilitychange", fn);
      window.removeEventListener("focus", fn);
    };
  },
};

/** Settings → Loopback: the page as LumiRPEngine has it for this address, each press answered with the page again. */
export function LoopbackSettingsPage() {
  const app = useApp();
  const [page, setPage] = useState<LoopbackPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, run] = useBusy();
  const ask = async (act: LoopbackAct): Promise<void> => {
    const result = await app.request<"lre.loopback.page">({ type: "lre.loopback.page", origin: location.origin, ...act });
    // Test's line stays while the page reads itself again; any other press, or Test again, replaces it.
    if (result) setPage((prev) => (act.op === "get" && result.page.test === undefined && prev?.test !== undefined ? { ...result.page, test: prev.test } : result.page));
    else setFailed(true);
  };
  useEffect(() => {
    void ask({ op: "get" });
    return watchLoopback(() => void ask({ op: "get" }), BROWSER_WATCH);
  }, []);
  if (page === null) return failed ? <Empty icon="alert">Settings → Loopback could not be loaded.</Empty> : <Empty>Loading the loopback…</Empty>;
  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => app.toast("Copied"),
      () => app.toast("The clipboard refused the copy: select the line and copy it yourself", "error"),
    );
  };
  return <LoopbackBody page={page} now={Date.now()} busy={busy} act={(act) => run(() => ask(act))} copy={copy} />;
}
