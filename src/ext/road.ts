// The extension's road to RPE (STANDALONE-PLAN §4.3): HTTP on loopback through Spindle's proxy, which
// lets an extension reach a loopback address (`worker-host.ts:4662-4671` passes `allowPrivate`, which
// `utils/safe-fetch.ts:267-286` reads as loopback allowed). The proxy takes no signal and gives up only
// after its own 30 seconds (`worker-host.ts:771`), so the deadline is kept here: past it the answer is
// no longer waited for, and one that comes later is dropped.

import { QUESTION_PATH, readAnswer, type Answer, type Question } from "../adapter/lumiverse/wire";
import type { ExtSpindle } from "./spindle";

/** Where this user's RPE answers, and what proves the extension to it; from the extension's own registration. */
export interface Road {
  /** RPE's address, such as `http://127.0.0.1:7860`, with no trailing slash. */
  base: string;
  headers: Record<string, string>;
}

/** RPE's answer, or why there is none. */
export type Reply = { answer: Answer } | { none: string };

/** Asks RPE the question, waiting no longer than `deadlineMs`. */
export async function ask(proxy: ExtSpindle["cors"], road: Road, question: Question, deadlineMs: number): Promise<Reply> {
  const deadline = Promise.withResolvers<Reply>();
  const timer = setTimeout(() => deadline.resolve({ none: `RPE gave no answer within ${deadlineMs} ms` }), deadlineMs);
  const asked = (async (): Promise<Reply> => {
    const res = await proxy(`${road.base}${QUESTION_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...road.headers }, body: JSON.stringify(question) });
    if (res.status !== 200) return { none: `RPE answered ${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body ?? "");
    } catch {
      return { none: "RPE's answer is not JSON" };
    }
    const answer = readAnswer(parsed);
    return answer === null ? { none: "RPE's answer is not one this extension reads" } : { answer };
  })().catch((error: unknown): Reply => ({ none: `RPE was not reached (${error instanceof Error ? error.message : String(error)})` }));
  try {
    return await Promise.race([asked, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}
