// What the previous build's pages say to RPE and are told, which the route form does not describe field by
// field: today's messages (`lre.*`, `src/shared/protocol.ts`), today's answers to them, and the chat's state
// view (`src/shared/state-view.ts`). RPE carries each as the previous build wrote it, under the name of its
// type, which the generated types take from its own module. The two tunnels (`POST /api/v1/build`, and
// `POST /api/v1/chats/:chat/actions` with its undo) and the chat's state are declared with these, and the
// reference marks them as what they are, until the pages that send these messages are replaced by pages
// that call routes of their own.

import type { DraftChanged, ErrorMessage, FrontendToBackend, ResultMessage } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { isRecord } from "../shared/json";
import type { StateView } from "../shared/state-view";
import { shape } from "./routes";

/** Whether a value has the envelope every message of the previous build has: its protocol level and its kind. */
const enveloped = (value: unknown): value is Record<string, unknown> => isRecord(value) && value.lre === PROTOCOL_VERSION && typeof value.type === "string";

/** One of today's requests, as today's dispatcher takes one: its envelope, the kind of request and its id. */
export const requestMessage = shape.carried<FrontendToBackend>(
  "FrontendToBackend",
  "../protocol",
  "One of the previous build's requests, as a page of it sends it: `{ lre: 1, type, reqId, … }`, the rest of it by its `type`.",
  "one of today's messages: { lre: 1, type, reqId, … }",
  (value): value is FrontendToBackend => enveloped(value) && typeof value.reqId === "string",
);

/** Today's answer to a request that was done. */
export const resultMessage = shape.carried<ResultMessage>("ResultMessage", "../protocol", "The previous build's answer to a request that was done: `{ lre: 1, type: \"lre.result\", reqId, request, body }`.", "one of today's results", (value): value is ResultMessage => enveloped(value) && value.type === "lre.result");

/** Today's answer to a request that was not done. */
export const errorMessage = shape.carried<ErrorMessage>("ErrorMessage", "../protocol", "The previous build's answer to a request that could not be done: `{ lre: 1, type: \"lre.error\", reqId, code, message }`.", "one of today's errors", (value): value is ErrorMessage => enveloped(value) && value.type === "lre.error");

/** What a request changed of a world's working copy, which today's pages are pushed. */
export const draftChanged = shape.carried<DraftChanged>("DraftChanged", "../protocol", "The previous build's push that a world's working copy changed: `{ lre: 1, type: \"lre.draft.changed\", worldId, version, stored, base }`.", "one of today's pushes", (value): value is DraftChanged => enveloped(value) && value.type === "lre.draft.changed");

/** A chat's state as the previous build's pages take it. */
export const stateView = shape.carried<StateView>("StateView", "../state-view", "A chat's state as the previous build's play pages take it: its status, its clock, its sheet, its scene, its chips and the rest of what the pages draw.", "a chat's state view", (value): value is StateView => isRecord(value));
