// The extension's road to RPE (STANDALONE-PLAN §4.3): HTTP on loopback through Spindle's proxy, which
// lets an extension reach a loopback address (`worker-host.ts:4662-4671` passes `allowPrivate`, which
// `utils/safe-fetch.ts:267-286` reads as loopback allowed). The proxy takes no signal and gives up only
// after its own 30 seconds (`worker-host.ts:771`), so the wait is kept here: past it the answer is no
// longer waited for, and one that comes later is dropped. The wait and how much of RPE's words go to the
// log are RPE's, sent with its registration (R-1).

import { QUESTION_PATH, readAnswer, type Answer, type Question } from "../adapter/lumiverse/wire";
import type { ExtSpindle } from "./spindle";

/** Where this user's RPE answers, what proves the extension to it, and RPE's values for the road; from the extension's own registration. */
export interface Road {
  /** RPE's address, such as `http://127.0.0.1:7860`, with no trailing slash. */
  base: string;
  headers: Record<string, string>;
  /** How long RPE's answer to the question is waited for. */
  waitMs: number;
  /** How many characters of RPE's words go to the extension's log. */
  logChars: number;
}

/** RPE's answer, or why there is none, and how long it took: from asked to answered, or to the wait. */
export type Reply = ({ answer: Answer } | { none: string }) & { ms: number };

/** Asks RPE the question, waiting no longer than the road's wait. */
export async function ask(proxy: ExtSpindle["cors"], road: Road, question: Question): Promise<Reply> {
  const asked = performance.now();
  const deadline = Promise.withResolvers<{ answer: Answer } | { none: string }>();
  const timer = setTimeout(() => deadline.resolve({ none: `RPE gave no answer within ${road.waitMs} ms` }), road.waitMs);
  const answering = (async (): Promise<{ answer: Answer } | { none: string }> => {
    const res = await proxy(`${road.base}${QUESTION_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...road.headers }, body: JSON.stringify(question) });
    if (res.status !== 200) return { none: `RPE answered ${res.status}${res.body ? `: ${res.body.slice(0, road.logChars)}` : ""}` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body ?? "");
    } catch {
      return { none: "RPE's answer is not JSON" };
    }
    const answer = readAnswer(parsed);
    return answer === null ? { none: "RPE's answer is not one this extension reads" } : { answer };
  })().catch((error: unknown) => ({ none: `RPE was not reached (${error instanceof Error ? error.message : String(error)})` }));
  try {
    const reply = await Promise.race([answering, deadline.promise]);
    // Past the wait, the wait is the time: an answer later than it is not used.
    return { ...reply, ms: Math.min(road.waitMs, Math.round(performance.now() - asked)) };
  } finally {
    clearTimeout(timer);
  }
}
