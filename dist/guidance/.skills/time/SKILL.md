---
name: time
description: The clock and the calendar. How to let time pass, what to do with the list of what it brings due, and how to handle a long skip. Load it when more than a moment passes, or when the date, the hour or the weather matters.
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

It is a list of things to decide. The tool applied none of it. Your definition says whose the deciding is; this is how it is recorded:

1. For each item, what happened: it happened as scheduled, it happened differently, or it did not happen and why.
2. Each decision is recorded with the ordinary operations (`move`, `set`, `pay`, `fact`).
3. The Author is told what the time brought, in a few lines. An arrival or an ending effect may change the scene.

## A long skip

When the story jumps days or weeks:

1. Ask ahead first: what will come due in the span? (`world_query` with the span.)
2. Split the span where something due would change what comes after it: a deadline, an arrival, a season turning. Pass the time one stretch at a time.
3. For people off stage, the Author says what they did meanwhile. Record where they ended up and anything that changed for them.
4. For the routine remainder (meals, wages, rent), record totals for the stretch, not every instance. `time_totals` (found with `tool_search`) gives a person's totals for a span, from the engine run on a copy of the world, and records nothing.

## Setting the clock

If the clock is wrong (the story says dusk and the clock says noon), set it with a `set` operation on the time. The prose is its source. Time set backwards is reported, and `SIMULATION.md` says what to do with a report.

In a chat with no world the clock has no date until you set one: nobody chose its start, so no date is shown to anyone, and times are given as how long from now. `set` the time, or `pass_time` `until`, with a date and a time (YYYY-MM-DD HH:MM), once the story says when it is. A span or a time of day alone only moves the clock.

## The rest

The calendar's holidays, a person's routine, schedules, the weather: each has a tool of its own, found with `tool_search`.
