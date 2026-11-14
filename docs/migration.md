# Moving from the previous build

This page is for you if you play chats on the previous build of this extension: the one with the classic pipeline, the agents engine or the harness engine, and its runtime (`lumiah`). It moves everything into RPE without changing anything of yours, and you can go back.

## How it goes

1. **The rehearsal.** It reads everything and writes nothing. You read its report.
2. **The real run.** It copies everything into RPE's own data folder. The previous build goes on playing your chats the whole time.
3. **The switch.** You switch the installed extension to the new build, and run `rpe up` with `--lumiverse`. It carries what changed since the real run, and RPE takes the previous runtime's place.
4. **Going back**, should you want to: `rpe down` and the steps it prints.

Steps 1 and 2 change nothing in Lumiverse and nothing of the previous build's. If you do not like what you see after them, delete RPE's data folder, and that is all.

## What does not change

- **Your data.** The migration opens Lumiverse's database, the extension's storage and the previous runtime's folders read-only. Even the previous build's own code, which the migration runs to read your chats, writes nothing: any write it tries is kept in memory and reported.
- **Your connection in Lumiverse.** At the switch, RPE answers where the previous runtime answered, under the same model name and with the same key. The connection in Lumiverse, and every chat that uses it, go on working with nothing changed in Lumiverse.
- **What the previous build put in Lumiverse.** Its engine book, its regex scripts and its preset blocks are left as they are, so that going back stays possible. The report counts them.

## Before you start

- A copy of the new build, in any folder. It does not need to be installed. For example: `git clone --branch standalone https://github.com/TheLiquorPriest/LumiRPEngine rpe-copy`. Below, `rpe` stands for `bun <that folder>/dist/rpe.js`.
- Run the commands as the account that runs Lumiverse and the previous runtime, on the same machine.
- **Lumiverse's data folder**: the folder that holds `lumiverse.db`.
- **Your Lumiverse user's id.** `rpe lumiverse --url <Lumiverse's address> --user <your username>` signs RPE in and prints it: "This RPE belongs to that Lumiverse user (…)". The id is in the brackets.
- **Disk.** The rehearsal says how much the real run will take: about as much again as your data.

RPE's data folder is `~/.local/share/rpe` unless you set `$RPE_DATA` or give `--data <folder>`. Use the same one for every step, the switch included.

## 1. The rehearsal

```sh
rpe migrate --rehearse --lumiverse <Lumiverse's data folder> --user <your user id>
```

It reads all of the previous build's data: your chats and their records in Lumiverse's database (only your user's rows), the extension's storage, and the previous runtime's own folders. It writes nothing, not even to RPE's data folder. It prints the report.

If the previous runtime is not where it looks by default, say where it is with `--runtime-config <folder>` and `--runtime-data <folder>`. If the server runs several runtimes, the migration takes the one you registered with this Lumiverse and leaves the others alone. If it cannot tell which, it says so: name yours with `--runtime <name>`, or say there is none with `--no-runtime`. `--json` prints the report as JSON. `rpe migrate` with nothing else lists every flag.

## 2. The real run

```sh
rpe migrate --lumiverse <Lumiverse's data folder> --user <your user id>
```

It does what the rehearsal does, and this time writes, but only into RPE's data folder:

- First it takes a backup: the extension's storage, the previous runtime's files and its installed copy, and the list of chats with engine records. The backup goes into `backups/` in RPE's data folder, and stays until you delete it. Its path and checksum are in the report.
- Then it carries your worlds, chats, connections, settings and your own files into RPE.
- Each chat's history becomes RPE's turns, one for every reply and every swipe, so history, swipes and rewinds work on a migrated chat as on a new one.
- **The check.** For every chat, RPE works out the world's state from what it carried and compares it with what the previous build gives, value for value, at the latest reply and at every swipe. A chat where anything differs is marked. RPE stores the previous build's state at that point as the start there, so that nothing is lost, and the report lists the differences.

The previous build is still installed and still plays your chats. Read the report at your leisure.

## The report

The rehearsal and the real run print the same report. It holds counts and checksums, never your content.

- **One line for each kind of thing the previous build kept:** found = carried + attached + archived + kept in the backup only. *Carried* went into RPE. *Attached* is kept beside the turn it belongs to. *Archived* is kept in the backup for good, because nothing in RPE uses it.
- **Found must equal the sum, and nothing may be "found, not classified".** If either fails, the real run refuses before it changes anything, and the report says which files it could not place.
- **For every chat:** the turns found and imported, whether its state matched at the latest reply and at every swipe, and anything waiting on you, such as a chat paused on a question.
- **What could not be read**, by path: a damaged file the previous build had already set aside, say.
- **Settings:** those carried into RPE's settings, from what to what; those with no setting of the same meaning in RPE yet, kept in the backup; and those that name a connection in Lumiverse, which RPE cannot use. Pick one of RPE's connections for each of those; until you do, that work uses RPE's default connection.
- **Your own files:** your agents, skills, texts and notes are carried into RPE's file tree. A `GUIDANCE.md` of yours is carried under `imported/`, switched off, because it was written for agents that have changed. The report says so under "Waiting on you".
- **What was left in Lumiverse as it is**, and the disk the run takes.
- **The backup's path and checksum.**

### "Kept in the backup only"

Some kinds of thing have no place in RPE yet. The run counts them, keeps them in the backup, and does not carry them. They are not lost: they stay in the backup, and in the previous build's own storage, which nothing changes. A later run carries them once a build has a place for them. The report lists them last, by name, so that nobody reads a run as complete. In this build they are:

- which chats the engine was switched on for, and the engine each used;
- Build jobs and their proposals;
- approvals and jobs;
- the previous runtime's own settings (its tuning, memory limit and update choice);
- what you asked for through a panel;
- the agents engine's workspace;
- GM assistant threads;
- review cards, stored chips and staged changes;
- sessions, summaries and transcripts of the old engines.

## Running it again

You can run the migration again at any time, the rehearsal or the real run. For a chat you have not played on RPE yet, a new run replaces what an earlier run carried with what the previous build holds now. Once you play a chat on RPE, that chat is RPE's: a later run leaves it alone, and says so.

## 3. The switch

Do this only when you are happy with the report.

1. **In Lumiverse, switch the installed extension to the `standalone` branch.** Use the extension manager's "switch branch" on the extension (it fetches the branch and checks it out). **Do not remove the extension to install it again: removing an extension deletes its storage.**
2. **Approve the new build's permissions.** It asks for five ([why each one](install.md#the-extension-and-its-five-permissions)). Lumiverse withdraws the twelve the previous build had and the new one does not ask for.
3. **Run the switch,** with the copy the extension now holds:

   ```sh
   bun <Lumiverse's data folder>/extensions/lumi_rp_engine/repo/dist/rpe.js up --url <Lumiverse's address> --user <your username> --lumiverse <Lumiverse's data folder>
   ```

`rpe up --lumiverse` does this, in this order:

- It refuses, before it reads anything, while Lumiverse still has the previous build of the extension installed. Switch the branch first.
- It refuses another Lumiverse user than the one whose data was carried.
- It checks that the migration would run, then waits until the previous runtime is idle, and stops its service.
- It takes a fresh backup and migrates again from the start, for every chat not yet played on RPE. So everything that changed since the real run is carried too: a turn you played, a world you edited, a setting, a correction.
- It starts RPE as a service (`rpe-<name>.service`), at the previous runtime's address, under its model name (`lumiah-lumi_rp_engine`) and with its key, and waits until RPE answers.
- Only then does it switch the previous runtime's service off. It does not remove its unit, which going back uses.
- If anything fails along the way, it puts everything back as it was, and the previous runtime runs again.

It prints which connection in Lumiverse RPE answers on, the report (with a line on what changed since the real run), and what is left for you to do. Then play a turn in one of your chats: RPE plays it.

Running `rpe up --lumiverse` a second time changes nothing that is already right.

A chat that played on the classic pipeline or the agents engine is played by the Author from then on. Its next turn is told it is a migrated chat, and what was carried.

### After the switch

- The play panels and the HUD in the chat are not in this build.
- The `lumirpengine` command line and MCP server for outside harnesses do not work after the switch. They talk to the previous build's extension, which is no longer there.
- Updates are ordinary updates of the extension in Lumiverse. See [Updating](install.md#updating).

## 4. Going back

Going back takes four steps, which `rpe down` prints with your own names filled in:

1. **`rpe down`.** It stops and removes RPE's service, and leaves RPE's data where it is.
2. **In Lumiverse, switch the installed extension back to the branch the previous build is kept on.** Switching keeps its storage. Do not remove the extension and install it again: removing an extension deletes its storage. (The backup holds a copy, should that ever happen.)
3. **In Lumiverse's extension settings, approve the permissions the previous build asks for, then switch the extension off and on again**, so that it starts with them. `rpe down` lists all seventeen by name.
4. **Run the previous build's own install line**, the one you use when you update it: `bun <its folder>/dist/lumiah.js up --name <name> --systemd`. It reads its address from its own config, keeps its registration, and takes up its service again, with the memory cap it had.

If you moved chats to a connection of RPE's own, `rpe down` prints a fifth step: give those chats the connection they had before.

After going back, the previous build behaves as it did at the switch. What you played on RPE since stays in RPE's data and does not flow back. If you switch again later, RPE still has those chats as you left them.

Before the switch there is nothing to go back from: to undo steps 1 and 2, delete RPE's data folder.
