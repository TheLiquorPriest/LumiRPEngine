# Install and run RPE

RPE is one program, `dist/rpe.js`, run with Bun 1.4 or later. It runs on the same machine as Lumiverse: the extension reaches it only on that machine's own address (loopback).

In this page `rpe` stands for `bun <folder>/dist/rpe.js`, where `<folder>` is a copy of this repository: every line RPE prints for you to run begins with the Bun and the app file that started it, so it runs as printed. An install that links the package's `rpe` command gets the same word. Once the extension is installed, Lumiverse keeps a copy in `<Lumiverse's data folder>/extensions/lumi_rp_engine/repo`; run `rpe up` from that copy, and an update of the extension then updates RPE too.

If you run the previous build of this extension, read [Moving from the previous build](migration.md) instead. Do not install over it.

## The order

1. Install the extension in Lumiverse and approve its permissions.
2. Run `rpe up` on the machine that runs Lumiverse.
3. Add a model connection to RPE.
4. In Lumiverse, choose the connection "RPE" for the chats RPE should play.

## The extension and its five permissions

In Lumiverse, open **Extensions**, tap **Add Extension**, choose **Install from Source**, enter `https://github.com/TheLiquorPriest/LumiRPEngine` with the branch `standalone`, and install it. Then approve its permissions and switch it on.

The extension is small. It has no settings and keeps no story data. It passes RPE what it needs from Lumiverse, it shows RPE's pages in a tab of Lumiverse's drawer called **RPE**, and it draws RPE's HUD, the line under each reply and the composer's controls in the chat itself ([the pages](#the-pages)). It asks for five permissions:

| Permission | Why |
|---|---|
| `interceptor` | To leave history beyond your window out of a reply's prompt, and to mark the replies RPE plays. An admin approves it. |
| `generation_parameters` | To carry that mark to RPE with the reply's request. Without it, RPE's replies are stopped. |
| `generation` | To hear when a reply starts, and to keep lore secrets out of prompts. An admin approves it. |
| `cors_proxy` | To reach RPE on this machine, for the questions before each reply and for pages that cannot reach RPE themselves. An admin approves it. |
| `ui_panels` | To open RPE's heads-up display and its panels in your chat. |

When a permission is missing, Lumiverse shows a window called "RPE needs permissions" that names each one and why, RPE's tab says so at its top, and RPE refuses the replies it cannot play rather than play them wrong.

Play, Build, the world's sheets and the HUD load from the extension's second file, `dist/widget.js`, which Lumiverse serves to the extension's page. A Lumiverse that does not serve it shows "This view could not be loaded" with the words "Lumiverse did not serve the extension's second file" in place of the view.

## Setting RPE up: `rpe up`

```sh
bun <Lumiverse's data folder>/extensions/lumi_rp_engine/repo/dist/rpe.js up --url <Lumiverse's address> [--systemd]
```

`rpe up` does all of this:

- It asks for your Lumiverse username (or takes `--user <name>`, `--username <name>` or `LUMIVERSE_USERNAME`) and for your password, and signs in to Lumiverse as you. It does not keep the password; it keeps the sign-in Lumiverse gives back, in RPE's secrets file. A later run reuses that sign-in while Lumiverse still accepts it, takes the address from RPE's config where `--url` is left out, and asks for nothing. With no terminal, as from a script, it reads the answers from the lines piped into it, one for each question.
- It writes RPE's config before it opens or makes the database or starts anything: the Lumiverse address, your user, and, where it runs from the extension's folder in Lumiverse's data folder, Lumiverse's database file (`lumiverse.database`), which RPE then reads directly. From another folder, `--database <file>` names it.
- It makes RPE's connection in Lumiverse, called "RPE", or brings it up to date (see below). It finds the connection again by its address and model if RPE's config has lost it.
- The first time, it prints the token for RPE's web app, once (see [The web app](#the-web-app-and-its-key)). A later run prints none, and says how to make a new one.
- Where RPE's service already exists for this data folder, `rpe up` keeps it, with or without `--systemd`: it makes the copy again, writes the unit and starts the service on what this run wrote, in place of serving in the foreground.
- With no service, and without `--systemd`, after the list of what is left for you to do it serves RPE in the foreground until you stop it (Ctrl-C). With `--systemd`, it installs and starts RPE as a service of your account, named `rpe-<name>.service`. `--name <name>` chooses the name; without it, the name comes from your username. This needs Linux with systemd. Where RPE already answers, it says so and starts none; where something else holds RPE's port, it says so and names `--port`.

Its other options:

- `--port <port>`: the port RPE's connection in Lumiverse points at, on loopback; 7871 until you give another. Where the port is taken, a first install takes the first free one after it, up to the setting `service.lastPort` (7899).
- `--listen <address>`: also listen on that address, so that other machines reach RPE. RPE says what that means (plain http off loopback) and still answers on loopback, where Lumiverse's extension reaches it.
- `--allow-http`: accept a Lumiverse address that is plain http to another machine, where your password and the session token cross the network in clear.
- `--bun <path>`: the Bun the service runs, by its real path (an absolute path).
- `--memory <size>`: the most memory the service may hold, as systemd reads a size (`768M`, `2G`, or `infinity`), at least `256M`; kept as the setting `service.memory`.
- `--name <name>`: the service's name.
- `--database <file>`: Lumiverse's database file, where `rpe up` does not run from the extension's folder.
- `--lumiverse <folder>`, `--runtime <name>`, `--no-runtime`, `--runtime-config <folder>`, `--runtime-data <folder>` and `--identifier <id>`: for the switch from the previous build, which is `rpe up` where the previous build's runtime is found: see [Moving from the previous build](migration.md).

A second run changes only what is not as it should be.

One RPE serves one Lumiverse user. A sign-in as another user is refused before anything is written.

Every command `rpe` has:

- `rpe up`: the above. Where the previous build's runtime of yours is in Lumiverse's data folder and the extension runs the new build, `rpe up` is the switch from the previous build instead, with no flag: see [Moving from the previous build](migration.md#3-the-switch). Where the previous build is still installed, it says so and changes nothing.
- `rpe serve`: runs RPE in the foreground.
- `rpe status`: the build, the data folder, where RPE listens and whether it answers, whether its service is installed and running, the builds that run, the Lumiverse it belongs to, the previous build's runtime folders that `rpe up` and `rpe migrate` read (as `XDG_CONFIG_HOME` and `XDG_DATA_HOME` decide them) and whether each is there, the database, its keys, and anything waiting to be switched on.
- `rpe down`: stops and removes RPE's service. Its data stays where it is.
- `rpe lumiverse`: which Lumiverse this RPE belongs to, and its sign-in. With `--url` and `--user` it signs in again (and prints the id of your Lumiverse user); `--database <file>` reads Lumiverse's database file directly, and `--connection <id>` names RPE's connection in Lumiverse, both together with them.
- `rpe version`: this build's id.
- `rpe key provider` and `rpe key web`: a new key, shown once; the one before it stops working. RPE makes its extension's key itself at every start, so there is no command for it. See [Security](security.md#keys-and-tokens).
- `rpe connection list`, `rpe connection add` and `rpe connection remove`: RPE's model connections (below).
- `rpe allow <name>` and `rpe deny <name>`: switch on, or off, something that runs a command or calls out. See [Security](security.md#what-rpe-never-does-by-itself).
- `rpe backup`: one archive of RPE's database and file tree. `--out <file>` says where to write it.
- `rpe migrate`: carries the previous build's data into RPE. See [Moving from the previous build](migration.md).
- `rpe check`: whether this build starts on the data folder: it is started, as `rpe serve` starts it, on a scratch copy of the data (a copy of the database, a fresh file tree, no Lumiverse), made under `--into <folder>` (a temporary folder where none is given) and removed when it ends. It passes once the build has mounted every area, laid its shipped files and answered its status with its own build, within `--within <seconds>`. RPE runs it on a new build before it swaps onto it (see [Updating](#updating)).

Every command takes `--help` (or `-h`): given after a command's name, it prints that command's own usage, with each option, what it takes and its default, and one example where this page has one, and runs nothing. Given alone, or as the word `help`, it prints the usage of every command.

Every command, `rpe migrate` included, reads its line alike: a value is given as `--name value` or `--name=value`, a value that starts with `--` only as `--name=value`, and an option the command does not take is refused by name.

Commands that change something are written by the running RPE when it runs, and by the command itself, under the data folder's lock, when it does not: see [The command line](security.md#the-command-line).

### The data folder

Everything RPE keeps is in one folder: its database (`rpe.db`), the files the agents read and write (`files/`), its secrets file (`secrets.json`), its config file (`config.json`) and its backups (`backups/`), and beside the database `index.db`, a search index that holds only words and ids, is rebuilt from the rest where it is missing, and is not in a backup. The folder is `$RPE_DATA` when that is set, else `rpe` under `$XDG_DATA_HOME` when that is set, else `~/.local/share/rpe`. Every command takes `--data <folder>` to use another one.

`config.json` holds the install's facts: which Lumiverse RPE serves and as which user, its database file, the port RPE's connections in Lumiverse point at, and those connections (`lumiverse.connections`: its own, and every one the switch took over from the previous build) with their models. A `config.json` from before the list holds the one connection as `connection` in its `lumiverse` block, which reads as a list of one. The command line writes it (`rpe up`, `rpe lumiverse`); the Settings page lists it and never writes it. Each fact is in [Settings](settings.md#the-install-configjson). Three can also come from the environment, which wins over the file: `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER`. RPE's own limits (where it listens, the origins and names allowed, its body limits, the lives of tokens, the live socket's bounds, the database's and the command line's waits) are settings in `files/RPE-global.yml`, in force from RPE's next start; a `config.json` from an earlier build that still holds limits has them moved there at RPE's first start, each value kept.

By default RPE listens on `127.0.0.1`, port `7871`.

## The service

`rpe up --systemd` installs RPE as a service of your account, on Linux with systemd. It does not run the file in the extension's folder, which an update of the extension replaces under a running service. It copies RPE (the app file and the folders it reads beside it: `guidance/`, `guidance-harness/` and `ui/`) into `app/current/` in RPE's data folder, records the file it ran from as the one source of updates, and writes a unit that runs the copy:

- `rpe-<name>.service` in `~/.config/systemd/user/`, written whole in one step, enabled and started. Its name follows systemd's own rule for a unit's name; RPE sets no length of its own.
- Its `MemoryMax` is the setting `service.memory` (1G, at least 256M; `--memory` sets it), its `RestartSec` the setting `service.restartWaitSeconds` (2 seconds), and it is started no more than `update.startTries` times within `update.startWindowSeconds` seconds, besides one start that puts back the known-good copy (see [Updating](#updating)).
- Lingering is turned on for your account, so the service starts at boot and keeps running when you log out. Where it cannot be turned on from here, `rpe up` says so and gives the line (`sudo loginctl enable-linger <account>`).
- It is refused, with nothing changed, as root; for an RPE run from its sources (build first); and where the app file, the Bun, or a folder above them or above RPE's data folder is one another account could change: each is named, with the `chmod` that takes the write away.
- A later `rpe up --systemd`, with the service running, waits for the turns and jobs under way to end, at most `service.drainWaitSeconds` seconds (5 minutes), looking every `update.lookEverySeconds` seconds, before it makes the copy again and restarts the service.

`rpe status` names the file updates come from. Run from a copy that is not the extension's own folder in Lumiverse's data folder, `rpe up` says that updates will come only from that copy.

### Keep it running on macOS, Windows and in a container

Without systemd, `rpe up` starts RPE itself and stays in the foreground. Asked for `--systemd` where there is none, it says so, installs RPE's own copy in the data folder all the same (`<data>/app/current/rpe.js`, with its folders; `<data>` is RPE's data folder, `~/.local/share/rpe` unless `--data` or `RPE_DATA` names another), prints the line that runs that copy, and serves in the foreground. You keep RPE running across logouts and reboots with your system's own service manager, running that line as your account: `<bun> <data>/app/current/rpe.js serve --data <data>`. Nothing restarts RPE onto an update there: after you update the extension, run `rpe up --systemd` again, which puts the new build in RPE's copy, then restart RPE (below, for each system).

**macOS (launchd).** First run `rpe up --systemd` once, to sign in, write RPE's config and install RPE's own copy; stop it with Ctrl-C.

Save this as `~/Library/LaunchAgents/rpe.plist`, with your own Bun, data folder and home folder written in full (launchd reads no `~`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>rpe</string>
  <key>ProgramArguments</key>
  <array>
    <string><bun></string>
    <string><data>/app/current/rpe.js</string>
    <string>serve</string>
    <string>--data</string>
    <string><data></string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string><home>/Library/Logs/rpe.log</string>
</dict>
</plist>
```

Load it, which starts it: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/rpe.plist`. Restart it with `launchctl kickstart -k gui/$(id -u)/rpe`; stop and unload it with `launchctl bootout gui/$(id -u)/rpe`.

**Windows (Task Scheduler).** First run `rpe up --systemd` once in the foreground, in PowerShell, to sign in, write RPE's config and install RPE's own copy; stop it with Ctrl+C. Then, with your own `<bun>` and `<data>`:

```powershell
$action = New-ScheduledTaskAction -Execute "<bun>" -Argument "`"<data>\app\current\rpe.js`" serve --data `"<data>`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "rpe" -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName "rpe"
```

Stop it with `Stop-ScheduledTask -TaskName "rpe"`, and remove it with `Unregister-ScheduledTask -TaskName "rpe" -Confirm:$false`. Task Scheduler keeps no log of its words: to read them, stop the task and run its line yourself.

**In a container.** Lumiverse's 127.0.0.1 is the container's own: run RPE inside Lumiverse's container as a second process (`bun <folder>/dist/rpe.js up --url <address> --systemd` once, which signs in, writes RPE's config, installs RPE's own copy and starts RPE in the foreground; stop it with Ctrl-C, then keep the copy's `serve` line it printed as the process that runs), or as a compose service that shares Lumiverse's network (`network_mode: "service:lumiverse"`, `command: ["bun", "<data>/app/current/rpe.js", "serve", "--data", "<data>"]`, `restart: always`, a `mem_limit`), with RPE's data folder on a volume.

## RPE's connection in Lumiverse

Lumiverse reaches RPE as an OpenAI-compatible provider. `rpe up` makes that connection in Lumiverse: it is called "RPE", points at RPE's `/v1` address, offers the model `rpe`, and holds a provider key that only it has. A chat plays on RPE when you choose that connection for it.

The provider key is shown nowhere: RPE keeps only its hash. `rpe key provider` makes a new one, shown once; the one before it stops working at once. Put the new one in RPE's connection in Lumiverse as its API key.

## Model connections

RPE calls the model providers itself, on its own connections. Lumiverse's connections are not used for this.

```sh
rpe connection add --name deepseek --provider deepseek --model deepseek-v4-flash
rpe connection list
rpe connection remove deepseek
```

`rpe connection add` asks for the provider's key, and never takes it on the command line. Its other flags:

- `--auth key|signin|none`: how the connection signs its calls. `key` is the default. `none` is for a provider that needs no key, such as one on your own machine.
- `--model <model>`: the model it uses.
- `--effort <effort>`: how hard the model thinks, where the model offers that.
- `--base-url <address>`: another address for the provider's API.
- `--context-window <tokens>` and `--max-tokens <tokens>`: the model's limits, where RPE does not know them. They need `--model`.

`rpe connection` talks to the running RPE, so start RPE first. The **Connections** page does the same, in the drawer or in the web app. In `rpe connection list`, the connection marked `*` is the default one.

### A model that does not keep to the reply's tags

By default a reply and the Author's intent record are marked with tags in the Author's message (`reply.form`: `tags`). Some models do not keep to the tags. For such a model, the form is `two-step`: the reply is the plain text of a message of its own. The Connections page can find out: **Check the tags** plays a number of simple turns on a connection (`reply.check.turns`) and gives it the tag form only if enough come back in their tags (`reply.check.kept`). Or set the form for the connection yourself, in the global settings file `files/RPE-global.yml` in RPE's data folder:

```yaml
connections:
  deepseek:
    reply:
      form: two-step
reply:
  streamAnyway: [deepseek]
```

`connections.<connection>.reply.form` is set per connection, by its name or its id. See [Settings](settings.md).

## The pages

RPE's pages are in a tab of Lumiverse's drawer called **RPE**, for the chat Lumiverse has open, and in RPE's web app (below), where you choose the chat on **Chats**. On a narrow screen, the pages used less often are behind **More**. Every page works at a phone's width and a desktop's. Where RPE refuses something, a page shows it in RPE's own words.

### In the chat

The same extension draws these in Lumiverse's own chat, for a chat RPE plays:

- **The HUD**, while the chat plays a world: a pill you dock anywhere, with the world's clock, place, scene, weather and cash (each with a ✎ to correct it), this turn's calls, the clock's pause and resume, and the map and the actions; on a phone, a status line above the composer does its job. Tapping it opens the world sheet. While a turn runs it names who is at work and the newest progress line, with how long it has run; a turn that failed says so with why, and a press opens its page; where a turn ended before a word of its reply went out, it says what to do with the empty reply left in the chat. This holds when you open the chat while a turn runs or after one ended. While a press waits for your next message, it shows "With your next message:" and what you pressed and on what, with **Send now** and a ✕ that takes it back.
- **In the composer's action bar**, while the chat plays a world: **World actions…**, **Timelapse…**, **Pause clock** or **Resume clock**, and **World map**.
- **Two controls in the composer's tools row:** **Depth**, for how the next message is asked to be played, and **Swipe**, for how the next swipe is played, with a line of feedback you can write. Each offers what the shipped `TURN.md` and `SWIPE.md` list, and each has its own "none".
- **Under each reply**, a line with when and where it happened, what the turn did in each lane (Story and Engine, each opening a short list), the turn's marks (**edited**, **interrupted** and the rest), each a short word whose meaning shows when you point at it or press it, and a link to its Turn page. A reply made without RPE says so; a migrated reply names the engine that played it.
- **Under the newest reply, while the Author is still working** after the release: a marker with the run's newest progress line and a link to Live.
- **Where the history window ends**, a thin line saying how many messages above it the story record does not cover yet, or that it covers all.
- RPE's notices appear in the chat's toolbar, so you see them with the drawer shut.

### For one chat

- **Live**: what runs in the chat, as it runs. Every run going on, a turn and the jobs that began beside it, each with what it is, how it stands, what it has spent and **Stop**; what went to the chat as it streams; and, behind a spoiler gate, the intent record and the tree of agents, each with its model calls, tool calls and results, its `todo` list and the rules that fired. **Pause** holds a turn before its next model call and **Resume** lets it go on; a line you write is heard by the Author at its next call. With nothing running it shows the last runs as they ended. With no chat open it watches your jobs of no chat.
- **Turns**: the chat's turns and each one's runs, and a turn's own page: the marks on it, its timings and token counts; what went to the chat; what you asked for beside your words; the prompt's front and what changed in it; the tools it found; its changes by lane, counted; who perceived the turn; behind the spoiler gate, what the Author was given (the prompt by part, the lore of the prompt, the files of the turn's folder) and what each agent's first call was sent, the intent record, the Author's record of the turn, the tokens by agent, the trace of each run, the changes lane by lane, its review card with the questions asked on it, the quests and threads it touched, what is still open and what it left unsettled, and the gap checks and consents; and, for a migrated turn, what the old engine recorded, also behind the gate. **Settle now** runs the Author on the chat's newest turn against the chat as it reads now, for instance after you edited a reply in Lumiverse: it writes no reply and adds nothing to the chat. It is refused while a turn of the chat runs, and in a branch whose newest turn is still the one it shares with the chat it was branched from: play a turn in the branch first. The chat's jobs (runs that go on after a reply, and bootstrap jobs) are listed here with what each spent and reported, and **Cancel** while one is queued or running.
- **Sessions**: the Author's working memory between turns. Each scene of the story is a session, newest first, open or closed; one opened shows what its next turn would carry in each of the three ways of carrying context, its compactions (each with an Undo, after a question that says what it costs), **Compact now**, **Close** and **Reopen**, and the turns that ran in it. It also holds the measurement of the three ways, from which you choose the default for every chat or for this one: nothing changes it by itself.
- **World**: the world's state as one tree, at the chat's head or at any turn, opened to any level, each value with where it comes from (its own, inherited from a level above, or kept by a game system) and the change that last wrote it, and the facts recorded beside it. Behind the spoiler gate any value or fact can be changed or removed as your own edit, with an Undo; a value's history is read turn by turn; each level's typed systems are shown as each keeps them; and the things browser opens here.
- **Places**: every place of the chat, the world's own and those made in play, searchable; one opened shows its record in nine parts and its grid with everyone and everything on it, now or as it stood at a turn.
- **Quests**: every quest, secret, puzzle and agenda as the Author keeps it, behind the spoiler gate, and, outside it, the journal you see, drawn from those records with only what each quest lets you see.
- **Cast**: the characters, each with their kind of casting, and, behind a spoiler gate, the Author's casting line and one character's whole record: base, growth, mind, memories, relationships, knowledge, history, perceptions, the mind files carried from the previous build, and its game side. An entry can be struck, and the strike taken back, which also stands again what the strike struck with it; a perception can be written for a turn the character was on stage in and has none of; a character's casting can be set or pinned. These are your changes, on the chat's newest turn. In a branch that has no turn of its own yet, a strike is refused until one has been played there.
- **Story**: the story record: chapters, scenes and beats in the chat's order, each beat beside the prose it stands for, what the record covers of the whole chat, the story so far as the Author is given it, and behind a spoiler gate the story's threads, arcs, horizon and futures. An item can be struck or corrected, and the strike taken back. The Story page also has **bootstrap**: a job that sets RPE's agents to go over a chat's past and fill in its records. It shows what the records hold so far as counts (whether that is enough is the job's to judge), the token limit at which a job stops to ask you whether to go on (with how it is counted) and each setting that ends its run, takes a limit of your own for one job, and starts one for a relive word the bootstrap skill offers or as the skill decides; with a job already under way it asks before starting a second. A job that reaches its limit shows its question there, and goes on or ends on your word. Nothing starts one by itself.
- **Lore**: your books and the world's own lore as RPE understands them: the index, a page at a time and searchable, each entry with its book, kind, the one line that says what it is, what it defines and the records it is bound to; entries no run has indexed yet by title and keys; **Index now**, naming the connection the indexing runs on; and, where the chat's story moved past an entry, each overlay with its turn.
- **Prompt**: how this chat's preset is cut into named parts: every part of the prompt map in order with its kind, line and how it was found in the turn's prompt, its text behind a spoiler gate, the text no part claims, and your five edits to the map (rename, merge, split, correct a line, change a kind), which RPH keeps with the preset. Turn by turn it lists what changed in the prompt's shape, and how much of the prompt's front stayed the same.
- **Play**: the play panels of the previous build, running against RPE, behind a bar of Now, Me, People, Orgs, Places and Story: the scene, money, gear, vehicles, the cast, organizations, sheets, quests, the journal, what is known, the map and more, each as its world has them; the HUD sits above them. A press is one of three kinds. **A press that manages** (money, a group, gear, a ✎ correction, a hint) is your own change, kept on the chat's newest turn: a notice says what was done, with an **Undo** there, and it is told to the Author at the next turn; made while a turn runs, it is marked pending until the run ends. **A press for your next message** (an action of the actions sheet, a Timelapse, **Walk here** on the map, a way of getting somewhere, Drive, a thing's "In the story") waits as a request: the HUD, the actions sheet and the map show what you pressed and on what, the actions sheet marks the action chosen and the map the square, and the same press again takes it back; your next message carries it, and the Author is told what you pressed and on what. **Send now** (on what waits, or beside a choice in the actions sheet and the Timelapse) puts that line in the chat as your message and starts the reply; it waits while a turn runs, and needs RPE connected to your Lumiverse. A chat with no world shows the world picker: **Attach** gives the chat a world from Build. An Undo takes back what it still can of a change, and names each part that stays, with why.

### For everything

- **Build**: the world builder of the previous build, running against RPE: the worlds RPE keeps, each opened, edited (the map editor among them), checked and committed as a new revision, with its model jobs (import from lore, index this text, refine with AI, describe a map, propose routines), its lore and secrecy tools, and **Attach** to give the open chat a world. In a world, **Commit** asks for one line of note, kept with the revision, and pressing **Uncommitted** in the world's bar shows, part by part, what the draft changes against the last revision. The world's page lists its **Revisions**, newest first, each with its note, how many things it changed and the chats that play it; a press compares it with the one before it (or another you pick), and **Put this revision in the draft** brings an earlier one back as your draft, which stays uncommitted until you press Commit. These controls are in the web app's Build page and in the Build panel inside the chat application alike, which are one page. In the web app, Build lists RPE's connections and your books from RPE; Regenerate, Continue and showing a reply need Lumiverse's chat, so they are in the drawer only. Build's place in a world is not kept in the web address of the drawer.
- **Jobs**: every job of every chat, or the open chat's, newest started first, a page at a time and by where it stands; one opened shows its brief, its report and what it spent. You can start one by hand (an agent, a brief, what it is given, limits of your own), **Cancel** one while it is queued or running, switch jobs off, or hold the running ones.
- **Agents**: every agent definition in force for the open chat, each with the connection, model and effort it will really run with, its effort, limits and sampling as settings (for every chat or this one, with the value its definition gives shown and a way back to it), its tools, what it reads and what it is given. A definition can be saved as your own file at a level, a shipped one reset to its default, a copy made as a new agent. A change to its tools or what it is given holds from the next session, or at once with **Apply now**.
- **Rules**: every rule of the chat's stack, whether it is in force and why, whom it is for and what triggers it in words; the examples; what waits for the server's command line; the facts a trigger can use, with their value for the chat; the log of what fired and what the agent did next; and a tester that runs a rule as its file stands against a past turn, writing nothing.
- **Files**: the agents' files, level by level, each with whether it is in force; open, edit and save one at a level, delete or reset one, switch a shipped one off or on, compare with the default and with each change an update made. The agents' suggestions, to accept, edit or dismiss. An agent's stack: every part it is given, in order, with **Apply now**. See [How behaviour lives in files](behaviour.md).
- **Connections**: RPE's model connections, each model's limits and where each comes from, whether it takes audio and video, **Test it**, your own context window and longest reply for a model, signing in to a provider for a connection that signs in, and whether a connection keeps the reply's tags (**Check the tags**).
- **Settings**: every setting RPE and its harness read, in sections of plain words, with a search and a filter to what you changed. Each shows what it does, a control that fits it, its unit, the advice its value passes, the shipped value with a way back to it, and where it is set; with a chat open you choose whether a change is for every chat or this chat only. Settings set for one connection or one agent at a time are a table, a row for each. **On this device** holds what this browser keeps for itself: **Show ids**, which shows each id beside its name in Build.
- **Runtime**: how RPE runs (under its service or by hand, since when, the addresses it listens on, the build it runs) and a **Restart** that waits for the turns and jobs under way; the `Builds:` line, the newest update stage by stage, and **Update now** (see [Updating](#updating)); when the web key this browser holds ends; RPE's own log, a page at a time; and where the time goes across the latest turns.
- **Storage**: what RPE keeps by kind and how long, and what each chat's files and rows take; a chat's largest notes; pruning on request, after being told exactly what will go.
- **Migration**: a rehearsal you can start, the last real run's report, each chat's outcome, the backup, the worlds put into Build, what waits on you, the steps of the switch and of going back, and, for every chat the migration carried, how its bootstrap stands, its own start and its question, beside one start for all of them; each start takes your token limit. See [Moving from the previous build](migration.md).
- **Chats** (web app only): the chats, those RPE has played and those the migration carried, newest played first, with a way to each one's pages and to Play, and your jobs of every chat, with **Cancel**.

## The web app and its key

RPE serves the same pages as the drawer tab at its own address, under `/ui/`: by default `http://127.0.0.1:7871/ui/`. The web app also has the **Chats** page.

The web app takes two ways in: the token `rpe up` printed, or your Lumiverse account. The token is shown once, at the first `rpe up`; `rpe key web` makes a new one, which replaces it. The web app trades it once for a session, and the browser keeps the session, which ends `auth.webSessionMinutes` (30) after it was made unless a page that is open renews it, and never the token. With your Lumiverse account, you give the web app your Lumiverse username and password (RPE keeps neither); RPE checks them against Lumiverse, and accepts them only for the Lumiverse user this RPE belongs to. As shipped a web key has no end; with `auth.webKeyDays` set, it runs out that many days after it is made, and `rpe key web` prints when. See [Security](security.md#signing-in-to-the-web-app).

RPE listens only on this machine unless you change that. To open the web app from another device, publish RPE's address over HTTPS (with a reverse proxy, for example), then list that address in `files/RPE-global.yml`: its origin in `server.origins`, and its host name in `server.hosts`. Setting `server.address` makes RPE listen on another address as well, from its next start; it always listens on `127.0.0.1` too, which the extension uses.

## Updating

Update the extension in Lumiverse, as with any extension. Lumiverse replaces the files in the extension's folder, `dist/rpe.js` among them. The built files are part of the repository, so Lumiverse builds nothing and installs nothing. (Moving onto this build from the previous one is not an update: it is Lumiverse's "switch branch", in [Moving from the previous build](migration.md#3-the-switch).)

The service does not run the file in the extension's folder: it runs RPE's own copy (see [The service](#the-service)), so an update of the extension never changes the running server under it. `bun run build` writes `dist/rpe.files.json`, the hash of the app file and of every file of the folders it reads beside it, and stamps the hash of that statement into the extension's backend. When the extension has been updated it tells RPE that a new app file has arrived, stating that hash. RPE then:

1. reads the one file it was set up from (`rpe status` names it), copies the build beside its own copy, and takes it only when every file matches the statement and the statement matches the hash the extension stated;
2. starts it for real on a scratch copy of its data (`rpe check`): a copy of the database, a fresh file tree, no Lumiverse; it passes only once it has mounted every area, laid its shipped files and answered its status with its build, within `update.checkWaitSeconds` seconds;
3. waits until no turn and no job runs (`update.restart`, on by default), swaps the checked copy into its own copy's place, keeps the copy it replaces as known-good (`update.keepCopies`), and restarts onto it; its service starts it again.

- `rpe status` has a `Builds:` line: the build RPE runs, the build waiting, the extension's build, and what RPE will do about a difference, with why a build was not taken. The **Runtime** page shows the same line, and the newest update stage by stage (arrived, its files checked, started on a scratch copy, the restart onto it), each under way, passed, or refused with why, read again while it goes on; a refused one shows that the running build stays as it was.
- A word with no stated hash (today's registration carries only the extension's build) is not taken, and `rpe status` says why. A new build whose files do not match what was stated for it, or that does not start, is never swapped in; RPE goes on with the build it runs.
- A build that is swapped in and does not come up within `update.startTries` starts is put back to the known-good copy by a step the service runs before each start, which an update does not replace (`rpe up --systemd` wrote it); `rpe status` says what happened. One that still cannot start is left stopped: the service stops starting RPE after `update.startTries` starts within `update.startWindowSeconds` seconds.
- RPE run by hand (`rpe serve`) never restarts by itself: stop it and start it again.
- With `update.restart` off, RPE waits for you: **Update now** on the Runtime page restarts it at once onto the build that passed, or restart RPE's service yourself. Pressed with no build waiting, it says there is none, or why the last one was refused.

Your files in RPE's data folder are never changed by an update. When an update changes a shipped file you replaced with your own, RPE records it, and the **Files** page shows the difference.
