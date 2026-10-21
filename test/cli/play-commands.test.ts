// The chat tools' commands as the entry runs them (`run`), over a fake Lumiverse: each positional
// and option reaches the tool's argument it names, so the request sent is the tool's, and the
// spoiler gate and read-only mode refuse before anything is sent.

import { expect, test } from "bun:test";
import type { CliIO } from "../../src/cli/commands";
import { run } from "../../src/cli/commands";
import { CredentialStore } from "../../src/cli/credentials";
import { FakeLumiverse, USER } from "./fake-lumiverse";

/** A signed-in terminal on the fake host: what it prints, and an env of its own. */
function signedIn(fake: FakeLumiverse, env: Record<string, string> = {}): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  let saved: string | null = null;
  const io: CliIO = {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    readFile: (path) => {
      throw new Error(`ENOENT: no such file, open '${path}'`);
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

test("the chat commands send their tools' requests; gm without --spoilers and fix in read-only mode send nothing", async () => {
  const fake = new FakeLumiverse();
  const help = signedIn(fake);
  expect(await run(["help"], help.io)).toEqual({ code: 0 });
  expect(help.out.join("\n")).toContain("Playing a chat on Lumiverse\n  chat <chatId> [--pointer <p>] [--offset <n>]");

  // The fake LumiRPEngine answers none of these, so each exits 1; what it received is the point.
  await run(["fix", "c1", "--entity", "pov", "--field", "mood", "--value", '"calm"'], signedIn(fake).io);
  expect(fake.lre.sent("lre.fix")).toEqual([{ type: "lre.fix", chatId: "c1", entity: "pov", field: "mood", value: "calm" }]);
  await run(["marker", "c1", "--kind", "time", "--control", "scale", "--to", "2", "--preview"], signedIn(fake).io);
  expect(fake.lre.sent("lre.marker")).toEqual([{ type: "lre.marker", chatId: "c1", kind: "time", control: "scale", scope: { all: true }, to: 2, preview: true }]);
  await run(["gm-edit", "c1", "--spoilers", "--ops", '[{"op":"move","entity":"pov","to":"yard"}]'], signedIn(fake).io);
  expect(fake.lre.sent("lre.edit")).toEqual([{ type: "lre.edit", chatId: "c1", ops: [{ op: "move", entity: "pov", to: "yard" }] }]);
  await run(["minds-run", "c1", "--spoilers", "--who", "dev,sam"], signedIn(fake).io);
  expect(fake.lre.sent("lre.minds")).toEqual([{ type: "lre.minds", chatId: "c1", op: "run", who: ["dev", "sam"] }]);

  const before = fake.lre.received.length;
  const gm = signedIn(fake);
  expect(await run(["gm", "c1"], gm.io)).toEqual({ code: 1 });
  expect(gm.err.join("\n")).toContain("spoilers: true");
  const readOnly = signedIn(fake);
  expect(await run(["fix", "c1", "--time", "2026-09-14 09:30", "--read-only"], readOnly.io)).toEqual({ code: 1 });
  expect(readOnly.err.join("\n")).toContain("read-only");
  expect(fake.lre.received.length).toBe(before);
});
