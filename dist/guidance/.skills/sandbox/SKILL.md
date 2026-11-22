---
name: sandbox
description: Run a moment with the characters and the GM. Stage it, let each act on what they perceive, resolve, repeat. For turns that hinge on several minds, on a contest, or on a stretch of time with consequences.
---
# Running a moment at the table

1. **Write the scene sheet** to `scratch/scene.md`:
   - where and when;
   - who is on stage, where they stand, what state they are in;
   - what the player's character does, in order, which is binding;
   - what is open;
   - the lore in play, cited by entry;
   - the moments, if the player's message covers a stretch.

2. **For each moment:**
   - Give each acting principal's agent the moment as that character perceives it, and start their agents together with one `task`: a piece for each, of the `character` definition, with `plays` naming whom and its brief the moment as they perceive it, and `keep` so that it can take in what it perceived after the reply. Its definition already gives it what comes to mind, its relationships with those present, its base and voice, what it wears and carries and what state it is in, and the lore it would know, with the secrets it holds. Add what it could perceive of the moment and nothing it could not; what is kept from it stays out of the brief (the perceptions rule, "What is kept from a character"). It answers in character with what it does, says and feels, and it may ask you. (What to record of that, and when its agent takes in what it perceived, is in the perceptions rule.)
   - Give the GM its specific questions alongside the characters', as a piece of the same `task` (of the `gm` definition), if they do not depend on the characters' answers; ask the ones that do after. Its definition already gives it the messages of the scene your prompt holds with a digest of what lies before them, the story brief, the activated lore in full, the scene's engine state with its map, what the moment's time brings due, the ruleset by its index and the scene sheet. Attach more of the prompt (`prompt:<name>`) if the ruling turns on it, and a character's cast views (`cast:<name>(base, mind)`, the views `cast:self` gives, by the character's name) if the ruling turns on who they are or what is on their mind.
   - Read what came back. If someone asked you something, answer it with `agent_message` before going on. If what an agent wrote should not stand, find `agent_drop` with `tool_search` and call it with `tool_use`: everything that agent wrote this turn is taken back.
   - Resolve the moment into beats: what happened, in order, as true.
   - Go on to the next moment, or close.

3. **Voice supporting characters and extras yourself,** from their records.

4. **Never call an agent for the player's character to act.** Where the briefing says that character has a mind of its own, an agent of its own writes its mind, memories and relationships from its perceptions; it never acts or speaks for it.

5. **You end with** the beats in order and the staged changes in both lanes. Then write the reply.

Play a moment again when one character's answer changes what another would do.
