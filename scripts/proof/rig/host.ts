// The rig's host (PlanScenarios-2; plan §17.0, §18.3): the ground a rig run stands on, as `scripts/proof/route/host.ts` asks of
// a host. A play gets a footing of its own (`bed.ts`): the stand-in Lumiverse with the light extension in it, RPE with its built
// pages and every agent answering from its own script (`scripts.ts`); a browser window in a context of its own on RPE's web shell
// and on Lumiverse's chat page as the rig has it (`chat-page.ts`, served over the network door `door.ts`); the player's acts on
// the stand-in, made as Lumiverse's pages make them; fixtures loaded through the stand-in's own library (`fixtures.ts`); and the
// acts of the floor (`FloorActs`, `scripts/proof/floor/play.ts`): the reply's moments timed by the page itself, never by a socket.
//
// What the rig does not yet do is said where it is asked, naming the package that gives it: an act the stand-in lacks fails with
// that package, so a run never passes for want of a check. `standInGaps` is the one list of what the page's Send needs of the
// stand-in's routes (`PlanAdapter-S12` item 2 and the reads the page makes) and that the stand-in does not yet serve.

import { resolve } from "node:path";
import type { Answer } from "rp-harness/testing/rig";
import type { ConnectionShown, ConnectionsShown } from "../../../src/shared/api";
import type { Block } from "../../../test/standin/assembly";
import type { Outcome } from "../../../test/standin/lumiverse";
import { LIMITS, type PageTimes } from "../../testbed/floor-measure";
import { BrowserDriver, type PageTab } from "../browser/driver";
import { type Chrome, launchChrome } from "../browser/chrome";
import type { FloorActs } from "../floor/play";
import { RpeReader } from "../lib/read";
import { agentFacts, commitsOf, guidanceOf, installedRphCommit, runningBuild } from "../live/facts";
import { isChatPage, LIVE_NAME_OF, LUMIVERSE_CHAT, openLivePage, type Shared } from "../live/pages";
import { ChatSteps } from "../live/steps";
import type { GuidanceFacts, Host, HostOptions, PlayStart, RunFacts, Session } from "../route/host";
import { type PinHow, pinSettingsFromEnv } from "../route/pin";
import { openRigBed, RIG_CHAT, RIG_PASSWORD, RIG_PRESET, RIG_RPE_CONNECTION, RIG_USER, type RigBed } from "./bed";
import { rigPages } from "./chat-page";
import { openDoor, type Door } from "./door";
import { Fixtures } from "./fixtures";
import { definitionsOf, type Delays, RigModels, withDelays } from "./scripts";
import { PROCESS_CLOCK } from "../../../test/standin/host";
import { type PlainReply, ScriptedProvider } from "../../../test/standin/provider";
import { builtUi } from "./ui";

/** The Lumiverse connection that calls the plain scripted provider (`test/standin/provider.ts`, PlanAdapter-S5 item 6) at `PLAIN_ORIGIN`. */
export const RIG_PLAIN_CONNECTION = "conn-plain";
export const PLAIN_ORIGIN = "http://plain.rig.test";
/** The rig's persona, which the composer's menu offers. */
export const RIG_PERSONA = { id: "pers-traveller", name: "The traveller" };

/** How many replies the Author's own list holds when a run gives none: the floor plays ten turns on RPE's side. */
export const DEFAULT_AUTHOR_REPLIES = 12;

export interface RigOptions {
  /** Each agent's own list of answers, by name, beside the Author's default replies (an Author list given here stands in their place). */
  scripts?: Readonly<Record<string, readonly Answer[]>>;
  /**
   * The delays of a scripted reply, per connection: to its first thinking, to its first word, between words, to its end
   * (PlanScenarios-2 item 8). RPE's are the Author's script's; the plain connection's are the stand-in's scripted provider's
   * (`test/standin/provider.ts`), on the process's own clock, so the page's clock can measure them.
   */
  delays?: { plain?: Delays; rpe?: Delays };
  /** The pin's stage, which the lead's publishing step sets in `RPE_PROOF_PIN_STAGE`; given here by a test. */
  pin?: { stage: PinHow["stage"] };
  /** How long a wait on what a page shows lasts; the suite's limit, else the proof's own. */
  limitMs?: number;
}

/** What the page's Send needs of the stand-in and the stand-in does not serve yet. */
export interface Gap {
  what: string;
  waitsOn: string;
}

/** The player's acts on the stand-in (PlanScenarios-2 item 5), each made as Lumiverse's pages make it. */
export interface PlayerActs {
  /** The connection the composer is on: RPE's, until the player switches. */
  readonly connection: string;
  /** The composer's connection switched: every later generation is on it. */
  switchConnection(id: string): void;
  /** The player sends a line, saved as the page saves it, and the reply is generated; resolves when the generation has ended (RPE's run may go on: `settled`). */
  send(chat: string, line: string): Promise<Outcome>;
  /** A new swipe of the last reply. */
  swipe(chat: string): Promise<Outcome>;
  /** The last reply asked for again. */
  regenerate(chat: string): Promise<Outcome>;
  /** The last reply gone on with (a message by its id, when one is named). */
  continueReply(chat: string, message?: string): Promise<Outcome>;
  /** The player's next line written for them. */
  impersonate(chat: string): Promise<Outcome>;
  /** The swipe shown flipped, left or right, on any message. */
  flipSwipe(chat: string, message: string, direction: "left" | "right"): void;
  deleteMessage(chat: string, message: string): void;
  /** A swipe deleted: Lumiverse's own route for it, which the stand-in does not have (PlanAdapter-S10 item 1). */
  deleteSwipe(chat: string, message: string, swipe: number): never;
  /** The player's edit of a message's text. */
  edit(chat: string, message: string, text: string): void;
  /** A branch of the chat from a message: Lumiverse's route for it, which the stand-in does not have (PlanAdapter-S10). */
  branch(chat: string, from: string): never;
  /** A generation of the chat stopped; whether any was going. */
  stop(chat: string): boolean;
  /** A preset's blocks edited as the preset editor saves them: the edit is given the blocks and gives what they become. */
  editPreset(preset: string, edit: (blocks: Block[]) => Block[]): void;
  /** The post-processing mode set ("" for none, as Lumiverse's setting holds it). */
  postProcessing(mode: string): void;
  /** A World Info entry edited through Lumiverse's own route (`PUT /api/v1/world-books/:id/entries/:eid`), with the revision check it makes when the revision is given. */
  editEntry(book: string, entry: string, changes: Record<string, unknown>, revision?: number): Promise<void>;
  /** Waits until RPE has no run going in the chat. */
  settled(chat: string): Promise<void>;
}

/** What a form is given by the rig's host for one play. */
export interface RigActs extends FloorActs {
  /** The play's footing: the stand-in, RPE, the data folder, the rows. */
  readonly bed: RigBed;
  /** Every agent's scripted model: a form adds the answers its scenario needs, and gates a call. */
  readonly models: RigModels;
  readonly player: PlayerActs;
  readonly fixtures: Fixtures;
  /** The chat RPE's pages are on, and Lumiverse's chat page opens on. */
  readonly chatNow: string;
  openChat(chat: string): void;
  /** The plain connection's scripted model: each request it was asked is in its `calls`. */
  readonly provider: ScriptedProvider;
  /** The turn RPE's Turn page shows. */
  showTurn(turn: string | null): void;
}

const GUIDANCE = (repo: string): string => resolve(repo, "guidance");

export interface RigPagesOptions {
  /** The network door's address (`door.ts`): Lumiverse's pages are opened there. */
  door: string;
  account: { username: string; password: string };
  /** RPE's address and web key. */
  rpe: { base: string; token: string };
  chat(): string | null;
  turn(): string | null;
  shared: Shared;
  limitMs: number;
}

/**
 * Opens a page of the rig in `tab`: RPE's web shell, or Lumiverse's chat page (signing in as a person does when it asks).
 * Lumiverse's chat page is open when its lists are read, its messages shown and its event socket let in: a Send before that
 * would be heard by no one, and a page that could not be set up stops the open, saying why.
 */
export async function openRigPage(page: string, tab: PageTab, options: RigPagesOptions): Promise<void> {
  await openLivePage(page, tab, { lumiverse: options.door, account: options.account, rpe: options.rpe, chat: options.chat, turn: options.turn, shared: options.shared, limitMs: options.limitMs });
  if (!isChatPage(page)) return;
  const end = Date.now() + options.limitMs;
  while (!(await tab.evaluate<boolean>("window.__rig?.ready === true"))) {
    const failed = await tab.evaluate<string[]>("window.__rig?.errors ?? []");
    if (failed.length > 0) throw new Error(`Lumiverse's chat page in the rig could not be set up: ${failed.join("; ")}`);
    if (Date.now() > end) throw new Error(`Lumiverse's chat page in the rig was not ready within ${options.limitMs} ms`);
    await Bun.sleep(25);
  }
}

/** A git command's output in `repo`, or null where git fails. */
function git(repo: string, args: string[]): string | null {
  const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "ignore" });
  return done.exitCode === 0 ? done.stdout.toString().trim() : null;
}

/** The build id the rig's RPE says it is: the checkout's commit (eight digits), RPH's as installed, and `-dirty.<seconds>` for a tree with changes: as `scripts/build.ts` stamps a build, so the run's record can be held to the checkout. */
export function stampOf(repo: string, rph: string | null): string {
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head === null) throw new Error(`${repo} is not a git checkout, so the rig's RPE cannot be stamped with its commit`);
  const changed = git(repo, ["status", "--porcelain"]);
  return `${head.slice(0, 8)}${rph === null ? "" : `-rph.${rph.slice(0, 8)}`}${changed === null || changed === "" ? "" : `-dirty.${Math.floor(Date.now() / 1000)}`}`;
}

/** The one connection the rig's RPE has, scripted: what an agent whose definition names none runs on, so its facts can be read from RPE's own routes. */
const SCRIPTED: ConnectionShown = { id: "scripted", name: "Scripted", provider: "scripted", auth: "none", model: "scripted", default: true, key: null, limitsInForce: null };

/** RPE's own routes as the rig's RPE gives them, but for its connections: the rig's agents run on scripts, not on a connection, so one is given in place of RPE's. */
class RigReader extends RpeReader {
  override async connections(): Promise<ConnectionsShown> {
    return { connections: [SCRIPTED], default: SCRIPTED.id, providers: [] };
  }
}

/** The Author's replies when a run gives none: each an intent record then a reply, the delays set in. */
export function authorReplies(count: number, delays: Delays | undefined): Answer[] {
  return Array.from({ length: count }, (_, i): Answer => {
    const pieces = [...(delays?.firstThinking === undefined ? [] : [{ thinking: "The scene asks for one beat." }]), { text: `<intent>Turn ${i + 1}: the scene goes on, one beat.</intent>` }, { text: `<reply>The lamp turns above you, and the sea answers. (${i + 1})</reply>` }];
    return delays === undefined ? { pieces } : withDelays({ pieces }, delays);
  });
}

/** The plain connection's scripted reply with the delays set: one chunk for each word, thinking first where a first-thinking delay is given. */
export function plainReplyOf(delays: Delays | undefined): PlainReply {
  return {
    words: ["The", " lamp", " turns", " above", " you", " and", " the", " sea", " answers", "."],
    ...(delays?.firstThinking === undefined ? {} : { thinking: ["The scene asks for one beat."], toThinking: delays.firstThinking }),
    ...(delays?.firstWord === undefined ? {} : { toWord: delays.firstWord }),
    ...(delays?.between === undefined ? {} : { between: delays.between }),
    ...(delays?.end === undefined ? {} : { toEnd: delays.end }),
  };
}

/** The routes the page's Send calls, and the package of the stand-in each waits on, asked of the stand-in itself through the door (`GET`s answer 200, the `POST`s with no body say what they lack, never that they are not there). */
export async function standInGaps(door: string, token: string, chat: string): Promise<Gap[]> {
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const answered = await fetch(`${door}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: answered.status, json: await answered.json().catch(() => null) };
  };
  const gaps: Gap[] = [];
  const connections = await call("GET", "/api/v1/connections?limit=200");
  const listed = connections.json;
  const named = Array.isArray(listed) ? listed : typeof listed === "object" && listed !== null && "data" in listed && Array.isArray(listed.data) ? listed.data : [];
  if (connections.status !== 200 || named.length === 0 || !named.every((c: unknown) => typeof c === "object" && c !== null && "name" in c && typeof c.name === "string")) {
    gaps.push({ what: "GET /api/v1/connections, listing each connection with its name (the composer's menu reads it; the floor's reader reads `GET /api/v1/connections/:id` with its `metadata.reasoningBindings`)", waitsOn: "PlanAdapter-S12 item 2's connection routes (S2StandInHosts, `test/standin/profiles.ts`)" });
  }
  if ((await call("GET", "/api/v1/presets?limit=200")).status !== 200) gaps.push({ what: "GET /api/v1/presets, listing the user's presets (the drawer's Preset tab reads it; the floor's fixture finder too)", waitsOn: "no package names it: PlanAdapter-S11 serves one preset by its id only (S2StandInHosts, `test/standin/http.ts`)" });
  if ((await call("POST", "/api/v1/generate", {})).status === 404) gaps.push({ what: "POST /api/v1/generate (and /regenerate, /continue), answering `{generationId, status: \"streaming\"}` at once with the work going on detached", waitsOn: "PlanAdapter-S12 item 2 (S2StandInHosts, `test/standin/chatwrites.ts`)" });
  if ((await call("POST", `/api/v1/chats/${encodeURIComponent(chat)}/messages`, {})).status === 404) gaps.push({ what: "POST /api/v1/chats/:id/messages, the player's line appended", waitsOn: "PlanAdapter-S12 item 2 (S2StandInHosts, `test/standin/chatwrites.ts`)" });
  return gaps;
}

/** What each gap says, for the error a form is given. */
const gapWords = (gaps: readonly Gap[]): string => gaps.map((g) => `${g.what} waits on ${g.waitsOn}`).join("; ");

export async function openRig(options: HostOptions & RigOptions): Promise<Host<RigActs>> {
  const repo = resolve(options.root, "..", "..");
  const definitions = definitionsOf(GUIDANCE(repo));
  const limitMs = options.limitMs ?? (Number(process.env.RPE_TEST_LIMIT_MS) || 30_000);
  const stage = options.pin?.stage ?? pinSettingsFromEnv().stage;
  const how: PinHow = { from: "rph-repository", stage, bundlesFile: null };
  const chrome: Chrome = await launchChrome();
  const ui = await builtUi();
  const stamp = stampOf(repo, installedRphCommit(repo));
  const scriptsOf = (): Record<string, readonly Answer[]> => {
    const given = options.scripts ?? {};
    const rpeDelays = options.delays?.rpe;
    const author = given.author ?? authorReplies(DEFAULT_AUTHOR_REPLIES, rpeDelays);
    const others = Object.fromEntries(Object.entries(given).filter(([name]) => name !== "author"));
    return { ...others, author: given.author === undefined || rpeDelays === undefined ? author : author.map((answer) => withDelays(answer, rpeDelays)) };
  };
  let facts: RunFacts | null = null;

  const host: Host<RigActs> = {
    mode: "rig",

    async facts(): Promise<RunFacts> {
      if (facts !== null) return facts;
      // The facts are read from a footing of their own, as a play's own RPE gives them, then put away.
      const probe = await openRigBed({ models: new RigModels({ definitions }).source, ui, version: stamp, limitMs });
      try {
        const reader = new RigReader(probe.listening.url, probe.webToken);
        const running = await runningBuild({ base: probe.listening.url, token: probe.webToken });
        const { rpe, rph } = commitsOf(repo, running, how);
        facts = {
          rpe,
          rph,
          lumiverse: { version: "the stand-in Lumiverse (test/standin)" },
          browser: { name: chrome.name, version: chrome.version },
          agents: await agentFacts(reader),
          settings: await reader.settings(""),
          guidance: await guidanceOf(reader, "", repo, rpe.commit),
        };
        return facts;
      } finally {
        await probe.close();
      }
    },

    async begin(start: PlayStart): Promise<Session<RigActs>> {
      const models = new RigModels({ definitions, scripts: scriptsOf() });
      const bed = await openRigBed({ models: models.source, ui, version: stamp, limitMs });
      let door: Door | null = null;
      let browser: BrowserDriver | null = null;
      try {
        // The persona the composer offers, and the plain connection: a scripted OpenAI-compatible model the connection's `base` points at (PlanAdapter-S5 item 6), answering at the delays set.
        bed.host.library.addPersona({ id: RIG_PERSONA.id, user: RIG_USER, name: RIG_PERSONA.name, is_default: true });
        const provider = new ScriptedProvider(PROCESS_CLOCK, plainReplyOf(options.delays?.plain));
        bed.host.servers.set(PLAIN_ORIGIN, provider.server);
        bed.host.connections.set(RIG_PLAIN_CONNECTION, { id: RIG_PLAIN_CONNECTION, base: `${PLAIN_ORIGIN}/v1`, key: "plain-key", model: "scripted-plain" });

        door = openDoor({ base: bed.server.base, fetch: bed.server.fetch, open: bed.server.open }, rigPages);
        const lumiverseToken = await (async (): Promise<string> => {
          const signed = await bed.server.fetch(`${bed.server.base}/api/auth/sign-in/username`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "marlow", password: RIG_PASSWORD }) });
          const given: unknown = await signed.json();
          if (typeof given !== "object" || given === null || !("token" in given) || typeof given.token !== "string") throw new Error("the stand-in gave no session token at sign-in");
          return given.token;
        })();
        const doorBase = door.base;
        let chatNow = RIG_CHAT;
        let turnNow: string | null = null;
        let connection = RIG_RPE_CONNECTION;
        const shared: Shared = { cookies: null };
        const reader = new RpeReader(bed.listening.url, bed.webToken);
        const pages = { open: (name: string, tab: PageTab) => openRigPage(name, tab, { door: doorBase, account: { username: "marlow", password: RIG_PASSWORD }, rpe: { base: bed.listening.url, token: bed.webToken }, chat: () => chatNow, turn: () => turnNow, shared, limitMs }), nameOf: LIVE_NAME_OF };
        browser = await BrowserDriver.create({ chrome, pages, limitMs });
        const page = browser;
        const steps = new ChatSteps(page);
        const settled = new Set<string>();
        const fixtures = new Fixtures(bed.host);
        const floorChats = new Set<string>();

        const generate = (chat: string, type?: "swipe" | "regenerate" | "continue" | "impersonate", message?: string): Promise<Outcome> => bed.host.generate({ chat, connection, preset: RIG_PRESET, persona: RIG_PERSONA.id, ...(type === undefined ? {} : { type }), ...(message === undefined ? {} : { message }) });
        const missing = (what: string, package_: string): never => {
          throw new Error(`the stand-in cannot ${what}: ${package_} gives it`);
        };

        const player: PlayerActs = {
          get connection() {
            return connection;
          },
          switchConnection(id) {
            if (!bed.host.connections.has(id)) throw new Error(`the stand-in has no connection ${id}`);
            connection = id;
          },
          send(chat, line) {
            bed.host.send(chat, line);
            return generate(chat);
          },
          swipe: (chat) => generate(chat, "swipe"),
          regenerate: (chat) => generate(chat, "regenerate"),
          continueReply: (chat, message) => generate(chat, "continue", message),
          impersonate: (chat) => generate(chat, "impersonate"),
          flipSwipe: (chat, message, direction) => bed.host.cycleSwipe(chat, message, direction),
          deleteMessage: (chat, message) => bed.host.deleteMessage(chat, message),
          deleteSwipe: () => missing("delete a swipe", "PlanAdapter-S10 item 1 (S1StandIn)"),
          edit: (chat, message, text) => bed.host.editMessage(chat, message, text),
          branch: () => missing("branch a chat", "PlanAdapter-S10 (S1StandIn)"),
          stop: (chat) => bed.host.stop(RIG_USER, { chat }),
          editPreset(preset, edit) {
            const held = bed.host.presets.get(preset);
            if (held === undefined) throw new Error(`the stand-in has no preset ${preset}`);
            bed.host.presets.set(preset, { ...held, blocks: edit(held.blocks.map((b) => ({ ...b }))) });
          },
          postProcessing(mode) {
            bed.host.postProcessing = mode;
          },
          async editEntry(book, entry, changes, revision) {
            const answered = await fetch(`${doorBase}/api/v1/world-books/${encodeURIComponent(book)}/entries/${encodeURIComponent(entry)}`, { method: "PUT", headers: { authorization: `Bearer ${lumiverseToken}`, "content-type": "application/json" }, body: JSON.stringify({ ...changes, ...(revision === undefined ? {} : { expected_revision: revision }) }) });
            if (!answered.ok) throw new Error(`Lumiverse's entry write answered ${answered.status}: ${(await answered.text()).slice(0, 300)}`);
          },
          settled: (chat) => bed.until(`RPE's runs of ${chat} to be over`, () => bed.turns.runs.ofChat(RIG_USER, chat).length === 0).then(() => undefined),
        };

        const nameOf = async (path: string, id: string): Promise<string> => {
          const answered = await fetch(`${doorBase}${path}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${lumiverseToken}` } });
          const row: unknown = await answered.json().catch(() => null);
          if (!answered.ok || typeof row !== "object" || row === null || !("name" in row) || typeof row.name !== "string") throw new Error(`the stand-in gives no name for ${path}/${id} (${answered.status})`);
          return row.name;
        };

        const acts: RigActs = {
          lumiverse: { base: doorBase, token: lumiverseToken },
          rpe: { base: bed.listening.url, token: bed.pageToken },
          connections: { plain: RIG_PLAIN_CONNECTION, rpe: RIG_RPE_CONNECTION },
          bed,
          provider,
          models,
          player,
          fixtures,
          get chatNow() {
            return chatNow;
          },
          openChat(chat) {
            if (!bed.host.chats.has(chat)) throw new Error(`the stand-in has no chat ${chat}`);
            chatNow = chat;
          },
          showTurn(turn) {
            turnNow = turn;
          },
          async chat(card: string): Promise<string> {
            const found = bed.host.library.charactersByIds(RIG_USER, [card]).get(card);
            if (found === undefined) throw new Error(`the rig's Lumiverse holds no card ${card}: a fixture adds it first`);
            const id = `chat-floor-${floorChats.size + 1}`;
            bed.host.addChat({ id, user: RIG_USER, name: "Floor test", character: found, messages: [] });
            floorChats.add(id);
            chatNow = id;
            return id;
          },
          async send(chat: string, via: string, line: string, as: { preset: string; persona: string }): Promise<PageTimes> {
            const gaps = await standInGaps(doorBase, lumiverseToken, chat);
            if (gaps.length > 0) throw new Error(`the chat page cannot be played on the stand-in yet: ${gapWords(gaps)}`);
            chatNow = chat;
            await page.open(LUMIVERSE_CHAT, 1440);
            const [connectionName, personaName, presetName] = await Promise.all([nameOf("/api/v1/connections", via), nameOf("/api/v1/personas", as.persona), nameOf("/api/v1/presets", as.preset)]);
            if (!settled.has(`preset:${as.preset}`)) {
              await steps.choosePreset(presetName);
              settled.add(`preset:${as.preset}`);
            }
            if (!settled.has(`persona:${chat}:${as.persona}`)) {
              await steps.choosePersona(personaName);
              settled.add(`persona:${chat}:${as.persona}`);
            }
            await steps.chooseConnection(connectionName);
            const moments = await steps.send(line, LIMITS.runEnd);
            // A reply the page was told whole, with no token streamed, has moments that mean nothing: the stand-in must stream as Lumiverse does.
            const heard = await page.evaluate<number>("window.__rig.tokens + window.__rig.reasoningTokens");
            if (heard === 0) throw new Error("the page heard no STREAM_TOKEN_RECEIVED while the reply came: the stand-in emits none yet (S1StandIn, `test/standin/lumiverse.ts`: Lumiverse emits one per streamed chunk, `services/generate.service.ts:3320-3365`), so the moments the page noted are not a stream's");
            return moments;
          },
        };

        const guidance = async (): Promise<GuidanceFacts | null> => {
          const commit = facts?.rpe.commit ?? git(repo, ["rev-parse", "HEAD"]);
          return commit === null ? null : await guidanceOf(reader, chatNow, repo, commit);
        };
        return {
          acts,
          browser: page,
          guidance,
          async close(): Promise<void> {
            // What the stand-in's side holds of the play is kept as supporting evidence: its events and its chats' rows.
            await start.keep("lumiverse-events", bed.host.events as unknown as unknown[]).catch(() => undefined);
            await start.keep("lumiverse-messages", bed.db.rows("SELECT * FROM messages ORDER BY chat_id, index_in_chat")).catch(() => undefined);
            await page.close();
            await door?.stop();
            await bed.close();
          },
        };
      } catch (error) {
        await browser?.close().catch(() => undefined);
        await door?.stop().catch(() => undefined);
        await bed.close();
        throw error;
      }
    },

    async close(): Promise<void> {
      await chrome.close();
    },
  };
  return host;
}

/** What the runner loads (`scripts/proof/rig/host.ts`'s `openHost`): the rig with the host's own defaults. */
export async function openHost(options: HostOptions): Promise<Host<RigActs>> {
  return await openRig(options);
}
