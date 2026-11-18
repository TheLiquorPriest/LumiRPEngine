# Security

## What RPE listens to

RPE listens on `127.0.0.1`, and on `server.address` as well where you set it in `files/RPE-global.yml`. It checks every request before any route runs: the `Host` it was sent to (its own address, or a name in `server.hosts`), a page's origin (its own, Lumiverse's, or one in `server.origins`), the key or token it carries, and its size.

One route answers anyone who reaches RPE: its status, `/api/v1/status`, which says only that RPE answers, which build it runs and the address of the Lumiverse it belongs to. Which builds run and what RPE will do about a new one (`/api/v1/status/builds`) is told only with a page token or a web key.

## Keys and tokens

Each key is random, shown once when it is made, and kept only as a hash. A new key of a kind stops the one before it at once. `rpe status` shows the last four characters of the provider key, and for each key when it was made and, for the web key, when it runs out; never a key itself. The provider key is kept in the database's `provider_key`; the web key and the extension's key, which are tokens like a page's, in `page_token`, each with who made it and when it ends. Each kind starts alike, so you can tell which you hold.

| Key | Starts with | What it opens | How it is made |
|---|---|---|---|
| Provider key | `rpe_` | RPE's provider endpoint (`/v1/chat/completions` and `/v1/models`): the replies Lumiverse asks for on RPE's connection. Nothing else. | `rpe up` makes it and gives it to RPE's connection in Lumiverse. `rpe key provider` makes a new one; put it in that connection as its API key. After the switch from the previous build, the one provider key is the one the connection RPE took over already holds (`rpe status` lists it as taken from today's connection), which replaces RPE's own earlier key; RPE then makes no new provider key, because a new one would have to be put in that connection and that would make going back harder. |
| Extension key | `rpx_` | The routes only RPE's extension calls: the questions before each reply, the page tokens, and the confirmation of RPE's registration. | RPE makes a new one at every start and hands it to its extension. There is no command that makes one: a key made by hand would cut the extension off until RPE started again, and `rpe key extension` says so. |
| Web key | `rpw_` | RPE's web app and its API, as you. | `rpe key web`, on the machine RPE runs on. As shipped it has no end, and works until a new one replaces it. With `auth.webKeyDays` set, it runs out that many days after it is made: `rpe key web` prints when, and `rpe status` lists it. |
| Session | `rpp_` | RPE's API, as you, from the web app (or the command line or the MCP server that asked for it), for `auth.webSessionMinutes` (30 minutes), renewed while a page is open. | Made by trading the printed web key, or by signing in with your Lumiverse account (below). It names the client that asked for it. |
| Page token | `rpp_` | RPE's API, as you, for 30 minutes (`auth.pageTokenMinutes`). | The extension asks RPE for one for a page in Lumiverse, and only for the Lumiverse user this RPE belongs to. Another user of the same Lumiverse gets none. |

## Signing in to the web app

The web app (`/ui/`) takes two ways in, and the browser keeps only a session, which ends at its time:

- **The printed token.** `rpe up` prints the web key once, at the first install (`rpe key web` makes a new one). The web app trades it, once, for a session; the browser keeps the session and never the key. The session ends `auth.webSessionMinutes` after it was made unless a page that is open renews it. A key that has been replaced opens no session.
- **Your Lumiverse account.** The web app takes your Lumiverse username and password, or a Lumiverse sign-in the command line already holds, and RPE checks it against Lumiverse and accepts it only for the Lumiverse user this RPE belongs to. RPE keeps no password. It sends Lumiverse no more than `auth.signInTries` wrong passwords (4, below the 5 after which Lumiverse locks an address out) and then none for `auth.signInPauseMinutes` (15), so that RPE's own address is never locked out. A sign-in by password makes a Lumiverse session, which RPE hands back (the command line keeps it as its own; the web app keeps none) and holds for that sign-in's session in its secrets file, across a restart too: signing out ends the session and that Lumiverse session through the door. One whose RPE session ran out without a sign-out is let go and ends at Lumiverse's own time.

A session says which client asked for it: the web app, or the command line or the MCP server for outside harnesses (which come with a later build). A route reads that from the session it was called with: a commit made with the command line's or the MCP server's session is the agent's, and one made from a page is Build's.

Before a page sends RPE a token, it asks RPE to prove that it is RPE: the page sends the first characters of the hash of its token and a nonce of its own, and RPE answers with the nonce's keyed hash, which only something that holds RPE's table of tokens can make. The page offers its token only to an address whose answer matches. RPE answers a nonce once within `auth.nonceSeconds` (60), and only for a page token still in time.

The web app is served with a policy that runs RPE's own scripts only (`script-src 'self'`) beside the one that lets no other site frame it, and its built page holds no inline script.

## The command line

RPE writes its database and its secrets file from one place at a time. While RPE runs, it is the one writer: a command that changes something (`rpe key`, `rpe allow`, `rpe deny`, `rpe lumiverse`, `rpe up`) or reads how RPE stands (`rpe status`, `rpe connection`) asks the running RPE over a Unix socket, command.sock in the data folder, which only your account can open and which is never offered on the network, so no page and no request through Lumiverse reaches it. What it asks is written in RPE's own queue, and the command's own process opens neither the database nor the secrets file for writing. No page token is made for it.

While RPE is stopped, a command that writes takes the data folder's lock (lock.db, named by lock.holder) and is then the only writer, the changes to the database it applies included. `rpe serve` takes the same lock for as long as it runs: started while a command writes, it waits and says what it waits for; two commands at once write one after the other, each waiting up to `commandLine.waitMs` and saying which process it waits for.

A page's live socket holds its key or token for as long as it is open: it is checked when the socket opens and at every message, and the socket is closed once the page token or the web key runs out, or the web key is replaced. One socket follows at most `liveSocket.maxFollows` chats.

The extension takes RPE's registration only at a bare address on this machine (a scheme, a loopback host and a port, nothing more); any other is refused before a call goes out.

**One RPE serves one Lumiverse user.** A sign-in as another user is refused before anything is written.

## Secrets

Your model providers' keys, sign-ins to providers, and RPE's sign-in to Lumiverse are in `secrets.json` in RPE's data folder, which only your account can read. They are never in the files agents see, never in a transcript or a turn's folder, and never sent to a page. Your Lumiverse password is asked for when RPE signs in, and is not kept.

Each provider key, and each header value a connection sends, is kept with the place it was given for: the connection's provider and the server its address names (its scheme, host and port). When a connection is moved to another server, on the Connections page, by a setting or by hand while RPE was stopped, they are held and sent nowhere: the connection's new place is listed as waiting, with the address it would go to, until you switch it on with `rpe allow <connection>` on the server (`rpe deny` keeps them held). No page session can do that, so a page cannot send a key to an address of its choosing. This holds across a restart too, and across a run of the migration: the run keeps that place beside each key RPE already holds, and a key it takes from the previous build goes only where the previous build sends it.

## What RPE reads and writes

- **Lumiverse's database** is opened read-only, and only your user's rows are read. RPE cannot write to it.
- **The previous build's data** is opened read-only by the migration. The backup it takes holds your content and stays in RPE's data folder, readable only by you.
- **In Lumiverse**, RPE writes through Lumiverse's own routes, as you, and only this: its own connection when you run `rpe up` (and a mark in the metadata of each connection the switch took over, which `rpe down` takes off); a lore entry in your own books when you approve a proposal or press a write in Build, each with a check that the entry is as it was read and a copy of what it was, so it can be put back; where you switch `lore.projection` on, a book of RPE's own attached to one chat, which it rewrites and removes; a line of yours put in a chat as your message when you tap something that plays now; and the generations it starts. It never writes your presets or your regex scripts, and writes nothing into a message's or a chat's metadata beyond the one key that attaches that projection book.

## What the agents can do

- They have no shell of their own. What runs a command or calls out is only a command tool, an HTTP tool, an MCP server or a hook that you wrote or added, and each waits until you switch it on (below).
- They see the chat's folder, with the other levels of files read-only. Paths cannot leave it, and links are not followed.
- They write only their notes (`persistent-workspace/`) and their working files in the turn's folder. Your instruction files, rules, skills and definitions they can only read. To change one, they file a suggestion, and you decide. Through their tools they change RPE's own records (the world, the cast, the story) as the turn's changes, which you can see and take back, and they propose lore entries, which wait for your approval.
- Lore and chat text are data to them, not instructions to act outside RPE.

## What RPE never does by itself

RPE switches on nothing that runs a command or calls out on its own. A hook, a command a rule runs, a command tool, an MCP server started by a command, the address an HTTP tool or an MCP server calls, or a connection's key at the address its connection now goes to: written in a file or added in a page, each is only listed as waiting: RPE lists it when it looks at the files, which it does whenever the list is read and before anything would run it or call it. It runs only once you switch it on from the server's own command line:

```sh
rpe allow <name>
rpe deny <name>
```

What is switched on is each user's own: a thing on for one user is not on for another, even of the same kind, name and target (`--user <id>` names the user; without it, the user this RPE belongs to). A thing that changes, in its command or its address, waits again: the switch holds what you were shown.

The list is what your files name now. A hook, a command a rule runs, a tool or a server whose file you delete, or whose name you take out of a file, leaves the list at the next read, and `rpe allow` finds nothing of that name; a switch you had set for it is kept, and it is listed again, as you set it, once a file names it again. A connection's address is named by no file and stays listed. With RPE stopped nothing can look at your files, and the list is what RPE had listed when it last ran.

No page session can switch anything, however it was opened, so a page that reaches RPE cannot plant code or point a tool at an address of its choosing. A page can only read the list: the Rules and Runtime pages show each thing, whether it waits, is on or is off, and what it runs or calls. While RPE runs, every read of the list looks at your files as they stand then, the shared ones and each chat's: `rpe allow` with no name, `rpe allow <name>` and `rpe deny <name>`, the count and lines of `rpe status`, and the list a page reads (the Files page shows what waits in the file you have open). So a hook, a command a rule runs, a tool or an MCP server you write in a file, whether on a page or with an editor on the server, is listed as waiting the moment you next read the list, and a run that would use it asks for it as it reads the files, so it is listed before an agent can load it and is never run unlisted. `rpe allow` with no name lists each user's own things, and `rpe status` lists what is waiting. While RPE is stopped no file is looked at: those two commands show what RPE had listed when it last ran and say so, and RPE lists what your files name when it starts. The longest name a thing may have is the setting `switches.maxNameChars`.

Rules that only add text to what an agent reads need no such step. They can say anything to an agent, and can run nothing.
