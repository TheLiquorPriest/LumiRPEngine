# Security

## What RPE listens to

RPE listens on `127.0.0.1`, and on `server.address` as well where you set it in `files/RPE-global.yml`. It checks every request before any route runs: the `Host` it was sent to (its own address, or a name in `server.hosts`), a page's origin (its own, Lumiverse's, or one in `server.origins`), the key or token it carries, and its size.

One route answers anyone who reaches RPE: its status, `/api/v1/status`, which says only that RPE answers and which build it runs. Which builds run and what RPE will do about a new one (`/api/v1/status/builds`) is told only with a page token or a web key.

## Keys and tokens

Each key is random, shown once when it is made, and kept only as a hash. A new key of a kind stops the one before it at once. `rpe status` shows the last four characters of the provider key, and for each key when it was made and, for the web key, when it runs out; never a key itself. The provider key is kept in the database's `provider_key`; the web key and the extension's key, which are tokens like a page's, in `page_token`, each with who made it and when it ends. Each kind starts alike, so you can tell which you hold.

| Key | Starts with | What it opens | How it is made |
|---|---|---|---|
| Provider key | `rpe_` | RPE's provider endpoint (`/v1/chat/completions` and `/v1/models`): the replies Lumiverse asks for on RPE's connection. Nothing else. | `rpe up` makes it and gives it to RPE's connection in Lumiverse. `rpe key provider` makes a new one; put it in that connection as its API key. After the switch from the previous build, the one provider key is the one the connection RPE took over already holds (`rpe status` lists it as taken from today's connection), which replaces RPE's own earlier key; RPE then makes no new provider key, because a new one would have to be put in that connection and that would make going back harder. |
| Extension key | `rpx_` | The routes only RPE's extension calls: the questions before each reply, the page tokens, and the confirmation of RPE's registration. | RPE makes a new one at every start and hands it to its extension. There is no command that makes one: a key made by hand would cut the extension off until RPE started again, and `rpe key extension` says so. |
| Web key | `rpw_` | RPE's web app and its API, as you. | `rpe key web`, on the machine RPE runs on. As shipped it has no end, and works until a new one replaces it. With `auth.webKeyDays` set, it runs out that many days after it is made: `rpe key web` prints when, and `rpe status` lists it. |
| Page token | `rpp_` | RPE's API, as you, for 30 minutes (`auth.pageTokenMinutes`). | The extension asks RPE for one for a page in Lumiverse, and only for the Lumiverse user this RPE belongs to. Another user of the same Lumiverse gets none. |

## The command line

RPE writes its database and its secrets file from one place at a time. While RPE runs, it is the one writer: a command that changes something (`rpe key`, `rpe allow`, `rpe deny`, `rpe lumiverse`, `rpe up`) or reads how RPE stands (`rpe status`, `rpe connection`) asks the running RPE over a Unix socket, command.sock in the data folder, which only your account can open and which is never offered on the network, so no page and no request through Lumiverse reaches it. What it asks is written in RPE's own queue, and the command's own process opens neither the database nor the secrets file for writing. No page token is made for it.

While RPE is stopped, a command that writes takes the data folder's lock (lock.db, named by lock.holder) and is then the only writer, the changes to the database it applies included. `rpe serve` takes the same lock for as long as it runs: started while a command writes, it waits and says what it waits for; two commands at once write one after the other, each waiting up to `commandLine.waitMs` and saying which process it waits for.

A page's live socket holds its key or token for as long as it is open: it is checked when the socket opens and at every message, and the socket is closed once the page token or the web key runs out, or the web key is replaced. One socket follows at most `liveSocket.follows` chats.

The extension takes RPE's registration only at a bare address on this machine (a scheme, a loopback host and a port, nothing more); any other is refused before a call goes out.

**One RPE serves one Lumiverse user.** A sign-in as another user is refused before anything is written.

## Secrets

Your model providers' keys, sign-ins to providers, and RPE's sign-in to Lumiverse are in `secrets.json` in RPE's data folder, which only your account can read. They are never in the files agents see, never in a transcript or a turn's folder, and never sent to a page. Your Lumiverse password is asked for when RPE signs in, and is not kept.

Each provider key, and each header value a connection sends, is kept with the place it was given for: the connection's provider and the server its address names (its scheme, host and port). When a connection is moved to another server, on the Connections page, by a setting or by hand while RPE was stopped, they are dropped rather than sent there, and you give them again. This holds across a restart too, and across a run of the migration: the run keeps that place beside each key RPE already holds, and a key it takes from the previous build goes only where the previous build sends it.

## What RPE reads and writes

- **Lumiverse's database** is opened read-only, and only your user's rows are read. RPE cannot write to it.
- **The previous build's data** is opened read-only by the migration. The backup it takes holds your content and stays in RPE's data folder, readable only by you.
- **In Lumiverse**, RPE makes and updates its own connection when you run `rpe up`. It does not write to your lore books, presets or regex scripts.

## What the agents can do

- They have no shell. They cannot run a command.
- They see the chat's folder, with the other levels of files read-only. Paths cannot leave it, and links are not followed.
- They write only their notes (`persistent-workspace/`) and their working files in the turn's folder. Your instruction files, rules, skills and definitions they can only read. To change one, they file a suggestion, and you decide.
- Lore and chat text are data to them, not instructions to act outside RPE.

## What RPE never does by itself

RPE switches on nothing that runs a command or calls out on its own. A hook, a command a rule runs, a command tool, an MCP server started by a command, or the address an HTTP tool or an MCP server calls: written in a file or added in a page, each is only listed as waiting. It runs only once you switch it on from the server's own command line:

```sh
rpe allow <name>
rpe deny <name>
```

No page session can do that, however it was opened, so a page that reaches RPE cannot plant code or point a tool at an address of its choosing. `rpe status` lists what is waiting. (This build has no tools that run a command or call out yet; see [the README](../README.md#what-this-build-does-not-have-yet).)

Rules that only add text to what an agent reads need no such step. They can say anything to an agent, and can run nothing.
