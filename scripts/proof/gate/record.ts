// The cheap gate's record (PlanScenarios-5 item 1): the result of the gate on exactly one pair of commits, RPE's and
// RPH's, kept with those commits in a folder outside both repositories (`RPE_PROOF_RECORDS`). A live run is admitted
// only on a pair whose record says it passed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";

/** One thing the gate ran: what, where, how it ended, how long it took. */
export interface GateStep {
  name: string;
  command: string[];
  cwd: string;
  /** Null for a step that could not start. */
  code: number | null;
  seconds: number;
  ok: boolean;
  /** What to know of it beyond its code (the tail of what it printed where it failed, or why it counts as it does). */
  note: string;
}

export interface GateRecord {
  rpe: string;
  rph: string;
  at: string;
  /** Every step passed and RPH is held as the plan says. */
  passed: boolean;
  steps: GateStep[];
  /** Why RPH is not held as the plan says; empty when it is. */
  pin: string[];
}

/** The folder the records are kept in, from the environment; null when it names none. */
export function recordsDir(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.RPE_PROOF_RECORDS?.trim();
  return dir === undefined || dir === "" ? null : dir;
}

export const gateFile = (dir: string, rpe: string, rph: string): string => join(dir, "gates", `gate-${rpe}-${rph}.json`);

export function writeGate(dir: string, record: GateRecord): string {
  const file = gateFile(dir, record.rpe, record.rph);
  mkdirSync(join(dir, "gates"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function isStep(value: unknown): value is GateStep {
  return isRecord(value) && typeof value.name === "string" && Array.isArray(value.command) && typeof value.cwd === "string" && (value.code === null || typeof value.code === "number") && typeof value.seconds === "number" && typeof value.ok === "boolean" && typeof value.note === "string";
}

/** The record for a pair of commits; null when there is none, and an error when the file is not one a gate wrote. */
export function readGate(dir: string, rpe: string, rph: string): GateRecord | null {
  const file = gateFile(dir, rpe, rph);
  if (!existsSync(file)) return null;
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(raw) || raw.rpe !== rpe || raw.rph !== rph || typeof raw.at !== "string" || typeof raw.passed !== "boolean" || !Array.isArray(raw.steps) || !raw.steps.every(isStep) || !Array.isArray(raw.pin) || !raw.pin.every((p) => typeof p === "string")) throw new Error(`${file} is not the gate's record of ${rpe.slice(0, 8)} with ${rph.slice(0, 8)}`);
  // A record that says it passed while a step of it did not, or the pin held with a fault, is not one the gate made.
  const passed = raw.steps.length > 0 && raw.steps.every((s) => s.ok) && raw.pin.length === 0;
  if (raw.passed !== passed) throw new Error(`${file} says ${raw.passed ? "passed" : "failed"}, and its own steps and pin say ${passed ? "passed" : "failed"}`);
  return { rpe, rph, at: raw.at, passed, steps: raw.steps, pin: raw.pin };
}
