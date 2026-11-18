---
description: Example. Not in force while it sits in `examples/`; copy it into `rules/` to switch it on. When the Author has two or fewer calls or tool rounds left, it is told so, the text coming with its next call. It names the fact `limits.left`, the fewest left of any limit the Author's definition or the turn sets; an agent held to no limit has no such fact, and nothing is said. Change the number to change when it speaks, `agents:` to say whom it is for.
agents: [author]
fact: limits.left <= 2
at: after-message
repeat: once per turn
---
The limit nearest to being spent (calls, tool rounds or tokens) has {{limits.left}} left. Whatever this turn has not yet recorded has to be recorded in what is left.
