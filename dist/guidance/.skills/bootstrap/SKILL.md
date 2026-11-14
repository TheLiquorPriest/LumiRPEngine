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

## What you are given

- **`bootstrap:job`:** what the player chose when starting this job: `relive`, how much of the past to relive (below; absent when the player chose none), and `tokenLimit`, the limit the player set (below).
- **`bootstrap:facts`:** where the six things below stand when you are given it, as counts and names: the lore index's entries and how many are indexed, the messages the history window leaves out and how many the story record covers and summarizes, the cast and who has no casting, the story model's parts, the horizon's entries, and each principal's base and memories. The counts say what there is, not whether it is enough: that is yours to judge against the six. Hand it on by name to any agent you delegate to. A fact given as `"known": false` with `"why": "unreadable"` is one whose records could not be read; read what you need of it with your own tools.

## Done enough

Stop when all six hold. They are in the order to do them. Whether each holds is yours to judge, from the records and against the words here. Say which hold when you report.

1. The lore index exists.
2. Every message the history window leaves out is covered by the story record, and every covered stretch has its summary. Do the stretch nearest the window first.
3. The cast is listed, each with its casting. The skill `casting` says how.
4. The story model has a premise, a skeleton of the timeline, the open threads, an arc for each principal, and a first read of the player.
5. The horizon is seeded: the time, the place, who is on stage and what they have, each marked established or assumed.
6. Each principal has a base drawn from its sources, and memories of its eight most important moments, written by its own agent from perceptions you give it.

## Filing a chat that was carried over

- **The notebook** (threads, questions, setups, arcs, the player, futures, the scene): move each note into its place in the story model with `story_record`. Keep the note's own words.
- **Mind files:** hand each principal's files to its own agent, and have it file them into its mind, its memories and its relationships, in its own voice. File a supporting character's files yourself, into its base, relationships and knowledge.
- **Marking files filed:** until a character's old mind files are marked filed, they are given whole every turn: to its own agent, or to you while a supporting character is on stage. Once what matters in them is filed, mark those files filed with `cast_update`'s `filed` operation, naming each file (`core.md`). They stay on the character's record.
- **Beats without scenes:** the earlier build recorded beats and no scenes. Group them into scenes and chapters, and summarize each. The skills `scene-end` and `chapter-pass` say what a summary holds.

## Reliving

To relive a stretch of the past is to have a principal's own agent take it in as that principal lived it, from perceptions you give it, in the order it happened, and record it in its own words. Relive no more than the player asked for:

- **No choice:** do what "Done enough" asks and nothing more. Later turns read the rest closely when they touch it.
- **`outline`:** every principal knows the past in outline, and nothing is relived beyond the memories of the sixth thing above.
- **`key moments`:** the key moments are relived as well: each principal relives the moments of the past that mattered most to it.
- **`all`:** every stretch of the past is relived, by each principal it reached.

## Limits

The player set a token limit for this job (`tokenLimit`): tokens sent and written together, by every agent of the job. The job is stopped when it reaches it, and ends with what is recorded by then. So record as you go: write each thing where it belongs as soon as you have settled it, not at the end.

## What you end with

A report in a few lines: which of the six hold, what you could not settle, and what you would read next if given more.
