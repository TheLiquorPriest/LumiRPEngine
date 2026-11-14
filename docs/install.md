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

- It signs in to Lumiverse as you. It asks for your password and does not keep it; it keeps the sign-in Lumiverse gives back, in RPE's secrets file. A later run reuses that sign-in while Lumiverse still accepts it.
- It makes RPE's connection in Lumiverse, called "RPE", or brings it up to date (see below).
- With `--systemd`, it installs and starts RPE as a service of your account, named `rpe-<name>.service`. `--name <name>` chooses the name; without it, the name comes from your username. This needs Linux with systemd.
- Last, it prints a numbered list of what is left for you to do.

A second run changes only what is not as it should be.

Without `--systemd`, run RPE in the foreground with `rpe serve`, and keep it running.

One RPE serves one Lumiverse user. A sign-in as another user is refused before anything is written.

Other commands for the service:

- `rpe status`: the build, the data folder, where RPE listens and whether it answers, the builds that run, the Lumiverse it belongs to, its keys, and anything waiting to be switched on.
- `rpe down`: stops and removes RPE's service. Its data stays where it is.
- `rpe lumiverse`: which Lumiverse this RPE belongs to, and its sign-in. With `--url` and `--user` it signs in again.
- `rpe version`: this build's id.
- `rpe backup`: one archive of RPE's database and file tree. `--out <file>` says where to write it.

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

## The web app and its key

RPE serves the same pages as the drawer tab at its own address, under `/ui/`: by default `http://127.0.0.1:7871/ui/`. The web app also has a **Chats** page.

The web app asks for a key once. Make one on the machine RPE runs on:

```sh
rpe key web
```

It is shown once. The browser keeps it until you sign out. A new one makes the one before it stop working.

RPE listens only on this machine unless you change that. To open the web app from another device, publish RPE's address over HTTPS (with a reverse proxy, for example), then list that address in `config.json`: its origin in `origins`, and its host name in `hosts`. Setting `address` makes RPE listen on another address as well; it always listens on `127.0.0.1` too, which the extension uses.

## Updating

Update the extension in Lumiverse, as with any extension. Lumiverse replaces the files in the extension's folder, `dist/rpe.js` among them.

RPE notices the new file. It checks that the file starts, waits until no turn and no job is running, and then restarts onto it. Its service starts it again. This is the setting `update.restart`, on by default.

- `rpe status` has a `Builds:` line: the build RPE runs, the build of its file on disk, the extension's build, and what RPE will do about a difference.
- A new file that does not start is never restarted onto. `rpe status` says so, and RPE goes on with the build it runs.
- RPE run by hand (`rpe serve`) never restarts by itself: stop it and start it again.
- With `update.restart` off, restart RPE's service yourself.

Your files in RPE's data folder are never changed by an update. When an update changes a shipped file you replaced with your own, RPE records it, and the **Files** page shows the difference.
