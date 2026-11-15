// Signing in to the web UI and the proof a page asks for before it sends RPE its token (plan §4.4,
// §16, security finding 9). RPE keeps only the hash of each page token, so the proof is keyed by that
// hash: the page sends the first characters of it and a nonce of its own, and RPE answers with the
// nonce's keyed hash, which only something that holds RPE's table of tokens can make. The page checks
// the answer before it offers any address its token. The wire (the path, the id's length, the nonce's
// form and the proof) is `src/shared/page-proof.ts`, which the page uses too.

import type { Database } from "bun:sqlite";
import { KEY_ID_LENGTH, NONCE_PATTERN, PROOF_PATH, proofOf } from "../shared/page-proof";
import { route, RouteError, shape } from "./routes";

export interface ProofDeps {
  readonly db: Database;
  /** The Lumiverse user this RPE belongs to: only his page tokens are asked after. */
  readonly owner: string;
  readonly now: () => number;
}

const KEY_ID = new RegExp(`^[0-9a-f]{${KEY_ID_LENGTH}}$`);

/**
 * The proof route: public, since the page has nothing RPE could check yet, and it answers nothing
 * but a keyed hash of what the page sent. It answers only for a page token of this RPE's user that is
 * still in time (the drawer's; no key RPE gives out is a page token). Two live tokens that share the
 * first characters of their hashes are answered by the newer one's: the page checks the answer against
 * its own token, so a proof that is not its own fails it, and nothing is opened.
 */
export function signinRoutes(deps: ProofDeps) {
  return [
    route({
      method: "GET",
      path: PROOF_PATH,
      access: "public",
      group: "service",
      does: "Proves to a page that this is the RPE that holds its page token, before the page sends it the token: a keyed hash of the page's nonce.",
      query: {
        id: shape.field(shape.text({ blank: false }), `The first ${KEY_ID_LENGTH} hexadecimal characters of the SHA-256 of the page's token.`),
        nonce: shape.field(shape.text({ blank: false }), "The page's own nonce: 16 to 64 hexadecimal characters."),
      },
      reply: shape.named("PageProof", "The proof of a page's nonce, keyed by the hash of its page token.", shape.object({ proof: shape.field(shape.text(), "HMAC-SHA-256 of the nonce, keyed by the token's hash, as lowercase hex.") })),
      handle: async ({ query }) => {
        if (!KEY_ID.test(query.id)) throw new RouteError(400, `id is the first ${KEY_ID_LENGTH} hexadecimal characters of the SHA-256 of the page's token.`);
        if (!NONCE_PATTERN.test(query.nonce)) throw new RouteError(400, "nonce is 16 to 64 hexadecimal characters.");
        const held = deps.db.query<{ hash: string }, [string, number, string]>(`SELECT hash FROM page_token WHERE user = ? AND kind = 'page' AND expires > ? AND substr(hash, 1, ${KEY_ID_LENGTH}) = ? ORDER BY made DESC LIMIT 1`).get(deps.owner, deps.now(), query.id);
        if (held === null) throw new RouteError(404, "RPE holds no page token by that id: ask for a new one.");
        return { proof: await proofOf(held.hash, query.nonce) };
      },
    }),
  ] as const;
}
