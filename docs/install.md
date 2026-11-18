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

The extension is small. It has no settings and keeps no story data. It passes RPE what it needs from Lumiverse, and it shows RPE's pages in a tab of Lumiverse's drawer called **RPE**. It asks for five permissions:

| Permission | Why |
|---|---|
| `interceptor` | To leave history beyond your window out of a reply's prompt, and to mark the replies RPE plays. An admin approves it. |
| `generation_parameters` | To carry that mark to RPE with the reply's request. Without it, RPE's replies are stopped. |
| `generation` | To hear when a reply starts, and to keep lore secrets out of prompts. An admin approves it. |
| `cors_proxy` | To reach RPE on this machine, for the questions before each reply and for pages that cannot reach RPE themselves. An admin approves it. |
| `ui_panels` | To show RPE's panel. |

When a permission is missing, RPE's pages say which one and why, and RPE refuses the replies it cannot play rather than play them wrong.

## Setting RPE up: `rpe up`

```sh
bun <Lumiverse's data folder>/extensions/lumi_rp_engine/repo/dist/rpe.js up --url <Lumiverse's address> [--systemd]
```

`rpe up` does all of this:

- It asks for your Lumiverse username (or takes `--user <name>`, `--username <name>` or `LUMIVERSE_USERNAME`) and for your password, and signs in to Lumiverse as you. It does not keep the password; it keeps the sign-in Lumiverse gives back, in RPE's secrets file. A later run reuses that sign-in while Lumiverse still accepts it, takes the address from RPE's config where `--url` is left out, and asks for nothing. With no terminal, as from a script, it reads the answers from the lines piped into it, one for each question.
- It writes RPE's config before it opens or makes the database or starts anything: the Lumiverse address, your user, and, where it runs from the extension's folder in Lumiverse's data folder, Lumiverse's database file (`lumiverse.database`), which RPE then reads directly. From another folder, `--database <file>` names it.
- It makes RPE's connection in Lumiverse, called "RPE", or brings it up to date (see below). It finds the connection again by its address and model if RPE's config has lost it.
- The first time, it prints the token for RPE's web app, once (see [The web app](#the-web-app-and-its-key)). A later run prints none, and says how to make a new one.
- With `--systemd`, it installs and starts RPE as a service of your account, named `rpe-<name>.service`. `--name <name>` chooses the name; without it, the name comes from your username. This needs Linux with systemd.
- Without `--systemd`, after the list of what is left for you to do, it serves RPE in the foreground until you stop it (Ctrl-C). Where RPE already answers, it says so and starts none; where something else holds RPE's port, it says so and names `--port`.

Its other options are the previous build's install line's:

- `--port <port>`: the port RPE's connection in Lumiverse points at, on loopback; 7871 until you give another. Where the port is taken, a first install takes the first free one after it, up to the setting `service.lastPort` (7899).
- `--listen <address>`: also listen on that address, so that other machines reach RPE. RPE says what that means (plain http off loopback) and still answers on loopback, where Lumiverse's extension reaches it.
- `--allow-http`: accept a Lumiverse address that is plain http to another machine, where your password and the session token cross the network in clear.
- `--bun <path>`: the Bun the service runs, by its real path (an absolute path).
- `--memory <size>`: the most memory the service may hold, as systemd reads a size (`768M`, `2G`, or `infinity`), at least `256M`; kept as the setting `service.memory`.
- `--name <name>`: the service's name.

A second run changes only what is not as it should be.

One RPE serves one Lumiverse user. A sign-in as another user is refused before anything is written.

Every command `rpe` has:

- `rpe up`: the above. Where the previous build's runtime of yours is in Lumiverse's data folder and the extension runs the new build, `rpe up` is the switch from the previous build instead, with no flag: see [Moving from the previous build](migration.md#3-the-switch). Where the previous build is still installed, it says so and changes nothing.
- `rpe serve`: runs RPE in the foreground.
- `rpe status`: the build, the data folder, where RPE listens and whether it answers, the builds that run, the Lumiverse it belongs to, the previous build's runtime folders that `rpe up` and `rpe migrate` read (as `XDG_CONFIG_HOME` and `XDG_DATA_HOME` decide them) and whether each is there, its keys, and anything waiting to be switched on.
- `rpe down`: stops and removes RPE's service. Its data stays where it is.
- `rpe lumiverse`: which Lumiverse this RPE belongs to, and its sign-in. With `--url` and `--user` it signs in again; `--database <file>` reads Lumiverse's database file directly, and `--connection <id>` names RPE's connection in Lumiverse.
- `rpe version`: this build's id.
- `rpe key provider` and `rpe key web`: a new key, shown once; the one before it stops working. RPE makes its extension's key itself at every start, so there is no command for it. See [Security](security.md#keys-and-tokens).
- `rpe connection list`, `rpe connection add` and `rpe connection remove`: RPE's model connections (below).
- `rpe allow <name>` and `rpe deny <name>`: switch on, or off, something that runs a command or calls out. See [Security](security.md#what-rpe-never-does-by-itself).
- `rpe backup`: one archive of RPE's database and file tree. `--out <file>` says where to write it.
- `rpe migrate`: carries the previous build's data into RPE. See [Moving from the previous build](migration.md).
- `rpe check`: whether this build starts on the data folder: it is started, as `rpe serve` starts it, on a scratch copy of the data (a copy of the database, a fresh file tree, no Lumiverse), made under `--into <folder>` (a temporary folder where none is given) and removed when it ends. It passes once the build has mounted every area, laid its shipped files and answered its status with its own build, within `--within <seconds>`. RPE runs it on a new build before it swaps onto it (see [Updating](#updating)).

Commands that change something are written by the running RPE when it runs, and by the command itself, under the data folder's lock, when it does not: see [The command line](security.md#the-command-line).

### The data folder

Everything RPE keeps is in one folder: its database (`rpe.db`), the files the agents read and write (`files/`), its secrets file (`secrets.json`), its config file (`config.json`) and its backups (`backups/`). The folder is `$RPE_DATA` when that is set, else `~/.local/share/rpe`. Every command takes `--data <folder>` to use another one.

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

By default the reply is written in one call, with tags around its parts (`reply.form`: `tags`). Some models do not keep to the tags. For such a model, set the reply's form for its connection to `two-step`, in the global settings file `files/RPE-global.yml` in RPE's data folder:

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

RPE's pages are in a tab of Lumiverse's drawer called **RPE**, for the chat Lumiverse has open, and in RPE's web app (below), where you choose the chat on **Chats**. On a narrow screen, the pages used less often are behind **More**. Where RPE refuses something, a page shows it in RPE's own words.

For one chat:

- **Live**: the turn running now, or the last one: what went to the chat as it streams, and, behind a spoiler gate, the intent record and every agent with its calls and the rules that fired. **Stop** ends it.
- **Turns**: the chat's turns and each one's runs, and a turn's own page with what each agent did. **Settle now** runs the Author on the chat's newest turn against the chat as it reads now, for instance after you edited a reply in Lumiverse: it writes no reply and adds nothing to the chat. It is not offered while a turn of the chat runs, and it is refused in a branch whose newest turn is still the one it shares with the chat it was branched from: play a turn in the branch first. The chat's jobs (runs that go on after a reply, and bootstrap jobs) are listed here with what each spent and reported, and **Cancel** while one is queued or running; **Chats** lists your jobs of every chat.
- **World**: the world's state as one tree, at the chat's head or at any turn, with where each value comes from.
- **Cast**: the characters, each with their kind of casting, and, behind a spoiler gate, the Author's casting line and one character's whole record: base, growth, mind, memories, relationships, knowledge, history, perceptions, and the mind files carried from the previous build. An entry can be struck, and the strike taken back, which also stands again what the strike struck with it; that is your change, on the chat's newest turn. In a branch that has no turn of its own yet, a strike is refused until one has been played there.
- **Story**: the story record: chapters, scenes and beats, with what is current, and behind a spoiler gate the story's threads, arcs, horizon and futures. An item can be struck, and the strike taken back. The Story page also has **bootstrap**: a job that sets RPE's agents to go over a chat's past and fill in its records. It shows what the records hold so far as counts (whether that is enough is the job's to judge), the token limit at which a job stops to ask you whether to go on (with how it is counted) and each cap that ends its run, takes a limit of your own for one job, and starts one for a relive word the bootstrap skill offers or as the skill decides; with a job already under way it asks before starting a second. A job that reaches its limit shows its question there, and goes on or ends on your word. Nothing starts one by itself.
- **Lore**: his books and the world's own lore as RPE understands them: the index, a page at a time and searchable, each entry with its book, kind, the one line that says what it is, what it defines and the records it is bound to; entries no run has indexed yet by title and keys; **Index now**, naming the connection the indexing runs on; and, where the chat's story moved past an entry, each overlay with its turn.
- **Prompt**: how this chat's preset is cut into named parts: every part of the prompt map in order with its kind, line and how it was found in the turn's prompt, its text behind a spoiler gate, the text no part claims, and your five edits to the map (rename, merge, split, correct a line, change a kind), which RPH keeps with the preset. Turn by turn it lists what changed in the prompt's shape.
- **Play**: the previous build's own play panels and HUD strip, running against RPE: the scene, the map's Places, money, gear, vehicles, the cast, sheets, quests, what is known, and more, each as its world has them. A tap that manages (taking a thing off, paying, moving the clock) is kept as your change on the chat's newest turn, with an Undo. A chat with no world shows the previous build's world picker: **Attach** gives the chat a world from Build. What Play cannot do in this build: a tap that goes with your next message or plays now; the journal and the chips; the map full screen, the actions sheet (Act, Actions, Timelapse) and the World sheet, which say once that they do not open here; the things browser; walking on the map; a chat's own choices. A tap or an Undo is refused while a turn of the chat runs, and an Undo is refused where a part of it has no undo. After an Attach, a note may say the chat "plays its classic steps": those are the previous build's words, and RPE plays it.

For everything:

- **Build**: the previous build's own world builder, running against RPE: the worlds RPE keeps, opened, edited (the map editor among them) and saved. What Build cannot do in this build: its background jobs, its lore and secrecy tools, which say once that RPE does not serve them; "Attach to this chat" (Play's picker attaches); in the web app, Lumiverse's books and connections, and Regenerate, Continue and showing a reply in a chat. Build's place in a world is not kept in the web address.
- **Files**: the agents' files, level by level, each with whether it is in force; open, edit and save one at a level, delete or reset one, switch a shipped one off or on, compare with the default. The agents' suggestions, to accept, edit or dismiss. An agent's stack: every part it is given, in order. See [How behaviour lives in files](behaviour.md).
- **Connections**: RPE's model connections, each model's limits and where each comes from, **Test it**, your own context window and longest reply for a model, and signing in to a provider for a connection that signs in.
- **Settings**: every setting with its value, its default and the file that decides it, changed at a level of your choice.
- **Runtime**: the `Builds:` line, the newest update stage by stage, and **Update now** (see [Updating](#updating)); when the web key this browser holds ends.
- **Storage**: what RPE keeps by kind and how long, and what each chat's files and rows take; a chat's largest notes; pruning on request, after being told exactly what will go.
- **Migration**: the last migration's report, each chat's outcome, the backup, the worlds put into Build, what waits on you, the steps of going back, and, for every chat the migration carried, how its bootstrap stands, its own start and its question, beside one start for all of them; each start takes your token limit.
- **Chats** (web app only): the chats, those RPE has played and those the migration carried, with a way to each one's pages and to Play.

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
