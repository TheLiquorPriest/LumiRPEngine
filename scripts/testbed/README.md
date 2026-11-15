# The migration's test instance

These scripts make the test instance the migration is proven on (STANDALONE-PLAN §15.1, §15.2, §15.5; §18.1 row 0.8): a Lumiverse of its own on a test bed, holding invented users and invented data only, in which today's pushed build (branch `main`) is installed and played until every store of §15.2 holds something. One command makes it from an empty Lumiverse with its owner, the same way each time; one command reads it back; one compares two runs; and `golden.sh` keeps the copy every formal use starts from. No script here opens, copies or changes any other Lumiverse on the machine.

Everything is done the way the owner would do it:

- Lumiverse's REST API, as each signed-in user: the connections, the second user, the extension's install and its permissions, the character cards, chats, messages, edits, swipes, deletions, the branch, the World Info book and its entries, and every generation (Send, Regenerate).
- The engine's own page requests (`lre.*`) and its harness pages' (`lah.*`), over Lumiverse's event socket. The scripts' socket is a page: Lumiverse names it as the frontend of the generations they start, so on the classic and agents engines the engine asks it to start each prepared reply, and it claims the turn (`lre.restart`) and starts it, as the page's `restart.ts` does.
- Today's `lumirpengine` command line and its MCP server, from the installed extension, each user signed in under the runtime home.
- Today's runtime, `lumiah up --systemd`, from the installed extension, for each user under a name of its own.

What today's build cannot make by play is planted, and the record and the read-back say so: the two cases in which today's own reader writes (a damaged file, a journal from another run of a chat), a `.tmp` of a write cut short, the depth engine's kinds (READINGS N-6), a line against a turn's decisions on a harness reply's record, and the one file no row names.

## Running it

On the test bed, as the account that runs Lumiverse, with Bun 1.4 or newer, in a copy of this folder. Every value comes from the environment; nothing about a machine is written in the scripts.

```sh
export LRE_HOST_URL=http://127.0.0.1:<port>        # the instance's Lumiverse, as a browser opens it
export LRE_DATA_DIR=<its data folder>              # the installed extension and both storage layouts are found under it
export LRE_CORE_DIR=<its checkout>                 # whose commit the run records
export LRE_INSTANCE_DIR=<a folder of your own>     # state.json, changes.jsonl, report.json, report.sha256
export LRE_RUNTIME_HOME=<a folder of your own>     # today's runtime and command line keep everything here (below)
export LRE_OWNER_USERNAME=<the owner the instance was set up with>    LRE_OWNER_PASSWORD=<…>
export LRE_OTHER_USERNAME=<an invented second user>                   LRE_OTHER_PASSWORD=<…>
export LRE_CONNECTION_NAME=<a name> LRE_CONNECTION_PROVIDER=<provider id> LRE_CONNECTION_MODEL=<model> LRE_PROVIDER_KEY=<…>
export LRE_BUILD_URL=<today's build's repository> LRE_BUILD_BRANCH=main
export LRE_RUNTIME_NAME=<name> LRE_RUNTIME_PORT=<port>                # the instance user's runtime
export LRE_OTHER_RUNTIME_NAME=<name> LRE_OTHER_RUNTIME_PORT=<port>    # the second user's runtime
export LRE_RUNTIME_MEMORY=1G                                         # today's --memory cap for each runtime unit
export BUN_INSTALL_CACHE_DIR=<…> BUN_RUNTIME_TRANSPILER_CACHE_PATH=<…>  # every unit made runs with these too

bun make-instance.ts             # from an empty Lumiverse with its owner to the read-back, every step in its fixed order
bun make-instance.ts <step> …    # only those steps (a run cut short is run again: every step finds what it made)
bun report.ts                    # the read-back alone; exits 1 on a world part that holds nothing or a row with nothing read back
bun compare.ts <a/report.json> <b/report.json>   # two runs from nothing, item by item, ids aside
```

Passwords and keys are read from the environment only, and no script writes or prints one. Every change is logged with its id in `$LRE_INSTANCE_DIR/changes.jsonl`, one JSON line each, and printed.

**The runtime home** is laid out as a home folder: today's runtime keeps its config in `<home>/.config/lumiah/` and its folders in `<home>/.local/share/lumiah/` (it reads them from `XDG_CONFIG_HOME` and `XDG_DATA_HOME`, which every command and every unit the scripts start is given), the instance user's command line keeps its sign-in in `<home>/.config/lumirpengine/credentials.json`, and the second user's in `<home>/other/.config/lumirpengine/` (the command line keeps one sign-in per Lumiverse address). `golden.sh` copies `<home>/.config/lumiah` and `<home>/.local/share/lumiah` by those names.

**Units.** `lumiah up --systemd` makes one systemd user unit per runtime, named by today's runtime from the name it is given; the set-up adds a drop-in to each with `OOMScoreAdjust=1000` and the environment above, beside today's own `--memory` cap. Give the runtimes names that mark them as the instance's.

## The order, and what each step makes

Setting up, as the owner, from an empty Lumiverse (`lib/instance/setup.ts`): the Lumiverse connection the classic and agents engines play on and one for a model choice RPE will not match; the second user; today's build installed from its repository and branch with every permission its manifest asks, enabled; the command line signed in for each user; a runtime for each user, each with its unit, port and drop-in; the instance user's runtime given its own connection and its settings changed from their defaults; a runtime folder no config names. The run records today's build's commit, Lumiverse's commit and both users' ids.

Then the second user's own (`lib/instance/other.ts`): a world, a card and a chat with that world and a staged tap, an outside harness's check-in, a setting. Nothing of it plays a turn.

Then the instance user's play, in this order:

| Step | What |
|---|---|
| `checkin` | An outside harness (`testbed-harness`) runs the engine's MCP server, lists its tools and calls `lre_status`: the engine keeps its check-in in `agents.json`. |
| `settings` | Model choices naming the Lumiverse connection (the agents engine's main agent, the GM assistant); location, regard and handed things set to ask first. |
| `own` | An agent (`tide_reader`) and a skill (`harbor_round`) of the user's own, an edited harness text (`main.system`), an edited engine text (`harness.guidance.name`), and `~/GUIDANCE.md`. |
| `book` | A World Info book with an entry holding two secret marks (both known only to Dale Whitcomb), the engine's own fields on that entry, and an entry with an earlier build's secrecy fields moved by Build's Secrecy page (its backup is in `secrecy/`). |
| `world` | A world from the modern starter with the `modern` ruleset profile and invented parts: a map in 100 m squares (a town block), lore of its own (one held only by Dale, one behind a gate, one known by), a lore index, pins and books, a club, a quest, a vehicle, money, a routine, needs, minds and the rest; committed. Then its lore index entry built into the book, and a Check world job. |
| `chats` | A character card and a chat on each engine: classic, agents, harness. |
| `classic` | Two turns, a second swipe of the first reply, a palette tap staged and taken by the next message, ✎ fixes, a GM edit, a confirm chip answered, a money move done at once off screen, a player-claims marker, the player's character told one of the book's two secrets, a GM assistant thread, and the first reply's swipe flipped back. |
| `agents` | A typed turn and a panel action played at once; a GM edit and its Undo; the last reply's text edited; the first message edited and Keep pressed; files in the agents engine's workspace, learned area and global workspace; the first reply deleted with turns after it; review cards, one change applied and one left waiting; a later message edited and Discard pressed (tombstones). |
| `revision` | A second world revision with the classic chat upgraded to it; then, after the classic chat's turns, the revision that fills the parts that change how the classic pipeline plays (the world's own section, the wording of a built-in one, a step template, an adopted entry, the caps), to which no chat is upgraded; then a draft left standing (a reply saved as lore). The read-back names which chats play which revision. |
| `pause` | A branch of the classic chat with a turn of its own, and the classic chat paused on keep-or-discard and left so, with a ✎ fix sent while it waits. |
| `leftovers` | A world chat with a staged tap, deleted in Lumiverse (its `runs/<chat>/` stays), and the one file no row names, `testbed-unclassified.txt`, at the top of the engine's per-user storage. From here on, the run checks after every step that the file is still there. |
| `harness` | The story prepared (cast, cores, notebook), turns with the jobs after them (the principals' own mind files), one review-card change applied and the rest left, a GM assistant thread in a side session, and a palette tap left staged. |

The steps that fill the rest of §15.2's stores by play run where `make-instance.ts` places them (`lib/instance/stores.ts`). Then what is planted, after all play (`lib/instance/planted.ts`): a damaged file today's reader then sets aside itself (`.corrupt-<ms>`) and a `.tmp`; item 4's two cases in a chat of their own that nothing opens after them; the depth engine's kinds; and a line against a turn's decisions on a harness reply's record. Last, the read-back.

All of it is invented; the world starts from the engine's own shipped starter.

## The read-back, the second run and the golden copy

`report.ts` reads every part of the world document (every part today's build declares, the optional ones included) and every row of §15.2 by today's build's own reads as the instance's user, and goes to disk only where no read of today's build reaches a store, saying so row by row. It never opens the chat that holds item 4's planted cases through the engine, whose reader would set them aside. Each row says how it was made (play, set-up or planted) and how it was read; ids are kept under `ids` and what the model chose under `played`, which `compare.ts` sets aside and asks only to be there.

Made twice from nothing: make a second empty Lumiverse from the same checkout (the bed's own script), give it a data folder, runtime home, instance folder, ports and runtime names of its own, run `make-instance.ts` there, and compare the two `report.json`. Remove the second Lumiverse, its runtime units and folders once compared.

The golden copy, once the read-back passes. Stop nothing by hand: `golden.sh take` stops the units it is given, copies, and starts them again.

```sh
export BED_ROOT=<the instance's root> BED_MARK=<its mark file> RUNTIME_HOME="$LRE_RUNTIME_HOME"
export BED_SKIP="<its checkout> <its caches> <this folder's copy> <its logs>"
export BED_UNITS="<the instance user's runtime unit> <the second user's runtime unit> <its Lumiverse unit>"
bash golden.sh take <archive>.tar.zst
cp "$LRE_INSTANCE_DIR/report.sha256" <archive>.tar.zst.report.sha256     # the read-back's checksum, kept beside the copy

bash golden.sh restore <archive>.tar.zst
bun report.ts --expect "$(cat <archive>.tar.zst.report.sha256)"            # the same instance: exits 1 on any other checksum
```

The floor test and `recheck.ts` below read the command line's sign-in from `$LRE_INSTANCE_DIR/config/lumirpengine/credentials.json` (`lib/lumiverse.ts`). For them, sign today's command line in there once: `XDG_CONFIG_HOME="$LRE_INSTANCE_DIR/config" LUMIVERSE_PASSWORD=… bun "$LRE_DATA_DIR/extensions/lumi_rp_engine/repo/dist/lumirpengine.js" login --url "$LRE_HOST_URL" --username <user>`.

## The floor test (`floor.ts`)

STANDALONE-PLAN §17.1: the same chat played turn about on a plain Lumiverse connection and on RPE's, each turn sent once the one before has finished (on RPE, once its run has ended, which can be after its reply). Run it on the test bed, where Lumiverse and RPE both listen. It uses the `LRE_*` variables above for Lumiverse (the CLI's saved sign-in) and these of its own:

```sh
export FLOOR_PLAIN_CONNECTION="<the Lumiverse connection that calls the model directly>"
export FLOOR_RPE_CONNECTION="<the Lumiverse connection that points at RPE>"
export FLOOR_RPE_URL=http://127.0.0.1:<RPE's port>   # `rpe status` prints it as "Listens on"
export FLOOR_RPE_TOKEN=<a web key, below>
export FLOOR_OUT=<a file of your own>.json            # every turn's numbers and the table
```

RPE lets its Turn page's routes in with a page token or with its web key. The web key is the one to give the script: make it on the server with RPE's own command line, on RPE's data folder (from a checkout, `scripts/testbed/rpe-bed.sh rpe key web`; on the server itself, `rpe key web --data <RPE's data folder>`). It is shown once. Making it retires the web key made before it, so RPE's web UI is signed in again with the new one.

```sh
bun floor.ts --help
bun floor.ts setup                                    # the floor's card, persona, preset and a new chat; prints FLOOR_CHAT
export FLOOR_CHAT=<the id it printed>
bun floor.ts run --pairs 10 --form tag                # ten pairs; --form two-step on a connection that needs it
bun floor.ts run --pairs 10 --only rpe --form tag     # RPE turns only: no comparison with plain is judged
bun floor.ts table "$FLOOR_OUT"                       # the table again from a saved run
bun floor.ts remove                                   # delete the floor chats, card, persona and preset
bun floor.ts say "I pay her two coins for the oil."   # one line of your own on RPE (--arm plain for plain), under the floor's preset and persona;
                                                      # prints the turn, RPE's tool calls before and after the reply (clean or not), the reply's start
```

The floor plays under a fixture of its own, consistent with itself, so that a simple turn asks nothing the chat cannot answer: the card (Marta Venn), a persona named as the card's scenario names the player ("Traveller", in the persona folder "Floor test (invented)") and a preset "Floor test (invented)" whose blocks are plain instructions naming nobody, the card, the scenario, the persona and the chat's history. Neither the persona nor the preset is made default or active: `run` names both on every generation it starts, plain and RPE alike (`preset_id` with `force_preset_id`, and `persona_id`, on `POST /api/v1/generate`), so no setting changes and every other chat keeps its own. The preset and the persona carry `lumirpengine_floor_test` in their metadata; `remove` deletes those, the card's chats named "Floor test", and the card when no other chat uses it.

`--form` names the form RPE's connection replies in (plan §10.7). The table is judged by that form's pass values, and a turn whose release the trace names in the other form leaves every gate not judged. What each of RPE's numbers is read from is said beside its field of `RpeTurn` in `floor-measure.ts`; what the script cannot measure yet is printed as such, with what RPE would have to give for it.

## A replay of turn kinds (`recheck.ts`)

For checking a build after fixes: one line, a continue of its reply and two swipes in a chat you name, each started through Lumiverse as a player would, with what Lumiverse saved and what RPE recorded of each printed side by side (a turn tied to its message, whether it is on the chat's path, its status and calls). It takes the floor test's environment for RPE's address, page token and connection.

```sh
bun recheck.ts edit <chat>          # before a cutover: appends one sentence to the newest reply in Lumiverse
bun recheck.ts play <chat> [line]   # on RPE: a line, a continue, two swipes
```
