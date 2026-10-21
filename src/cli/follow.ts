// Following the extension's agent kit (DESIGN §23). LumiRPEngine says which build it is, where its
// kit is and what the kit hashes to. When that path is laid out as an installed extension's, the
// file is on this machine, its sha256 is the one reported and its build isn't the loaded kit's, the
// kit is imported from the very bytes that were hashed and becomes the server's. Anything else
// keeps the tools already loaded, and says why. `--pin` keeps the bundled kit whatever is said.

import type { FollowCode, KitReport } from "../shared/agents";
import { KIT_API, kitPathProblem, NPM_INSTALL } from "../shared/agents";
import { isRecord } from "../shared/json";
import type { AgentKit } from "./kit-api";
import { kitOf } from "./kit-api";

/** The machine side: the entry (main.ts) reads with Node's fs. */
export interface KitFiles {
  /** The file's bytes; rejects with the system's error, whose `code` says why (ENOENT, EACCES…). */
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
}

export interface FollowState {
  follows: boolean;
  why: { code: FollowCode; text: string } | null;
}

/** What LumiRPEngine said of its build and kit, in a hello's answer or a check's. */
export interface KitNews {
  build?: unknown;
  kit?: unknown;
}

export interface FollowOptions {
  pin: boolean;
  /** The extension's identifier: its kit sits in `…/extensions/<identifier>/repo/dist/`. */
  identifier: string;
  files: KitFiles;
  /** The Lumiverse it was said by, for the reasons given. */
  where(): string;
}

/** What one kit file came to: the kit, or why not. A kit that loaded is kept, so its file isn't read again every minute. */
type Verdict = { kit: AgentKit | null } | { code: FollowCode; text: string };

const SHA256 = /^[0-9a-f]{64}$/;

function reportOf(value: unknown): KitReport | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string" || typeof value.api !== "number" || typeof value.core !== "string") return null;
  return { path: value.path, sha256: value.sha256.toLowerCase(), api: value.api, core: value.core };
}

async function sha256Of(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class KitFollower {
  kit: AgentKit;
  state: FollowState;
  /** The kit file last looked at (path and hash), and what it came to. */
  private looked: { key: string; verdict: Verdict } | null = null;

  constructor(
    bundled: AgentKit,
    private readonly options: FollowOptions,
  ) {
    this.kit = bundled;
    // Until LumiRPEngine says otherwise, a server that isn't pinned means to follow.
    this.state = options.pin ? { follows: false, why: { code: "pinned", text: "--pin (or LRE_PIN_KIT) keeps the tools this lumirpengine was installed with: run it without to follow LumiRPEngine's" } } : { follows: true, why: null };
  }

  /** Takes what LumiRPEngine said; true when the loaded kit changed. */
  async follow(news: KitNews): Promise<boolean> {
    if (this.options.pin) return false;
    const where = this.options.where();
    if (!("kit" in news) || typeof news.build !== "string") return this.cannot("unsupported", `LumiRPEngine on ${where} doesn't say where its tools are: update it in Lumiverse's Extensions tab`);
    if (news.kit === null) return this.cannot("no_kit", `LumiRPEngine on ${where} runs without an agent kit (it was built without one), so there is nothing to follow`);
    const report = reportOf(news.kit);
    if (report === null || !SHA256.test(report.sha256)) return this.cannot("refused", `LumiRPEngine on ${where} described its tools in a way this lumirpengine doesn't read`);
    if (report.api !== KIT_API) return this.cannot("kit_api", report.api > KIT_API ? `LumiRPEngine's tools need a newer lumirpengine (kit API ${report.api}; this one reads ${KIT_API}): install it again (${NPM_INSTALL}) or run the extension's own copy (node ${report.core} mcp)` : `LumiRPEngine's tools are older than this lumirpengine reads (kit API ${report.api}; it reads ${KIT_API}): update LumiRPEngine in Lumiverse's Extensions tab, or run the extension's own copy (node ${report.core} mcp)`);
    const problem = kitPathProblem(report.path, this.options.identifier);
    if (problem !== null) return this.cannot("refused", `LumiRPEngine named ${report.path} as its tools, which ${problem}, so it wasn't loaded`);
    const key = `${report.path}\u0000${report.sha256}`;
    // A refusal is looked at again at the next check: the file may be readable, or rebuilt, by then.
    if (this.looked === null || this.looked.key !== key || "code" in this.looked.verdict) this.looked = { key, verdict: await this.look(report, news.build) };
    const { verdict } = this.looked;
    if ("code" in verdict) return this.cannot(verdict.code, verdict.text);
    this.state = { follows: true, why: null };
    // The kit was read for this build only when the loaded one is another: the same build is the same tools.
    if (verdict.kit === null || verdict.kit === this.kit) return false;
    this.kit = verdict.kit;
    return true;
  }

  /** Reads, checks and (when its build is another) imports the kit at `report.path`. */
  private async look(report: KitReport, build: string): Promise<Verdict> {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await this.options.files.read(report.path);
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "ENOENT" || code === "ENOTDIR") return { code: "elsewhere", text: `LumiRPEngine's tools aren't on this machine (${report.path}): this lumirpengine runs on another machine than Lumiverse, so update it there (${NPM_INSTALL})` };
      return { code: "unreadable", text: `LumiRPEngine's tools at ${report.path} can't be read here (${error instanceof Error ? error.message : String(error)}): run lumirpengine as a user who can read Lumiverse's extensions folder` };
    }
    if ((await sha256Of(bytes)) !== report.sha256) return { code: "mismatch", text: `The kit at ${report.path} isn't the one the running LumiRPEngine was built with (its sha256 differs): its files changed since it started, so restart it in Lumiverse's Extensions tab` };
    if (build === this.kit.build) return { kit: null };
    let module: unknown;
    try {
      // From the bytes that were hashed, as a data URL: nothing can swap the file between the check
      // and the import, and each load is a module of its own (Bun's module cache ignores a file URL's query).
      module = await import(`data:text/javascript;base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")}`);
    } catch (error) {
      return { code: "broken", text: `LumiRPEngine's tools at ${report.path} didn't load (${error instanceof Error ? error.message : String(error)})` };
    }
    const kit = kitOf(module);
    if (typeof kit === "string") return { code: kit.startsWith("it is kit API") ? "kit_api" : "broken", text: `LumiRPEngine's tools at ${report.path} can't be used: ${kit}` };
    if (kit.build !== build) return { code: "broken", text: `The kit at ${report.path} says it is build ${kit.build}, and LumiRPEngine says it is build ${build}` };
    return { kit };
  }

  private cannot(code: FollowCode, text: string): false {
    this.state = { follows: false, why: { code, text } };
    return false;
  }
}
