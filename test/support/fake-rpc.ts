// The host's shared RPC pool (`spindle.rpcPool`), as the reference host runs it: endpoints are
// `<extension>.<channel>` with lowercase segments, a read of an unregistered endpoint rejects, an
// on-demand handler learns which extension reads, a read policy's permissions must be held by both
// sides, and the value crosses to the reader as a structured clone.

import type { HostPort } from "../../src/backend/host";

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

interface Endpoint {
  owner: string;
  requires: readonly string[];
  handler: (requester: string) => Promise<unknown>;
}

function assertEndpoint(endpoint: string): void {
  const [owner, ...rest] = endpoint.split(".");
  if (!owner || !IDENTIFIER.test(owner) || rest.length === 0 || !rest.every((s) => SEGMENT.test(s))) throw new Error(`Invalid shared RPC endpoint "${endpoint}"`);
}

export class FakeRpcPool {
  private readonly endpoints = new Map<string, Endpoint>();
  /** Every read, in order: who read what. */
  readonly reads: { endpoint: string; requester: string }[] = [];

  /** `permissions`: each extension's granted gated permissions. */
  constructor(private readonly permissions: Record<string, readonly string[]>) {}

  /** The pool as one extension's backend sees it. */
  port(owner: string): HostPort["rpc"] {
    return {
      handle: (channel, requires, handler) => {
        const endpoint = `${owner}.${channel}`;
        assertEndpoint(endpoint);
        this.endpoints.set(endpoint, { owner, requires, handler });
      },
      unregister: (channel) => {
        this.endpoints.delete(`${owner}.${channel}`);
      },
      read: (endpoint) => this.read(endpoint, owner),
    };
  }

  async read(endpoint: string, requester: string): Promise<unknown> {
    assertEndpoint(endpoint);
    this.reads.push({ endpoint, requester });
    const found = this.endpoints.get(endpoint);
    if (!found) throw new Error(`Shared RPC endpoint "${endpoint}" is not registered`);
    const held = this.permissions[requester] ?? [];
    const missing = found.requires.filter((p) => !held.includes(p) || !(this.permissions[found.owner] ?? []).includes(p));
    if (missing.length > 0) throw new Error(`Shared RPC endpoint "${endpoint}" requires requester "${requester}" permissions: ${missing.join(", ")}`);
    return structuredClone(await found.handler(requester));
  }

  registered(endpoint: string): boolean {
    return this.endpoints.has(endpoint);
  }

  /** An extension stops (a restart, an unload): the host removes every endpoint it owns. */
  dropOwner(owner: string): void {
    for (const [endpoint, found] of this.endpoints) if (found.owner === owner) this.endpoints.delete(endpoint);
  }
}
