// Terminal screens (PlanScenarios-3 item 3; plan §17.0, §15.3): a command typed in a terminal on the bed's server, as the owner would, kept as the
// screen he would see: the command as typed, then every line it printed, stdout and stderr in the order they came, with no line left out. The screen is
// a `Shot` of the format `txt` on the page "terminal" (`route/form.ts`, `TERMINAL`), its width the terminal's columns; the same screen's text is what a
// check reads and what the saved screen shows, one function for both, as it is for a page.
//
// Where the server's terminal is comes from the environment (`LRE_BED_SHELL`, the words of a command that runs its last argument as a shell command on the
// bed's server: `bash -lc` where the run is on the bed, `ssh <the bed>` through ssh), so nothing here names a machine. A command that names anything on the
// run's never-touch list (a path, a port, a unit) is refused before it is run.

import type { Browser, Control, Shot, Shown } from "../route/host";
import { pageSlug, TERMINAL } from "../route/form";
import { OutOfBounds } from "./instance";

/** What a command printed, whole, and how it ended. */
export interface Printed {
  /** Every line it printed, stdout and stderr in the order they came; none dropped, blank lines kept. */
  lines: string[];
  exit: number;
}

/** The server's terminal: runs one command line and says what it printed. */
export interface Shell {
  run(command: string): Promise<Printed>;
}

/** The columns a terminal screen is saved at, when the environment names none. */
export const DEFAULT_COLUMNS = 100;

/** The prompt the screen shows before the command as typed. */
export const PROMPT = "$ ";

// A terminal shows colour and cursor codes as what they paint, never as their bytes: the screen's text holds none.
// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** The lines of what a process printed, as a terminal shows them: line ends of any kind one break, escape codes gone, the last line end not a blank line of its own. */
export function linesOf(printed: string): string[] {
  const text = printed.replace(ESCAPES, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** The screen the owner would see after typing `command`: the command as typed after the prompt, then every line it printed. */
export function screenOf(command: string, lines: readonly string[]): string {
  return [`${PROMPT}${command}`, ...lines].join("\n");
}

/** A shell made of the words of a command that takes the command line as its last argument (`LRE_BED_SHELL`), its two streams read in the order the chunks came. */
export function commandShell(words: readonly string[], env: Record<string, string | undefined> = process.env): Shell {
  if (words.length === 0) throw new Error("the terminal's shell names no command (LRE_BED_SHELL)");
  return {
    async run(command: string): Promise<Printed> {
      const child = Bun.spawn([...words, command], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...env } as Record<string, string> });
      const chunks: string[] = [];
      const take = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) chunks.push(decoder.decode(chunk, { stream: true }));
        chunks.push(decoder.decode());
      };
      await Promise.all([take(child.stdout), take(child.stderr)]);
      const exit = await child.exited;
      return { lines: linesOf(chunks.join("")), exit };
    },
  };
}

/** The words of `LRE_BED_SHELL`, or why there are none. */
export function shellWords(env: Record<string, string | undefined> = process.env): string[] {
  const given = env.LRE_BED_SHELL?.trim();
  if (given === undefined || given === "") throw new Error("set LRE_BED_SHELL to the command that runs its last argument as a shell command on the bed's server (`bash -lc` on the bed itself, `ssh <the bed>` through ssh)");
  return given.split(/\s+/);
}

/** One command the terminal ran: as typed, what it printed, how it ended, and the screen it left. */
export interface Ran extends Printed {
  command: string;
  screen: string;
}

/** A terminal on the bed's server. It holds the last screen, which is what a page of the form named "terminal" shows. */
export class Terminal {
  private last: Ran | null = null;

  constructor(
    private readonly shell: Shell,
    /** The values the run's scripts refuse to touch: a command that names one is not run. */
    private readonly neverTouch: readonly string[],
    readonly columns: number = DEFAULT_COLUMNS,
  ) {}

  /** Types `command` and runs it. A command that names something on the never-touch list is refused, naming it. */
  async run(command: string): Promise<Ran> {
    if (command.trim() === "") throw new Error("the terminal was given no command to type");
    const named = this.neverTouch.find((value) => value !== "" && command.includes(value));
    if (named !== undefined) throw new OutOfBounds(`the command names ${named}, which is on the run's never-touch list; it is not run`);
    const printed = await this.shell.run(command);
    this.last = { command, lines: printed.lines, exit: printed.exit, screen: screenOf(command, printed.lines) };
    return this.last;
  }

  /** The last command's screen; a terminal that has run nothing has nothing to show, and says so. */
  get screen(): string {
    if (this.last === null) throw new Error("the terminal has run no command, so it has no screen");
    return this.last.screen;
  }

  /** The screen as a saved shot: the text and the file are the one text, `txt` in the terminal's own columns. */
  shot(): Shot {
    return { image: new TextEncoder().encode(`${this.screen}\n`), format: "txt", page: TERMINAL, width: this.columns, text: this.screen };
  }
}

/** The two things a terminal has: the line a command is typed into, and the key that sends it. */
const CONTROL_OF: Record<string, "command line" | "enter"> = { command: "command line", terminal: "command line", "command line": "command line", shell: "command line", enter: "enter", return: "enter" };

const controlOf = (control: Control): "command line" | "enter" | undefined => CONTROL_OF[(control.label ?? control.role ?? "").toLowerCase()];
const nameOf = (control: Control): string => control.label ?? control.role ?? "";

/**
 * The browser a form reads with, with the terminal as a page of it: `open("terminal")` (no width) shows the terminal's last screen, a command is typed
 * into the command line and sent with Enter, and what the screen holds is read, waited for and saved as any page's text is. Every other page is the
 * page driver's own.
 */
export class WithTerminal implements Browser {
  private onTerminal = false;
  private line = "";

  constructor(
    private readonly pages: Browser,
    private readonly terminal: Terminal,
  ) {}

  async open(page: string, width?: number): Promise<void> {
    if (pageSlug(page) !== TERMINAL) {
      this.onTerminal = false;
      return await this.pages.open(page, width);
    }
    if (width !== undefined) throw new Error("the terminal has columns of its own and is opened with no width");
    this.onTerminal = true;
  }

  async find(control: Control): Promise<void> {
    if (!this.onTerminal) return await this.pages.find(control);
    if (controlOf(control) === undefined) throw new Error(`no control labelled ${nameOf(control)} on the terminal: it has a command line and Enter`);
  }

  async press(control: Control): Promise<void> {
    if (!this.onTerminal) return await this.pages.press(control);
    if (controlOf(control) !== "enter") throw new Error(`no control labelled ${nameOf(control)} on the terminal: Enter sends the command line`);
    const command = this.line;
    this.line = "";
    await this.terminal.run(command);
  }

  async type(control: Control, text: string): Promise<void> {
    if (!this.onTerminal) return await this.pages.type(control, text);
    if (controlOf(control) !== "command line") throw new Error(`no control labelled ${nameOf(control)} on the terminal: the command goes in its command line`);
    this.line = text;
  }

  async waitFor(shown: Shown): Promise<void> {
    if (!this.onTerminal) return await this.pages.waitFor(shown);
    await this.show(shown);
  }

  async read(section?: string): Promise<string> {
    if (!this.onTerminal) return await this.pages.read(section);
    if (section !== undefined) throw new Error(`the terminal has no section named ${section}`);
    return this.terminal.screen;
  }

  async show(shown: Shown): Promise<void> {
    if (!this.onTerminal) return await this.pages.show(shown);
    // The whole answer is on the saved screen, so what is on it is in view: a text that is not there never showed.
    if ("text" in shown && !this.terminal.screen.includes(shown.text)) throw new Error(`never showed: ${shown.text}`);
    if ("control" in shown) await this.find(shown.control);
  }

  async scroll(within?: Control): Promise<void> {
    if (!this.onTerminal) return await this.pages.scroll(within);
    throw new Error("the terminal's screen holds the whole answer and does not scroll");
  }

  async screen(): Promise<Shot> {
    return this.onTerminal ? this.terminal.shot() : await this.pages.screen();
  }
}
