# The loopback

On a [depth](DEPTH.md) chat, LumiRPEngine runs the whole turn inside Lumiverse's own call for the reply: the author sets the scene, the characters act, and the narrator's prose streams into the chat while the thinking block shows the work as it happens. That needs the **loopback**: a small relay on the machine that runs Lumiverse, which Lumiverse calls like any OpenAI-compatible provider.

The relay holds no model keys and no story. It hands Lumiverse's call to LumiRPEngine and streams the answer back; every model call LumiRPEngine makes still goes through your own connections, on the models you pick in **Settings → Depth**.

Setting it up takes four steps: start the relay, mint a key, add the connection, and pick it for your world chat.

- [1. Start the relay](#1-start-the-relay)
- [2. Mint your loopback key](#2-mint-your-loopback-key)
- [3. Add the loopback connection](#3-add-the-loopback-connection)
- [4. Use it in your world chat](#4-use-it-in-your-world-chat)
- [Settings → Loopback](#settings--loopback)
- [Keep it running](#keep-it-running)
- [What you see in a chat](#what-you-see-in-a-chat)
- [Docker](#docker)
- [A server with several users](#a-server-with-several-users)
- [Command reference](#command-reference)
- [Troubleshooting](#troubleshooting)

## 1. Start the relay

**LumiRPEngine → Settings → Loopback** (in the Depth group) shows the line for your server, with Bun's and LumiRPEngine's paths filled in, and **Copy** beside it. Run it once in a terminal on the machine Lumiverse runs on. Wherever you paste it, it runs **as the account Lumiverse runs as**: the page puts `sudo -u <that account>` in front of it (nothing when Lumiverse runs as root), and `--cwd /` after Bun, so Bun reads no `bunfig.toml` or `.env` from the directory you paste it in. On a Linux server where Lumiverse runs as a service under its own account (`lumi` here), it reads:

```sh
sudo -u lumi /home/lumi/.bun/bin/bun --cwd / /srv/lumiverse/data/extensions/<id>/repo/dist/lumirpengine.js loopback up --url http://127.0.0.1:7860 --systemd
```

Don't run it with plain `sudo`. Bun and LumiRPEngine's files belong to Lumiverse's account, and every update of LumiRPEngine replaces them, so whoever can run code as that account could change them and get root the next time root runs them. Every `loopback` command checks that no account but its own and root can change Bun, `lumirpengine.js` and the kit beside it, and every directory above them; run as root, that root alone can, and the directory it runs in too, with any `bunfig.toml` or `.env` there. If not, it refuses before it signs in, names each file, and prints the lines to run instead: `sudo loginctl enable-linger <account>` and the line again with `sudo -u <account>`. So the line pasted without its `sudo -u` from another login (your own, say) refuses too, rather than run, and install as that login's own service, files Lumiverse's account can change.

The page offers two forms:

- **As a service** (`--systemd`): installs a systemd service, so the relay survives logout and reboot. This is the one to use.
- **In the foreground**: the same relay, running until you close the terminal. Handy to try it first.

When the page can't fill a part in (the address you open Lumiverse at, where Bun is), it says which and shows the line for you to complete.

What `loopback up` does:

1. **Signs in to Lumiverse** as you, or uses the sign-in `lumirpengine login` saved while it holds. The password is asked at a hidden prompt or read from `LUMIVERSE_PASSWORD`, and never kept.
2. **Registers the relay** with LumiRPEngine, which gives it a secret only it holds. An account has at most 8 relays registered at once: **Forget** one in Settings → Loopback to add another.
3. **Keeps it out of your local-inference scheduler**: it adds the relay's address (`http://127.0.0.1:<port>` and `http://localhost:<port>`) to the scheduler's **Excluded origins**, so the scheduler never makes a reply wait behind its own calls. Lumiverse reads that list through a 5-second cache, so a reply started within 5 seconds of `up` may still wait.
4. **Writes its config**: `~/.config/lumirpengine/loopback-<name>.json` (or `/etc/lumirpengine/loopback-<name>.json` for a system service), readable only by the account that runs it.
5. **With `--systemd`, installs the service.** It copies itself to a stable place (`~/.local/share/lumirpengine/`), so an update of LumiRPEngine never pulls the file out from under it, then writes, enables and starts the user unit `lumirpengine-loopback-<name>.service`, which runs it with Bun's absolute path. A user unit starts at boot and outlives a logout only with **lingering** on. `up` turns lingering on where the system lets the account do that for itself. Otherwise it says so and prints the line to run, `sudo loginctl enable-linger <account>`. A service account that is never logged in has no service manager until lingering is on, so then `up` stops and asks you to run that line first and then `up` again.

**A system service instead.** If you keep root-owned copies of Bun, `lumirpengine.js` and its kit (check they are the files you installed), `loopback up --systemd --account <the account Lumiverse runs as>` run as root from those copies, with `--cwd /` after Bun, installs a system unit. `up` copies all three into `/var/lib/lumirpengine/`, and the unit runs those copies as that account (`User=`, never root), ordered after `lumiverse.service` (`--after <unit>` for another name). The copies there stay root's, but once the service's **Update** line has run, `lumirpengine.js` and its kit hold what that account read from its own install, so never run anything there as root, not even `loopback down` or `status` to see a line. A `loopback` command run as root from `/var/lib/lumirpengine/` refuses, but only as a convenience for a genuine copy: the refusal is the copy's own code, so a copy its account changed needn't refuse, and its code has run as root by then. To change the service, run `up` as root again from your own checked copies, kept elsewhere; it keeps the account it had. Root stops and removes it with systemd's own programs alone (the unit file's first line names this line too):

```sh
sudo systemctl disable --now lumirpengine-loopback-<name>.service && sudo rm /etc/systemd/system/lumirpengine-loopback-<name>.service && sudo systemctl daemon-reload
```

and sees it with `systemctl status lumirpengine-loopback-<name>.service`. Its `down` and `status`, run as its account, print the same lines. Every line Settings → Loopback or the command line gives root for a system service runs only `systemctl`, `install` and `rm`, never the copies.

The relay needs Bun: under Node, `loopback up` and `loopback serve` say so and stop.

**Options:**
- `--port <n>`: 7861 by default, or the first free port up to 7899. A relay set up before keeps its port.
- `--listen <host>`: 127.0.0.1 by default. Any other address can be reached from other machines, and `up` warns. Each call must still be addressed to that address, unless it is a wildcard (`0.0.0.0`, `::`). See [what it answers](#command-reference).
- `--name <name>`: your Lumiverse username by default; one relay per name. `up` without root never takes the name of a relay a system service runs on that machine.
- `--username <name>`
- `--allow-http`: plain http to Lumiverse on another machine.
- `--bun <absolute path>`
- `--account <user>`: system service only.
- `--shared`: see [below](#a-server-with-several-users).

## 2. Mint your loopback key

Under **Your loopback key**, press **Mint a key**. The key shows once, with **Copy**: copy it now. The page then shows its fingerprint and when it was made. **Rotate** makes a new key, and the old one stops working at once: set the new one as the connection's API key. Each user has a key of their own.

## 3. Add the loopback connection

LumiRPEngine can't make connections in Lumiverse, so this step is yours. In Lumiverse's **Connections**, add one:

- **Provider:** Custom (OpenAI-compatible)
- **Base URL:** the relay's address, `http://127.0.0.1:<port>/v1` (the page shows it, with **Copy**)
- **Model:** `lre-narrator`
- **API key:** your loopback key

Press the connection's **Test**: the model list shows `lre-narrator` when the key is right. **The loopback connection** on Settings → Loopback then says which of your connections LumiRPEngine treats as the loopback. A connection counts when it is Custom and either names the model `lre-narrator` or has a base URL at the address and port of a relay you registered yourself. Another account's relay never makes one of your connections the loopback, and that includes the shared relay, whose users name `lre-narrator`.

## 4. Use it in your world chat

1. **The loopback connection** is picked for you: turning depth on (step 4) pins the chat to it, keeping the loopback the chat is pinned to if it is one, else your first. Turning depth off puts back the chat's earlier pin.
2. **Make sure the preset streams.** LumiRPEngine refuses a turn with streaming off and says which setting to change. It never changes your preset.
3. **Pick the real models** in **Settings → Depth**. LumiRPEngine never sends its own calls to the loopback connection, and refuses a role whose connection is the loopback, saying which.
4. **Turn depth on** in GM → This chat → Depth (see [the depth guide](DEPTH.md)).

Other requests on the loopback connection (summaries, council planning, other extensions' calls) pass through to your Narrator connection as they are, tools included. A world chat's reply on it always runs as a turn. If LumiRPEngine can't tie a reply to its turn, because it never heard the reply start, it stops the reply and says so rather than let it through untracked. Generating again plays it.

## Settings → Loopback

From top to bottom:

- **Start the relay**: the two lines above, each with **Copy**.
- **Your loopback key**: its fingerprint and when it was made; **Mint a key** or **Rotate**.
- **Your relays** (**Refresh** reloads): each relay with when it was last heard, where it listens, how it runs (system service, user service, foreground), its build, the local-inference scheduler, and its Lumiverse session. Badges: **Running**, **Update**, **Sign-in needed**, **Shared**. **Sign-in needed** shows the `loopback login` line with **Copy**; **Update** shows the update-and-restart line. Every line runs as the account Lumiverse runs as, from `/`, and runs LumiRPEngine's own install or a system service's copies of it, never a path the relay reports. A system service's lines run as root only system programs: `install` writing the new files that account read over the copies in `/var/lib/lumirpengine/`, and `systemctl`. A relay missing from the scheduler's exclusions gets **Fix**: Lumiverse applies it within 5 seconds, so wait that long before generating. **Forget** removes your own relay from LumiRPEngine (stop it on its machine with `loopback down`).
- **The loopback connection**: which of your connections is the loopback, and **Make the loopback connection**, the settings above with **Copy** on each.
- **The shared relay**: the operator's **Allow a shared relay** switch; everyone else sees whether it's allowed.
- **How replies travel**: every reply goes through the relay. Where Lumiverse has message sessions (an in-process route for new replies), the page says why they aren't used yet: Lumiverse can't yet complete a reply an extension writes passage by passage.

## Keep it running

- `lumirpengine loopback status [--name <name>]`: its config, its service, whether it reaches LumiRPEngine, and until when its Lumiverse session holds. For a system service, run as its account, it gives `systemctl status lumirpengine-loopback-<name>.service` for its unit.
- **Sign-in.** The relay renews its session once a day. If it ends anyway (you signed it out, or the server was off for a week), Settings → Loopback says **Sign-in needed**, and a chat's reply says the same. Run the line the page shows. For a user service it is `lumirpengine loopback login --name <name>`, run as the account the relay runs as, which restarts the service. For a system service it runs the service's copies as that account, which writes the relay's config in place, and root then restarts the unit: `sudo -u <account> /var/lib/lumirpengine/bun --cwd / /var/lib/lumirpengine/lumirpengine.js loopback login --config /etc/lumirpengine/loopback-<name>.json && sudo systemctl restart lumirpengine-loopback-<name>.service`. A relay running in the foreground takes the new sign-in when it next connects.
- **Updates.** After LumiRPEngine updates, Settings → Loopback shows **Update** when the relay's copy is from another build. For a user service the line is the start line again, run as the same account: it updates the copy and restarts it. For a system service, run in sh, bash or zsh, the account reads the new `lumirpengine.js` and its kit into a directory of your own that `mktemp` makes (`sudo -u <account> cat … >"$t"/…`). Only when both reads succeeded and neither is empty (`test -s`) does root write them over the service's copies in `/var/lib/lumirpengine/` (`sudo install -m 0644 "$t"/… …`), and only once both are written does it restart the unit (`sudo systemctl restart`), so a read that fails (`sudo -u` refused, LumiRPEngine mid-update) leaves the copies as they were. Root reads none of the account's files itself, only the ones in your directory, so it never follows a link the account made to a file only root may read, and neither line has root run the copies: the unit runs them as the account.
- `lumirpengine loopback down --name <name>` stops and removes a user service. For a system service, run it as its account (never as root from `/var/lib/lumirpengine`): it prints the line root runs, with systemd's own programs, `sudo systemctl disable --now lumirpengine-loopback-<name>.service && sudo rm /etc/systemd/system/lumirpengine-loopback-<name>.service && sudo systemctl daemon-reload` (see [A system service instead](#1-start-the-relay)). Its config stays until you delete it.

## What you see in a chat

The thinking block streams the turn: the author's thinking, each beat as it is decided, each passage's check and the narrator's own reasoning, then the reply. A step that runs a minute with nothing else to show gets a progress line ("The author is setting the scene (2 min)"), only while LumiRPEngine is answering, so the block never claims work that isn't happening.

**Stop** works as usual: the turn keeps the beats whose prose streamed, whichever reached LumiRPEngine first, the relay's word or Lumiverse's Stop. A send stopped before any text leaves no blank reply: LumiRPEngine deletes the empty message Lumiverse staged, and generating again is a new reply. A swipe stopped before any text leaves no blank swipe.

**Swipes and Regenerate** follow your Settings → Swipes choices (Re-narrate or Re-run, Ask, the one-shot chip), and the thinking block says which one ran. Regenerate in the input area, which deletes the reply first, plays as a Re-run; on a chat on depth it redoes the deleted reply as your swipe setting says, where the new reply answers the same message, unchanged (DEPTH.md).

A failure reads in the chat as the provider's error, in words:

- "LumiRPEngine couldn't match this reply to its turn: …"
- "The loopback lost its connection to Lumiverse …"
- "LumiRPEngine was stopped on Lumiverse …": at once, when Lumiverse restarts, updates or turns it off.
- "LumiRPEngine stopped with an error …, Lumiverse doesn't restart it by itself": within 10 seconds of a crash. Restart it in the Extensions tab.
- "LumiRPEngine restarted during this reply, so it stopped here …": within about 15 seconds.
- "LumiRPEngine stopped answering the loopback during this reply …": after two minutes of silence.

Press **Retry** or swipe.

## Docker

Lumiverse's official compose runs it in a container, where `127.0.0.1` is the container's own and there is no systemd. Two ways, and `loopback up` prints the snippet when it sees it is in a container:

- **Inside Lumiverse's container, as a second process**: run `bun …/lumirpengine.js loopback up --url …` there, without `--systemd`.
- **As a compose service that shares Lumiverse's network**, so `127.0.0.1` is the same for both. Run `loopback up` once inside the container first, so its config exists, then add:

```yaml
lumirpengine-loopback:
  image: <Lumiverse's image>
  network_mode: "service:lumiverse"
  volumes: [<Lumiverse's data volume, mounted where it is in Lumiverse's service>]
  command: ["<bun>", "<…/lumirpengine.js>", "loopback", "serve", "--config", "<the config path>"]
  restart: always
```

## A server with several users

By default each user runs the line with their own sign-in, and so their own relay, port and key. A relay carries only its own account's turns. Every user's relays are kept in one registry, so it is bounded: at most 8 relays per account, and each relay's name, build, address and report are checked and kept short. A relay whose report LumiRPEngine can't read keeps its last good one.

One relay for everyone is the operator's explicit choice: **Allow a shared relay** on Settings → Loopback (operator only), then `loopback up --shared` under the operator's account. Know what that means before you switch it on:
- The shared relay's account sees, and can drive, every user's turns, story and thinking.
- Every user's key passes through it.
- Every user's untagged requests (summaries and the like) pass through it too. LumiRPEngine itself holds each user to 20 a minute, each at most just under 4 MiB, and logs each one by user, whatever the relay is set to. The relay's own `passthroughPerMinute` can only lower that limit.

Each user who turns the local-inference scheduler on must add the relay's two origins to their own Excluded origins: the relay can do that only for its own account.

On a hosted Lumiverse where you can't run a process on the server, there is no relay, and so no depth yet. Message sessions, once Lumiverse can complete a reply written passage by passage, are the planned route for that case.

## Command reference

```
loopback up [--url <base>] [--port <n>] [--listen <host>] [--name <name>] [--shared] [--systemd] [--account <user>] [--bun <path>] [--after <unit>] [--username <name>] [--allow-http]
loopback serve --config <file>          (what the service runs; also --name)
loopback login | status | down [--name <name>]   (login and status also take --config)
```

The config may hold `"tuning"` overrides, in milliseconds unless named:
- `commentMs` (5000): keep-alive comments after this much silence.
- `progressMs` (60000): the progress line restated.
- `stallMs` (1800000): a call with nothing from LumiRPEngine this long is given up.
- `lostMs` (120000): how long LumiRPEngine may stay out of reach under a call.
- `probeMs` (15000): how often the relay asks after its calls while it has any.
- `silentMs` (45000): how long a question may go unanswered before LumiRPEngine counts as silent.
- `crashMs` (10000): after Lumiverse reports an error in LumiRPEngine, how long silence makes it a crash.
- `resendMs` (3000)
- `maxBodyBytes`: just under 4 MiB, Lumiverse's socket frame limit.
- `passthroughPerMinute` (20, shared mode): LumiRPEngine holds each user to 20 anyway, so this can only lower it.

**What it answers.** Only requests addressed to it, so no DNS rebinding: the `Host` must name its own address and port. On a loopback address that can be any of `127.0.0.1`, `localhost` and `[::1]`; on another address (`--listen 192.168.1.20`, say), that address itself. A relay on a wildcard address (`--listen 0.0.0.0` or `::`) is reached by whatever names its machine has, so it checks no `Host`. There only the loopback key every call needs, and the `Origin` refusal, stand in the way. It never answers a browser: a request with an `Origin` header is refused. `GET /healthz` says, without a key, whether its link to LumiRPEngine is `up`, or why not: `down`, `silent`, `stopped`, `crashed` or `refused`.

## Troubleshooting

- **GM → This chat → Depth won't turn on**: it says what is missing (a relay running, a key, a loopback connection), with a button to Settings → Loopback.
- **A reply waits and never starts**: the relay's address is missing from the local-inference scheduler's exclusions. Press **Fix** on its row and wait 5 seconds.
- **The connection's Test lists no `lre-narrator`**: the key is wrong or rotated. Mint or rotate, and set the new key on the connection.
- **"Sign-in needed"**: run the `loopback login` line the page shows.
- **The relay stopped at logout**: it is a user unit without lingering. Run `sudo loginctl enable-linger <account>`.
- **"Refusing to run as root"**: the line was run with plain `sudo`, or from a directory another account can change. Run the lines it prints instead (`sudo loginctl enable-linger <account>`, then the line with `sudo -u <account>`), or, where only the directory stood in the way, the line with `--cwd /` after Bun.
- **"Refusing to run as <you>"**: the line was pasted without its `sudo -u`, from a login other than Lumiverse's account. Run the line it prints, with `sudo -u <account>`.
- **"… its group, <group>, can change it"**: a directory of the account's own (or root's) is group-writable, and another account is in its group. Lumiverse makes its directories group-writable under a umask of `0002`, which is fine while no account but its own is in that group (its members, and every account whose primary group it is, as `getent` lists them). Run the `chmod g-w <path>` lines it prints, then the line again. Where there is no `getent` (macOS), who is in a group can't be known, so any group-writable directory is refused this way.
- **A system service set up before this release** runs Lumiverse's own Bun and has no root-owned copy of it, so its **Sign-in needed** line can't find `/var/lib/lumirpengine/bun`. Remove it, then set the relay up again with the start line: `sudo systemctl disable --now lumirpengine-loopback-<name>.service && sudo rm /etc/systemd/system/lumirpengine-loopback-<name>.service /etc/lumirpengine/loopback-<name>.json`.
- **It answers 503 with how to register again**: its registration is gone (you pressed Forget, say). Run the start line again.
- **"You have 8 relays registered already"**: **Forget** the ones you no longer run on Settings → Loopback.
