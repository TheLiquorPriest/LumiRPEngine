// What the door's page route answers (plan §4.3, §4.4), declared field by field and held to the type the
// door keeps it in (`ExtensionStatus`, `./pipe-wire.ts`), so that the pages' types and the API reference say
// how RPE's extension in Lumiverse stands.

import { type Exactly, type Holds, type Infer, shape } from "../../app";
import type { ExtensionStatus } from "./pipe-wire";

const T = shape.text();

const missingPermission = shape.named("MissingPermissionShown", "A permission RPE's extension in Lumiverse lacks, and why it needs it.", shape.object({ permission: T, why: T }));

export const extensionStatusReply = shape.named(
  "ExtensionStatusReply",
  "How RPE's extension in Lumiverse last said it stands with RPE: whether it holds RPE's registration, why it does not, and the permissions it says it lacks.",
  shape.object({
    registered: shape.field(shape.yesNo(), "Whether the extension holds RPE's registration, and so marks the replies RPE plays."),
    why: shape.field(shape.nullable(T), "Why it does not, in words a user is shown; null when it does."),
    missing: shape.field(shape.nullable(shape.list(missingPermission)), "The permissions it says it lacks, and why it needs each; null until it has said."),
  }),
);
type StatusMirrored = Holds<Exactly<Infer<typeof extensionStatusReply>, ExtensionStatus>>;
/** The check above holds, and is read by no one. */
export type Mirrors = [StatusMirrored];
