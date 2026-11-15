// Signing in to the web UI: the proof RPE gives a page before the page sends it its token (plan §16).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, RunningServer } from "../../src/app";
import { secretHash } from "../../src/app/auth";
import { KEY_ID_LENGTH, PROOF_PATH, proofOf } from "../../src/shared/page-proof";
import { type Bed, makeBed, makeKey, OWNER } from "./helpers";

describe("the proof of a page's token", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open();
    server = await app.start();
  });

  afterEach(async () => {
    await bed.remove();
  });

  const NONCE = "0123456789abcdef0123456789abcdef";
  const ask = (id: string, nonce: string): Promise<Response> => fetch(`${server.url}${PROOF_PATH}?id=${id}&nonce=${nonce}`);

  test("RPE proves it holds a page's token by a keyed answer to the page's nonce, without the token being sent; an answer from anything else fails the check", async () => {
    const { token } = await app.auth.mintPageToken(OWNER, "extension");
    const hash = secretHash(token);
    const id = hash.slice(0, KEY_ID_LENGTH);

    // The page sends the first characters of the token's hash and its nonce: never the token, nor all of its hash.
    const answered = await ask(id, NONCE);
    expect(answered.status).toBe(200);
    const { proof } = await answered.json();
    expect(proof).toBe(await proofOf(hash, NONCE));
    expect(JSON.stringify(proof)).not.toContain(token);
    // The page works the same proof out from its own token, and a proof of another nonce, or from another RPE that holds no such token, is not it.
    expect(proof).not.toBe(await proofOf(hash, "f".repeat(32)));
    expect(proof).not.toBe(await proofOf(secretHash("another-token"), NONCE));

    // Something that holds no such token answers 404 in RPE's words, whatever the id; nothing of any token is said.
    const unknown = await ask("00000000", NONCE);
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(await unknown.json())).toContain("holds no page token by that id");

    // A bad id or nonce is refused before anything is looked up.
    expect((await ask("xyz", NONCE)).status).toBe(400);
    expect((await ask(hash, NONCE)).status).toBe(400);
    expect((await ask(id, "short")).status).toBe(400);
    expect((await ask(id, "G".repeat(32))).status).toBe(400);
    expect((await fetch(`${server.url}${PROOF_PATH}`)).status).toBe(400);

    // Only a page token is asked after: the web key, the extension's key and the provider key are no page's, and a token past its time holds no more.
    for (const kind of ["web", "extension", "provider"] as const) expect((await ask(secretHash(await makeKey(app, kind)).slice(0, KEY_ID_LENGTH), NONCE)).status).toBe(404);
    bed.clock.now += 31 * 60_000;
    expect((await ask(id, NONCE)).status).toBe(404);
  });
});
