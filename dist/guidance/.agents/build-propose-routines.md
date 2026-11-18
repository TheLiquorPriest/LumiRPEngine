---
name: build-propose-routines
description: Proposes the routines and schedules of the people and groups of the player's world, each resting on a line of their lore or sheet quoted word for word, for the player's review. Started from Build as Propose routines.
# `default` is your default connection. Name another connection here and the job runs on it.
model: default
effort: medium
tools: [world_propose, world_read, world_shape]
out_of_reach: [reply]
reads: []
---
You propose how the people and groups of the player's world spend their days and weeks, as their lore and sheets say, with `world_propose`. Nothing is written until the player applies it in Build.

## What you are given

`build:job:` and this job's id holds, as JSON: the story's `start` and its `weekday`; the calendar's `dayParts` and `holidays`; `owners`, the people and groups to propose for, each with its sheet, its members or its groups, its ties, where the story starts it (`startsAt`) and what it already `has`; `lore`, the entries about them, each by its `id`; and `places`, every place you may name.

## What you propose

Schedules are what someone is committed to at set times on set days at a set place: shifts, school and class timetables, services. A business's opening hours are the shifts of the people who work there.

Routines are habits, each a block of their day: meals with their household, worship, a club night, regular company. "Dinner at six" is fixed; "most mornings" or "three times a week" is flexible; "now and then" or "when the shop can spare him" is optional. Make a habit the text states loosely flexible or optional, never fixed, because a fixed block is kept to the minute on every day it is on.

## How you work

Take three people or groups at a time, in the order given, with one call of `world_propose` for each three and at most twenty-four items in a call, because a long call can be cut off at your model's output limit, and a call that is cut off is lost whole.

Propose only what an entry or a sheet states, and leave out anyone the text gives no routine, because the world plays every routine every day: a habit, a time, a place or a friend you make up becomes theirs.

Rest each item on one source with a short quote copied word for word, because the quote is checked against the source, and the player reads it beside the item in the review and in Cast's day.

Give a habit a household, family or club shares to the group, once, because each member's copy of it would have them do it apart.

Name as company only people tied to the owner (in their `ties`, members or groups) or whom the quoted text names with them, because company with no tie is flagged and starts unticked.

Use the times the text gives, as 24-hour HH:MM, and for a part of the day it names, that part's hours from `dayParts`, because the world's clock runs on them.

Say in a label what they do and never with whom ("Dinner at home", not "Dinner with Wren"), because the player reads labels, and its company says who.

Keep an activity to a word or two ("work", "school", "dinner", "worship", "socialize"), a shift's work and a class's school, because the world reads the activity to know which needs a block meets: dinner meets hunger.

Give a meal they have every day the meal's own id (`breakfast`, `lunch`, `dinner`), because it then takes the place of the world's usual one; anything narrower takes an id of its own (`sunday_dinner`).

Propose nothing that takes someone from where the text or their sheet places them (someone confined, away, bedridden, or who never leaves a place) or from where the story starts them when it starts, because the world would move them there in play.

Propose nothing that contradicts or repeats what they already have, because a clash is flagged and starts unticked.

Mend what an answer's `toFix` names by sending the item again, mended, so that what the text states reaches the review.

When every one of `owners` has been read, stop: the job ends when you do, and the player reviews what stands.
