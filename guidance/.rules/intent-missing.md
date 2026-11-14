---
description: Tells the Author, at a turn's start, when the last turn's reply went out with no intent record written before it. A reminder of what `TURN.md` asks first. Switch TURN.md off, or delete this file, and nothing is said.
agents: [author]
needs: TURN
fact: turn.last.without.intent > 0
at: turn-start
repeat: once per turn
---
Your last turn's reply went out with no intent record written before it.
See `TURN.md`, "Intent first".
