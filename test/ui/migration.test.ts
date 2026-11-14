// The Migration page, read from its view as drawn and from its read: before any run, one line that none
// has; after one, the report as its printed text, each chat with what came of it and its check, the
// backup and whether it is there, what is waiting on the user, and the steps of going back with the
// permissions to approve again, in RPE's own words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { NAV } from "../../src/ui/frame";
import { type MigrationRead, MigrationView, readMigration } from "../../src/ui/pages/migration";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { askingClient, settle } from "./asking";
import { MIGRATED, NOT_RUN } from "./migration-recorded";
import { banners, elements, expand, textOf } from "./vnodes";

function view(read: Partial<MigrationRead>) {
  const tree = expand(h(MigrationView, { read: { shown: null, loading: false, problem: null, ...read } }));
  return { tree, text: textOf(tree) };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);

describe("the Migration page", () => {
  test("before any run it says, in one line, that none has, and shows nothing else", () => {
    const { tree, text } = view({ shown: NOT_RUN });
    expect(text).toBe("MigrationWhat the last run of the migration left, and going back.No migration has run.");
    expect(elements(tree).some((e) => e.props["data-section"] !== undefined)).toBe(false);
  });

  test("after a run: the report as it was printed, each chat with what came of it and its check, where it differed in the report's own words", () => {
    const { tree, text } = view({ shown: MIGRATED });
    // The printed report, whole, as text.
    const pre = elements(tree).find((e) => e.type === "pre");
    expect(textOf(pre?.props.children)).toBe(MIGRATED.text ?? "");
    const chats = section(tree, "chats");
    expect(chats).toContain("Chats (3)");
    expect(chats).toContain("chat-calderimported31 turns imported · matched at the head: yes, at 12 of 12 swipes");
    expect(chats).toContain("chat-harbourimported8 turns imported · matched at the head: no, at 3 of 4 swipes · shares 4 messages with chat-calder");
    expect(chats).toContain("differs at the head: place:harbour.boats");
    expect(chats).toContain("going back differs (not kept) at message msg-h5, swipe 1: entity:ash.coins");
    expect(chats).toContain("chat-oldnot importedit plays no world");
    expect(chats).not.toContain("0 turns imported");
    // The chat that differed is marked apart from the one that matched.
    const tones = elements(tree)
      .filter((e) => typeof e.props.class === "string" && e.props.class.startsWith("lre-badge"))
      .map((e) => e.props.class);
    expect(tones).toEqual(["lre-badge pos", "lre-badge warn", "lre-badge"]);
    expect(text).not.toContain("No migration has run.");
  });

  test("the backup with where it is, how large and whether it is still there; what is waiting on the user; and the steps of going back with every permission to approve again", () => {
    const { tree } = view({ shown: MIGRATED });
    expect(section(tree, "backup")).toBe(`The backupWhere/srv/rpe/backups/before-migration.tar.gzSize46.1 MBSHA-256${MIGRATED.backup?.sha256}Still there, at that sizeyes`);
    expect(section(view({ shown: { ...MIGRATED, backup: { ...(MIGRATED.backup ?? { path: "", bytes: 0, sha256: "" }), present: false } } }).tree, "backup")).toContain("Still there, at that sizeno");
    const waiting = section(tree, "waiting");
    expect(waiting).toContain("Waiting on you (5)");
    expect(waiting).toContain("Your GUIDANCE.md is at imported/GUIDANCE.md, switched off.");
    expect(waiting).toContain("The setting jobs.connections.Harbour Flash.atOnce names Harbour Flash, a connection in Lumiverse: pick one of RPE's for it.");
    expect(waiting).toContain("Chat chat-harbour: 1 edit waiting on keep or discard, 2 staged actions, 1 review card and a rollback never applied.");
    expect(waiting).toContain("Your own 2 agents, 1 skill and 3 texts are attached and switched off.");
    expect(waiting).toContain("Chat chat-calder: the mind files of 2 characters, and its notes, are attached and not yet filed.");
    const back = section(tree, "going-back");
    for (const step of MIGRATED.goingBack.steps) expect(back).toContain(step);
    const permissions = elements(tree).find((e) => e.props["data-permissions"] === "true");
    expect(elements(permissions?.props.children).filter((e) => e.type === "code").map((e) => textOf(e.props.children))).toEqual(MIGRATED.goingBack.permissions);
    expect(back).toContain(`to approve again (${MIGRATED.goingBack.permissions.length})`);
  });

  test("it reads RPE's migration route once; RPE's refusal is said in its words; what comes after the page has left is let go; the page has its place in both shells and in the address", async () => {
    const { client, asked } = askingClient();
    const reads: MigrationRead[] = [];
    readMigration(client, (r) => reads.push(r));
    expect(asked.map((a) => a.key)).toEqual(["GET /api/v1/migration"]);
    asked[0]?.answer(MIGRATED);
    await settle();
    expect(reads).toEqual([{ shown: MIGRATED, loading: false, problem: null }]);
    const stop = readMigration(client, (r) => reads.push(r));
    asked[1]?.fail(new Error("This needs a page token or the web UI's token."));
    await settle();
    expect(banners(view(reads[1] ?? {}).tree)).toEqual([{ title: "The migration's report could not be read", text: "The migration's report could not be readThis needs a page token or the web UI's token." }]);
    stop();
    readMigration(client, (r) => reads.push(r))();
    asked[2]?.answer(MIGRATED);
    await settle();
    expect(reads.length).toBe(2);
    expect(NAV.find((n) => n.id === "migration")?.shells).toEqual(["web", "drawer"]);
    expect(routeOfHash(hashOf({ page: "migration" }))).toEqual({ page: "migration" });
  });
});
