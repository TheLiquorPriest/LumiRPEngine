# Moving from the previous build

This page is for you if you play chats on the previous build of this extension: the one with the classic pipeline, the agents engine or the harness engine, and its runtime (`lumiah`). It moves everything into RPE without changing anything of yours, and you can go back.

## How it goes

1. **Before you start.** You sign RPE in to Lumiverse, which gives you your Lumiverse user's id, and you check where the previous build's runtime keeps its folders.
2. **The rehearsal.** It reads everything and writes nothing. You read its report.
3. **The real run.** It copies everything into RPE's own data folder. The previous build goes on playing your chats the whole time.
4. **The switch.** You switch the installed extension to the new build in Lumiverse, and run `rpe up`. It carries what changed since the real run, and RPE takes the previous runtime's place.
5. **Going back**, should you want to: `rpe down` and the steps it prints.

Steps 1 to 3 change nothing of Lumiverse's but the sign-in session that `rpe lumiverse` makes, and nothing of the previous build's. If you do not like what you see after them, delete RPE's data folder, and that is all.

Below, `rpe` stands for `bun <the folder of the new build>/dist/rpe.js`, and every line RPE prints for you to run begins that way.

## What does not change

- **Your data.** The migration opens Lumiverse's database, the extension's storage and the previous runtime's folders read-only. Even the previous build's own code, which the migration runs to read your chats, writes nothing: any write it tries is kept in memory and reported.
- **Your connection in Lumiverse.** At the switch, RPE answers where the previous runtime answered, under the same model name and with the same key. The connection in Lumiverse, and every chat that uses it, go on working with nothing changed in Lumiverse. Every connection that reached the previous runtime becomes RPE's the same way.
- **Your chats.** RPE writes nothing into them. A chat plays on RPE when its connection in Lumiverse is one of RPE's. A chat that was on the previous build and is on none of RPE's connections stays where it is: the switch names each such chat at its end, and you choose one of RPE's connections for it in Lumiverse.
- **What the previous build put in Lumiverse.** Its engine book, its regex scripts and its preset blocks are left as they are, so that going back stays possible. The report counts them.

## Before you start

- **A copy of the new build**, in any folder. It does not need to be installed. For example: `git clone --branch standalone https://github.com/TheLiquorPriest/LumiRPEngine rpe-copy`. The built files are in the repository, so there is nothing to install or build.
- Run every command as the account that runs Lumiverse and the previous runtime, on the same machine.
- **Lumiverse's data folder**: the folder that holds `lumiverse.db`. Lumiverse keeps the installed extension in `<that folder>/extensions/lumi_rp_engine/repo`.
- **Your Lumiverse user's id.** Type:

  ```sh
  rpe lumiverse --url <Lumiverse's address> --user <your username>
  ```

  It asks for your Lumiverse password (typed and not shown, and not kept; with no terminal, as from a script, it reads the first line piped into it), signs RPE in, and prints:

  ```
  Signed in to Lumiverse at <address> as <username>. This RPE belongs to that Lumiverse user (<id>).
  ```

  The id is in the brackets: it is the `<your user id>` below. If Lumiverse refuses the password, the command says so and writes nothing. One RPE serves one Lumiverse user, so sign in as the user whose chats you are moving. This step also makes RPE's data folder and its `config.json`.
- **Where the previous runtime keeps its folders.** Type `rpe status`. One of its lines reads: `Previous build's runtime, read by rpe up and rpe migrate: config <folder> (there), data <folder> (there)`. They are `~/.config/lumiah` and `~/.local/share/lumiah` unless `XDG_CONFIG_HOME` and `XDG_DATA_HOME` say otherwise. Where either says "not there", find the folders the runtime really uses and add `--runtime-config <folder> --runtime-data <folder>` to every `rpe migrate` and `rpe up` line below.
- **Disk.** The rehearsal's report says how much the real run will take: about as much again as your data. Each real run, and each switch, takes a backup of its own (see below).

RPE's data folder is `$RPE_DATA` where that is set, else `rpe` under `$XDG_DATA_HOME` where that is set, else `~/.local/share/rpe`; or give `--data <folder>`. Use the same one for every step, the switch included.

## 1. The rehearsal

```sh
rpe migrate --rehearse --lumiverse <Lumiverse's data folder> --user <your user id>
```

It reads all of the previous build's data: your chats and their records in Lumiverse's database (only your user's rows), the extension's storage, and the previous runtime's own folders. It writes nothing, not even to RPE's data folder. It prints the report (see [The report](#the-report)), which opens like this:

```
Migration rehearsal, read at <time>.
...
The real run may start.
```

If it says `The real run won't start:` instead, the lines under it say why. Nothing was changed. What to do for each:

| It says | What to do |
|---|---|
| `Lumiverse's database has no such user.` | The id or the data folder is wrong. Take the id from `rpe lumiverse` and the folder that holds `lumiverse.db`. |
| `This RPE belongs to the Lumiverse user …, and this run is for …` (or `An earlier run carried the data of the Lumiverse user …`) | One RPE serves one Lumiverse user. Give the id `rpe lumiverse` printed, or use another data folder (`--data`) for the other user. |
| `The runtime's folders are not where this run looks: neither … nor … is there.` | Say where they are with `--runtime-config <folder>` and `--runtime-data <folder>`, or say the server runs no runtime of the previous build with `--no-runtime`. |
| A line saying it cannot tell which runtime is yours | The server runs several. Name yours with `--runtime <name>`, or tell the run about a folder no config names with `--mine <folder>` (yours) or `--theirs <folder>` (not yours). |
| `N found, not classified: …` | A file the migration does not know. Give it a row, below. |
| `Row "…": N found, but …` | A kind of thing the run cannot place. Nothing is changed. Keep the report and say which row it was. |
| `The real run needs N bytes where it writes, and M are free.` | Free the disk where RPE's data folder is, or put the folder elsewhere with `--data`. |

**Giving a file a row.** The report lists each file no row names, by its path. Say what becomes of it in the global settings file, `files/RPE-global.yml` in RPE's data folder (make the file and its folder if they are not there: the rehearsal only reads it):

```yaml
migration:
  rows:
    - path: stray-notes.txt        # the file as the report names it
      fate: archived               # or: attached
      line: My notes on the old harbour map
    - path: old-exports/           # a path ending in / is every file under that folder
      fate: archived
      line: Exports from before the move
```

Run the rehearsal again: it reads the file each time. A file with a row is counted under a row of its own, with your line, kept in the backup, and listed in the report as yours. Nothing is carried that nothing reads, so `archived` and `attached` are the only fates you can give.

If the previous runtime is not where it looks by default, say where it is with `--runtime-config <folder>` and `--runtime-data <folder>`. If the server runs several runtimes, the migration takes the one you registered with this Lumiverse and leaves the others alone. If it cannot tell which, it says so: name yours with `--runtime <name>` (it must be one registered with this Lumiverse where your storage keeps a register; where it keeps none, the runtime's config must name this Lumiverse's address, as far as your storage shows it), or say there is none with `--no-runtime`. A runtime folder that no config names is read for whose working copy it holds: yours are archived in the backup, another user's are left alone by name, and where that cannot be told, the report says so and you say it with `--mine <folder>` or `--theirs <folder>`. `--identifier <id>` names the extension, where Lumiverse knows it by another id than `lumi_rp_engine`. `--json` prints the report as JSON. `rpe migrate` with nothing else lists every flag.

## 2. The real run

```sh
rpe migrate --lumiverse <Lumiverse's data folder> --user <your user id>
```

It does what the rehearsal does, and this time writes, but only into RPE's data folder:

- First it takes a backup: the extension's storage, the previous runtime's files and its installed copy, and the list of chats with engine records. Its path and checksum are in the report.
- Then it carries your worlds, chats, connections, settings and your own files into RPE.
- Each chat's history becomes RPE's turns, one for every reply and every swipe, so history, swipes and rewinds work on a migrated chat as on a new one. A reply the previous build left unplayed (its generation was stopped, failed, or the engine restarted while it was written) has no turn: it stands on the chat's path as an unplayed stretch with that reason, which the chat's agents are told at its first turn on RPE. Each chat's own record in RPE holds its seed, when it started, whether the previous build's engine was switched on for it and which engine played it.
- **The check.** For every chat, RPE works out the world's state from what it carried and compares it with what the previous build gives, value for value, at the latest reply and at every swipe. A chat where anything differs is marked. RPE stores the previous build's state at that point as the start there, whichever swipe or path it is (the latest reply of a chat whose head stands rebased included), so that nothing is lost, and the report lists the differences.

It prints the same report as the rehearsal, with the lines of what it did added: the check of each chat reads `matched at the head yes, at N of N swipes`, and a line `Backup taken: <path> (<bytes> bytes, sha256 …)` follows. The report includes the steps of the switch and of going back. The exit code is 0 when it is done and 1 when it was refused or stopped.

The previous build is still installed and still plays your chats. Read the report at your leisure.

**When it says no.** A real run first does the rehearsal's check, so every refusal in the table above holds here too, and nothing is written. Two more:

- `RPE is running at <address>, the address this data folder's config gives it: stop it (…), then run … again.` A running RPE would write its own copy over what the run carried. Stop it with the line it gives (`rpe serve` stopped, or its service stopped), run the migration, and start it again after.
- `The migration stopped: while <step>: …` The run failed part-way. Today's data is as it was and the backup it took is kept. Run it again: it finishes what the first run left, with nothing duplicated.

### The backups

Every real run takes a backup of its own, and so does every switch (`rpe up`), which runs the migration again. Each is one archive in `backups/` in RPE's data folder, named `rpe-migration-backup-<the time it was made>.tar`, readable only by your account. Each is about the size of your data in the previous build. Nothing removes them, so they add up. An older one may be deleted once a newer one exists; keep the newest.

The same folder also holds `rpe-before-<build>-<time>.db`: a copy of RPE's database, taken when a new build of RPE first changes its tables. These stay until you delete them too.

## The report

The rehearsal and the real run print the same report. It holds counts and checksums, never your content.

- **One line for each kind of thing the previous build kept:** found = carried + attached + archived + kept in the backup only. *Carried* went into RPE. *Attached* is kept beside the turn it belongs to. *Archived* is kept in the backup for good, because nothing in RPE uses it.
- **Found must equal the sum, and nothing may be "found, not classified".** If either fails, the real run refuses before it changes anything, and the report says which files it could not place (see "Giving a file a row" above).
- **Where the previous build keeps two copies of one thing** (the acceptance connections, in the runs' own file and in the settings; a world's lore entry that copies a book entry's text), the migration reads the copy the previous build treats as the authority and counts the other as attached.
- **What the previous build put in Lumiverse** is listed whole: its books, entries and regex scripts, its preset blocks and outlet references, the messages the panels put in your chats, the chats pinned to its connection and model, and its address among your scheduler's exclusions. None of it is changed.
- **For every chat:** the turns found and imported, whether its state matched at the latest reply and at every swipe, the replies edited since the previous build read them (RPE's agents are told of each, as a reply edited after its turn, at the first turn that finds it showing), and anything waiting on you, such as a chat paused on a question. Each chat is opened first as the previous build opens one: a reply you edited that it never saw pauses the chat on a keep-or-discard question, as it would have, and a GM edit or ✎ fix it was holding for a reply that was under way lands on its turn, as it does when the previous build starts again. The report counts those that landed and those it refused, and lists any that still wait for a reply that is under way; no fold applies those.
- **What the old engines recorded on each reply** is kept word for word beside the turn it became, read-only: each session, summary, transcript, segment and job report its record names, and why a reply stood with no turn played and where it said something against its turn. The Turn page shows it under "What the old engine recorded". `GET /api/v1/chats/<chat>/carried` lists a migrated chat's carried turns, a page at a time (`migration.page`, at most `migration.maxPage`), and `GET /api/v1/chats/<chat>/turns/<turn>/carried` gives one whole, with the engine that played the chat.
- **What could not be read**, by path: a damaged file the previous build had already set aside, say.
- **Settings:** every setting of the previous build is carried, archived or named, none left out. Those carried go into RPE's settings, from what to what, a time in milliseconds as seconds: the engine's Settings page where RPE has a setting of the same meaning (the narrator's knowledge and secrets, the knowledge threshold, which World Info books are lore, the lore index's entry), the caps of LumiAH's settings (a turn's tokens, time and depth, a job's budgets, a day's tokens and how a cached token is weighed) into the settings that hold them in RPE, and the runtime's memory limit (`service.memory`) and tuning (the update's waits, the progress line's silence, the live stream's keep-alive, and the like) into theirs. A value is checked as RPE's own setting takes it. A tuning value that is just the previous runtime's own default is no choice of yours: it is named and not carried, so RPE's own default holds. Those RPE has a like setting for that counts otherwise or takes no such value are not carried, each with why. Those that steered only an old engine (its pipeline, its loop, its link to Lumiverse) are archived in the backup and listed with why. Those with no setting of the same meaning in RPE are listed by name. Each chat's own choices (its knowledge switch, its narrator's view, what counts as its story, its tidy-up switch and leave-alone list, and its map display) go into the chat's own `RPE.yml`, where they stand over yours; a chat with none follows its world and you, as it did. And those that name a connection in Lumiverse are listed, which RPE cannot use: pick one of RPE's connections for each; until you do, that work uses RPE's default connection.
- **Your own files:** your agents, skills and texts are carried into RPE's file tree under `imported/`, switched off, because they were written for agents that have changed. A `GUIDANCE.md` of yours is carried there too, and the report says so under "Waiting on you". Notes are carried as notes: each chat's notebook, scene, learned files and the agents engine's workspace into that chat's own `persistent-workspace/`, with every change a turn made recorded on that turn in RPE's own history of notes, so showing an earlier reply again puts its notes back; your `~/` files and the agents engine's global workspace into the global `persistent-workspace/`, which every chat's agents read and none writes. A file you made or changed in RPE since an earlier run is never written over. Each file pinned in the previous build is a pin in `stack.pins` of the chat's `RPE.yml` (or of `RPE-global.yml`), for the agent that is handed it at the start of each run: its lead agent's pins are the Author's, a pin for a role RPE has no agent for is pinned for the Author and listed, and a pin for one of your own agents stays under that agent's name, which is carried switched off.
- **What was left in Lumiverse as it is**, and the disk the run takes.
- **The backup's path and checksum.**
- **The steps of the switch and of going back**, below the chats.

### "Kept in the backup only"

A kind of thing this build has no place for is counted, kept in the backup, and not carried. It is not lost: it stays in the backup, and in the previous build's own storage, which nothing changes. The report lists it last, by name, so that nobody reads a run as complete. There are two: the GM assistant threads, which belong to Talk, the assistant chat, which comes with a later build; and any file you gave a row in `migration.rows`, which is kept with your line. Build's jobs, lore ids and secrecy undo copies, what you asked for through a panel, review cards, stored chips, staged changes, approvals and jobs are all carried.

## Running it again

You can run the migration again at any time, the rehearsal or the real run. For a chat you have not played on RPE yet, a new run replaces what an earlier run carried with what the previous build holds now; what you did there in RPE since (an edit of your own, a job you started) is kept and tied to the same replies, and one whose reply is gone is named. Once you play a chat on RPE, that chat is RPE's: a later run leaves it alone, and says so ("played on RPE: left alone"). The same goes for what you changed in RPE since a run carried it: a connection, the default connection, a carried setting or a world you edited in Build is kept as RPE has it, and the report says so.

## 3. The switch

Do this only when you are happy with the report. The switch refuses to start until a real run has been made in this data folder and its report passed.

1. **In Lumiverse, switch the installed extension to the `standalone` branch.** Open **Extensions**, find the card of LumiRPEngine, tap **Branch** (its tooltip reads "Switch branch") and choose `standalone`. Lumiverse fetches the branch, checks it out and runs the new build as it comes, built, with nothing to install. **Do not remove the extension to install it again: removing an extension deletes its storage.**
2. **Approve the new build's permissions.** It asks for five ([why each one](install.md#the-extension-and-its-five-permissions)). The previous build asked for all five too, so Lumiverse keeps them granted, and withdraws the twelve the previous build had and the new one does not ask for. If one of the five is not granted, `rpe up` names it and stops before it stops anything: an admin grants it on the extension's card, and you run `rpe up` again.
3. **Let any reply being written finish.** The switch waits for the previous runtime to be idle before it stops it.
4. **Run the switch,** with the copy the extension now holds:

   ```sh
   bun <Lumiverse's data folder>/extensions/lumi_rp_engine/repo/dist/rpe.js up --url <Lumiverse's address> --user <your username>
   ```

   It asks for your Lumiverse password unless the sign-in `rpe lumiverse` kept still stands. Do not interrupt it once it says `do not interrupt the swap`; if it is interrupted all the same (Ctrl-C, a closed terminal, a kill), it says so, ends the step under way, and puts back what it did.

Run from the extension's own folder, `rpe up` knows Lumiverse's data folder, and looks there for the previous build's runtime of yours. Where it finds one, it is the switch. Where it finds none, it is the install, whatever the extension runs. Run from a copy elsewhere, it asks where Lumiverse's data folder is (`--lumiverse <folder>` says it and asks for the switch). `--runtime`, `--no-runtime`, `--runtime-config`, `--runtime-data` and `--identifier` say where the previous build's runtime is, where it is not where that build puts it; use the same ones you gave `rpe migrate`.

`rpe up` does this for the switch, in this order:

- It refuses, before it stops anything, while Lumiverse still has the previous build of the extension installed (it says so, and prints the steps above again), while the extension is not installed at all, while one of the five permissions is not granted, or while the extension's `dist/backend.js` is another build than the `rpe.js` you ran. Switch the branch first, and run the `rpe.js` in the extension's own folder. A copy run from its sources is refused too: it has no build of its own to compare.
- It refuses another Lumiverse user than the one whose data was carried, and an RPE running outside its service (stop `rpe serve` first).
- It checks that the migration would run, then waits until the previous runtime is idle (it says `Today's runtime <name> … waiting up to N seconds (its own "Wait before restart" setting) for it to be idle`), and stops its service. The previous runtime can take a minute and a half to stop: systemd waits for it to end, and then ends it. That is how the previous build stops, and is no fault.
- It takes a fresh backup and migrates again from the start, for every chat not yet played on RPE. So everything that changed since the real run is carried too: a turn you played, a world you edited, a correction.
- It starts RPE as a service of your account (`rpe-<name>.service`), at the previous runtime's address, under its model name (`lumiah-lumi_rp_engine`) where Lumiverse still holds the previous build's connection, and with its key, and waits until RPE answers and the extension registers with it. Every connection in Lumiverse that reached the previous runtime is kept as it is and becomes RPE's own: RPE answers on each, under the model name it names, and says so. Where Lumiverse holds none, it makes RPE a connection of its own there instead, and asks you to choose it for your chats.
- Only then does it switch the previous runtime's service off. It does not remove its unit, which going back uses.
- If anything fails along the way, it puts everything back as it was, and the previous runtime runs again.

What you will see, in this order: the migration's report; `Started rpe-<name>.service, RPE's service: RPE answers at <address>, where today's runtime <name> did, under its model name (…) and with its key.`; `Stopped and switched off <the previous runtime's unit>, today's service.`; a list of the chats that were on the previous build and are on none of RPE's connections, each with the one step that puts it on RPE; the web app's token, printed once (keep it: see [the web app](install.md#the-web-app-and-its-key)); and `What is left for you to do:`, a numbered list. Then play a turn in one of your chats: RPE plays it. The switch takes a minute or two, most of it the migration and the previous runtime's stop.

**When it says no.** Every stop before the previous runtime is stopped changes nothing of it, and every stop after the extension was switched prints, under the reason, the steps to go back to the previous build now. The common ones:

| It says | What to do |
|---|---|
| `Lumiverse still has today's build of the extension (…) installed` | Do step 1 and step 2, then run it again. |
| `Lumiverse has no extension (lumi_rp_engine) installed: it was removed` | Removing an extension deletes its storage, so the switch does not run over storage that is gone (the real run's backup holds a copy). Install the new build's extension in Lumiverse from the `standalone` branch, approve its five permissions, then run it again. |
| `Lumiverse has not granted the extension (…) …` | Grant the permissions it names on the extension's card, then run it again. |
| `The extension Lumiverse has installed (…) is another build than this rpe (…)` | The extension's `dist/backend.js` is not this build. Switch the branch, or put the new build's files in the extension's folder and switch the extension off and on in Lumiverse, then run it again. |
| `No real run of your own data has been made in this data folder` (or `The last real run … did not pass its report`) | Run `rpe migrate` and read its report, then run `rpe up` again. |
| `Today's runtime … still … after N seconds, and the swap stops nothing while it is busy.` | A reply or job is still under way in the previous build. Run `rpe up` again once it is idle. |
| `RPE is running at <address>, outside a service` | Stop `rpe serve`, then run it again. |
| `The swap did not go through: …` followed by `Put back as it was: …` | The switch put back what it did, and the previous runtime runs again. The reason is in the line. If it is `RPE did not answer at <address> within N seconds of its service starting`, RPE's log says why (`journalctl --user -u rpe-<name>.service`), and the setting `commandLine.startMs` gives a slower start more time. |
| `Could not be put back, do it by hand: …` | The line names the step. Do it, then run `rpe status`. |

A chat that played on the classic pipeline or the agents engine is played by the Author from then on. Its next turn is told it is a migrated chat, and what was carried.

### Running `rpe up` again

While the switch stands (RPE's service runs and answers in the previous runtime's place, and the previous runtime's service is off), a second `rpe up` stops nothing, changes nothing and does not run the migration again. It says what stands, and prints the line that carries what changed on the previous build's side since the last run: stop RPE's service, run `rpe migrate` with the same folders, and start the service again.

Where the switch does not stand, because RPE's service is stopped or the previous runtime's service is on again after going back, `rpe up` makes the whole switch again, as above. A chat already played on RPE is left as it is, every other chat is carried again.

### A carried connection has no limits of its own

The model connections of the previous runtime are carried into RPE, and the migration gives them no limits of their own. Where pi's list of models, or the provider's own server, gives a carried connection's model its limits, RPE uses those. Where neither does, the **Connections** page shows "Context window: not known · Longest reply: not known". Then RPE sends the model no cap on a reply, and cannot tell when a session nears the model's window: it summarizes a session's earlier turns only once the provider refuses a call as too long.

After the switch, `rpe up` names each carried connection that has no limits among what is left for you to do. Open the Connections page and look at each carried connection. For one with a limit "not known", choose **Test it**: it shows the model that answered and the limits the provider's list gives for it. Where the provider answered as another model than the connection names, **Take these limits** fills them into the connection's form. Or type them into the form's **Context window** and **Longest reply** yourself. Nothing is written until you save.

### After the switch

- **What waits on you** is on the **Migration** page, under "Waiting on you", each with its press: your `GUIDANCE.md`, agents and skills, carried switched off (**Switch it on**); a chat paused on a keep-or-discard question (**Keep** or **Discard**: the answer is kept in RPE and never written to the previous build's data, so going back finds the chat paused as it was); staged changes held for your next message; settings that name a connection in Lumiverse (pick one of RPE's); and the mind files carried word for word and not yet filed (**Start filing it**). The page can also start a rehearsal, read each run's report a page at a time and save it as a file.
- **The chats' bootstrap.** To have RPE's agents go over a carried chat's past and fill in its records (its lore index, cast and story record), start a bootstrap job: for one chat on its **Story** page, or for every chat the migration carried on the **Migration** page. Nothing starts one by itself. The job runs under the [job settings](settings.md#jobs) (none of which cuts it short by default) and its own run settings (`bootstrap.run.calls`, `bootstrap.run.seconds`, which have no value of their own, so the job settings hold); at `bootstrap.askAtTokens` (or your own limit for the job) it stops and asks you whether to go on, and ends with what it has recorded if you say so.
- **The pages.** The chats are on the **Chats** page of the web app (a migrated chat reads "Imported, not played on RPE yet" until you play it on RPE). Each chat's pages (Live, Turns, World, Cast, Story, Lore, Play and the rest) are described in [Install and run](install.md#the-pages). The previous build's play panels and HUD are RPE's **Play** page and the HUD in the chat; its world builder is **Build**.
- **What is not in this build.** The `lumirpengine` command line and MCP server for outside harnesses, and Talk, the GM assistant chat, are not in this build and come with a later one. Until then `lumirpengine` answers that the command returns with a later build, and the GM assistant threads you had stay in the backup (see "Kept in the backup only").
- Updates are ordinary updates of the extension in Lumiverse. See [Updating](install.md#updating).

## 4. Going back

Going back takes four steps, which `rpe down` prints with your own names filled in:

1. **`rpe down`.** It stops and removes RPE's service, takes RPE's mark off each connection the switch took, and leaves RPE's data where it is.
2. **In Lumiverse, switch the installed extension back to the branch the previous build is kept on, `before-standalone`** (the setting `migration.previousBranch` names it, and `rpe down` and the Migration page print it): on the extension's card, **Branch**, then `before-standalone`. Switching keeps its storage. Do not remove the extension and install it again: removing an extension deletes its storage. (The backup holds a copy, should that ever happen.)
3. **In Lumiverse, approve the permissions the previous build asks for again, then switch the extension off and on again**, so that it starts with them. It asks again for the twelve the new build did not: eight wait for an admin's approval (`context_handler`, `chats`, `world_books`, `presets`, `regex_scripts`, `mcp_servers`, `databanks`, `web_search`) and four come back by themselves. `rpe down` lists all seventeen the previous build asks for, by name.
4. **Run the previous build's own install line**, the one you use when you update it: `bun <its folder>/dist/lumiah.js up --name <name> --systemd`. It reads its address from its own config, keeps its registration, and takes up its service again (the switch only switched its unit off), with the memory cap it had.

If you moved chats to a connection of RPE's own, `rpe down` prints a fifth step: give those chats the connection they had before. It names each chat moved since the switch, and any of RPE's own connections nothing answers on any more.

RPE makes no provider key after the switch, so the connection RPE took over keeps the key it had, and going back needs nothing changed in it.

After going back, the previous build behaves as it did at the switch. What you played on RPE since stays in RPE's data and does not flow back. If you switch again later, RPE still has those chats as you left them: a chat you played on RPE is left alone, every other chat is carried again.

Before the switch there is nothing to go back from: to undo steps 1 to 3, delete RPE's data folder.

**When you will not go back.** The Migration page has **I will not go back…**. Once you say it, the page lists the books the previous build made in Lumiverse for your worlds, and offers to remove each, one book per press. Until you say it, nothing there touches Lumiverse. A book you remove is gone, and the previous build would play without it. The regex scripts are never offered.
