---
name: groups
description: Guilds, crews, companies, households, watches and courts. How to read who belongs, who ranks and who may do what, and how to record someone joining, leaving, rising or being paid. Load it when a group acts, or when someone's place in one decides something.
---
# Keeping the groups

A group is a record of its own: who belongs to it, in what rank or position, what each position may do, what the group owns, and what it asks of its members. Groups sit beside the places in the world, and the world state gives a line for each.

## Before you rule on what someone may do

A member's rights come from their position, not from what would be convenient.

1. Read the group (`world_query` on it) and the person's place in it.
2. If the question is whether they may do a particular thing (open the vault, give an order, sign for the company), ask the group tools that question directly. Find them with `tool_search` ("who may").
3. Rule from the answer. If the story has someone act past their rights, that is a thing that happened, with whatever follows from it; record it and say so.

## What a group sets, its members have

A value set on a group reaches its members unless a member has their own: the watch's uniform, the guild's dues, the household's curfew. The world state shows such a value with the group it comes from. Set it once, on the group, with a `set` operation. Do not copy it onto each member.

## The everyday changes

- **Someone joins, leaves, is promoted, demoted or dismissed:** the group tools, found with `tool_search` ("member", "position"). Say why, in a line.
- **How people stand with a group or with each other:** `world_apply` with `relate`: standing, trust, a debt of honour, a grudge.
- **Pay, dues, shares:** money moves with `pay`, like any payment. A wage that falls due shows in what time brings due (the skill `time`).
- **A place that only members may enter:** the entry rule belongs to the place and names the group. Who holds a key is a fact of the key.

## A group that acts

A group does not act by itself. Someone in it decides, by the powers of their position, and others carry it out.

- For a decision that matters, say who made it and by what right.
- For what the group does off stage over time, the Author says what it was after; you record what changed: who moved where, what was spent, who now stands how with whom.

## A new group

A group the lore names is taken from the lore. A group the story makes up as it goes (a crew that forms, a company founded in play) is founded with the group tools, with its source said. One made from nothing is an invention; the consent rule applies.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a position that does not exist, a power used by someone who does not hold it, a member counted twice. Read the report, and put it in your answer to the Author.
