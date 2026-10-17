// REST access to a Lumiverse dev host for integration scripts. Everything machine- or account-specific
// comes from the environment, with no defaults:
//   LRE_HOST_URL       the host's base URL, e.g. http://127.0.0.1:7860
//   LRE_DATA_DIR       the host's data directory (logs and extension storage are read from it)
//   LRE_HOST_USER      the owner's username
//   LRE_HOST_PASSWORD  the owner's password (never printed)

export const IDENTIFIER = "lumi_rp_engine";

/** A required setting; a script that needs one stops with what to set. */
export function env(name: "LRE_HOST_URL" | "LRE_DATA_DIR" | "LRE_HOST_USER" | "LRE_HOST_PASSWORD" | "LRE_OWNER_ID" | "LRE_CHARACTER_ID"): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} (see the header of scripts/host/lib.ts)`);
  return value;
}

export const hostUrl = (): string => env("LRE_HOST_URL").replace(/\/+$/, "");
export const dataDir = (): string => env("LRE_DATA_DIR").replace(/\/+$/, "");

let cookie = "";

export async function signIn(): Promise<void> {
  const base = hostUrl();
  const r = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ username: env("LRE_HOST_USER"), password: env("LRE_HOST_PASSWORD") }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status}`);
  cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function api(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: unknown; ms: number }> {
  const base = hostUrl();
  const t0 = performance.now();
  const r = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const text = await r.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Plain-text answer.
  }
  return { status: r.status, data, ms: performance.now() - t0 };
}
