---
description: Tells the Author when a turn is about to end with nothing recorded in either lane. A reminder of what `TURN.md` asks right after the reply. Delete this file and a turn may end unrecorded without a word.
agents: [author]
needs: TURN
fact: turn.owes.record > 0
at: run-end
repeat: once per turn
---
This turn is about to end with nothing recorded: no change in the engine lane, no beat, no record of the turn.
If the reply moved anything (time, where someone is, what changed hands, what someone now knows, where the scene stands), record it now. If it moved nothing, your record of the turn says so. See `TURN.md`, "Right after the reply".
