// The chat's chain as the GM view's reads decode it (DESIGN §9.6), kept per message. The message
// cache (message-cache.ts) replaces a message it changes and never changes one in place, so a
// message it still holds decodes as it did: a GM read of an unchanged chat decodes nothing, and one
// after a turn decodes only the messages the turn changed. A decoded message goes with the message
// it was decoded from. Readers only read what they're given.

import type { ChainMessage } from "../engine/ledger/chain";
import type { HostMessage } from "./host";
import { toChain } from "./ledger-io";

const decoded = new WeakMap<HostMessage, ChainMessage>();

/** The chain of `messages` as `toChain` decodes it, each message decoded once while the message cache holds it. */
export function cachedChain(messages: readonly HostMessage[]): readonly ChainMessage[] {
  return messages.map((m) => {
    const kept = decoded.get(m);
    if (kept) return kept;
    const [made] = toChain([m]);
    if (!made) throw new Error(`message ${m.id} didn't decode`);
    decoded.set(m, made);
    return made;
  });
}
