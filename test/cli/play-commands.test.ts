// The commands of the tools LumiRPEngine serves (the chat and lore tools, DESIGN §23) as the entry
// runs them (`run`), over a fake Lumiverse that lists them as the backend does: help shows them once
// signed in, each command is built from its tool's listed mirror (its own switches read as switches),
// and each positional and option reaches the argument it names in the call forwarded as
// `lre.tools call`, read-only included; the backend's own refusals are test/backend/outside-tools'.

import { expect, test } from "bun:test";
import { servedTools } from "../../src/backend/agents/tools/outside";
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

test("the served tools' commands are built from their listed mirrors, and forward their arguments as lre.tools call, read-only included", async () => {
  const fake = new FakeLumiverse();
  fake.lre.served = servedTools({});
  const help = signedIn(fake);
  expect(await run(["help"], help.io)).toEqual({ code: 0 });
  expect(help.out.join("\n")).toContain("Playing a chat on Lumiverse\n  chat <chatId> [--pointer <p>] [--offset <n> | --from <n> [--limit <n>]]");
  expect(help.out.join("\n")).toContain("Lore\n  lore-books [<chatId>]");

  // The fake LumiRPEngine answers each call with an error, so each exits 1; what it was asked is the point.
  const calls = (): unknown[] => fake.lre.sent("lre.tools", "call");
  await run(["fix", "c1", "--entity", "pov", "--field", "mood", "--value", '"calm"'], signedIn(fake).io);
  await run(["marker", "c1", "--kind", "time", "--control", "scale", "--to", "2", "--preview"], signedIn(fake).io);
  await run(["gm-edit", "c1", "--spoilers", "--ops", '[{"op":"move","entity":"pov","to":"yard"}]'], signedIn(fake).io);
  await run(["minds-run", "c1", "--spoilers", "--who", "dev,sam"], signedIn(fake).io);
  // --compact is lre_gm's own switch: read as one only once its mirror is listed.
  await run(["gm", "c1", "--spoilers", "--compact", "--part", "entities"], signedIn(fake).io);
  await run(["lore-pins", "--chat", "c1", "--spoilers"], signedIn(fake).io);
  const readOnly = signedIn(fake);
  expect(await run(["fix", "c1", "--time", "2026-09-14 09:30", "--read-only"], readOnly.io)).toEqual({ code: 1 });
  expect(calls()).toEqual([
    { type: "lre.tools", op: "call", name: "lre_fix", args: { chatId: "c1", entity: "pov", field: "mood", value: "calm" }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_marker", args: { chatId: "c1", kind: "time", control: "scale", to: 2, preview: true }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_gm_edit", args: { chatId: "c1", spoilers: true, ops: [{ op: "move", entity: "pov", to: "yard" }] }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_minds_run", args: { chatId: "c1", spoilers: true, who: ["dev", "sam"] }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_gm", args: { chatId: "c1", spoilers: true, part: "entities", compact: true }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_lore_pins", args: { chatId: "c1", spoilers: true }, readOnly: false },
    { type: "lre.tools", op: "call", name: "lre_fix", args: { chatId: "c1", time: "2026-09-14 09:30" }, readOnly: true },
  ]);
  expect(readOnly.err.join("\n")).toContain("the fake ran lre_fix");

  // A command neither this client nor LumiRPEngine has is no command.
  const none = signedIn(fake);
  expect(await run(["no-such-command", "c1"], none.io)).toEqual({ code: 2 });
  expect(none.err.join("\n")).toContain("There is no command no-such-command.");
});
