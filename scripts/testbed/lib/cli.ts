// The engine's own `lumirpengine` command line, from the installed extension, signed in under the
// scripts' folder. Each command runs one of its tools; its answer is JSON on stdout.

import { cliPath, configHome, type TestbedEnv } from "./env";

export class CliError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number,
    readonly output: string,
  ) {
    super(`lumirpengine ${args.slice(0, 3).join(" ")} … exited ${code}: ${output.slice(0, 600)}`);
  }
}

export class Cli {
  constructor(private readonly env: TestbedEnv) {}

  /** Runs one command; resolves with its answer, parsed when it is JSON. */
  async run<T = unknown>(args: string[], options: { input?: string } = {}): Promise<T> {
    const proc = Bun.spawn([process.execPath, cliPath(this.env), ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: configHome(this.env), LUMIVERSE_URL: this.env.hostUrl },
      stdin: options.input !== undefined ? new TextEncoder().encode(options.input) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new CliError(args, code, `${out}\n${err}`.trim());
    try {
      return JSON.parse(out) as T;
    } catch {
      return out as T;
    }
  }
}
