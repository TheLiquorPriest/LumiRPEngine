// What LumiRPEngine says to the main agent (INC2-SPEC C14; AGENT-LOOP-PLAN §7, §9: everything sent to
// a model is editable): its system prompt, the turn task it gets each turn with the digest of what
// changed since its last turn and its pinned files, the message each stage of the turn opens with,
// its orchestration tools and what they answer, what a role it runs is told of its task, and its
// session's compaction. Each is a registry text with the shipped default and a reset, on the page
// "Main agent" (Settings → Agents → Prompts).

import type { PromptDef, PromptPage, PromptVar } from "./prompts";

export const MAIN_AGENT_PAGE: PromptPage = {
  id: "main",
  label: "Main agent",
  note: "The agent that runs a chat's turns while Settings → Agents → Pipeline has a main agent decide: its system prompt, the turn task it gets each turn with the digest and its pinned files, each stage's message, its tools and their answers, what a role it runs is told, and how its session is summarized.",
};

/** The stages of a main-agent turn a role works in, in the engine's order (C14): the last turn's memory when it was left to this one, the intent, the scene with the minds and the director's decisions, the beats, the read, and the memory. The engine's own stages (its checks and gates, its plan, the reply) are never sent. */
export const MAIN_ROLE_STAGES = ["memory_before", "intent", "prepare", "beats", "read", "memory"] as const;
export type MainRoleStage = (typeof MAIN_ROLE_STAGES)[number];

/** What the engine may ask of a role in a main-agent turn: each model call of a turn (`TurnCalls`), and the scene. */
export const MAIN_REQUEST_KINDS = ["interpret", "judge", "puzzle", "decisions", "minds", "skipPlan", "skip", "scene", "prose", "extract", "effects", "knowledge", "offscreen", "choices", "memory"] as const;
export type MainRequestKind = (typeof MAIN_REQUEST_KINDS)[number];

/** The main agent's tools, by name. */
export const MAIN_TOOLS = { runRole: "run_role", revise: "revise", commit: "commit", summarize: "summarize" } as const;

/** The main agent's text ids, so code names them once. */
export const MAIN_TEXT = {
  system: "main.system",
  turn: "main.turn",
  digest: "main.digest",
  digestFresh: "main.digest.fresh",
  digestEntry: "main.digest.entry",
  digestLanded: "main.digest.landed",
  digestLeftOut: "main.digest.left_out",
  digestNothing: "main.digest.nothing",
  none: "main.none",
  pins: "main.pins",
  pinsFile: "main.pins.file",
  pinsHeadings: "main.pins.headings",
  stage: "main.stage",
  stageLabel: (stage: MainRoleStage): string => `main.stage.${stage}`,
  enginePrepare: "main.engine.prepare",
  engineBeats: "main.engine.beats",
  engineReply: "main.engine.reply",
  engineRemember: "main.engine.memory_before",
  open: "main.open",
  request: (kind: MainRequestKind): string => `main.request.${kind}`,
  tool: (name: string): string => `main.tool.${name}`,
  toolArg: (name: string, arg: string): string => `main.tool.${name}.${arg}`,
  ran: "main.ran",
  ranFailed: "main.ran.failed",
  viaAgent: "main.via.agent",
  viaPromptOnly: "main.via.prompt_only",
  refusedOrder: "main.refused.order",
  refusedOver: "main.refused.over",
  refusedIdle: "main.refused.idle",
  refusedRole: "main.refused.role",
  refusedRan: "main.refused.ran",
  refusedAgent: "main.refused.agent",
  refusedRevisions: "main.refused.revisions",
  refusedCommitted: "main.refused.committed",
  committed: "main.committed",
  brief: "main.brief",
  briefWithheld: "main.brief.withheld",
  briefRevision: "main.brief.revision",
  historyCall: "main.history.call",
  summary: "main.summary",
  compaction: "main.compaction",
  compactionInput: "main.compaction.input",
  summarized: "main.summarized",
  summarizeNothing: "main.summarize.nothing",
  summarizeAgain: "main.summarize.again",
  summarizeFailed: "main.summarize.failed",
} as const;

const page = MAIN_AGENT_PAGE.id;
const INSTRUCTIONS = "Instructions";
const DIGEST = "Digest";
const PINS = "Pinned files";
const STAGES = "Stages";
const REQUESTS = "What the engine asks";
const TOOLS = "Tools";
const ANSWERS = "Tool answers";
const ROLES = "What a role is told";
const SESSION = "Session";

const v = (name: string, text: string, required?: true): PromptVar => (required ? { name, text, required } : { name, text });

const STAGE_TEXTS: Readonly<Record<MainRoleStage, { label: string; text: string }>> = {
  memory_before: { label: "Stage 8, left to this turn", text: "the last reply's memory, which the last turn left to this one" },
  intent: { label: "Stage 1: the intent", text: "the intent, what the player's message plays" },
  prepare: { label: "Stage 3: scene, minds and decisions", text: "the scene, the minds of the people present and the director's decisions" },
  beats: { label: "Stage 5: the beats", text: "the director's beats for the planned turn" },
  read: { label: "Stage 7: the read", text: "the read of the reply, the knowledge it gives and the suggested choices" },
  memory: { label: "Stage 8: the memory", text: "the minds' memory of the reply" },
};

const REQUEST_TEXTS: Readonly<Record<MainRequestKind, { label: string; text: string }>> = {
  interpret: { label: "The intent: the message's action", text: "read the player's message into the action it plays" },
  judge: { label: "The intent: the approach", text: "rate the approach the player described, for the check the action rolls" },
  puzzle: { label: "The intent: a puzzle's answer", text: "judge how likely the player's answer to the puzzle is right" },
  decisions: { label: "The director: decisions here", text: "give the odds of each choice open to the people present" },
  minds: { label: "The minds", text: "think as each mind the scene calls on" },
  skipPlan: { label: "The skip: its plan", text: "plan the time skip for the people it spans" },
  skip: { label: "The skip: its beats", text: "find the time skip's beats, with the minds at them" },
  scene: { label: "The scene", text: "pick the lore and notes the narrator needs for this scene" },
  prose: { label: "The director: the beats", text: "write the brief and the outline's beats for the planned turn" },
  extract: { label: "The read", text: "read the reply into the changes it makes" },
  effects: { label: "A world step", text: "run the world's own step on the reply" },
  knowledge: { label: "The knowledge", text: "work out what each person present or told learned from the reply" },
  offscreen: { label: "The director: decisions elsewhere", text: "give the odds of each choice open to people elsewhere" },
  choices: { label: "The director: suggested choices", text: "suggest the player's next moves" },
  memory: { label: "The memory", text: "remember the reply for each mind present" },
};

/** Every text the main agent is sent, on its page. */
export const MAIN_AGENT_PROMPTS: readonly PromptDef[] = [
  {
    id: MAIN_TEXT.system,
    page,
    group: INSTRUCTIONS,
    label: "System prompt",
    note: "Who the main agent is, what a turn's stages are, and how it works through them with its tools.",
    text: "You are the main agent for {{world}}, a roleplay world that LumiRPEngine keeps; {{pov}} is the player character. You run this chat's turns behind the scenes, one at a time, and never write the story yourself: a narrator writes each reply, the engine plans each turn, rolls its checks from the turn's seed and keeps the world's state, and role agents do the work you give them.\n\nEach turn, the engine opens its stages in a fixed order: 1, the intent, what the player's message plays; 2, the engine's checks and gates; 3, the scene, the minds of the people present and the director's decisions; 4, the engine's plan; 5, the director's beats; 6, the narrator's reply; 7, the read of the reply, the knowledge it gives and the suggested choices; 8, the minds' memory. At each stage you work in, it says what it asks of the roles. Run the roles you want with run_role, each with a short, concrete task; when a run's answer needs another try, send it a revise message; then call commit, which hands the engine what you have and ends the stage. A request you don't run goes on without its role. A role that fails is yours to decide on: revise it, run it again prompt-only, or go on without it. The engine refuses a role out of its stage.\n\nYour session keeps your earlier turns. Each turn's task says what changed since your last one and gives you your pinned files. The engine's messages and your tools show you what your knowledge lets you see: never guess at what they don't show.",
    vars: [v("world", "the world's name"), v("pov", "the player character's name")],
  },
  {
    id: MAIN_TEXT.turn,
    page,
    group: INSTRUCTIONS,
    label: "Turn task",
    note: "What the main agent gets as a turn starts, before its first stage: the digest, its pinned files and the player's message.",
    text: "A new turn.\n\n{{digest}}\n\n{{pins}}\n\nThe player's message:\n{{message}}",
    vars: [v("message", "the player's message this turn answers", true), v("digest", "what changed since the main agent's last turn, framed below"), v("pins", "its pinned files, framed below; nothing when it has none")],
  },
  {
    id: MAIN_TEXT.stage,
    page,
    group: STAGES,
    label: "A stage opens",
    note: "Each stage the main agent works in starts with this message: what the engine did since the last one, and what it asks of the roles now.",
    text: "Stage {{number}} of 8: {{stage}}.\n{{engine}}\nWhat the engine asks of the roles now:\n{{open}}\nRun the roles you want with run_role, revise a run with revise if its answer needs it, then call commit.",
    vars: [v("number", "the stage's number in the turn's order"), v("stage", "the stage's words below"), v("engine", "what the engine did since the main agent's last stage, when there is something to say"), v("open", "each request of this stage, one line each", true)],
  },
  ...Object.entries(STAGE_TEXTS).map(([stage, t]): PromptDef => ({ id: MAIN_TEXT.stageLabel(stage as MainRoleStage), page, group: STAGES, label: t.label, note: "Fills {{stage}} in the stage's message.", text: t.text, vars: [] })),
  { id: MAIN_TEXT.enginePrepare, page, group: STAGES, label: "What the engine did: the checks", note: "Leads stage 3's message: the engine's checks and gates let the turn play, and the action it plays.", text: "The engine checked the turn and let it play. It plays: {{intent}}", vars: [v("intent", "the action the turn plays, with its parameters, or none")] },
  { id: MAIN_TEXT.engineBeats, page, group: STAGES, label: "What the engine did: the plan", note: "Leads stage 5's message: what the engine planned, as the narrator is told it.", text: "The engine planned the turn:\n{{lines}}", vars: [v("lines", "the plan's outcome, montage and beat lines; their count only where the main agent's knowledge doesn't reach them", true)] },
  { id: MAIN_TEXT.engineReply, page, group: STAGES, label: "What the engine did: the reply", note: "Leads stage 7's message, and ends a turn's session with the reply when no stage showed it.", text: "The narrator's reply:\n{{reply}}", vars: [v("reply", "the reply as written", true)] },
  { id: MAIN_TEXT.engineRemember, page, group: STAGES, label: "What the minds remember", note: "Leads the message of the memory the last turn left to this one: the reply they remember.", text: "The last reply, which the minds remember now:\n{{reply}}", vars: [v("reply", "the last reply as written", true)] },
  { id: MAIN_TEXT.open, page, group: REQUESTS, label: "A request", note: "One line of a stage's message per request: the role, as run_role takes it, and what the engine asks of it.", text: "- {{role}}: {{what}}", vars: [v("role", "the role's id", true), v("what", "what the engine asks, in the words below")] },
  ...Object.entries(REQUEST_TEXTS).map(([kind, t]): PromptDef => ({ id: MAIN_TEXT.request(kind as MainRequestKind), page, group: REQUESTS, label: t.label, note: "Fills {{what}} in a request's line.", text: t.text, vars: [] })),
  { id: MAIN_TEXT.digest, page, group: DIGEST, label: "Since the last turn", note: "Frames the digest in the turn task: what changed since the main agent's last turn, oldest first.", text: "What happened in this chat since your last turn, oldest first:\n{{turns}}", vars: [v("turns", "each reply since, as below", true)] },
  { id: MAIN_TEXT.digestFresh, page, group: DIGEST, label: "A fresh session", note: "Frames the digest when the main agent has no session in the chat yet, as when a chat switches from classic: the chat so far.", text: "You take this chat up now, with no session of your own in it yet. The chat so far, oldest first:\n{{turns}}", vars: [v("turns", "each reply so far, as below", true)] },
  { id: MAIN_TEXT.digestEntry, page, group: DIGEST, label: "A reply", note: "One reply of the digest: the player's message, what changed as the player saw it, and the reply.", text: "Reply {{n}}. The player: {{said}}\nWhat changed: {{changed}}\nThe reply: {{reply}}", vars: [v("n", "the reply's number in the chat"), v("said", "the player's message before it"), v("changed", "what changed, as the player's Journal says it"), v("reply", "the reply as written")] },
  { id: MAIN_TEXT.digestLanded, page, group: DIGEST, label: "The last turn's changes", note: "Leads the digest with what landed of the main agent's own last turn once its reply was read.", text: "What landed of your last turn: {{changed}}", vars: [v("changed", "what changed, as the player's Journal says it", true)] },
  { id: MAIN_TEXT.digestLeftOut, page, group: DIGEST, label: "Earlier replies left out", note: "Heads the digest when it runs past its tokens (Settings → Agents → Main agent): how many earlier replies aren't in it.", text: "({{count}} earlier {{replies}} left out.)", vars: [v("count", "how many replies the digest leaves out", true), v("replies", '"reply" for 1, else "replies"')] },
  { id: MAIN_TEXT.digestNothing, page, group: DIGEST, label: "Nothing changed", note: "The digest when nothing happened since the main agent's last turn.", text: "Nothing changed since your last turn.", vars: [] },
  { id: MAIN_TEXT.none, page, group: DIGEST, label: "Nothing", note: "Stands in for a part that is empty: no message, no change, no answer.", text: "(none)", vars: [] },
  { id: MAIN_TEXT.pins, page, group: PINS, label: "Pinned files", note: "Frames the main agent's pinned files in the turn task: those .pins.json lists for it, and those pinned in GM → Workspace, within its pins budget.", text: "Your pinned files (at most {{tokens}} {{unit}} of them; a file past that comes as its headings, and workspace_read reads it whole):\n{{files}}", vars: [v("tokens", "the pins budget: the manifest's for the main agent, else Settings → Agents → Main agent"), v("unit", '"token" for 1, else "tokens"'), v("files", "each file, as below", true)] },
  { id: MAIN_TEXT.pinsFile, page, group: PINS, label: "A pinned file", note: "One pinned file, whole.", text: "[{{path}}]\n{{text}}", vars: [v("path", "the file's path", true), v("text", "the file's text", true)] },
  { id: MAIN_TEXT.pinsHeadings, page, group: PINS, label: "A file past the budget", note: "A pinned file past the pins budget: its headings only.", text: "[{{path}}: its headings]\n{{headings}}", vars: [v("path", "the file's path", true), v("headings", "the file's heading lines, or none")] },
  { id: MAIN_TEXT.tool(MAIN_TOOLS.runRole), page, group: TOOLS, label: "run_role: what it does", note: "The description of the run_role tool.", text: "Run a role on what the engine asks of it in this stage, with your task for it. Each request of the role gets a run with an agent id, which revise takes. A role this stage doesn't ask for is refused.", vars: [] },
  { id: MAIN_TEXT.toolArg(MAIN_TOOLS.runRole, "role"), page, group: TOOLS, label: "run_role: role", note: "The description of run_role's role argument.", text: "The role to run, as the stage lists it.", vars: [] },
  { id: MAIN_TEXT.toolArg(MAIN_TOOLS.runRole, "task"), page, group: TOOLS, label: "run_role: task", note: "The description of run_role's task argument.", text: "Your task for the run: what to do or to watch for, in a few concrete sentences.", vars: [] },
  { id: MAIN_TEXT.toolArg(MAIN_TOOLS.runRole, "prompt_only"), page, group: TOOLS, label: "run_role: prompt_only", note: "The description of run_role's prompt_only argument.", text: "Run it as one call with its classic contract and no tools: the way to try a role again whose run failed.", vars: [] },
  { id: MAIN_TEXT.tool(MAIN_TOOLS.revise), page, group: TOOLS, label: "revise: what it does", note: "The description of the revise tool.", text: "Send one of this stage's runs a revision: it runs again with your task and your message, and its new answer stands for the old. A run takes as many revisions as its role's budget allows.", vars: [] },
  { id: MAIN_TEXT.toolArg(MAIN_TOOLS.revise, "agentId"), page, group: TOOLS, label: "revise: agentId", note: "The description of revise's agentId argument.", text: "The run's agent id, as run_role gave it.", vars: [] },
  { id: MAIN_TEXT.toolArg(MAIN_TOOLS.revise, "message"), page, group: TOOLS, label: "revise: message", note: "The description of revise's message argument.", text: "What to change in the answer, and why.", vars: [] },
  { id: MAIN_TEXT.tool(MAIN_TOOLS.commit), page, group: TOOLS, label: "commit: what it does", note: "The description of the commit tool.", text: "Hand the engine what this stage's runs answered, and end the stage. A request you didn't run goes on without its role.", vars: [] },
  { id: MAIN_TEXT.tool(MAIN_TOOLS.summarize), page, group: TOOLS, label: "summarize: what it does", note: "The description of the summarize tool, offered while Settings → Agents → Compaction has it on.", text: "Summarize your session now: everything but your latest turns becomes one summary, which your next stages read instead. Use it when your session runs long.", vars: [] },
  { id: MAIN_TEXT.ran, page, group: ANSWERS, label: "A run answered", note: "run_role's and revise's answer for a run that answered: its agent id, its role, how it ran and its answer, as far as the main agent's knowledge reaches.", text: "{{agent}}: the {{role}} role answered ({{via}}): {{answer}}", vars: [v("agent", "the run's agent id", true), v("role", "the role"), v("via", "how it ran, in the words below"), v("answer", "its answer", true)] },
  { id: MAIN_TEXT.ranFailed, page, group: ANSWERS, label: "A run failed", note: "run_role's and revise's answer for a run that failed.", text: "{{agent}}: the {{role}} role failed ({{via}}): {{reason}}. Revise it, run it again prompt-only, or go on without it.", vars: [v("agent", "the run's agent id", true), v("role", "the role"), v("via", "how it ran, in the words below"), v("reason", "why it failed")] },
  { id: MAIN_TEXT.viaAgent, page, group: ANSWERS, label: "Ran as an agent", note: "Fills {{via}}: the role ran as an agent with its tools.", text: "an agent with tools", vars: [] },
  { id: MAIN_TEXT.viaPromptOnly, page, group: ANSWERS, label: "Ran prompt-only", note: "Fills {{via}}: the role ran as one call with its classic contract.", text: "one call, prompt only", vars: [] },
  { id: MAIN_TEXT.refusedOrder, page, group: ANSWERS, label: "Out of order", note: "run_role's answer for a role whose work comes at a later stage.", text: "Out of order: the {{role}} role works at stage {{number}}, {{stage}}. The engine keeps the turn's order, so run it once that stage opens.", vars: [v("role", "the role asked for"), v("number", "the number of the role's next stage"), v("stage", "that stage's words")] },
  { id: MAIN_TEXT.refusedOver, page, group: ANSWERS, label: "Its stage is over", note: "run_role's answer for a role whose stages this turn are over.", text: "The {{role}} role's stage is over this turn: what it answered is the engine's now.", vars: [v("role", "the role asked for")] },
  { id: MAIN_TEXT.refusedIdle, page, group: ANSWERS, label: "Nothing asked of it", note: "run_role's answer for a role the stage asks nothing of.", text: "The engine asks nothing of the {{role}} role in this stage.", vars: [v("role", "the role asked for")] },
  { id: MAIN_TEXT.refusedRole, page, group: ANSWERS, label: "No such role", note: "run_role's answer for a role that doesn't exist.", text: "There is no role called {{role}}. The roles are {{roles}}.", vars: [v("role", "the name given"), v("roles", "every role's id")] },
  { id: MAIN_TEXT.refusedRan, page, group: ANSWERS, label: "It ran already", note: "run_role's answer for a role whose runs this stage answered: a revision changes an answer.", text: "The {{role}} role has run in this stage: revise its run ({{agents}}) to change its answer.", vars: [v("role", "the role asked for"), v("agents", "its runs' agent ids")] },
  { id: MAIN_TEXT.refusedAgent, page, group: ANSWERS, label: "No such run", note: "revise's answer for an agent id no run of this stage has.", text: "No run of this stage has the agent id {{agent}}. Its runs are {{agents}}.", vars: [v("agent", "the id given"), v("agents", "the stage's runs' agent ids, or none")] },
  { id: MAIN_TEXT.refusedRevisions, page, group: ANSWERS, label: "No revisions left", note: "revise's answer once a run has had the revisions its role's budget allows (Settings → Agents → Budgets).", text: "{{agent}} has had the {{limit}} {{revisions}} its role allows; its last answer stands.", vars: [v("agent", "the run's agent id"), v("limit", "the revisions its role allows"), v("revisions", '"revision" for 1, else "revisions"')] },
  { id: MAIN_TEXT.refusedCommitted, page, group: ANSWERS, label: "The stage is committed", note: "The answer to a call after commit in the same stage.", text: "This stage is committed. The engine goes on, and opens the next stage when it gets there.", vars: [] },
  { id: MAIN_TEXT.committed, page, group: ANSWERS, label: "Committed", note: "commit's answer: what the engine takes, and what it goes on without.", text: "Committed. The engine takes: {{ran}}. It goes on without: {{skipped}}.", vars: [v("ran", "the roles whose answers it takes"), v("skipped", "the requests no run answered")] },
  { id: MAIN_TEXT.brief, page, group: ROLES, label: "The main agent's task", note: "What a role run by the main agent is told of its task, after its own instructions. A prompt-only run is sent its classic prompt alone.", text: "The main agent's task for you this turn:\n{{task}}", vars: [v("task", "the task run_role gave", true)] },
  { id: MAIN_TEXT.briefRevision, page, group: ROLES, label: "A revision", note: "Follows the task for each revision the main agent sent the run, oldest first.", text: "The main agent asks you to revise your answer:\n{{message}}", vars: [v("message", "the revision's message", true)] },
  { id: MAIN_TEXT.briefWithheld, page, group: ANSWERS, label: "Part of a task kept back", note: "Follows a run's answer when a line of the main agent's task or revision wasn't sent to a role that reads with the player character's knowledge or a mind's own: it named a secret, or someone or something hidden from the player character.", text: "A line of your task wasn't sent to the {{role}} role: it named what that role's knowledge doesn't reach.", vars: [v("role", "the role")] },
  { id: MAIN_TEXT.historyCall, page, group: SESSION, label: "A tool call, kept", note: "How the main agent's session keeps each tool call it made in a stage, for its later stages and turns.", text: "[{{tool}} {{args}}]\n{{result}}", vars: [v("tool", "the tool's name", true), v("args", "its arguments"), v("result", "what it answered")] },
  { id: MAIN_TEXT.summary, page, group: SESSION, label: "The summary", note: "Opens the main agent's session once it was summarized: the summary stands for the turns it replaced.", text: "Your session before this point, summarized:\n{{summary}}", vars: [v("summary", "the summary", true)] },
  { id: MAIN_TEXT.compaction, page, group: SESSION, label: "Compaction instructions", note: "The instructions of the call that summarizes the main session once it passes Compact the session past (Settings → Agents → Compaction), or when the main agent asks with summarize.", text: "You keep a main agent's session short. You get the summary so far, if there is one, and the turns that now fold into it. Write one summary the main agent can keep working from: who and what matters, what each turn played and what changed, the threads still open, and anything the main agent noted for itself. Keep names, numbers and facts exactly as they are, and leave out what no later turn needs. The latest {{keep}} turns stay whole after your summary, so don't repeat them. Answer with the summary alone.", vars: [v("keep", "how many of the latest turns stay whole (Recent turns kept whole)")] },
  { id: MAIN_TEXT.compactionInput, page, group: SESSION, label: "What it summarizes", note: "The compaction call's message: the summary so far and the turns to fold into it.", text: "The summary so far:\n{{summary}}\n\nThe turns to fold into it, oldest first:\n{{turns}}", vars: [v("summary", "the summary so far, or the text for nothing"), v("turns", "the turns to summarize, each message in order", true)] },
  { id: MAIN_TEXT.summarized, page, group: SESSION, label: "summarize: done", note: "summarize's answer once the session is summarized.", text: "Your session is summarized: {{folded}} turns folded into the summary, the latest {{kept}} kept whole. From your next stage on, you read:\n{{summary}}", vars: [v("summary", "the summary", true), v("folded", "how many turns it holds"), v("kept", "how many stay whole")] },
  { id: MAIN_TEXT.summarizeNothing, page, group: SESSION, label: "summarize: nothing to do", note: "summarize's answer when the session is no longer than the turns kept whole.", text: "There is nothing to summarize: your session holds {{turns}} turns, and the latest {{keep}} stay whole.", vars: [v("turns", "the turns the session holds"), v("keep", "how many stay whole")] },
  { id: MAIN_TEXT.summarizeAgain, page, group: SESSION, label: "summarize: once a turn", note: "summarize's answer to a second call in one turn.", text: "Your session was summarized this turn already.", vars: [] },
  { id: MAIN_TEXT.summarizeFailed, page, group: SESSION, label: "summarize: it failed", note: "summarize's answer when the summarizing call failed.", text: "The summary wasn't made ({{reason}}). Your session stays as it is.", vars: [v("reason", "why")] },
];
