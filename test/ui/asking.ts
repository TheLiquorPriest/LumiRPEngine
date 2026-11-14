// A client that records each call a page makes, by its route as the route map keys it, with its params,
// query and body, and answers or refuses it only when the test says: so a test reads which route each
// control calls, and what the page does with RPE's answer and with its refusal.

import type { RpeClient } from "../../src/ui/client";

export interface Asked {
  key: string;
  params: Readonly<Record<string, string>>;
  query: unknown;
  body: unknown;
  answer(value: unknown): void;
  fail(error: Error): void;
}

export function askingClient(): { client: Pick<RpeClient, "call">; asked: Asked[] } {
  const asked: Asked[] = [];
  const client: Pick<RpeClient, "call"> = {
    call: ((key: string, params: Readonly<Record<string, string>>, options?: { query?: unknown; body?: unknown }) => {
      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      asked.push({ key, params, query: options?.query, body: options?.body, answer: resolve, fail: reject });
      return promise;
    }) as RpeClient["call"],
  };
  return { client, asked };
}

/** Lets everything the page has waiting on a promise run. */
export function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}
