// Today's Build messages reach RPE's Build route through the page's client: a message goes to the
// route's path as it was sent, and what the route answers comes back in order, its answer and then the
// pushes it caused. A call the client could not make comes back as today's `lre.error`, coded
// `unavailable`, in the client's own words. Once closed, the transport hands nothing on.

import { describe, expect, test } from "bun:test";
import { ProtocolClient } from "../../../src/frontend/protocol-client";
import { type RpeClient, RpeError } from "../../../src/ui/client";
import { buildTransport } from "../../../src/ui/kept/transport";
import { routeClient } from "./bed";

describe("Build's messages, through the page's client to RPE's Build route", () => {
  test("a message reaches the route's path as it was sent, and its answer and then its pushes come back in that order", async () => {
    const { client, asked, route } = routeClient();
    const transport = buildTransport(client);
    const heard: unknown[] = [];
    transport.subscribe((payload) => heard.push(payload));
    const page = new ProtocolClient(transport);

    const made = await page.send({ type: "lre.world", op: "create", name: "Fernwick", template: "fantasy_town" });
    if (made.type !== "lre.result" || made.request !== "lre.world" || !made.body.world || !made.body.revision) throw new Error(`no world was made: ${JSON.stringify(made)}`);
    const worldId = made.body.world.id;
    const head = made.body.revision;
    const kind = { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} };
    const put = await page.send({ type: "lre.editor", op: "put", worldId, base: head, version: 0, collection: "kinds", id: "lamplighter", value: kind });

    expect(put).toMatchObject({ type: "lre.result", request: "lre.editor", body: { version: 1, stored: true } });
    expect(asked.map((a) => a.key)).toEqual([route, route]);
    expect(asked[1]?.body).toEqual({ lre: 1, type: "lre.editor", op: "put", reqId: put.reqId, worldId, base: head, version: 0, collection: "kinds", id: "lamplighter", value: kind });
    expect(heard.map((payload) => (payload !== null && typeof payload === "object" && "type" in payload ? payload.type : null))).toEqual(["lre.result", "lre.result", "lre.draft.changed"]);
    expect(heard[1]).toEqual(put);
    expect(heard[2]).toEqual({ lre: 1, type: "lre.draft.changed", worldId, version: 1, stored: true, base: head });
    page.dispose();
  });

  test("a call the client could not make, or one RPE refused, is today's lre.error coded unavailable, in the client's own words", async () => {
    const reasons = ["RPE did not answer: the connection was refused.", "The body is larger than RPE takes."];
    const failures = [new RpeError(0, reasons[0] as string), new RpeError(413, reasons[1] as string)];
    const transport = buildTransport({
      call: (async () => {
        throw failures.shift();
      }) as RpeClient["call"],
    });
    const page = new ProtocolClient(transport);
    for (const reason of reasons) expect(await page.send({ type: "lre.world", op: "list" })).toEqual({ lre: 1, type: "lre.error", reqId: expect.any(String), code: "unavailable", message: reason });
    page.dispose();
  });

  test("once closed, an answer still on its way is handed to nobody, and nothing more is sent", async () => {
    const answer = Promise.withResolvers<unknown>();
    let calls = 0;
    const transport = buildTransport({
      call: (() => {
        calls += 1;
        return answer.promise;
      }) as RpeClient["call"],
    });
    const heard: unknown[] = [];
    transport.subscribe((payload) => heard.push(payload));
    transport.send({ lre: 1, type: "lre.world", op: "list", reqId: "r1" });
    transport.close();
    answer.resolve({ result: { lre: 1, type: "lre.result", reqId: "r1", request: "lre.world", body: { worlds: [] } }, pushes: [] });
    await answer.promise;
    await Promise.resolve();
    transport.send({ lre: 1, type: "lre.world", op: "list", reqId: "r2" });
    expect({ calls, heard }).toEqual({ calls: 1, heard: [] });
  });
});
