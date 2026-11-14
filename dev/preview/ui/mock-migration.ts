// The Migration page's route in the preview: what the invented run of test/ui/migration-recorded.ts
// left, or, after `/preview/migration?run=no`, what RPE answers before any run (`run=yes` brings the run
// back).

import { MIGRATED, NOT_RUN } from "../../../test/ui/migration-recorded";

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

let ran = true;

/** `GET /api/v1/migration`. */
export function migrationAnswer(request: Request): Response {
  return request.method === "GET" ? answer(200, ran ? MIGRATED : NOT_RUN) : answer(405, { error: "The migration's route takes GET." });
}

/** `/preview/migration?run=yes|no`: whether a run has happened. */
export function migrationControl(url: URL): Response {
  const run = url.searchParams.get("run");
  if (run !== "yes" && run !== "no") return answer(400, { error: "run is yes or no." });
  ran = run === "yes";
  return answer(200, { ran });
}
