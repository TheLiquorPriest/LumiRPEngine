// How a page tells RPE from anything else that answers at an address, before it sends that address its
// token (plan §16, security finding 9). RPE keeps only the hash of each page token (`page_token`), so
// the proof is keyed by that hash: the page sends a short id of it (the first characters, which no one
// can make a token or a proof from) and a nonce of its own, and RPE answers with the nonce's keyed
// hash, which only something holding RPE's table of tokens can make. The page works the same proof out
// from its token and offers the token only to an address whose answer matches. Both sides use these
// functions; the browser's `crypto.subtle` is the one the page needs, and a page on an origin the
// browser does not give it (a plain HTTP address that is not the machine's own) cannot make the proof, so
// it does not go direct.

/** `GET` this path with `id` and `nonce` in the query: public, answers `{ proof }`, or 404 when RPE holds no current page token with that id. */
export const PROOF_PATH = "/api/v1/status/proof";

/** How many characters of a token's hash name it to RPE. */
export const KEY_ID_LENGTH = 8;

const encoder = new TextEncoder();

const hexOf = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The SHA-256 of `text` as lowercase hex, which is what RPE keeps of a token. Throws where the browser gives no `crypto.subtle`. */
export async function sha256Hex(text: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error("this browser gives the page no way to make the proof (no crypto.subtle on this origin)");
  return hexOf(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** A nonce of the page's own: 32 random hex characters. */
export function newNonce(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What a nonce looks like to RPE: hex, 16 to 64 characters. */
export const NONCE_PATTERN = /^[0-9a-f]{16,64}$/;

/** The proof of `nonce` keyed by a token's hash (HMAC-SHA-256, as lowercase hex). */
export async function proofOf(tokenHash: string, nonce: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error("this browser gives the page no way to make the proof (no crypto.subtle on this origin)");
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(tokenHash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexOf(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(nonce)));
}
