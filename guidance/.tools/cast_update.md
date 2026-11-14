---
description: cast_update as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  operations: The operations, written in order, in one write.
  operations.op: "The operation: cast, bind, base, growth, history, relationship, knowledge or filed."
  operations.who: "The character, by name or id. Someone the cast does not hold yet is added, and cast only by a cast operation."
  operations.id: "growth, history, knowledge: the entry to change, by its id. Leave it out to add one."
  operations.as: "cast: principal, supporting or extra."
  operations.line: "cast: who they are, in one line. All an extra has."
  operations.card: "bind: the character card's id in Lumiverse."
  operations.persona: "bind: the persona's id in Lumiverse."
  operations.entry: "bind: the lore entry's id, as the lore map shows it."
  operations.memory: "bind: their entity's id in Lumiverse's memory."
  operations.defines: "bind: which side of them the source defines (background, appearance, voice)."
  operations.seed: "base: who they are, in two lines."
  operations.soul: "base: what drives them, and what they will not do."
  operations.inner_voice: "base: how they think, and how they talk to themselves."
  operations.background: "base: where they come from."
  operations.text: "growth: how they have changed from their base. history: what happened to them, as their story tells it. relationship: how they feel about the person, in their voice. knowledge: one short statement of what they know."
  operations.cause: "growth: what caused the change."
  operations.beats: "history: the ids of the story's beats it comes from."
  operations.with: "relationship: the person it is toward, by name."
  operations.trust: "relationship: from -100 to 100, when useful."
  operations.warmth: "relationship: from -100 to 100, when useful."
  operations.respect: "relationship: from -100 to 100, when useful."
  operations.fear: "relationship: from -100 to 100, when useful."
  operations.how: "knowledge: how they learned it."
  operations.files: "filed: the old mind files carried over from the earlier build that have been filed into the record, by name (core.md). From then on their agent is no longer given them; they stay on the record."
  operations.accept: "growth: true to accept a change a character's reflection proposed, by its id; false to set it back to proposed."
  operations.drop: "bind: true to take the source away. growth, history, relationship, knowledge: true to strike it; say why. Struck knowledge of a secret takes the secret back from them, unless other knowledge of theirs still gives it."
  operations.why: "cast: why this casting. With drop: why it goes."
---
Writes a character's record, as many operations as you need in one call: their casting, the sources bound to them, their base, their growth, history, relationships and knowledge, and which of their old mind files have been filed. Casting, growth, history, relationships, knowledge and filing belong to this turn: if the turn is swiped or deleted, they go with it. The sources and the base stand outside turns, and every version of the base is kept. The answer gives what each operation wrote and how that part of the record now stands.
