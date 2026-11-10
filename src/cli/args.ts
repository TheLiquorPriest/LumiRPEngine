// A tool's arguments as an agent sent them: read by name, checked, and refused with a message
// that says which argument is wrong and what it takes, so the agent can fix the call.

import { isRecord } from "../shared/json";

/** A refusal the caller can fix; the tool answers it as an error result. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type Args = Readonly<Record<string, unknown>>;

/** Text, when given. */
export function textArg(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${key} must be text, not ${Array.isArray(value) ? "a list" : typeof value}.`);
  return value;
}

/** Non-empty text, which the tool can't do without. */
export function neededText(args: Args, key: string, what: string): string {
  const value = textArg(args, key)?.trim();
  if (value === undefined || value === "") throw new ToolError(`Give ${key}: ${what}.`);
  return value;
}

/** A whole number within bounds, when given. */
export function intArg(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ToolError(`${key} must be a whole number from ${min} to ${max}.`);
  return value;
}

export function boolArg(args: Args, key: string): boolean {
  const value = args[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new ToolError(`${key} must be true or false.`);
  return value;
}

/** A list of non-empty texts, when given. */
export function textsArg(args: Args, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === "string" && v.trim() !== "")) throw new ToolError(`${key} must be a list of texts.`);
  return value;
}

/** Refuses arguments the tool doesn't take, naming the ones it does: a misspelled key would otherwise be ignored. */
export function onlyArgs(args: Args, schema: unknown): void {
  const properties = isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const unknown = Object.keys(args).filter((k) => !properties.includes(k));
  if (unknown.length > 0) throw new ToolError(`Unknown argument${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}. This tool takes ${properties.length > 0 ? properties.join(", ") : "no arguments"}.`);
}
