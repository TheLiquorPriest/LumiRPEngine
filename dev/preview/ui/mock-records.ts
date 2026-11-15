// The new pages' routes in the preview: the Cast and Story records, Settle now, the bootstrap, the jobs,
// the builds line with "Update now", and the page's session. Each is answered from the recorded answers
// the pages' tests use (test/ui/records-recorded.ts, test/ui/bootstrap-recorded.ts), in the routes' own
// shapes, with the chat asked for in place of the recording's. Every chat is served the same record; a
// strike, a start, a cancel and an update are kept in memory while the preview runs.
//
// Preview controls (`recordsControl`):
// - `/preview/session?ends=none|soon|later`: whether the web key has no end, ends within the hour, or in
//   ninety days (the default).
// - `/preview/builds?disk=same|newer`: whether the app file on disk is the build RPE runs (newer: the
//   default, so "Update now" is offered).

import type { JobView } from "rp-harness/contract";
import type { BootstrapChatReply, BuildsStatus, CastStrikeAsk, CastStrikeReply, CharacterReply, EntryRow, SettleReply, StoryItemRow, StoryReply, StoryStrikeAsk, StoryStrikeReply } from "../../../src/shared/api";
import { AGREE, BATCH, BOOT, buildsReply, job, NEWER } from "../../../test/ui/bootstrap-recorded";
import { CHAT as PLAYED } from "../../../test/ui/recorded";
import { CAST, ODILE_RECORD, OLDER_BEATS, STORY, TOBIN } from "../../../test/ui/records-recorded";

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const refuse = (status: number, error: string): Response => answer(status, { error });

const record: CharacterReply = structuredClone(ODILE_RECORD);
const story: StoryReply = structuredClone(STORY);
/** The older beats the route gives past the first read's. */
const olderBeats = structuredClone(OLDER_BEATS.timeline.beat);
let builds: BuildsStatus = NEWER;
const DAY = 86_400_000;
let ends: number | null = Date.now() + 90 * DAY;
let jobsMade = 10;
const boot: BootstrapChatReply = structuredClone(BOOT);

/** The user's jobs, newest started first: the recording's bootstrap jobs, and one of the Historian's, all of the chat the preview plays. */
const jobs: JobView[] = [
  job("job-3", "queued", { agent: "historian", brief: "Summarize the chapter that closed.", started: 1_700_000_900_000 }),
  ...boot.jobs.flatMap((j) => (j.view === null ? [] : [j.view])).reverse(),
].map((j) => ({ ...j, scope: { ...j.scope, chat: PLAYED } }));

/** The cast entries of the record, with the counts' kind each is under. */
function castEntries(): { kind: keyof CharacterReply["character"]["counts"]; entry: EntryRow }[] {
  const kinds = ["growth", "mind", "memories", "relationships", "knowledge", "history", "perceptions", "files"] as const;
  return kinds.flatMap((kind) => record[kind].map((entry) => ({ kind, entry })));
}

const inChat = <T extends { chat: string }>(value: T, chat: string): T => ({ ...value, chat });

async function castAnswer(request: Request, chat: string, character: string | undefined, strike: boolean): Promise<Response> {
  if (character === undefined) return request.method === "GET" ? answer(200, { ...CAST, chat, characters: [inChat(record.character, chat), inChat(TOBIN, chat)] }) : refuse(405, "The cast's list takes GET.");
  if (character === TOBIN.id && !strike) return answer(200, { ...structuredClone(ODILE_RECORD), chat, character: inChat(TOBIN, chat), sources: [], base: [], castings: [], mind: [], memories: [], knowledge: [], perceptions: [], files: [] } satisfies CharacterReply);
  if (character !== record.character.id) return refuse(404, `Chat ${chat} knows no character ${character}.`);
  if (!strike) return answer(200, { ...record, chat, character: inChat(record.character, chat) });
  const body = (await request.json().catch(() => null)) as CastStrikeAsk | null;
  const found = castEntries().find((e) => e.entry.id === body?.id);
  if (body === null || found === undefined) return refuse(404, `${record.character.name}'s record has no entry ${body?.id ?? ""}.`);
  const changed = found.entry.struck !== body.struck;
  if (changed) {
    found.entry.struck = body.struck;
    const held = record.character.counts[found.kind];
    const step = body.struck ? 1 : -1;
    record.character.counts = { ...record.character.counts, [found.kind]: { ...held, held: held.held - step, struck: held.struck + step } };
  }
  return answer(200, { changed, entry: found.entry, alsoStruck: [], letGo: [], alsoStood: [], heldAgain: [], notes: [] } satisfies CastStrikeReply);
}

async function storyAnswer(request: Request, url: URL, chat: string, strike: boolean): Promise<Response> {
  if (!strike) {
    const older = url.searchParams.get("part") === "beat" && Number(url.searchParams.get("skip") ?? 0) > 0;
    return answer(200, { ...(older ? { ...story, timeline: { ...story.timeline, beat: olderBeats } } : story), chat });
  }
  const body = (await request.json().catch(() => null)) as StoryStrikeAsk | null;
  const s = story;
  const lists = [s.timeline.chapter, s.timeline.scene, s.timeline.beat, olderBeats, s.model.thread, s.model.arc, s.model.player, s.model.canon, s.model.retcon, s.model.record, s.futures];
  const items: StoryItemRow[] = [...(s.model.premise === null ? [] : [s.model.premise]), ...lists.flatMap((l) => l.items)];
  const item = items.find((i) => i.id === body?.id);
  if (body === null || item === undefined) return refuse(404, `The story record of chat ${chat} has no item ${body?.id ?? ""}.`);
  const changed = item.struck !== body.struck;
  item.struck = body.struck;
  return answer(200, { changed, item } satisfies StoryStrikeReply);
}

async function bootstrapAnswer(request: Request, chat: string): Promise<Response> {
  if (request.method === "GET") return answer(200, { ...boot, chat, jobs: boot.jobs.map((j) => ({ ...j, view: jobs.find((v) => v.id === j.id) ?? j.view })) } satisfies BootstrapChatReply);
  if (jobs.some((j) => j.brief === "the bootstrap skill" && (j.state === "running" || j.state === "queued"))) return refuse(409, "A bootstrap job of this chat is under way.");
  const body = (await request.json().catch(() => ({}))) as { relive?: string };
  const started = job(`job-${++jobsMade}`, "queued", { started: Date.now(), scope: { user: "user-1", chat, session: "s-1" } });
  jobs.unshift(started);
  boot.jobs.push({ id: started.id, relive: body.relive ?? null, tokenLimit: 200_000, view: started });
  return answer(200, started);
}

/** `POST /api/v1/jobs/:job/cancel`: a job queued or running is cancelled; one that ended is given as it ended. */
function cancel(id: string): Response {
  const at = jobs.findIndex((j) => j.id === id);
  const found = jobs[at];
  if (found === undefined) return refuse(404, `There is no job ${id}.`);
  if (found.state !== "queued" && found.state !== "running") return answer(200, { job: found });
  const cancelled: JobView = { ...found, state: "cancelled", ended: Date.now() };
  jobs[at] = cancelled;
  return answer(200, { job: cancelled });
}

/** The stand-in's answer to one of the new pages' routes, or null for a path that is none of them. `running` says whether a run of the chat goes on. */
export function recordsAnswer(request: Request, url: URL, running: (chat: string) => { going: boolean; latest: string | null }): Promise<Response> | Response | null {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/v1/status/session") return method === "GET" ? answer(200, { user: "user-1", ends }) : refuse(405, "The session takes GET.");
  if (path === "/api/v1/status/builds") return method === "GET" ? answer(200, buildsReply(builds)) : refuse(405, "The builds take GET.");
  if (path === "/api/v1/update") {
    if (method !== "POST") return refuse(405, "Update now takes POST.");
    if (builds.disk !== builds.running) builds = { ...builds, restart: "waiting", words: `RPE restarts onto build ${builds.disk} once the turn running ends.` };
    return answer(200, builds);
  }
  if (path === "/api/v1/bootstrap") return method === "POST" ? answer(200, BATCH) : refuse(405, "The bootstrap of many chats takes POST.");
  if (path === "/api/v1/jobs") return method === "GET" ? answer(200, { jobs }) : refuse(405, "The jobs take GET.");
  const cancelled = /^\/api\/v1\/jobs\/([^/]+)\/cancel$/.exec(path);
  if (cancelled !== null) return method === "POST" ? cancel(decodeURIComponent(cancelled[1] as string)) : refuse(405, "Cancel takes POST.");
  const at = /^\/api\/v1\/chats\/([^/]+)\/(cast(?:\/([^/]+)(\/strike)?)?|story(\/strike)?|settle|bootstrap|jobs)$/.exec(path);
  if (at === null) return null;
  const chat = decodeURIComponent(at[1] as string);
  const what = at[2] as string;
  if (what.startsWith("cast")) return castAnswer(request, chat, at[3] === undefined ? undefined : decodeURIComponent(at[3]), at[4] !== undefined);
  if (what.startsWith("story")) return storyAnswer(request, url, chat, at[5] !== undefined);
  if (what === "bootstrap") return bootstrapAnswer(request, chat);
  if (what === "jobs") return answer(200, { jobs: jobs.filter((j) => j.scope.chat === chat) });
  if (method !== "POST") return refuse(405, "Settle now takes POST.");
  const run = running(chat);
  if (run.going) return refuse(409, "A run of this chat is going on: settle it once that ends.");
  if (run.latest === null) return refuse(409, "This chat has no turn of RPE's to settle.");
  return answer(200, { turn: run.latest, run: `${run.latest}.settle` } satisfies SettleReply);
}

/** `/preview/session` and `/preview/builds`, or null for another control. */
export function recordsControl(url: URL): Response | null {
  if (url.pathname === "/preview/session") {
    const to = url.searchParams.get("ends");
    if (to !== "none" && to !== "soon" && to !== "later") return refuse(400, "ends is none, soon or later.");
    ends = to === "none" ? null : Date.now() + (to === "soon" ? 40 * 60_000 : 90 * DAY);
    return answer(200, { ends });
  }
  if (url.pathname === "/preview/builds") {
    const disk = url.searchParams.get("disk");
    if (disk !== "same" && disk !== "newer") return refuse(400, "disk is same or newer.");
    builds = disk === "same" ? AGREE : NEWER;
    return answer(200, builds);
  }
  return null;
}
