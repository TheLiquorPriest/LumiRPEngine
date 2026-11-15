// Terminal screens (PlanScenarios-3 item 3): a command typed on the bed's server is kept as the owner would see it, the command as typed and every line it
// printed, in the terminal's own format; a command that names what the run must not touch is not run; and a form reads the terminal as a page.

import { expect, test } from "bun:test";
import { commandShell, linesOf, type Printed, type Shell, Terminal, WithTerminal } from "../../../scripts/proof/live/terminal";
import { OutOfBounds } from "../../../scripts/proof/live/instance";
import type { Browser, Shot } from "../../../scripts/proof/route/host";

/** A command whose printed answer was recorded: the shell the terminal types into answers it, and notes what it was typed. */
function recorded(printed: Printed): Shell & { typed: string[] } {
  const typed: string[] = [];
  return {
    typed,
    async run(command) {
      typed.push(command);
      return printed;
    },
  };
}

test("a recorded command keeps the command as typed and every printed line, blank ones too, as the screen the owner would see", async () => {
  const lines = ["Reading the previous build's folders", "", ...Array.from({ length: 40 }, (_, i) => `moved chat ${i + 1} of 40`), "", "Done: 40 chats moved, nothing left behind."];
  const shell = recorded({ lines, exit: 0 });
  const terminal = new Terminal(shell, []);
  const ran = await terminal.run("rpe migrate --report");
  expect(shell.typed).toEqual(["rpe migrate --report"]);
  expect(ran.screen).toBe(["$ rpe migrate --report", ...lines].join("\n"));
  expect(ran.screen.split("\n")).toHaveLength(lines.length + 1);
  const shot = terminal.shot();
  expect(shot.format).toBe("txt");
  expect(shot.page).toBe("terminal");
  expect(shot.width).toBe(terminal.columns);
  expect(shot.text).toBe(ran.screen);
  // The saved file is the same text, so the screen shows what a check read.
  expect(new TextDecoder().decode(shot.image)).toBe(`${ran.screen}\n`);
});

test("a real command's two streams come in the order printed, with line ends and colour codes as a terminal shows them", async () => {
  const shell = commandShell(["bash", "-c"]);
  const printed = await shell.run("printf 'first\\n\\nsecond\\r\\n'; sleep 0.05; echo 'third' 1>&2; sleep 0.05; printf '\\033[31mfourth\\033[0m\\n'; exit 3");
  expect(printed.lines).toEqual(["first", "", "second", "third", "fourth"]);
  expect(printed.exit).toBe(3);
  expect(linesOf("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
  expect(linesOf("")).toEqual([]);
});

test("a command that names something on the never-touch list is refused before it is run, naming it", async () => {
  const shell = recorded({ lines: ["never printed"], exit: 0 });
  const terminal = new Terminal(shell, ["rpe-private", "7860"]);
  await expect(terminal.run("systemctl --user stop rpe-private.service")).rejects.toThrow(OutOfBounds);
  await expect(terminal.run("curl http://127.0.0.1:7860/")).rejects.toThrow("7860");
  await expect(terminal.run("   ")).rejects.toThrow("no command");
  expect(shell.typed).toEqual([]);
  expect(() => terminal.screen).toThrow("no command");
});

test("a form reads the terminal as a page: the command typed and sent, the screen read, waited for and saved as text, and the other pages left to the page driver", async () => {
  const opened: string[] = [];
  const pages = {
    async open(page: string, width?: number) {
      opened.push(`${page}@${width}`);
    },
    async screen(): Promise<Shot> {
      return { image: new Uint8Array(), format: "png", page: "Live", width: 390, text: "Live" };
    },
  } as unknown as Browser;
  const terminal = new Terminal(recorded({ lines: ["rpe is up", "listening on the extension's port"], exit: 0 }), []);
  const look = new WithTerminal(pages, terminal);

  await look.open("Live", 390);
  expect(opened).toEqual(["Live@390"]);
  expect((await look.screen()).format).toBe("png");

  await look.open("terminal");
  await look.find({ label: "Command" });
  await look.type({ label: "Command" }, "rpe up");
  await look.press({ label: "Enter" });
  await look.waitFor({ text: "rpe is up" });
  expect(await look.read()).toBe("$ rpe up\nrpe is up\nlistening on the extension's port");
  const shot = await look.screen();
  expect(shot.format).toBe("txt");
  expect(shot.page).toBe("terminal");
  expect(shot.text).toBe(await look.read());
  await look.show({ text: "rpe is up" });
  expect(opened).toEqual(["Live@390"]);

  await expect(look.waitFor({ text: "rpe is down" })).rejects.toThrow("never showed: rpe is down");
  await expect(look.press({ label: "Resume" })).rejects.toThrow("no control labelled Resume");
  await expect(look.type({ label: "Message" }, "hello")).rejects.toThrow("no control labelled Message");
  await expect(look.scroll()).rejects.toThrow("does not scroll");
  await expect(look.read("Notes")).rejects.toThrow("no section named Notes");
  await expect(look.open("terminal", 390)).rejects.toThrow("no width");
});
