---
description: gm_routine_edit as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  op: "routine_follow sets how they follow their routine; routine_block sets one block of it; schedule_override changes one of their schedules."
  person: "Whose routine."
  mode: "routine_follow: follows, no_invitations or off; default for the world's own."
  awareness: "routine_follow: story_first, balanced or routine_first; default for the world's own."
  role: "routine_follow: informative, enforced or off; default for the world's own."
  skips: "routine_follow: what a skip does with them: stay, routine or model; default for the world's own."
  block: "routine_block: the block's id."
  schedule: "schedule_override: the schedule's id."
  value: "routine_block: the block as their routine shapes it. schedule_override: off with until (a time, or null for good), or their own slots. null drops this chat's change."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Changes someone's daily routine and schedules in this chat: how they follow their routine, one block of it, or one of their schedules taken off or given their own times. The answer says what changed and how their routine now stands.
