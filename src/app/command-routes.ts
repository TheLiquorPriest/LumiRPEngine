// What the server's own command line changes (plan §4.1 "One writer", §4.4, §16): make a key, switch
// a name on or off, keep the Lumiverse sign-in and the config's Lumiverse block, and say how RPE
// stands. The changes are written here once, over a sink: while RPE runs the sink is the server's
// own write queue and secrets file, which the command routes hand it (a command's process then opens
// neither the database nor the secrets file for writing); while RPE is stopped it is the command's
// own database and secrets file under the data folder's lock (`commands/writer.ts`). Nothing here
// is a route of a page: only the owner's command line may call them.

import type { Database } from "bun:sqlite";
import { isRecord } from "../shared/json";
import type { KeyFacts } from "./auth";
import { currentKeys, insertKey, KEY_PREFIXES, NO_OWNER, providerKeyTaken, takeKeyHash } from "./auth";
import type { DataPaths } from "./config";
import { updateConfigFile } from "./config";
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "./routes";
import type { SecretsFile } from "./secrets";
import { asCommand, listAllSwitches, listSwitches, setSwitch, type SwitchEntry } from "./switches";

/** The part of the secrets file the adapter keeps its sign-in to Lumiverse in (src/adapter/lumiverse/mount.ts). */
export const SIGN_IN_PART = "lumiverse";

/** Where the command routes answer, each on the server's own socket and nowhere else. */
export const COMMAND_PATHS = Object.freeze({
  keys: "/api/v1/command/keys",
  takenKeys: "/api/v1/command/keys/taken",
  switches: "/api/v1/command/switches/:name",
  lumiverse: "/api/v1/command/lumiverse",
  status: "/api/v1/command/status",
  busy: "/api/v1/command/busy",
});

const T = shape.text();
const KIND = shape.oneOf("provider", "extension", "web");
/** The keys the command line makes: RPE makes its extension's key itself, at every start. */
const MADE_KIND = shape.oneOf("provider", "web");

export const keyAsk = shape.named(
  "KeyAsk",
  "A new key of a kind, shown once; with `key`, the text of a key the caller made, which Lumiverse had to hold before RPE did.",
  shape.object({
    kind: shape.field(MADE_KIND, "Which key."),
    key: shape.optional(shape.text({ blank: false }), "The key's own text, in the form its kind's keys have."),
  }),
);
export const keyMade = shape.named(
  "KeyMade",
  "A key as it was made: shown this once, and kept only as its hash.",
  shape.object({
    kind: shape.field(MADE_KIND, "Which key."),
    key: shape.field(T, "The key itself."),
    made: shape.field(shape.number(), "When it was made, epoch milliseconds."),
    ends: shape.field(shape.nullable(shape.number()), "When it runs out, epoch milliseconds; null: it has no end."),
  }),
);
export const takenKeyAsk = shape.named(
  "TakenKeyAsk",
  "The hash of the provider key today's connections hold, which RPE takes over at the swap, with the model names those connections name, which the key opens.",
  shape.object({ hash: shape.field(shape.text({ blank: false }), "The key's SHA-256, in hex."), models: shape.field(shape.list(T), "The model names of the connections that hold the key.") }),
);
export const switchAsk = shape.named(
  "SwitchAsk",
  "Switch the named thing on or off, for the user it names.",
  shape.object({ state: shape.field(shape.oneOf("on", "off"), "Which."), user: shape.optional(T, "The user whose own it is; the user this RPE belongs to where left out.") }),
);
export const switchEntry = shape.named(
  "SwitchEntry",
  "A thing that runs a command or calls out, and where it stands.",
  shape.object({
    user: shape.field(T, "The user whose own it is: what is on for one user is not on for another."),
    name: shape.field(T, "Its name."),
    kind: shape.field(T, "What sort of thing it is."),
    what: shape.field(T, "Exactly what it runs or calls."),
    state: shape.field(shape.oneOf("waiting", "on", "off"), "Whether it may run."),
    listed: shape.field(shape.number(), "When this definition was first listed."),
    changed: shape.field(shape.nullable(shape.number()), "When the command line last switched it; null if never."),
  }),
);
export const switched = shape.named(
  "Switched",
  "The switched entry, or null with what is listed when nothing of that name is.",
  shape.object({ entry: shape.field(shape.nullable(switchEntry), "The entry as it stands now; null where nothing of that name is listed."), listed: shape.field(shape.list(shape.object({ name: T, state: shape.oneOf("waiting", "on", "off") })), "Every name listed, with its state.") }),
);
const signIn = shape.object({ username: T, user: T, token: T, savedAt: shape.number() });
export const lumiverseSave = shape.named(
  "LumiverseSave",
  "What the command line keeps of RPE's Lumiverse: its sign-in in the secrets file (null forgets it), and values of the config's `lumiverse` block.",
  shape.object({
    signIn: shape.optional(shape.nullable(signIn), "The sign-in to keep; null forgets the one kept; left out, it is not touched."),
    set: shape.optional(shape.record(shape.nullable(shape.union(T, shape.list(T)))), "Values of the config's `lumiverse` block (url, user, database, connections, models); null takes one out."),
    listens: shape.optional(shape.object({ address: T, port: shape.whole({ least: 0, most: 65535 }) }), "Where RPE listens, as the swap takes it from today's runtime."),
  }),
);
export const commandStatus = shape.named(
  "CommandStatus",
  "How RPE stands as its own command line is told: the keys in force, the switches and the builds in words.",
  shape.object({
    keys: shape.field(
      shape.list(shape.object({ kind: KIND, last4: shape.nullable(T), made: shape.number(), ends: shape.nullable(shape.number()), taken: shape.yesNo() })),
      "Each key in force: the provider key by its last four characters (null for one taken from today's connection, whose were never known), when it was made and, for the web token, when it ends; never a key's text.",
    ),
    switches: shape.field(shape.list(switchEntry), "Every user's own switches, each name's newest definition."),
    builds: shape.field(shape.nullable(T), "The builds that meet at RPE in a sentence or two; null where the server does not say."),
  }),
);

export type KeyAsk = Infer<typeof keyAsk>;
export type KeyMade = Infer<typeof keyMade>;
export type Switched = Infer<typeof switched>;
export type LumiverseSave = Infer<typeof lumiverseSave>;
export type CommandStatus = Infer<typeof commandStatus>;
type SwitchEntryMirrored = Holds<Exactly<Infer<typeof switchEntry>, SwitchEntry>>;
type KeysMirrored = Holds<Exactly<CommandStatus["keys"], KeyFacts[]>>;

/** What the changes are written through. */
export interface CommandSink {
  readonly paths: DataPaths;
  readonly secrets: SecretsFile;
  /** The Lumiverse user this RPE belongs to, as the install named him; null before it has, and nothing of his is then written (R-179). */
  readonly user: string | null;
  /** How long the web token holds after it is made (`auth.webKeyDays`); null: it has no end. */
  readonly webKeyMs: number | null;
  /** For reads. Writes go through `run` alone. */
  readonly db: Database;
  /** Runs one write in a transaction of its own, after those asked for before it; resolves with what it returned once committed. */
  run<T>(write: (db: Database) => T): Promise<T>;
  now(): number;
}

/** What the command line asks to have written: the same calls whether the server writes them or the command does. */
export interface CommandOps {
  makeKey(ask: KeyAsk): Promise<KeyMade>;
  takeKey(hash: string, models: readonly string[]): Promise<void>;
  setSwitch(name: string, state: "on" | "off", user?: string): Promise<Switched>;
  saveLumiverse(save: LumiverseSave): Promise<void>;
  status(): Promise<CommandStatus>;
}

/** A refusal in the words the command line prints. */
export class CommandRefused extends Error {
  override name = "CommandRefused";
}

/** Why no provider key is made once RPE has taken today's connection's (plan §15.6, R-90). */
export const ONE_KEY = "After the switch from the previous build, the one key that opens RPE's provider endpoint is the one your connection in Lumiverse already holds, so that connection never changes and going back stays as it is written. RPE makes no new provider key: a new one would have to be put in that connection, and that would make going back harder.";

const HEX_KEY = /^[0-9a-f]{64}$/;

/** The user a change of his rows is for: the install's, and a refusal where it has named none. */
function ownerOf(sink: CommandSink): string {
  if (sink.user === null) throw new CommandRefused(NO_OWNER);
  return sink.user;
}

/**
 * The command line's changes, over `sink`; `builds` says the builds in words where the caller knows them. `look` lists what the user's
 * files name that runs a command or calls out, as they stand now, before the list is read or a name in it is switched: only a running
 * RPE can (RPH reads the files for it); a command that writes with RPE stopped looks at nothing, and RPE lists the files when it starts.
 */
export function commandOps(sink: CommandSink, builds: () => Promise<string | null> = () => Promise.resolve(null), look: () => Promise<void> = () => Promise.resolve()): CommandOps {
  return {
    async makeKey(ask) {
      const now = sink.now();
      if (ask.key !== undefined && !(ask.key.startsWith(KEY_PREFIXES[ask.kind]) && HEX_KEY.test(ask.key.slice(KEY_PREFIXES[ask.kind].length)))) throw new CommandRefused(`A ${ask.kind} key is ${KEY_PREFIXES[ask.kind]} and 64 hexadecimal characters.`);
      const user = ownerOf(sink);
      return await sink.run((db) => {
        // After the swap the one key is the one his connection in Lumiverse holds: a new one asked for would make going back harder. (The install hands over a key of its own for a connection of its own, which holds no key of today's.)
        if (ask.kind === "provider" && ask.key === undefined && providerKeyTaken(db, user)) throw new CommandRefused(ONE_KEY);
        const made = insertKey(db, user, ask.kind, now, ask.key, sink.webKeyMs);
        return { kind: ask.kind, key: made.key, made: made.made, ends: made.ends };
      });
    },
    async takeKey(hash, models) {
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new CommandRefused("A key's hash is 64 hexadecimal characters.");
      const user = ownerOf(sink);
      await sink.run((db) => takeKeyHash(db, user, hash, models, sink.now()));
    },
    async setSwitch(name, state, whose) {
      await look();
      const user = whose ?? ownerOf(sink);
      return await sink.run((db) => {
        const entry = asCommand(db, () => setSwitch(db, user, name, state, sink.now()));
        return { entry, listed: listSwitches(db, user).map((s) => ({ name: s.name, state: s.state })) };
      });
    },
    async saveLumiverse(save) {
      if (save.signIn !== undefined) await sink.secrets.write(SIGN_IN_PART, save.signIn === null ? null : { ...save.signIn });
      const { set, listens } = save;
      if (set !== undefined || listens !== undefined) {
        await updateConfigFile(sink.paths, (raw) => {
          if (set !== undefined) {
            const block: Record<string, unknown> = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}) };
            for (const [name, value] of Object.entries(set)) {
              if (value === null) delete block[name];
              else block[name] = value;
            }
            // The list takes the place of the one id a config.json held before it.
            if (set.connections !== undefined) delete block.connection;
            raw.lumiverse = block;
          }
          if (listens !== undefined) Object.assign(raw, { address: listens.address, port: listens.port });
        });
      }
    },
    async status() {
      // Before the install names a user there is nothing of his to say.
      const user = sink.user;
      if (user !== null) await look();
      return { keys: user === null ? [] : currentKeys(sink.db, user), switches: user === null ? [] : listAllSwitches(sink.db), builds: await builds() };
    },
  };
}

/** A refusal of the command line's own words reaches its caller as a plain 400. */
async function asked<T>(done: Promise<T>): Promise<T> {
  try {
    return await done;
  } catch (error) {
    if (error instanceof CommandRefused) throw new RouteError(400, error.message);
    throw error;
  }
}

/**
 * The command line's routes: each writes through `sink`, the server's own queue and secrets file, so
 * that while RPE runs the command line's process writes neither. Their access is `command`: they are
 * served on the owner's socket and nowhere else.
 */
export function commandRoutes(sink: CommandSink, builds: () => Promise<string | null>, look: () => Promise<void>) {
  const ops = commandOps(sink, builds, look);
  return [
    route({ method: "POST", path: COMMAND_PATHS.keys, access: "command", group: "service", does: "Makes a new key of a kind, which retires the one before it; shown this once.", body: keyAsk, reply: keyMade, handle: ({ body }) => asked(ops.makeKey(body)) }),
    route({ method: "POST", path: COMMAND_PATHS.takenKeys, access: "command", group: "service", does: "Takes over the provider key today's connections hold, by its hash alone, paired with their model names.", body: takenKeyAsk, reply: shape.nothing(), handle: ({ body }) => asked(ops.takeKey(body.hash, body.models)) }),
    route({ method: "PUT", path: COMMAND_PATHS.switches, access: "command", group: "service", does: "Switches a thing that runs a command or calls out on or off: the one road to it.", body: switchAsk, reply: switched, handle: ({ params, body }) => asked(ops.setSwitch(params.name, body.state, body.user)) }),
    route({ method: "PUT", path: COMMAND_PATHS.lumiverse, access: "command", group: "service", does: "Keeps RPE's sign-in to Lumiverse and the config's Lumiverse block.", body: lumiverseSave, reply: shape.nothing(), handle: ({ body }) => asked(ops.saveLumiverse(body)) }),
    route({ method: "GET", path: COMMAND_PATHS.status, access: "command", group: "service", does: "The keys in force, the switches and the builds, for `rpe status`.", reply: commandStatus, handle: () => ops.status() }),
  ] as const;
}
