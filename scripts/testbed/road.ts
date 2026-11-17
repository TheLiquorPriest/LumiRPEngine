// The owner's own clicks in Lumiverse on the road of docs/migration.md, done through the routes
// Lumiverse's pages call, as the instance's user: the Extensions page's "switch branch", its
// permission approval, its off and on, and a message sent in a chat and the reply waited for. Nothing
// here reads RPE's code or data: it asks Lumiverse, which is what the owner's browser asks.
//
//   bun road.ts ext                        the extension: its branch, status, requested and granted permissions
//   bun road.ts switch <branch>            Switch branch (keeps the extension's storage)
//   bun road.ts approve                    Approve every permission the build asks for that is not granted yet
//   bun road.ts offon                      Switch the extension off, then on again
//   bun road.ts chats                      the user's chats: id, name, connection
//   bun road.ts say [--connection <name>] <chat> <line…>
//                                          send a message in the chat as the player and press Send (on the connection named,
//                                          as choosing it for the chat does, else the chat's own), wait for the reply
//
// The environment is the instance scripts' (README.md): LRE_HOST_URL, LRE_RUNTIME_HOME, LRE_OWNER_*.
// The sign-in is the one today's command line saved for the owner (so none is made), else one is made.

import { existsSync, readFileSync } from "node:fs";
import { IDENTIFIER } from "./lib/env";
import { credentialsFile, readInstanceEnv } from "./lib/instance/env";
import { HttpError, Lumiverse } from "./lib/lumiverse";

interface Extension {
  id: string;
  identifier: string;
  enabled: boolean;
  status: string;
  permissions: string[];
  granted_permissions: string[];
  metadata: { branch?: string | null };
}

const env = readInstanceEnv();

async function signedIn(): Promise<Lumiverse> {
  const path = credentialsFile(env, "owner");
  if (existsSync(path)) {
    const saved: { hosts?: { [base: string]: { token?: string } } } = JSON.parse(readFileSync(path, "utf8"));
    const token = saved.hosts?.[env.hostUrl]?.token;
    if (typeof token === "string" && token !== "") {
      const client = new Lumiverse(env.hostUrl, token);
      if (await client.userId().then(() => true, () => false)) return client;
    }
  }
  const reply = await fetch(`${env.hostUrl}/api/auth/sign-in/username`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ username: env.owner.username, password: env.owner.password }) });
  const text = await reply.text();
  if (!reply.ok) throw new HttpError(reply.status, text, "sign-in");
  const body: unknown = JSON.parse(text);
  const fromBody = body !== null && typeof body === "object" && "token" in body && typeof body.token === "string" ? body.token : null;
  const token = fromBody ?? reply.headers.get("set-auth-token");
  if (token === null || token === "") throw new Error("Lumiverse sent no session token");
  return new Lumiverse(env.hostUrl, token);
}

const host = await signedIn();

async function extension(): Promise<Extension> {
  const list = await host.call<{ extensions: Extension[] }>("GET", "/api/v1/spindle");
  const found = list.extensions.find((e) => e.identifier === IDENTIFIER);
  if (found === undefined) throw new Error(`${IDENTIFIER} is not installed`);
  return found;
}

function show(ext: Extension): void {
  const missing = ext.permissions.filter((p) => !ext.granted_permissions.includes(p));
  console.log(`extension ${ext.id}: branch ${ext.metadata.branch ?? "?"}, ${ext.enabled ? "enabled" : "disabled"}, ${ext.status}`);
  console.log(`  asks for ${ext.permissions.length}: ${ext.permissions.join(", ")}`);
  console.log(`  granted ${ext.granted_permissions.length}; not granted ${missing.length}: ${missing.join(", ") || "none"}`);
}

async function until(what: string, ok: (e: Extension) => boolean, ms = 180_000): Promise<Extension> {
  for (const began = Date.now(); ; await Bun.sleep(1500)) {
    const ext = await extension();
    if (ok(ext)) return ext;
    if (Date.now() - began > ms) throw new Error(`${what}: the extension is ${ext.status} ${ms / 1000} s after`);
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "ext") {
    show(await extension());
  } else if (command === "switch") {
    const branch = rest[0];
    if (branch === undefined) throw new Error("usage: bun road.ts switch <branch>");
    const ext = await extension();
    const answer = await host.call<unknown>("POST", `/api/v1/spindle/${ext.id}/switch-branch`, { branch });
    console.log(`switch-branch ${branch}: ${JSON.stringify(answer).slice(0, 300)}`);
    show(await until("after the switch", (e) => e.metadata.branch === branch));
  } else if (command === "approve") {
    const ext = await extension();
    const ungranted = ext.permissions.filter((p) => !ext.granted_permissions.includes(p));
    if (ungranted.length === 0) console.log("every permission it asks for is granted already");
    else {
      const after = await host.call<{ requested: string[]; granted: string[] }>("POST", `/api/v1/spindle/${ext.id}/permissions`, { grant: ungranted });
      console.log(`granted ${ungranted.length}: ${ungranted.join(", ")}`);
      const still = after.requested.filter((p) => !after.granted.includes(p));
      if (still.length > 0) throw new Error(`Lumiverse did not grant ${still.join(", ")}`);
    }
    show(await extension());
  } else if (command === "offon") {
    const ext = await extension();
    await host.call("POST", `/api/v1/spindle/${ext.id}/disable`, {});
    console.log("switched off");
    await host.call("POST", `/api/v1/spindle/${ext.id}/enable`, {});
    console.log("switched on");
    show(await until("after off and on", (e) => e.enabled && e.status === "running"));
  } else if (command === "chats") {
    for (const c of await host.chats()) console.log(`${c.id}  ${c.name}  ${JSON.stringify(c.metadata?.connection_id ?? "")}`);
  } else if (command === "say") {
    const named = rest[0] === "--connection" ? rest[1] : undefined;
    const [chat, ...words] = named === undefined ? rest : rest.slice(2);
    if (chat === undefined || words.length === 0) throw new Error("usage: bun road.ts say [--connection <name>] <chat> <line…>");
    const connection = named === undefined ? undefined : (await host.connections()).find((c) => c.name === named)?.id;
    if (named !== undefined && connection === undefined) throw new Error(`Lumiverse has no connection named "${named}"`);
    const before = await host.messages(chat);
    const name = before.filter((m) => m.is_user).at(-1)?.name ?? "Player";
    const user = await host.send(chat, name, words.join(" "));
    console.log(`sent message ${user.id}`);
    const began = Date.now();
    await host.generate(chat, "normal", connection);
    for (let calm = 0; calm < 2; ) {
      if (Date.now() - began > 30 * 60_000) throw new Error("no reply within 30 minutes");
      await Bun.sleep(3000);
      calm = (await host.generationStatus(chat)).active === true ? 0 : calm + 1;
    }
    const after = await host.messages(chat);
    const reply = after.at(-1);
    if (reply === undefined || reply.is_user) throw new Error("the send got no reply message");
    console.log(`reply ${reply.id} after ${Math.round((Date.now() - began) / 1000)} s, ${reply.content.length} characters, ${reply.swipes.length} swipe(s): ${reply.content.slice(0, 400).replace(/\s+/g, " ")}`);
  } else {
    console.error("usage: bun road.ts ext | switch <branch> | approve | offon | chats | say [--connection <name>] <chat> <line…>");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
