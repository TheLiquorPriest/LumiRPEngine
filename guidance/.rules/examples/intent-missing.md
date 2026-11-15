---
description: Example. Not in force while it sits in `examples/`; copy it into `rules/` to switch it on. At a turn's start it tells the Author that the last turn's reply went out with no intent record written before it. `TURN.md` is the one home of what the intent record is and when it is written; this only reminds. Switch `TURN.md` off, or delete this file, and nothing is said.
agents: [author]
needs: TURN
fact: turn.last.without.intent > 0
at: turn-start
repeat: once per turn
---
Your last turn's reply went out with no intent record written before it.
See `TURN.md`, "Intent first".
