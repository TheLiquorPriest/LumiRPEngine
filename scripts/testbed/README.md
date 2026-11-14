# The migration's test instance

These scripts make the test instance the migration is proven on (STANDALONE-PLAN §15.5) by playing today's build on a test bed: an invented world and invented chats that fill every store today's build keeps. Nothing here reads or writes the engine's storage files by hand, with one exception: the `leftovers` step places one file that no row of the migration's inventory names, so the migration's report has something to catch.

Everything goes through the roads a user's own use goes through:

- Lumiverse's REST API, as the signed-in user: the character card, chats, messages, edits, swipes, deletions, the branch, the World Info book and its entries, and every generation (Send, Regenerate).
- The engine's own page requests (`lre.*`) and its harness pages' (`lah.*`), over Lumiverse's event socket. The scripts' socket is a page: Lumiverse names it as the frontend of the generations they start, so on the classic and agents engines the engine asks it to start each prepared reply, and it claims the turn (`lre.restart`) and starts it, as the page's `restart.ts` does.
- The engine's own `lumirpengine` CLI, from the installed extension: world building, attach, upgrade, settings, ✎ fixes, GM edits, chips, Keep and Discard, markers, lore fields and lore saves.
- The engine's own MCP server (`lumirpengine mcp`), run over stdio by the `checkin` step as an outside harness would run it.

## Running it

On the test bed, as the account that runs Lumiverse, with Bun 1.4 or newer:

```sh
export LRE_HOST_URL=http://127.0.0.1:<port>      # Lumiverse, as a browser opens it
export LRE_DATA_DIR=<Lumiverse's data folder>    # the engine's CLI and the user's storage are found under it
export LRE_INSTANCE_DIR=<a folder of your own>   # state.json, changes.jsonl and the CLI's sign-in
export LRE_CONNECTION_NAME="<a Lumiverse connection's name>"  # what the classic and agents engines run on
export LRE_NEVER_TOUCH=<id prefix>,<id prefix>   # chats the scripts must never act on (optional)

# Sign the engine's CLI in once, under the instance folder; the scripts use its saved session.
XDG_CONFIG_HOME="$LRE_INSTANCE_DIR/config" LUMIVERSE_PASSWORD=… \
  bun "$LRE_DATA_DIR/extensions/lumi_rp_engine/repo/dist/lumirpengine.js" login --url "$LRE_HOST_URL" --username <user>

bun make-instance.ts            # every step, in order
bun make-instance.ts harness    # one step (or several, by name)
```

The harness engine needs the engine's runtime linked with a connection of its own (the drawer's Harness → System → Runtime). The account's helper model should name a Lumiverse connection; the `settings` step reads it and sets the rest.

A run that is cut short can be run again: every step and each part of a step finds what an earlier run made (by the ids in `state.json`, else by name) and makes only what is missing. A failed turn is retried through its own flag's Retry, as a player would.

Every change is logged with its id in `$LRE_INSTANCE_DIR/changes.jsonl`, one JSON line each, and printed.

## What it makes

| Step | What |
|---|---|
| `checkin` | An outside harness (`testbed-harness`) runs the engine's MCP server, lists its tools and calls `lre_status`: the engine keeps its check-in in `agents.json`. |
| `settings` | Model choices naming a Lumiverse connection (the agents engine's main agent, the GM assistant; the helper is read); location, regard and handed things set to ask first. |
| `own` | An agent (`tide_reader`) and a skill (`harbor_round`) of the user's own, an edited harness text (`main.system`), an edited engine text (`harness.guidance.name`), and `~/GUIDANCE.md`. |
| `book` | A World Info book with an entry holding two secret marks (both known only to Dale Whitcomb), the engine's own fields on that entry, and an entry with an earlier build's secrecy fields moved by Build's Secrecy page (its backup is in `secrecy/`). |
| `world` | A world from the modern starter with the `modern` ruleset profile and invented parts: a map in 100 m squares (a town block), lore of its own (one held only by Dale, one behind a gate, one known by), a lore index, pins and books, a club, a quest, a vehicle, money, a routine, needs, minds and the rest; committed. Then its lore index entry built into the book, and a Check world job. |
| `chats` | A character card and a chat on each engine: classic, agents, harness. |
| `classic` | Two turns, a second swipe of the first reply, a palette tap staged and taken by the next message, ✎ fixes, a GM edit, a confirm chip answered, a money move done at once off screen, a player-claims marker, the player's character told one of the book's two secrets, a GM assistant thread, and the first reply's swipe flipped back with a turn after it. |
| `agents` | A typed turn and a panel action played at once; a GM edit and its Undo; the last reply's text edited; the first message edited and Keep pressed; files in the agents engine's workspace, learned area and global workspace; the first reply deleted with turns after it; a third turn and its review card, one change applied. |
| `revision` | A further world revision, the classic chat upgraded to it, and a draft left standing (a reply saved as lore). |
| `pause` | A branch of the classic chat with its later turns discarded, then the classic chat paused on keep-or-discard and left so, with a ✎ fix sent while it waits. |
| `leftovers` | A world chat with a staged tap, deleted in Lumiverse (its `runs/<chat>/` stays), and the one hand-placed file, `testbed-unclassified.txt`, at the top of the engine's per-user storage. |
| `harness` | The story prepared (cast, cores, notebook), two turns with the jobs after them (the principals' own mind files), one review-card change applied and the rest left, a GM assistant thread in a side session, and a palette tap left staged. |

All of it is invented; the world starts from the engine's own shipped starter.

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
