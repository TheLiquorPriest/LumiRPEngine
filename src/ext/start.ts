// The light extension's backend, started on Spindle's API (STANDALONE-PLAN §4.3): the question before
// lore activates, the listener that pairs a prompt with its generation, and the prompt interceptor,
// each registered once its permission is granted; and the permission check, whose notice stays up
// until everything the extension needs is granted. It keeps no settings and writes nothing.

import { KeptOut } from "./fail-closed";
import { Generations } from "./generations";
import { missing, type Need } from "./permissions";
import { promptInterceptor } from "./prompt";
import { worldInfoInterceptor } from "./question";
import type { Road } from "./road";
import type { ExtSpindle } from "./spindle";

export interface ExtensionDeps {
  /** This user's RPE, from the extension's registration; null where none belongs to them. */
  road(user: string): Promise<Road | null>;
  /** Whether this user's connection is RPE's. */
  isRpe(connection: string, user: string): boolean | Promise<boolean>;
  /** Shows the blocking notice of what is not granted, and why each is needed; clears it when given none. */
  notice(missing: readonly Need[]): void;
  /** How long RPE's answer to the question is waited for. */
  deadlineMs?: number;
  /** How many chats the extension follows at once. */
  chats?: number;
}

/** Fixed: the answer is waited for well inside the ten seconds Lumiverse gives a World Info interceptor (`worker-host.ts:4937-4943`). */
export const DEADLINE_MS = 3_000;
/** Fixed: how many chats are followed at once, each for one generation; past it the one heard from longest ago is dropped. */
export const CHATS_FOLLOWED = 256;
/** Last in Lumiverse's order, lowest first (`interceptor-pipeline.ts:87-90`, `world-info-interceptor.ts:192-194`): the prompt as it will be sent, and the last word on lore. */
export const PRIORITY = Number.MAX_SAFE_INTEGER;

export interface RunningExtension {
  stop(): void;
}

export async function startExtension(spindle: ExtSpindle, deps: ExtensionDeps): Promise<RunningExtension> {
  const chats = deps.chats ?? CHATS_FOLLOWED;
  const generations = new Generations(chats);
  const keptOut = new KeptOut(chats);
  const log = (message: string): void => spindle.log.warn(`[RPE] ${message}`);
  const question = worldInfoInterceptor({ road: deps.road, proxy: (url, init) => spindle.cors(url, init), generations, keptOut, deadlineMs: deps.deadlineMs ?? DEADLINE_MS, log });
  const prompt = promptInterceptor({ generations, isRpe: deps.isRpe, granted: (permission) => spindle.permissions.has(permission), log });
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
  const granted = await spindle.permissions.getGranted();
  for (const permission of ["generation", "interceptor"]) if (granted.includes(permission)) open(permission);
  deps.notice(missing(granted));
  const offChanged = spindle.permissions.onChanged((change) => {
    if (change.granted) open(change.permission);
    deps.notice(missing(change.allGranted));
  });
  return {
    stop() {
      offChanged();
      for (const off of listening) off();
      unregister?.();
    },
  };
}
