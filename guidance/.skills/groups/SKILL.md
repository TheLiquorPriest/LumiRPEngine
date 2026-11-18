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

A value set on a group reaches its members unless a member has their own: the watch's uniform, the guild's colours, the household's curfew. The world state shows such a value with the group it comes from. Set it once, on the group, with a `set` operation. Do not copy it onto each member.

## The everyday changes

- **Who belongs, a title, a position:** these are the engine's own records of a group, and its actions make them. Words about a person (a `set`, a `fact` on the person or on the crew) do not make anyone a member: the player's Orgs page, who may do what and the group's History read the record, not your words. Carry the action out with the `world_apply` operation `act`. Outside `params`, `who` is the one who does it, and what the action asks for and did not find is told in the answer; it is carried out all the same. Say why, in a line.
  - `org_admit` takes someone in, with a title or a position (`org`, `who`, `title`, `position`). Captain Hale takes Mara on as a deckhand; she is then a member of the crew with the title Deckhand, and the crew's History has the line:

    ```
    world_apply {"operations": [{"op": "act", "action": "org_admit", "who": "Captain Hale", "params": {"org": "The Ferry Crew", "who": "Mara", "title": "Deckhand"}, "source": {"from": "prose", "message": "m-0420"}}]}
    ```

  - Also: `org_leave` (the call's `who` leaves; `org`), `org_remove` (`org`, `who`), `org_title` (`org`, `who`, `title`, none to take it away), `org_appoint` (`org`, `who`, `position`, none to take them out of one), `org_position` (a position of the group itself: `org`, `title`, `powers`, `seats`). Every action of the engine has an id, and `checks_odds` (found with `tool_search`) lists them, with what each takes, when it is given an id the world does not have.
- **How people stand with a group or with each other:** `world_apply` with `relate`: standing, trust, a debt of honour, a grudge. A talk or a present between two people is an action of its own (`chat_with`, `give_gift`), carried out with `act` as above; the skill `time` says what a talk meets.
- **Pay, dues, shares:** money moves with `pay`, like any payment. What each member pays in, how often an organization pays its staff and sharing out its money are actions of their own (`org_dues`, `org_pay_schedule`, `org_share_out`), and taking someone on for pay is `job_hire`, carried out the same way. A wage that falls due shows in what time brings due (the skill `time`).
- **A place that only members may enter:** the entry rule belongs to the place and names the group. Who holds a key is a fact of the key.

## A group that acts

A group does not act by itself. Someone in it decides, by the powers of their position, and others carry it out.

- For a decision that matters, say who made it and by what right.
- For what the group does off stage over time, the Author says what it was after; you record what changed: who moved where, what was spent, who now stands how with whom.

## A new group

A group the lore names is taken from the lore. A group the story makes up as it goes (a crew that forms, a company founded in play) is founded with the action `org_found`, carried out with `act` as above. One made from nothing is an invention: the consent rule applies.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a position that does not exist, a power used by someone who does not hold it, a member counted twice. `SIMULATION.md` says what to do with a report.
