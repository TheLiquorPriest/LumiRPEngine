# Install and run RPE

RPE is one program, `dist/rpe.js`, run with Bun 1.4 or later. It runs on the same machine as Lumiverse: the extension reaches it only on that machine's own address (loopback).

In this page `rpe` stands for `bun <folder>/dist/rpe.js`, where `<folder>` is a copy of this repository. Once the extension is installed, Lumiverse keeps a copy in `<Lumiverse's data folder>/extensions/lumi_rp_engine/repo`. Use that copy for the service: an update of the extension then updates RPE too.

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

## The service: `rpe up`

```sh
rpe up --url <Lumiverse's address> --user <your Lumiverse username> --systemd
```

`rpe up` does all of this:

- It signs in to Lumiverse as you. It asks for your password and does not keep it; it keeps the sign-in Lumiverse gives back, in RPE's secrets file. A later run reuses that sign-in while Lumiverse still accepts it. With no terminal, as from a script, it reads the password from the first line piped into it.
- It makes RPE's connection in Lumiverse, called "RPE", or brings it up to date (see below).
- With `--systemd`, it installs and starts RPE as a service of your account, named `rpe-<name>.service`. `--name <name>` chooses the name; without it, the name comes from your username. This needs Linux with systemd.
- Last, it prints a numbered list of what is left for you to do.

A second run changes only what is not as it should be.

Without `--systemd`, run RPE in the foreground with `rpe serve`, and keep it running.

One RPE serves one Lumiverse user. A sign-in as another user is refused before anything is written.

Every command `rpe` has:

- `rpe up`: the above. With `--lumiverse`, the switch from the previous build: see [Moving from the previous build](migration.md#3-the-switch).
- `rpe serve`: runs RPE in the foreground.
- `rpe status`: the build, the data folder, where RPE listens and whether it answers, the builds that run, the Lumiverse it belongs to, its keys, and anything waiting to be switched on.
- `rpe down`: stops and removes RPE's service. Its data stays where it is.
- `rpe lumiverse`: which Lumiverse this RPE belongs to, and its sign-in. With `--url` and `--user` it signs in again; `--database <file>` reads Lumiverse's database file directly, and `--connection <id>` names RPE's connection in Lumiverse.
- `rpe version`: this build's id.
- `rpe key provider` and `rpe key web`: a new key, shown once; the one before it stops working. RPE makes its extension's key itself at every start, so there is no command for it. See [Security](security.md#keys-and-tokens).
- `rpe connection list`, `rpe connection add` and `rpe connection remove`: RPE's model connections (below).
- `rpe allow <name>` and `rpe deny <name>`: switch on, or off, something that runs a command or calls out. See [Security](security.md#what-rpe-never-does-by-itself).
- `rpe backup`: one archive of RPE's database and file tree. `--out <file>` says where to write it.
- `rpe migrate`: carries the previous build's data into RPE. See [Moving from the previous build](migration.md).
- `rpe check`: whether this build starts on the data folder: its config read, and its changes to the database tried on a copy, made under `--into <folder>` (a temporary folder where none is given) and removed when it ends. RPE runs it on a new build before it restarts onto it (see [Updating](#updating)).

Commands that change something are written by the running RPE when it runs, and by the command itself, under the data folder's lock, when it does not: see [The command line](security.md#the-command-line).

### The data folder

Everything RPE keeps is in one folder: its database (`rpe.db`), the files the agents read and write (`files/`), its secrets file (`secrets.json`), its config file (`config.json`) and its backups (`backups/`). The folder is `$RPE_DATA` when that is set, else `~/.local/share/rpe`. Every command takes `--data <folder>` to use another one.

`config.json` says where RPE listens, which Lumiverse it serves, and RPE's own limits. Each value and its default is in [Settings](settings.md#the-application-configjson). Four values can also come from the environment, which wins over the file: `RPE_ADDRESS`, `RPE_PORT`, `RPE_LUMIVERSE_URL` and `RPE_LUMIVERSE_USER`.

By default RPE listens on `127.0.0.1`, port `7871`.

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
reply:
  forms:
    deepseek: two-step
  streamAnyway: [deepseek]
effort:
  connections:
    deepseek: off
```

`reply.forms.<connection>` and `effort.connections.<connection>` are set per connection, by its name or its id. See [Settings](settings.md).

## The pages

RPE's pages are in a tab of Lumiverse's drawer called **RPE**, for the chat Lumiverse has open, and in RPE's web app (below), where you choose the chat on **Chats**. On a narrow screen, the pages used less often are behind **More**. Where RPE refuses something, a page shows it in RPE's own words.

For one chat:

- **Live**: the turn running now, or the last one: what went to the chat as it streams, and, behind a spoiler gate, the intent record and every agent with its calls and the rules that fired. **Stop** ends it.
- **Turns**: the chat's turns and each one's runs, and a turn's own page with what each agent did. **Settle now** runs the Author on the chat's newest turn against the chat as it reads now, for instance after you edited a reply in Lumiverse: it writes no reply and adds nothing to the chat. It is not offered while a turn of the chat runs, and it is refused in a branch whose newest turn is still the one it shares with the chat it was branched from: play a turn in the branch first. The chat's jobs (runs that go on after a reply, and bootstrap jobs) are listed here with what each spent and reported, and **Cancel** while one is queued or running; **Chats** lists your jobs of every chat.
- **World**: the world's state as one tree, at the chat's head or at any turn, with where each value comes from.
- **Cast**: the characters, each with their kind of casting, and, behind a spoiler gate, the Author's casting line and one character's whole record: base, growth, mind, memories, relationships, knowledge, history, perceptions, and the mind files carried from the previous build. An entry can be struck, and the strike taken back, which also stands again what the strike struck with it; that is your change, on the chat's newest turn. In a branch that has no turn of its own yet, a strike is refused until one has been played there.
- **Story**: the story record: chapters, scenes and beats, with what is current, and behind a spoiler gate the story's threads, arcs, horizon and futures. An item can be struck, and the strike taken back. The Story page also has **bootstrap**: a job that sets RPE's agents to go over a chat's past and fill in its records. It shows what the records hold so far as counts (lore, history, cast, story, horizon, the principal characters; whether that is enough is the job's to judge, by the bootstrap skill) and the chat's bootstrap jobs, and starts one, for the outline, the key moments, all of it, or as the bootstrap skill decides. Nothing starts one by itself.
- **Play**: the previous build's own play panels and HUD strip, running against RPE: the scene, the map's Places, money, gear, vehicles, the cast, sheets, quests, what is known, and more, each as its world has them. A tap that manages (taking a thing off, paying, moving the clock) is kept as your change on the chat's newest turn, with an Undo. A chat with no world shows the previous build's world picker: **Attach** gives the chat a world from Build. What Play cannot do in this build: a tap that goes with your next message or plays now; the journal and the chips; the map full screen, the actions sheet (Act, Actions, Timelapse) and the World sheet, which say once that they do not open here; the things browser; walking on the map; a chat's own choices. A tap or an Undo is refused while a turn of the chat runs, and an Undo is refused where a part of it has no undo. After an Attach, a note may say the chat "plays its classic steps": those are the previous build's words, and RPE plays it.

For everything:

- **Build**: the previous build's own world builder, running against RPE: the worlds RPE keeps, opened, edited (the map editor among them) and saved. What Build cannot do in this build: its background jobs, its lore and secrecy tools, which say once that RPE does not serve them; "Attach to this chat" (Play's picker attaches); in the web app, Lumiverse's books and connections, and Regenerate, Continue and showing a reply in a chat. Build's place in a world is not kept in the web address.
- **Files**: the agents' files, level by level, each with whether it is in force; open, edit and save one at a level, delete or reset one, switch a shipped one off or on, compare with the default. The agents' suggestions, to accept, edit or dismiss. An agent's stack: every part it is given, in order. See [How behaviour lives in files](behaviour.md).
- **Connections**: RPE's model connections, each model's limits and where each comes from, **Test it**, and your own context window and longest reply for a model.
- **Settings**: every setting with its value, its default and the file that decides it, changed at a level of your choice. It also shows the `Builds:` line, and **Update now** when a new build waits (see [Updating](#updating)).
- **Storage**: what RPE's files take, chat by chat; a chat's largest notes; pruning a chat's old turn folders.
- **Migration**: the last migration's report, each chat's outcome, the backup, the worlds put into Build, what waits on you, the steps of going back, and a bootstrap job for every chat the migration carried.
- **Chats** (web app only): the chats, those RPE has played and those the migration carried, with a way to each one's pages and to Play.

## The web app and its key

RPE serves the same pages as the drawer tab at its own address, under `/ui/`: by default `http://127.0.0.1:7871/ui/`. The web app also has the **Chats** page.

The web app asks for a key once. Make one on the machine RPE runs on:

```sh
rpe key web
```

It is shown once. The browser keeps it until you sign out, or until RPE stops taking it. A new one makes the one before it stop working. As shipped a web key has no end; with `auth.webKeyDays` set, it runs out that many days after it is made, and `rpe key web` prints when.

RPE listens only on this machine unless you change that. To open the web app from another device, publish RPE's address over HTTPS (with a reverse proxy, for example), then list that address in `config.json`: its origin in `origins`, and its host name in `hosts`. Setting `address` makes RPE listen on another address as well; it always listens on `127.0.0.1` too, which the extension uses.

## Updating

Update the extension in Lumiverse, as with any extension. Lumiverse replaces the files in the extension's folder, `dist/rpe.js` among them. The built files are part of the repository, so Lumiverse builds nothing and installs nothing. (Moving onto this build from the previous one is not an update: it is Lumiverse's "switch branch", in [Moving from the previous build](migration.md#3-the-switch).)

RPE notices the new file. Before it restarts onto it, it has the new build check that it starts on RPE's data (`rpe check`), within `update.checkWait` seconds. Then it waits until no turn and no job is running, and restarts onto it, and its service starts it again. This is the setting `update.restart`, on by default.

- `rpe status` has a `Builds:` line: the build RPE runs, the build of its file on disk, the extension's build, and what RPE will do about a difference. The **Settings** page shows the same line.
- A new build that fails the check, or does not say its build within `update.versionWait` seconds, is never restarted onto. `rpe status` says so and why, and RPE goes on with the build it runs.
- A build that starts and then keeps failing all the same is left stopped: the service `rpe up` writes stops starting RPE after `update.startTries` starts within `update.startWindow` seconds.
- RPE run by hand (`rpe serve`) never restarts by itself: stop it and start it again.
- With `update.restart` off, RPE waits for you: **Update now** on the Settings page restarts it onto the new build, or restart RPE's service yourself.

Your files in RPE's data folder are never changed by an update. When an update changes a shipped file you replaced with your own, RPE records it, and the **Files** page shows the difference.
