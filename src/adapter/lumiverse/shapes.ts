// What the door's page route answers (plan §4.3, §4.4), declared field by field and held to the type the
// door keeps it in (`ExtensionStatus`, `./pipe-wire.ts`), so that the pages' types and the API reference say
// how RPE's extension in Lumiverse stands.

import { type Exactly, type Holds, type Infer, liveKind, shape } from "../../app";
import type { ExtensionStatus } from "./pipe-wire";

const T = shape.text();

const missingPermission = shape.named("MissingPermissionShown", "A permission RPE's extension in Lumiverse lacks, and why it needs it.", shape.object({ permission: T, why: T }));

const checkStopped = shape.named(
  "CheckStoppedShown",
  "A generation RPE's extension stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read.",
  shape.object({
    at: shape.field(shape.number(), "When, epoch milliseconds by the extension's clock."),
    chat: T,
    generation: shape.field(shape.nullable(T), "The generation; null where Lumiverse had not announced it."),
    connection: T,
    registration: shape.field(T, "How the read of RPE's registration from the extension's storage failed."),
    mark: shape.field(T, "How the read of the connection's own record in Lumiverse failed."),
  }),
);

export const extensionStatusReply = shape.named(
  "ExtensionStatusReply",
  "How RPE's extension in Lumiverse last said it stands with RPE: whether it holds RPE's registration, why it does not, and the permissions it says it lacks.",
  shape.object({
    registered: shape.field(shape.yesNo(), "Whether the extension holds RPE's registration, and so marks the replies RPE plays."),
    why: shape.field(shape.nullable(T), "Why it does not, in words a user is shown; null when it does."),
    missing: shape.field(shape.nullable(shape.list(missingPermission)), "The permissions it says it lacks, and why it needs each; null until it has said."),
    stopped: shape.field(shape.nullable(shape.object({ last: checkStopped, count: shape.number() })), "The generations it stopped because it could not tell whose chat they were: the latest, and how many since RPE started; null when none."),
  }),
);

/** The door's own live kind: the extension's status changed, published to the user's own channel (`LIVE_USER`) at each change, as the status route answers it. */
export const EXTENSION_KIND = liveKind("extension", { data: extensionStatusReply, does: "The extension's status changed: as GET /api/v1/status/extension answers it." });
type StatusMirrored = Holds<Exactly<Infer<typeof extensionStatusReply>, ExtensionStatus>>;
/** The check above holds, and is read by no one. */
export type Mirrors = [StatusMirrored];
