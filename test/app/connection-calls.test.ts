// A connection on RPH's own model layer, through RPE's routes: its model's limits as RPH uses them,
// the user's override among them; and a test of it, one small call to the provider, that says whether
// it answered and what model, and never carries the key, even where the provider's refusal repeats it.
// The provider is a stand-in on a local port this test makes; every name and key is invented.

import { afterEach, expect, test } from "bun:test";
import type { ModelLimits } from "rp-harness/contract";
import { type ConnectionShown, type ConnectionsShown, type ConnectionTested, connectionRoutes } from "../../src/app";
import { openTurnBed, type TurnBed } from "../turn/bed";
import { bearer, makeBed, makeKey, testModelLayer } from "./helpers";

const KEY = "sk-invented-stand-in-key-9q8w7e6r";
const MODEL = "stand-in-model";

const beds: TurnBed[] = [];
const servers: { stop(close?: boolean): unknown }[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
  for (const s of servers.splice(0)) s.stop(true);
});

/** An OpenAI-compatible provider: it refuses the key as OpenAI does, showing its first and last characters, and in its words the whole key once more; or answers in a stream, naming its model. */
function provider(mode: { refuse: boolean }): string {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const key = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      if (mode.refuse) return Response.json({ error: { message: `Incorrect API key provided: ${key.slice(0, 6)}${"*".repeat(20)}${key.slice(-4)}. You can find your key in your account. (Sent: ${key})`, type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 });
      const chunk = (delta: Record<string, string>, finish: string | null): string => `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      return new Response(`${chunk({ role: "assistant", content: "Here." }, null)}${chunk({}, "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/v1`;
}

test("a connection is shown with its model's limits, the user's override first, and never any of its key; a test says whether the provider answered, and never carries the key", async () => {
  const mode = { refuse: true };
  const baseUrl = provider(mode);
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  const override: Pick<ModelLimits, "contextWindow" | "maxTokens"> = { contextWindow: { tokens: 32_000, from: "user" }, maxTokens: { tokens: 2_000, from: "user" } };

  const made = await b.page<ConnectionShown & { error?: string }>("POST", "/api/v1/connections", { connection: { name: "Stand-in", provider: "openai-compatible", auth: "key", baseUrl, model: MODEL, limits: { [MODEL]: { contextWindow: 32_000, maxTokens: 2_000 } } }, key: KEY });
  expect(made.body.error).toBeUndefined();
  expect(made.body).toMatchObject({ key: { set: true }, limitsInForce: override });
  const listed = await b.page<ConnectionsShown>("GET", "/api/v1/connections");
  expect(listed.body.connections.find((c) => c.id === made.body.id)).toMatchObject({ key: { set: true }, limitsInForce: override });
  expect(JSON.stringify(listed.body)).not.toContain(KEY.slice(-4));

  const refused = await b.page<ConnectionTested>("POST", `/api/v1/connections/${made.body.id}/test`);
  expect(refused.status).toBe(200);
  expect(refused.body).toMatchObject({ ok: false, limits: null });
  // One redactor, RPH's: the provider's own words stand as written, its masked echo of the key's last four characters among them, and the key itself never.
  expect(refused.body.ok ? "" : refused.body.error).toContain(`Incorrect API key provided: sk-inv${"*".repeat(20)}${KEY.slice(-4)}. You can find your key in your account.`);
  for (const said of [JSON.stringify(refused.body), JSON.stringify(b.logged)]) expect(said).not.toContain(KEY);

  mode.refuse = false;
  const answered = await b.page<ConnectionTested>("POST", `/api/v1/connections/${made.body.id}/test`);
  expect(answered.body).toMatchObject({ ok: true, model: MODEL, limits: override });
});

test("a catalogue that throws shows its reason, not 'no limit known', and is logged", async () => {
  const bed = await makeBed();
  try {
    const why = "The model catalogue could not be read: its file is not JSON (invented).";
    const app = await bed.open({
      areas: [{ name: "connections", mount: (a) => a.routes.add("connections", connectionRoutes({ ...testModelLayer(a.models), limits: async () => Promise.reject(new Error(why)) }, () => a.config.lumiverse.user ?? "", a.log)) }],
    });
    const server = await app.start();
    const page = { ...bearer(await makeKey(app, "web")), "content-type": "application/json" };
    const made = (await (await fetch(`${server.url}/api/v1/connections`, { method: "POST", headers: page, body: JSON.stringify({ connection: { name: "Lamp", provider: "deepseek", auth: "none", model: "deepseek-v4-flash" } }) })).json()) as ConnectionShown;
    expect(made).toMatchObject({ limitsInForce: null, limitsProblem: why });
    const listed = (await (await fetch(`${server.url}/api/v1/connections`, { headers: page })).json()) as ConnectionsShown;
    expect(listed.connections).toMatchObject([{ id: made.id, limitsInForce: null, limitsProblem: why }]);
    // Each read that failed is logged with its reason: the add's, and the list's.
    expect(bed.logs.filter((line) => line.includes("a connection's model limits could not be read") && line.includes(why))).toHaveLength(2);
  } finally {
    await bed.remove();
  }
});
