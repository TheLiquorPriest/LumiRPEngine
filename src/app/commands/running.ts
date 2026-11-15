// Where the running server answers, and what answers there.

import { isRecord } from "../../shared/json";
import { STATUS_PATH } from "../app";
import type { CliIO } from "../cli";
import type { AppConfig } from "../config";
import { localUrl } from "../up";

/** Where the running server answers, as a program on the same machine reaches it. */
export function serverUrl(config: AppConfig): string {
  return localUrl(config.address, config.port);
}

/** What answers at RPE's own address now: RPE (with its version), something else (with its status), or nothing. */
export async function serverAnswer(config: AppConfig, io: CliIO): Promise<{ rpe: string } | { other: number } | null> {
  try {
    const res = await io.fetch(`${serverUrl(config)}${STATUS_PATH}`, { signal: AbortSignal.timeout(config.commandLine.waitMs) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !isRecord(body) || body.name !== "rpe") return { other: res.status };
    return { rpe: String(body.version) };
  } catch {
    // Not running, or not reachable.
    return null;
  }
}
