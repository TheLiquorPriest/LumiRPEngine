// Following the extension's agent kit (DESIGN §23). LumiRPEngine says which build it is, where its
// kit is and what the kit hashes to. A kit that is followed runs with this user's rights, so it is
// loaded only when the file, its symlinks resolved, is laid out as an installed extension's kit on
// this machine, no other user can change it or the directories it sits in (on POSIX), its sha256
// is the one reported and its build isn't the loaded kit's: then it is imported from the very bytes
// that were hashed and becomes the server's. Anything else keeps the tools already loaded, and says
// why. `--pin` keeps the bundled kit whatever is said.

import type { FollowCode, KitReport } from "../shared/agents";
import { KIT_API, kitPathProblem, NPM_INSTALL } from "../shared/agents";
import { isRecord } from "../shared/json";
import type { AgentKit } from "./kit-api";
import { kitOf } from "./kit-api";

/** Who owns a file or directory, and its mode, as `stat` gives them. */
export interface Owned {
  uid: number;
  mode: number;
}

/** The machine side: the entry (main.ts) does it with Node's fs. Each rejects with the system's error, whose `code` says why (ENOENT, EACCES…). */
export interface KitFiles {
  /** The path with every symlink in it resolved. */
  realpath(path: string): Promise<string>;
  /** A directory's owner and mode: the entry's own, a symlink's rather than what it points to. */
  stat(path: string): Promise<Owned>;
  /** The file's bytes, with the owner and mode of the very file they were read from. */
  read(path: string): Promise<Owned & { bytes: Uint8Array<ArrayBuffer> }>;
  /** The user this process runs as, who (or root) must own a kit; null where owners aren't checked (Windows has no such mode bits). */
  readonly uid: number | null;
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
  /** Why this runtime can't load a kit at all (Bun before 1.4), or null: then following is off before it is tried. */
  cannotLoad: string | null;
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

/** Write bits for the file's group and for others. */
const SHARED_WRITE = 0o022;

/** Only this user or root can change it: one of theirs, and writable by no one else. */
function ownersOnly(entry: Owned, uid: number): boolean {
  return (entry.uid === uid || entry.uid === 0) && (entry.mode & SHARED_WRITE) === 0;
}

/**
 * The directories a kit at `real` (laid out as an installed extension's) sits in, from
 * `extensions/` down to `dist/`: whoever can write one of them can put another file in its place.
 */
function kitDirs(real: string): string[] {
  const dirs: string[] = [];
  for (let at = real, i = 0; i < 4; i++) {
    at = at.slice(0, Math.max(at.lastIndexOf("/"), at.lastIndexOf("\\")));
    dirs.unshift(at);
  }
  return dirs;
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
    // Until LumiRPEngine says otherwise, a server that isn't pinned, on a runtime that can load a kit, means to follow.
    this.state = options.pin ? { follows: false, why: { code: "pinned", text: "--pin (or LRE_PIN_KIT) keeps the tools this lumirpengine was installed with: run it without to follow LumiRPEngine's" } } : options.cannotLoad !== null ? { follows: false, why: { code: "runtime", text: options.cannotLoad } } : { follows: true, why: null };
  }

  /** It follows at all: not pinned, and on a runtime that can load a kit. */
  get able(): boolean {
    return !this.options.pin && this.options.cannotLoad === null;
  }

  /** Takes what LumiRPEngine said; true when the loaded kit changed. */
  async follow(news: KitNews): Promise<boolean> {
    if (!this.able) return false;
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

  /** Resolves, checks, reads and (when its build is another) imports the kit at `report.path`. */
  private async look(report: KitReport, build: string): Promise<Verdict> {
    const { files, identifier } = this.options;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      // Its symlinks resolved: a path laid out as an extension's kit can still lead anywhere.
      const real = await files.realpath(report.path);
      const problem = kitPathProblem(real, identifier);
      if (problem !== null) return { code: "refused", text: `LumiRPEngine named ${report.path} as its tools, whose real path ${real} ${problem}, so it wasn't loaded` };
      // Whoever can change the kit, or a directory it sits in, chooses the code this user runs: a file another user planted is never loaded.
      const { uid } = files;
      if (uid !== null) for (const dir of kitDirs(real)) if (!ownersOnly(await files.stat(dir), uid)) return { code: "unsafe", text: `${dir} can be changed by other users` };
      // The owner is the very file's whose bytes these are, so nothing swapped in after the checks is read unchecked.
      const file = await files.read(real);
      if (uid !== null && !ownersOnly(file, uid)) return { code: "unsafe", text: `${real} can be changed by other users` };
      bytes = file.bytes;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "ENOENT" || code === "ENOTDIR") return { code: "elsewhere", text: `LumiRPEngine's tools aren't on this machine (${report.path}): this lumirpengine runs on another machine than Lumiverse, so update it there (${NPM_INSTALL})` };
      return { code: "unreadable", text: `LumiRPEngine's tools at ${report.path} can't be read here (${error instanceof Error ? error.message : String(error)}): run lumirpengine as a user who can read Lumiverse's extensions folder` };
    }
    // The hash is LumiRPEngine's word for the kit its build was made with. It catches a kit read while
    // it was being written, or rebuilt since LumiRPEngine started; it is no guard against LumiRPEngine
    // itself, which can name any hash. That guard is the path and owner checks above.
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
