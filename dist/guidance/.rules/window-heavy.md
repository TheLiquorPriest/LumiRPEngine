---
description: Tells the Author, once in a turn, when the answers to its calls have grown past the size the header names, with how large its window now is. Every call from there on sends all of it again. A reminder of what `TURN.md` says of what the Author carries; its text stands by itself, so it holds with a `TURN.md` of your own. Change the number in the header and the reminder follows.
title: A window grown heavy with answers
agents: [author]
needs: TURN
fact: window.resultTokens > 30000
at: after-message
repeat: once per turn
---
Your window is now {{window.tokens}} tokens, {{window.resultTokens}} of them the answers to your calls this turn, and each call from here on sends all of it again. `window` with nothing asked lists what you hold, each thing with its size. An answer you have taken what you needed from can be let go, with a note of what you took, and comes back whole when you ask. `window` with `handoff` goes on in a fresh window, with a note of yours and the things you name to keep. Whether anything goes is yours to judge: what the reply or the record still needs stays.
