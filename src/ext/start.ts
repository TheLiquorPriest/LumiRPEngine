// The light extension's backend, started on Spindle's API (STANDALONE-PLAN §4.3): the question before
// lore activates, the listener that pairs a prompt with its generation, and the prompt interceptor, each
// registered once its permission is granted; the pipe between RPE and the pages; and the permission
// check, whose notice stays up until everything the extension needs is granted. It keeps no settings and
// no memory between generations: its values come with RPE's registration, and its one file is that
// registration (`registration.ts`).

import type { MissingPermission } from "../adapter/lumiverse/pipe-wire";
import { Generations } from "./generations";
import { missing } from "./permissions";
import { startPipe } from "./pipe";
import { promptInterceptor } from "./prompt";
import { worldInfoInterceptor } from "./question";
import { Registrations } from "./registration";
import type { ExtSpindle, ModalItem } from "./spindle";

export interface ExtensionOptions {
  /** The extension's build, said to RPE at its registration: the one the build stamps when absent. */
  build?: string;
  /** The hash the build stated for the app file in the extension's folder: the one the build stamps when absent; null where there is none. */
  statedHash?: string | null;
}

/** Last in Lumiverse's order, lowest first (`interceptor-pipeline.ts:87-90`, `world-info-interceptor.ts:192-194`): the prompt as it will be sent, and the last word on lore. */
export const PRIORITY = Number.MAX_SAFE_INTEGER;
/** The notice's name, so the extension can close it again (`worker-host-presentation-api.ts:500-502`, `:542`). */
export const NOTICE_ID = "rpe-permissions";

export interface RunningExtension {
  stop(): void;
}

/** The blocking notice's body: what is missing and why, and who grants it; and where RPE's registration could not be read, that. */
function noticeItems(lacking: readonly MissingPermission[], unread: string | undefined): ModalItem[] {
  const items: ModalItem[] = [];
  if (lacking.length > 0) {
    items.push({ type: "text", content: "RPE cannot play your chats until its extension has these permissions in Lumiverse. A Lumiverse admin grants them on the Extensions page." }, { type: "divider" });
    for (const m of lacking) items.push({ type: "text", content: `${m.permission}: ${m.why}` });
  }
  if (unread !== undefined) {
    if (items.length > 0) items.push({ type: "divider" });
    items.push({ type: "text", content: `RPE's extension could not read RPE's registration from its storage in Lumiverse (${unread}). Until it can, it tells RPE's chats by the mark on RPE's connections in Lumiverse.` });
  }
  return items;
}

export async function startExtension(spindle: ExtSpindle, options: ExtensionOptions = {}): Promise<RunningExtension> {
  const log = (message: string): void => spindle.log.warn(`[RPE] ${message}`);
  const generations = new Generations();
  /** By user: why their stored registration could not be read, while it cannot (N-3): they are shown the notice. */
  const unread = new Map<string, string>();
  const registrations = new Registrations({
    storage: spindle.userStorage,
    proxy: (url, init) => spindle.cors(url, init),
    connections: spindle.connections,
    unread: (user, why) => {
      if (why === null ? !unread.delete(user) : unread.get(user) === why) return;
      if (why !== null) {
        unread.set(user, why);
        log(`the registration of user ${user} could not be read from the extension's storage: ${why}`);
      }
      notice();
    },
    log,
  });
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
    // The build stamps the hash it stated for the app file beside the extension (scripts/build.ts); run from source there is none.
    statedHash: options.statedHash !== undefined ? options.statedHash : (process.env.RPE_STATED_HASH ?? null),
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
    for (const user of new Set([...registrations.users(), ...waiting, ...unread.keys()])) {
      const why = unread.get(user);
      const items = now.length > 0 || why !== undefined ? noticeItems(now, why) : [];
      const said = JSON.stringify(items);
      if (shown.get(user) === said) continue;
      const was = shown.get(user);
      shown.set(user, said);
      void (async () => {
        if (was !== undefined && was !== "[]") await spindle.modal.close(NOTICE_ID, user);
        // A persistent modal stays up whatever the user clicks beside it (`worker-host-presentation-api.ts:524`).
        if (items.length > 0) void spindle.modal.open({ title: now.length > 0 ? "RPE needs permissions" : "RPE's registration could not be read", items, persistent: true, modalRequestId: NOTICE_ID, userId: user });
      })().catch((error: unknown) => log(`the notice was not shown: ${error instanceof Error ? error.message : String(error)}`));
    }
    pipe.permissions();
  };

  const question = worldInfoInterceptor({ road: (user) => registrations.road(user), proxy: (url, init) => spindle.cors(url, init), generations, log });
  const prompt = promptInterceptor({
    generations,
    whose: (connection, user) => registrations.whose(connection, user),
    granted: (permission) => spindle.permissions.has(permission),
    log,
    stopped: (user, record) => pipe.stopped(user, record),
  });
  let listening: (() => void)[] = [];
  let unregister: (() => void) | null = null;
  const open = (permission: string): void => {
    if (permission === "generation") {
      spindle.registerWorldInfoInterceptor(question, PRIORITY);
      // A subscription Lumiverse refused is not asked for again by adding a handler (`worker-runtime.ts:1747-1765`): it is dropped and made anew.
      for (const off of listening) off();
      listening = [
        spindle.on("GENERATION_STARTED", (payload, user) => {
          generations.started(payload, user);
          // The user's registration is read from storage before their prompt is checked, as at the worker's start for them; a read that fails is shown by the notice.
          if (user !== undefined) registrations.of(user).catch(() => undefined);
        }),
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
