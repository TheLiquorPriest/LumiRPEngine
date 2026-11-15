// The cheap gate and the bed's lock (PlanScenarios-5 items 1, 2, 3 and 8; plan §17.0 l.1750, §18.4 l.1998): no live
// run starts without both. The runner calls `guard.lock(run)` before the run's first step and `release` after its
// last, and `guard.admit(facts)` once the host says what the run stands on:
//
// - a tree with changes not committed is refused, and a checkout that is not the commit the run says it stood on;
// - the pair of commits, RPE's and RPH's, must have a gate record that passed (`cheap.ts` makes it);
// - RPH must be held as the plan says: the manifest names one whole commit, the installed folder is a real one at
//   that commit, with every file of it (`pin.ts`);
// - the never-touch list must be in force: the ids, paths, ports and units the run's scripts refuse to touch, given
//   at run time by `LRE_NEVER_TOUCH`, never written here.
//
// The lock is a file the run makes whole or not at all; a second run finds it and is refused, told which run holds
// it. A lock whose process is gone (on this machine) is a run that died, and is taken over, named as such.
// Everything of a machine (the records' folder, the lock's place, RPH's repository) comes from the environment.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { LiveGuard, PinStage, RunFacts } from "../route/host";
import { pinReasons } from "../route/pin";
import { pinProblems, WHOLE_COMMIT } from "./pin";
import { readGate, recordsDir } from "./record";

/** What the guard reads of its machine. */
export interface GuardPlaces {
  /** RPE's checkout the scripts run from. */
  repo: string;
  /** A repository that holds RPH's pinned commit (RPH's own, or its mirror on the bed). */
  rphRepo: string | null;
  /** The gate records' folder. */
  records: string | null;
  /** The lock's file. */
  lock: string | null;
  /** The never-touch list in force. */
  neverTouch: string[];
  /** The pin's stage, which the lead's publishing step sets (`RPE_PROOF_PIN_STAGE`): it decides which name RPE's manifest is held to. Null when nothing says. */
  stage: PinStage | null;
  /** Whether a process of this machine is alive (injected by a test). */
  alive?: (pid: number) => boolean;
}

/** The never-touch list: the ids, paths, ports and units the run's scripts refuse to touch, read from `LRE_NEVER_TOUCH` as the bed's scripts read it (`scripts/testbed/lib/env.ts`). */
export function neverTouch(env: Record<string, string | undefined> = process.env): string[] {
  return (env.LRE_NEVER_TOUCH ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** The places from the environment: RPE's checkout is the one these scripts are in. */
export function placesFromEnv(env: Record<string, string | undefined> = process.env): GuardPlaces {
  const instance = env.LRE_INSTANCE_DIR?.trim();
  const lock = env.RPE_PROOF_LOCK?.trim() || (instance ? join(instance, "proof.lock") : null);
  const stage = env.RPE_PROOF_PIN_STAGE?.trim();
  return { repo: resolve(import.meta.dir, "..", "..", ".."), rphRepo: env.RPE_PROOF_RPH_REPO?.trim() || null, records: recordsDir(env), lock, neverTouch: neverTouch(env), stage: stage === "before-publishing" || stage === "after-publishing" ? stage : null };
}

/** A git command's output in `repo`, or null where git fails. */
function git(repo: string, args: string[]): string | null {
  const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "ignore" });
  return done.exitCode === 0 ? done.stdout.toString().trim() : null;
}

/** Why a checkout is not the clean commit the run says it stood on; empty when it is. */
export function checkoutProblems(repo: string, commit: string): string[] {
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head === null) return [`${repo} is not a git checkout`];
  const out: string[] = [];
  if (head !== commit) out.push(`the checkout is at ${head.slice(0, 8)}, and the run says RPE is ${commit.slice(0, 8)}`);
  const changed = git(repo, ["status", "--porcelain"]);
  if (changed === null) out.push("git cannot say whether the tree has changes");
  else if (changed !== "") out.push(`the tree has changes not committed: ${changed.split("\n").slice(0, 3).join("; ")}${changed.split("\n").length > 3 ? "; …" : ""}`);
  return out;
}

interface Holder {
  run: string;
  pid: number;
  host: string;
  at: string;
}

const isHolder = (value: unknown): value is Holder => isRecord(value) && typeof value.run === "string" && typeof value.pid === "number" && typeof value.host === "string" && typeof value.at === "string";

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** The guard over the places `places` gives each time it is asked (so a test's places and the environment's are both read when used, never when this file loads). */
export function makeGuard(places: () => GuardPlaces, now: () => Date = () => new Date()): LiveGuard & { neverTouch(): string[] } {
  return {
    neverTouch: () => places().neverTouch,

    async lock(run) {
      const where = places();
      if (where.lock === null) throw new Error("the bed's lock has no place: name it in RPE_PROOF_LOCK, or LRE_INSTANCE_DIR, whose folder holds it");
      const file = where.lock;
      mkdirSync(dirname(file), { recursive: true });
      const mine: Holder = { run, pid: process.pid, host: hostname(), at: now().toISOString() };
      for (let tries = 0; tries < 2; tries++) {
        try {
          writeFileSync(file, `${JSON.stringify(mine)}\n`, { flag: "wx", mode: 0o600 });
          return {
            held: false,
            async release() {
              // Only the run that took it gives it back.
              const held: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
              if (isHolder(held) && held.run === run && held.pid === process.pid) rmSync(file, { force: true });
            },
          };
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
        const held: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!isHolder(held)) throw new Error(`${file} is not a lock the runner made: remove it if no run holds the bed`);
        // A lock whose process is gone, on this machine, is a run that died: it is taken over.
        if (held.host === hostname() && !(where.alive ?? processAlive)(held.pid)) {
          rmSync(file, { force: true });
          continue;
        }
        return { held: true, by: `${held.run} (started ${held.at}, process ${held.pid} on ${held.host})` };
      }
      throw new Error(`the bed's lock ${file} could not be taken`);
    },

    async admit(facts: RunFacts) {
      const where = places();
      const refuse = (why: string) => ({ ok: false as const, why });
      const list = where.neverTouch;
      if (list.length === 0) return refuse("no never-touch list is in force: name what the run's scripts refuse to touch in LRE_NEVER_TOUCH");
      if (where.records === null) return refuse("the gate's records have no folder: name it in RPE_PROOF_RECORDS");
      const fault = checkoutProblems(where.repo, facts.rpe.commit);
      if (facts.rpe.dirty) fault.push("the build the run stood on had changes not committed");
      if (fault.length > 0) return refuse(fault.join("; "));
      if (!WHOLE_COMMIT.test(facts.rph.commit)) return refuse(`RPH's commit is ${facts.rph.commit}, which is not one whole commit`);
      const unpinned = pinReasons(facts.rph);
      if (unpinned.length > 0) return refuse(`RPH is ${facts.rph.commit.slice(0, 8)} and RPE's manifest pins ${facts.rph.pin === null ? "none" : facts.rph.pin.slice(0, 8)}: ${unpinned.join("; ")}`);
      const record = readGate(where.records, facts.rpe.commit, facts.rph.commit);
      if (record === null) return refuse(`there is no gate record for RPE ${facts.rpe.commit.slice(0, 8)} with RPH ${facts.rph.commit.slice(0, 8)}: run scripts/proof/gate/cheap.ts on exactly these commits first`);
      if (!record.passed) return refuse(`the gate did not pass on RPE ${facts.rpe.commit.slice(0, 8)} with RPH ${facts.rph.commit.slice(0, 8)}: ${[...record.steps.filter((s) => !s.ok).map((s) => `${s.name} (${s.note})`), ...record.pin].join("; ")}`);
      const pin = pinProblems(where.repo, where.rphRepo, facts.rph.held.stage);
      if (pin.length > 0) return refuse(`RPH is not held as the plan says: ${pin.join("; ")}`);
      return { ok: true as const };
    },
  };
}

/** What `run.ts` loads: the guard over the environment's places. */
export const guard = makeGuard(() => placesFromEnv());
