// Portable, deterministic hashing for the backend, the child processes and the browser.
//
// Pure TypeScript: no node:crypto, no Bun APIs, no TextEncoder, no globals. The
// digest is MurmurHash3 x86 128-bit (Austin Appleby, public domain), which only needs
// 32-bit integer arithmetic, so it gives the same answer on every JavaScript engine.
// Not cryptographic: use it for seeds, fingerprints, cache keys and revision checks, never
// for secrets or for anything an adversary could profit from colliding.
//
// Replaces Warp's shared/revision.ts (two 32-bit FNV-style lanes over JSON.stringify). That
// function was key-order dependent, ignored part boundaries and threw on `undefined`.
// See NOTICE.
//
// Input encoding for hashParts / hashWords / hash32. Each part is
//
//     tag (1 byte) | payload byte length (u32, little endian) | payload
//
// with tags  's' string (UTF-8), 'n' number (UTF-8 of its canonical decimal text),
// 'b' boolean (1 byte, 0 or 1), 'z' null (no payload). Because every part states its own
// length, the byte stream splits back into the same parts only one way, so
// ("ab", "c") and ("a", "bc") hash differently, and so do ("a") and ("a", ""). Tags keep 1,
// "1", true and null apart. Numbers must be finite; -0 hashes as 0.
//
// Output: hashParts returns 32 lowercase hex digits (h1 h2 h3 h4, each as 8 big-endian hex
// digits). hash32 is h1 as an unsigned 32-bit integer, i.e. the first 8 hex digits.

export type HashPart = string | number | boolean | null;

/** The four 32-bit words of a 128-bit digest, h1 first. */
export type HashWords = readonly [number, number, number, number];

const C1 = 0x239b961b;
const C2 = 0xab0e9789;
const C3 = 0x38b34ae5;
const C4 = 0xa1e38b93;

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

// The four per-word block mixers of the reference implementation (k *= c; rotl; k *= c').
function mixK1(k: number): number { return Math.imul(rotl32(Math.imul(k, C1), 15), C2); }
function mixK2(k: number): number { return Math.imul(rotl32(Math.imul(k, C2), 16), C3); }
function mixK3(k: number): number { return Math.imul(rotl32(Math.imul(k, C3), 17), C4); }
function mixK4(k: number): number { return Math.imul(rotl32(Math.imul(k, C4), 18), C1); }

/** MurmurHash3_x86_128 of raw bytes. `seed` is a 32-bit integer (default 0). */
export function hashBytes(bytes: Uint8Array, seed = 0): HashWords {
  const len = bytes.length;
  const blocks = len >>> 4;
  let h1 = seed | 0, h2 = seed | 0, h3 = seed | 0, h4 = seed | 0;

  const word = (i: number): number =>
    (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) | 0;

  for (let b = 0; b < blocks; b++) {
    const o = b << 4;
    h1 ^= mixK1(word(o));
    h1 = rotl32(h1, 19); h1 = (h1 + h2) | 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) | 0;
    h2 ^= mixK2(word(o + 4));
    h2 = rotl32(h2, 17); h2 = (h2 + h3) | 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) | 0;
    h3 ^= mixK3(word(o + 8));
    h3 = rotl32(h3, 15); h3 = (h3 + h4) | 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) | 0;
    h4 ^= mixK4(word(o + 12));
    h4 = rotl32(h4, 13); h4 = (h4 + h1) | 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) | 0;
  }

  // Tail: the remaining len & 15 bytes, grouped into four little-endian words.
  const t = blocks << 4;
  const rem = len & 15;
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  for (let i = rem - 1; i >= 12; i--) k4 ^= bytes[t + i] << ((i - 12) << 3);
  for (let i = Math.min(rem, 12) - 1; i >= 8; i--) k3 ^= bytes[t + i] << ((i - 8) << 3);
  for (let i = Math.min(rem, 8) - 1; i >= 4; i--) k2 ^= bytes[t + i] << ((i - 4) << 3);
  for (let i = Math.min(rem, 4) - 1; i >= 0; i--) k1 ^= bytes[t + i] << (i << 3);
  if (rem > 12) h4 ^= mixK4(k4);
  if (rem > 8) h3 ^= mixK3(k3);
  if (rem > 4) h2 ^= mixK2(k2);
  if (rem > 0) h1 ^= mixK1(k1);

  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  h1 = fmix32(h1); h2 = fmix32(h2); h3 = fmix32(h3); h4 = fmix32(h4);
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * UTF-8 bytes of a string, identical to TextEncoder's output. A lone surrogate is encoded as
 * U+FFFD (EF BF BD), like TextEncoder, so every JavaScript string has exactly one encoding.
 */
export function encodeUtf8(s: string): Uint8Array {
  // A high surrogate directly followed by a low surrogate is one astral code point (4 bytes).
  const pairAt = (i: number): boolean =>
    (s.charCodeAt(i) & 0xfc00) === 0xd800 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
  let size = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) size += 1;
    else if (c < 0x800) size += 2;
    else if (pairAt(i)) { size += 4; i++; }
    else size += 3;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) { out[o++] = c; continue; }
    if (c < 0x800) { out[o++] = 0xc0 | (c >> 6); out[o++] = 0x80 | (c & 63); continue; }
    if (pairAt(i)) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      out[o++] = 0xf0 | (c >> 18); out[o++] = 0x80 | ((c >> 12) & 63);
      out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    out[o++] = 0xe0 | (c >> 12); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63);
  }
  return out;
}

const TAG_STRING = 0x73, TAG_NUMBER = 0x6e, TAG_BOOLEAN = 0x62, TAG_NULL = 0x7a;

function encodeParts(parts: readonly HashPart[]): Uint8Array {
  const payloads: Uint8Array[] = new Array(parts.length);
  const tags: number[] = new Array(parts.length);
  let size = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let payload: Uint8Array;
    if (typeof p === "string") { tags[i] = TAG_STRING; payload = encodeUtf8(p); }
    else if (typeof p === "number") {
      if (!Number.isFinite(p)) throw new TypeError(`hash part ${i} must be a finite number, got ${p}`);
      tags[i] = TAG_NUMBER; payload = encodeUtf8(String(p));
    } else if (typeof p === "boolean") { tags[i] = TAG_BOOLEAN; payload = new Uint8Array([p ? 1 : 0]); }
    else if (p === null) { tags[i] = TAG_NULL; payload = new Uint8Array(0); }
    else throw new TypeError(`hash part ${i} must be a string, number, boolean or null`);
    payloads[i] = payload;
    size += 5 + payload.length;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = payloads[i].length;
    out[o++] = tags[i];
    out[o++] = n & 255; out[o++] = (n >>> 8) & 255; out[o++] = (n >>> 16) & 255; out[o++] = (n >>> 24) & 255;
    out.set(payloads[i], o);
    o += n;
  }
  return out;
}

/** The four 32-bit digest words of the parts, h1 first. See the header for the encoding. */
export function hashWords(...parts: HashPart[]): HashWords {
  return hashBytes(encodeParts(parts));
}

/** A stable 32-hex-digit digest of the parts. Part boundaries matter: ("ab","c") differs from ("a","bc"). */
export function hashParts(...parts: HashPart[]): string {
  let s = "";
  for (const w of hashWords(...parts)) s += w.toString(16).padStart(8, "0");
  return s;
}

/** 32 bits of the same digest as an unsigned integer (the first 8 hex digits of hashParts). */
export function hash32(...parts: HashPart[]): number {
  return hashWords(...parts)[0];
}

const MAX_JSON_DEPTH = 128;

function canonicalJson(v: unknown, depth: number): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError(`hashJson: non-finite number ${v}`);
      return String(v);
    case "object": {
      if (depth >= MAX_JSON_DEPTH) throw new TypeError("hashJson: value is cyclic or nested deeper than 128");
      if (Array.isArray(v)) {
        let s = "[";
        for (let i = 0; i < v.length; i++) {
          if (i) s += ",";
          const item: unknown = v[i];
          s += item === undefined ? "null" : canonicalJson(item, depth + 1);
        }
        return s + "]";
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new TypeError("hashJson: only plain objects and arrays are supported");
      const rec = v as Record<string, unknown>;
      const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
      let s = "{";
      for (let i = 0; i < keys.length; i++) {
        if (i) s += ",";
        s += JSON.stringify(keys[i]) + ":" + canonicalJson(rec[keys[i]], depth + 1);
      }
      return s + "}";
    }
    default:
      throw new TypeError(`hashJson: unsupported ${typeof v} value`);
  }
}

/**
 * A stable fingerprint of a JSON-like value (string, finite number, boolean, null, arrays,
 * plain objects). Object keys are sorted, so key order never matters; array order does.
 * Object properties that are `undefined` are omitted and array `undefined` entries become
 * null, as in JSON. Anything else (NaN, Infinity, bigint, Date, Map, class instances, cycles)
 * throws TypeError instead of being hashed lossily. This is the successor of Warp's
 * `revision()`.
 */
export function hashJson(value: unknown): string {
  return hashParts("json", canonicalJson(value, 0));
}
