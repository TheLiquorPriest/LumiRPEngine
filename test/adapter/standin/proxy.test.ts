// Spindle's proxy as the stand-in Lumiverse runs it, held to Lumiverse's own code (staging at a70f4ed2; paths are Lumiverse's `src/`): `spindle/worker-host.ts:4641-4741`, `:771-793` and
// `utils/safe-fetch.ts`: the permission, the schemes, the two blocked host names, JavaScript refused by its path and by its answer, redirects followed hop by hop and each checked again, the
// credentials left off a hop to another origin, the thirty seconds that run until the body has ended on the host's clock, and the 25 MiB of answer cut by its declared length and as it is read.
// The extension is installed, granted and enabled as an admin does it. Every name is invented.

import { describe, expect, test } from "bun:test";
import { FakeClock } from "../../standin/clock";
import type { Installed } from "../../standin/host";
import { ADMIN } from "../../standin/install";
import { StandIn } from "../../standin/lumiverse";

const ONE = "http://127.0.0.1:7901";
const TWO = "http://127.0.0.1:7902";
const LIMIT = 25 * 1024 * 1024;

/** A stand-in on the test's clock with an extension that asks for the proxy and is granted it (or is not), and the proxy's answer or refusal as the extension sees it. */
async function bed(granted: readonly string[] = ["cors_proxy"]): Promise<{ lv: StandIn; clock: FakeClock; ask(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ body?: string; status?: number; headers?: Record<string, string>; error?: string }> }> {
  const lv = new StandIn();
  const clock = new FakeClock();
  lv.clock = clock;
  let worker: Installed | undefined;
  await lv.spindle.setUp(ADMIN, { url: "https://example.invalid/ext_proxy", manifest: { identifier: "ext_proxy", permissions: ["cors_proxy"] }, granted, code: (api) => void (worker = api) });
  return {
    lv,
    clock,
    ask: (url, init = {}) =>
      worker!.cors(url, { method: init.method ?? "GET", headers: init.headers ?? {}, ...(init.body !== undefined ? { body: init.body } : {}) }).then(
        (answer) => ({ status: answer.status, body: answer.body, headers: answer.headers }),
        (error: Error) => ({ error: error.message }),
      ),
  };
}

/** A response of `size` bytes in megabyte chunks, with no length declared unless `declare`. */
function bytes(size: number, declare = false): Response {
  let sent = 0;
  const chunk = new Uint8Array(1 << 20).fill(97);
  const body = new ReadableStream<Uint8Array>({
    pull(out) {
      const left = size - sent;
      if (left <= 0) return out.close();
      const take = left < chunk.length ? chunk.subarray(0, left) : chunk;
      sent += take.length;
      out.enqueue(take);
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain", ...(declare ? { "content-length": String(size) } : {}) } });
}

describe("the proxy refuses and cuts what Lumiverse refuses and cuts", () => {
  test("needs cors_proxy, and takes http and https alone", async () => {
    const withoutIt = await bed([]);
    expect(await withoutIt.ask(`${ONE}/x`)).toEqual({ error: "Permission denied: cors_proxy — CORS proxy permission not granted" });
    const b = await bed();
    const reached: string[] = [];
    b.lv.servers.set(ONE, async (request) => (reached.push(request.url), new Response("fine")));
    expect(await b.ask(`${ONE}/x`)).toMatchObject({ status: 200, body: "fine" });
    expect(await b.ask("ftp://127.0.0.1:7901/x")).toEqual({ error: "Only http and https URLs are allowed, got: ftp:" });
    expect(await b.ask("file:///etc/hosts")).toEqual({ error: "Only http and https URLs are allowed, got: file:" });
    expect(await b.ask("not a url")).toEqual({ error: "Invalid URL: not a url" });
    expect(reached).toEqual([`${ONE}/x`]);
    // An address with no server is a refused connection, as Lumiverse's fetch reports it; loopback and private addresses are allowed.
    expect(await b.ask("http://10.0.0.5:7901/x")).toEqual({ error: "Unable to connect. Is the computer able to access the url?" });
  });

  test("refuses the two blocked host names, however they are written, before anything is sent", async () => {
    const b = await bed();
    const reached: string[] = [];
    for (const host of ["metadata.g\u006fogle.internal", "metadata.g\u006fog"]) b.lv.servers.set(`http://${host}`, async (request) => (reached.push(request.url), new Response("secret")));
    expect(await b.ask("http://metadata.g\u006fogle.internal/computeMetadata/v1/")).toEqual({ error: "Blocked hostname: metadata.g\u006fogle.internal" });
    expect(await b.ask("http://METADATA.G\u004fOG./x")).toEqual({ error: "Blocked hostname: metadata.g\u006fog" });
    expect(reached).toEqual([]);
  });

  test("refuses a JavaScript path, and an answer that is JavaScript by its type or by the name it is downloaded as", async () => {
    const b = await bed();
    const reached: string[] = [];
    b.lv.servers.set(ONE, async (request) => {
      reached.push(new URL(request.url).pathname);
      const type = new URL(request.url).searchParams.get("type");
      const name = new URL(request.url).searchParams.get("name");
      return new Response("alert(1)", { headers: { ...(type === null ? {} : { "content-type": type }), ...(name === null ? {} : { "content-disposition": `attachment; filename="${name}"` }) } });
    });
    for (const path of ["/app.js", "/lib/app.MJS", "/app.cjs", "/app.es", "/app%2Ejs", "/app.js;v=1"]) expect(await b.ask(`${ONE}${path}?x=1`)).toEqual({ error: "JavaScript downloads are blocked: URL path identifies a JavaScript file" });
    expect(reached).toEqual([]);
    // Near misses are not JavaScript.
    for (const path of ["/app.json", "/app.jsx", "/js", "/app.js.map"]) expect(await b.ask(`${ONE}${path}`)).toMatchObject({ status: 200 });
    // By its media type, parameters and case aside.
    expect(await b.ask(`${ONE}/a?type=text/javascript;%20charset=utf-8`)).toEqual({ error: "JavaScript downloads are blocked: response Content-Type is text/javascript" });
    expect(await b.ask(`${ONE}/a?type=Application/X-JavaScript`)).toEqual({ error: "JavaScript downloads are blocked: response Content-Type is application/x-javascript" });
    expect(await b.ask(`${ONE}/a?type=text/plain`)).toMatchObject({ status: 200 });
    // By the name it is saved as.
    expect(await b.ask(`${ONE}/a?name=tool.mjs`)).toEqual({ error: "JavaScript downloads are blocked: response download filename identifies JavaScript" });
    expect(await b.ask(`${ONE}/a?name=tool.txt`)).toMatchObject({ status: 200 });
  });

  test("follows a redirect hop by hop, checking each hop again, leaving the credentials off a hop to another origin, and at most five", async () => {
    const b = await bed();
    const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const to = (status: number, location: string | null): Response => new Response(null, { status, headers: location === null ? {} : { location } });
    b.lv.servers.set(ONE, async (request) => {
      const url = new URL(request.url);
      seen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()), body: await request.text() });
      if (url.pathname === "/hop") return to(302, `${TWO}/landed`);
      if (url.pathname === "/same") return to(307, "/again");
      if (url.pathname === "/post") return to(303, "/after");
      if (url.pathname === "/script") return to(302, "/payload.js");
      if (url.pathname === "/metadata") return to(302, "http://metadata.g\u006fog/x");
      if (url.pathname === "/ftp") return to(302, "ftp://127.0.0.1:7901/x");
      if (url.pathname === "/nowhere") return to(302, null);
      if (url.pathname === "/loop") return to(302, "/loop");
      return new Response(`${url.pathname} answered`);
    });
    b.lv.servers.set(TWO, async (request) => {
      seen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()), body: await request.text() });
      return new Response("landed");
    });
    const credentials = { authorization: "Bearer abc", cookie: "sid=1", "proxy-authorization": "Basic xyz", "x-keep": "yes" };
    // To another origin the three credentials are dropped and the rest kept; the user agent is Lumiverse's.
    expect(await b.ask(`${ONE}/hop`, { headers: credentials })).toMatchObject({ status: 200, body: "landed" });
    const there = seen.at(-1)!;
    expect(there.url).toBe(`${TWO}/landed`);
    expect(there.headers).toMatchObject({ "x-keep": "yes", "user-agent": expect.stringMatching(/^Lumiverse\//) });
    for (const dropped of ["authorization", "cookie", "proxy-authorization"]) expect(there.headers[dropped]).toBeUndefined();
    // On the same origin they stay, and a 307 keeps the method and the body; a 303 makes a GET with none.
    seen.length = 0;
    expect(await b.ask(`${ONE}/same`, { method: "PUT", headers: credentials, body: "kept" })).toMatchObject({ body: "/again answered" });
    expect(seen.map((s) => [s.method, s.body, s.headers.authorization])).toEqual([["PUT", "kept", "Bearer abc"], ["PUT", "kept", "Bearer abc"]]);
    seen.length = 0;
    expect(await b.ask(`${ONE}/post`, { method: "POST", body: "form" })).toMatchObject({ body: "/after answered" });
    expect(seen.map((s) => [s.method, s.body])).toEqual([["POST", "form"], ["GET", ""]]);
    // Each hop is held to the same rules as the first.
    expect(await b.ask(`${ONE}/script`)).toEqual({ error: "JavaScript downloads are blocked: URL path identifies a JavaScript file" });
    expect(await b.ask(`${ONE}/metadata`)).toEqual({ error: "Blocked hostname: metadata.g\u006fog" });
    expect(await b.ask(`${ONE}/ftp`)).toEqual({ error: "Only http and https URLs are allowed, got: ftp:" });
    expect(await b.ask(`${ONE}/nowhere`)).toEqual({ error: "Redirect with no Location header (status 302)" });
    // Five are followed and the sixth redirect is one too many.
    seen.length = 0;
    expect(await b.ask(`${ONE}/loop`)).toEqual({ error: "Too many redirects (max 5)" });
    expect(seen).toHaveLength(6);
  });

  test("gives each request thirty seconds on the host's clock, running until the body has ended", async () => {
    const b = await bed();
    const outcome = (promise: Promise<unknown>): (() => unknown) => {
      let result: unknown = "waiting";
      void promise.then((r) => (result = r));
      return () => result;
    };
    // Never answered.
    b.lv.servers.set(ONE, () => new Promise<Response>(() => undefined));
    const silent = outcome(b.ask(`${ONE}/x`));
    await b.clock.advance(29_999);
    expect(silent()).toBe("waiting");
    await b.clock.advance(1);
    expect(silent()).toEqual({ error: "Request timed out after 30000ms" });
    // Answered at once, the body begun and never ended: the limit still runs.
    b.lv.servers.set(ONE, async () => new Response(new ReadableStream<Uint8Array>({ start: (out) => out.enqueue(new TextEncoder().encode("part")) }), { headers: { "content-type": "text/plain" } }));
    const stalled = outcome(b.ask(`${ONE}/x`));
    await b.clock.advance(29_999);
    expect(stalled()).toBe("waiting");
    await b.clock.advance(1);
    expect(stalled()).toEqual({ error: "Request timed out after 30000ms" });
    // A body that ends in time is read whole, a chunk's arrival not renewing anything.
    b.lv.servers.set(ONE, async () => new Response(new ReadableStream<Uint8Array>({ start: (out) => void b.clock.setTimeout(() => (out.enqueue(new TextEncoder().encode("late but whole")), out.close()), 29_000) })));
    const slow = outcome(b.ask(`${ONE}/x`));
    await b.clock.advance(29_000);
    expect(slow()).toMatchObject({ status: 200, body: "late but whole" });
    // Each hop has thirty seconds of its own.
    b.lv.servers.set(ONE, async (request) => {
      const wait = Promise.withResolvers<void>();
      b.clock.setTimeout(wait.resolve, 20_000);
      await wait.promise;
      return new URL(request.url).pathname === "/start" ? new Response(null, { status: 302, headers: { location: "/end" } }) : new Response("end");
    });
    const chain = outcome(b.ask(`${ONE}/start`));
    await b.clock.advance(20_000);
    await b.clock.advance(20_000);
    expect(chain()).toMatchObject({ status: 200, body: "end" });
  });

  test("cuts an answer past 25 MiB by its declared length and as it is read, and puts no cap on the request", async () => {
    const b = await bed();
    b.lv.servers.set(ONE, async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/exact") return bytes(LIMIT);
      if (path === "/over") return bytes(LIMIT + 1);
      if (path === "/declared") return bytes(LIMIT + 1, true);
      if (path === "/small") return new Response("ok", { headers: { "content-length": "2" } });
      return new Response(String((await request.text()).length));
    });
    const exact = await b.ask(`${ONE}/exact`);
    expect(exact.body?.length).toBe(LIMIT);
    expect(await b.ask(`${ONE}/over`)).toEqual({ error: `Response too large: more than ${LIMIT} bytes` });
    expect(await b.ask(`${ONE}/declared`)).toEqual({ error: `Response too large: ${LIMIT + 1} bytes (max ${LIMIT})` });
    expect(await b.ask(`${ONE}/small`)).toMatchObject({ status: 200, body: "ok" });
    // The request is not capped: a body past the answer's cap goes through.
    expect(await b.ask(`${ONE}/echo`, { method: "POST", body: "a".repeat(LIMIT + 1) })).toMatchObject({ body: String(LIMIT + 1) });
  });
});
