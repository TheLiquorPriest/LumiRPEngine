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

`lumirpengine` is two files: a small core (`dist/lumirpengine.js`: the MCP transport, the sign-in and the connection) and the agent kit beside it (`dist/agent-kit.js`: every tool, this guide's text, the docs, the schema, the starters and the engine). A running `mcp` server follows the LumiRPEngine it is connected to: LumiRPEngine tells it which build it is, where its own kit is (`<Lumiverse data>/extensions/lumi_rp_engine/repo/dist/agent-kit.js`) and the kit's sha256, and when that file is on this machine, no other user can change it and it hashes so (see [Safety](#safety)), the server loads it, swaps its tools and sends `notifications/tools/list_changed`, with no reinstall or restart. `lre_guide` and `lre_docs` then serve the new build's text. It looks when it connects (when your harness starts it), before a call once its last look is 30 seconds old, every minute while connected, and when you press **Update now** in Lumiverse. It needs to run on the machine Lumiverse runs on, as a user who can read Lumiverse's extensions folder; on Linux and macOS, the kit and the folders it sits in, up to `extensions/`, must belong to that user or root and be writable by no one else. A harness that ignores `list_changed` gets the new list when it next restarts the server (calls already use the new tools).

The setup that follows the extension best runs the extension's own copy, so its core stays current too. **Settings → MCP server** in LumiRPEngine shows the command with its absolute path, to copy:

```bash
node <Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js login --url http://localhost:7860 --username you
claude mcp add lumirpengine -- node <Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js mcp
```

A server installed with npm or run with npx follows the extension's kit as well, from this version on; one from before needs the install above once. `lumirpengine mcp --pin` (or `LRE_PIN_KIT=1`) keeps the kit it was installed with. The command line, unlike `mcp`, runs the tools it was installed with: run the extension's copy (`node …/dist/lumirpengine.js <command>`) to have the current ones. `lre_status` says which builds a server runs (`client.build` its tools, `client.core` its core) and whether it follows, and why not.

Each server checks in with LumiRPEngine when it connects and after each change: its builds, whether it follows (and why not), its machine's name and the harness that runs it (the name your agent gives its MCP client, such as `claude-code` or `codex`). Settings → MCP server lists each harness's server on each machine as a line of its own ("lumirpengine for claude-code on studio"); a restarted server, or a second one from the same harness on the same machine, keeps its line. A line with more than one process (two Claude Code windows on one machine) says how many ("2 processes") and stands as the one furthest behind: it reads as reloaded only once every process heard from in the last 2 minutes has reloaded, so a process that lags isn't hidden by one that reloaded. After LumiRPEngine updates, the drawer shows **LumiRPEngine updated** with a line for each server: reloaded this build's tools; not yet, with **Update now**; can't follow, with why and what to do; or from before this, with the one-time install.

Lumiverse can run the server itself (Lumiverse's Settings → MCP Servers, **Add MCP Server**, Stdio): give it the command `node` and the arguments `<Lumiverse data>/extensions/lumi_rp_engine/repo/dist/lumirpengine.js, mcp`, and sign in once first, as the user Lumiverse runs as. Lumiverse runs only `node`, `bun`, `deno` and `python` there (its stdio allowlist), not `lumirpengine`, so the npm install's command isn't one it takes. It passes the server only `PATH` and the variables you set there: if your shell sets `XDG_CONFIG_HOME`, set it there too, or the server won't find your sign-in. That server checks in like any other, as "lumirpengine for lumiverse" (the name Lumiverse's MCP client gives itself), and follows each update; but Lumiverse's MCP client reads a server's tools only when it connects, so once the server has reloaded, its line says so: in Lumiverse's Settings → MCP Servers, **Disconnect** it and **Connect** it again for Lumiverse's models to see the new tools. LumiRPEngine doesn't restart or change Lumiverse's servers itself: their routes are Lumiverse's own, not Spindle's, and an extension that set the command Lumiverse runs would be running code outside Spindle's sandbox.

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

Every answer is text, JSON for data, of at most about 24,000 characters; a large value comes back as an outline (keys, counts and ids) to read deeper from by JSON Pointer, or page by `offset`. Each command line command runs one tool: `lumirpengine world <id>` is `lre_world`, `create`, `import`, `delete` and `export` are `lre_world_create`, `lre_world_import`, `lre_world_delete` and `lre_world_export`, and `check-world` is `lre_check_world`. The tools for settings, presets, diagnostics, lore, jobs and the rest of Build are commands named after them with dashes (`settings-set` is `lre_settings_set`, `job-apply` is `lre_job_apply`), and `caveats` is `lre_settings_caveats`. `lumirpengine help` lists them. Each tool carries MCP's annotations (read-only, destructive, idempotent), which a harness can use to decide what to ask you about first.

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
| `lre_settings {section?, pointer?, offset?}` | Your settings, every Settings page's part (helper model, model use, steps and connections, minds, timeouts, realism and player claims, checks, time, changes from the reply, swipes, JSON hiding), or one section or pointer; `extractionModes` shows each change type's effective mode. |
| `lre_settings_set {patch}` | A JSON merge patch over the settings, normalized as Settings does: a named preset expands, a change to what one sets makes it Custom. Answers the changed sections, what came out other than sent, and the caveats. |
| `lre_settings_caveats` | Settings → Caveats: what to know about the preset and the host now (it dry-runs the chat you play; ask again if it says it is still checking). |
| `lre_preset` / `lre_preset_add_blocks` | The active preset's outlets and engine guidance blocks (missing, empty, read or enabled); add the missing ones, switched off. |
| `lre_diag {chatId, spoilers?, last?, failures?}` | A chat's activity line, and its diagnostics records (steps, model calls, failures, sections, slow requests) only with `spoilers`. |
| `lre_diag_clear {chatId}` / `lre_activity_dismiss {chatId}` | Forget a chat's records; clear a failure from its activity line. |
| `lre_lore_books {chatId?}` / `lre_lore_entries {bookId, offset?}` | The World Info books a pin may name, and one book's entries. |
| `lre_lore_pins {worldId? \| chatId?, spoilers?, offset?}` | A world draft's lore pins, or a chat's (with `spoilers`), each read now: title, source, status. |
| `lre_lore_drift {worldId, id?, offset?}` / `lre_lore_save {chatId, text?}` | Book-sourced lore whose book entry changed or went; the chat's latest reply (or an excerpt) as a new lore entry in the draft. |
| `lre_job_start {worldId, kind, …}` | One of Build's jobs on your Lumiverse: `import_lore {bookIds}`, `index_book {bookId}`, `index_text {text}`, `refine {instructions}`, `describe_map {scope, prose, mapId?}`, `playtest {turns}`, `check_world {days?}`. Model jobs use your helper model. |
| `lre_jobs {worldId}` / `lre_job {worldId, jobId, pointer?, offset?}` | A world's jobs with their progress and what they found in counts; one job whole, its proposals or its run. |
| `lre_job_apply {worldId, jobId, proposals?, expectVersion?}` | Accepted proposals into the draft in one write, as Build's review applies them (lore lookup terms and topics included). |
| `lre_job_cancel {jobId}` / `lre_job_dismiss {jobId}` | Stop a running job; forget one that ended. |
| `lre_lint {worldId}` / `lre_sheet {worldId, ruleset?, entity?, offset?}` | The head's lint on your Lumiverse; the Sheet Designer's preview of the draft's ruleset (or one given). |
| `lre_profile {worldId, profile, take?, preview?, expectVersion?}` | A ruleset profile (`modern`, `classic`, `fifth`, `custom`) on the draft in one write, each conflict kept unless `take` names it; `preview` only says what it would do. |
| `lre_studio_offer` / `lre_studio_install {offerId, hash, acceptMovedHead?}` | LumiRPEngine Studio's offer, reviewed as Build does; install the one reviewed. |
| `lre_map_display {chatId, display}` / `lre_map_walk {chatId, x, y}` | How a chat's map shows (`knowledge` or `fog`); what Walk here to a cell takes. |
| `lre_chat_state {chatId, pointer?, offset?}` | A chat's state view as Play shows it (HUD and its ✎ fixes, scene, chips, journal, palette, controls, panels) with the engine's activity line: only what the player can know. |
| `lre_chips {chatId}` / `lre_chip {chatId, chip, choice, payload?}` | The chips under a chat's messages and their actions; answer one. |
| `lre_inspector {chatId, pointer?, offset?}` | The context inspector: the sections of the last ten engine runs, what their steps read of the lore, and the warnings. |
| `lre_gm {chatId, spoilers, pointer?, offset?}` | The GM view, secrets included. Needs `spoilers: true`. |
| `lre_gm_edit {chatId, spoilers, ops}` | GM edits (set, move, link, stage, spawn…), all or none, with an Undo chip. Needs `spoilers: true`. |
| `lre_fix {chatId, fix? \| entity?, field?, value? \| time?}` | A ✎ fix: place, weather, cash, scene type, any field the player may fix, or the clock. |
| `lre_marker {chatId, kind, to, domain?, control?, scope?, preview?}` | Realism, a time control, player claims, the checks policy or inferred checks, from the latest message on; `preview` writes nothing. |
| `lre_keep {chatId, choice, messageId, parentPath?, refs?}` | Keep, discard or convert after an earlier message was edited. |
| `lre_view_open {chatId, panel, entity?}` | Open a panel, settling detail the chat hadn't decided yet. |
| `lre_action {chatId, action, params?, text?}` / `lre_timelapse {chatId, target, overrides?, text?}` | Play a palette action or a timelapse as the player's next turn. The engine prepares it; Lumiverse starts the reply (see below). |
| `lre_minds {chatId, spoilers, pointer?, offset?}` / `lre_mind_edit {chatId, spoilers, ops}` | Characters' minds and the latest Run minds now; pin, refresh or edit them. Need `spoilers: true`. |
| `lre_minds_run {chatId, spoilers, who?}` / `lre_minds_cancel {chatId, runId}` | Run minds now, with model calls on your connection, or stop the run. |

Every request LumiRPEngine's protocol accepts, and every op of one, is mapped in `src/cli/coverage.ts` to the tools that send it, or to why none does (the page's handshake and visibility, its claim on a prepared reply, the active Loom preset only the page can see, closing the drawer, and Build's one-item saves that `lre_edit`'s patch covers). The typecheck fails when a new request has neither, so a new surface can't ship without tools.

The chat tools' commands are `chat`, `chips`, `chip`, `inspector`, `gm`, `gm-edit`, `fix`, `marker`, `keep`, `view-open`, `act`, `timelapse`, `minds`, `mind-edit`, `minds-run` and `minds-cancel`; `--spoilers` is `spoilers: true`, and a JSON argument (`--ops`, `--value`, `--to`, `--target`…) is inline or a file holding it.

**A turn needs Lumiverse for its reply.** `lre_action`, `lre_timelapse` and a suggested move's Send post the player's message, and the engine prepares the turn at once. The reply is started by the chat's page in Lumiverse: when the chat is open there it starts on its own, and otherwise it waits until you open the chat. This client never starts, regenerates or swipes a reply, so a chip action that does (Re-narrate, Re-run) takes effect on the next swipe you make. Reading a chat never makes this client a page: a reply waiting for one is still yours to start.

**Spoilers.** `lre_gm`, `lre_gm_edit`, `lre_minds`, `lre_mind_edit` and `lre_minds_run` show (or answer with) what the player isn't meant to know, so they refuse without `spoilers: true`, as `lre_upgrade`'s preview hides such changes without it; `lre_diag` shows a chat's diagnostics records, and `lre_lore_pins` a chat's pins, only with it. Everything else reads only what Play shows the player, or a world as its author does.

## Read-only mode

`lumirpengine mcp --read-only` (or `LRE_READ_ONLY=1`) leaves the write tools (`lre_world_create`, `lre_world_import`, `lre_edit`, `lre_commit`, `lre_discard`, `lre_restore`, `lre_world_delete`, `lre_attach`, `lre_upgrade`, `lre_settings_set`, `lre_preset_add_blocks`, `lre_diag_clear`, `lre_activity_dismiss`, `lre_lore_save`, `lre_job_start`, `lre_job_apply`, `lre_job_cancel`, `lre_job_dismiss`, `lre_profile`, `lre_studio_install`, `lre_map_display`) out of `tools/list`, and refuses them if called. The command line honours the same flag. `LRE_READ_ONLY` takes `1`, `true`, `yes` or `on`, or `0`, `false`, `no`, `off` or nothing, in any case. Any other value, or an option `mcp` doesn't take (a misspelled `--read-only`), stops it from starting rather than serve the write tools.

The chat tools' writes (`lre_fix`, `lre_gm_edit`, `lre_mind_edit`, `lre_marker`, `lre_chip`, `lre_keep`, `lre_view_open`, `lre_action`, `lre_timelapse`, `lre_minds_run`, `lre_minds_cancel`) are left out and refused the same way; `lre_chat_state`, `lre_chips`, `lre_inspector`, `lre_gm` and `lre_minds` stay.

Read-only limits what this MCP server offers, not what your agent can do. An agent that can run commands (Claude Code, Codex and the like) can still run `lumirpengine` without the flag, or read the saved token and use it against Lumiverse directly. It keeps an agent that has only these tools to reading; it doesn't fence in one with a shell.

## Safety

- **Following runs the LumiRPEngine installed on this machine, with your rights.** A server that follows runs the kit of the LumiRPEngine install in Lumiverse on this machine, as you: the same code the npm package runs, from the extension's own files. It never loads a file other users can change. It loads only a local file whose real path, every symlink resolved, ends with `/extensions/lumi_rp_engine/repo/dist/agent-kit.js` (either separator), and only when that file and each folder from `extensions/` down to `dist/` belong to you or root and are writable by no one else; otherwise its line says it can't follow because that path "can be changed by other users", naming the first that is. It imports the very bytes it checked. Windows has no such owners and mode bits, so there the ownership check is skipped: anyone who can write Lumiverse's extensions folder can choose the code a following server runs. The sha256 LumiRPEngine reports must match too, but that only catches a kit read while it was being written, or rebuilt since the extension started: it is LumiRPEngine's own word, so it is no guard against LumiRPEngine itself; the path and owner checks are. Anything else (another machine, a file it can't read, another hash, another path) keeps the tools it has, and the check-in and `lre_status` say why. `--pin` (or `LRE_PIN_KIT=1`) turns following off: the server keeps the tools it was installed with, whatever LumiRPEngine says.
- **A server under Bun follows from Bun 1.4 on.** The kit is imported as a data URL of a few megabytes, which Bun 1.4 loads and Bun 1.3 refuses; `lumirpengine` is a Node 22+ program, and the setup Settings → MCP server shows runs it with `node`.
- **The check-in names your machine.** Each MCP server tells LumiRPEngine its host name, the harness that runs it and its builds, kept in your Lumiverse account's storage and shown only to you, in Settings → MCP server and the update notice.
- **The token is a whole-account session.** It is what your browser holds when you are signed in, valid for 7 days and extended by use, and the credentials file is readable by every program you run as yourself, your agent included. `logout` ends the session on Lumiverse as well as deleting it. When Lumiverse can't be reached or doesn't confirm, `logout` says so: the session then stays valid until it expires, after 7 days unused.
- **To cut an agent off, run `lumirpengine logout` on its machine, or stop its harness.** Lumiverse trusts an open event socket for as long as it stays open, even after the session it was opened with has ended. `logout` on the machine the agent runs on deletes the saved sign-in, and a running `mcp` server then drops its socket at its next call. A session that ends any other way (revoked from elsewhere, expired, or ended by a password change, which ends every other session of the account) leaves a running server able to act until its harness stops it.
- **Plain `http` to another machine sends it in clear.** Your password at sign-in, and the token on every call after, cross the network readable by anyone on the way, who can then use your account. `login` refuses that unless you pass `--allow-http`, which is saved with the sign-in, so `mcp` and the other commands need no flag. `localhost` and `127.0.0.1` never leave the machine. Before it sends your password, `login` asks Lumiverse as nobody, and stops if the address redirects to https: sign in at the https address instead.
- **Harness configs hold no password**, only the command. Sign-ins happen in your terminal.
- **`path` arguments read files on this machine.** `lre_check`, `lre_playtest`, `lre_check_world` and `lre_world_import` read the file a `path` names, with your permissions: an agent can point them at any file you can read, and an error can quote part of one that isn't a world.
- **Drafts are shared with Build.** An agent edits the same draft you see in Build, and you see its changes as it makes them. Each write names the draft version it read, Build's too, so neither of you overwrites the other unseen. But a commit takes the whole draft: your Commit in Build commits the agent's unfinished work, and the agent's commit carries yours. Agents are told to ask you before they touch a draft that was already there when they started, and to commit or discard every draft they start.
- **Settings and the preset are yours, everywhere.** `lre_settings_set` changes the settings every chat and job of yours runs with, as Settings would (a model use preset changes every step's model and budget), and `lre_preset_add_blocks` writes blocks into your active Lumiverse preset. `lre_job_start`'s model jobs spend your helper model's calls. A chat's diagnostics and a chat's lore pins can name what its player hasn't found, so their tools show them only with `spoilers: true`.
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
- **Settings → MCP server lists a server you no longer run.** A line stays after its server stops, showing when it was last seen, so a harness you removed keeps one: **Forget** drops it, and it comes back only if that server connects again.
