---
description: Notices when nothing has been recorded in the engine lane for a while. A reminder of what `TURN.md` asks about both lanes.
agents: [author]
needs: TURN
fact: turns.since.engine.change >= 6
at: turn-start
repeat: after 6 turns
---
Nothing has been recorded in the engine lane for {{turns.since.engine.change}} turns. Time, position, belongings and condition rarely stand still that long. Check what the last turns changed and record it, or say that nothing did.
