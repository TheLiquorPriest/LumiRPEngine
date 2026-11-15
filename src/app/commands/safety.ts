// Whose files RPE's service runs (plan §16; today's command's refusal, LumiAH `refusal`): the app file,
// the Bun that runs it and every folder above them must be no one else's to change but root's, or
// whoever else can change one would run code as this account through RPE's service.

import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { shellWord } from "../../migrate/going-back";
import type { Env } from "../config";
import { accountProgram } from "../up";

const GROUP_WRITE = 0o020;
const OTHERS_WRITE = 0o002;
const STICKY = 0o1000;

interface Owned {
  uid: number;
  gid: number;
  mode: number;
}

/** The accounts in a group (its listed members and every account whose primary group it is) and its name; null where they cannot all be named (no getent, as on macOS). */
type GroupOf = (gid: number) => Promise<{ name: string; uids: number[] | null }>;

function groupsOf(env: Env): GroupOf {
  const run = accountProgram(env, null);
  const asked = new Map<number, Promise<{ name: string; uids: number[] | null }>>();
  const ask = async (gid: number): Promise<{ name: string; uids: number[] | null }> => {
    const group = await run("getent", ["group", String(gid)]);
    const [name = "", , id, listed = ""] = (group.out.split("\n")[0] ?? "").trim().split(":");
    if (group.code !== 0 || name === "" || id !== String(gid)) return { name: String(gid), uids: null };
    const passwd = await run("getent", ["passwd"]);
    if (passwd.code !== 0) return { name, uids: null };
    const accounts = passwd.out.split("\n").flatMap((line) => {
      const [account = "", , uid = "", primary = ""] = line.trim().split(":");
      return account !== "" && /^\d+$/.test(uid) ? [{ account, uid: Number(uid), primary }] : [];
    });
    const uids = accounts.filter((x) => x.primary === String(gid)).map((x) => x.uid);
    for (const member of listed.split(",").filter((m) => m !== "")) {
      const found = accounts.find((x) => x.account === member);
      if (found === undefined) return { name, uids: null };
      uids.push(found.uid);
    }
    return { name, uids };
  };
  return (gid) => {
    let answer = asked.get(gid);
    if (answer === undefined) asked.set(gid, (answer = ask(gid)));
    return answer;
  };
}

function stat(path: string): Owned | null {
  try {
    const s = statSync(path);
    return { uid: s.uid, gid: s.gid, mode: s.mode };
  } catch {
    return null;
  }
}

/** Only `uid` or root can change it: one of theirs, writable by no one else, its group's write counting for nothing in its owner's own group. */
async function onlyTheirs(entry: Owned, uid: number, groupOf: GroupOf): Promise<boolean> {
  if ((entry.uid !== uid && entry.uid !== 0) || (entry.mode & OTHERS_WRITE) !== 0) return false;
  if ((entry.mode & GROUP_WRITE) === 0) return true;
  const { uids } = await groupOf(entry.gid);
  return uids !== null && uids.length > 0 && uids.every((u) => u === entry.uid);
}

/** The entries, from `path` (its links resolved) up through every folder above it, that someone other than `uid` or root can change; it stops at the first of another account's. */
async function changeable(path: string, uid: number, groupOf: GroupOf): Promise<{ path: string; entry: Owned }[]> {
  const found: { path: string; entry: Owned }[] = [];
  let below: Owned | null = null;
  for (let at = realpathSync(path); ; at = dirname(at)) {
    const entry = stat(at);
    // A sticky folder (/tmp), `uid`'s or root's, lets no one else rename or remove an entry of `uid`'s or root's in it.
    const sticky = entry !== null && below !== null && (entry.mode & STICKY) !== 0 && (entry.uid === uid || entry.uid === 0) && (below.uid === uid || below.uid === 0);
    if (entry !== null && !sticky && !(await onlyTheirs(entry, uid, groupOf))) {
      found.push({ path: at, entry });
      if (entry.uid !== uid && entry.uid !== 0) return found;
    }
    if (dirname(at) === at) return found;
    below = entry;
  }
}

/**
 * Why this account will not run RPE's service from `files` (the app file and the Bun), or null where it
 * may: each file and every folder above it must be changeable by `uid` and root alone. The refusal
 * names each that another account could change, the chmod that takes the group's or everyone's write
 * away from one of this account's or root's, and for one of another account's, how to run RPE as that
 * account.
 */
export async function changeableRefusal(files: readonly string[], uid: number, env: Env): Promise<string | null> {
  const groupOf = groupsOf(env);
  const unsafe: { path: string; why: string; chmod: string | null }[] = [];
  for (const file of new Set(files)) {
    let found: { path: string; entry: Owned }[];
    try {
      found = await changeable(file, uid, groupOf);
    } catch (error) {
      if (!unsafe.some((u) => u.path === file)) unsafe.push({ path: file, why: `it cannot be checked (${error instanceof Error ? error.message : String(error)})`, chmod: null });
      continue;
    }
    for (const { path, entry } of found) {
      if (unsafe.some((u) => u.path === path)) continue;
      if (entry.uid !== uid && entry.uid !== 0) {
        unsafe.push({ path, why: `the account ${entry.uid} owns it and can change it`, chmod: null });
        continue;
      }
      const group = (entry.mode & GROUP_WRITE) !== 0 ? (await groupOf(entry.gid)).name : null;
      const others = (entry.mode & OTHERS_WRITE) !== 0;
      const groupMayWrite = group !== null && (entry.mode & GROUP_WRITE) !== 0;
      const take = `${groupMayWrite ? "g" : ""}${others ? "o" : ""}`;
      unsafe.push({ path, why: groupMayWrite ? `its group, ${group}, ${others ? "and everyone else " : ""}can change it` : "everyone else can change it", chmod: `${entry.uid === 0 && uid !== 0 ? "sudo " : ""}chmod ${take}-w ${shellWord(path)}` });
    }
  }
  if (unsafe.length === 0) return null;
  const who = uid === 0 ? "root" : `account ${uid}`;
  const head = `Refusing to run RPE's service as ${who}: another account can change these, and would then run code as ${who} through it.`;
  const listed = unsafe.map((u) => `  ${u.path}: ${u.why}`);
  const chmods = unsafe.flatMap((u) => (u.chmod === null ? [] : [`  ${u.chmod}`]));
  if (unsafe.every((u) => u.chmod !== null)) return [head, ...listed, "Take that write away, then run it again:", ...chmods].join("\n");
  return [head, ...listed, ...(chmods.length > 0 ? ["First take away the write that is not its owner's:", ...chmods] : []), "Run RPE as the account its files belong to instead: sudo -u <that account> <the same line>"].join("\n");
}
