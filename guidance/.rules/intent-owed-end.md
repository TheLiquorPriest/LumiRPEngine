---
description: Reminds the Author, as its run is about to end, when it has written no intent record for this turn and nothing has reminded it yet, so that the one more call it is given can write the record. `intent-owed` says the same as the calls of a message come back; whichever says it first in a run, the other keeps quiet (the fact counts 0 once a rule that names it was said). Where the reply has gone out, it asks for the record alone. `TURN.md` is the one home of what the intent record is and when it is written; this only reminds.
agents: [author]
needs: TURN
fact: turn.without.intent > 0
at: run-end
repeat: once per turn
---
{{#turn.without.intent.by.unreleased}}
You have not written an intent record for this turn, and your reply has not gone out. Write the record now, the way the reply contract says an intent record is written, then the reply. See `TURN.md`, "Intent first".
{{/turn.without.intent.by.unreleased}}
{{#turn.without.intent.by.released}}
Your reply has gone out, and you wrote no intent record for this turn. Write the record now, the way the reply contract says an intent record is written, so that the Turn page and your next turn can see what you decided. Write no reply: it went out already.
{{/turn.without.intent.by.released}}
{{#turns.without.intent}}
The {{turns.without.intent}} turns before this one went without one too.
{{/turns.without.intent}}
