// A rule that fires is told in the chat's thinking block by what a person calls it, its file's title, and as one of his own or one
// that ships with RPE; the Rules page lists it by its title, its name beside it. Played through the stand-in Lumiverse on the
// scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

// After each message that makes tool calls, before the reply goes out, so its line reaches the thinking block.
const LAMP = "---\ndescription: Fixture rule, the lamp is noted after a message with calls.\ntitle: The lamp kept lit\nagents: [author]\nat: after-message\n---\nFixture: note the lamp.\n";

test("a rule of his is told by its title as one of his, a shipped one as a rule that fired, and the Rules page lists his by its title", async () => {
  const reading = { pieces: [{ text: "<intent>One exchange.</intent>" }, { call: "file_read", args: { path: "persistent-workspace/lamp.md" } }] };
  const b = await openTurnBed({ answers: [reading, replying("The lamp turns."), { pieces: [{ text: "Noted." }] }, { pieces: [{ text: "Noted." }] }] });
  beds.push(b);
  // His own rule, at the global level, beside the shipped ones.
  const rules = join(dirname(b.app.paths.globalConfig), ".rules");
  await mkdir(rules, { recursive: true });
  await writeFile(join(rules, "lamp-noted.md"), LAMP, "utf8");

  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  await settledTurn(b, out.generationId!);

  const lines = (b.host.streams.get(out.generationId!)?.reasoning ?? "").split("\n").filter((line) => line.includes("rule"));
  expect(lines).toContain("A rule of yours fired: The lamp kept lit.");
  // Any other rule that fired is one RPE ships, and is not called his.
  for (const line of lines.filter((l) => l !== "A rule of yours fired: The lamp kept lit.")) expect(line).toStartWith("A rule fired: ");

  const listed = await b.page<{ rules: { name: string; title?: string }[] }>("GET", `/api/v1/rules?chat=${CHAT}`);
  expect(listed.body.rules.find((rule) => rule.name === "lamp-noted")?.title).toBe("The lamp kept lit");
});
