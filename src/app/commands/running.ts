// Where the running server answers, and what answers there.

import { isRecord } from "../../shared/json";
import { STATUS_PATH } from "../app";
import type { CliIO } from "../cli";
import type { AppConfig } from "../config";
import { LOOPBACK } from "../config";
import { localUrl } from "../up";

/** Where the running server answers, as a program on the same machine reaches it. */
export function serverUrl(config: AppConfig): string {
  return localUrl(config.address, config.port);
}

/** Where RPE answers on loopback, which it always does and its connection in Lumiverse points at. */
export function loopbackUrl(port: number): string {
  return localUrl(LOOPBACK, port);
}

/** What answers at `url` now: RPE (with its version), something else (with its status), or nothing. */
export async function answerAt(url: string, config: AppConfig, io: CliIO): Promise<{ rpe: string } | { other: number } | null> {
  try {
    const res = await io.fetch(`${url}${STATUS_PATH}`, { signal: AbortSignal.timeout(config.commandLine.waitMs) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !isRecord(body) || body.name !== "rpe") return { other: res.status };
    return { rpe: String(body.version) };
  } catch {
    // Not running, or not reachable.
    return null;
  }
}

/** What answers at RPE's own address now. */
export async function serverAnswer(config: AppConfig, io: CliIO): Promise<{ rpe: string } | { other: number } | null> {
  return await answerAt(serverUrl(config), config, io);
}
