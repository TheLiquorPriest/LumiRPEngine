# Security

## What RPE listens to

RPE listens on `127.0.0.1` unless you set `address` in its `config.json`. It checks every request before any route runs: the `Host` it was sent to (its own address, or a name in `hosts`), a page's origin (its own, Lumiverse's, or one in `origins`), the key or token it carries, and its size.

## Keys and tokens

Each key is random, shown once when it is made, and kept only as a hash. A new key of a kind stops the one before it at once. `rpe status` shows the last four characters of each and when it was made. Each kind starts alike, so you can tell which you hold.

| Key | Starts with | What it opens | How it is made |
|---|---|---|---|
| Provider key | `rpe_` | RPE's provider endpoint (`/v1/chat/completions` and `/v1/models`): the replies Lumiverse asks for on RPE's connection. Nothing else. | `rpe up` makes it and gives it to RPE's connection in Lumiverse. `rpe key provider` makes a new one; put it in that connection as its API key. |
| Extension key | `rpx_` | The routes only RPE's extension calls: the questions before each reply, the page tokens, and the confirmation of RPE's registration. | RPE makes a new one at every start and hands it to its extension. You never need to make one. |
| Web key | `rpw_` | RPE's web app and its API, as you. | `rpe key web`, on the machine RPE runs on. |
| Page token | `rpp_` | RPE's API, as you, for 30 minutes (`auth.pageTokenMinutes`). | The extension asks RPE for one for a page in Lumiverse, and only for the Lumiverse user this RPE belongs to. Another user of the same Lumiverse gets none. |

The command line makes its own short-lived token when it calls the running RPE (`rpe connection`), and lets it go after.

**One RPE serves one Lumiverse user.** A sign-in as another user is refused before anything is written.

## Secrets

Your model providers' keys, sign-ins to providers, and RPE's sign-in to Lumiverse are in `secrets.json` in RPE's data folder, which only your account can read. They are never in the files agents see, never in a transcript or a turn's folder, and never sent to a page. Your Lumiverse password is asked for when RPE signs in, and is not kept.

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
