// The extension's pipe and its guards (STANDALONE-PLAN §4.3, §4.4), through the stand-in Lumiverse: a
// registration the extension refuses is answered to the socket it came from, and the one it holds
// stays; and a page's request reaches RPE's API alone. Every name, address and key is invented.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { settle } from "../standin/clock";
import { Rig, RELAY_SESSION, RPE, USER } from "./rig";

const PAGE = "99998888777766665555444433332222";

/** Waits, letting the extension's work run, until `check` gives something. */
async function until<T>(what: string, check: () => T | null | undefined | false): Promise<T> {
  const end = Date.now() + 2_000;
  for (;;) {
    const got = check();
    if (got) return got;
    if (Date.now() > end) throw new Error(`waited two seconds for ${what}`);
    await settle();
  }
}

const said = (m: unknown, rpe: string): boolean => typeof m === "object" && m !== null && "rpe" in m && m.rpe === rpe;

describe("a registration the extension refuses", () => {
  test("is answered to the socket it came from, with why, and the registration the extension holds stays", async () => {
    const rig = await new Rig().start();
    rig.ext.fromFrontend({ rpe: "register", registration: { v: 1, base: "http://192.0.2.7:7860", key: "rpx-elsewhere", connection: "conn-other", relay: RELAY_SESSION, build: "test" } }, USER, RELAY_SESSION);
    const refused = await until("the refusal", () => rig.toRpe.find((m) => said(m, "refused")));
    expect(refused).toMatchObject({ rpe: "refused", why: expect.stringContaining("loopback"), missing: [] });
    // RPE's own registration still marks its replies: one on its connection is played by RPE.
    const out = await rig.generate("conn-rpe");
    expect(out.error).toBeNull();
    expect(rig.turns).toHaveLength(1);
  });

  test("is asked nowhere when its address is more than a bare origin on loopback: a path, a query, a fragment or a name in it would aim the confirming call elsewhere", async () => {
    const rig = await new Rig().start();
    const reached: string[] = [];
    rig.lv.servers.set("http://127.0.0.1:11434", async (request) => {
      reached.push(request.url);
      return Response.json({});
    });
    const bases = ["http://127.0.0.1:11434/api/pull#", "http://127.0.0.1:11434?x=", "http://127.0.0.1:11434/#", "http://someone:pw@127.0.0.1:11434"];
    for (const base of bases) rig.ext.fromFrontend({ rpe: "register", registration: { v: 1, base, key: "rpx-elsewhere", connection: "conn-other", relay: RELAY_SESSION, build: "test" } }, USER, RELAY_SESSION);
    const refusals = await until("every refusal", () => {
      const got = rig.toRpe.filter((m) => said(m, "refused"));
      return got.length === bases.length ? got : null;
    });
    for (const refused of refusals) expect(refused).toMatchObject({ rpe: "refused", why: expect.stringContaining("bare address") });
    expect(reached).toEqual([]);
  });
});

describe("a page's request", () => {
  test("reaches RPE's API alone: another program, the provider endpoint and the extension's own routes are refused before anything is sent", async () => {
    const rig = await new Rig().start();
    const reached: string[] = [];
    const rpe = rig.lv.servers.get(RPE)!;
    rig.lv.servers.set(RPE, (request) => {
      reached.push(`${request.method} ${new URL(request.url).pathname}`);
      return rpe(request);
    });
    const elsewhere: string[] = [];
    rig.lv.servers.set("http://127.0.0.1:11434", async (request) => {
      elsewhere.push(request.url);
      return Response.json({});
    });
    const answers = new Map<string, unknown>();
    const toRpe = rig.lv.frontends;
    rig.lv.frontends = (m) => {
      if (m.session !== PAGE) return toRpe?.(m) ?? false;
      if (isRecord(m.payload) && m.payload.rpe === "response") answers.set(String(m.payload.id), m.payload);
      return true;
    };
    const refused = {
      absolute: "http://127.0.0.1:11434/api/v1/models",
      schemeless: "//127.0.0.1:11434/api/v1/models",
      provider: "/v1/chat/completions",
      extension: "/api/v1/ext/start",
      steppedOut: "/api/v1/../../v1/models",
      encodedOut: "/api/v1/%2e%2e/%2e%2e/v1/models",
      steppedIn: "/api/v1/chats/../ext/start",
    };
    for (const [id, path] of Object.entries({ ...refused, api: "/api/v1/status" })) rig.ext.fromFrontend({ rpe: "request", id, method: "POST", path, headers: { authorization: "Bearer rpp_page" }, body: "{}" }, USER, PAGE);
    await until("every answer", () => answers.size === Object.keys(refused).length + 1);
    for (const id of Object.keys(refused)) expect({ id, answer: answers.get(id) }).toMatchObject({ id, answer: { status: 400 } });
    // A path of RPE's API reaches RPE, which answers it as it will.
    expect(answers.get("api")).toMatchObject({ status: 404 });
    expect(reached).toEqual(["POST /api/v1/status"]);
    expect(elsewhere).toEqual([]);
  });

  test("a page's answer past 25 MiB fails as Lumiverse fails it: cut as it is read, or refused by its declared length, and told to the page as RPE not reached", async () => {
    const rig = await new Rig().start();
    const limit = 25 * 1024 * 1024;
    /** `size` bytes of answer in megabyte chunks, its length declared where `declare` says. */
    const answerOf = (size: number, declare: boolean): Response => {
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
    };
    const rpe = rig.lv.servers.get(RPE)!;
    rig.lv.servers.set(RPE, (request) => {
      const path = new URL(request.url).pathname;
      return path === "/api/v1/streamed" ? Promise.resolve(answerOf(limit + 1, false)) : path === "/api/v1/declared" ? Promise.resolve(answerOf(limit + 1, true)) : rpe(request);
    });
    const answers = new Map<string, unknown>();
    const toRpe = rig.lv.frontends;
    rig.lv.frontends = (m) => {
      if (m.session !== PAGE) return toRpe?.(m) ?? false;
      if (isRecord(m.payload) && m.payload.rpe === "response") answers.set(String(m.payload.id), m.payload);
      return true;
    };
    for (const [id, path] of [["streamed", "/api/v1/streamed"], ["declared", "/api/v1/declared"]] as const) rig.ext.fromFrontend({ rpe: "request", id, method: "GET", path, headers: { authorization: "Bearer rpp_page" } }, USER, PAGE);
    await until("both answers", () => answers.size === 2);
    expect(answers.get("streamed")).toMatchObject({ status: 502, body: expect.stringContaining(`Response too large: more than ${limit} bytes`) });
    expect(answers.get("declared")).toMatchObject({ status: 502, body: expect.stringContaining(`Response too large: ${limit + 1} bytes (max ${limit})`) });
  });
});