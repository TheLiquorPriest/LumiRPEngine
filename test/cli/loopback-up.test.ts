// `loopback up` and `serve` over a fake Lumiverse and a fake machine. `up` names the account by the
// username it signed in with, never by the id the register reply carries (DEPTH-LIVE finding 1). It
// runs only from files no other account can change (as root, root alone, and the directory it runs
// in too), and otherwise refuses before it signs in, saying how to run the relay as the account that
// can change them; from root-owned files it installs a system unit that runs root-owned copies of
// Bun and the relay, never as root. Run as the account itself (`sudo -u`), it reaches the account's
// service manager and says to turn lingering on when that isn't running; it never takes a system
// relay's name. A relay a system unit runs says so in its report, and that unit's account signs it in
// again, writing its config in place (the depth release's security review, M3 and L3, and its late
// one, S1, S2 and S4). A group-writable entry of the account's own counts as its own when no other
// account is in its group, as core makes them under a umask of 0002; otherwise the refusal gives the
// chmod that takes that write away (the late live run, L3c-1). Root never runs a system service's
// copies, which its Update refreshes from its account's install, and a system relay's `down` and
// `status` give systemd's own lines, as root and as its account alike (the final security review, F1).
// The refusal is the copies' own code, so a changed copy needn't refuse: no line printed for root runs
// one, and a system relay's run only `systemctl`, `install` and `rm` (S-1).

import { describe, expect, test } from "bun:test";
import type { CliIO } from "../../src/cli/commands";
import type { Http, HttpReply } from "../../src/cli/connection";
import { CredentialStore } from "../../src/cli/credentials";
import { loopback, type LoopbackIO } from "../../src/cli/loopback";
import { KIT_FILE } from "../../src/shared/agents";
import { isRecord } from "../../src/shared/json";
import { FakeLumiverse, USER } from "./fake-lumiverse";
import { copyRun, rootRuns, SYSTEM_RELAY_ROOT_PROGRAMS } from "../support/root-lines";

const USER_ID = "41f80099-4103-473e-85ce-086c677d247c";
/** The relay `up` makes, named by the username it signed in with: its unit and its config. */
const UNIT = `lumirpengine-loopback-${USER.username}.service`;
const CONFIG = `/etc/lumirpengine/loopback-${USER.username}.json`;

interface Ran {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>> | undefined;
}

/** A machine `loopback` runs on: its files (each owned by root, in group 0, unless `owners` and `groups` say), the programs it runs, and a fake Lumiverse that registers the relay. */
function machine(o: { uid: number; bun: string; self: string; owners?: Record<string, number>; groups?: Record<string, number>; modes?: Record<string, number>; cwd?: string; dir?: string[]; env?: Record<string, string>; files?: Record<string, string>; answer?: (ran: Ran) => { code: number; out: string; err: string } | undefined }) {
  const fake = new FakeLumiverse();
  const handle = fake.lre.handle.bind(fake.lre);
  fake.lre.handle = (r) => (r.type === "lre.loopback.register" ? { lre: 1, type: "lre.result", reqId: r.reqId, request: r.type, body: { relay: "rl-1", secret: "s3cret", mode: "user", model: "lre-narrator", user: USER_ID } } : handle(r));
  // The scheduler's setting answers 500, so `up` prints the line that names whose exclusions it couldn't change.
  const failed: HttpReply = { status: 500, header: () => null, text: "" };
  const http: Http = (req) => (req.url.endsWith("/api/v1/inference-scheduler/config") ? Promise.resolve(failed) : fake.http(req));
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>(Object.entries(o.files ?? {}));
  const copies: { from: string; to: string; mode: number }[] = [];
  const rewritten: string[] = [];
  const runs: Ran[] = [];
  const stopped = Promise.withResolvers<string>();
  const lio: LoopbackIO = {
    serve: () => ({ stop: () => undefined }),
    stopped: () => stopped.promise,
    bun: o.bun,
    self: o.self,
    uid: o.uid,
    cwd: o.cwd ?? "/",
    hostname: "box",
    platform: "linux",
    home: "/home/u",
    files: {
      read: (p) => files.get(p) ?? null,
      write: (p, t) => void files.set(p, t),
      rewrite: (p, t) => {
        rewritten.push(p);
        files.set(p, t);
      },
      copy: (from, to, mode) => {
        copies.push({ from, to, mode });
        files.set(to, "");
      },
      exists: (p) => files.has(p),
      list: (d) => (d === o.cwd ? (o.dir ?? []) : []),
      remove: (p) => void files.delete(p),
      stat: (p) => ({ uid: o.owners?.[p] ?? 0, gid: o.groups?.[p] ?? 0, mode: o.modes?.[p] ?? 0o755 }),
      real: (p) => p,
      chown: () => undefined,
    },
    run: async (command, args, env) => {
      const ran = { command, args, env };
      runs.push(ran);
      return o.answer?.(ran) ?? { code: 0, out: command === "id" ? "u" : command === "loginctl" ? "yes" : "", err: "" };
    },
  };
  let saved: string | null = null;
  const io: CliIO = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    readFile: () => {
      throw new Error("no files");
    },
    writeFile: () => undefined,
    env: { LUMIVERSE_PASSWORD: USER.password, ...o.env },
    stdoutIsTTY: true,
    ask: async () => null,
    credentials: new CredentialStore({ read: () => saved, write: (_p, t) => void (saved = t) }, "credentials.json"),
    http,
    openSocket: fake.openSocket,
    loopback: lio,
  };
  const words = (): string => [...out, ...err].join("\n");
  return { fake, io, out, err, files, copies, rewritten, runs, stopped, words };
}

const up = (io: CliIO, base: string, values: Record<string, string[]> = {}) => loopback({ positionals: ["up"], values: { "--url": [base], "--username": [USER.username], ...values }, flags: { "--systemd": true } }, io);

test("up names the account by its username, not the register reply's user id", async () => {
  const m = machine({ uid: 1000, bun: "/home/u/.bun/bin/bun", self: "/srv/lre/dist/lumirpengine.js", owners: { "/home/u/.bun/bin/bun": 1000, "/srv/lre/dist/lumirpengine.js": 1000 } });
  const code = await up(m.io, m.fake.base);
  expect(code).toBe(0);
  expect(m.words()).toContain(`it carries ${USER.username}'s turns`);
  expect(m.words()).toContain(`in ${USER.username}'s local-inference scheduler exclusions`);
  expect(m.words()).not.toContain(USER_ID);
});

describe("as root", () => {
  test("up refuses to run from files another account can change, before it signs in, and says how to run it as that account", async () => {
    const lumi = 1001;
    const m = machine({
      uid: 0,
      bun: "/home/lumi/.bun/bin/bun",
      self: "/srv/lre/dist/lumirpengine.js",
      owners: { "/home/lumi/.bun/bin/bun": lumi, "/srv/lre/dist/lumirpengine.js": lumi, [`/srv/lre/dist/${KIT_FILE}`]: lumi, "/srv/lre/dist": lumi },
      answer: ({ command, args }) => (command === "id" && args[0] === "-nu" && args[1] === String(lumi) ? { code: 0, out: "lumi\n", err: "" } : undefined),
    });
    const code = await loopback({ positionals: ["up"], values: { "--url": [m.fake.base] }, flags: { "--systemd": true } }, m.io);
    expect(code).toBe(1);
    const said = m.words();
    expect(said).toContain("Refusing to run as root");
    expect(said).toContain("/home/lumi/.bun/bin/bun: lumi can change it");
    expect(said).toContain("/srv/lre/dist/lumirpengine.js: lumi can change it");
    expect(said).toContain(`/srv/lre/dist/${KIT_FILE}: lumi can change it`);
    expect(said).toContain("  sudo loginctl enable-linger lumi");
    expect(said).toContain(`  sudo -u lumi /home/lumi/.bun/bin/bun --cwd / /srv/lre/dist/lumirpengine.js loopback up --url ${m.fake.base} --systemd`);
    // Nothing was done: no sign-in, no registration, no file, no service.
    expect(m.fake.requests).toEqual([]);
    expect(m.fake.lre.sent("lre.loopback.register")).toEqual([]);
    expect([...m.files.keys()]).toEqual([]);
    expect(m.runs.filter((r) => r.command !== "id")).toEqual([]);
  });

  test("every other subcommand refuses alike, and a group-writable directory counts, with the chmod that stops it", async () => {
    const m = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", owners: {} });
    m.io.loopback = { ...(m.io.loopback as LoopbackIO), files: { ...(m.io.loopback as LoopbackIO).files, stat: (p) => ({ uid: 0, gid: 0, mode: p === "/opt/lre" ? 0o775 : 0o755 }) } };
    expect(await loopback({ positionals: ["login"], values: { "--name": [USER.username] }, flags: {} }, m.io)).toBe(1);
    // No getent to say who is in group 0: its write counts as another account's.
    expect(m.words()).toContain("  /opt/lre: its group, 0, can change it");
    expect(m.words()).toContain("Take that write away, then run it again:\n  chmod g-w /opt/lre\n  sudo /usr/local/bin/bun --cwd / /opt/lre/lumirpengine.js loopback login --name");
    expect(m.words()).not.toContain("sudo -u");
  });

  test("from files only root can change, up installs a system unit that runs root-owned copies of Bun and the relay as the account named, never as root", async () => {
    const m = machine({
      uid: 0,
      bun: "/usr/local/bin/bun",
      self: "/opt/lre/lumirpengine.js",
      answer: ({ command, args }) => (command === "id" && (args[0] === "-u" || args[0] === "-g") ? { code: 0, out: args[1] === "root" ? "0\n" : "1001\n", err: "" } : undefined),
    });
    expect(await up(m.io, m.fake.base, { "--account": ["lumi"] })).toBe(0);
    const unit = m.files.get(`/etc/systemd/system/${UNIT}`) ?? "";
    expect(unit).toContain("User=lumi");
    expect(unit).toContain(`ExecStart=/var/lib/lumirpengine/bun /var/lib/lumirpengine/lumirpengine.js loopback serve --config ${CONFIG}`);
    expect(m.copies).toEqual([
      { from: "/opt/lre/lumirpengine.js", to: "/var/lib/lumirpengine/lumirpengine.js", mode: 0o644 },
      { from: `/opt/lre/${KIT_FILE}`, to: `/var/lib/lumirpengine/${KIT_FILE}`, mode: 0o644 },
      { from: "/usr/local/bin/bun", to: "/var/lib/lumirpengine/bun", mode: 0o755 },
    ]);
    expect(m.runs.filter((r) => r.command === "systemctl").map((r) => r.args)).toEqual([["daemon-reload"], ["enable", UNIT], ["restart", UNIT]]);
    // Root itself is never the account it runs as, and nothing is registered for it.
    const again = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", answer: ({ command, args }) => (command === "id" && args[0] === "-u" ? { code: 0, out: "0\n", err: "" } : undefined) });
    expect(await up(again.io, again.fake.base, { "--account": ["root"] })).toBe(2);
    expect(again.words()).toContain("the relay never runs as root");
    expect(again.fake.lre.sent("lre.loopback.register")).toEqual([]);
  });

  // The depth release's late security review, S2: Bun reads bunfig.toml (whose preload runs first) and .env from the directory it runs in, before anything of the relay's.
  test("from root's own files, it still refuses a directory it runs in, or a bunfig.toml or .env there, that another account can change, and gives the line run from /", async () => {
    const lumi = 1001;
    const answer = ({ command, args }: Ran) => (command === "id" && args[0] === "-nu" ? { code: 0, out: "lumi\n", err: "" } : undefined);
    const there = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", cwd: "/srv/lumiverse", owners: { "/srv/lumiverse": lumi }, answer });
    expect(await up(there.io, there.fake.base, { "--account": ["lumi"] })).toBe(1);
    expect(there.words()).toContain("Refusing to run as root from /srv/lumiverse");
    expect(there.words()).toContain("  /srv/lumiverse: lumi can change it (Bun reads bunfig.toml and .env in the directory it runs in before this runs)");
    expect(there.words()).toContain(`  sudo /usr/local/bin/bun --cwd / /opt/lre/lumirpengine.js loopback up --url ${there.fake.base} --username ${USER.username} --account lumi --systemd`);
    expect(there.fake.requests).toEqual([]);
    // A directory of root's alone with another account's .env in it counts too.
    const env = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", cwd: "/root", dir: ["notes.txt", ".env.local"], owners: { "/root/.env.local": lumi }, answer });
    expect(await up(env.io, env.fake.base, { "--account": ["lumi"] })).toBe(1);
    expect(env.words()).toContain("  /root/.env.local: lumi can change it");
    expect(env.words()).not.toContain("notes.txt");
  });

  // The depth release's final security review, F1: a system relay's Update writes its account's bytes over the copies in /var/lib/lumirpengine, which stay root's, so root running them ran that account's code, and `down`, the only way to remove the unit with the command line, took a root run.
  test("never runs a system service's copies, which its Update refreshes from its account's install, and gives systemd's own lines for its down and status", async () => {
    const copies = { uid: 0, bun: "/var/lib/lumirpengine/bun", self: "/var/lib/lumirpengine/lumirpengine.js", files: { [`/etc/systemd/system/${UNIT}`]: "[Unit]" } };
    const down = machine(copies);
    expect(await loopback({ positionals: ["down"], values: { "--name": [USER.username] }, flags: {} }, down.io)).toBe(1);
    expect(down.words()).toContain("Refusing to run as root from /var/lib/lumirpengine");
    expect(down.words()).toContain(`  sudo systemctl disable --now ${UNIT} && sudo rm /etc/systemd/system/${UNIT} && sudo systemctl daemon-reload`);
    expect(down.runs).toEqual([]);
    expect(down.files.has(`/etc/systemd/system/${UNIT}`)).toBe(true);
    const status = machine(copies);
    expect(await loopback({ positionals: ["status"], values: { "--name": [USER.username] }, flags: {} }, status.io)).toBe(1);
    expect(status.words()).toContain(`  systemctl status ${UNIT}`);
    expect(status.runs).toEqual([]);
    // Every other run alike, before it signs in.
    const others: [string, Record<string, string[]>, Record<string, true>][] = [
      ["up", { "--url": [down.fake.base], "--account": ["lumi"] }, { "--systemd": true }],
      ["login", { "--name": [USER.username] }, {}],
      ["serve", { "--name": [USER.username] }, {}],
    ];
    for (const [sub, values, flags] of others) {
      const m = machine(copies);
      expect(await loopback({ positionals: [sub], values, flags }, m.io)).toBe(1);
      expect(m.words()).toContain("Refusing to run as root from /var/lib/lumirpengine");
      expect(m.fake.requests).toEqual([]);
      expect(m.runs).toEqual([]);
    }
    // Reached through a link, they are the same copies.
    const linked = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js" });
    const lio = linked.io.loopback as LoopbackIO;
    linked.io.loopback = { ...lio, files: { ...lio.files, real: (p) => p.replace(/^\/opt\/lre(?=\/|$)/, "/var/lib/lumirpengine") } };
    expect(await loopback({ positionals: ["status"], values: { "--name": [USER.username] }, flags: {} }, linked.io)).toBe(1);
    expect(linked.words()).toContain("Refusing to run as root from /var/lib/lumirpengine");
    // From root's own copies elsewhere, root still removes the unit itself.
    const own = machine({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", files: { [`/etc/systemd/system/${UNIT}`]: "[Unit]" } });
    expect(await loopback({ positionals: ["down"], values: { "--name": [USER.username] }, flags: {} }, own.io)).toBe(0);
    expect(own.runs.filter((r) => r.command === "systemctl").map((r) => r.args)).toEqual([["disable", "--now", UNIT], ["daemon-reload"]]);
  });

  // The final security review's last finding, S-1: the refusal above is the copy's own code, so a copy its account changed never refuses, and its code has run as root as soon as Bun loaded it. What protects is that no line given root runs one.
  test("no line it prints for root runs a file in /var/lib/lumirpengine, and a system relay's run only systemctl, install and rm", async () => {
    // The check itself: a copy run as root is found, as a program or a file handed to one; one run as its account, or written by install, isn't.
    expect(rootRuns("sudo /var/lib/lumirpengine/bun --cwd / /var/lib/lumirpengine/lumirpengine.js loopback down").map(copyRun)).toEqual(["/var/lib/lumirpengine/bun"]);
    expect(rootRuns("/usr/local/bin/bun /var/lib/lumirpengine/lumirpengine.js loopback status").map(copyRun)).toEqual(["/var/lib/lumirpengine/lumirpengine.js"]);
    expect(rootRuns(`sudo -u lumi /var/lib/lumirpengine/bun /var/lib/lumirpengine/lumirpengine.js loopback login && sudo install -m 0644 "$t"/x /var/lib/lumirpengine/x`).map(copyRun)).toEqual([null]);
    const unit = { [`/etc/systemd/system/${UNIT}`]: "[Unit]" };
    const session = (m: ReturnType<typeof machine>, token: string): void =>
      void m.files.set(CONFIG, JSON.stringify({ lumirpengine: 1, loopback: { name: USER.username, base: m.fake.base, listen: "127.0.0.1", port: 7861, mode: "user", relay: "rl-1", secret: "s3cret", session: { username: USER.username, token, savedAt: 0 }, tuning: {} } }));
    const ran: ReturnType<typeof machine>[] = [];
    const at = (o: Parameters<typeof machine>[0]): ReturnType<typeof machine> => {
      const m = machine(o);
      ran.push(m);
      return m;
    };
    const name = { "--name": [USER.username] };
    const run = (m: ReturnType<typeof machine>, sub: string, values: Record<string, string[]> = name, flags: Record<string, true> = {}): Promise<number> => loopback({ positionals: [sub], values, flags }, m.io);
    // As root from the copies, with only their Bun, or naming it for the unit: every subcommand refuses before it runs or asks anything.
    const copies: { bun: string; self: string; extra: Record<string, string[]> }[] = [
      { bun: "/var/lib/lumirpengine/bun", self: "/var/lib/lumirpengine/lumirpengine.js", extra: {} },
      { bun: "/var/lib/lumirpengine/bun", self: "/opt/lre/lumirpengine.js", extra: {} },
      { bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", extra: { "--bun": ["/var/lib/lumirpengine/bun"] } },
    ];
    for (const { bun, self, extra } of copies) {
      for (const sub of ["down", "status", "login", "serve", "up"]) {
        const m = at({ uid: 0, bun, self, files: unit });
        const values = sub === "up" ? { "--url": [m.fake.base], "--account": ["lumi"], ...extra } : { ...name, ...extra };
        expect(await run(m, sub, values, sub === "up" ? { "--systemd": true } : {})).toBe(1);
        expect(m.words()).toContain("Refusing to run as root from /var/lib/lumirpengine");
        expect(m.runs).toEqual([]);
        expect(m.fake.requests).toEqual([]);
      }
    }
    // As root from its own copies: up installs the unit, whose first line names its removal, then status and down.
    const own = at({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", answer: ({ command, args }) => (command === "id" && (args[0] === "-u" || args[0] === "-g") ? { code: 0, out: args[1] === "root" ? "0\n" : "1001\n", err: "" } : undefined) });
    expect(await up(own.io, own.fake.base, { "--account": ["lumi"] })).toBe(0);
    const written = own.files.get(`/etc/systemd/system/${UNIT}`) ?? "";
    await run(own, "status");
    expect(await run(own, "down")).toBe(0);
    // As root from files another account can change, or from a directory one can: the lines that run it as that account, or from /.
    const lumi = 1001;
    const lumis = at({ uid: 0, bun: "/home/lumi/.bun/bin/bun", self: "/srv/lre/dist/lumirpengine.js", owners: { "/home/lumi/.bun/bin/bun": lumi, "/srv/lre/dist/lumirpengine.js": lumi, [`/srv/lre/dist/${KIT_FILE}`]: lumi, "/srv/lre/dist": lumi }, answer: ({ command, args }) => (command === "id" && args[0] === "-nu" ? { code: 0, out: "lumi\n", err: "" } : undefined) });
    expect(await run(lumis, "up", { "--url": [lumis.fake.base] }, { "--systemd": true })).toBe(1);
    const there = at({ uid: 0, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", cwd: "/srv/lumiverse", owners: { "/srv/lumiverse": lumi }, answer: ({ command, args }) => (command === "id" && args[0] === "-nu" ? { code: 0, out: "lumi\n", err: "" } : undefined) });
    expect(await up(there.io, there.fake.base, { "--account": ["lumi"] })).toBe(1);
    // As a system relay's account, from its copies and from its own install: the lines it gives root.
    const signed = at({ uid: lumi, bun: "/var/lib/lumirpengine/bun", self: "/var/lib/lumirpengine/lumirpengine.js", files: unit });
    session(signed, "ended");
    expect(await run(signed, "login", { "--config": [CONFIG] })).toBe(0);
    const account = at({ uid: lumi, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", files: unit });
    session(account, account.fake.session());
    expect(await run(account, "down")).toBe(1);
    await run(account, "status");
    // Every command line it printed, indented on its own, after a colon or in backquotes (the unit file's first line).
    const text = [...ran.flatMap((m) => [m.words(), ...m.files.values()]), written].join("\n");
    const lines = [...text.matchAll(/(?:^ {2}|: |`)((?:sudo|systemctl|chmod|\/)[^`\n]*)/gm)].map((x) => x[1] ?? "").filter((l) => !/^\S+:(\s|$)/.test(l));
    const removal = `sudo systemctl disable --now ${UNIT} && sudo rm /etc/systemd/system/${UNIT} && sudo systemctl daemon-reload`;
    for (const line of [removal, `systemctl status ${UNIT}`, `sudo systemctl restart ${UNIT}`, "sudo loginctl enable-linger lumi", `sudo -u lumi /home/lumi/.bun/bin/bun --cwd / /srv/lre/dist/lumirpengine.js loopback up --url ${lumis.fake.base} --systemd`]) expect(lines).toContain(line);
    expect(lines.filter((l) => l === removal).length).toBeGreaterThanOrEqual(5);
    expect(lines.some((l) => l.startsWith("sudo /usr/local/bin/bun --cwd / /opt/lre/lumirpengine.js loopback up"))).toBe(true);
    for (const line of lines) for (const words of rootRuns(line)) expect({ line, runs: copyRun(words) }).toEqual({ line, runs: null });
    // A system relay's, those that name its unit, have root run systemd's own programs alone.
    for (const line of lines.filter((l) => l.includes(UNIT))) for (const [program = ""] of rootRuns(line)) expect({ line, program, allowed: SYSTEM_RELAY_ROOT_PROGRAMS.includes(program) }).toEqual({ line, program, allowed: true });
  });
});

describe("as the account itself", () => {
  test("up reaches the account's own service manager though sudo -u left XDG_RUNTIME_DIR unset, and says to turn lingering on when it isn't running", async () => {
    const lumi = 1001;
    const own = { "/home/lumi/.bun/bin/bun": lumi, "/srv/lre/dist/lumirpengine.js": lumi };
    const answer = (reachable: boolean) => (ran: Ran) => {
      if (ran.command === "id") return { code: 0, out: "lumi\n", err: "" };
      if (ran.command === "loginctl") return ran.args[0] === "enable-linger" ? { code: 1, out: "", err: "Interactive authentication required." } : { code: 0, out: "no\n", err: "" };
      if (ran.command === "systemctl") return ran.env?.XDG_RUNTIME_DIR === `/run/user/${lumi}` && reachable ? undefined : { code: 1, out: "", err: "Failed to connect to bus: No medium found" };
      return undefined;
    };
    // Its manager runs (the account is logged in somewhere): installed, though only while logged in.
    const running = machine({ uid: lumi, bun: "/home/lumi/.bun/bin/bun", self: "/srv/lre/dist/lumirpengine.js", owners: own, answer: answer(true) });
    expect(await up(running.io, running.fake.base)).toBe(0);
    expect(running.runs.filter((r) => r.command === "systemctl").map((r) => [r.args, r.env])).toEqual([
      [["--user", "daemon-reload"], { XDG_RUNTIME_DIR: `/run/user/${lumi}` }],
      [["--user", "enable", UNIT], { XDG_RUNTIME_DIR: `/run/user/${lumi}` }],
      [["--user", "restart", UNIT], { XDG_RUNTIME_DIR: `/run/user/${lumi}` }],
    ]);
    expect(running.words()).toContain("sudo loginctl enable-linger lumi");
    // No manager runs: it says what to run first, then this again.
    const stopped = machine({ uid: lumi, bun: "/home/lumi/.bun/bin/bun", self: "/srv/lre/dist/lumirpengine.js", owners: own, answer: answer(false) });
    expect(await up(stopped.io, stopped.fake.base)).toBe(1);
    expect(stopped.words()).toContain("lumi's service manager isn't running (lingering is off, and lumi isn't logged in), so the relay's user service can't start. Turn lingering on with: sudo loginctl enable-linger lumi, then run this again.");
  });

  test("up never takes the name of a relay a system service runs here, which would take its registration", async () => {
    const m = machine({ uid: 1001, bun: "/home/lumi/.bun/bin/bun", self: "/srv/lre/dist/lumirpengine.js", files: { [CONFIG]: "{}" } });
    expect(await up(m.io, m.fake.base)).toBe(2);
    expect(m.words()).toContain(`A system service runs the relay "${USER.username}" on this machine (${CONFIG})`);
    expect(m.fake.lre.sent("lre.loopback.register")).toEqual([]);
  });

  // The depth release's late security review, S4: pasted from another login without its sudo -u, the line ran there, and installed as that login's own service, files the Lumiverse account can change.
  test("from another login, up refuses files another account can change, before it signs in, and says how to run it as that account; its own files under a sticky directory of root's (/tmp) run", async () => {
    const lumi = 1001;
    const ops = 1000;
    const m = machine({
      uid: ops,
      bun: "/home/lumi/.bun/bin/bun",
      self: "/srv/lre/dist/lumirpengine.js",
      owners: { "/home/lumi/.bun/bin/bun": lumi, "/srv/lre/dist/lumirpengine.js": lumi, "/srv/lre/dist": lumi },
      answer: ({ command, args }) => (command === "id" ? { code: 0, out: args[1] === String(lumi) ? "lumi\n" : "ops\n", err: "" } : undefined),
    });
    expect(await up(m.io, m.fake.base)).toBe(1);
    const said = m.words();
    expect(said).toContain("Refusing to run as ops: another account can change these, and would then run code as ops through this command.");
    expect(said).toContain("  /srv/lre/dist/lumirpengine.js: lumi can change it");
    expect(said).toContain("  /home/lumi/.bun/bin/bun: lumi can change it");
    expect(said).toContain(`  sudo -u lumi /home/lumi/.bun/bin/bun --cwd / /srv/lre/dist/lumirpengine.js loopback up --url ${m.fake.base} --username ${USER.username} --systemd`);
    expect(said).not.toContain("For a system service instead");
    expect(m.fake.requests).toEqual([]);
    expect(m.fake.lre.sent("lre.loopback.register")).toEqual([]);
    const own = machine({ uid: ops, bun: "/tmp/ops/bun", self: "/tmp/ops/lre/lumirpengine.js", owners: { "/tmp/ops": ops, "/tmp/ops/bun": ops, "/tmp/ops/lre": ops, "/tmp/ops/lre/lumirpengine.js": ops }, modes: { "/tmp": 0o1777 } });
    expect(await up(own.io, own.fake.base)).toBe(0);
  });

  // The depth release's late security review, S1: a system relay's Sign-in ran root's copy of the account's install as root. Its account runs it now, and can't rename a file into root's directory.
  test("login as a system relay's account writes its config in place, and leaves the restart to root", async () => {
    const m = machine({ uid: 1001, bun: "/var/lib/lumirpengine/bun", self: "/var/lib/lumirpengine/lumirpengine.js", files: { [`/etc/systemd/system/${UNIT}`]: "[Unit]" } });
    m.files.set(CONFIG, JSON.stringify({ lumirpengine: 1, loopback: { name: USER.username, base: m.fake.base, listen: "127.0.0.1", port: 7861, mode: "user", relay: "rl-1", secret: "s3cret", session: { username: USER.username, token: "ended", savedAt: 0 }, tuning: {} } }));
    expect(await loopback({ positionals: ["login"], values: { "--config": [CONFIG] }, flags: {} }, m.io)).toBe(0);
    expect(m.rewritten).toEqual([CONFIG]);
    const saved: unknown = JSON.parse(m.files.get(CONFIG) ?? "null");
    expect(isRecord(saved) && isRecord(saved.loopback) && isRecord(saved.loopback.session) ? saved.loopback.session.token : null).not.toBe("ended");
    expect(m.runs.filter((r) => r.command === "systemctl")).toEqual([]);
    expect(m.words()).toContain(`restart it as root to have it at once: sudo systemctl restart ${UNIT}`);
  });

  // The final security review, F1: root never runs a system service's copies, so its account is told systemd's own lines for the unit, which is root's.
  test("down and status of a system relay give systemd's own lines for its unit, instead of saying there is none", async () => {
    const m = machine({ uid: 1001, bun: "/usr/local/bin/bun", self: "/opt/lre/lumirpengine.js", files: { [`/etc/systemd/system/${UNIT}`]: "[Unit]" } });
    m.files.set(CONFIG, JSON.stringify({ lumirpengine: 1, loopback: { name: USER.username, base: m.fake.base, listen: "127.0.0.1", port: 7861, mode: "user", relay: "rl-1", secret: "s3cret", session: { username: USER.username, token: m.fake.session(), savedAt: 0 }, tuning: {} } }));
    expect(await loopback({ positionals: ["down"], values: { "--name": [USER.username] }, flags: {} }, m.io)).toBe(1);
    expect(m.words()).toContain(`  sudo systemctl disable --now ${UNIT} && sudo rm /etc/systemd/system/${UNIT} && sudo systemctl daemon-reload`);
    expect(m.words()).not.toContain("nothing to stop");
    expect(m.files.has(`/etc/systemd/system/${UNIT}`)).toBe(true);
    await loopback({ positionals: ["status"], values: { "--name": [USER.username] }, flags: {} }, m.io);
    expect(m.words()).toContain(`systemctl status ${UNIT}`);
    expect(m.words()).not.toContain("No service");
    expect(m.runs.filter((r) => r.command === "systemctl")).toEqual([]);
  });

  // The depth release's late live run, L3c-1: core made its data directories 775 (umask 0002) in its account's own group, and up refused them, then refused again as its own guidance said.
  describe("group-writable directories of its own", () => {
    const dev = 1001;
    const self = "/tmp/d0a/data/extensions/lumi_rp_engine/repo/dist/lumirpengine.js";
    const bun = "/srv/lumiverse/dev/.bun/bin/bun";
    const core = ["/tmp/d0a/data", "/tmp/d0a/data/extensions", "/tmp/d0a/data/extensions/lumi_rp_engine"];
    const mine = [...core, "/tmp/d0a", "/tmp/d0a/data/extensions/lumi_rp_engine/repo", "/tmp/d0a/data/extensions/lumi_rp_engine/repo/dist", self, `/tmp/d0a/data/extensions/lumi_rp_engine/repo/dist/${KIT_FILE}`, bun];
    const PASSWD = "root:x:0:0:root:/root:/bin/bash\nops:x:1000:1000::/home/ops:/bin/bash\nlumiverse-dev:x:1001:1001::/srv/lumiverse/dev:/bin/bash\n";
    /** The group getent gives (its line), the accounts it lists, any modes over core's, and whether there is a getent at all. */
    type Setup = { group?: string; passwd?: string; modes?: Record<string, number>; getent?: boolean };
    const as = (o: Setup = {}) =>
      machine({
        uid: dev,
        bun,
        self,
        owners: Object.fromEntries(mine.map((p) => [p, dev])),
        groups: Object.fromEntries(mine.map((p) => [p, dev])),
        modes: { "/tmp": 0o1777, ...Object.fromEntries(core.map((p) => [p, 0o775])), ...o.modes },
        answer: ({ command, args }) => {
          if (command === "id") return { code: 0, out: "lumiverse-dev\n", err: "" };
          if (command !== "getent") return undefined;
          if (o.getent === false) return { code: 127, out: "", err: "getent: not found" };
          if (args[0] === "passwd") return { code: 0, out: o.passwd ?? PASSWD, err: "" };
          return args[0] === "group" && args[1] === String(dev) ? { code: 0, out: `${o.group ?? "lumiverse-dev:x:1001:"}\n`, err: "" } : { code: 2, out: "", err: "" };
        },
      });

    test("run, when no account but the owner is in the group", async () => {
      const m = as();
      expect(await up(m.io, m.fake.base)).toBe(0);
      expect(m.words()).not.toContain("Refusing");
      // A group that lists its account as a member is still its alone.
      const listed = as({ group: "lumiverse-dev:x:1001:lumiverse-dev" });
      expect(await up(listed.io, listed.fake.base)).toBe(0);
    });

    test("refuse when another account is in the group, and name the chmod g-w that stops it, never a sudo -u back to the same account", async () => {
      const refused = async (o: Setup): Promise<{ said: string; base: string }> => {
        const m = as(o);
        expect(await up(m.io, m.fake.base)).toBe(1);
        expect(m.fake.requests).toEqual([]);
        return { said: m.words(), base: m.fake.base };
      };
      // A listed member, and an account whose primary group it is.
      for (const o of [{ group: "lumiverse-dev:x:1001:ops" }, { passwd: `${PASSWD}guest:x:1002:1001::/home/guest:/bin/sh\n` }]) {
        const { said, base } = await refused(o);
        expect(said).toContain("Refusing to run as lumiverse-dev: an account other than lumiverse-dev can change these");
        for (const p of core) expect(said).toContain(`  ${p}: its group, lumiverse-dev, can change it`);
        expect(said).toContain(
          [
            "Take that write away, then run it again:",
            "  chmod g-w /tmp/d0a/data/extensions/lumi_rp_engine",
            "  chmod g-w /tmp/d0a/data/extensions",
            "  chmod g-w /tmp/d0a/data",
            `  ${bun} --cwd / ${self} loopback up --url ${base} --username ${USER.username} --systemd`,
          ].join("\n"),
        );
        expect(said).not.toContain("sudo -u");
        expect(said).not.toContain("<the account Lumiverse runs as>");
      }
      // A member getent can't name, or no getent at all (macOS): who is in the group is unknown.
      expect((await refused({ group: "lumiverse-dev:x:1001:ghost" })).said).toContain("  chmod g-w /tmp/d0a/data\n");
      expect((await refused({ getent: false })).said).toContain("  /tmp/d0a/data: its group, 1001, can change it");
      // Everyone else's write is never its own, whoever is in the group.
      const others = (await refused({ modes: { "/tmp/d0a/data": 0o777 } })).said;
      expect(others).toContain("  /tmp/d0a/data: everyone else can change it");
      expect(others).toContain("  chmod o-w /tmp/d0a/data\n");
      expect(others).not.toContain("/tmp/d0a/data/extensions:");
    });
  });
});

test("a relay its system unit runs, as the unit's account, reports a system unit", async () => {
  const lumi = 1001;
  const m = machine({ uid: lumi, bun: "/var/lib/lumirpengine/bun", self: "/var/lib/lumirpengine/lumirpengine.js", env: { INVOCATION_ID: "a1b2" } });
  const token = m.fake.session();
  m.files.set(CONFIG, JSON.stringify({ lumirpengine: 1, loopback: { name: USER.username, base: m.fake.base, listen: "127.0.0.1", port: 7861, mode: "user", relay: "rl-1", secret: "s3cret", session: { username: USER.username, token, savedAt: 0 }, tuning: {} } }));
  const reported = Promise.withResolvers<unknown>();
  const handle = m.fake.lre.handle.bind(m.fake.lre);
  m.fake.lre.handle = (r) => {
    if (r.type !== "lre.loopback.hello") return handle(r);
    reported.resolve(r.report);
    return { lre: 1, type: "lre.result", reqId: r.reqId, request: r.type, body: { relay: "rl-1", api: 1, build: "dev", mode: "user", model: "lre-narrator", heartbeatMs: 60_000, lost: [] } };
  };
  const serving = loopback({ positionals: ["serve"], values: { "--config": [CONFIG] }, flags: {} }, m.io);
  const report = await reported.promise;
  m.stopped.resolve("SIGTERM");
  expect(await serving).toBe(0);
  expect(isRecord(report) && isRecord(report.runtime) ? report.runtime.unit : null).toEqual({ name: UNIT, scope: "system" });
});
