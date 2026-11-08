// A user whose loopback is ready, as Settings → Loopback shows it (`loopbackUnready`): a relay of
// theirs registered and Running (it said hello on its own session, on this build), a loopback key
// minted, and a connection that is the loopback. The opt-in to depth asks for all three. The
// connection is only added: the user's default connection stays what it was.

import { isRecord } from "../../src/shared/json";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import type { Rig } from "./rig";

export const RELAY_SESSION = "d3e7".repeat(8);

/** What the ready loopback is: the relay's secret, the user's key, and the connection that is the loopback. */
export interface ReadyLoopback {
  secret: string;
  key: string;
  connectionId: string;
}

/** Makes the rig's user ready to play depth through a relay listening on `port`. */
export async function readyLoopback(rig: Rig, port = 7863, name = "sam"): Promise<ReadyLoopback> {
  const registered = rig.body(await rig.send({ type: "lre.loopback.register", name, mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port }, RELAY_SESSION));
  if (!isRecord(registered) || typeof registered.secret !== "string") throw new Error("the relay wasn't registered");
  const secret = registered.secret;
  const report = { name, build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 };
  rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report, open: [] }, RELAY_SESSION));
  const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" })).page;
  if (!isRecord(page) || typeof page.minted !== "string") throw new Error("no loopback key was minted");
  const connectionId = `conn-loop-${port}`;
  rig.host.connectionProfiles.push({ id: connectionId, name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: `http://127.0.0.1:${port}/v1` });
  return { secret, key: page.minted, connectionId };
}
