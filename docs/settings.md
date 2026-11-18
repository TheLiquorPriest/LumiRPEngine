# Settings

Every setting RPE and its harness read, with its default, where you change it, when a change to it takes effect, and what it does. This page is written from RPE's one list of settings (`bun scripts/settings/generate.ts`), and a test holds it to that list: a setting added, removed or given another default fails the test until the page is written again. A setting marked "beyond Appendix D.1" is a value the plan's Appendix D.1 does not give: it is listed for the owner's approval.

## Where settings are written

Settings are written in YAML, in config files under `files/` in RPE's data folder:

- `files/defaults/RPE-global.yml`: the shipped copy. Read-only.
- `files/RPE-global.yml`: yours, for every chat.
- `RPE.yml` in a chat's folder: for that chat alone, where a setting's row says it is read there.

They are read in that order, and the nearer file wins, key by key. A dotted key is written as nested keys: `history.window` is

```yaml
history:
  window: 40
```

A value a setting does not take is passed over, with a line in RPE's log naming the file, and the default holds. A bad value never stops a turn. Where a setting allows it, `~` means none: a limit lifted, a window that keeps every message.

Each row says when a change is in force: at the setting's next use, from the next turn, or from RPE's next start. The Settings page lists every setting with its value, its default and the file it comes from, and writes one key into a file at a level, keeping your comments.

**Per connection, per agent.** A key with `<connection>` in it is set for one model connection at a time, named by its name or its id; one with `<definition>`, for one agent definition, named by its name. The Settings page shows each as a table, a row for each connection or agent.

**No hard cap.** A setting takes any value that has a meaning. Past what is usual, its row says what such a value does, and the value is taken.

## Agents

What each agent thinks at and may spend, its tools, and how its sessions are kept and compacted.

### Effort and limits, for each agent

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `agents.<definition>.effort` | none (its connection's) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Effort: How hard this agent's model reasons, in place of its definition's effort: off to max; a level its model does not have is the nearest it has. |
| `agents.<definition>.limits.calls` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls: Model calls this agent may make in one stretch of its work; past it its work ends at this limit. Below 1: At 0 this agent makes no call: its work ends as it starts. |
| `agents.<definition>.limits.tokensIn` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens sent: Tokens this agent's calls may send in one stretch of its work. Below 1: At 0 no call of this agent can be sent. |
| `agents.<definition>.limits.tokensOut` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens written: Tokens this agent's model may write in one stretch of its work. Below 1: At 0 this agent's model can write nothing. |
| `agents.<definition>.limits.seconds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time: Seconds one stretch of this agent's work may take. Below 1: At 0 this agent's work ends as it starts. |
| `agents.<definition>.limits.callTokensIn` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens sent in a call: Tokens one call of this agent may send, as estimated before it is sent. Below 1: At 0 no call of this agent can be sent. |
| `agents.<definition>.limits.callTokensOut` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens written in a call: Tokens the answer to one call of this agent may take. Below 1: At 0 no answer of this agent can be written. |
| `agents.<definition>.limits.callSeconds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time for a call: Seconds one call of this agent may take, apart from the wait on a silent answer. Below 1: At 0 every call of this agent ends as it starts. |
| `agents.<definition>.limits.toolRounds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool rounds: Answers of this agent that call tools, in one stretch of its work. Below 1: At 0 this agent's work ends at its first answer that calls a tool. |
| `agents.<definition>.limits.toolsPerAnswer` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool calls in an answer: Tool calls one answer of this agent may make; the calls past it are answered and not run. Below 1: At 0 no tool call of this agent is run. |
| `agents.<definition>.limits.toolsAtOnce` | none (as limits.toolsAtOnce says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool calls at once: This agent's tool calls of one answer that run at the same time; one more waits for a place. |
| `agents.<definition>.limits.messages` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Messages after its first answer: Messages this agent may be sent after its first answer, as a sub-agent; one past it is answered and the agent is not run. |

### Sampling, for each agent

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `agents.<definition>.sampling.temperature` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Temperature: The temperature every call of this agent is made with; unset, its provider's own. Above 2: Most providers take a temperature of at most 2; one that takes less refuses the call. |
| `agents.<definition>.sampling.topP` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Top P: The top P every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `agents.<definition>.sampling.topK` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Top K: The top K every call of this agent is made with, where its provider takes one; unset, its provider's own. |
| `agents.<definition>.sampling.frequencyPenalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Frequency penalty: The frequency penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. Below -2: Most providers take a frequency penalty from -2 to 2; one that takes less refuses the call. Above 2: Most providers take a frequency penalty from -2 to 2; one that takes less refuses the call. |
| `agents.<definition>.sampling.presencePenalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Presence penalty: The presence penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. Below -2: Most providers take a presence penalty from -2 to 2; one that takes less refuses the call. Above 2: Most providers take a presence penalty from -2 to 2; one that takes less refuses the call. |
| `agents.<definition>.sampling.repetitionPenalty` | none (the provider's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Repetition penalty: The repetition penalty every call of this agent is made with, where its provider takes one; unset, its provider's own. |

### Limits on a turn's work

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `limits.turn.calls` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Calls in a turn across all agents | Calls in a turn: Model calls all the agents of one turn may make between them. Below 1: At 0 no call is made, and the turn ends with no reply. |
| `limits.turn.tokensIn` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens sent in a turn: Tokens sent to models across all the agents of one turn. Below 1: At 0 no call can be sent, and the turn ends with no reply. |
| `limits.turn.tokensOut` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens written in a turn: Tokens models write across all the agents of one turn. Below 1: At 0 no answer can be written, and the turn ends with no reply. |
| `limits.turn.seconds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time for a turn: Seconds one turn may take, all its agents' work included. Below 1: At 0 the turn ends as it starts, with no reply. |
| `limits.turn.toolRounds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool rounds in a turn: Answers that call tools, across all the agents of one turn; past it the turn's work ends at this limit. Below 1: At 0 the turn's work ends at its first answer that calls a tool. |
| `limits.turn.depth` | `2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agent depth: How deep sub-agents may go: at 1 only the lead starts them, at 2 they may start their own, at 0 none is started. |
| `limits.turn.agents` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agents in a turn: Sub-agents one turn may start in all. |
| `limits.turn.agentsAtOnce` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sub-agents at once: Sub-agents of one run at work at the same time; one more waits for a place, first come first served. |
| `limits.toolsAtOnce` | `4` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tool calls at once: An answer's tool calls that run at the same time, for an agent whose definition sets none of its own; one more waits for a place. |
| `limits.repeats` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Same call in a row: The same tool call with the same arguments this many times in a row, with nothing written by any agent between, ends that agent's work at this limit. Below 2: At 1 an agent's work ends at its first tool call. |
| `limits.cachedWeight` | `0.1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weight of a cached token: What a token read again from a provider's cache counts for against every limit on tokens sent: an agent's, a turn's, a job's and a day's; 1 counts it in full. Above 1: Above 1 a token read again from the cache counts for more than one sent anew. |
| `limits.day.tokens` | none (no limit) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens in a day: Tokens, sent and written, that all your agents may spend over any 24 hours, turns and jobs alike; past it no call is made. Below 1: At 0 no call is made at all. |
| `limits.minAnswerTokens` | `256` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Least room for an answer: Tokens an answer must have left at least, across every limit on tokens written; with less, no call is made and the work ends at the limit. |
| `limits.previousRunSeconds` | none (until it ends) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Wait for the previous turn's run | Wait for the previous run: Seconds a turn waits for the run of the turn before it; then that run is stopped. None: it waits until that run ends. |

### Compaction

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `compaction.reserveTokens` | `16384` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Compaction starts | Room kept for the answer: Tokens kept free for the answer: a run is compacted when any call of any agent would not fit its model's window less this. |
| `compaction.keepTurns` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Compaction starts | Turns kept whole: The newest of a session's earlier turns that a summary never stands for. |
| `compaction.recordsTokens` | `6000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Carried records before folding (records mode) | Records before folding: Tokens of records the records mode carries before a compaction folds them into the summary. |
| `compaction.saveCalls` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls before a compaction: Model calls the lead makes at the moment before a compaction; the tools of the last of them run, and nothing after them. |
| `compaction.overflowTries` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tries after a too-long refusal: Times in a row a call the provider refused as too long is compacted and sent again; past them the run ends as the provider answered. |
| `compaction.keepRecentTokens` | `20000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Newest work kept whole: Tokens of a run's newest calls and results kept as they are when its own older calls are summarized. |

### Sessions

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `sessions.carried` | `["scratch/scene.md"]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Scratch files a scene keeps: Files of a turn's scratch/ the session's cache keeps as they stand: each turn starts with the newest on its path, and its own version becomes the standing one at its end. Empty: nothing is carried. |
| `sessions.held` | `8` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sessions kept read: Sessions whose file stays read in memory between their turns, so a turn starts without reading it again; past this many, the one used least recently is let go and read whole when next asked for. |
| `sessions.page` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sessions a page: Sessions listed in one page of the Sessions page when it asks for no number. |
| `sessions.carry` | `continuing` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: How context is carried in a session | Context carried in a session: What a session carries between turns: continuing, records or nothing. |

### Tools

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `results.clipChars` | none (no ceiling) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length of a tool's answer: The most characters of a tool's answer, its reports with it, that the model reads, where you set one; without it an answer is cut only where it would not fit the call. The whole answer is kept in a file. |
| `tools.search` | `8` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tools a search gives: Tools one tool_search gives when the agent asks for no number. |
| `tools.gap.hits` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Hits a gap check takes: Hits gap_check takes from each place it searches when the agent asks for no number. |
| `tools.perCall` | `100` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | The most one tool call takes: Messages chat_read gives, entries lore_read reads, hits a search asks each place for, and messages a stretch of the chat an agent is given holds. |
| `tools.schemaShownChars` | `600` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Schema shown with a call that does not fit: Characters of a tool's schema shown whole in the answer to a call that does not fit it; a longer schema is left out of that answer. |
| `tools.fixedTokens` | `8000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Size of an agent's tool list: Tokens an agent's fixed list of tools, as its requests carry it, should stay under; a list over it is marked in the live view and on the Turn page, and still runs. |
| `tools.commandTimeoutSeconds` | `30` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time a command tool may take: Seconds one of your command tools may run when its manifest names no timeout; past them it is stopped and the agent is told. |
| `tools.httpTimeoutSeconds` | `30` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time an HTTP tool may take: Seconds one of your HTTP tools may wait for its address's answer when its manifest names no timeout; past them the call is given up and the agent is told. |
| `tools.maxAnswerBytes` | `1048576` bytes | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | The most read of a tool's answer: Bytes read of what a command tool, an HTTP tool or an MCP server answers; past them the answer is cut and the agent is told. |
| `tools.gap.snippetChars` | `240` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Gap check hit length: The most characters of a gap check's hit in the world state or the story record that the agent reads and the evidence keeps. |

### MCP servers

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `mcp.startTimeoutSeconds` | `30` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time an MCP server may take to start: Seconds one of your MCP servers may take to start, or to answer at its address, and list its tools; past them it is stopped and its tools are not offered this time. |
| `mcp.callTimeoutSeconds` | `60` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time an MCP tool may take: Seconds one call of an MCP server's tool may take; past them the call is given up and the agent is told. |

### Hooks

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `hooks.timeoutSeconds` | `30` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time a hook may take: Seconds one of your hooks may take where hooks.yml names no timeout of its own; past them it is stopped, blocks nothing, and is shown as timed out. |
| `hooks.blockExit` | `2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Exit code that blocks: The exit code with which a hook blocks, its error output as the reason; any other failing code blocks nothing and is shown as failed. |
| `hooks.maxAnswerBytes` | `1048576` bytes | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Most of a hook's answer read: Bytes read of what a hook answers; an answer past them is cut, blocks nothing, and is shown as failed. |
| `hooks.reasonChars` | `2000` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Most of a hook's reason kept: Characters of a hook's error output kept as its reason or as why it failed; the last of them are kept. |

### Rules

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `rules.windowChars` | none (the whole text) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | What a pattern looks at: Characters a rule's pattern looks at at a time, the newest of what is written and stretches of a tool's arguments or result; none: the whole text. |
| `rules.patternMs` | `50` ms | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time a rule's pattern may run: Milliseconds one rule's pattern may run on one text; past it the run is stopped, counts as no match, and is shown on the Turn page. |
| `rules.interrupt` | `stop` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | A stream rule that interrupts: What a stream rule that interrupts does: stop the call where it matched, or remind the agent after it instead. |
| `rules.judge` | none (the Author's connection) | RPE-global.yml | from the next turn | Appendix D.1: The model that answers a `question:` rule | Connection that judges questions: The connection that answers a rule's question, by its name or id, where the rule names none. |
| `rules.commandTimeoutSeconds` | `10` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time a rule's command may take: Seconds a rule's command may take to answer yes or no; past them it is stopped and the rule is shown as unable to work, never as a no. |

### Usage

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `usage.keptRuns` | `1000` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Runs whose usage is kept: Finished runs whose calls and tokens can still be asked for, a restart between; past it the oldest goes. |

## Turns and replies

What a turn reads and tells the Author, how the reply is written and shown, and what is kept of a turn.

### The turn

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `turn.lead` | none (the asking agent's own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | The Author: The definition that leads the chat's turns, the Author: in a job, its connection judges a rule's question where neither the rule nor rules.judge names one. |
| `turn.passConnection` | none (the default connection) | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Connection for requests with no tag: The connection a request with no tag is passed on to. |
| `turn.maxRequestChars` | `2000` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Longest request: The most characters a request beside his words may hold (what was pressed and on what, or a composer control's choice and words); one past it is not kept, and the answer says so. |

### The chat's history

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `history.hiddenReadable` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hidden messages readable by agents | Hidden messages readable: Agents may read the messages the player hid from the prompt. |
| `history.window` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: History window | History window: The latest this many of the chat's messages stay in the prompt. |
| `history.step` | none (off) | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The window's step | Window step: Lets the window grow by this many messages before it is cut back to its size. |
| `history.hold.on` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold uncovered messages: Keeps a message the story record does not cover yet in the prompt. |
| `history.hold.maxMessages` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Hold a message in the prompt until the record covers it | Hold's most: The most messages the hold keeps past the window. |

### What the briefing tells of changes

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `briefing.editedTokens` | none (every one in full) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Edited replies in the briefing: Off as shipped, every edited reply is told with both its texts whole. Set, the tokens the briefing spends on replies edited after their turns, told in full, the newest first; the rest are named by message in one line, with no text. |
| `briefing.deletedTokens` | `1000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Deleted turns in the briefing: The tokens the briefing spends naming the turns a delete took with the first words of each one's reply, the newest first; the rest are named by message number in one line. |
| `briefing.deletedWords` | `24` words | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Words quoted of a deleted turn: How many of the first words of each deleted turn's reply the briefing quotes to name it. |
| `briefing.notAppliedTokens` | `1500` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | What a flip stopped, in the briefing: The tokens the briefing spends listing, change by change, what no longer applies after an earlier reply was flipped to another swipe; past them the rest are counted, and the world state lists them. |
| `briefing.jobTokens` | `1500` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | What a finished job changed, in the briefing: The tokens the briefing spends on each finished job's changes, thing by thing, with why one did not take effect; past them the rest are counted, and the Jobs page lists them all. |

### The reply

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `reply.form` | `tags` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: How a connection marks its reply | Reply form: How a connection marks its reply: with tags, or in two steps for a connection that does not keep them. |
| `reply.check.turns` | `30` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Turns a tag check plays: Simple turns a tag check plays on a connection to see whether it keeps the reply's tags. |
| `reply.check.kept` | `28` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Turns that must keep the tags: Turns of a tag check that must come back with the reply and the intent record in their tags for the connection to be given the tag form; fewer give it the two-step form. |
| `reply.streamAnyway` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Two-step connections that stream: Two-step connections whose replies are shown as they are written, not when their message ends. |
| `reply.heldSentences` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Reply held back when a rule that interrupts covers it | Sentences held back: Sentences the reply is held back by while a rule that interrupts covers it. |
| `reply.tailSentences` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Sentences shown again to an agent that goes on after a rule stopped it | Sentences shown again: Sentences of what was already shown that go with the line an agent goes on under after a rule stopped it. |
| `reply.leadSampling` | `own` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The Author's sampling | The lead's sampling: Whether the lead samples as its own model does, or as the chat's preset says. |
| `progress.show` | `all` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Progress lines: All the progress lines in the chat's thinking block, or the least: only the line that keeps a silent turn alive. |
| `progress.silenceSeconds` | `60` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Thinking block in the chat | Silence before a progress line: Seconds of nothing shown before a progress line goes to the chat's thinking block. Above 540: Lumiverse ends a generation that has shown nothing for ten minutes: past nine, a silent turn may be cut off before its progress line comes. |
| `reply.lastText` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: When the Author ends with no reply | Last text as the reply: A turn that ends with no reply sends the Author's last plain text in place of the error line. |

### Write permissions

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `permissions.story` | `auto` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Write permission, the story lane: What the agents' writes to the story record do: go ahead (auto), wait for his word on the turn's card (confirm), or are left out (never). |
| `permissions.engine` | `auto` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Write permission, the engine lane: What the agents' writes to the world's state do: go ahead (auto), wait for his word on the turn's card (confirm), or are left out (never). |
| `permissions.external` | `auto` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Permission for tools that reach outside RPE: What a call of a tool outside RPE (the web, a command, an MCP server) does: go ahead (auto), wait for his word (confirm), or is refused (never). |

### What is kept of a turn

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `trace.requests` | `first` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Requests kept: Which model calls have what they were sent kept in the turn's folder: each agent's first, all of them, or none. |
| `prompt.signatureChars` | `64` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Start a slice is known by: Characters at the start of a slice's text that the prompt map keeps, to find the slice again in a later prompt. A map learned under another value is still found. |

### What you see while a turn runs

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `live.backlog` | `5000` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Live view backlog: Items of one run a page following it live may have yet to take; past that, the page is cut off and told so, and no run waits on a slow page. |

### Lists of turns

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `turns.page` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns on a page: The turns a chat's list on the Turn page gives when the page names no number. |
| `turns.maxPage` | `500` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most turns on a page: The most turns one page of a chat's list may ask for. |

## Connections and model calls

Each connection's own values, how a model call is made, tried again and throttled.

### For each connection

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `connections.<connection>.effort` | none (as each agent's definition says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Effort on a connection: How hard every agent on this connection reasons, in place of its definition's effort; an agent's own effort setting stands over it. |
| `connections.<connection>.jobs.atOnce` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Jobs at once on a connection: Jobs on this connection that run at the same time. |
| `connections.<connection>.jobs.perDay` | none (no limit of its own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Jobs in a day on a connection: Jobs on this connection that may be started in a day. Below 1: At 0 no job starts on this connection. |
| `connections.<connection>.throttles.requestsPerMinute` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Requests a minute on a connection: Calls sent on this connection over any minute, across every agent, turn and job; one past it waits for room. |
| `connections.<connection>.throttles.tokensPerMinute` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tokens a minute on a connection: Tokens sent and written on this connection over any minute; a call waits for room, and one bigger than the whole minute is not made. |
| `connections.<connection>.throttles.atOnce` | none (as every connection) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls at once on a connection: Calls on this connection under way at the same time; one past it waits in line, first come first served. |
| `connections.<connection>.reply.form` | none (as reply.form says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Reply form of a connection: The reply form of this connection, in place of the one every connection takes. |
| `connections.<connection>.rules.interrupt` | none (as rules.interrupt says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | A stream rule that interrupts, on a connection: Stop or remind, for one connection whose stopped reply cannot go on cleanly. |

### Model calls

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `calls.silentAfterSeconds` | `300` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A model's answer that goes silent | Silent answer ends after: Seconds an answer that has begun may go with nothing from its server before it is ended. |
| `calls.providerWaitSeconds` | `60` seconds | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Provider wait: Seconds a provider has to answer a connection's test or list its models. |
| `calls.signInOpenSeconds` | `600` seconds | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sign-in stays open: Seconds a sign-in to a provider stays open for you to finish it. |
| `calls.testRoomTokens` | `64` tokens | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Test call's room: Tokens a connection's test call lets its answer take. |
| `calls.maxModelListMiB` | `8` MiB | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Most of a model list read: Mebibytes of a server's list of its models that are read; a longer list is refused. |
| `calls.quotedChars` | `80` characters | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Address quoted in a refusal: Characters of a media address that the words of a refused request quote. |
| `calls.signInWordsKeptSeconds` | `600` seconds | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Failed sign-in's words kept: Seconds the words of why a sign-in did not finish are kept to be shown. |
| `calls.maxFailureChars` | `2000` characters | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length of failure words: Characters of a provider's or a call's failure words that are kept; the rest is cut. |
| `calls.minSecretChars` | `8` characters | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Length a secret is looked for at: Characters from which a key or a header's value is taken out of a provider's words wherever it stands; a shorter one is taken out where it stands as a word of its own. A key shorter than this is refused. |
| `calls.retryWaitSeconds` | `1` seconds | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Wait before a retry: Seconds before a failed call is made again the first time; each wait after is twice the one before. |
| `calls.retries` | `2` | RPE-global.yml | from the next turn | Appendix D.1: A model call that failed before any answer arrived | Retries of a failed call: Times a call that failed before any answer came is made again, where its connection sets no number of its own. |
| `calls.cacheRetention` | `short` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Prompt cache retention: How long a provider is asked to keep a prompt in its cache: none, short or long. |
| `calls.toolRefusalMinutes` | `60` minutes | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Native tools tried again after: Minutes a connection's model that refused native tools is offered them as text; then native tools are tried again. |
| `calls.effortRefusalMinutes` | `60` minutes | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Refused thinking level tried again after: Minutes a connection's model that refused a thinking level is sent the next level down it has at once; then the refused level is tried again. |

### Calls at once

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `throttles.atOnce` | none (no limit) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Calls at once on any connection: Calls under way at the same time on each connection that sets no number of its own. |

### Counting tokens

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `tokens.charsPerToken` | `3.2` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters per token: Characters counted as one token when a prompt is measured before its provider counts it: whether a call fits, when to compact, and the trace's figures. Below 1: Below 1 a prompt is measured larger than any provider counts it, so agents compact early and calls look too big to fit. |

### Embeddings

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `embedding.connection` | none (no search by meaning) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Embedding connection: The connection, by its name or id, that makes the vectors a search by meaning compares; none: nothing is searched by meaning. Its provider must offer embeddings (OpenAI, Google Gemini, Mistral, an OpenAI-compatible server). |
| `embedding.model` | none (none named) | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Embedding model: The model on the embedding connection that makes the vectors, such as text-embedding-3-small; the connection's own chat model makes none. |
| `embedding.batch` | `64` | RPE-global.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Texts per embedding request: Texts sent in one request for their vectors; more go in further requests. |

### Web search

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `web.hits` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Web search hits: The hits a web search gives when the agent names no number. |
| `web.timeoutSeconds` | `30` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Web search wait: Seconds a web search waits for the provider's answer before it says the search failed. |

## Jobs

Jobs and the bootstrap: how many run, and what they may spend.

### Jobs

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `jobs.atOnce` | `2` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs at once: Jobs that run at the same time, across all your chats; a job started past it waits for a place. |
| `jobs.perDay` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs in a day: Jobs that may be started in a day. Below 1: At 0 no job starts. |
| `jobs.perRun` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs one run may start: Jobs the agents of one run, a turn's or a job's, may start; 0 starts none. |
| `jobs.tokensPerDay` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Job tokens in a day: Tokens, sent and written, that all your jobs may spend in a day; past it no job starts, and a running job stops at its next call. Below 1: At 0 no job starts. |
| `jobs.run.calls` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Calls in a job's run: Model calls all the agents of one job's run may make between them. Below 1: At 0 a job's run makes no call and ends as it starts. |
| `jobs.run.tokensIn` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens sent in a job's run: Tokens sent to models across all the agents of one job's run. Below 1: At 0 a job's run can send no call and ends as it starts. |
| `jobs.run.tokensOut` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens written in a job's run: Tokens models write across all the agents of one job's run. Below 1: At 0 a job's run can write nothing and ends as it starts. |
| `jobs.run.seconds` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time for a job's run: Seconds one job's run may take. Below 1: At 0 a job's run ends as it starts. |
| `jobs.run.agents` | none (no limit) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Sub-agents in a job's run: Sub-agents the agents of one job's run may start in all; 0 starts none. |
| `jobs.keepDays` | `90` days | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Days a job is kept: Days the record of a job is kept; the older ones are removed when the next job starts. |

### Bootstrap

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `bootstrap.askAtTokens` | `200000` tokens | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Bootstrap asks before | Bootstrap asks before: Tokens sent and written together by a bootstrap job's agents (a token read again from a cache at the weight limits.cachedWeight gives), at which the job is held and asks you whether to go on; a go-on gives it as many again unless you say otherwise. |
| `bootstrap.run.calls` | none (none of its own: every job's limit holds) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Calls in a bootstrap job's run: Model calls all the agents of one bootstrap job's run may make between them, in place of every job's jobs.run.calls; none set, that one holds. |
| `bootstrap.run.seconds` | none (none of its own: every job's limit holds) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time for a bootstrap job's run: Seconds one bootstrap job's run may take, in place of every job's jobs.run.seconds; none set, that one holds. The clock waits while the job waits for your word. |

## Story and characters

The story record, the characters' memories, places, quests and the world state the Author is given.

### The story record

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `story.from` | `lumiverse` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Whose messages are the story: Whose messages the chat's story is made of: as Lumiverse has it (lumiverse), everyone's, or the replies alone (replies). A briefing fact the guidance reads. |
| `story.newest` | `directive` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | His newest message: With the story made of the replies: whether his newest message is the turn's direction (directive) or left out (leave_out). A briefing fact the guidance reads. |
| `story.queryItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Items a story query gives: The most items one story_query answers with; the answer says how many more match. |
| `story.nearMatches` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Near ids listed: How many near ids an answer about an id the story record does not hold lists. |
| `story.nearDistance` | `0.25` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Spelling distance of a near id: How far off in spelling an id may be and still be listed as a near one, as a part of its length: 0.25 lets a quarter of its letters differ. |
| `story.ahead` | `2` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Messages ahead of a turn: Messages the chat is taken to grow by before the next turn's prompt (this turn's reply and the player's next message), where the story record is measured. |
| `story.soFar.share` | `0.05` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The story so far, in the briefing | The story so far: share of the window: The share of the Author's window the briefing's story so far may fill. |
| `story.soFar.minTokens` | `6000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: The story so far, in the briefing | The story so far: fewest tokens: The fewest tokens the briefing's story so far may fill, however small the window. |

### Characters and their memories

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `cast.queryItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Items a cast query gives: The most items of one part one cast_query answers with; the answer says how many more there are. |
| `cast.secretConfidence` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Sureness of a secret learned: How sure, from 0 to 1, a character is of a secret a perception or cast_update says they now hold, used only when the one who writes it says nothing of how sure they are. |
| `cast.topOfMind` | `9` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Top of mind | Top of mind: The most memories a character holds at top of mind. |
| `cast.shortTermDays` | `3` days | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: Short-term memory | Short-term memory: Days of story time a memory stays short term, unless a dream settles it sooner. |
| `cast.fadeDays` | `3` days | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Days a memory takes to fade: Story days in which a memory of weight 1, never recalled, falls to half its strength; each point of weight doubles it, each recall adds as much again. |
| `cast.faintBelow` | `0.25` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Faint below: The strength, from 0 to 1, under which a memory is faint and shown as its gist. |
| `cast.weakBelow` | `0.5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weak below: The strength, from 0 to 1, under which a memory formed since a character's last dream is weak, and the next dream lets it fade at once. |
| `cast.dreamFade` | `0.5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Share a dream leaves: The share, from 0 to 1, of its strength a memory keeps when a dream lets it fade: the weak ones of the stretch and each the character names. 1 lets none fade. |
| `cast.dreamKeep` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weight a dream adds: The weight a memory gains when a dream keeps it. |
| `cast.memoryWeight` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Weight of a memory given none: The weight a memory has when it is written with none. |
| `cast.maxMemoryWeight` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Highest weight of a memory: The highest weight a memory can have; weights run from 1. |
| `cast.comesToMindTokens` | `2000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: What comes to mind | What comes to mind: Tokens of a character's memories that come to mind for a scene. |
| `cast.recallItems` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Memories one recall brings back: The most memories one recall brings back; the answer says how many more touch the cue. |
| `cast.dimensionScale` | `100` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Scale of a relationship's dimensions: The scale a relationship's trust, warmth, respect and fear are read and reported against: from minus this to this. A value past it is kept as sent, and said to be past. |
| `cast.playerMind` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | His character has a mind: His own character is cast with an agent of its own, with its own memories and knowledge, as any principal is; off, it is the persona alone and has none. The shipped guidance reads it as the fact cast.playerMind. |

### Places

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `places.maxVisitDepth` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Places a visit counts for: How many places up the place tree a visit of the point of view counts for; past it, it says where it stopped. |
| `places.since` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Places: what the story changed, shown: The most entries of a place's `since` one answer shows (the newest, oldest first among them); the answer counts the earlier ones and says the query that reads them. |
| `places.features` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Places: features shown: The most feature entries of a place one answer shows; the answer counts the rest and says the query that reads them. |
| `places.access` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Places: access entries shown: The most access entries of a place one answer shows; the answer counts the rest and says the query that reads them. |
| `places.page` | `100` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Places in one page of the list: The most places one page of the Places list holds. |
| `places.history` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Beats in a place's history: The most beats one answer of a place's history gives, newest first; the answer counts the rest. |

### Quests

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `quests.history` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Beats in a quest's history: The most beats one answer of a quest's history gives, newest first; the answer counts the rest. |
| `quests.page` | `100` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Quests in one page of the records: The most quests one page of the Quests page's records holds. |

### The world state in the briefing

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `worldState.tokens` | `4000` tokens | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: everything else | World state: everything else: Tokens of the briefing's world state that everything but the horizon shares. |
| `worldState.dueAheadMinutes` | `360` minutes | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Time ahead listed as due: Minutes of story time ahead that the world state's due section lists. |

## Lore and secrets

How the lore is searched, indexed and given, and who knows what.

### Lore

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `lore.search.hits` | `20` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Hits a lore search gives: Entries a search of the lore gives when it asks for no number. |
| `lore.search.snippetChars` | `80` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Snippet of a lore hit: Characters of an entry's text a hit shows on each side of the first word the search matched. |
| `lore.titleWords` | `8` words | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Words that title an entry: Words of its text that title a lore entry with no title of its own. |
| `lore.search.minWordChars` | `3` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Shortest word a lore search matches: A name or word shorter than this matches nothing in a search of the lore; lower it to find a two-letter name. |
| `lore.search.maxWordRepeats` | `3` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most a repeated word counts: A word repeated in an entry counts at most this often in how a search ranks it, so one long entry cannot outrank the rest on one word. |
| `lore.search.candidates` | `64` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Entries a lore search ranks for each word: A search of your books reads only the entries the search index finds: for each word of the search, at most this many by their names and this many by their texts, before the search ranks them. Raise it if a large library misses an entry a search should find. |
| `lore.held.tokens` | `1600` tokens | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tokens of held secrets a character is given: The most tokens the secrets a character holds may take in the lore it is given as its own, with how it came by each; one that does not fit is left out and the next tried. |
| `lore.workerCatalogueAt` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Entries a catalogue is made on a worker from: A library of more lore entries than this has its catalogue (each entry's id, title, keys, size, how it activates and revision) made on a worker thread, so a large library never stalls another chat's turn or a page. |
| `lore.search.stopWords` | `["the","and","for","with","that","this","from","into","onto","have","has","had","was","were","are","you","your","yours","my","mine","our","ours","his","her","hers","their","theirs","them","they","she","him","its","not","but","all","any","can","will","would","could","should","about","then","than","there","here","what","when","where","which","who","whom","how","why","just","very","some","more","most","other","out","over","under","again","also","like","get","got","one","two","too","off","own","same","such","only","each","both","few","nor","yet"]` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Words a lore search ignores: Words that count for nothing in a search of the lore (articles and the like); change the list for a book in another language. |
| `lore.books` | `["auto"]` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Books the lore reads: `auto` reads every book the chat reads. Otherwise a list of book ids: only those of the chat's books are read as lore, by the index, the lore map's fourth part, the search and every read. |
| `lore.index.entriesPerCall` | `20` | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Lore indexing, entries per call | Lore indexing, entries per call: Entries handed to one call of a lore indexing run. |
| `lore.index.bound` | `12` | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Lore map, bound entries not in the prompt | Lore map, bound entries: Entries bound to the horizon and not in the prompt that the lore map lists. |
| `lore.index.charsPerCall` | `48000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lore indexing, characters per call: The most characters of entry text handed to one call of a lore indexing run, so long entries never overrun a small model's window; one entry is handed at least, however long. |
| `lore.index.page` | `50` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Lore index, entries per page: Entries one page of the lore index on the Lore page holds. |
| `lore.index.entry` | none (no index entry of his own) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Your own lore index entry: A lore entry of yours whose text heads the readable lore index of each chat, in front of the lines RPE writes. Give its id in Lumiverse. |
| `lore.proposals.page` | `50` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Lore proposals, rows per page: Rows one page of the proposals' queue and of the record of writes to your lore holds on the Lore page. |
| `lore.projection` | `false` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Projection book: Whether this chat gets a book of its own that carries what the story changed and made (notes on your entries, the people and canon it made) into Lumiverse's own activation, rewritten after scenes and when the path changes; a branch gets its own. Off, no book is made and one made while it was on is taken away. Your own books are never touched. |

### Secrets

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `secrets.narrator.knowledge` | `scene` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Narrator's knowledge: What the narrator knows of the chat's secrets: `scene` (everyone in the scene) or `pov` (the player's character only). The chat's own choice wins over its world's own, which wins over this global one. |
| `secrets.narrator.secrets` | `marked` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Narrator's secrets: How a secret kept from the player's character reaches the narrator: `marked` (put in, marked as a secret) or `omit` (left out). The chat's own choice wins over its world's own, which wins over this global one. |
| `secrets.tracked` | `true` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Track who knows what: Whether a chat tracks who holds which secret. Off, no holding counts and every secret stays kept; what was recorded stays for when it is switched on again. Each new turn records the value in force, so a swipe or a branch judges a secret by what held there. |
| `secrets.threshold` | `0.7` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | How sure a holding must be: How sure a holding of a secret must be, from 0 to 1, before it counts as the holder knowing it. Each new turn records the value in force, so a swipe or a branch judges a secret by what held there. |

## The world and play

The world store, the engine's tools, maps, panels and things.

### The world store

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `store.snapshotEvery` | `25` | RPE-global.yml | from RPE's next start | Appendix D.1: Snapshot | Snapshot: Turns between snapshots of a chat's world, from which its state is rebuilt. |
| `store.chatsHeld` | none (every chat) | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Chats held in memory: Chats whose world states are held in memory, the chat read least recently let go first and worked out again from its snapshot when next read. |
| `store.statesPerChat` | `8` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | World states held for each chat: Worked-out world states held for each chat (its newest reply, a running turn, a swipe's point), the least recently read going first. |
| `store.snapshotsHeld` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Snapshots waiting to be stored: Snapshots a reading found worth keeping, held in memory until the next write stores them. |
| `store.maxBranchHops` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Branches followed back: How many branches back a chat's messages are followed to the turns they share; past it, the comparison and the log say where it stopped. |
| `store.maxPlaceDepth` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Places a place inherits from: How many places up the tree a place takes values from; past it, the tree says the chain stops there. |
| `store.notable` | `3` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Names of note in a reflection: Names of note each reflection of the world lists. |
| `store.workerFoldAt` | `500` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Changes a fold runs over before it goes to a worker: A fold over more changes than this runs on a worker thread, so a long chat's fold, fresh or after a swipe flipped on an early message, never stalls another chat's turn, the extension's question or a page. |
| `store.worldsKept` | `8` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | World revisions held in memory: Revisions of world documents held in memory once read, the least recently used going first. |
| `store.searchCandidates` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Candidates a world search takes from its index: Things the state index gives back for each word asked, before the search puts them in order by what the world says of them; a world with a very common word in many names may need more. |
| `store.searchSettleMs` | `300` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Quiet time before the state index follows a chat: Milliseconds a chat's writes stay quiet before its search index follows its head: the many writes of one turn are followed once. |

### The engine's tools

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `engine.maxKindChain` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Kinds followed up a kind's chain: How many kinds up a kind's chain the engine follows to learn what something is; past it, it says where it stopped. |
| `engine.maxHolderDepth` | `32` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Holders followed to find a thing's place: How many holders up the engine looks for the place a thing is at; past it, it says where it stopped. |
| `engine.nearMatches` | `5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Near matches listed: How many near matches an answer about a name that is not there lists. |
| `engine.nearDistance` | `0.25` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Spelling distance of a near match: How far off in spelling a name may be and still be offered as a near match, as a part of the name's length: 0.25 lets a quarter of its letters differ. |
| `engine.queryDepth` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Depth of a world query: How many levels below its point world_query shows when it names no depth. |
| `engine.searchHits` | `10` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Hits a world search gives: The most things one world_search answers with. |
| `engine.maxDueItems` | `50` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Things falling due listed: The most things falling due in a span an answer lists, soonest first; how many more fall in it is said. |
| `engine.creditScoreAssumed` | `700` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Score assumed for someone with none: The credit score the finance tables are read at for someone with no score recorded. |
| `engine.maxEditOps` | `64` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Operations one GM edit carries: The most operations one GM edit carries; an edit with more is refused naming this setting, and one already recorded is never held to it. |
| `engine.placesBeforeReport` | `64` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Places a chat makes before each further one is reported: The places a chat makes in play before each further one is reported, where the world sets no placeCap of its own. A place past it is made all the same. |
| `engine.carriedChars` | `6000` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters of an old record read at once: The most characters of what an earlier build recorded for a migrated turn that one turn_carried answers with; the rest is read on from where it stops. |
| `engine.worldChars` | `6000` characters | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Characters of a world's document read at once: The most characters of a world's document one world_read answers with; a longer value is answered as an outline to read further into. |
| `engine.worldListItems` | `20` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Items of a list about a world listed: The most items of a list about a world's document, such as the issues of its lint or its revisions, that one answer gives; how many more there are is said. |

### Maps

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `map.laidFeet` | `5` feet | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Width of a square laid in play: How wide, in feet, a square is on a grid laid in play that names no size. |
| `map.roundSeconds` | `6` seconds | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | Seconds in a round: How long a round is on a grid whose square a round's move crosses; a fight counts time in them. |
| `map.roundFeet` | `30` feet | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Feet moved in a round: How far someone moves in a round, where nothing says how fast they are. |
| `map.printColumns` | `40` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: the map | Map printed, columns: The most columns of a map the world state prints; a wider map is printed around the horizon. |
| `map.printRows` | `30` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: World state: the map | Map printed, rows: The most rows of a map the world state prints; a taller map is printed around the horizon. |
| `map.diagonal` | `one` | RPE-global.yml or a chat's RPE.yml | from the next turn | Appendix D.1: A grid laid in play | How a diagonal counts: one: a diagonal step is one square; alternate: every second diagonal in a row is two. A world's ruleset that says otherwise wins. |
| `map.distances` | `feet` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Distances told in: feet or metres. A world's ruleset that says otherwise wins. |
| `map.picture` | `true` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | World state prints the map's picture: The world state prints the map's picture with its legend; off, it gives the title and the legend and the list of who and what is where carries the load. |
| `map.areaStart` | `corner` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Where an area starts: corner: at a point where squares meet, as D&D's grid rule has it; middle: at the middle of a square. Every area (a radius, a cone, a line, a cube) follows it. A world's ruleset that says otherwise wins. |
| `map.areaShare` | `0.5` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Share of a square an area must cover: From 0 to 1: the share of a square an area must cover for the square to count; 0.5 is D&D's half, and 0 counts any square the area covers any of. A world's ruleset that says otherwise wins. |
| `map.coverHalf` | `1` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Lines blocked for half cover: Of the four lines from a corner of the attacker's square to the corners of the target's, how many blocked give half cover (D&D: one or two). A world's ruleset that says otherwise wins. |
| `map.coverThreeQuarters` | `3` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Lines blocked for three-quarters cover: How many of the four lines, blocked, give three-quarters cover (D&D: three). A world's ruleset that says otherwise wins. |
| `map.coverTotal` | `4` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Lines blocked for total cover: How many of the four lines, blocked, give total cover (D&D: four). A world's ruleset that says otherwise wins. |
| `map.coverCreatures` | `true` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Creatures give cover: Whether other people and things standing between an attacker and a target obstruct the lines, as D&D has it. A world's ruleset that says otherwise wins. |
| `map.lightUnset` | `lit` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | A place with no light recorded reads: lit or dark: how a place reads, on the grid and to sight, when neither it nor any place above it has had its light set (world_apply, set, key light). |
| `map.display` | `world` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | How the map panel shows the map: world: as the world says; knowledge: only what the character knows, places heard of drawn dashed; fog: fog over what it has not seen. The panel's Known and Fog switch writes this for the chat. |

### Panels

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `taps.maxNameChars` | `80` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Longest name a refusal quotes: The most characters of a name a tap's refusal quotes back; a longer one reads as naming no one. |
| `taps.maxThingsPerFix` | `64` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Things one fix changes: The most things one ✎ things fix changes; past it the tap is answered in words and changes nothing. |
| `taps.journalPage` | `100` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns the Journal reads at a time: The most turns, newest first, whose notes the Journal shows; a longer chat reads the rest a page at a time. |
| `taps.meterTurns` | `200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns the HUD's meter averages over: The chat's last turns whose calls, tokens, time and lore lookups the HUD's meter gives the average and 95th percentile of. |
| `taps.maxClocks` | `100` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Replies whose world clock the panels carry: The newest replies on the chat's path that show the world's date and time at their turn's end with each read of the panels. |
| `taps.tell.payments` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Payments to others: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.credit` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Credit: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.property` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Property: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.business` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Business: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.staff` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Staff: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.members` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Members: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.structure` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Structure: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.handovers` | `true` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Hand-overs and outfits: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.accounts` | `false` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Your own accounts: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.investing` | `false` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Investing: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.governance` | `false` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Governance: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.things` | `false` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Tell the Author: Things: Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it. |
| `taps.tell.paymentsFrom` | `0` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Payments told from: A payment to someone else is told to the next turn's Author from this amount, in whole units of the world's money (0: every one). |

### Things

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `things.maxTidyFindings` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Findings one Tidy up shows: The most findings one Tidy up run lists, of the things that do not add up in a chat. Above 500: Over 500 findings in one run are listed and drawn at once. |
| `things.tidy` | none (as the world's tidy.auto says) | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tidy-up findings in the world state: Whether each turn's world state lists the holds that cannot be (a thing too big to carry on a person, a thing worn but lying elsewhere) with the fix the tidy-up would make; unset, the world's own tidy.auto decides. Nothing is ever fixed by itself. |
| `things.tidyLeft` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Tidy-up findings left as they are: The keys of the tidy-up's findings he told it to leave alone (Leave it): they are not listed again. |
| `things.maxTidyLeft` | `1000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Findings left alone, kept: The most keys the list of findings left alone keeps; past it the oldest go. |

## Build

Build's jobs and the worlds it edits.

### Build's jobs

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `build.jobs.atOnce` | `2` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Jobs running at once: The most jobs one user may have running in Build at once; another is refused until one ends or is cancelled. |
| `build.jobs.kept` | `8` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Ended jobs kept: How many ended jobs Build keeps per user, the newest, each with its result; running ones are always kept. |
| `build.jobs.maxIdChars` | `200` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Longest id a job's input names: The longest id (a world, a book, a map, a person) a job's input may name; a longer one is refused. Below 8: Ids of fewer than 8 characters are refused, and most of the ids Build's jobs name are longer. |
| `build.playtest.maxTurns` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns in a Playtest: The most typed turns one Playtest takes; the rest are cut. |
| `build.playtest.maxTurnChars` | `2000` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters in a Playtest turn: The longest a typed turn of a Playtest may be, in characters; a longer one is cut. |
| `build.check.days` | `3` days | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Days a Check world runs: The days Check world simulates when its request names none. |
| `build.check.maxDays` | `14` days | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most days a Check world runs: The most days one Check world may simulate; a request for more runs this many. |
| `build.import.maxBooks` | `64` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Books an import reads: The most lore books one Import from lore may read; a request naming more is refused. |
| `build.refine.maxChars` | `4000` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters in a Refine request: The longest request Refine with AI takes; a longer one is cut. |
| `build.index.maxChars` | `78000` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Text an index job keeps: The most pasted text one Index this text keeps, in characters; a longer text is read to its last paragraph that fits, and the job says how much was not read. |
| `build.map.maxProseChars` | `4000` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters in a map's prose: The longest description Describe a map takes; a longer one is cut. |
| `build.routines.maxOwners` | `500` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | People a routines job may name: The most people and groups one Propose routines may be asked for by name; a request naming more is refused. |
| `build.routines.perPass` | `36` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | People one routines pass reads: The people and groups one pass of Propose routines gives its agent, in id order; Continue starts the next pass after the last. |
| `build.routines.loreTokens` | `8000` tokens | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lore each person brings to routines: The lore one person or group brings to Propose routines, in tokens: their entries best first, whole, until the next would pass this. |
| `build.jobs.maxProposals` | `120` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Proposals a model job keeps: The most proposals one of Build's model jobs keeps for review; the rest are dropped and the job says so. |

### Worlds

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `worlds.maxPatchOps` | `500` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Operations in one world patch: The most operations one patch of a world's draft may carry; a longer one is refused naming this setting. |
| `worlds.maxPatchChars` | `4194304` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Size one world patch may bring in: The most one patch of a world's draft may bring in, in characters of JSON: the values it adds or replaces and what it copies. |
| `worlds.maxDepth` | `64` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Depth of a world document: How deep a world document may nest; a write that would nest it deeper is refused. Below 4: A world document nests at least four deep: below it every write to a world is refused. |
| `worlds.noteChars` | `200` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters of a commit note: The longest note a commit keeps in a world's history, cut to it. |
| `worlds.revisionsHeld` | `8` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | World revisions the editor holds in memory: Revisions of worlds the editor keeps loaded across requests, the least recently used going first; a revision is several MB once read. |
| `worlds.maxBodyBytes` | `4194304` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest body a worlds route takes: The most bytes a request of Build's worlds routes may carry (a world file imported, a draft written whole); a larger one is refused naming this setting. Below 1024: Under 1 KiB almost every world file and draft written whole is refused. |

## Files and storage

The agents' files, which are in force, notes, suggestions and what is kept on disk.

### Turn folders

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `retention.turnFolders` | `50` | RPE-global.yml or a chat's RPE.yml | at its next use | Appendix D.1: Turn folders kept whole | Turn folders kept whole: How many of a chat's newest turn folders keep everything; each older one keeps its turn.json, output, transcripts and trace.jsonl. The next turn's prompt is compared over the folders kept. |

### The agents' files

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `files.findHits` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Hits a find gives: The most files a listing, a glob or a grep of the agents' files gives when it asks for no number. |
| `files.grepBytes` | `1048576` bytes | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Largest file a grep reads: Bytes past which a file is passed over by a grep of the agents' files. |
| `files.grepLineChars` | `1000` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Line a grep tests: Characters of a line a grep tests and shows of a hit; the rest of the line is cut. |
| `files.grepMs` | `2000` ms | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Time a grep runs: Milliseconds a grep runs before it stops with the hits it has found. |
| `files.diffCells` | `4000000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lines a difference compares: Line pairs the Files page's difference compares one by one; past it, the changed middle is shown removed, then added whole. |
| `files.maxIdChars` | `128` characters | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Longest id that names a folder: Characters of a session's or a turn's id, which names its folder; RPE's own ids are 36, and an id is letters, digits, _ and - whatever this says. Below 36: RPE's own ids are 36 characters: a shorter bound refuses them, and a session's or a turn's folder cannot be named. Above 240: Most disks refuse a name over 255 characters: a folder named by an id this long may not be made. |
| `files.list.page` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Entries a Files page lists: Files and folders the Files page lists in one page of a folder, or of a search, when it asks for no number. |
| `files.list.maxPage` | `1000` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most entries a Files page lists: The most files and folders one page of the Files page's listing gives, whatever number it asks for. |
| `files.readLines` | `500` lines | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Lines of a file read at once: Lines of a file the Files page reads in one go when it names none: a long file is read a part at a time, never whole. |

### Notes

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `notes.page` | `20` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Notes listed: Note files each of the Storage page's lists gives when the page asks for no number. |
| `notes.maxPage` | `200` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most notes listed: The most note files one of the Storage page's lists gives. |
| `notes.versionsKept` | none (all of them) | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns back note versions are kept: How many turns back the versions of notes an agent wrote are kept. Past it, the versions of a turn that far back on every path that reaches it are folded into the notes as they stand and let go, after each turn and when the Storage page prunes them; a swipe or a branch reaching further back leaves the notes as they stand. Empty keeps every version. |

### The files in force

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `stack.off` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files switched off: Files switched off by name, an instruction file by its own (WORLD), anything else by its folder and name (rules/perceptions-owed); a name in any level's list is off everywhere. |
| `stack.layered` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files read at every level: Instruction files read at every level that has one, the farther first, in place of the nearest alone. |
| `stack.added` | `{}` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files added for a kind of turn: For each kind of turn (swipe, regenerate, delete), the instruction files added to its briefing beside TURN.md; a nearer level's entry for a kind replaces the farther one's. |
| `stack.instructions` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Files added to stacks: Files added to the stack of every agent that reads instruction files, or, as a table, to each named agent's alone; every level's list applies. |
| `stack.pins` | `[]` | RPE-global.yml or a chat's RPE.yml | from the next turn | beyond Appendix D.1, for the owner's approval | Pinned files: Files handed whole to an agent at the start of each of its runs, each a file and the agent it is pinned for; every level's list applies. |

### Suggestions

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `suggestions.maxOpen` | `50` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Open suggestions kept: The most suggestions of a chat that wait for the user at once; past it an agent's new suggestion is not kept, and the agent is told so. |
| `suggestions.decidedKept` | `500` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Decided suggestions kept: How many accepted and dismissed suggestions of a chat are kept, the oldest going after each decision and when the Storage page prunes them. |

### Storage

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `storage.page` | `50` | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chats a Storage page lists: Chats the Storage page lists in one page, with what each takes on the disk and in the database. |
| `storage.recheckHours` | `6` hours | RPE-global.yml or a chat's RPE.yml | at its next use | beyond Appendix D.1, for the owner's approval | Hours between checks of the kept sizes: How often what each chat's folder takes, as RPE keeps it, is checked against the disk in the background, so an edit made in his own editor shows. |

## Pages

How these pages wait, read and show.

### The pages

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `pages.probeMs` | `3000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page waits for a direct address: Milliseconds a page in Lumiverse waits for each of RPE's addresses to answer it directly, before it takes the road through the extension. Below 100: A direct address seldom answers that fast: the page takes the road through the extension almost every time. Above 60000: A page waits over a minute on each address before it takes the road through the extension. |
| `pages.startMs` | `35000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page waits for the extension's start-up facts: Milliseconds a page in Lumiverse waits for the extension's start-up facts. The page keeps the last value RPE gave it in the browser, and holds it from its next start. Below 1000: The extension seldom gives its start-up facts within a second: the page says RPE cannot be reached. Above 600000: A page waits over ten minutes before it says RPE cannot be reached. |
| `pages.renewAheadMs` | `60000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page token renewed ahead: Milliseconds before a page token runs out that the page asks for a new one (never later than half the token's life). Below 1000: A page asks for its new token in the token's last second: a slow answer lets it run out. Above 3600000: The page renews at half a token's life at the latest, so a longer lead changes nothing past that. |
| `pages.reconnectMs` | `1000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's first reconnect wait: Milliseconds a page waits before it opens the live socket again after it closed, or asks again for a page token it could not have; each failure doubles the wait. Below 100: A page tries the live socket again almost at once after each close. Above 60000: A page waits over a minute before it first tries the live socket again. |
| `pages.maxReconnectMs` | `30000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's longest reconnect wait: Milliseconds at most a page waits between tries at the live socket or at a new page token. Below 1000: A page tries the live socket again more than once a second while RPE cannot be reached. Above 600000: A page may wait over ten minutes between tries, and shows nothing new meanwhile. |
| `pages.jobPollMs` | `1000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page asks after a long request: Milliseconds between a page's asks for the answer of a request that RPE took in hand and answered by an id, such as a connection test the relay could not wait for, and between the Runtime page's reads of the builds while an update goes through its stages. Below 100: A page asks after a long request more than ten times a second. Above 60000: A page asks after a long request less than once a minute, so its answer shows late. |
| `pages.tickMs` | `1000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page's running clocks tick: Milliseconds between the redraws of a running timer on a page. Below 100: Running clocks are drawn again more than ten times a second. Above 60000: Running clocks move less than once a minute. |
| `pages.redrawMs` | `100` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Live and Turn pages redraw at most every: Milliseconds at most between redraws of a watched turn on the Live and Turn pages while it streams; what a read of it gives shows at once. Below 10: The Live and Turn pages are drawn again more than a hundred times a second while a turn streams. Above 10000: A streaming turn's new text shows only every ten seconds or more. |
| `pages.keepRuns` | `4` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Runs the Live page keeps: Runs of a chat the Live page holds at once; once more have ended than this, the oldest ended is let go, named with a link to its Turn page. Above 100: The Live page holds over a hundred runs in the browser at once, and grows slow. |
| `pages.keepFailures` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Handler failures the Live page keeps: Handler failures told to a chat that the Live page holds at once; once more have come than this, the oldest is let go. A failure stays on the page until it is dismissed. Above 500: The Live page holds over 500 failures in the browser at once. |
| `pages.turnsPage` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Turns read at a time: Turns the Turns list and the World page's turn picker read from RPE at a time, and the carried turns the Turns page reads beside them (RPE gives at most 500). Above 500: RPE gives at most turns.maxPage turns a read, 500 as shipped: past it the page is given that many. |
| `pages.filesPage` | `200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Files shown per page of a folder: Entries of a folder the Files page reads from RPE at a time; more are read on request. Below 10: A folder is read a few entries at a time, with a press for each more. Above 1000: RPE lists at most files.list.maxPage entries a page, 1000 as shipped: past it the page is given that many. |
| `pages.filePieceBytes` | `65536` bytes | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Bytes of a file read per piece: Bytes of a file the Files page reads from RPE at a time, so a file of any size opens its first piece at once and goes on when asked. Below 1024: A file is read under 1 KiB at a time, with a press for each more. Above 4194304: A piece over 4 MiB is read and drawn whole before any of it shows. |
| `pages.chatsPage` | `50` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chats read at a time on Storage: Chats the Storage page reads from RPE at a time, each with what its folder and its rows of the database take. Above 500: Over 500 chats are read at once, each with what it takes on the disk, and the page opens slowly. |
| `pages.logPage` | `200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Log lines shown per page on Runtime: Lines of RPE's own log the Runtime page reads at a time, the newest first; older lines are read on request (RPE keeps service.logLines of them). Below 10: The log is read a few lines at a time, with a press for each more. Above 2000: Over 2000 lines are drawn at once, and RPE keeps only service.logLines of them. |
| `pages.rowsPage` | `30` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Rows read at once: Rows the Sessions, Rules and Lore pages' lists read from RPE at a time (sessions and their turns, firings of a rule, proposals and writes to his lore); more are read on request. Below 5: A list is read a few rows at a time, with a press for each more. Above 500: Over 500 rows are read and drawn at once. |
| `pages.toastsShown` | `3` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Toasts shown at once: Toasts the kept views (Build, Play, the chat's toolbar) show at once; a new one pushes the oldest out. Above 20: Over twenty toasts at once cover the view. |
| `pages.errorToastMs` | `6000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | An error toast shows for: Milliseconds an error toast shows in the kept views. Below 500: An error toast goes before it can be read. Above 120000: An error toast stays over two minutes. |
| `pages.toastMs` | `3500` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Any other toast shows for: Milliseconds any other toast shows in the kept views. Below 500: A toast goes before it can be read. Above 120000: A toast stays over two minutes. |
| `pages.downloadRevokeMs` | `1000` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | A download link is kept for: Milliseconds the kept views keep a download's link before the browser lets it go. Below 100: A download's link may go before the browser has fetched it. Above 60000: A download's link is kept in the browser over a minute. |
| `pages.previewWaitMs` | `300` ms | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Wait after typing before a prompt part is rendered again: Milliseconds the Files page waits after he stops typing in a prompt part before it asks RPH to render the draft again for its preview. Below 50: The preview is rendered again at almost every key pressed. Above 10000: The preview waits over ten seconds after typing stops. |
| `pages.briefChars` | `90` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters of a job's brief shown in the Jobs list: Characters of a job's brief the Jobs list shows on its line before it cuts the rest with an ellipsis; the job open shows its brief whole. Below 20: A brief cut this short says little of the job. Above 2000: A brief this long fills the Jobs list. |
| `pages.titleChars` | `60` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Characters of a scene's name shown on Sessions: Characters of a scene's name (its name, title or summary in the story record) the Sessions list shows before it cuts the rest with an ellipsis. Below 20: A scene's name cut this short says little of it. Above 500: A scene's name this long fills the Sessions list. |
| `pages.messagesPage` | `100` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Messages read at once for the Story timeline: Messages whose text the Story timeline asks Lumiverse's door for in one read, for the beats it has listed; the rest are read straight after. Above 1000: Lumiverse gives at most 1000 rows a read: past it the timeline is given that many at a time. |

## Lumiverse

The door to Lumiverse: its sign-in, sockets, reads and relay.

### The door to Lumiverse

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `lumiverse.session.checkSeconds` | `43200` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Session check: Seconds between RPE asking Lumiverse after its sign-in, which renews it; Lumiverse ends a session seven days after its last renewal. Below 60: RPE asks Lumiverse after its session more than once a minute. Above 604799: Lumiverse ends a session seven days after its last renewal: RPE's sign-in lapses before it is asked after. |
| `lumiverse.sockets.pingSeconds` | `30` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket ping: Seconds between pings on the event and relay sockets; Lumiverse closes a socket silent for 120. Above 119: Lumiverse closes a socket that has sent nothing for 120 seconds, so the sockets close between pings. |
| `lumiverse.sockets.pongWaitSeconds` | `15` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket pong wait: Seconds a ping waits for its answer before the socket is opened again. |
| `lumiverse.sockets.openWaitSeconds` | `20` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket open wait: Seconds an opening socket waits for Lumiverse to let it in. |
| `lumiverse.sockets.retrySeconds` | `1` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket first retry: Seconds before a closed socket is opened again, doubled after each failure. |
| `lumiverse.sockets.maxRetrySeconds` | `30` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Socket longest retry: The longest wait in seconds between tries to open a socket. |
| `lumiverse.database.tries` | `4` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Database tries: Tries of a read while Lumiverse holds its database file locked. |
| `lumiverse.database.waitSeconds` | `0.025` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Database first wait: Seconds before the second try of a locked read, doubled after each try. |
| `lumiverse.reads.rereads` | `3` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Rereads of a changing chat: Times a chat read over HTTP is read again when it changed while it was read. |
| `lumiverse.reads.breakdownReplies` | `10` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Replies asked for a breakdown: The newest replies asked when looking for the prompt breakdown Lumiverse stored. Above 1000: Lumiverse gives at most 1000 rows a page: no more replies than that are asked. |
| `lumiverse.reads.keepSeconds` | `15` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Seconds a read over HTTP is held: Seconds what RPE read of Lumiverse's rows over HTTP is held before it is read again; an event Lumiverse sends for a change lets it go at once. Read from the database file, a read is held exactly as long as the rows are unchanged. |
| `lumiverse.reads.kept` | `32` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chats, books and presets held: How many chats, books and presets have what RPE read of them held at once; the one left alone longest goes first. |
| `lumiverse.dryRun.waitSeconds` | `10` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Dry run wait: Seconds a dry run is waited for before the reply goes on without its blocks' names. |
| `lumiverse.stream.commentSeconds` | `5` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Stream comment: Seconds a reply's stream may send nothing before a comment line keeps its connection open. Above 9: The server lets a connection sit idle ten seconds: a reply's stream that sends nothing that long is closed before its comment line. |
| `lumiverse.relay.flushSeconds` | `0.25` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay flush: Seconds between the relay's frames to a page; a frame for every event floods Lumiverse's socket. |
| `lumiverse.relay.frameKiB` | `256` KiB | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay frame: KiB of characters in one relay frame; a longer list goes in parts. Above 340: Lumiverse drops a frame over 1 MiB, and a frame this long can pass it: the page then misses those events. |
| `lumiverse.relay.leaseSeconds` | `60` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay lease: Seconds a page's follow lasts unless the page asks again. |
| `lumiverse.relay.holdKiB` | `1024` KiB | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Relay hold: KiB of characters a page may have waiting before its chats' events are held. Above 2730: Lumiverse holds at most 8 MiB waiting for a socket: past it, it drops what waits. |
| `lumiverse.relay.retrySeconds` | `30` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Registration retry: Seconds before RPE registers again with an extension that did not take its registration. |
| `lumiverse.reply.holdSeconds` | `540` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Whole reply hold: Seconds after a reply asked for whole arrives at which its turn stops with what it has; Lumiverse ends a generation that has had no text for ten minutes, and nothing reaches it while a whole reply is written. Above 599: Lumiverse ends a generation with no text for ten minutes: a turn still writing then loses its reply whole. |
| `lumiverse.question.maxKiB` | `8192` KiB | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Question size: KiB the extension's question before a generation may carry. |
| `lumiverse.extension.questionWaitSeconds` | `3` seconds | RPE-global.yml | at its next use | Appendix D.1: How long the extension waits for RPE's answer before a generation | Question wait: Seconds the extension waits for RPE's answer to its question before a generation, and RPE works it out in; a half not worked out in them is answered not known: the extension then keeps every marked secret out, and RPE makes the cut when the reply's request arrives. Above 9: Lumiverse gives the extension ten seconds before it goes on without its answer: the generation starts with every marked secret kept out. |
| `lumiverse.extension.whoseWaitSeconds` | `2` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Whose-chat read wait: Seconds the extension waits for each read that tells whether a reply's chat is RPE's (its stored registration, the connection's own record); a read that does not answer in them has failed, and where both fail that generation is stopped with a line and the failure recorded. Above 5: Lumiverse gives the extension ten seconds before it goes on without it, and two reads of this wait and the question's come before a generation. |
| `lumiverse.extension.logChars` | `200` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Extension log words: Characters of RPE's words the extension writes in Lumiverse's log when RPE refuses its question. |
| `lumiverse.extension.requestWaitSeconds` | `35` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page request wait: Seconds a page's request through the extension waits for its answer; Lumiverse's proxy gives up after its own 30. |
| `lumiverse.extension.followRenewalSeconds` | `20` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Page follow renewal: Seconds between a page's renewals of its follow of a chat; keep it well inside the relay lease. |
| `lumiverse.search.hits` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search hits: Hits a chat search gives when the query names no number. |
| `lumiverse.search.snippetChars` | `80` characters | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Chat search snippet: Characters of a chat search hit's snippet. |
| `lumiverse.stores.hits` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Store search hits: Hits a search of Lumiverse's databanks and memory gives when the query names no number. |
| `lumiverse.untagged.whileAwaited` | `pass` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Untagged request while a reply awaits its tag: pass: a request with no tag is passed on, as every other is. fail: while a reply RPE heard start on its connection has neither sent its tagged request nor ended, a request with no tag on its connection is answered with an error line; it may fail a title or summary asked meanwhile. |

## Server and service

The server, sign-in and tokens, the database, the command line, the service and updates.

### Updates

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `update.restart` | `true` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Restart onto a new build: RPE restarts by itself onto a new app file the extension brings, once no turn or job runs. |
| `update.versionWaitSeconds` | `10` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Wait for a new build to say its version: Seconds a new app file is given to say its build. |
| `update.lookEverySeconds` | `2` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Look again for running work: Seconds a waiting restart waits before it looks again whether turns or jobs still run. |
| `update.startTries` | `5` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Starts allowed in the start window: Starts of RPE's service its unit allows within the start window before the service manager stops starting it; rpe up writes it into the unit. |
| `update.startWindowSeconds` | `60` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Start window: Seconds within which the starts of RPE's service are counted. |
| `update.keepCopies` | `1` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Known-good copies kept: Copies of RPE's own build kept beside the one that runs, the newest first, for the service's pre-start step to put back when a swapped-in build does not come up. |
| `update.checkWaitSeconds` | `120` seconds | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Wait for a new build's check: Seconds a new app file is given to check that it starts on this RPE's data. |

### The server

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `server.address` | `127.0.0.1` | RPE-global.yml | from RPE's next start | Appendix D.1: RPE listens on | RPE listens on: The address RPE listens on besides loopback; an address other than loopback lets other machines reach RPE. |
| `server.origins` | `[]` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Origins allowed: Origins besides RPE's own and Lumiverse's whose pages may call RPE: an address RPE or Lumiverse is published at, such as https://rpe.example. |
| `server.hosts` | `[]` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Names allowed: Names besides RPE's own address that requests may reach it by: a published address's host name, with :port to hold it to a port. |
| `server.maxBodyBytes` | `1048576` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest request: Bytes of the largest request body a route takes, unless the route says otherwise. Below 1024: Under 1 KiB most requests a page sends are refused. Above 1073741824: A request this large is held in memory whole while it is read. |
| `server.maxProviderBodyBytes` | `33554432` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest prompt: Bytes of the largest request Lumiverse's generations may send RPE: a whole assembled prompt, its pictures included. Below 1024: Under 1 KiB every assembled prompt is refused. Above 1073741824: A prompt this large is held in memory whole while it is read. |
| `server.preflightSeconds` | `600` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Preflight kept: Seconds a browser may keep RPE's answer to a page's preflight before it asks again. Above 86400: Browsers keep a preflight's answer a day at most (Chrome two hours): a longer time changes nothing. |
| `server.idleSeconds` | `60` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Idle connection closed after: Seconds a connection may send and be sent nothing before RPE closes it; 0 for no bound. A reply's stream and the live socket stay open by what they send. |
| `server.headroomBytes` | `1048576` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Room above the largest request: Bytes above the largest body any route takes at which the server itself refuses a request, so that each route refuses a body over its own limit in its own words first. Above 1073741824: The server reads over 1 GiB past a route's limit before it refuses a request. |
| `server.answerKeepSeconds` | `300` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A long request's answer kept: Seconds the answer of a request RPE answered at once with an id is kept, once ready, for the page to read; one never read is dropped then. Above 86400: An answer never read is kept over a day. |
| `server.workerParseBytes` | `1048576` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Parsed on a worker from: Bytes from which a request's body is parsed on a worker thread, so that a long prompt's parse never holds up another request. Below 1024: Nearly every request's body is parsed on a worker, which costs more than it saves. Above 1073741824: No request's body is parsed on a worker: a long prompt's parse holds up the others. |

### Sign-in and tokens

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `auth.pageTokenMinutes` | `30` minutes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A page token holds: Minutes a page token holds before the page needs a new one. Above 10080: A page token that holds over a week lets a page lost or copied in that time call RPE. |
| `auth.commandLineSeconds` | `60` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line's token holds: Seconds the token the command line makes to call the running server holds. Below 5: A slow command may find its token run out before RPE answers it. Above 3600: The command line's token holds over an hour after the command that made it. |
| `auth.webKeyDays` | none (no end: it holds until a new one replaces it) | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The web app's key holds: Days the web app's key holds after it is made. Above 36500: Over a hundred years: none makes a key that holds until a new one replaces it. |
| `auth.webSessionMinutes` | `30` minutes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A web session holds: Minutes a session of the web app holds, which the printed token or a Lumiverse sign-in opens; it is renewed while a page is open. Above 10080: A web session left open holds over a week. |
| `auth.nonceSeconds` | `60` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A page's nonce is remembered: Seconds RPE remembers a nonce a page sent for its proof that this is RPE; the same nonce is not answered twice within them. Above 3600: RPE remembers every page's nonces for over an hour. |
| `auth.signInTries` | `4` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wrong Lumiverse passwords tried: Wrong Lumiverse passwords RPE sends Lumiverse before it pauses; at most 4, below the 5 after which Lumiverse locks RPE's own address out. Above 4: Lumiverse locks RPE's own address out after 5 wrong passwords. |
| `auth.signInPauseMinutes` | `15` minutes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Pause after wrong Lumiverse passwords: Minutes RPE sends Lumiverse no password after the wrong ones the setting before allows. Above 1440: After wrong passwords RPE sends Lumiverse none for over a day. |

### The live socket

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `liveSocket.queueEvents` | `512` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Events held for a slow page: Events the live socket holds for one slow page following one chat; past it the oldest are dropped, and the page is told which. Above 1000000: Over a million events are held in RPE's memory for one slow page. |
| `liveSocket.maxMessageBytes` | `65536` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Largest live message: Bytes of the largest message a page may send on the live socket. Below 256: A page's own messages on the live socket (a follow, a renewal) take up to 256 bytes, and are refused. Above 16777216: A page may send a message this large, held whole in memory. |
| `liveSocket.maxFollows` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Chats one live socket follows: The most chats one page's live socket may follow at once; the user's jobs and his own events count as one each. Above 100000: One page may follow over 100,000 chats at once. |
| `liveSocket.maxChatIdChars` | `200` characters | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Longest chat id followed: The most characters of a chat id a page may follow on the live socket; a longer one is refused. Above 10000: A chat id this long is held for each follow. |
| `liveSocket.atOnce` | `64` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Live sockets open at once: The most live sockets RPE keeps open at once; one more is closed at once with the reason. Above 100000: Over 100,000 live sockets may stay open at once. |

### The database

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `database.busyMs` | `5000` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wait for another writer: Milliseconds a write waits for another program's write to RPE's database file to finish. Above 600000: A write waits over ten minutes for another program's write. |
| `database.sliceMs` | `10` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Writes run at a time: Milliseconds the write queue runs writes before it lets other work in. Above 10000: The write queue runs writes over ten seconds at a time while other work waits. |
| `database.indexBatch` | `500` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Index rows written at once: Rows the index file's writer writes in one transaction. Above 100000: Over 100,000 rows are written in one transaction, which holds the index file that long. |
| `database.copiesKept` | `3` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Copies before migrations kept: Copies of RPE's database taken before a new version's migrations that are kept; the oldest are removed once a new version has started. rpe backup's archives and the migration's backups are never removed. Above 1000: Over 1000 copies of RPE's database are kept on disk. |

### The command line

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `commandLine.waitMs` | `3000` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for RPE: Milliseconds rpe status and rpe connection wait for the running server, and a command waits for the data folder's lock. Below 100: A command seldom finds the running server within a tenth of a second. Above 600000: A command waits over ten minutes for the running server. |
| `commandLine.signInMs` | `30000` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The command line waits for a sign-in: Milliseconds rpe lumiverse waits for Lumiverse to answer its sign-in. Below 1000: Lumiverse seldom answers a sign-in within a second. Above 600000: rpe lumiverse waits over ten minutes for a sign-in. |
| `commandLine.startMs` | `30000` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | rpe up waits for RPE to start: Milliseconds rpe up waits for RPE to answer once it has started RPE's service, before it puts back what it did. Below 1000: RPE seldom starts within a second, and rpe up then puts back what it did. Above 600000: rpe up waits over ten minutes for RPE to start. |
| `commandLine.askEveryMs` | `250` ms | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | rpe up asks whether RPE answers every: Milliseconds between rpe up's asks whether RPE answers yet, while it waits for RPE's service to start. Below 10: rpe up asks over a hundred times a second. Above 60000: rpe up asks less than once a minute, so it sees RPE up late. |

### The service

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `service.lastPort` | `7899` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The highest port rpe up tries: The highest port rpe up tries when RPE's port is taken, counting up from it; rpe up then keeps the first free one. |
| `service.memory` | `1G` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Memory RPE's service may hold: The most memory RPE's service may hold, as systemd reads a size (768M, 2G) or infinity for none, at least 256M: the unit's MemoryMax. rpe up --memory sets it; the service holds to it from the next rpe up --systemd. |
| `service.restartWaitSeconds` | `2` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Wait before the service starts RPE again: Seconds the service manager waits before it starts RPE again once it has stopped: the unit's RestartSec, written by rpe up --systemd. Above 3600: The service waits over an hour before it starts RPE again. |
| `service.logLines` | `2000` lines | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Log lines RPE keeps: How many of its own newest log lines RPE keeps for the Runtime page, each with its level, time, area and the chat, turn or job it names; older ones are let go. Below 100: Fewer than 100 log lines keep little of what happened. Above 1000000: Over a million log lines are held in RPE's memory. |
| `service.timingsTurns` | `100` | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Turns the timings take in: How many of the latest turns, of a chat or of all chats, the Runtime page's timings of the parts of a turn are taken over. Above 10000: The timings are worked out over more than 10,000 turns at each read. |
| `service.drainWaitSeconds` | `300` seconds | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | A later rpe up waits for turns to end: Seconds a later rpe up waits for the turns under way to end before it restarts RPE's service; it restarts it at the end of the wait all the same. Above 86400: A later rpe up waits over a day for turns to end. |

### Switches

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `switches.maxNameChars` | `200` characters | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | The longest name a switch takes: Characters in the longest name of a hook, a command, an MCP server or a connection's place that RPE's registry of what is switched on takes; a longer name is refused. Above 10000: A name this long is kept for every switch. |

### Worker threads

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `workers.threads` | none (the machine's cores less one, at least one) | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Worker threads: The most worker threads RPE runs its heavy work on at once: parsing very large requests, searching. Above 256: Over 256 worker threads at once, more than a machine has cores. |

### Backups

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `backup.pieceBytes` | `1048576` bytes | RPE-global.yml | from RPE's next start | beyond Appendix D.1, for the owner's approval | Archive piece: Bytes an archive (rpe backup's, the migration's backup) reads each file in at a time. Below 4096: An archive reads each file a few bytes at a time. Above 67108864: An archive holds over 64 MiB of a file in memory at once. |

## Migration

What the migration from the earlier build carries.

### The migration

| Setting | Default | Where | In force | Appendix D.1 | What it does |
|---|---|---|---|---|---|
| `migration.rows` | `[]` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Rows you give to what the migration finds: A file the migration finds that no row of its table names fails the report by name. A row given here (its path, what becomes of it, and your line saying what it is) is counted, kept in the backup and listed in the report as yours; nothing is carried that has no reader. |
| `migration.page` | `20` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Carried turns per page: How many of a migrated chat's turns a page of its list of carried turns holds, each with what the old engine recorded of it. Above 1000: Over 1000 carried turns, each with what the old engine recorded, are read and drawn on one page. |
| `migration.maxPage` | `200` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | Most carried turns a page may ask for: The most carried turns one request for a chat's list may ask for with `limit`; a larger ask is given this many. Above 5000: One request may ask for over 5000 carried turns, each read whole from the old records. |
| `migration.previousBranch` | `before-standalone` | RPE-global.yml | at its next use | beyond Appendix D.1, for the owner's approval | The previous build's branch: The branch of the extension's repository the previous build is kept on: going back switches the installed extension to it, and rpe down, the Migration page and the migration's report name it. |

## The install: config.json

`config.json` in RPE's data folder holds the install's facts, not settings: which Lumiverse RPE serves and as which user, its database file, the port RPE's connection in Lumiverse points at, and that connection with its models. The command line writes them (`rpe up`, `rpe lumiverse`); the Settings page lists them and never writes them. `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER` in the environment win over `port`, `lumiverse.url` and `lumiverse.user`. A `config.json` of an earlier build that still holds limits has them moved into `RPE-global.yml` at RPE's first start, each value kept.

| Key | Default | What it is |
|---|---|---|
| `lumiverse.url` | none | Lumiverse's address |
| `lumiverse.user` | none | Your Lumiverse user |
| `lumiverse.database` | none | Lumiverse's database file |
| `port` | `7871` | RPE's port, on loopback, that its connection in Lumiverse points at |
| `lumiverse.connections` | `[]` | RPE's connections in Lumiverse |
| `lumiverse.models` | `["rpe"]` | The models that connection offers |
