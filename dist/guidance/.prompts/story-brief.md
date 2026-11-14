---
description: The layout of the story brief the Author is given at the start of every turn. The current scene, the threads held hot, the arcs of those the scene has on stage, the futures whose time has come, and the player model, each as the story record holds it, with its id. Each part appears only when there is something in it. An agent given the brief by name (story:brief) when nothing is in it is given the none part, which says so. It lays out what the record holds; it asks for nothing.
---
{{#none}}
Nothing to brief: no scene is open, no thread is held hot, no future's time has come, and nothing is recorded of the player.
{{/none}}
{{#scene}}
### The scene [{{scene.id}}]{{#scene.title}}: {{scene.title}}{{/scene.title}}

- Since message {{scene.from}}
{{#scene.place}}
- Where: {{scene.place}}
{{/scene.place}}
{{#scene.time}}
- When: {{scene.time}}
{{/scene.time}}
{{#scene.who}}
- On stage: {{scene.who}}
{{/scene.who}}
{{#scene.purpose}}
- What it is for: {{scene.purpose}}
{{/scene.purpose}}
{{#scene.tension}}
- Tension: {{scene.tension}}
{{/scene.tension}}
{{#scene.wants}}
- Who wants what: {{scene.wants}}
{{/scene.wants}}
{{#scene.ends}}
- What would end it: {{scene.ends}}
{{/scene.ends}}

{{/scene}}
{{#threads}}
### Threads you hold hot

{{#threads.items}}
- [{{id}}] {{text}}
{{#who}}
  Who: {{who}}
{{/who}}
{{#state}}
  Where it stands: {{state}}
{{/state}}
{{#stakes}}
  Stakes: {{stakes}}
{{/stakes}}
{{#payoff}}
  The payoff you intend: {{payoff}}
{{/payoff}}
{{/threads.items}}

{{/threads}}
{{#arcs}}
### Arcs of those on stage

{{#arcs.items}}
- {{who}}
{{#began}}
  Began: {{began}}
{{/began}}
{{#stands}}
  Stands: {{stands}}
{{/stands}}
{{#next}}
  May go: {{next}}
{{/next}}
{{/arcs.items}}

{{/arcs}}
{{#futures}}
### Futures whose time has come{{#now}} (it is {{now}}){{/now}}

{{#futures.items}}
- [{{id}}] {{text}}
{{#due}}
  Due: {{due}}
{{/due}}
{{#tier}}
  Tier: {{tier}}
{{/tier}}
{{#standing}}
  How sure: {{standing}}
{{/standing}}
{{#who}}
  Who: {{who}}
{{/who}}
{{#place}}
  Where: {{place}}
{{/place}}
{{/futures.items}}

{{/futures}}
{{#player}}
### The player

{{#player.items}}
- [{{id}}] {{#kind}}{{kind}}: {{/kind}}{{text}}
{{/player.items}}
{{/player}}
