// The swap (STANDALONE-PLAN §15.3 step 10, §4.6): run by `rpe up` on the owner's word, once the
// installed extension has been switched to the new build. It reads first, as the rehearsal does, and
// stops nothing where the run would be refused. Then it waits for today's runtime to be idle, as
// today's own `lumiah up` waits before it restarts one (its "Wait before restart" and "Restart poll"
// settings), stops today's service, and runs the migration again from the start: a fresh backup,
// every chat not yet played on RPE imported again, the check, the report. Only once that run went
// through is today's service removed; a run that didn't go through starts again what it stopped.
// Of today's it removes the unit alone: the runtime's config and folders stay as they were, so its
// own install line brings it back (§15.6 step 4); and it never calls Lumiverse.

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { runtimeBase, unitName } from "lumi-ah/link";
import { unitPath } from "lumi-ah/runtime";
import type { Env } from "../app/config";
import { mustRun, type Systemctl } from "../app/up";
import { isRecord } from "../shared/json";
import { migrate, type MigrateOptions, type MigrateResult } from "./migrate";
import { reportText } from "./report";
import type { SavedRuntime } from "./runtime-folders";
import { openToday, type Sources } from "./today";

export interface SwapIo {
  out(line: string): void;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
  sleep(ms: number): Promise<void>;
  systemctl: Systemctl;
  env: Env;
  home: string;
}

export interface SwapInput {
  sources: Sources;
  /** The real run's options: RPE's data folder, the build, the file tree's layout. */
  options: MigrateOptions;
  /** RPE's own unit on that data folder, where one is installed: stopped while the run writes, the run being the data folder's one writer. */
  rpeUnit: string | null;
}

export interface SwapResult {
  /** The run went through, and today's service is gone. */
  ok: boolean;
  /** Today's runtime the run took, and the unit that ran it, removed once the run went through. */
  took: { name: string; unit: string | null } | null;
  /** The real run, where it was made. */
  run: MigrateResult | null;
}

/** What today's runtime has under way: its turns and its calls; null where nothing answers; "unknown" where what answers doesn't say. */
type UnderWay = { turns: number; requests: number } | "unknown" | null;

/**
 * The unit that runs a runtime, as today's build finds it (`unitRunning`, `H/runtime/update/service.ts:78-93`):
 * the one its config names, else the one `lumiah up --systemd` names for it; null where its file isn't there.
 */
function unitOf(config: SavedRuntime, env: Env, home: string): { unit: string; file: string } | null {
  const unit = config.service ?? { unit: unitName(config.name), file: unitPath(env, home, unitName(config.name)) };
  return existsSync(unit.file) ? { unit: unit.unit, file: unit.file } : null;
}

/**
 * The proof `GET /healthz` takes that the asker holds the runtime's config (LumiAH `runtime/proof.ts`,
 * which its package doesn't export), so the runtime answers in full wherever it listens:
 * `<at>.<nonce>.<HMAC-SHA256 of "lumiah healthz\n<at>\n<nonce>" under its relay secret>`.
 */
function healthProof(secret: string, at: number): string {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  return `${at}.${nonce}.${new Bun.CryptoHasher("sha256", secret).update(`lumiah healthz\n${at}\n${nonce}`).digest("hex")}`;
}

/** What today's runtime says it has under way (`GET /healthz`, LumiAH `runtime/relay.ts:179-192`). Each ask is given until the next is due; one that gets no answer in that time is from a runtime that is there and doesn't say. */
async function underWay(config: SavedRuntime, io: SwapIo): Promise<UnderWay> {
  let res: Response;
  try {
    res = await io.fetch(`${runtimeBase(config.listen, config.port).replace(/\/v1$/, "")}/healthz`, { headers: { Accept: "application/json", Authorization: `Bearer ${healthProof(config.secret, io.now())}` }, signal: AbortSignal.timeout(config.tuning.drainPollMs) });
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError" ? "unknown" : null;
  }
  const body: unknown = await res.json().catch(() => null);
  return isRecord(body) && typeof body.turns === "number" && typeof body.requests === "number" ? { turns: body.turns, requests: body.requests } : "unknown";
}

const busy = (u: UnderWay): boolean => u === "unknown" || (u !== null && u.turns + u.requests > 0);
const said = (u: UnderWay): string => (u === "unknown" || u === null ? "answers, but doesn't say what it has under way" : `has ${u.turns} turn(s) and ${u.requests} request(s) under way`);

/** Waits for today's runtime to be idle, up to its own "Wait before restart" setting, asking every "Restart poll"; whether it is. */
async function idle(name: string, config: SavedRuntime, io: SwapIo): Promise<boolean> {
  const { drainMs, drainPollMs } = config.tuning;
  let now = await underWay(config, io);
  if (!busy(now)) return true;
  io.out(`Today's runtime ${name} ${said(now)}: waiting up to ${Math.round(drainMs / 1000)} seconds (its own "Wait before restart" setting) for it to be idle.`);
  for (let waited = 0; waited < drainMs && busy(now); waited += drainPollMs) {
    await io.sleep(drainPollMs);
    now = await underWay(config, io);
  }
  if (busy(now)) io.out(`Today's runtime ${name} still ${said(now)} after ${Math.round(drainMs / 1000)} seconds: nothing was stopped or changed. Run rpe up again once it is idle.`);
  return !busy(now);
}

export async function swap(input: SwapInput, io: SwapIo): Promise<SwapResult> {
  const { sources, options } = input;
  // Read first: a run the gate would refuse stops nothing, and today's build goes on answering.
  const gate = await migrate(sources, { ...options, rehearse: true });
  if (gate.report.refusals.length > 0) {
    io.out(reportText(gate.report).replace(/\n$/, ""));
    io.out("The swap stopped before anything was stopped or changed: the run would be refused, as the report says.");
    return { ok: false, took: null, run: null };
  }
  const today = await openToday(sources);
  const taken = today.runtime.runtimes[0] ?? null;
  today.close();
  const service = taken === null ? null : unitOf(taken.config, io.env, io.home);
  const took = taken === null ? null : { name: taken.name, unit: service?.unit ?? null };
  if (taken !== null) {
    if (!(await idle(taken.name, taken.config, io))) return { ok: false, took, run: null };
    if (service === null && (await underWay(taken.config, io)) !== null) {
      io.out(`Today's runtime ${taken.name} answers at ${taken.config.listen}:${taken.config.port}, but runs under no unit rpe up can stop: stop it where it runs, then run rpe up again. Nothing was stopped or changed.`);
      return { ok: false, took, run: null };
    }
  }

  const stopped: string[] = [];
  let run: MigrateResult | null = null;
  try {
    for (const unit of [input.rpeUnit, service?.unit]) {
      if (unit === null || unit === undefined) continue;
      await mustRun(io.systemctl, ["stop", unit]);
      stopped.push(unit);
    }
    run = await migrate(sources, options);
    io.out(reportText(run.report).replace(/\n$/, ""));
  } catch (error) {
    io.out(`The migration stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (run?.ran !== true) {
    // As it was: what was stopped runs again.
    for (const unit of stopped) await mustRun(io.systemctl, ["start", unit]);
    io.out(`The swap did not go through. ${stopped.length > 0 ? `${stopped.join(" and ")} run(s) again, as before.` : "Nothing was stopped."} Nothing of today's was changed.`);
    return { ok: false, took, run };
  }
  if (service !== null) {
    await mustRun(io.systemctl, ["disable", service.unit]);
    await rm(service.file, { force: true });
    await mustRun(io.systemctl, ["daemon-reload"]);
    io.out(`Stopped and removed ${service.unit}, today's service. Today's runtime's config and folders stay as they were, for going back.`);
  }
  return { ok: true, took, run };
}
