// The door's limits as settings (STANDALONE-PLAN §4.2-§4.4, Appendix D.1): every fixed value the door to
// Lumiverse uses is a setting of the `lumiverse:` group of `RPE-global.yml`, its default the value its part
// keeps, read through the one reader of the config levels; and a value written in the file is the one the
// door uses. Every account is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { CHAT_SEARCH_DEFAULTS } from "../../src/adapter/lumiverse/chat";
import { RETRY_MS, SLOW_MS, TRIES } from "../../src/adapter/lumiverse/db";
import { DRY_RUN_MS } from "../../src/adapter/lumiverse/hint";
import { BREAKDOWN_TRIES, REREADS } from "../../src/adapter/lumiverse/http-reads";
import { HTTP_KEEP_MS, KEPT } from "../../src/adapter/lumiverse/memo";
import { STORE_HITS } from "../../src/adapter/lumiverse/stores";
import { WHOLE_HOLD_MS } from "../../src/adapter/lumiverse/provider";
import { RELAY_DEFAULTS } from "../../src/adapter/lumiverse/relay";
import { KEEP_EVERY_MS } from "../../src/adapter/lumiverse/session";
import { EXTENSION_LOG_CHARS, LUMIVERSE_DEFAULTS, LUMIVERSE_SETTING_DEFS, LUMIVERSE_SETTINGS, lumiverseSettings, QUESTION_BODY_BYTES, QUESTION_WAIT_MS } from "../../src/adapter/lumiverse/settings";
import { PAGE_ROAD_DEFAULTS } from "../../src/ext/page";
import { WHOSE_WAIT_MS } from "../../src/ext/registration";
import { SOCKET_DEFAULTS } from "../../src/adapter/lumiverse/socket";
import { COMMENT_MS } from "../../src/adapter/lumiverse/stream";
import { QUESTION_PATH, type Question } from "../../src/adapter/lumiverse/wire";
import { USER_HEADER } from "../../src/adapter/lumiverse/pipe-wire";
import { readConfig } from "../../src/app/config-read";
import type { JsonValue } from "../../src/shared/json";
import { REAL_CLOCK } from "../ext/rig";
import { openDoor, USER, type DoorBed } from "./door";

const beds: DoorBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** Every leaf of a value, by its path. */
function leaves(value: unknown, at = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) for (const [p, leaf] of leaves(v, `${at}.${k}`)) out.set(p, leaf);
  else out.set(at, value);
  return out;
}

describe("the door's settings", () => {
  test("every limit the door uses is a declared setting, and a value set in RPE-global.yml is the one the door uses", async () => {
    // Each limit's default is the value its part keeps.
    expect(LUMIVERSE_DEFAULTS).toEqual({
      sessionCheckMs: KEEP_EVERY_MS,
      socket: SOCKET_DEFAULTS,
      database: { tries: TRIES, retryMs: RETRY_MS, slowMs: SLOW_MS },
      reads: { rereads: REREADS, breakdownReplies: BREAKDOWN_TRIES, keepMs: HTTP_KEEP_MS, kept: KEPT },
      dryRunMs: DRY_RUN_MS,
      commentMs: COMMENT_MS,
      wholeHoldMs: WHOLE_HOLD_MS,
      // Off as shipped: the empty reply a failed or stopped turn left stays (plan §4.2's closed table of writes).
      removeEmptyReply: false,
      relay: RELAY_DEFAULTS,
      questionBytes: QUESTION_BODY_BYTES,
      extension: { questionMs: QUESTION_WAIT_MS, logChars: EXTENSION_LOG_CHARS, requestMs: PAGE_ROAD_DEFAULTS.requestMs, renewMs: PAGE_ROAD_DEFAULTS.renewMs, whoseMs: WHOSE_WAIT_MS },
      search: CHAT_SEARCH_DEFAULTS,
      stores: { hits: STORE_HITS },
      untaggedWhileAwaited: "pass",
    });
    // Each is declared under `lumiverse:`, read from the levels every chat shares, with its name and its line for the Settings page.
    for (const s of LUMIVERSE_SETTINGS) {
      expect(s.key.startsWith("lumiverse.")).toBe(true);
      expect(s.levels).toEqual(["shipped", "global"]);
      expect(s.name.length > 0 && s.about.length > 0).toBe(true);
    }

    // Every setting written over its default, within its bounds: every limit the door reads moves.
    const config: Record<string, JsonValue> = {};
    for (const s of Object.values(LUMIVERSE_SETTING_DEFS)) {
      const most = "most" in s.takes ? s.takes.most : undefined;
      const value = most === undefined ? s.default * 2 : Math.min(s.default * 2, most);
      let at = config;
      const path = s.key.split(".");
      for (const part of path.slice(0, -1)) at = (at[part] ??= {}) as Record<string, JsonValue>;
      at[path.at(-1)!] = value;
    }
    (config.lumiverse as Record<string, JsonValue>).untagged = { whileAwaited: "fail" };
    ((config.lumiverse as Record<string, JsonValue>).reply as Record<string, JsonValue>).removeEmpty = true;
    const set = leaves(lumiverseSettings(readConfig([{ level: "global", file: "RPE-global.yml", text: JSON.stringify(config) }], null)));
    const defaults = leaves(LUMIVERSE_DEFAULTS);
    expect([...set.keys()]).toEqual([...defaults.keys()]);
    for (const [path, value] of defaults) expect({ path, moved: set.get(path) !== value }).toEqual({ path, moved: true });

    // The door as composed reads the file: a question larger than the size set there is refused at the door.
    const b = await openDoor({ clock: REAL_CLOCK, lumiverse: { question: { maxKiB: 1 } } });
    beds.push(b);
    const ask = (question: Question): Promise<Response> =>
      fetch(`${b.listening.url}${QUESTION_PATH}`, { method: "POST", headers: { authorization: `Bearer ${b.registration.key}`, [USER_HEADER]: USER }, body: JSON.stringify(question) });
    const small: Question = { v: 1, user: USER, chat: "chat-harbor", purpose: "prompt", generation: null, path: [{ id: "m0", index: 0, swipe: 0, user: false, hash: "0".repeat(32) }], entries: [] };
    expect((await ask(small)).status).toBe(200);
    const large: Question = { ...small, entries: [{ id: "e1", book: "book-harbor", disabled: false, key: "harbor", content: "The tide comes in over the harbor wall. ".repeat(40) }] };
    expect((await ask(large)).status).toBe(413);
  });
});
