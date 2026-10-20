// The extension's worker runs one task at a time (DESIGN §9.6): a view, a ledger step or a request
// that reads a long chat gives way before its work, so a message already waiting (a generation's
// guard, a host event) runs first instead of behind it.

/** Resolves once the tasks already waiting have had their turn of the event loop. */
export function giveWay(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
