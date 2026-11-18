// The Migration page, read from its view as drawn: before any run, the rehearsal's start with the folders it reads, the
// swap's steps and going back's with the permissions; after one, the real run in brief, the backup and whether it is there,
// what is waiting on the user, in RPE's own words. The lists read a page at a time are the routes' (test/migrate).

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { MigrationReply } from "../../src/shared/api";
import { PAGES } from "../../src/ui/page-list";
import { MigrationView } from "../../src/ui/pages/migration";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { MIGRATED, NOT_RUN } from "./migration-recorded";
import { elements, expand, textOf } from "./vnodes";

function view(shown: MigrationReply) {
  const tree = expand(h(MigrationView, { shown, starting: false, said: null, saving: null, of: "run", onOf: () => undefined, onRehearse: () => undefined, onSave: () => undefined, folder: null, onFolder: () => undefined }));
  return { tree, text: textOf(tree) };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);

describe("the Migration page", () => {
  test("before any run it offers the rehearsal over the folders it reads, and shows the swap's steps and going back's with the permissions", () => {
    const { tree } = view(NOT_RUN);
    expect(section(tree, "rehearsal")).toContain("Start a rehearsal");
    expect(section(tree, "rehearsal")).toContain("/srv/home/.config/lumiah");
    expect(section(tree, "run")).toContain("No real run of the migration has been made in this data folder yet.");
    for (const step of NOT_RUN.swap) expect(section(tree, "swap")).toContain(step);
    for (const step of NOT_RUN.goingBack.steps) expect(section(tree, "going-back")).toContain(step);
  });

  test("after a run: the run in brief, the backup with whether it is still there, what is waiting on the user, and every permission to approve again", () => {
    const { tree } = view(MIGRATED);
    expect(section(tree, "run")).toContain("every row balances");
    expect(section(tree, "backup")).toBe(`The backupWhere/srv/rpe/backups/before-migration.tarSize46.1 MBSHA-256${MIGRATED.backup?.sha256}Still there, at that sizeyes`);
    expect(section(view({ ...MIGRATED, backup: { ...(MIGRATED.backup ?? { path: "", bytes: 0, sha256: "" }), present: false } }).tree, "backup")).toContain("Still there, at that sizeno");
    const waiting = section(tree, "waiting");
    expect(waiting).toContain("Waiting on you (5)");
    expect(waiting).toContain("Your GUIDANCE.md is at imported/GUIDANCE.md, switched off");
    expect(waiting).toContain("Chat chat-harbour was paused on 1 edit waiting on keep or discard.");
    expect(waiting).not.toContain("undefined");
    // A done line is struck; the chats still off RPE head the page, with the step that is his.
    expect(elements(tree).find((e) => e.props["data-waiting"] === "agent" && e.props["data-done"] === "true")).toBeDefined();
    expect(section(tree, "off-rpe")).toContain("choose one of RPE's connections for it");
    expect(elements(tree).findIndex((e) => e.props["data-section"] === "off-rpe")).toBeLessThan(elements(tree).findIndex((e) => e.props["data-section"] === "rehearsal"));
    const permissions = elements(tree).find((e) => e.props["data-permissions"] === "true");
    expect(elements(permissions?.props.children).filter((e) => e.type === "code").map((e) => textOf(e.props.children))).toEqual(MIGRATED.goingBack.permissions);
    expect(PAGES.find((n) => n.id === "migration")?.shells).toEqual(["web", "drawer"]);
    expect(routeOfHash(hashOf({ page: "migration" }))).toEqual({ page: "migration" });
  });

  test("a chat not carried heads the page with its cause and the press that opens its record; a chat carried since says so", () => {
    const notCarried = { head: "Not carried: 1 chat.", chats: [{ chat: "chat-gate", line: "Gate (chat-gate): the fold failed at message 2 (swipe 0): no words. See /srv/rpe/migration-failures/chat-gate.json.", lines: ["RPE holds nothing of it."], record: "/srv/rpe/migration-failures/chat-gate.json" }], carried: [{ chat: "chat-fog", line: "Fog (chat-fog) was carried by the run of 2026-11-15." }] };
    const opened: string[] = [];
    const record = (chat: string) => {
      opened.push(chat);
      return h("span", { "data-record": chat }, "the record");
    };
    const tree = expand(h(MigrationView, { shown: { ...MIGRATED, notCarried }, starting: false, said: null, saving: null, of: "run", onOf: () => undefined, onRehearse: () => undefined, onSave: () => undefined, folder: null, onFolder: () => undefined, record }));
    const failed = elements(tree).find((e) => e.props["data-not-carried"] === "");
    expect(textOf(failed?.props.children)).toContain("at message 2 (swipe 0): no words. See /srv/rpe/migration-failures/chat-gate.json.");
    expect(opened).toEqual(["chat-gate"]);
    expect(elements(tree).find((e) => e.props["data-record"] === "chat-gate")).toBeDefined();
    expect(textOf(elements(tree).find((e) => e.props["data-carried-now"] === "")?.props.children)).toBe("Fog (chat-fog) was carried by the run of 2026-11-15.");
    // Carried and none left open: the carried line alone, no alarm.
    const calm = view({ ...MIGRATED, notCarried: { head: "", chats: [], carried: notCarried.carried } }).tree;
    expect(elements(calm).find((e) => e.props["data-not-carried"] === "")).toBeUndefined();
    expect(elements(calm).find((e) => e.props["data-carried-now"] === "")).toBeDefined();
  });
});
