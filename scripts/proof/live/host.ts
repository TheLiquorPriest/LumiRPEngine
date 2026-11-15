// The test bed's host (PlanScenarios-3; plan §17.0, §18.3, §18.4): the runner's footing on the bed, where the real
// Lumiverse and the real RPE run with the real model. The host plays Lumiverse's own pages and RPE's with the one
// browser driver the rig shares (`scripts/proof/browser/`), signs in once as the instance's user as a person
// signs in, and acts only inside the instance (`instance.ts`): its address, its user, its chats. It reads what the
// run stood on from what is running (`facts.ts`) and gives each play a footing of its own: a browser window in a
// context of its own, with the acts of the floor (`FloorActs`, `scripts/proof/floor/play.ts`) on the real pages.
//
// Every value of the machine comes from the environment (`env.ts`); nothing here names a host, a user or a key.
// The lead runs it, one run at a time, through `run.ts live`, behind PlanScenarios-5's gate and lock.

import { basename, join, resolve } from "node:path";
import type { FloorActs } from "../floor/play";
import { BrowserDriver } from "../browser/driver";
import { type Chrome, launchChrome } from "../browser/chrome";
import { RpeReader } from "../lib/read";
import type { GuidanceFacts, Host, HostOptions, PlayStart, RunFacts, Session } from "../route/host";
import { pinSettingsFromEnv } from "../route/pin";
import { CHAT_NAME, fileRecord, RECORD_FILE } from "../../testbed/floor-fixture";
import { LIMITS, type PageTimes } from "../../testbed/floor-measure";
import { Lumiverse, savedToken } from "../../testbed/lib/lumiverse";
import { RunLog } from "../../testbed/lib/record";
import { readLiveEnv, type LiveEnv } from "./env";
import { agentFacts, commitsOf, guidanceOf, lumiverseVersion, runningBuild } from "./facts";
import { Instance, InstanceLumiverse } from "./instance";
import { LIVE_NAME_OF, LUMIVERSE_CHAT, openLivePage, type Shared } from "./pages";
import { ChatSteps } from "./steps";
import { commandShell, shellWords, Terminal, WithTerminal, type Ran } from "./terminal";

/** The acts a form on the bed plays with: the floor's, and the page's own. */
export interface LiveActs extends FloorActs {
  /** Opens Lumiverse's chat page on a chat of the instance's and keeps it the chat the pages are on. */
  openChat(chat: string): Promise<void>;
  /** The chat the pages are on now, or null. */
  readonly chatNow: string | null;
  /** A terminal on the bed's server (`LRE_BED_SHELL`): a command typed as the owner would, kept as the screen he would see (a form reads it as the page "terminal"). */
  terminal: { run(command: string): Promise<Ran> };
  /** A fresh chat on the instance's own card, recorded as the instance's, which the pages are then on. Every play of a scenario begins on one. */
  freshChat(name: string): Promise<string>;
}

/** How long a wait on what a page shows lasts, as the suite's runner sets it for a test, else the proof's own. */
const LIMIT_MS = Number(process.env.RPE_TEST_LIMIT_MS) || 30_000;

/** RPE's repository, from the proof folder (`scripts/proof`). */
const repoOf = (root: string): string => resolve(root, "..", "..");

/** A name or an id of a Lumiverse connection, matched to the one connection that has it. */
async function connectionByNameOrId(host: Lumiverse, wanted: string): Promise<{ id: string; name: string }> {
  const found = (await host.connections()).filter((c) => c.id === wanted || c.name === wanted);
  const [one] = found;
  if (found.length !== 1 || one === undefined) throw new Error(`${found.length} Lumiverse connections are named or numbered "${wanted}"; the run needs exactly one`);
  return { id: one.id, name: one.name };
}

export async function openHost(options: HostOptions): Promise<Host<LiveActs>> {
  const env: LiveEnv = readLiveEnv();
  const repo = repoOf(options.root);
  // Lumiverse lower-cases user names (its login page does): the instance's user is named so everywhere here.
  const owner = env.owner.username.toLowerCase();
  const instance = new Instance(env.bed.hostUrl, owner, env.bed.instanceDir);
  const token = savedToken(env.bed);

  // Lumiverse's own account of who the saved sign-in is: it must be the instance's user, never another.
  const session = await new Lumiverse(env.bed.hostUrl, token).call<{ user?: { username?: string } } | null>("GET", "/api/auth/get-session");
  const signedInAs = session?.user?.username?.toLowerCase();
  if (typeof signedInAs !== "string" || signedInAs === "") throw new Error("Lumiverse's account of the saved sign-in names no user name");
  const lumiverse = new InstanceLumiverse(env.bed.hostUrl, token, instance, signedInAs, owner);
  instance.check({ address: env.bed.hostUrl, user: signedInAs, named: owner });

  const plain = await connectionByNameOrId(lumiverse, env.connections.plain);
  const rpeConnection = await connectionByNameOrId(lumiverse, env.connections.rpe);
  const reader = new RpeReader(env.rpe.base, env.rpe.token);
  const chrome: Chrome = await launchChrome();
  const shared: Shared = { cookies: null };
  let commit: string | null = null;

  const host: Host<LiveActs> = {
    mode: "live",

    async facts(): Promise<RunFacts> {
      const running = await runningBuild(env.rpe);
      const how = pinSettingsFromEnv();
      if (how.from === null) throw new Error("set RPE_PROOF_PIN_FROM to where rp-harness was installed on the bed from (bed-mirror, rph-repository or github): a live run records how the pin was held");
      const { rpe, rph } = commitsOf(repo, running, { from: how.from, stage: how.stage, bundlesFile: how.bundlesFile });
      commit = rpe.commit;
      return {
        rpe,
        rph,
        instance: { address: env.bed.hostUrl, name: basename(env.bed.instanceDir) },
        user: signedInAs,
        neverTouch: env.bed.neverTouch,
        lumiverse: { version: await lumiverseVersion(lumiverse) },
        browser: { name: chrome.name, version: chrome.version },
        agents: await agentFacts(reader),
        settings: await reader.settings(""),
        guidance: await guidanceOf(reader, "", repo, rpe.commit),
      };
    },

    async begin(start: PlayStart): Promise<Session<LiveActs>> {
      let chatNow: string | null = null;
      let turnNow: string | null = null;
      const pages = {
        open: (page: string, tab: Parameters<typeof openLivePage>[1]) => openLivePage(page, tab, { lumiverse: env.bed.hostUrl, account: env.owner, rpe: env.rpe, chat: () => chatNow, turn: () => turnNow, shared, limitMs: LIMIT_MS }),
        nameOf: LIVE_NAME_OF,
      };
      const browser = await BrowserDriver.create({ chrome, pages, limitMs: LIMIT_MS });
      const steps = new ChatSteps(browser);
      const terminal = new Terminal({ run: (command) => commandShell(shellWords()).run(command) }, env.bed.neverTouch);
      const look = new WithTerminal(browser, terminal);
      const settled = new Set<string>();

      const names = async (path: string, id: string): Promise<string> => {
        const row = await lumiverse.call<{ name?: unknown }>("GET", `${path}/${encodeURIComponent(id)}`);
        if (typeof row.name !== "string" || row.name === "") throw new Error(`Lumiverse gives no name for ${path}/${id}`);
        return row.name;
      };

      const acts: LiveActs = {
        lumiverse: { base: env.bed.hostUrl, token },
        rpe: { base: env.rpe.base, token: env.rpe.token },
        connections: { plain: plain.id, rpe: rpeConnection.id },
        get chatNow() {
          return chatNow;
        },
        terminal,
        async freshChat(name: string): Promise<string> {
          const card = new RunLog(env.bed.instanceDir).get<string>("cardId");
          if (typeof card !== "string" || card === "") throw new Error("the instance's record names no card of its own (cardId in state.json), so a fresh chat cannot be made on it");
          const made = await lumiverse.createChat(card, name);
          chatNow = made.id;
          return made.id;
        },
        async openChat(chat: string): Promise<void> {
          // Before any step: the address, the user and the chat are the instance's, or the run stops.
          instance.check({ address: env.bed.hostUrl, user: signedInAs, named: owner, chat });
          chatNow = chat;
          await browser.open(LUMIVERSE_CHAT, 1440);
        },
        async chat(card: string): Promise<string> {
          const made = await lumiverse.createChat(card, CHAT_NAME);
          // The floor's own record lists it too, so `floor.ts remove` takes it away with the rest of the fixture.
          const store = fileRecord(join(env.bed.instanceDir, RECORD_FILE));
          const record = store.read();
          if (!record.chats.includes(made.id)) store.write({ ...record, chats: [...record.chats, made.id] });
          chatNow = made.id;
          return made.id;
        },
        async send(chat: string, connection: string, line: string, as: { preset: string; persona: string }): Promise<PageTimes> {
          await acts.openChat(chat);
          const [connectionName, personaName, presetName] = await Promise.all([connectionByNameOrId(lumiverse, connection).then((c) => c.name), names("/api/v1/personas", as.persona), names("/api/v1/presets", as.preset)]);
          // The preset is the user's active one, the persona the chat's: each is set once, as a person sets it, and stays.
          if (!settled.has(`preset:${as.preset}`)) {
            await steps.choosePreset(presetName);
            settled.add(`preset:${as.preset}`);
          }
          if (!settled.has(`persona:${chat}:${as.persona}`)) {
            await steps.choosePersona(personaName);
            settled.add(`persona:${chat}:${as.persona}`);
          }
          await steps.chooseConnection(connectionName);
          return await steps.send(line, LIMITS.runEnd);
        },
      };

      const guidance = async (): Promise<GuidanceFacts | null> => (commit === null ? null : await guidanceOf(reader, chatNow ?? "", repo, commit));
      // Every play of a scenario begins on a fresh chat of the instance's own, made for it and recorded as the instance's, so a repeat never plays on what an earlier play left.
      if (start.form.kind === "scenario") {
        await acts.freshChat(`Proof ${start.form.id} play ${start.play} of ${start.plays}`).catch(async (error: unknown) => {
          await browser.close();
          throw error;
        });
      }
      return {
        acts,
        browser: look,
        guidance,
        async close(): Promise<void> {
          await browser.close();
        },
      };
    },

    async close(): Promise<void> {
      await chrome.close();
    },
  };
  return host;
}
