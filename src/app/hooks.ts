// What an area adds to the hooks of the others (STANDALONE-PLAN §4.1): a view an agent is given by
// name, which the turn lane's `views` hook takes from every area, and the lanes of the door to
// Lumiverse, each of which is filled by the area that knows the answer. An area names what it adds in
// its own file (`fills` of its `Area`), so the composition names each area once and no later package
// edits it. The app gathers every area's here when it opens, and the area that owns a hook reads it
// from the app when it is asked.

import type { AgentRef, HostTool, RunScope, UserSessionScope } from "rp-harness/contract";
import type { Setting } from "./setting-list";
import type { NamedNow } from "./switches";

/** A view an agent is given by name, beyond the turn's own: its text; null for a name that is none of the area's own. A job of no chat asks it too. */
export type ViewHook = (scope: RunScope, agent: AgentRef, ref: string) => Promise<string | null>;

/** The host's tools for a job of no chat (C-23: Build's model jobs). */
export type JobToolsHook = (scope: UserSessionScope) => Promise<HostTool[]>;

/**
 * The lanes of the door to Lumiverse that an area fills. The door's own file names each lane, by adding
 * its entry here (`src/adapter/lumiverse/area.ts`), so this file names none of the door's types; a lane
 * no area fills is what the door answers by itself. Only one area fills a lane.
 */
// biome-ignore lint/suspicious/noEmptyInterface: each lane is added by the door's file, which owns its types
export interface DoorFills {}

/** Lists what the user's files name that runs a command or calls out, as the files stand now, so that the registry holds each as waiting before anything reads it; says what the files name now, null where that is not known. */
export type ListFilesHook = () => Promise<NamedNow | null>;

/** Takes on the chat a route names in its path (`/api/v1/chats/:chat/…`) before a route that keeps or changes something of it answers (`takesChat`): a chat Lumiverse does not have is refused in words. */
export type ChatNamedHook = (user: string, chat: string) => Promise<void>;

/** Waits, before any route that names a chat in its path answers, until that chat is ready to be read: while RPE makes a chat's states ready for the build that runs (`src/store/prepare.ts`), a read of it waits, and it is taken next. */
export type ChatReadyHook = (user: string, chat: string) => Promise<void>;

/** What one area adds to the hooks of the others. */
export interface Fills {
  /** A view given to an agent by name, which the turn lane's `views` hook asks of every area in turn. */
  readonly views?: ViewHook;
  /** Tools a job of no chat is given, which the turn lane gathers from every area. */
  readonly jobTools?: JobToolsHook;
  /** Looks at the files for what runs a command or calls out, which the app asks before it reads the list of switches. */
  readonly listFiles?: ListFilesHook;
  /** Takes on a chat a route names, which the server asks before every such route answers. One area fills it. */
  readonly chatNamed?: ChatNamedHook;
  /** Waits until a chat a route names is ready to be read, which the server asks before every such route answers. One area fills it. */
  readonly chatReady?: ChatReadyHook;
  /** The door's lanes this area fills. */
  readonly door?: DoorFills;
}

/** The hooks as the app holds them, gathered from every area's `fills`. */
export interface Hooks {
  /** Asks each area's view in the order of the areas; the first text is the answer, null where none of them has the name. */
  readonly views: ViewHook;
  /** Every area's tools for a job of no chat, in the order of the areas. */
  readonly jobTools: JobToolsHook;
  /** Every area's look at the files, once each, as the files stand now. */
  readonly listFiles: ListFilesHook;
  /** The one area's taking on of a chat a route names; absent where no area fills it, and nothing is done first. */
  readonly chatNamed?: ChatNamedHook;
  /** The one area's wait for a chat a route names to be ready; absent where no area fills it, and nothing waits. */
  readonly chatReady?: ChatReadyHook;
  /** The door's lanes, each as the one area that fills it gave it; a lane no area fills is absent. */
  readonly door: Readonly<DoorFills>;
}

/** What gathering reads of an area. */
interface Giving {
  readonly name: string;
  readonly fills?: Fills;
  readonly settings?: readonly Setting[];
}

/** Every area's fills as one set of hooks; a lane of the door, or the taking on of a chat, that two areas fill is an error that names both. */
export function gatherHooks(areas: readonly Giving[]): Hooks {
  const views: ViewHook[] = [];
  const tools: JobToolsHook[] = [];
  const listers: ListFilesHook[] = [];
  const door: Record<string, unknown> = {};
  const filledBy = new Map<string, string>();
  let chatNamed: { by: string; hook: ChatNamedHook } | null = null;
  let chatReady: { by: string; hook: ChatReadyHook } | null = null;
  for (const area of areas) {
    if (area.fills?.views !== undefined) views.push(area.fills.views);
    if (area.fills?.jobTools !== undefined) tools.push(area.fills.jobTools);
    if (area.fills?.listFiles !== undefined) listers.push(area.fills.listFiles);
    if (area.fills?.chatNamed !== undefined) {
      if (chatNamed !== null) throw new Error(`A chat a route names is taken on by two areas, ${chatNamed.by} and ${area.name}: one area takes it on.`);
      chatNamed = { by: area.name, hook: area.fills.chatNamed };
    }
    if (area.fills?.chatReady !== undefined) {
      if (chatReady !== null) throw new Error(`Whether a chat a route names is ready is waited for by two areas, ${chatReady.by} and ${area.name}: one area waits for it.`);
      chatReady = { by: area.name, hook: area.fills.chatReady };
    }
    for (const [lane, fill] of Object.entries(area.fills?.door ?? {})) {
      if (fill === undefined) continue;
      const first = filledBy.get(lane);
      if (first !== undefined) throw new Error(`The door's ${lane} lane is filled by two areas, ${first} and ${area.name}: one area fills a lane.`);
      filledBy.set(lane, area.name);
      door[lane] = fill;
    }
  }
  return {
    views: async (scope, agent, ref) => {
      for (const view of views) {
        const text = await view(scope, agent, ref);
        if (text !== null) return text;
      }
      return null;
    },
    jobTools: async (scope) => (await Promise.all(tools.map((t) => t(scope)))).flat(),
    listFiles: async () => {
      const found = await Promise.all(listers.map((look) => look()));
      const first = found[0];
      // What every area that looks found the files naming; where one could not look, or none did, the list shows what the registry holds.
      if (first === undefined || first === null || !found.every((n) => n !== null && n.user === first.user)) return null;
      return { user: first.user, names: new Set(found.flatMap((n) => (n === null ? [] : [...n.names]))) };
    },
    ...(chatNamed === null ? {} : { chatNamed: chatNamed.hook }),
    ...(chatReady === null ? {} : { chatReady: chatReady.hook }),
    door: door as DoorFills,
  };
}

/** The registry: every area's settings, in the order of the areas; a key two areas list (RPH's among them, which one area lists) is an error that names both. */
export function gatherSettings(areas: readonly Giving[]): Setting[] {
  const out: Setting[] = [];
  const listedBy = new Map<string, string>();
  for (const area of areas) {
    for (const def of area.settings ?? []) {
      const first = listedBy.get(def.key);
      if (first !== undefined) throw new Error(`The setting ${def.key} is listed by two areas, ${first} and ${area.name}: one area lists a setting.`);
      listedBy.set(def.key, area.name);
      out.push(def);
    }
  }
  return out;
}
