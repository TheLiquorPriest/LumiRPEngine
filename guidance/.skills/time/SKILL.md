---
name: time
description: The clock, the calendar and the needs that rise with them. How to let time pass, what to do with the list of what it brings due, how to handle a long skip, and how a meal, a night's sleep or a rest is recorded so that hunger, fatigue and the other needs come down. Load it when more than a moment passes, when the date, the hour or the weather matters, or when someone eats, sleeps or rests.
---
# Keeping the time

The world has one clock for the chat. The world state shows the date, the hour and the weather, each with the level of the world it comes from.

## Letting time pass

`world_apply` with a `pass_time` operation: how long, or until when. A time is read as it is written: a date and time, a clock time (22:00, noon), a part of the day the world's calendar names, or a counted span (two hours). Words that count nothing (a while) and a part of the day the calendar does not name are refused with what a time takes.

- Pass the time the story took. A conversation is minutes. A meal is an hour. A night's sleep is a night. If the prose does not say, choose plainly and say what you chose.
- Pass the whole of what the turn covers. Time passed twice is time passed twice, so look at the clock before passing more when a sub-agent may already have done so.
- In a fight or a chase on a room grid, time moves in the grid's own step, a few seconds a round. Pass it as `rounds` (the scene's grid says how long each is) or as `seconds`; do not add minutes on top. The round tool already moves the clock by the rounds it plays: do not pass those again.

## What time brings due

The answer to `pass_time` lists what fell due in that span and near the scene: where people's routines now put them, who arrives, a need that crossed a threshold (hunger, sleep), an effect that ended, something the Author scheduled, a payment, a change in the weather or in prices.

It is a list of things to decide. The tool applied none of it. The GM decides each item when it is asked; on a turn the Author runs alone, the deciding is the Author's. An item nobody decides did not happen: a person listed at school at 8:00 is still at home. This is how it is recorded:

1. For each item, what happened: it happened as scheduled, it happened differently, or it did not happen and why.
2. Each decision is recorded with the ordinary operations (`move`, `set`, `pay`, `fact`), or with the engine's own action where there is one: a need that was met is recorded as the next part says.
3. The Author is told what the time brought, unless the Author decided it. An arrival or an ending effect may change the scene.

## Needs

Hunger, fatigue, social and fun rise with the clock, and they come down only when the engine records that something met them. Passing the minutes of a meal does not meet hunger. What meets a need is one of the engine's actions, carried out with the `world_apply` operation `act`:

- **Hunger:** `eat` (`minutes`). **Fatigue:** `sleep` (`minutes` for a nap or a stated length; left out, a night's). **Social:** `chat_with` (`target`, `minutes`), a while with someone. **Fun:** `rest` (`minutes`). `get_up` ends a sleep or a rest, and `accept_invitation` (`host`) says yes to an invitation.
- `who` is the one who eats, sleeps or rests; left out, the player's character. `world_query` at `ruleset` lists every action the world has; a call that leaves out what its action asks for is answered with what it needs.
- `act` passes no time. Its answer gives the action's own minutes, and whoever runs the turn passes them with `pass_time` after it, once.
- A requirement of the action that does not hold is told in the answer, and the action is carried out all the same; `SIMULATION.md` says what to do with that report.
- A thirty-minute meal, paid for apart with `pay`; hunger is met when the meal ends and rises again from there:

```
world_apply {"operations": [{"op": "act", "action": "eat", "who": "Mara", "params": {"minutes": 30}, "source": {"from": "prose", "message": "m-0412"}}, {"op": "pass_time", "minutes": 30, "source": {"from": "prose", "message": "m-0412"}}]}
```

- A night's sleep: she goes to her bed if she has one, her activity is sleep until 07:00, and her fatigue is met at 07:00:

```
world_apply {"operations": [{"op": "act", "action": "sleep", "who": "Mara", "source": {"from": "prose", "message": "m-0415"}}, {"op": "pass_time", "until": "07:00", "source": {"from": "prose", "message": "m-0415"}}]}
```

A principal who sleeps dreams: the perceptions rule says when its agent is asked to.

## A long skip

When the story jumps days or weeks:

1. Ask ahead first: what will come due in the span? (`world_query` with the span.)
2. Split the span where something due would change what comes after it: a deadline, an arrival, a season turning. Pass the time one stretch at a time.
3. For people off stage, the Author says what they did meanwhile. Record where they ended up and anything that changed for them. A principal for whom days pass dreams: the perceptions rule says when.
4. For the routine remainder (meals, wages, rent), record totals for the stretch, not every instance. `time_totals` (found with `tool_search`) gives a person's totals for a span, from the engine run on a copy of the world, and records nothing.

## Setting the clock

If the clock is wrong (the story says dusk and the clock says noon), set it with a `set` operation on the time. The prose is its source. Time set backwards is reported, and `SIMULATION.md` says what to do with a report.

In a chat with no world the clock has no date until you set one: nobody chose its start, so no date is shown to anyone, and times are given as how long from now. `set` the time, or `pass_time` `until`, with a date and a time (YYYY-MM-DD HH:MM), once the story says when it is. A span or a time of day alone only moves the clock.

## The rest

The calendar's holidays, a person's routine, schedules, the weather: each has a tool of its own, found with `tool_search`.
