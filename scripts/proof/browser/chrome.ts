// The browser the proof's driver runs pages in: a headless Chrome or Chromium the machine already has,
// started with a throw-away profile and a debugging port of its own on loopback (PlanScenarios-2 item 2:
// it runs offline and adds no package to what RPE ships). Which browser it was, and its version, is read
// from the browser itself and goes into the run's record.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cdp } from "./cdp";

/** A running browser: its connection, what it says it is, and how to put it away. */
export interface Chrome {
  cdp: Cdp;
  /** The browser's name as it gives it (`Chrome`). */
  name: string;
  /** Its version as it gives it (`157.0.8103.51`). */
  version: string;
  close(): Promise<void>;
}

/** Where a Chrome or a Chromium usually is, tried in order after `RPE_PROOF_BROWSER`. */
const USUAL: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

/** The browser to start: the one `RPE_PROOF_BROWSER` names, else the first usual place that has one, else one named on the path; refused, saying so, when there is none. */
export function chromePath(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync, onPath: (name: string) => string | null = Bun.which): string {
  const named = env.RPE_PROOF_BROWSER;
  if (named !== undefined && named !== "") {
    if (!exists(named)) throw new Error(`RPE_PROOF_BROWSER names ${named}, and there is no browser there`);
    return named;
  }
  const found = USUAL.find((path) => exists(path));
  if (found) return found;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const path = onPath(name);
    if (path) return path;
  }
  throw new Error(`no Chrome or Chromium was found (looked in ${USUAL.join(", ")} and on the path): install one, or name it in RPE_PROOF_BROWSER`);
}

/** Starts a headless browser with a profile of its own and connects to it; waits no longer than `limitMs` for it to say where it listens. */
export async function launchChrome(options: { path?: string; limitMs?: number } = {}): Promise<Chrome> {
  const path = options.path ?? chromePath();
  const limitMs = options.limitMs ?? 30_000;
  const profile = mkdtempSync(join(tmpdir(), "rpe-proof-chrome-"));
  const child = Bun.spawn([path, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--disable-extensions", "--disable-background-networking", "--mute-audio", "--force-device-scale-factor=1", "about:blank"], { stdout: "ignore", stderr: "pipe" });
  const put = async () => {
    child.kill();
    await child.exited;
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const url = await listening(child.stderr, limitMs);
    const cdp = await Cdp.connect(url);
    const { product } = await cdp.send<{ product: string }>("Browser.getVersion");
    const [name = "Chrome", version = ""] = product.split("/");
    return {
      cdp,
      name,
      version,
      async close() {
        cdp.close();
        await put();
      },
    };
  } catch (error) {
    await put();
    throw error;
  }
}

/** The address the browser says it listens at, read from what it prints as it starts. */
async function listening(stderr: ReadableStream<Uint8Array>, limitMs: number): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let printed = "";
  const timer = setTimeout(() => void reader.cancel(), limitMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      printed += decoder.decode(value);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(printed);
      if (found?.[1]) {
        // The browser goes on printing: read it out, so it never blocks on a full pipe.
        void (async () => {
          for (;;) if ((await reader.read()).done) return;
        })();
        return found[1];
      }
    }
  } finally {
    clearTimeout(timer);
  }
  throw new Error(`the browser did not say where it listens within ${limitMs} ms${printed.trim() === "" ? "" : `; it printed: ${printed.trim().slice(0, 400)}`}`);
}
