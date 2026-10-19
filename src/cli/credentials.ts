// The saved sign-ins: one Better Auth session token per Lumiverse base URL, with the username it
// signed in as, in a file only its owner can read (0600). The password is never stored. A session
// token is a whole-account credential, so nothing here returns it for display: callers print the
// username and the save time, never the token.

import { hasOwn, isRecord } from "../shared/json";

export interface StoredLogin {
  username: string;
  token: string;
  /** When it was saved, in ms since the epoch. */
  savedAt: number;
  /** The user agreed, at `login --allow-http`, to send the token over plain http to another machine. */
  allowHttp?: true;
}

/** The file system as the store needs it; the entry (main.ts) supplies Node's. */
export interface CredentialFiles {
  /** The file's text, or null when there is none. */
  read(path: string): string | null;
  /** Replaces the file, readable and writable by its owner only, creating its directory (0700) if needed. */
  write(path: string, text: string): void;
}

/**
 * Where the sign-ins live: `%APPDATA%\lumirpengine\credentials.json` on Windows, else
 * `$XDG_CONFIG_HOME/lumirpengine/credentials.json`, or `~/.config/…` when XDG_CONFIG_HOME is unset
 * or not absolute (the XDG spec says to ignore a relative one).
 */
export function credentialsPath(env: Readonly<Record<string, string | undefined>>, platform: string, home: string): string {
  if (platform === "win32") return `${env.APPDATA || `${home}\\AppData\\Roaming`}\\lumirpengine\\credentials.json`;
  const xdg = env.XDG_CONFIG_HOME;
  return `${xdg !== undefined && xdg.startsWith("/") ? xdg : `${home}/.config`}/lumirpengine/credentials.json`;
}

/**
 * A Lumiverse base URL as sign-ins are keyed by it: scheme, host and port (the default port
 * dropped), and a path prefix when Lumiverse is served under one, without a trailing slash.
 */
export function normalizeBase(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" isn't a URL: give Lumiverse's address as you open it in a browser, such as http://localhost:7860`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`"${input}" isn't an http or https URL: give Lumiverse's address as you open it in a browser, such as http://localhost:7860`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Whether a base URL is plain http to another machine, where the password and then the session
 * token would cross the network in clear. The machine's own loopback addresses never leave it.
 */
export function inClear(base: string): boolean {
  const url = new URL(base);
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return !(host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]");
}

const FORMAT = 1;

export class CredentialStore {
  constructor(
    private readonly files: CredentialFiles,
    readonly path: string,
  ) {}

  private load(): Record<string, StoredLogin> {
    const text = this.files.read(this.path);
    if (text === null) return {};
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${this.path} isn't readable JSON. Delete it and sign in again (lumirpengine login).`);
    }
    const hosts = isRecord(raw) && isRecord(raw.hosts) ? raw.hosts : {};
    const out: Record<string, StoredLogin> = {};
    for (const [base, entry] of Object.entries(hosts)) {
      // Only keys that are base URLs as `normalizeBase` writes them (never `__proto__` and the like).
      if (!/^https?:\/\/[^/]/.test(base)) continue;
      if (isRecord(entry) && typeof entry.username === "string" && typeof entry.token === "string") out[base] = { username: entry.username, token: entry.token, savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0, ...(entry.allowHttp === true ? { allowHttp: true } : {}) };
    }
    return out;
  }

  private save(hosts: Record<string, StoredLogin>): void {
    this.files.write(this.path, `${JSON.stringify({ lumirpengine: FORMAT, hosts }, null, 2)}\n`);
  }

  /** The sign-in saved for a base URL. */
  get(base: string): StoredLogin | null {
    const hosts = this.load();
    return hasOwn(hosts, base) ? (hosts[base] ?? null) : null;
  }

  /** The base URLs with a saved sign-in. */
  bases(): string[] {
    return Object.keys(this.load()).sort();
  }

  put(base: string, login: StoredLogin): void {
    this.save({ ...this.load(), [base]: login });
  }

  /** Forgets a base URL's sign-in; whether there was one. */
  remove(base: string): boolean {
    const hosts = this.load();
    if (!hasOwn(hosts, base)) return false;
    delete hosts[base];
    this.save(hosts);
    return true;
  }
}
