// The seam between today's components and RPE's typed routes (plan §4.4, PlanChatUI-1). Today's
// frontend reaches its backend through two calls, send a message and hear messages
// (`frontend/protocol-client.ts`, `Transport`). Here a sent message is answered by the call file that
// takes it (`calls/`): each area of the kept views adds one file, which takes the requests it serves by
// a test on the request (its type, its op, the fields that choose its function) and sends each to its
// typed route through the page's client. No call's body carries today's `lre`, `type` or `reqId`: the
// file's route takes what the route takes, and the file hands back today's result body, which this
// seam puts in an `lre.result` under the request's id. There is no other road: a request no call file
// takes, on Build's App as on a chat's, is answered here as not served by this build.
//
// Nothing here remembers an answer. An answer that depends on a state that changes (no turn yet, no
// revision) is asked again at the next request. A road failure, when RPE was not reached, is said as
// the road's failure in the client's words (code `internal`), never as RPE's refusal; a request not
// served is a refusal, told apart by the request it answers (`refused`), so the page says it once.

import type { Transport } from "../../frontend/protocol-client";
import type { RequestBody } from "../../frontend/registry";
import type { LiveEvent } from "../../shared/api";
import { type ErrorCode, type ErrorMessage, type FrontendToBackend, PROTOCOL_VERSION, type ResultBodies, type ResultMessage } from "../../shared/protocol";
import type { LintIssue } from "../../shared/lint";
import { ConnectFailure, RpeError, type RpeClient } from "../client";
import { errorWords } from "../words";
import { CALLS } from "./calls";

/** What a call file is given of the page it serves. */
export interface CallContext {
  /** The page's typed client. */
  readonly client: Pick<RpeClient, "call">;
  /** The chat the App is for now (Play's chat, the chat Build has open), or null. */
  chat(): string | null;
  /** The world the open chat plays, as its state was last read; null before it is read, or for a chat that plays none. */
  world(): string | null;
}

/** A call file refuses a request in RPE's words, with the code today's components read. */
export class Refusal extends Error {
  override name = "Refusal";

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly lint?: LintIssue[],
  ) {
    super(message);
  }
}

/** The result bodies of any request; the seam puts the one a request's own type names under its id. */
export type ServedBody = ResultBodies[keyof ResultBodies];

/** One area's requests, sent to the typed routes that serve them. */
export interface CallFile {
  readonly name: string;
  /** Whether this file serves the request: its type, its op, and the fields that choose its function. */
  takes(request: RequestBody): boolean;
  /** Sends the request to its route (or routes) and answers as today's backend does: the result body of the request's type. A refusal is thrown as `Refusal`; a typed route's own refusal passes as the client threw it. */
  serve(request: RequestBody, ctx: CallContext): Promise<ServedBody>;
  /** What an event of the open chat's live feed means to today's client: the pushes it would have heard (`lre.draft.changed`, ...). */
  live?(event: LiveEvent, ctx: CallContext): readonly unknown[];
}

export interface KeptTransport extends Transport {
  /** Whether the request answered under this id was refused as not served; told once, then forgotten. */
  takeRefusal(reqId: string | null): boolean;
  /** Hands today's client a push as RPE's own are: to every hearer, in order. */
  push(payload: unknown): void;
  /** The call files the open chat's live events go through. */
  live(event: LiveEvent): void;
  /** Hands nothing on from here: every hearer is let go, answers still on their way are dropped, and nothing more is sent. */
  close(): void;
}

export interface TransportDeps {
  client: Pick<RpeClient, "call">;
  chat(): string | null;
  /** The world the open chat plays (`CallContext.world`); none where left out. */
  world?(): string | null;
  /** The call files; the folder's list unless a test gives its own. */
  calls?: readonly CallFile[];
}

/** The code today's components read for a typed route's refusal, by its status. */
export function codeOfStatus(status: number): ErrorCode {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 403 || status === 401) return "forbidden";
  if (status === 422) return "validation";
  if (status >= 500) return "internal";
  return "bad_request";
}

/** Today's request without its envelope: what a call file takes. */
export function bodyOf(message: FrontendToBackend): RequestBody {
  const { lre: _lre, reqId: _reqId, ...body } = message;
  return body as RequestBody;
}

function errorOf(reqId: string, code: ErrorCode, message: string, lint?: LintIssue[]): ErrorMessage {
  return { lre: PROTOCOL_VERSION, type: "lre.error", reqId, code, message, ...(lint === undefined ? {} : { lint }) };
}

/** What a failed call comes to as today's answer: RPE's refusal in its words, or the road's own failure (RPE not reached) said as that. */
export function failureOf(reqId: string, error: unknown): ErrorMessage {
  if (error instanceof Refusal) return errorOf(reqId, error.code, error.message, error.lint);
  if (error instanceof RpeError && error.status !== 0) return errorOf(reqId, codeOfStatus(error.status), error.message);
  // RPE was not reached (the road's failure), or the call itself failed: the client's words, and no code that says RPE refused.
  return errorOf(reqId, "internal", error instanceof ConnectFailure || error instanceof RpeError ? error.message : errorWords(error));
}

/** The transport of one kept App. */
export function keptTransport(deps: TransportDeps): KeptTransport {
  const calls = deps.calls ?? CALLS;
  const ctx: CallContext = { client: deps.client, chat: deps.chat, world: deps.world ?? (() => null) };
  const hearers = new Set<(payload: unknown) => void>();
  const refused = new Set<string>();
  let closed = false;
  const hand = (payload: unknown): void => {
    for (const hearer of [...hearers]) hearer(payload);
  };
  const answerWith = (reqId: string, answered: Promise<unknown>): void => {
    answered.then(
      (answer) => {
        if (!closed) hand(answer);
      },
      (error: unknown) => {
        if (!closed) hand(failureOf(reqId, error));
      },
    );
  };
  return {
    send(message) {
      if (closed) return;
      const request = bodyOf(message);
      const file = calls.find((candidate) => candidate.takes(request));
      if (file === undefined) {
        // No call file takes it: not served by this build, a refusal, so the page says it once.
        refused.add(message.reqId);
        answerWith(message.reqId, Promise.resolve(errorOf(message.reqId, "unavailable", `This page's request ${message.type} is not served by this build of RPE.`)));
        return;
      }
      answerWith(
        message.reqId,
        file.serve(request, ctx).then((body): ResultMessage => ({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: message.reqId, request: message.type, body }) as ResultMessage),
      );
    },
    subscribe(hearer) {
      hearers.add(hearer);
      return () => hearers.delete(hearer);
    },
    takeRefusal: (reqId) => reqId !== null && refused.delete(reqId),
    push(payload) {
      if (!closed) hand(payload);
    },
    live(event) {
      for (const file of calls) for (const push of file.live?.(event, ctx) ?? []) if (!closed) hand(push);
    },
    close() {
      closed = true;
      hearers.clear();
      refused.clear();
    },
  };
}
