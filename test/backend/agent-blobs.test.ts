// The agent stores' blobs (DESIGN §4.4): each text kept once under its content hash in the user's
// storage, a put idempotent, a read checked against its address, and work in flight holding what it
// wrote until something points at it.

import { describe, expect, test } from "bun:test";
import { BLOBS_DIR, BlobStore } from "../../src/backend/agents/blobs";
import { blobHash } from "../../src/shared/stores";
import { FakeHost } from "../support/fake-host";

describe("the blob store", () => {
  test("a put keeps the text under its hash once, however often and however concurrently it is put", async () => {
    const host = new FakeHost();
    const blobs = new BlobStore(host);
    const user = host.userId;
    const [a, b, c] = await Promise.all([blobs.put(user, "The pier opens at dawn."), blobs.put(user, "The pier opens at dawn."), blobs.put(user, "The pier opens at dawn.")]);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(a).toBe(blobHash("The pier opens at dawn."));
    expect(await blobs.put(user, "The pier opens at dawn.")).toBe(a);
    expect(await blobs.list(user)).toEqual([a]);
    expect(await blobs.get(user, a)).toBe("The pier opens at dawn.");
    // Another user's store is their own.
    expect(await blobs.get("someone-else", a)).toBeNull();
  });

  test("a blob that no longer matches its address reads as missing, and nothing but a hash names a blob", async () => {
    const host = new FakeHost();
    const blobs = new BlobStore(host);
    const user = host.userId;
    const hash = await blobs.putJson(user, { v: 1, note: "kept" });
    expect(await blobs.getJson(user, hash)).toEqual({ v: 1, note: "kept" });
    host.files.set(`${user}/${BLOBS_DIR}${hash}`, JSON.stringify({ v: 1, note: "changed" }));
    expect(await blobs.get(user, hash)).toBeNull();
    expect(host.logs.some((line) => line.startsWith("warn:"))).toBe(true);
    expect(await blobs.get(user, "../settings.json")).toBeNull();
    // Another file under the store's folder, a temporary one a put left, is no blob.
    host.files.set(`${user}/${BLOBS_DIR}${blobHash("x")}.tmp`, "x");
    expect(await blobs.list(user)).toEqual([hash]);
  });

  test("work in flight holds what it put until it lets go, and every put is heard first", async () => {
    const host = new FakeHost();
    const blobs = new BlobStore(host);
    const user = host.userId;
    const heard: string[] = [];
    blobs.onPut = (_userId, hash) => heard.push(hash);
    const segment = await blobs.put(user, "segment", "turn-1");
    const file = await blobs.put(user, "file", "turn-1");
    const other = await blobs.put(user, "other", "turn-2");
    expect(heard).toEqual([segment, file, other]);
    expect([...blobs.held(user)].sort()).toEqual([segment, file, other].sort());
    blobs.release(user, "turn-1");
    expect([...blobs.held(user)]).toEqual([other]);
    blobs.release(user, "turn-2");
    expect(blobs.held(user).size).toBe(0);
    // Letting go keeps the blobs stored: only the sweep removes one.
    expect(await blobs.get(user, segment)).toBe("segment");
  });
});
