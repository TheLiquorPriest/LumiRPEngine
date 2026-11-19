// The thread's half of a long fold (`away.ts`): it opens the database file to read, builds a store as the sending one was built (the
// shipped packs, the areas it was given, the same fingerprint, snapshot spacing and walk limits), folds the job as the store folds,
// and answers with what that fold held and found worth storing. It writes nothing: its connection reads alone, and each job is one
// read transaction, so a fold sees the rows as they stood when it began however the writer goes on.

import { Database } from "bun:sqlite";
import { createRegistry } from "../engine/registry-impl";
import { ALL_PACKS } from "../packs/index";
import type { AwayFailure, FoldDone, FoldJob, StoreBrief } from "./away";
import type { StoreArea } from "./areas";
import { openStore, type Store } from "./store";
import { storedWorlds } from "./worlds";

interface Open {
  key: string;
  db: Database;
  store: Store;
  failures: AwayFailure[];
  logs: FoldDone["logs"];
}

/** The store this thread folds with: one for the file and brief it was last asked for. */
let open: Open | null = null;

function storeFor(brief: StoreBrief, areas: readonly StoreArea[]): Open {
  const key = JSON.stringify(brief);
  if (open !== null && open.key === key) return open;
  open?.db.close();
  open = null;
  const db = new Database(brief.path, { readonly: true });
  db.run("PRAGMA query_only = ON");
  const failures: AwayFailure[] = [];
  const logs: FoldDone["logs"] = [];
  const store = openStore({
    db,
    registry: createRegistry(ALL_PACKS),
    worlds: storedWorlds(db),
    areas,
    snapshotEvery: brief.snapshotEvery,
    statesPerChat: brief.statesPerChat,
    snapshotsHeld: brief.snapshotsHeld,
    onWorker: true,
    ...(brief.fingerprint === undefined ? {} : { fingerprint: brief.fingerprint }),
    ...(brief.kindChain === undefined ? {} : { kindChain: brief.kindChain }),
    ...(brief.holderDepth === undefined ? {} : { holderDepth: brief.holderDepth }),
    ...(brief.visitDepth === undefined ? {} : { visitDepth: brief.visitDepth }),
    handlerFailed: (f) => failures.push({ op: f.op, message: f.error instanceof Error ? f.error.message : String(f.error), user: f.user, ...(f.chat === undefined ? {} : { chat: f.chat }), turn: f.turn, change: f.change }),
    log: (message, data) => logs.push({ message, data }),
  });
  open = { key, db, store, failures, logs };
  return open;
}

/**
 * Runs one long fold on this thread: the states it asked for (never the chat's start or another made on the way), the snapshots it found
 * worth storing, and what it said. After it, this thread's store holds nothing but its world documents (`storedWorlds`, `store.worldsKept`).
 */
export function foldAway(input: { brief: StoreBrief; job: FoldJob }, areas: readonly StoreArea[]): FoldDone {
  const { db, store, failures, logs } = storeFor(input.brief, areas);
  failures.length = 0;
  logs.length = 0;
  db.run("BEGIN");
  try {
    const nodes = store.user(input.job.user).foldJob(input.job);
    return { folds: store.takeFolds(input.job.user, nodes), held: store.takeHeld(input.job.user), failures: [...failures], logs: [...logs] };
  } finally {
    db.run("COMMIT");
    // What this thread held is the sender's now; a state kept here would outlive the rows it was folded from.
    store.dropCaches();
  }
}
