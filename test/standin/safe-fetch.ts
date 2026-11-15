// Lumiverse's `safeFetch` (`utils/safe-fetch.ts`, staging at a70f4ed2; paths are Lumiverse's `src/`) as Spindle's proxy calls it (`spindle/worker-host.ts:4663-4671`), over the stand-in's network: every hop's URL
// held to http and https (`:274-276`), to no JavaScript path (`:277-279`, `:47-90`) and to no blocked host name (`:190-193`, `:269-272`); a redirect followed by hand, each hop checked again, the method made a GET
// where Lumiverse makes it one, and the credentials left off a hop to another origin (`:442-450`), at most five of them (`:495-504`); the time limit a timer on the host's clock that runs until the body has
// ended (`:381-384`, `:506-562`); an answer that is JavaScript by its type or by the name it is downloaded as refused (`:395-405`); and one past `maxBytes` refused by its declared length and again as it is
// read (`:487-504`). The proxy allows loopback and private addresses (`allowPrivate`), so of `validateHost` (`:267-336`) only the two blocked names matter: the stand-in's names are the handlers it holds, and
// one it has none for is a refused connection, not a name that does not resolve.

import type { HostClock } from "./host";

const MAX_REDIRECTS = 5;
/** `DEFAULT_USER_AGENT` (`:16-23`): Lumiverse's own, from its package's version. */
const USER_AGENT = "Lumiverse/1.3.0";
const BLOCKED_HOSTNAMES: Record<string, true> = { "metadata.g\u006fogle.internal": true, "metadata.g\u006fog": true };

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

export class JavaScriptDownloadError extends Error {
  constructor(reason: string) {
    super(`JavaScript downloads are blocked: ${reason}`);
    this.name = "JavaScriptDownloadError";
  }
}

/** The media types of JavaScript and ECMAScript, current and historical (`:42-62`). */
const JAVASCRIPT_CONTENT_TYPES: Record<string, true> = {
  "text/javascript": true,
  "application/javascript": true,
  "application/ecmascript": true,
  "application/x-ecmascript": true,
  "application/x-javascript": true,
  "text/ecmascript": true,
  "text/javascript1.0": true,
  "text/javascript1.1": true,
  "text/javascript1.2": true,
  "text/javascript1.3": true,
  "text/javascript1.4": true,
  "text/javascript1.5": true,
  "text/jscript": true,
  "text/livescript": true,
  "text/x-ecmascript": true,
  "text/x-javascript": true,
};

/** `isJavaScriptFilename` (`:64-70`): a name that ends `.js`, `.mjs`, `.cjs` or `.es`, percent-encoded bytes decoded first. */
function isJavaScriptFilename(value: string): boolean {
  const decoded = value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return /\.(?:js|mjs|cjs|es)(?:[;/\\]|$)/i.test(decoded.trim());
}

/** `assertNonJavaScriptResponse` (`:72-90`). */
function assertNonJavaScriptResponse(response: Response): void {
  const contentType = (response.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
  if (Object.hasOwn(JAVASCRIPT_CONTENT_TYPES, contentType)) throw new JavaScriptDownloadError(`response Content-Type is ${contentType}`);
  const disposition = response.headers.get("content-disposition") || "";
  const filenames = /(?:^|;)\s*filename(\*)?\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/gi;
  for (const match of disposition.matchAll(filenames)) {
    let filename = (match[2] ?? match[3]!).trim().replace(/\\(.)/g, "$1");
    if (match[1]) filename = filename.replace(/^[^']*'[^']*'/, "");
    if (isJavaScriptFilename(filename)) throw new JavaScriptDownloadError("response download filename identifies JavaScript");
  }
}

/** What it fetches over and on which clock it times. */
export interface Network {
  fetch(url: string, init: RequestInit): Promise<Response>;
  readonly clock: HostClock;
}

export interface SafeFetchOptions {
  method?: string;
  body?: string | null;
  headers?: Record<string, string> | Headers;
  maxBytes: number;
  timeoutMs: number;
  blockJavaScript: boolean;
}

export async function safeFetch(net: Network, url: string, options: SafeFetchOptions): Promise<Response> {
  const { maxBytes, timeoutMs } = options;
  let currentUrl = url;
  let method = options.method ?? "GET";
  let body = options.body ?? null;
  let headers = options.headers;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new SSRFError(`Invalid URL: ${currentUrl}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new SSRFError(`Only http and https URLs are allowed, got: ${parsed.protocol}`);
    if (options.blockJavaScript && isJavaScriptFilename(parsed.pathname)) throw new JavaScriptDownloadError("URL path identifies a JavaScript file");
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/g, "");
    if (Object.hasOwn(BLOCKED_HOSTNAMES, hostname)) throw new SSRFError(`Blocked hostname: ${hostname}`);

    // The limit runs from the request until its body has ended (or the answer is a redirect, or is refused): a timer of the host's clock, whose abort ends the request and a read of the body alike.
    const controller = new AbortController();
    const aborted = Promise.withResolvers<never>();
    aborted.promise.catch(() => undefined);
    let timedOut = false;
    const timer = net.clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
      aborted.reject(controller.signal.reason);
    }, timeoutMs);

    let response: Response;
    try {
      const sent = new Headers(headers);
      if (!sent.get("user-agent")?.trim()) sent.set("User-Agent", USER_AGENT);
      response = await net.fetch(currentUrl, { method, body, redirect: "manual", signal: controller.signal, headers: sent });
    } catch (error) {
      net.clock.clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") throw new SSRFError(`Request timed out after ${timeoutMs}ms`);
      throw error;
    }

    if (options.blockJavaScript) {
      try {
        assertNonJavaScriptResponse(response);
      } catch (error) {
        net.clock.clearTimeout(timer);
        controller.abort();
        void response.body?.cancel().catch(() => undefined);
        throw error;
      }
    }

    // A redirect is followed by hand, so each hop is checked again.
    if (response.status >= 300 && response.status < 400) {
      net.clock.clearTimeout(timer);
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new SSRFError(`Redirect with no Location header (status ${response.status})`);
      const previousUrl = currentUrl;
      currentUrl = new URL(location, currentUrl).toString();
      const upperMethod = method.toUpperCase();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && upperMethod === "POST")) {
        method = "GET";
        body = null;
      }
      if (new URL(previousUrl).origin !== new URL(currentUrl).origin && headers) {
        const redirected = new Headers(headers);
        redirected.delete("authorization");
        redirected.delete("cookie");
        redirected.delete("proxy-authorization");
        headers = redirected;
      }
      continue;
    }

    // The declared size first, then the stream itself, which a server may understate or leave undeclared.
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
      net.clock.clearTimeout(timer);
      await response.body?.cancel();
      throw new SSRFError(`Response too large: ${contentLength} bytes (max ${maxBytes})`);
    }
    if (!response.body) {
      net.clock.clearTimeout(timer);
      return response;
    }
    const reader = response.body.getReader();
    let received = 0;
    const limited = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const { done, value } = await Promise.race([reader.read(), aborted.promise]);
          if (done) {
            net.clock.clearTimeout(timer);
            out.close();
            reader.releaseLock();
            return;
          }
          received += value.byteLength;
          if (received > maxBytes) {
            net.clock.clearTimeout(timer);
            await reader.cancel();
            out.error(new SSRFError(`Response too large: more than ${maxBytes} bytes`));
            return;
          }
          out.enqueue(value);
        } catch (error) {
          net.clock.clearTimeout(timer);
          void reader.cancel().catch(() => undefined);
          out.error(timedOut ? new SSRFError(`Request timed out after ${timeoutMs}ms`) : error);
        }
      },
      async cancel(reason) {
        net.clock.clearTimeout(timer);
        await reader.cancel(reason);
      },
    });
    return new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  throw new SSRFError(`Too many redirects (max ${MAX_REDIRECTS})`);
}

/** `readResponseBodyCapped` (`spindle/worker-host.ts:774-793`): the body as text, UTF-8, an invalid byte replaced; the cap is the stream's own, which has ended the stream before this one counts. */
export async function readText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`CORS proxy response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(whole);
}
