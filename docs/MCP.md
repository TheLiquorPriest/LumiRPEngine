# The lumirpengine command line and MCP server

`lumirpengine` lets your own agent (Claude Code, Codex, Cursor, omp…) or your shell manage your LumiRPEngine worlds on your Lumiverse: read, search, create, import, edit, check, playtest, commit, restore, delete and export them, and attach and upgrade the chats that play them. It is an MCP server (`lumirpengine mcp`) and a command line with the same tools. It needs Node 22 or newer and nothing else; the engine is bundled in, so the offline tools work without a Lumiverse. How it reaches LumiRPEngine is DESIGN §23. Agents should read [AGENT-GUIDE.md](AGENT-GUIDE.md) first (the `lre_guide` tool serves it).

## Setup

Install it once with npm, then sign in once, in a terminal. The password is asked at a hidden prompt (or read from `LUMIVERSE_PASSWORD`), never taken as an argument, and never stored:

```bash
npm i -g github:TheLiquorPriest/LumiRPEngine
lumirpengine login --url http://localhost:7860 --username you
```

`--url` is the address you open Lumiverse at in your browser (or set `LUMIVERSE_URL`); `--username` can come from `LUMIVERSE_USERNAME`. Plain `http` to another machine needs `--allow-http` (see [Safety](#safety)). The session token is saved in `~/.config/lumirpengine/credentials.json` (`$XDG_CONFIG_HOME/lumirpengine/` when set, `%APPDATA%\lumirpengine\` on Windows), readable only by you. `status` shows where you are signed in and whether LumiRPEngine answers there; `logout` ends the session on Lumiverse and deletes the token. Sign in again whenever you like: a running `mcp` server takes up the new sign-in at its next call, without a restart, and after a `logout` it drops its connection at its next call.

The install downloads this repo's package from GitHub (about 14 MB) and puts `lumirpengine` on your PATH. `github:TheLiquorPriest/LumiRPEngine` follows the default branch: pin a release or a commit with `github:TheLiquorPriest/LumiRPEngine#<tag or commit>`, so that an update reaches you only when you install again. The same `npm i -g` updates it, and `npm rm -g lumi-rp-engine` removes it.

Then add the server to your harness. Its config holds no password:

```bash
claude mcp add lumirpengine -- lumirpengine mcp
codex mcp add lumirpengine -- lumirpengine mcp
```

Cursor (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project):

```json
{ "mcpServers": { "lumirpengine": { "command": "lumirpengine", "args": ["mcp"] } } }
```

Installed, the server answers a harness in about a tenth of a second (measured on one machine), well inside any start-up timeout.

### Follow LumiRPEngine's updates

`lumirpengine` is two files: a small core (`dist/lumirpengine.js`: the MCP transport, the sign-in and the connection) and the agent kit beside it (`dist/agent-kit.js`: every tool, this guide's text, the docs, the schema, the starters and the engine). A running `mcp` server follows the LumiRPEngine it is connected to: LumiRPEngine tells it which build it is, where its own kit is (`<Lumiverse data>/extensions/lumi_rp_engine/repo/dist/agent-kit.js`) and the kit's sha256, and when that file is on this machine and hashes so, the server loads it, swaps its tools and sends `notifications/tools/list_changed`, with no reinstall or restart. `lre_guide` and `lre_docs` then serve the new build's text. It looks when it connects (at start), before a call once its last look is 30 seconds old, every minute while connected, and when you press **Update now** in Lumiverse. It needs to run on the machine Lumiverse runs on, as a user who can read Lumiverse's extensions folder; a harness that ignores `list_changed` gets the new list when it next restarts the server (calls already use the new tools).

The setup that follows the extension best runs the extension's own copy, so its core stays current too. **Settings → MCP server** in LumiRPEngine shows the command with its absolute path, to copy:

```bash
node <Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js login --url http://localhost:7860 --username you
claude mcp add lumirpengine -- node <Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js mcp
```

A server installed with npm or run with npx follows the extension's kit as well, from this version on; one from before needs the install above once. `lumirpengine mcp --pin` (or `LRE_PIN_KIT=1`) keeps the kit it was installed with. The command line, unlike `mcp`, runs the tools it was installed with: run the extension's copy (`node …/dist/lumirpengine.js <command>`) to have the current ones. `lre_status` says which builds a server runs (`client.build` its tools, `client.core` its core) and whether it follows, and why not.

Each server checks in with LumiRPEngine when it connects and after each change: its builds, whether it follows (and why not) and its machine's name. After LumiRPEngine updates, the drawer shows **LumiRPEngine updated** with a line for each server: reloaded this build's tools; not yet, with **Update now**; can't follow, with why and what to do; or from before this, with the one-time install. A server Lumiverse runs itself (Settings → MCP servers, owner and admins) can be restarted from there, and an npm or npx one switched to the extension's own copy.

### Without installing: npx

`npx -y github:TheLiquorPriest/LumiRPEngine <command>` runs any command without an install, `login` and `mcp` included, and takes the same `#<tag or commit>`. But npx looks the GitHub ref up again on every launch, so the server takes about 9 s to answer the first time and still about 7 s after that (on the same machine; yours will differ), and npx needs GitHub reachable to start at all, even for the offline tools. That is close to Codex's default start-up timeout of 10 s, and past the 1 s Codex waits for an optional server before it lists the tools for the first turn. In Codex, give it the time in `~/.codex/config.toml`:

```toml
# Top-level, above any [table]: how long Codex waits for slow servers before its first tool list (1000 by default).
mcp_optional_startup_grace_ms = 15000

[mcp_servers.lumirpengine]
command = "npx"
args = ["-y", "github:TheLiquorPriest/LumiRPEngine", "mcp"]
startup_timeout_sec = 60
```

Any other harness with a start-up timeout needs the same allowance, or the installed command.

In a clone of this repo, `.mcp.json` declares the same server as `node dist/lumirpengine.js mcp`. Signed in to several Lumiverses? Add `--url <base>` after `mcp`. The agent skill is [`skills/lumirpengine/SKILL.md`](../skills/lumirpengine/SKILL.md).

## The tools

Every answer is text, JSON for data, of at most about 24,000 characters; a large value comes back as an outline (keys, counts and ids) to read deeper from by JSON Pointer, or page by `offset`. Each command line command runs one tool: `lumirpengine world <id>` is `lre_world`, `create`, `import`, `delete` and `export` are `lre_world_create`, `lre_world_import`, `lre_world_delete` and `lre_world_export`, and `check-world` is `lre_check_world`. `lumirpengine help` lists them. Each tool carries MCP's annotations (read-only, destructive, idempotent), which a harness can use to decide what to ask you about first.

| Tool | What it does |
|---|---|
| `lre_guide {topic?}` | The agent guide, or one section of it ("Money", "Holdings and property", "Character minds"). |
| `lre_docs {query, doc?}` | The best-matching sections of the reference, expressions, recipes, design, user guide, Studio contract and presets docs. |
| `lre_schema {pointer?, schema?, offset?}` | The world (or map) JSON Schema at a pointer. |
| `lre_templates` / `lre_template {id, pointer?, offset?}` | The starter worlds; one as an export file. |
| `lre_check {path? \| world?}` | Shape, migration, lint and macro hazards, offline, with the world's items counted and its entities by kind. |
| `lre_playtest {path? \| world? \| worldId?, source?, turns}` | Typed turns through the bundled engine, no narrator, no model, so no character mind. |
| `lre_check_world {path? \| world? \| worldId?, source?, days?}` | Simulated days from the start, flows and pay included. Both note when the world was written by another engine version. |
| `lre_status` | Host, user, session, LumiRPEngine there and its agent API, this client's versions. |
| `lre_worlds` | Your worlds, with head and revision count, and the draft's state and version. It reads each world's draft: a request per world. |
| `lre_world {worldId, source?, pointer?, offset?}` | A world's draft (default), head or a revision. |
| `lre_search {query, worldId?, collections?, kinds?, limit?}` | Words in your worlds' heads and stored drafts: world, item (with its pointer, and its kind for an entity) and field per hit. Money is mostly entities, so `kinds` (`flow`, `account`, `job`, `household`…) narrows to them; the economy's `products` and `assets` are searched one by one. It reads every world it searches whole, so pass `worldId` when you can; a world it can't read is listed as skipped. |
| `lre_world_create {name, template?}` / `lre_world_import {path? \| world?}` | A new world, blank, from a starter or from a file. |
| `lre_edit {worldId, ops, expectVersion?}` | JSON Patch on the draft: the new version, what changed, the first lint issues, new macro hazards. |
| `lre_draft {worldId}` / `lre_diff {worldId, from?, to?}` | The draft's state, lint and changes; an item-by-item diff with the pointers that differ. A pack's products and assets count as items of their own. |
| `lre_commit {worldId, note?, expectVersion?}` / `lre_discard {worldId, expectVersion?}` | The draft becomes the head (with a note in its history), or goes. With `expectVersion`, refused if the draft moved on since that version. |
| `lre_history {worldId}` / `lre_restore {worldId, revision, expectVersion?}` | How each revision became head; a draft copied from an old revision. |
| `lre_world_delete {worldId, confirm?}` | Without `confirm`, what deleting the world would remove and leave behind; with `confirm`, its exact name, deletes it for good. |
| `lre_world_export {worldId, revision?, offset?}` | The export file, paged (`lumirpengine export <id> --out <file>` writes it whole). |
| `lre_chats {worldId?}` / `lre_attach {worldId, chatId}` | The chats that play a world; attach a world to a chat. |
| `lre_upgrade {chatId, to?, preview?, spoilers?}` | Preview an Upgrade (hidden changes stay hidden without `spoilers`), or apply it with the default picks. |

## Read-only mode

`lumirpengine mcp --read-only` (or `LRE_READ_ONLY=1`) leaves the write tools (`lre_world_create`, `lre_world_import`, `lre_edit`, `lre_commit`, `lre_discard`, `lre_restore`, `lre_world_delete`, `lre_attach`, `lre_upgrade`) out of `tools/list`, and refuses them if called. The command line honours the same flag. `LRE_READ_ONLY` takes `1`, `true`, `yes` or `on`, or `0`, `false`, `no`, `off` or nothing, in any case. Any other value, or an option `mcp` doesn't take (a misspelled `--read-only`), stops it from starting rather than serve the write tools.

Read-only limits what this MCP server offers, not what your agent can do. An agent that can run commands (Claude Code, Codex and the like) can still run `lumirpengine` without the flag, or read the saved token and use it against Lumiverse directly. It keeps an agent that has only these tools to reading; it doesn't fence in one with a shell.

## Safety

- **A server loads only the kit LumiRPEngine names, on this machine, laid out as an installed extension's.** It loads a local file whose path ends with `/extensions/lumi_rp_engine/repo/dist/agent-kit.js` (either separator), whose sha256 is the one the running extension was built with, and it imports the very bytes it hashed. Anything else (another machine, a file it can't read, another hash, another path) keeps the tools it has, and the check-in and `lre_status` say why. The kit runs with your permissions, as the installed copy does; `--pin` (or `LRE_PIN_KIT=1`) keeps the installed one whatever LumiRPEngine says.
- **The check-in names your machine.** Each MCP server tells LumiRPEngine its host name and builds, kept in your Lumiverse account's storage and shown only to you, in Settings → MCP server and the update notice.
- **The token is a whole-account session.** It is what your browser holds when you are signed in, valid for 7 days and extended by use, and the credentials file is readable by every program you run as yourself, your agent included. `logout` ends the session on Lumiverse as well as deleting it. When Lumiverse can't be reached or doesn't confirm, `logout` says so: the session then stays valid until it expires, after 7 days unused.
- **To cut an agent off, run `lumirpengine logout` on its machine, or stop its harness.** Lumiverse trusts an open event socket for as long as it stays open, even after the session it was opened with has ended. `logout` on the machine the agent runs on deletes the saved sign-in, and a running `mcp` server then drops its socket at its next call. A session that ends any other way (revoked from elsewhere, expired, or ended by a password change, which ends every other session of the account) leaves a running server able to act until its harness stops it.
- **Plain `http` to another machine sends it in clear.** Your password at sign-in, and the token on every call after, cross the network readable by anyone on the way, who can then use your account. `login` refuses that unless you pass `--allow-http`, which is saved with the sign-in, so `mcp` and the other commands need no flag. `localhost` and `127.0.0.1` never leave the machine. Before it sends your password, `login` asks Lumiverse as nobody, and stops if the address redirects to https: sign in at the https address instead.
- **Harness configs hold no password**, only the command. Sign-ins happen in your terminal.
- **`path` arguments read files on this machine.** `lre_check`, `lre_playtest`, `lre_check_world` and `lre_world_import` read the file a `path` names, with your permissions: an agent can point them at any file you can read, and an error can quote part of one that isn't a world.
- **Drafts are shared with Build.** An agent edits the same draft you see in Build, and you see its changes as it makes them. Each write names the draft version it read, Build's too, so neither of you overwrites the other unseen. But a commit takes the whole draft: your Commit in Build commits the agent's unfinished work, and the agent's commit carries yours. Agents are told to ask you before they touch a draft that was already there when they started, and to commit or discard every draft they start.
- **Macros an agent writes skip your review.** Importing a world in Build or installing one from the Studio shows you the macros in its lore and templates first. The macros `lre_edit` and `lre_world_import` bring in are reported to the agent only: read what an agent wrote into lore and templates before you play it.
- **Deleting a world needs its exact name.** Without it, `lre_world_delete` only says what it would delete. Deleting leaves two things behind. The world's engine lore book, "LumiRPEngine · " and the world's name, stays in World Books and stays attached to the world's chats; its entries are stored disabled, so it adds nothing to a prompt, but you delete it there yourself. And those chats lose their world: `lre_chats` no longer lists them.
- Commits from this client are labelled `agent` in the world's history.

## Troubleshooting

- **403 Forbidden.** Lumiverse answers only on its trusted hosts. Use the exact address you open it at in your browser; for a name or address it doesn't know, add it under the Operator panel's trusted hosts, or to `TRUSTED_ORIGINS` (with its scheme and port) on the server.
- **"Too many attempts", or "refusing every request from this address".** Sign-in allows 8 attempts per 5 minutes from one address. After 5 failed sign-ins, Lumiverse locks that address out of every request, your browser on the same machine included: for 15 minutes, then 30, 1 hour and 6 hours, and doubling from there up to 7 days, each lockout longer than the last. That is why the client signs in once and keeps the token. Wait it out, then `login` once.
- **"… is plain http to another machine".** See [Safety](#safety): use Lumiverse's https address, or sign in with `--allow-http` if the network is yours. **"… answers on https"**: sign in at the https address it names.
- **"The event socket … never opened (1006)".** Behind a reverse proxy, the proxy must pass WebSocket upgrades on `/api/ws`, as it does for the browser.
- **"Your Lumiverse session … is no longer valid".** It expired, or was signed out: run `lumirpengine login` again. A running `mcp` server picks the new sign-in up by itself.
- **"LumiRPEngine … is too old for lumirpengine".** The extension on your Lumiverse predates the agent API this client needs: update LumiRPEngine in the Extensions tab.
- **No answer within 60 s.** LumiRPEngine isn't running, or is busy: `lumirpengine status` says which. A write that timed out may still have been made; check before repeating it.
- **A request over 4 MiB** is refused by the client, since Lumiverse would drop it without a word: import or edit in smaller pieces.
