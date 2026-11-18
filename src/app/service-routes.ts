// The `service` group's routes of the application's own (plan §4.4): how RPE's service stands. Those a page
// reads and the status anyone may ask are the app's (`appRoutes`); here are the Runtime page's: how RPE runs and since when, where it
// listens, a restart for what holds only at a restart, its own log lines, and how long turns and their parts take; and the owner's
// command line's, answered on its socket alone, and the extension's.

import type { App } from "./app";
import { buildsStatus, restartState } from "./app";
import { COMMAND_PATHS } from "./command-routes";
import { route, shape } from "./routes";
import { memoryHeld } from "./service-memory";
import { acrossTurns, type TurnTimes } from "./service-timings";

/** Where the extension says a new app file has arrived (the extension's road, open to the extension's key alone). */
export const ARRIVED_PATH = "/api/v1/ext/arrived";

/** What the composition gives the service routes of the turn lane: the latest turns' moments of a chat, or of all chats, newest first. */
export type TurnsTimed = (user: string, chat: string | null, limit: number) => Promise<TurnTimes[]>;

const T = shape.text();
const N = shape.number();
const level = shape.oneOf("debug", "info", "warn", "error");

const memory = shape.named(
  "ServiceMemory",
  "What RPE holds now, in bytes: the process's own count, now and at its highest, its worker threads, and what the kernel counts against its service's limit with that limit.",
  shape.object({
    holds: shape.field(N, "The process's resident size now: what it holds in the machine's memory."),
    peak: shape.field(N, "The most it has held since it started."),
    threads: shape.field(N, "Worker threads running now, each a runtime of its own (about 50 MB in the built app); one with nothing to do ends after workers.idleSeconds."),
    service: shape.field(
      shape.nullable(shape.object({ holds: N, peak: shape.nullable(N), limit: shape.nullable(N) })),
      "What the kernel counts against the service's limit now and at its highest (it takes in the pages of the files RPE wrote that the system keeps in memory, which it gives back before the limit is reached), and the limit, the unit's MemoryMax (null: none); null where RPE does not run as a service, or the count cannot be read.",
    ),
  }),
);

const howRuns = shape.named(
  "ServiceHow",
  "How RPE runs now: under its service (the unit's name) or started by hand, since when, the addresses it listens on, the build it runs, whether its service put the known-good copy back, where a restart stands, and the memory it holds.",
  shape.object({
    runs: shape.field(shape.oneOf("service", "by hand"), "Under RPE's own service unit, which starts it again when it exits, or started by hand, which nothing starts again."),
    unit: shape.field(shape.nullable(T), "The service unit's name, where it runs as one."),
    since: shape.field(N, "When this process started, in milliseconds since 1970."),
    listens: shape.field(shape.list(T), "The addresses it answers on: the one set for it, and this machine's loopback, which its extension reaches it by."),
    build: shape.field(T, "The build this process runs."),
    fellBack: shape.field(shape.nullable(T), "What the service's pre-start step did when a build swapped in did not come up, in words; null where it did nothing."),
    restart: restartState,
    memory,
  }),
);

const logLine = shape.object({
  at: shape.field(N, "When it was said, in milliseconds since 1970."),
  level,
  message: T,
  area: shape.field(shape.nullable(T), "The area that said it, where it named one."),
  chat: shape.nullable(T),
  turn: shape.nullable(T),
  job: shape.nullable(T),
  fields: shape.field(shape.json(), "Every field it carried, with each secret hidden."),
});

const partTime = shape.object({
  part: T,
  turns: shape.field(N, "How many of the turns taken in it was seen in."),
  median: shape.field(N, "The middle time, in milliseconds."),
  slowest: N,
  latest: shape.field(N, "The newest turn's, in milliseconds."),
});

export function serviceRoutes(at: Pick<App, "builds" | "version" | "config" | "listening" | "serviceLog" | "now" | "workers" | "index">, turns?: TurnsTimed) {
  const { builds } = at;
  const started = at.now() - process.uptime() * 1000;
  return [
    route({
      method: "POST",
      path: ARRIVED_PATH,
      access: "extension",
      group: "service",
      does: "The extension's word that a new app file has arrived, with the hash stated for it: RPE reads the source it was set up from, takes the build only when every file matches, starts it for real on a scratch copy of its data, and swaps onto it once no turn or job runs.",
      body: shape.object({ hash: shape.optional(shape.text(), "The hash stated for the new app file, as the build states it (the hash of its statement of its files).") }),
      reply: shape.named("Arrived", "Whether RPE took the build, and where it stands, in words.", shape.object({ taken: shape.field(shape.yesNo(), "Whether RPE took the build: every file matched, and it starts."), words: shape.field(T, "Where it stands.") })),
      handle: ({ body }) => builds.arrived(body.hash ?? null),
    }),
    route({
      method: "GET",
      path: COMMAND_PATHS.busy,
      access: "command",
      group: "service",
      does: "How many turns and jobs run now: what a later `rpe up` waits to be none before it restarts RPE's service.",
      reply: shape.named("Busy", "The turns and jobs running now.", shape.object({ busy: shape.field(shape.number(), "How many turns and jobs run now.") })),
      handle: async () => ({ busy: await builds.busy() }),
    }),
    route({
      method: "GET",
      path: "/api/v1/service",
      access: "page",
      group: "service",
      does: "How RPE runs: under its service or by hand, since when, where it listens, its build, whether its service put the known-good copy back, and the memory it holds now against its service's limit.",
      reply: howRuns,
      handle: async () => {
        const runs = await builds.runs();
        const listening = at.listening();
        return {
          runs: runs.service ? ("service" as const) : ("by hand" as const),
          unit: runs.unit,
          since: started,
          listens: listening === null ? [] : [...new Set([listening.url, listening.loopback])],
          build: at.version,
          fellBack: runs.fellBack,
          restart: builds.status().restart,
          memory: await memoryHeld(at.workers.running + at.index.threads, runs.service),
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/service/restart",
      access: "page",
      group: "service",
      does: "Restarts RPE for the values that hold only at a restart, once no turn and no job runs, as \"Update now\" restarts; says it waits while they run, and, run by hand, that it cannot.",
      reply: buildsStatus,
      handle: () => builds.restartHere(),
    }),
    route({
      method: "GET",
      path: "/api/v1/service/log",
      access: "page",
      group: "service",
      does: "RPE's own newest log lines, newest first, each with its level, time, area and the chat, turn or job it names, no secret in any; those of one area, chat, turn or job, or of one level and worse, when asked.",
      query: {
        area: shape.optional(T, "Only the lines of this area."),
        chat: shape.optional(T, "Only the lines that name this chat."),
        turn: shape.optional(T, "Only the lines that name this turn."),
        job: shape.optional(T, "Only the lines that name this job."),
        level: shape.optional(level, "Only this level and the worse."),
        limit: shape.optional(shape.whole({ least: 1 }), "At most this many; every one kept (`service.logLines`) when left out."),
      },
      reply: shape.named("ServiceLog", "RPE's own newest log lines.", shape.object({ lines: shape.list(logLine), kept: shape.field(N, "How many lines RPE keeps at most (`service.logLines`).") })),
      handle: ({ query }) => ({ lines: at.serviceLog.lines({ ...query, limit: Math.min(query.limit ?? at.config.service.logLines, at.config.service.logLines) }), kept: at.config.service.logLines }),
    }),
    route({
      method: "GET",
      path: "/api/v1/service/timings",
      access: "page",
      group: "service",
      does: "How long the parts of a turn took across the latest turns of a chat, or of all chats: for each part, how many turns it was seen in, the middle time, the slowest and the latest.",
      query: { chat: shape.optional(T, "Only this chat's turns; every chat's when left out."), limit: shape.optional(shape.whole({ least: 1 }), "How many of the latest turns; `service.timingsTurns` when left out, and at most that.") },
      reply: shape.named("ServiceTimings", "Each part of a turn and how long it took across the latest turns.", shape.object({ turns: shape.field(N, "How many turns were taken in."), parts: shape.list(partTime) })),
      handle: async ({ user, query }) => {
        const most = at.config.service.timingsTurns;
        const taken = turns === undefined ? [] : await turns(user, query.chat ?? null, Math.min(query.limit ?? most, most));
        return { turns: taken.length, parts: acrossTurns(taken) };
      },
    }),
  ] as const;
}
