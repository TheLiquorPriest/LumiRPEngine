// The light extension's backend, started on Spindle's API (STANDALONE-PLAN §4.3): the question before
// lore activates, the listener that pairs a prompt with its generation, and the prompt interceptor, each
// registered once its permission is granted; the pipe between RPE and the pages; and the permission
// check, whose notice stays up until everything the extension needs is granted. It keeps no settings;
// its one file is RPE's registration (`registration.ts`).

import type { MissingPermission } from "../adapter/lumiverse/pipe-wire";
import { KeptOut } from "./fail-closed";
import { Generations } from "./generations";
import { missing } from "./permissions";
import { startPipe } from "./pipe";
import { promptInterceptor } from "./prompt";
import { worldInfoInterceptor } from "./question";
import { Registrations } from "./registration";
import type { ExtSpindle, ModalItem } from "./spindle";

export interface ExtensionOptions {
  /** How long RPE's answer to the question is waited for; `DEADLINE_MS` when not said. */
  deadlineMs?: number;
  /** How many chats the extension follows at once; `CHATS_FOLLOWED` when not said. */
  chats?: number;
  /** The extension's build, said to RPE at its registration: the one the build stamps when absent. */
  build?: string;
}

/** Fixed: the answer is waited for well inside the ten seconds Lumiverse gives a World Info interceptor (`worker-host.ts:4937-4943`). */
export const DEADLINE_MS = 3_000;
/** Fixed: how many chats are followed at once, each for one generation; past it the one heard from longest ago is dropped. */
export const CHATS_FOLLOWED = 256;
/** Last in Lumiverse's order, lowest first (`interceptor-pipeline.ts:87-90`, `world-info-interceptor.ts:192-194`): the prompt as it will be sent, and the last word on lore. */
export const PRIORITY = Number.MAX_SAFE_INTEGER;
/** The notice's name, so the extension can close it again (`worker-host-presentation-api.ts:500-502`, `:542`). */
export const NOTICE_ID = "rpe-permissions";

export interface RunningExtension {
  stop(): void;
}

/** The blocking notice's body: what is missing and why, and who grants it. */
function noticeItems(lacking: readonly MissingPermission[]): ModalItem[] {
  return [
    { type: "text", content: "RPE cannot play your chats until its extension has these permissions in Lumiverse. A Lumiverse admin grants them on the Extensions page." },
    { type: "divider" },
    ...lacking.map((m): ModalItem => ({ type: "text", content: `${m.permission}: ${m.why}` })),
  ];
}

export async function startExtension(spindle: ExtSpindle, options: ExtensionOptions = {}): Promise<RunningExtension> {
  const chats = options.chats ?? CHATS_FOLLOWED;
  const log = (message: string): void => spindle.log.warn(`[RPE] ${message}`);
  const generations = new Generations(chats);
  const keptOut = new KeptOut(chats);
  const registrations = new Registrations(spindle.userStorage, (url, init) => spindle.cors(url, init));
  let granted: readonly string[] = await spindle.permissions.getGranted();
  const lacking = (): MissingPermission[] => missing(granted);
  /**
   * Users whose RPE the extension refused while it lacked a permission (it cannot confirm a
   * registration without its proxy): they are shown the notice too, though no registration is kept.
   */
  const waiting = new Set<string>();
  // RPE's registration is heard after the start: the notice goes to its user then.
  const pipe = startPipe({
    spindle,
    registrations,
    missing: lacking,
    // The build stamps its id here (scripts/build.ts), as in the application's; run from source, it is the development build.
    build: options.build ?? process.env.LRE_BUILD_ID ?? "dev",
    log,
    registered: () => notice(),
    refused: (user) => {
      if (lacking().length === 0) return;
      waiting.add(user);
      notice();
    },
  });

  /** What each user was last shown, so a notice is not stacked on one that says the same. */
  const shown = new Map<string, string>();
  const notice = (): void => {
    const now = lacking();
    const said = JSON.stringify(now);
    for (const user of new Set([...registrations.users(), ...waiting])) {
      if (shown.get(user) === said) continue;
      const was = shown.get(user);
      shown.set(user, said);
      void (async () => {
        if (was !== undefined && was !== "[]") await spindle.modal.close(NOTICE_ID, user);
        // A persistent modal stays up whatever the user clicks beside it (`worker-host-presentation-api.ts:524`).
        if (now.length > 0) void spindle.modal.open({ title: "RPE needs permissions", items: noticeItems(now), persistent: true, modalRequestId: NOTICE_ID, userId: user });
      })().catch((error: unknown) => log(`the permission notice was not shown: ${error instanceof Error ? error.message : String(error)}`));
    }
    pipe.permissions();
  };

  const question = worldInfoInterceptor({ road: (user) => registrations.road(user), proxy: (url, init) => spindle.cors(url, init), generations, keptOut, deadlineMs: options.deadlineMs ?? DEADLINE_MS, log });
  const prompt = promptInterceptor({ generations, isRpe: (connection, user) => registrations.isRpe(connection, user), granted: (permission) => spindle.permissions.has(permission), log });
  let listening: (() => void)[] = [];
  let unregister: (() => void) | null = null;
  const open = (permission: string): void => {
    if (permission === "generation") {
      spindle.registerWorldInfoInterceptor(question, PRIORITY);
      // A subscription Lumiverse refused is not asked for again by adding a handler (`worker-runtime.ts:1747-1765`): it is dropped and made anew.
      for (const off of listening) off();
      listening = [
        spindle.on("GENERATION_STARTED", (payload, user) => generations.started(payload, user)),
        spindle.on("GENERATION_ENDED", (payload, user) => generations.over(payload, user)),
        spindle.on("GENERATION_STOPPED", (payload, user) => generations.over(payload, user)),
      ];
    } else if (permission === "interceptor") {
      unregister?.();
      unregister = spindle.registerInterceptor(prompt, { priority: PRIORITY, required: true });
    }
  };
  for (const permission of ["generation", "interceptor"]) if (granted.includes(permission)) open(permission);
  const offChanged = spindle.permissions.onChanged((change) => {
    granted = change.allGranted;
    if (change.granted) open(change.permission);
    notice();
  });
  notice();
  return {
    stop() {
      offChanged();
      pipe.stop();
      for (const off of listening) off();
      unregister?.();
    },
  };
}
