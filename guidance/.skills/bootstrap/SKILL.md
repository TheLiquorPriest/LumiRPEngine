---
name: bootstrap
description: Taking on a story that already has a past. Understand it well enough to continue it faithfully, and record what you learn where it belongs. Run as a job the player starts. Also the filing job for a chat carried over from the earlier build.
---
# Taking on a story with a past

Understand this story well enough to continue it faithfully. Record what you learn where it belongs.

How you go about it is yours to judge. The chat can be played while you work, and nothing waits for you. Work from the present backwards, because the next turns stand on what is nearest.

## What you have to work with

- **The lore index.** If it is not built, start that job first. It is cheap, and everything else leans on it.
- **The chat,** by range with `chat_read` and by search with `chat_search`. Hand long ranges to the historian with `delegate`: one range and one purpose each, several at once.
- **Summaries and memories that already exist.** Search the archive with `archive_search` before you read raw messages. Where the player kept a book of summaries, start there, and check a summary against the messages only where the next turns will lean on it.
- **For a chat carried over from the earlier build:** the state, the cast and the beats it left, its notebook, and each character's old mind files. Trust the carried state. Your work there is filing, below.

## Done enough

Stop when all six hold. They are in the order to do them. Say which hold when you report.

1. The lore index exists.
2. Every message the history window leaves out is covered by the story record, and every covered stretch has its summary. Do the stretch nearest the window first.
3. The cast is listed, each with its casting. The skill `casting` says how.
4. The story model has a premise, a skeleton of the timeline, the open threads, an arc for each principal, and a first read of the player.
5. The horizon is seeded: the time, the place, who is on stage and what they have, each marked established or assumed.
6. Each principal has a base drawn from its sources, and memories of its eight most important moments, written by its own agent from perceptions you give it.

## Filing a chat that was carried over

- **The notebook** (threads, questions, setups, arcs, the player, futures, the scene): move each note into its place in the story model with `story_record`. Keep the note's own words.
- **Mind files:** hand each principal's files to its own agent, and have it file them into its mind, its memories and its relationships, in its own voice. File a supporting character's files yourself, into its base, relationships and knowledge.
- **Beats without scenes:** the earlier build recorded beats and no scenes. Group them into scenes and chapters, and summarize each. The skills `scene-end` and `chapter-pass` say what a summary holds.

## Limits

The player set a token limit for this job. Before you pass it, stop and say what is done and what is left. Do not relive the whole story unless the player asked for that.

## What you end with

A report in a few lines: which of the six hold, what you could not settle, and what you would read next if given more.
