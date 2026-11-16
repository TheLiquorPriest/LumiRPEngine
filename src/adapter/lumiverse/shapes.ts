// What the door's page route answers (plan §4.3, §4.4), declared field by field and held to the type the
// door keeps it in (`ExtensionStatus`, `./pipe-wire.ts`), so that the pages' types and the API reference say
// how RPE's extension in Lumiverse stands.

import { type Exactly, type Holds, type Infer, liveKind, shape } from "../../app";
import type { MessageShown as MessageShownRow } from "./messages";
import type { ExtensionStatus } from "./pipe-wire";
import type { WindowShown } from "./window-view";

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

const messageShown = shape.named(
  "ChatMessageShown",
  "A message of a chat as Lumiverse holds it: its place (`index_in_chat`, with a gap where one was deleted), who said it, the text the prompt is built from, the swipe it shows, whether it is hidden, and Lumiverse's revision of it.",
  shape.object({
    id: shape.field(T, "Lumiverse's id of the message."),
    chat: shape.field(T, "Its chat's id."),
    index: shape.field(shape.number(), "Lumiverse's `index_in_chat`: a gap where a message was deleted."),
    role: shape.field(shape.oneOf("user", "assistant", "system"), "Who said it."),
    name: shape.field(T, "The name it was said under."),
    text: shape.field(T, "The text the prompt is built from."),
    swipe: shape.field(shape.number(), "The swipe it shows."),
    swipes: shape.field(shape.number(), "How many swipes it has."),
    hidden: shape.field(shape.yesNo(), "Hidden from the prompt."),
    sentAt: shape.field(shape.number(), "When it was sent, epoch milliseconds."),
    revision: shape.field(shape.number(), "Lumiverse's revision of it: an edit raises it."),
  }),
);
type MessageMirrored = Holds<Exactly<Infer<typeof messageShown>, MessageShownRow>>;

export const chatMessagesReply = shape.named("ChatMessagesReply", "The messages of a chat asked for, in the chat's order.", shape.object({ messages: shape.list(messageShown) }));

export const chatWindowReply = shape.named(
  "ChatWindowReply",
  "What the chat's history window is now, for its marker: whether it is on, the first history message it keeps on the chat's current path, the message just above that, how many messages lie above it, and how many of those the story does not cover yet.",
  shape.object({
    on: shape.field(shape.yesNo(), "The window is on for this chat."),
    first: shape.field(shape.nullable(T), "Lumiverse's id of the first history message the window keeps, with the step and the hold as the chat's settings set them; null where it keeps all, or is off."),
    before: shape.field(shape.nullable(T), "Lumiverse's id of the history message just above `first`, the one the marker stands under; null where nothing is above it."),
    above: shape.field(shape.number(), "History messages above the window."),
    uncovered: shape.field(shape.number(), "Of those, how many the story record does not cover yet; a hidden message counts, among those above, only where the chat's setting lets agents read hidden messages."),
  }),
);

/** The door's own live kind: the extension's status changed, published to the user's own channel (`LIVE_USER`) at each change, as the status route answers it. */
export const EXTENSION_KIND = liveKind("extension", { data: extensionStatusReply, does: "The extension's status changed: as GET /api/v1/status/extension answers it." });
type StatusMirrored = Holds<Exactly<Infer<typeof extensionStatusReply>, ExtensionStatus>>;
type WindowMirrored = Holds<Exactly<Infer<typeof chatWindowReply>, WindowShown>>;
/** The checks above hold, and are read by no one. */
export type Mirrors = [StatusMirrored, MessageMirrored, WindowMirrored];
