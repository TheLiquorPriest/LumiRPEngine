// G0's ten pairs against a real Lumiverse over its HTTP routes and its event socket, with no browser: the floor's own play (`playPairs`) and measures, the reply's moments timed at the socket
// (the request leaving, the first reasoning and the first word's stream tokens, the last word's, the generation's end), the four rows (§17.1's first four) printed with their figures.
// What it needs, all from the environment (no default): LRE_HOST_URL, LRE_OWNER_USERNAME, LRE_OWNER_PASSWORD (one sign-in, made once), FLOOR_PLAIN_CONNECTION and FLOOR_RPE_CONNECTION (Lumiverse's
// connections, by name or id), FLOOR_RPE_URL and FLOOR_RPE_TOKEN, LRE_NEVER_TOUCH (chat id prefixes never acted on). G0_CHAT names the chat to play in (else a fresh one is made on the floor's card);
// G0_OUT is the folder the raw timings' JSON goes in (the working folder when not set). The floor's fixture is the one `scripts/testbed/floor.ts setup` made, found by its mark.
//   bun scripts/proof/live/socket-g0.ts

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { CHAT_NAME } from "../../testbed/floor-fixture";
import { LIMITS, type PageTimes, floorHead, intentCrossCheck, noVerdictKind, tableText } from "../../testbed/floor-measure";
import { Lumiverse } from "../../testbed/lib/lumiverse";
import { EngineSocket } from "../../testbed/lib/socket";
import { type FloorActs, liveReader, optionOf, playPairs } from "../floor/play";
import { g0Rows } from "../g0/verdict";
import { G0_TITLE } from "../g0/run";
import { RpeReader } from "../lib/read";
import { buildFrom, installedRph } from "../lib/record";
import type { RunRecord } from "../route/evidence";
import { agentFacts, lumiverseVersion, parseBuild, runningBuild } from "./facts";

const need = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`set ${name}`);
  return value;
};

/** The one sign-in: the token in the answer, else the `set-auth-token` header (what the engine's own CLI reads). */
async function signIn(base: string, username: string, password: string): Promise<string> {
  const reply = await fetch(`${base}/api/auth/sign-in/username`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const body: unknown = await reply.json().catch(() => null);
  const token = isRecord(body) && typeof body.token === "string" && body.token !== "" ? body.token : reply.headers.get("set-auth-token");
  if (!reply.ok || token === null) throw new Error(`Lumiverse refused the sign-in: ${reply.status}`);
  return token;
}

const base = need("LRE_HOST_URL").replace(/\/+$/, "");
const lumiverse = new Lumiverse(base, await signIn(base, need("LRE_OWNER_USERNAME").toLowerCase(), need("LRE_OWNER_PASSWORD")));
const rpe = { base: need("FLOOR_RPE_URL").replace(/\/+$/, ""), token: need("FLOOR_RPE_TOKEN") };
const neverTouch = need("LRE_NEVER_TOUCH").split(",").map((p) => p.trim().toLowerCase()).filter((p) => p !== "");
const refuse = (chat: string): string => {
  const hit = neverTouch.find((p) => chat.toLowerCase().startsWith(p));
  if (hit !== undefined) throw new Error(`refusing to act on chat ${chat.slice(0, 8)}…: it is on LRE_NEVER_TOUCH`);
  return chat;
};

const known = await lumiverse.connections();
const connection = (wanted: string): string => {
  const found = known.filter((c) => c.id === wanted || c.name === wanted);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`${found.length} Lumiverse connections are named or numbered "${wanted}"; G0 needs exactly one`);
  return found[0].id;
};

const sockets: EngineSocket[] = [];
const acts: FloorActs = {
  lumiverse: { base, token: lumiverse.token },
  rpe,
  connections: { plain: connection(need("FLOOR_PLAIN_CONNECTION")), rpe: connection(need("FLOOR_RPE_CONNECTION")) },
  async chat(card) {
    const given = process.env.G0_CHAT?.trim();
    return refuse(given !== undefined && given !== "" ? given : (await lumiverse.createChat(card, CHAT_NAME)).id);
  },
  async send(chat, connectionId, line, as) {
    refuse(chat);
    const persona = await lumiverse.call<{ name: string }>("GET", `/api/v1/personas/${encodeURIComponent(as.persona)}`);
    // Reply text is streamed only to a socket that says it is showing this chat.
    const socket = (sockets[0] ??= await EngineSocket.open(lumiverse, "", { page: false }));
    socket.focus(chat);
    const times: PageTimes = { sent: 0, firstThinking: null, firstWord: null, lastWord: null, ended: null, resolution: 1 };
    const { promise, resolve: settle } = Promise.withResolvers<void>();
    let failure: string | null = null;
    const stop = socket.onEvent((e) => {
      if (e.payload.chatId !== chat) return;
      if (e.event === "STREAM_TOKEN_RECEIVED" && typeof e.payload.token === "string" && e.payload.token !== "") {
        if (e.payload.type === "reasoning") times.firstThinking ??= e.at;
        else {
          times.firstWord ??= e.at;
          times.lastWord = e.at;
        }
      } else if (e.event === "GENERATION_ENDED" || e.event === "GENERATION_STOPPED") {
        times.ended = e.at;
        failure = e.event === "GENERATION_STOPPED" ? "the generation was stopped" : e.payload.error ? String(e.payload.error) : null;
        settle();
      }
    });
    try {
      times.sent = Date.now();
      await lumiverse.send(chat, persona.name, line);
      await lumiverse.call("POST", "/api/v1/generate", { chat_id: chat, connection_id: connectionId, persona_id: as.persona, preset_id: as.preset });
      await Promise.race([promise, Bun.sleep(LIMITS.runEnd).then(() => Promise.reject(new Error(`no end of the generation within ${LIMITS.runEnd / 60_000} min`)))]);
    } finally {
      stop();
    }
    if (failure !== null) throw new Error(failure);
    return times;
  },
};

const reader = liveReader(acts);
const rpeReader = new RpeReader(rpe.base, rpe.token);
const running = await runningBuild(rpe);
const build = parseBuild(running);
const stamp = new Date().toISOString();
// What the floor's play reads of a run: the agents (the Author's reply form and streaming) and the standing; the rest names what the output says of it.
const run: RunRecord = {
  run: `g0-socket-${stamp}`,
  mode: "live",
  by: "g0 at the socket",
  started: stamp,
  ended: null,
  asked: ["G0"],
  unplayed: [],
  known: { scenarios: [], gates: ["G0"] },
  repeats: 1,
  rpe: { commit: build?.rpe ?? running, dirty: build?.dirty ?? false },
  rph: { commit: build?.rph ?? "not named by the build", pin: null, pinned: false, held: { name: null, from: "bed-mirror", stage: "before-publishing", bundles: null } },
  lumiverse: { version: await lumiverseVersion(lumiverse) },
  browser: { name: "none", version: "the socket, no page" },
  agents: await agentFacts(rpeReader),
  settings: await rpeReader.settings(""),
};
const root = resolve(import.meta.dir, "..", "..", "..");
try {
  const { run: floor, chat } = await playPairs({ run, keep: async () => undefined }, acts, reader, optionOf(process.env), buildFrom(root, installedRph(root)));
  const rows = g0Rows(floor);
  const head = [`Measured at the socket and not on the page. RPE runs build ${running} (RPE ${run.rpe.commit}, RPH ${run.rph.commit}); Lumiverse ${run.lumiverse.version}; chat ${chat}.`, ...floorHead(floor)];
  console.log(tableText(rows, head, noVerdictKind(floor, false), intentCrossCheck(floor), G0_TITLE));
  const file = join(resolve(process.env.G0_OUT?.trim() || "."), `g0-socket-${stamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ build: running, lumiverse: run.lumiverse.version, chat, rows: rows.map((r) => ({ id: r.id, verdict: r.verdict, measured: r.measured })), turns: floor.turns.map((t) => ({ pair: t.pair, arm: t.arm, line: t.line, page: t.page, socket: t.socket, visible: t.visible, error: t.error })) }, null, 2)}\n`);
  console.log(`\nThe raw timings: ${file}`);
  process.exitCode = rows.some((r) => r.verdict === "fail") ? 1 : rows.every((r) => r.verdict === "pass") ? 0 : 3;
} finally {
  reader.close();
  for (const open of sockets) open.close();
}
