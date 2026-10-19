# The lumirpengine command line and MCP server

`lumirpengine` lets your own agent (Claude Code, Codex, Cursor, omp…) or your shell manage your LumiRPEngine worlds on your Lumiverse: read, search, create, import, edit, check, playtest, commit, restore, delete and export them, and attach and upgrade the chats that play them. It is an MCP server (`lumirpengine mcp`) and a command line with the same tools. It needs Node 22 or newer and nothing else; the engine is bundled in, so the offline tools work without a Lumiverse. How it reaches LumiRPEngine is DESIGN §23. Agents should read [AGENT-GUIDE.md](AGENT-GUIDE.md) first (the `lre_guide` tool serves it).

## Setup

Sign in once, in a terminal. The password is asked at a hidden prompt (or read from `LUMIVERSE_PASSWORD`), never taken as an argument, and never stored:

```bash
npx -y github:TheLiquorPriest/LumiRPEngine login --url http://localhost:7860 --username you
```

`--url` is the address you open Lumiverse at in your browser (or set `LUMIVERSE_URL`); `--username` can come from `LUMIVERSE_USERNAME`. The session token is saved in `~/.config/lumirpengine/credentials.json` (`$XDG_CONFIG_HOME/lumirpengine/` when set, `%APPDATA%\lumirpengine\` on Windows), readable only by you. `status` shows where you are signed in and whether LumiRPEngine answers there; `logout` signs out and deletes the token.

Then add the server to your harness. Its config holds no password:

```bash
claude mcp add lumirpengine -- npx -y github:TheLiquorPriest/LumiRPEngine mcp
codex mcp add lumirpengine -- npx -y github:TheLiquorPriest/LumiRPEngine mcp
```

Cursor (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project):

```json
{ "mcpServers": { "lumirpengine": { "command": "npx", "args": ["-y", "github:TheLiquorPriest/LumiRPEngine", "mcp"] } } }
```

In a clone of this repo, `.mcp.json` declares the same server as `node dist/lumirpengine.js mcp`. Signed in to several Lumiverses? Add `--url <base>` after `mcp`. The agent skill is [`skills/lumirpengine/SKILL.md`](../skills/lumirpengine/SKILL.md).

## The tools

Every answer is text, JSON for data, of at most about 24,000 characters; a large value comes back as an outline (keys, counts and ids) to read deeper from by JSON Pointer, or page by `offset`. Each command line command runs the tool of the same name (`lumirpengine world <id>` is `lre_world`); `lumirpengine help` lists them.

| Tool | What it does |
|---|---|
| `lre_guide {topic?}` | The agent guide, or one section of it. |
| `lre_docs {query, doc?}` | The best-matching sections of the reference, expressions, recipes, design, user guide, Studio contract and presets docs. |
| `lre_schema {pointer?, schema?, offset?}` | The world (or map) JSON Schema at a pointer. |
| `lre_templates` / `lre_template {id, pointer?, offset?}` | The starter worlds; one as an export file. |
| `lre_check {path? \| world?}` | Shape, migration, lint and macro hazards, offline. |
| `lre_playtest {path? \| world? \| worldId?, source?, turns}` | Typed turns through the bundled engine, no narrator, no model. |
| `lre_check_world {path? \| world? \| worldId?, source?, days?}` | Simulated days from the start. Both note when the world was written by another engine version. |
| `lre_status` | Host, user, session, LumiRPEngine there and its agent API, this client's versions. |
| `lre_worlds` | Your worlds, with head, revision and history counts, and the draft's state and version. |
| `lre_world {worldId, source?, pointer?, offset?}` | A world's draft (default), head or a revision. |
| `lre_search {query, worldId?, collections?, limit?}` | Words in your worlds' heads and stored drafts: world, item and field per hit. |
| `lre_world_create {name, template?}` / `lre_world_import {path? \| world?}` | A new world, blank, from a starter or from a file. |
| `lre_edit {worldId, ops, expectVersion?}` | JSON Patch on the draft: the new version, what changed, the first lint issues, new macro hazards. |
| `lre_draft {worldId}` / `lre_diff {worldId, from?, to?}` | The draft's state, lint and changes; an item-by-item diff with the pointers that differ. |
| `lre_commit {worldId, note?}` / `lre_discard {worldId}` | The draft becomes the head (with a note in its history), or goes. |
| `lre_history {worldId}` / `lre_restore {worldId, revision}` | How each revision became head; a draft copied from an old revision. |
| `lre_world_delete {worldId, confirm}` | Deletes a world for good; `confirm` must be its exact name. |
| `lre_world_export {worldId, revision?, offset?}` | The export file, paged (`lumirpengine export <id> --out <file>` writes it whole). |
| `lre_chats {worldId?}` / `lre_attach {worldId, chatId}` | The chats that play a world; attach a world to a chat. |
| `lre_upgrade {chatId, to?, preview?, spoilers?}` | Preview an Upgrade (hidden changes stay hidden without `spoilers`), or apply it with the default picks. |

## Read-only mode

`lumirpengine mcp --read-only` (or `LRE_READ_ONLY=1`) leaves the write tools (`lre_world_create`, `lre_world_import`, `lre_edit`, `lre_commit`, `lre_discard`, `lre_restore`, `lre_world_delete`, `lre_attach`, `lre_upgrade`) out of `tools/list`, and refuses them if called. The command line honours the same flag.

## Safety

- **The token is a whole-account session.** It is what your browser holds when you are signed in, valid for 7 days and extended by use. Keep the credentials file to yourself; `logout` ends the session on Lumiverse as well as deleting it.
- **Harness configs hold no password**, only the command. Sign-ins happen in your terminal.
- **Drafts are shared with Build.** An agent edits the same draft you see in Build, and you see its changes as it makes them. Each edit names the draft version it read, so neither of you overwrites the other unseen. Agents are told to commit or discard every draft they start.
- **Deleting a world needs its exact name.** Without it, `lre_world_delete` only says what it would delete.
- Commits from this client are labelled `agent` in the world's history.

## Troubleshooting

- **403 Forbidden.** Lumiverse answers only on its trusted hosts. Use the exact address you open it at in your browser; for a name or address it doesn't know, add it under the Operator panel's trusted hosts, or to `TRUSTED_ORIGINS` (with its scheme and port) on the server.
- **"Too many attempts" or a lockout.** Sign-in allows 8 attempts per 5 minutes from one address, and 5 failures lock the address out for a while. That is why the client signs in once and keeps the token: wait, then `login` once more.
- **"The event socket … never opened (1006)".** Behind a reverse proxy, the proxy must pass WebSocket upgrades on `/api/ws`, as it does for the browser.
- **"Your Lumiverse session … is no longer valid".** It expired, or was signed out: run `lumirpengine login` again.
- **"LumiRPEngine … is too old for lumirpengine".** The extension on your Lumiverse predates the agent API this client needs: update LumiRPEngine in the Extensions tab.
- **No answer within 60 s.** LumiRPEngine isn't running, or is busy: `lumirpengine status` says which. A write that timed out may still have been made; check before repeating it.
- **A request over 4 MiB** is refused by the client, since Lumiverse would drop it without a word: import or edit in smaller pieces.
