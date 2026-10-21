// The commands of the tools kept in files of their own: each positional and option fills the tool
// argument its mirror names, a switch takes no value, and read-only refuses a change before
// anything is sent.

import { describe, expect, test } from "bun:test";
import type { CliIO } from "../../src/cli/commands";
import { run, USAGE } from "../../src/cli/commands";
import { CredentialStore } from "../../src/cli/credentials";
import { FakeLumiverse, USER } from "./fake-lumiverse";

/** A signed-in terminal with nobody at it, reading `files`. */
function signedIn(fake: FakeLumiverse, files: Record<string, string> = {}, env: Record<string, string> = {}): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  let saved: string | null = null;
  const io: CliIO = {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return text;
    },
    writeFile: () => undefined,
    env,
    stdoutIsTTY: true,
    ask: async () => null,
    credentials: new CredentialStore({ read: () => saved, write: (_path, text) => void (saved = text) }, "credentials.json"),
    http: fake.http,
    openSocket: fake.openSocket,
  };
  io.credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 1 });
  return { io, out, err };
}

describe("the module tools' commands", () => {
  test("fill their tools' arguments from positionals, repeated options, numbers, switches and JSON files", async () => {
    const fake = new FakeLumiverse();
    const t = signedIn(fake, { "ruleset.json": '{"sheet": {"sections": []}}' });
    await run(["job-start", "w_1", "playtest", "--turn", "look around", "--turn", "walk to the market"], t.io);
    expect(fake.lre.sent("lre.job", "start")).toEqual([{ type: "lre.job", op: "start", kind: "playtest", worldId: "w_1", input: { turns: ["look around", "walk to the market"] } }]);
    await run(["map-walk", "c_1", "--x", "3", "--y", "4"], t.io);
    expect(fake.lre.sent("lre.map")).toEqual([{ type: "lre.map", op: "walk", chatId: "c_1", x: 3, y: 4 }]);
    await run(["lore-pins", "--chat", "c_1", "--spoilers"], t.io);
    expect(fake.lre.sent("lre.lore", "pins")).toEqual([{ type: "lre.lore", op: "pins", chatId: "c_1" }]);
    await run(["sheet", "w_1", "--ruleset", "ruleset.json", "--entity", "mara"], t.io);
    expect(fake.lre.sent("lre.world", "sheet")).toEqual([{ type: "lre.world", op: "sheet", worldId: "w_1", ruleset: { sheet: { sections: [] } }, entity: "mara" }]);
  });

  test("a switch takes no value, and a missing positional is a usage error, before anything is sent", async () => {
    const fake = new FakeLumiverse();
    const t = signedIn(fake);
    expect(await run(["diag", "c_1", "--failures=yes"], t.io)).toEqual({ code: 2 });
    expect(await run(["job-apply", "w_1"], t.io)).toEqual({ code: 2 });
    expect(t.err.join("\n")).toContain("job-apply <worldId> <jobId>");
    expect(fake.lre.sent("lre.diag")).toEqual([]);
  });

  test("read-only refuses a change before anything is sent", async () => {
    const fake = new FakeLumiverse();
    const t = signedIn(fake, {}, { LRE_READ_ONLY: "1" });
    expect(await run(["diag-clear", "c_1"], t.io)).toEqual({ code: 1 });
    expect(t.err.join("\n")).toContain("read-only");
    expect(fake.requests).toEqual([]);
  });

  test("are listed in the usage text under their headings", () => {
    for (const line of ["Settings and presets", "settings-set --patch <file|json>", "Jobs", "job-apply <worldId> <jobId>", "lore-save <chatId>", "studio-install <offerId> <hash>"]) expect(USAGE).toContain(line);
  });
});
