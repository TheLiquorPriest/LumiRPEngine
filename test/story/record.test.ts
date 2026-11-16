import { describe, expect, test } from "bun:test";
import { StoreInputError } from "../../src/store";
import { storyAt } from "../../src/story/path";
import { keyedItemId, STORY_PARTS, StoryRecord, type StoryWrite, writeStory } from "../../src/story/record";
import { CHAT, openTable, USER } from "./rig";

/** One write of every part, as an invented story's first turn might hold them. */
function everyPart(turn: string): StoryWrite[] {
  return [
    { part: "premise", item: keyedItemId("premise", ""), value: { text: "A courier's last season on the Hollow Vale road.", tone: "Quiet and wry.", rules: "No magic; letters take days.", role: "The player is Wren, the courier." } },
    { part: "chapter", item: null, value: { title: "The thaw" } },
    { part: "scene", item: null, value: { title: "The common room", place: "The inn's common room", time: "A wet morning", who: ["Wren", "Bram"], purpose: "Hand over the sealed letter.", tension: "Bram will not say who sealed it.", wants: "Wren wants her fee; Bram wants the letter gone.", ends: "The letter changes hands." } },
    { part: "beat", item: null, value: { text: "Bram slides a sealed letter across the bar and will not meet Wren's eye.", who: ["Bram", "Wren"], place: "The common room" } },
    { part: "thread", item: null, value: { text: "Who sealed the letter?", kind: "question", stakes: "Wren's licence, if it is forged.", who: ["Bram"], payoff: "The seal is the reeve's own.", hot: true } },
    { part: "arc", item: keyedItemId("arc", "Bram"), value: { who: "Bram", began: "A careful innkeeper.", stands: "Frightened of someone.", next: "Confides in Wren, or runs." } },
    { part: "player", item: null, value: { text: "Enjoys slow haggling scenes.", kind: "enjoys" } },
    { part: "future", item: null, value: { text: "The reeve's man calls at the inn.", tier: 2, due: 1_500, who: ["the reeve's man"], place: "The inn" } },
    { part: "canon", item: null, value: { text: "The inn has twelve rooms.", who: ["Bram"] } },
    { part: "record", item: keyedItemId("record", turn), value: { intent: "An action: Wren asks for the letter.", decided: "Bram gives it, uneasy.", why: "His arc says he is frightened.", rulings: "None.", consents: "None.", next: "Let the seal matter next turn." } },
  ];
}

describe("the story record", () => {
  test("holds every part as written, and reads each back as it stands", async () => {
    const t = await openTable();
    const turn = await t.begin();
    const writes = everyPart(turn.id);
    const rows = await t.write(turn, writes);
    const canon = rows.find((r) => r.part === "canon")?.item ?? "";
    await t.write(turn, [{ part: "retcon", item: null, value: { text: "The inn has ten rooms, not twelve.", why: "The player's own map shows ten.", of: canon } }]);
    await t.tie(turn);

    const record = t.record();
    for (const part of STORY_PARTS) expect({ part, count: record.of(part).length }).toEqual({ part, count: 1 });
    for (const w of writes) {
      const [item] = record.of(w.part);
      expect(item?.fields).toEqual(w.value);
      expect(item?.opened).toBe(turn.id);
    }
    expect(record.of("retcon")[0]?.fields.of).toBe(canon);
    expect(record.items.get("arc:bram")?.fields.stands).toBe("Frightened of someone.");
    // The beat lies at its turn's reply; the scene runs from the player's message to the chat's end.
    const [beat] = record.of("beat");
    expect(beat && record.beatAt(beat)).toBe(1);
    const [scene] = record.of("scene");
    expect(record.spans("scene").get(scene?.id ?? "")).toEqual({ from: 0, to: 1 });
  });

  test("keeps each item's history: its writes in order, merged; read at an earlier turn, as it stood then", async () => {
    const t = await openTable();
    const first = await t.play([{ part: "thread", item: null, value: { text: "Who sealed the letter?", hot: true, stakes: "Wren's licence." } }]);
    const id = t.record().of("thread")[0]?.id ?? "";
    const second = await t.play([{ part: "thread", item: id, value: { state: "The wax smells of the reeve's office.", hot: false } }]);
    const third = await t.play([{ part: "thread", item: id, value: {} }]);

    const item = t.record().items.get(id);
    expect(item?.fields).toEqual({ text: "Who sealed the letter?", hot: false, stakes: "Wren's licence.", state: "The wax smells of the reeve's office." });
    expect(item?.rows.map((r) => r.turn)).toEqual([first.id, second.id, third.id]);
    expect(item?.touched).toBe(third.id);
    expect(t.record(first).items.get(id)?.fields).toEqual({ text: "Who sealed the letter?", hot: true, stakes: "Wren's licence." });
  });

  test("a swipe takes a turn's beat, thread touch and scene summary with it, and showing that swipe again brings them back", async () => {
    const t = await openTable();
    await t.play([
      { part: "scene", item: null, value: { title: "The ferry" } },
      { part: "thread", item: null, value: { text: "Will the ferryman take coin?" } },
    ]);
    const scene = t.record().of("scene")[0]?.id ?? "";
    const thread = t.record().of("thread")[0]?.id ?? "";
    const played = await t.play([
      { part: "beat", item: null, value: { text: "The ferryman bites the coin and pockets it." } },
      { part: "thread", item: thread, value: { state: "He took the coin.", close: true } },
      { part: "scene", item: scene, value: { summary: "Wren crosses on the ferry for one silver.", close: true } },
    ]);
    expect(t.record().of("beat")).toHaveLength(1);

    const again = await t.swipe();
    await t.tie(again, "another reply");
    const after = t.record();
    expect(after.of("beat")).toEqual([]);
    expect(after.items.get(thread)?.fields).toEqual({ text: "Will the ferryman take coin?" });
    expect(after.items.get(thread)?.closedBy).toBeNull();
    expect(after.items.get(scene)?.fields).toEqual({ title: "The ferry" });
    expect(after.items.get(scene)?.closedBy).toBeNull();

    await t.showSwipe(played);
    const back = t.record();
    expect(back.of("beat")).toHaveLength(1);
    expect(back.items.get(scene)?.fields.summary).toBe("Wren crosses on the ferry for one silver.");
    expect(back.items.get(thread)?.closedBy).toBe(played.id);
  });

  test("deleting a turn's messages takes its writes off the path", async () => {
    const t = await openTable();
    await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    await t.play([{ part: "beat", item: null, value: { text: "Wren is robbed on the far bank." } }]);
    expect(t.record().of("beat")).toHaveLength(2);
    await t.remove(2);
    expect(t.record().of("beat").map((b) => b.fields.text)).toEqual(["Wren pays the toll."]);
  });

  test("an open turn sees its own writes; the chat's head sees them once the reply is tied", async () => {
    const t = await openTable();
    await t.play();
    const open = await t.begin();
    await t.write(open, [{ part: "beat", item: null, value: { text: "The lamp gutters." } }]);
    const inside = t.record(open);
    const [beat] = inside.of("beat");
    expect(beat?.fields.text).toBe("The lamp gutters.");
    expect(beat && inside.beatAt(beat)).toBeNull();
    expect(t.record().of("beat")).toEqual([]);
    await t.tie(open);
    const [tied] = t.record().of("beat");
    expect(tied && t.record().beatAt(tied)).toBe(3);
  });

  test("places scenes and chapters from the turns that opened and closed them, each ending before the next begins", async () => {
    const t = await openTable();
    await t.play([
      { part: "chapter", item: null, value: { title: "One" } },
      { part: "scene", item: null, value: { title: "Inn" } },
    ]);
    await t.play();
    const inn = t.record().of("scene")[0]?.id ?? "";
    // The third turn closes the inn and opens the road: the road starts at the player's message it answered.
    await t.play([
      { part: "scene", item: inn, value: { close: true } },
      { part: "scene", item: null, value: { title: "Road" } },
    ]);
    // A past scene placed by the messages it names, closed when written.
    await t.play([{ part: "scene", item: null, value: { title: "Recalled", first: "m0", last: "m1", close: true } }]);
    const record = t.record();
    const spans = record.spans("scene");
    const road = record.of("scene").find((s) => s.fields.title === "Road")?.id ?? "";
    const recalled = record.of("scene").find((s) => s.fields.title === "Recalled")?.id ?? "";
    expect(spans.get(inn)).toEqual({ from: 0, to: 3 });
    expect(spans.get(road)).toEqual({ from: 4, to: 7 });
    expect(spans.get(recalled)).toEqual({ from: 0, to: 1 });
    expect(record.current("scene")?.id).toBe(road);
    expect([...record.spans("chapter").values()]).toEqual([{ from: 0, to: 7 }]);
  });

  test("when the lead drops a sub-agent's writes, that agent's story writes go with them, and the lead's stay", async () => {
    const t = await openTable();
    await t.play([{ part: "thread", item: null, value: { text: "Who sealed the letter?" } }]);
    const thread = t.record().of("thread")[0]?.id ?? "";
    const open = await t.begin();
    await t.write(open, [{ part: "beat", item: null, value: { text: "Wren breaks the seal." } }], "author");
    await t.write(open, [{ part: "beat", item: null, value: { text: "The keeper's beat." } }, { part: "thread", item: thread, value: { state: "Settled by the keeper.", close: true } }], "keeper");
    expect(await t.writes.run(() => t.s.dropStaged(open.id, "keeper-1"))).toBe(2);
    await t.tie(open);

    const head = t.record();
    expect(head.of("beat").map((b) => b.fields.text)).toEqual(["Wren breaks the seal."]);
    expect(head.items.get(thread)?.fields).toEqual({ text: "Who sealed the letter?" });
    expect(head.items.get(thread)?.closedBy).toBeNull();
    // A tied turn has nothing staged: it is refused as the store refuses it.
    await expect(t.writes.run(() => t.s.dropStaged(open.id, "author-1"))).rejects.toBeInstanceOf(StoreInputError);
    expect(t.record().of("beat")).toHaveLength(1);
  });

  test("a continue that saved nothing takes back what it recorded after the mark it began at; a job's writes stay", async () => {
    const t = await openTable();
    const turn = await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    const mark = t.s.changes(turn.id).at(-1)?.ord ?? -1;
    // The continue goes on the same turn; a job the turn started writes on it meanwhile.
    await t.write(turn, [{ part: "beat", item: null, value: { text: "The continue's beat." } }]);
    await t.writes.run(() => writeStory(t.store, { user: USER, chat: CHAT, turn: turn.id, by: "historian", agent: "historian-1", job: "job-1" }, [{ part: "beat", item: null, value: { text: "The job's beat.", message: "m0" } }]));
    await t.write(turn, [{ part: "beat", item: null, value: { text: "Another of the continue's." } }]);

    expect(await t.writes.run(() => t.s.takeBack(turn.id, mark))).toBe(2);
    expect(t.record().of("beat").map((b) => b.fields.text)).toEqual(["Wren pays the toll."]);
    // The job's stay, and take effect before the first turn that begins after the job ended.
    await t.writes.run(() => t.s.endJob("job-1"));
    const next = await t.begin();
    expect(t.record(next).of("beat").map((b) => b.fields.text)).toEqual(["Wren pays the toll.", "The job's beat."]);
  });

  test("a job of his own writes with no turn: only that job reads its writes until it ends, and the assistant's own call is read at once", async () => {
    const t = await openTable();
    await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    const owner = { user: USER, chat: CHAT, turn: null, by: "historian", agent: "historian-1" };
    const at = storyAt(t.s, CHAT, null);
    await t.writes.run(() => writeStory(t.store, { ...owner, job: "job-2" }, [{ part: "thread", item: null, value: { text: "Who sealed the letter?", kind: "question" } }]));
    expect(StoryRecord.read(t.store, USER, at).of("thread")).toEqual([]);
    expect(StoryRecord.read(t.store, USER, at, "job-2").of("thread").map((x) => x.fields.text)).toEqual(["Who sealed the letter?"]);
    await t.writes.run(() => t.s.endJob("job-2"));
    expect(StoryRecord.read(t.store, USER, at).of("thread").map((x) => x.fields.text)).toEqual(["Who sealed the letter?"]);
    await t.writes.run(() => writeStory(t.store, { ...owner, job: null }, [{ part: "canon", item: null, value: { text: "The inn has twelve rooms." } }]));
    expect(StoryRecord.read(t.store, USER, at).of("canon").map((x) => x.fields.text)).toEqual(["The inn has twelve rooms."]);
  });

  test("story changes of a chat that was deleted, or of an import that was forgotten, are removed with it; a chat a branch still shares keeps them", async () => {
    const t = await openTable();
    await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    const rowsOf = (chat: string): number => t.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM change WHERE op LIKE 'story.%' AND turn IN (SELECT id FROM turn WHERE chat = ?)").get(chat)?.n ?? 0;
    const all = (): number => t.db.query<{ n: number }, []>("SELECT count(*) AS n FROM change WHERE op LIKE 'story.%'").get()?.n ?? 0;
    const elsewhere = async (chat: string, imported: boolean): Promise<void> => {
      await t.writes.run(() => {
        t.s.createChat({ id: chat });
        const turn = t.s.beginTurn({ chat, kind: "new", imported });
        writeStory(t.store, { user: USER, chat: CHAT, turn: turn.id, by: "author", agent: "author-1", job: null, source: imported ? "import" : null }, [
          { part: "beat", item: null, value: { text: `A beat in ${chat}.` } },
          { part: "thread", item: null, value: { text: `A thread in ${chat}.` } },
        ]);
      });
      expect(rowsOf(chat)).toBe(2);
    };

    await elsewhere("chat-deleted", false);
    expect(await t.writes.run(() => t.s.deleteChat("chat-deleted"))).toEqual({ kept: false });

    await elsewhere("chat-imported", true);
    expect(await t.writes.run(() => t.s.forgetImport("chat-imported"))).toEqual({ removed: ["chat-imported"], played: [] });
    expect(all()).toBe(1);

    // Deleted while a branch still shares its turns: kept, and so are its story changes, which the branch reads.
    await t.writes.run(() => t.s.branchChat({ id: "chat-branch", from: CHAT, map: Object.fromEntries(t.shown.map((m) => [m.id, `b-${m.id}`])) }));
    expect(await t.writes.run(() => t.s.deleteChat(CHAT))).toEqual({ kept: true });
    expect(rowsOf(CHAT)).toBe(1);
  });
});
