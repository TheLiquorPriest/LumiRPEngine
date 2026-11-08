// Settings → Loopback (DEPTH-PLAN §3.3, §3.4, §3.7, §3.11, §3.15): the one line with Copy, the key
// by its fingerprint with Rotate and a new key shown once, each relay with what is wrong and its fix
// (sign in again, update, Fix the scheduler, Forget only for your own), the connection's steps with
// the relay's address and the model, the operator's shared relay, and how replies travel; the page
// in Settings' Depth group, under its own header.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import { Button, HostSwitch } from "../../src/frontend/components";
import { LOOPBACK_POLL_MS, LoopbackBody, LoopbackSettingsPage, watchLoopback, type LoopbackAct } from "../../src/frontend/settings/loopback";
import { HOME_GROUPS, SettingsBody, settingsHeader } from "../../src/frontend/settings/settings";
import type { LoopbackPage, LoopbackRelayView, RelayReport } from "../../src/shared/loopback";
import type { SettingsResult } from "../../src/shared/protocol";
import { rendered, texts } from "../support/settings-tree";
import { propsOf, type Props } from "../support/tree";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const BUN = "/home/lumi/.bun/bin/bun";
const SCRIPT = "/srv/lumiverse/data/extensions/lre/repo/dist/lumirpengine.js";

function report(over: Partial<RelayReport> = {}): RelayReport {
  return { name: "sam", build: "b1", runtime: { bun: BUN, script: "/var/lib/lumirpengine/lumirpengine.js", unit: { name: "lumirpengine-loopback-sam.service", scope: "system" } }, host: "box", listen: "127.0.0.1", port: 7861, scheduler: "excluded", session: { valid: true, expiresAt: "2026-11-14T12:00:00Z", checkedAt: NOW - 3_600_000 }, calls: 0, ...over };
}

function relay(over: Partial<LoopbackRelayView> = {}): LoopbackRelayView {
  return { relay: "rl-1", name: "sam", mode: "user", build: "b1", host: "box", listen: "127.0.0.1", port: 7861, registeredAt: NOW - 86_400_000, seenAt: NOW - 12_000, requestAt: NOW - 180_000, report: report(), signIn: false, update: false, lines: { update: null, login: null }, ...over };
}

function page(over: Partial<LoopbackPage> = {}): LoopbackPage {
  return {
    build: "b1",
    key: { set: true, print: "a1b2c3d4", at: NOW - 86_400_000 },
    relays: [relay()],
    line: { command: `sudo -u lumi ${BUN} --cwd / ${SCRIPT} loopback up --url http://127.0.0.1:7860 --systemd`, foreground: `sudo -u lumi ${BUN} --cwd / ${SCRIPT} loopback up --url http://127.0.0.1:7860`, bun: BUN, script: SCRIPT, url: "http://127.0.0.1:7860", account: "lumi" },
    transport: "relay",
    sessions: false,
    enforced: true,
    shared: { operator: true, enabled: false },
    connections: [{ id: "conn-loop", name: "Loopback" }],
    ...over,
  };
}

/** The page rendered down to its controls, with every press and copy it makes. */
function show(p: LoopbackPage) {
  const acts: LoopbackAct[] = [];
  const copied: string[] = [];
  const tree = rendered(LoopbackBody({ page: p, now: NOW, busy: false, act: (a) => void acts.push(a), copy: (text) => void copied.push(text) }));
  const button = (text: string, within: unknown = tree): Props => {
    const found = propsOf(within, Button).filter((b) => texts(b.children).join(" ") === text || b.label === text);
    if (found.length !== 1) throw new Error(`${found.length} buttons "${text}"`);
    return found[0] ?? {};
  };
  const click = (b: Props): void => (b.onClick as () => void)();
  const part = (attr: string, value?: string): Props[] => propsOf(tree, "div").filter((d) => (value === undefined ? attr in d : d[attr] === value));
  return { tree, acts, copied, button, click, part, words: texts(tree).join(" ") };
}

describe("Settings → Loopback", () => {
  test("the one line for this server, each with Copy; the key by its fingerprint, Rotate minting a new one", () => {
    const p = page();
    const { button, click, copied, acts, words } = show(p);
    click(button("Copy: As a service"));
    click(button("Copy: In the foreground"));
    expect(copied).toEqual([p.line.command ?? "", p.line.foreground ?? ""]);
    expect(words).toContain("Fingerprint a1b2c3d4");
    click(button("Rotate"));
    expect(acts).toEqual([{ op: "mint" }]);
  });

  test("no key yet: Mint a key; a key just minted shows once with Copy, and a warning that it won't show again", () => {
    const none = show(page({ key: { set: false, print: null, at: null } }));
    expect(none.words).toContain("No key yet.");
    none.click(none.button("Mint a key"));
    expect(none.acts).toEqual([{ op: "mint" }]);
    expect(none.part("data-lre-loopback-minted")).toEqual([]);
    const fresh = show(page({ minted: "lre_lk_0123abcd" }));
    expect(fresh.words).toContain("Your new key, shown this once");
    fresh.click(fresh.button("Copy: Loopback key"));
    expect(fresh.copied).toEqual(["lre_lk_0123abcd"]);
  });

  test("a line the server can't fill in says what is missing, with the form to fill, run as the account Lumiverse runs as, from /", () => {
    const { part, words } = show(page({ line: { command: null, foreground: null, bun: null, script: SCRIPT, url: "http://127.0.0.1:7860", account: "lumi" } }));
    expect(part("data-lre-loopback-line-missing")).toHaveLength(1);
    expect(words).toContain("Lumiverse didn't say where its Bun is");
    expect(words).toContain(`sudo -u lumi bun --cwd / ${SCRIPT} loopback up --url http://127.0.0.1:7860 --systemd`);
    expect(words).not.toContain("sudo bun");
    expect(words).not.toContain("couldn't tell the address");
    // A Lumiverse run as root (or one that can't say its account) names none.
    expect(show(page({ line: { command: null, foreground: null, bun: null, script: SCRIPT, url: "http://127.0.0.1:7860", account: null } })).words).not.toContain("sudo");
  });

  test("a relay that is fine says when it was heard and how it runs, with Forget only", () => {
    const { tree, part, words, button, click, acts } = show(page());
    const [row] = part("data-lre-loopback-relay", "sam");
    expect(texts(row?.children).join(" ")).toContain("Last heard 12 s ago.");
    expect(words).toContain("Runs as a system service, lumirpengine-loopback-sam.service: it survives logout and reboot.");
    expect(words).toContain("Kept out of your local-inference scheduler.");
    expect(part("data-lre-loopback-signin")).toEqual([]);
    expect(part("data-lre-loopback-fix")).toEqual([]);
    expect(propsOf(tree, Button).some((b) => texts(b.children).join(" ") === "Fix")).toBe(false);
    click(button("Forget the relay sam"));
    expect(acts).toEqual([{ op: "forget", relay: "rl-1" }]);
  });

  test("a relay gone quiet and out of date, missing from the scheduler: sign in again and update with Copy, and Fix", () => {
    const stale = relay({ seenAt: null, signIn: true, update: true, build: "b0", report: report({ scheduler: "missing", runtime: { bun: BUN, script: "/home/sam/.local/share/lumirpengine/lumirpengine.js", unit: { name: "lumirpengine-loopback-sam.service", scope: "user" } } }), lines: { update: `${BUN} ${SCRIPT} loopback up --url http://127.0.0.1:7860 --name sam --systemd`, login: `${BUN} /home/sam/.local/share/lumirpengine/lumirpengine.js loopback login --name sam` } });
    const { part, words, button, click, acts, copied } = show(page({ relays: [stale] }));
    expect(part("data-lre-loopback-signin")).toHaveLength(1);
    expect(words).toContain("Not heard from since LumiRPEngine started");
    expect(words).toContain("Build b0; LumiRPEngine is b1.");
    expect(words).toContain("it survives logout while lingering is on for its account");
    click(button("Copy: Sign in again"));
    click(button("Copy: Update and restart"));
    expect(copied).toEqual([stale.lines.login ?? "", stale.lines.update ?? ""]);
    // The scheduler caches its setting for 5 s (D0a check 7): Fix says to wait that long.
    expect(texts(part("data-lre-loopback-fix").map((d) => d.children)).join(" ")).toContain("within 5 seconds");
    click(button("Fix"));
    expect(acts).toEqual([{ op: "fix", relay: "rl-1" }]);
  });

  test("another user's shared relay shows without Forget or Fix, and the connection's steps name the relay's address and the model", () => {
    const theirs = relay({ relay: "rl-op", name: "shared", mode: "shared", listen: "127.0.0.1", port: 7870, report: report({ scheduler: "missing" }) });
    const { tree, words, button, click, copied } = show(page({ relays: [theirs], shared: { operator: false, enabled: true }, connections: [] }));
    expect(propsOf(tree, Button).some((b) => b.label === "Forget the relay shared" || texts(b.children).join(" ") === "Fix")).toBe(false);
    expect(words).toContain("None of your connections is the loopback yet.");
    expect(words).toContain("The operator allows a shared relay");
    expect(propsOf(tree, HostSwitch)).toEqual([]);
    click(button("Copy: Base URL"));
    click(button("Copy: Model"));
    expect(copied).toEqual(["http://127.0.0.1:7870/v1", "lre-narrator"]);
  });

  test("the operator's shared relay switch, and how replies travel on this Lumiverse", () => {
    const { tree, acts, words } = show(page({ sessions: true, enforced: false }));
    const [shared] = propsOf(tree, HostSwitch).filter((s) => s.label === "Allow a shared relay");
    expect(shared?.checked).toBe(false);
    (shared?.onChange as (on: boolean) => void)(true);
    expect(acts).toEqual([{ op: "shared", enabled: true }]);
    expect(words).toContain("LumiRPEngine treats Loopback as the loopback.");
    expect(words).toContain("message sessions, but a session can't finish a reply LumiRPEngine writes passage by passage");
    expect(words).toContain("doesn't stop a reply LumiRPEngine failed to tag");
    const plain = show(page()).words;
    expect(plain).not.toContain("message sessions");
    expect(plain).not.toContain("failed to tag");
  });

  // The depth release's late security review, S4: pasted from another login, a line that named no account ran, and installed as that login's service, files Lumiverse's account can change.
  test("the service line runs as the account Lumiverse runs as, named, from /, never with sudo alone, lingering turned on where the system allows", () => {
    const { words } = show(page());
    expect(words).toContain("It runs as the account Lumiverse runs as (lumi, by its sudo -u, from whichever account you paste it in), from / (--cwd /: Bun reads no bunfig.toml or .env from the directory you are in)");
    expect(words).toContain("it turns lingering on where the system lets it, or prints the line that does");
    expect(words).toContain("Not with sudo alone: as root it would run files that account can change, so it refuses");
  });

  test("the open page reads itself again on a timer while shown, and at once when shown again; stopped, it reads no more", () => {
    let tick: (() => void) | null = null;
    let shown: (() => void) | null = null;
    let every = 0;
    let visible = true;
    let reads = 0;
    const stop = watchLoopback(() => void reads++, {
      every: (fn, ms) => {
        tick = fn;
        every = ms;
        return () => void (tick = null);
      },
      visible: () => visible,
      onShown: (fn) => {
        shown = fn;
        return () => void (shown = null);
      },
    });
    expect(every).toBe(LOOPBACK_POLL_MS);
    (tick as unknown as () => void)();
    expect(reads).toBe(1);
    visible = false;
    (tick as unknown as () => void)();
    expect(reads).toBe(1);
    visible = true;
    (shown as unknown as () => void)();
    expect(reads).toBe(2);
    stop();
    expect(tick).toBeNull();
    expect(shown).toBeNull();
  });

  test("the page sits in Settings' Depth group, under its own header", () => {
    expect(HOME_GROUPS.find((g) => g.title === "Depth")?.pages).toEqual(["depth", "loopback"]);
    expect(settingsHeader({ page: "loopback" })).toMatchObject({ title: "Loopback", backLabel: "Settings" });
    const data = { settings: defaultSettings(), extraction: {} } as unknown as SettingsResult;
    const noop = (): void => undefined;
    const el = SettingsBody({ route: { page: "loopback" }, data, ctx: { connections: [], caveats: [], view: null, busy: false, patch: noop, go: noop } });
    expect(el?.type).toBe(LoopbackSettingsPage);
  });

  test("each relay says when it last carried a request; Test asks for its line, which the page shows; the pin's note on Lumiverse's active-connection setting", () => {
    const { words, button, click, acts, part } = show(page());
    expect(words).toContain("Last request 3 min ago.");
    expect(part("data-lre-loopback-down")).toEqual([]);
    click(button("Test"));
    expect(acts).toEqual([{ op: "test" }]);
    expect(words).toContain('Lumiverse\'s "always use the active connection" governs Edit and Send only, so the pin holds');
    const tested = show(page({ test: { ok: false, text: "Test failed. You have no loopback key." } }));
    expect(tested.part("data-lre-loopback-test", "failed")).toHaveLength(1);
    expect(tested.words).toContain("Test failed. You have no loopback key.");
    expect(show(page({ relays: [relay({ requestAt: null })] })).words).toContain("No request carried since LumiRPEngine started.");
  });

  test("Docker: the relay inside Lumiverse's container or as a compose service sharing its network, each with Copy", () => {
    const { button, click, copied, part } = show(page());
    expect(part("data-lre-loopback-group", "docker")).toHaveLength(1);
    click(button("Copy: Inside Lumiverse's container, as a second process"));
    click(button("Copy: As a compose service sharing Lumiverse's network"));
    expect(copied[0]).toBe(`${BUN} --cwd / ${SCRIPT} loopback up --url http://127.0.0.1:7860`);
    expect(copied[1]).toContain('network_mode: "service:lumiverse"');
    expect(copied[1]).toContain(`command: ["${BUN}", "${SCRIPT}", "loopback", "serve", "--config"`);
  });

  test("no relay running: a warning at the top with the line that starts one", () => {
    const none = show(page({ relays: [] }));
    expect(none.part("data-lre-loopback-down")).toHaveLength(1);
    expect(none.words).toContain("No relay is running");
    none.click(none.button("Copy: Start the relay"));
    expect(none.copied).toEqual([page().line.command ?? ""]);
    const quiet = show(page({ relays: [relay({ signIn: true })] }));
    expect(quiet.words).toContain("Every relay of yours has gone quiet or needs signing in again");
  });
});
