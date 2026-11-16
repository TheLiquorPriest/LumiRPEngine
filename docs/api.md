# RPE's API

Every route RPE's server holds, as its route table declares it, every kind its live socket carries, and the live socket's own messages. `bun run api` (`scripts/api/`) writes this page and `src/shared/api/index.ts`, the types the pages, the command line and the MCP server call RPE with, from the table the server runs. A route changes in its own declaration, and both are written again from it; a test fails while either is behind the table. Do not edit this page by hand.

Who may call a route: **public**, anyone who reaches RPE; **page**, a page of the Lumiverse user this RPE belongs to, with a page token or the web UI's token; **provider**, Lumiverse on RPE's connection, with the provider key; **extension**, the light extension, with its registration key.

Every request's body is held to its route's limit, whatever its method: one over it is refused with 413. A GET takes no body on any route, nor does a DELETE on a route that answers in JSON, so either is refused with 400 when it carries one. A route in the form that answers in JSON is held to its declaration before its code runs: a name or a value in its query that it does not declare, or a body it does not take, is refused with 400, and the answer's `error` says why. A route that answers in its own way (the provider endpoint, the extension's routes, the live socket, the web UI's files) is handed the request within its body limit, reads its query and its body itself, and says in its own words what it does not take. A route that takes a turn's id (in its path, its query or its body) says so in its listing, and answers a turn that was joined to another (a continue's held turn) as a fact: status 409 and `{ "joined": { "turn", "joined" } }`, naming the turn it joined, which is the one to ask for; a page follows it, and it is never a failure of the server. A route marked as a tunnel carries the previous build's messages as that build wrote them, until the pages that send them have routes of their own. A refusal is `{ "error": "<why>" }` on every route but the provider endpoint's, which answers as OpenAI does.

A route that pages takes `limit` and `cursor` in its query and answers `{ items, next }`: `next` is where the next page starts, given back as `cursor`, and null at the end. A cursor names the place after the last item a page gave, by that item's place in the list's own order, never by a count of items, so a walk over a list that changes between its pages neither repeats nor skips an item that stayed. A route refuses with 400 a cursor it did not give for that list: another route's, another list's, one changed, or one given before RPE last started.

## Contents

- [The provider endpoint](#the-provider-endpoint)
- [Chats](#chats)
- [Turns](#turns)
- [State](#state)
- [Cast](#cast)
- [Story](#story)
- [Lore](#lore)
- [Files](#files)
- [Jobs](#jobs)
- [Connections](#connections)
- [Settings](#settings)
- [Worlds](#worlds)
- [Migration](#migration)
- [Service](#service)
- [The live socket](#the-live-socket)
- [The web UI](#the-web-ui)
- [The live socket's kinds](#the-live-sockets-kinds)
- [The live socket's messages](#the-live-sockets-messages)
- [Types](#types)

## The provider endpoint

### `POST /v1/chat/completions`

The provider endpoint: Lumiverse's chat completions, answered as the Lumiverse provider API's own (OpenAI's chat completions, streamed or whole); a reply tagged for a turn of RPE is played through the turn lane, any other is passed on.

| | |
|---|---|
| Access | provider: Lumiverse on RPE's connection (the provider key) |
| Body limit | the server's `server.providerBodyBytes` (32 MiB as shipped) |
| Params | none |
| Answers | an OpenAI chat completion, streamed or whole, as OpenAI answers |

### `GET /v1/models`

The models the provider endpoint offers, as the connection in Lumiverse lists them.

| | |
|---|---|
| Access | provider: Lumiverse on RPE's connection (the provider key) |
| Body limit | takes no body |
| Params | none |
| Answers | an OpenAI model list |

## Chats

### `GET /api/v1/chats`

The chats RPE played, the most recently played first, then the chats its store holds that it has not played (a migration's), by name.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`ChatsReply`](#chatsreply) |

### `GET /api/v1/chats/:chat/messages`

A chat's messages as Lumiverse holds them, by a list of ids or by a stretch of its places (`index_in_chat`, a gap where a message was deleted); only the signed-in user's own chats.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `ids` (may be left out): `string`, The messages' ids, separated by commas<br>`from` (may be left out): `number`, The first place (`index_in_chat`) of a stretch<br>`to` (may be left out): `number`, The place a stretch ends before: the messages from `from` up to but not including it |
| Body | none |
| Reply | [`ChatMessagesReply`](#chatmessagesreply) |

### `GET /api/v1/chats/:chat/requests`

What waits in a chat for the next message, asked for beside his words: each request with its kind, what was asked and when.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`RequestsReply`](#requestsreply) |

### `POST /api/v1/chats/:chat/requests`

Holds a composer control's ask (depth or swipe) for the next message, in place of one of its kind that waited; one longer than requests.textMost is not kept, and the answer says so.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`RequestAsk`](#requestask) |
| Reply | [`RequestHeldReply`](#requestheldreply) |

### `DELETE /api/v1/chats/:chat/requests/:request`

Withdraws a request that waits; one kept with a turn already stays, and the answer names the turn.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `request` |
| Query | none |
| Body | none |
| Reply | [`RequestWithdrawnReply`](#requestwithdrawnreply) |

## Turns

### `GET /api/v1/chats/:chat/newest`

The newest turn on the chat's path in one read, as the turn's own route gives it: a turn going on now, else the newest of the chat's own on its path, however far back it was swiped.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `run` (may be left out): `string`, One of the turn's runs, by RPH's own id for it (its records' `run`), that `from` counts in; the turn's first when left out. Every record of each run that began after it is given whole<br>`from` (may be left out): `number`, The named run's records are given from the one with this number; 1 when left out |
| Body | none |
| Reply | [`TurnReply`](#turnreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `POST /api/v1/chats/:chat/settle`

Settle now: a run on the chat's newest turn that writes nothing into the chat; answers the turn and the run begun, or a refusal in the turn-errors part's words.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`SettleReply`](#settlereply) |

### `GET /api/v1/chats/:chat/turns`

A chat's turns, newest first, each with what its runs spent together; `before` is a turn's id, and older ones follow it. The settings `turns.page` and `turns.pageMost` give a page's length.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `limit` (may be left out): `number`, How many turns to give: the setting `turns.page` when left out, and at most `turns.pageMost`<br>`before` (may be left out): [`TurnId`](#turnid), A turn's id: the turns older than it are given |
| Body | none |
| Reply | [`TurnsReply`](#turnsreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/turns/:turn`

One turn, read on from where a page has read to: its intent record, what went to the chat, the lore of its prompt, its runs' records from the record numbered `from` of the run named, each of its runs, and all it holds besides (its prompt by slice, what he asked for, the Author's record, the tools it found, its changes by lane, open todo items, what it was told, and the old engine's record of a carried turn).

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn` |
| Query | `run` (may be left out): `string`, One of the turn's runs, by RPH's own id for it (its records' `run`), that `from` counts in; the turn's first when left out. Every record of each run that began after it is given whole<br>`from` (may be left out): `number`, The named run's records are given from the one with this number; 1 when left out |
| Body | none |
| Reply | [`TurnReply`](#turnreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/turns/:turn/files`

The whole of a turn's folder, every level down, each entry with its size; none for a turn that has no folder.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn` |
| Query | none |
| Body | none |
| Reply | [`FolderReply`](#folderreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/turns/:turn/files/*`

One file of a turn's folder, by its path below the folder, as text; no path leaves the folder.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn`, `*` (the rest of the path) |
| Query | none |
| Body | none |
| Reply | [`FileReply`](#filereply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/turns/:turn/requests`

What a turn was told beside his words and keeps, and what was played as its message.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn` |
| Query | none |
| Body | none |
| Reply | [`RequestsReply`](#requestsreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/turns/:turn/requests/*`

One model call's request, by its file below the turn's folder (a run's `requests`), rebuilt exactly as it was sent; where it cannot be, it says so and shows nothing.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn`, `*` (the rest of the path) |
| Query | none |
| Body | none |
| Reply | [`RequestReply`](#requestreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `POST /api/v1/chats/:chat/turns/:turn/stop`

Stops a turn going on now; says whether it was running.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn` |
| Query | none |
| Body | none |
| Reply | [`StopReply`](#stopreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

## State

### `POST /api/v1/chats/:chat/actions`

Tunnel for the previous build's messages: a panel's action as a page sends it, answered with today's `lre.result` or `lre.error`.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`FrontendToBackend`](#frontendtobackend) |
| Reply | `ResultMessage | ErrorMessage` |

### `POST /api/v1/chats/:chat/actions/undo`

Tunnel for the previous build's messages: the Undo of a tap, sent as the previous build's Undo chip is, answered with today's `lre.result` or `lre.error`; a tap of a turn joined to another is answered with the turn it joined.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`UndoAsk`](#undoask) |
| Reply | `ResultMessage | ErrorMessage` |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/state`

A chat's state view, at its head or as it stood at one of its turns, in the shape the previous build's pages take.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `turn` (may be left out): [`TurnId`](#turnid), A turn's id: the state as it stood at that turn; left out, at the chat's head |
| Body | none |
| Reply | [`StateView`](#stateview) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/state/due`

What a turn's time brought due, each thing with what the turn recorded for it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `turn` (may be left out): [`TurnId`](#turnid), A turn's id; left out, the chat's newest turn |
| Body | none |
| Reply | [`DueReply`](#duereply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `POST /api/v1/chats/:chat/taps`

A tap that manages, or a correction from any page, recorded at once as his own edit; what the world's rules turn down is applied with its report; a refusal is answered in words with nothing changed.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`TapAsk`](#tapask) |
| Reply | [`TapReply`](#tapreply) |

### `POST /api/v1/chats/:chat/taps/undo`

The Undo of an edit of his, by the id its answer gave: all of it, or none and the answer says why.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`TapUndoAsk`](#tapundoask) |
| Reply | [`TapReply`](#tapreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/world`

The world's tree for a chat: the level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `at` (may be left out): `string`, The level to start at, by its ref; `world` when left out<br>`depth` (may be left out): `number`, How many levels below it to give; 1 when left out<br>`values` (may be left out): `"none" | "own" | "all"`, Which values each level carries: none, its own, or all; `own` when left out<br>`turn` (may be left out): [`TurnId`](#turnid), A turn's id: the world as it stood at that turn; left out, at the chat's head |
| Body | none |
| Reply | [`WorldReply`](#worldreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

## Cast

### `GET /api/v1/chats/:chat/cast`

Every character a chat knows, with what each holds on the path read: at the chat's newest turn, or as it stood at one of its turns.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `turn` (may be left out): [`TurnId`](#turnid), A turn's id: the cast as it stood at that turn; left out, at the chat's newest |
| Body | none |
| Reply | [`CastReply`](#castreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `GET /api/v1/chats/:chat/cast/:character`

Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `character` |
| Query | `turn` (may be left out): [`TurnId`](#turnid), A turn's id: the cast as it stood at that turn; left out, at the chat's newest |
| Body | none |
| Reply | [`CharacterReply`](#characterreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `POST /api/v1/chats/:chat/cast/:character/strike`

Strikes an entry of a character's record, or takes its strike back, as the player's own change on the chat's newest turn; says what it did, in the cast's words.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat`, `character` |
| Query | none |
| Body | [`CastStrikeAsk`](#caststrikeask) |
| Reply | [`CastStrikeReply`](#caststrikereply) |

## Story

### `GET /api/v1/chats/:chat/story`

A chat's story record, at its newest turn or as it stood at one of its turns: the timeline, the story model's parts, the Author's horizon and the futures; each list bounded by the story's own setting, read further back with `part` and `skip`.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `turn` (may be left out): [`TurnId`](#turnid), A turn's id: the record as it stood at that turn; left out, at the chat's newest<br>`part` (may be left out): [`StoryListName`](#storylistname), Read this list further back: with no part named, every list<br>`skip` (may be left out): `number`, How many of a list's newest items to pass over; 0 when left out |
| Body | none |
| Reply | [`StoryReply`](#storyreply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

### `POST /api/v1/chats/:chat/story/strike`

Strikes an item of the story record, or takes its strike back, as the player's own change on the chat's newest turn; says whether anything was recorded and the item as it stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`StoryStrikeAsk`](#storystrikeask) |
| Reply | [`StoryStrikeReply`](#storystrikereply) |

## Lore

### `GET /api/v1/chats/:chat/lore/books`

Every book of the user's by its id and name, for the Settings page's choice of the books the lore reads (`lore.books`): whether the chat has it attached, whether a character brought it, and when Lumiverse made it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`LoreBooks`](#lorebooks) |

### `GET /api/v1/chats/:chat/lore/index`

The lore index of a chat, a page at a time in the order of the lore map's catalog: each entry of its books and its world with its id, keys, size, how it activates and revision, and the lines the index holds of it (the user's own, else the latest run's, an earlier revision's marked stale) with whether they are current.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | `limit` (may be left out): `number`, the page's size<br>`cursor` (may be left out): `string`, where the page starts: a page's `next` |
| Body | none |
| Reply | `{ items: LoreIndexRow[]; next: string | null }`, a page at a time |

### `PUT /api/v1/chats/:chat/lore/index/:entry`

The owner's own lines for one entry of a chat's lore: its kind, its line, what it defines (each to a record by its id, a name given resolving to the one record of that name, else kept as written and shown unlinked) and its related entries. What he sets stands over an indexing run's and outlives a run that redoes the entry; null takes his own off, and the run's shows again. Answers the entry as it now stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat`, `entry` |
| Query | none |
| Body | `{ kind?: string | null; line?: string | null; defines?: { what: string; aspect: string }[] | null; related?: string[] | null }` |
| Reply | [`LoreIndexRow`](#loreindexrow) |

### `POST /api/v1/chats/:chat/lore/index/jobs`

Starts a lore indexing job for a chat: the indexer's definition as a job of the owner's own, tied to no turn, handed the entries no run has indexed as they stand now a batch at a time. Refused, with the fact, where jobs are off or a limit of the day is reached.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`LoreIndexJob`](#loreindexjob) |

### `GET /api/v1/chats/:chat/lore/index/status`

Where a chat's lore indexing stands: its entries and how many no run has indexed as they stand now, and the connection and model the indexer's definition runs on (its own, else his default).

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`LoreIndexStatus`](#loreindexstatus) |

### `GET /api/v1/chats/:chat/lore/overlays`

The overlays on a chat's path, in the path's order: each with its entry and the entry's title, the note, the turn that wrote it (its place on the path, from 1, and its id) and who wrote it. A turn that was swiped away or deleted has none on the path.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`LoreOverlays`](#loreoverlays) |

### `GET /api/v1/chats/:chat/turns/:turn/lore`

The lore Lumiverse activated for a turn's prompt, in the tag's order: each entry's lore map id, its id and book in Lumiverse, its title and how it activated where the tag says; none for a turn RPE holds no tag for, or one of another chat.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat`, `turn` |
| Query | none |
| Body | none |
| Reply | [`TurnLoreReply`](#turnlorereply) |
| Also answers | status 409, [`JoinedAnswer`](#joinedanswer): the turn is joined to another, and the turn it joined is the one to ask for |

## Files

### `GET /api/v1/files`

Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own |
| Body | none |
| Reply | [`TreeListingReply`](#treelistingreply) |

### `POST /api/v1/files-apply`

"Apply now": starts the opening block of the chat's open session afresh from the files as they stand, there and then (the next run of each agent makes it); says which session, or that none is open and the next one opens with the files as they stand. Nothing else carries it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`ApplyNowAsk`](#applynowask) |
| Reply | [`ApplyNowReply`](#applynowreply) |

### `POST /api/v1/files-copy`

Copies a file or folder of the user's to a path nothing stands at (the copy of a folder leaves its links out); a file copied into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`FileMoveAsk`](#filemoveask) |
| Reply | [`FileMovedReply`](#filemovedreply) |

### `GET /api/v1/files-diff/*`

A file's difference from the shipped file of its name, and what the updates that changed the shipped file since it was written changed of it, together and one by one.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `*` (the rest of the path) |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own |
| Body | none |
| Reply | [`TreeDiffReply`](#treediffreply) |

### `POST /api/v1/files-folder`

Makes a folder of the user's, and the folders above it, at a path of a chat's view (a never-played chat is placed first); never a shipped one, or one RPE makes again.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`FolderAsk`](#folderask) |
| Reply | `{ path: string }` |

### `GET /api/v1/files-list`

The chat's view of the tree read like a filesystem: one folder's files and folders a page at a time (the chat's own top, with the other levels' folders, when none is named), or a search by name and by text across every level, each file with whether RPH takes it and why not; with no chat, the shipped and global levels.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own<br>`folder` (may be left out): `string`, The folder to list, by its path in the view; the chat's own top when left out<br>`search` (may be left out): `string`, Search every level for files whose path or text holds this, instead of listing a folder<br>`limit` (may be left out): `number`, How many entries a page holds; the `files.listPage` setting's when left out, and at most `files.listMost`<br>`after` (may be left out): `string`, Where the page starts after: the `next` of the page before |
| Body | none |
| Reply | [`TreeListedReply`](#treelistedreply) |

### `POST /api/v1/files-move`

Renames or moves a file or folder of the user's to a path nothing stands at; a file moved into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`FileMoveAsk`](#filemoveask) |
| Reply | [`FileMovedReply`](#filemovedreply) |

### `PUT /api/v1/files-off/*`

Switches a file's name off or on again in the `off:` list of a level's config, which is what "Delete" on a shipped file does; says the file as the listing now shows it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `*` (the rest of the path) |
| Query | none |
| Body | [`FileSwitchAsk`](#fileswitchask) |
| Reply | [`FileWrittenReply`](#filewrittenreply) |

### `PUT /api/v1/files-pin/*`

Pins a file for an agent, or takes the pin away, in the `pins:` list of a level's config (the global level's, or a chat's): the agent is handed the file whole at the start of each of its runs. A path the view does not hold is refused; says the file as the listing now shows it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `*` (the rest of the path) |
| Query | none |
| Body | [`FilePinAsk`](#filepinask) |
| Reply | [`FileWrittenReply`](#filewrittenreply) |

### `GET /api/v1/files-pins`

Every pin the levels' configs hold for a chat (with no chat, the global level's), with whether its file is in the view and whether a definition names its agent: a pin of a file that is gone or of an agent no definition names is listed as such, never dropped.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own |
| Body | none |
| Reply | [`FilePins`](#filepins) |

### `POST /api/v1/files-prune`

Prunes a chat's old turn folders as the chat's retention setting says, never while a turn of it is going on; says what it took away.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`PruneAsk`](#pruneask) |
| Reply | `{ pruned: PrunedShown }` |

### `GET /api/v1/files-stack`

The exact stack an agent gets in a chat, part by part, each with the file it comes from and its text, and the briefing's parts with the situations that add them; with no chat, the stack the shipped and global levels give.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat the agent runs in; left out, the shipped and global levels alone<br>`agent`: `string`, The agent's definition |
| Body | none |
| Reply | [`StackReply`](#stackreply) |

### `GET /api/v1/files/*`

One file of the tree, as text: a short file whole, a long one the lines (`line`, `lines`) or the bytes (`offset`, `length`) asked for, `files.readLines` lines when it asks for none; with the file's size and its count of lines, and whether it goes on.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `*` (the rest of the path) |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own<br>`line` (may be left out): `number`, The first line to read, from 1<br>`lines` (may be left out): `number`, How many lines to read; the `files.readLines` setting's when left out<br>`offset` (may be left out): `number`, Read bytes instead of lines: the first byte, with `length`<br>`length` (may be left out): `number`, How many bytes to read from `offset` |
| Body | none |
| Reply | [`TreeFileReply`](#treefilereply) |

### `PUT /api/v1/files/*`

Writes a file's whole text as the user at a level (for a file of another level, the user's own file of its name there); says the file as the listing now shows it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `*` (the rest of the path) |
| Query | none |
| Body | [`FileWriteAsk`](#filewriteask) |
| Reply | [`FileWrittenReply`](#filewrittenreply) |

### `DELETE /api/v1/files/*`

Removes a file of the user's; for one in place of a default, that is resetting to the default. "Delete" on a shipped file writes its name in the `off:` list of the level named (the chat's when a chat is named, else the global level's), so the shipped file stays and is not in force.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `*` (the rest of the path) |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own<br>`level` (may be left out): `"global" | "chat"`, For a shipped file, the level whose `off:` list takes its name; the chat's when a chat is named, else the global level's |
| Body | none |
| Reply | `{ removed: string; switchedOff?: LayerLevel }` |

### `GET /api/v1/storage`

What the tree takes, a page of chats at a time from the sizes RPE keeps (a chat not measured yet is measured meanwhile and shows its sizes at the next read): each chat's folder by area and its rows of the database, the user's own level, the shipped level, and RPE's database file with what no chat's rows take of it.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `limit` (may be left out): `number`, How many chats a page holds; the `storage.chatsListed` setting's when left out, and at most `files.listMost`<br>`after` (may be left out): `string`, The chat after which the page starts: the `next` of the page before |
| Body | none |
| Reply | [`StorageReply`](#storagereply) |

### `POST /api/v1/storage-prune`

Prunes on request, asked first: without `plan` it answers which places would go (a chat's old turn folders, its closed sessions' files, a deleted chat's other files, or the backup or copy of the database named), how many files and bytes, and a plan standing for exactly that; with the plan it takes exactly that, or nothing if the tree has changed since. Never a turn going on, never an open session's files.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`StoragePruneAsk`](#storagepruneask) |
| Reply | [`StoragePruneReply`](#storageprunereply) |

### `GET /api/v1/storage/kinds`

Each kind RPE keeps (notes, versions of notes, suggestions, turn folders kept whole and pruned, session files, the user's files, the shipped level, the database, the migration's backups, copies of the database, archives) with how many, how big, the oldest, how long it is kept and by which setting, and when the user last pruned.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`StorageKindsReply`](#storagekindsreply) |

### `GET /api/v1/storage/notes`

A chat's largest notes, and those agents rewrote most.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat`: `string`, The chat whose notes are listed<br>`limit` (may be left out): `number`, How many of each; the Storage page's setting when left out, and at most its largest |
| Body | none |
| Reply | [`NotesReply`](#notesreply) |

### `GET /api/v1/suggestions`

A chat's suggestions from the agents (every chat's when none is named), newest first, each with what it would change and the level accepting it writes at.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose view of the tree is read; left out, the shipped level and the user's own<br>`state` (may be left out): [`SuggestionStatus`](#suggestionstatus), Only the suggestions in this state |
| Body | none |
| Reply | [`SuggestionsReply`](#suggestionsreply) |

### `POST /api/v1/suggestions/:id/accept`

Accepts a suggestion as it is or edited, writing it as the user at the level named, or where the suggestion says it writes; says the suggestion as it now stands and the file.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `id` |
| Query | none |
| Body | [`SuggestionAcceptAsk`](#suggestionacceptask) |
| Reply | [`SuggestionAcceptedReply`](#suggestionacceptedreply) |

### `POST /api/v1/suggestions/:id/dismiss`

Dismisses a suggestion; says the suggestion as it now stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | [`SuggestionDismissedReply`](#suggestiondismissedreply) |

## Jobs

### `POST /api/v1/bootstrap`

Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another; says which started and which were refused, and why.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`BootstrapBatchAsk`](#bootstrapbatchask) |
| Reply | [`BootstrapBatchReply`](#bootstrapbatchreply) |

### `GET /api/v1/chats/:chat/bootstrap`

A chat's bootstrap: the six facts of "done enough", and the chat's bootstrap jobs, oldest first, each with how it stands or ended.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`BootstrapChatReply`](#bootstrapchatreply) |

### `POST /api/v1/chats/:chat/bootstrap`

Starts a chat's bootstrap job (taking on a story with a past), with the player's choice of what to relive; a start that is refused is answered in words, with nothing started.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `chat` |
| Query | none |
| Body | [`BootstrapStartAsk`](#bootstrapstartask) |
| Reply | [`JobView`](#jobview) |

### `GET /api/v1/chats/:chat/jobs`

The user's jobs of one chat, as RPH last kept each, the newest started first.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `chat` |
| Query | none |
| Body | none |
| Reply | [`JobsReply`](#jobsreply) |

### `GET /api/v1/jobs`

The user's jobs, of every chat, as RPH last kept each, the newest started first.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`JobsReply`](#jobsreply) |

### `POST /api/v1/jobs/:job/cancel`

Cancels a job; one that has ended already is given as it ended.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `job` |
| Query | none |
| Body | none |
| Reply | [`JobCancelReply`](#jobcancelreply) |

### `GET /api/v1/jobs/:job/told`

What a job he started (which belongs to no turn) was told as it went: its gap checks, consents and rules fired.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `job` |
| Query | none |
| Body | none |
| Reply | [`JobToldReply`](#jobtoldreply) |

## Connections

### `GET /api/v1/connections`

The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`ConnectionsShown`](#connectionsshown) |

### `POST /api/v1/connections`

Adds a connection, with its key when it has one.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`SaveConnection`](#saveconnection) |
| Reply | [`ConnectionShown`](#connectionshown) |

### `PUT /api/v1/connections/:id`

Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `id` |
| Query | none |
| Body | [`SaveConnection`](#saveconnection) |
| Reply | [`ConnectionShown`](#connectionshown) |

### `DELETE /api/v1/connections/:id`

Removes a connection, and its key.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | nothing (204) |

### `PUT /api/v1/connections/:id/default`

Makes a connection the default.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | nothing (204) |

### `GET /api/v1/connections/:id/signin`

Where the sign-in of a connection that signs in to its provider stands: signed in or not, until when, its open flow.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | [`SignInState`](#signinstate) |

### `POST /api/v1/connections/:id/signin`

Starts signing a connection in to its provider: the flow, and the address the user opens to sign in.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | [`SignInStart`](#signinstart) |

### `DELETE /api/v1/connections/:id/signin`

Signs a connection's provider out: its tokens are forgotten.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | nothing (204) |

### `POST /api/v1/connections/:id/signin/cancel`

Cancels a sign-in's open flow; nothing of it is kept.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `id` |
| Query | none |
| Body | `{ flow: string }` |
| Reply | nothing (204) |

### `POST /api/v1/connections/:id/signin/finish`

Finishes a sign-in with what the user pasted back, and says how it stands; the token is kept by the model layer and never answered.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `id` |
| Query | none |
| Body | `{ flow: string; code: string }` |
| Reply | [`SignInState`](#signinstate) |
| Long | over TCP it answers at once, status 202, with `{ answer: <id> }`, and its reply is read from `GET /api/v1/answers/:id` once ready |

### `POST /api/v1/connections/:id/test`

Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Query | none |
| Body | none |
| Reply | [`ConnectionTested`](#connectiontested) |

## Settings

### `GET /api/v1/settings`

Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, the level and file it comes from, when a change takes effect and what it does.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | `chat` (may be left out): `string`, The chat whose levels are read; left out or empty, the levels every chat shares |
| Body | none |
| Reply | [`SettingsReply`](#settingsreply) |

### `PUT /api/v1/settings`

Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`SettingsWrite`](#settingswrite) |
| Reply | [`SettingsReply`](#settingsreply) |

## Worlds

### `POST /api/v1/build`

Tunnel for the previous build's messages: Build's page sends one of today's messages as it sends it to the extension's backend, and is answered with today's answer and the pushes the request caused.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`FrontendToBackend`](#frontendtobackend) |
| Reply | [`BuildTunnelReply`](#buildtunnelreply) |

## Migration

### `GET /api/v1/migration`

The Migration page's data: the last run's report and its printed text, each chat's check, the backup, what waits on the user, and the steps of going back.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`MigrationReply`](#migrationreply) |

## Service

### `GET /api/v1/answers/:id`

The answer of a request to a long route, by the id it was answered with: the same 202 and id while its work runs, then the route's own answer, once.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | `id` |
| Answers | 202 with `{ answer: <id> }` while the work runs; then the route's own status and body, once; 404 for an id RPE does not hold |

### `GET /api/v1/backups`

Every copy of the database taken before a migration, every archive rpe backup made in the data folder, and every backup the migration took, with its kind, size and date; RPE removes none but the copies past database.copiesKept.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`BackupsReply`](#backupsreply) |

### `GET /api/v1/command/busy`

How many turns and jobs run now: what a later `rpe up` waits to be none before it restarts RPE's service.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`Busy`](#busy) |

### `POST /api/v1/command/keys`

Makes a new key of a kind, which retires the one before it; shown this once.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`KeyAsk`](#keyask) |
| Reply | [`KeyMade`](#keymade) |

### `POST /api/v1/command/keys/taken`

Takes over the provider key today's connection holds, by its hash alone.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`TakenKeyAsk`](#takenkeyask) |
| Reply | nothing (204) |

### `PUT /api/v1/command/lumiverse`

Keeps RPE's sign-in to Lumiverse and the config's Lumiverse block.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | [`LumiverseSave`](#lumiversesave) |
| Reply | nothing (204) |

### `GET /api/v1/command/status`

The keys in force, the switches and the builds, for `rpe status`.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`CommandStatus`](#commandstatus) |

### `PUT /api/v1/command/switches/:name`

Switches a thing that runs a command or calls out on or off: the one road to it.

| | |
|---|---|
| Access | command: the server's own command line, on its socket in the data folder that only the owner's account may open; never on the TCP listener, so no page reaches it |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | `name` |
| Query | none |
| Body | [`SwitchAsk`](#switchask) |
| Reply | [`Switched`](#switched) |

### `POST /api/v1/ext/arrived`

The extension's word that a new app file has arrived, with the hash stated for it: RPE reads the source it was set up from, takes the build only when every file matches, starts it for real, and swaps onto it once no turn or job runs. A word with no stated hash is not taken.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | `{ hash?: string }` |
| Reply | [`Arrived`](#arrived) |

### `POST /api/v1/ext/confirm`

The extension asks whether the registration it holds is the one this RPE made.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Answers | JSON: `{ rpe: "confirmed", user, relay }`, or 409 for a registration this RPE did not make |

### `POST /api/v1/ext/live`

A page's follow of a chat's live events, carried by the extension to RPE's relay.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Answers | JSON: an empty object, or 400 for a follow RPE does not read |

### `POST /api/v1/ext/question`

The extension's question for a prompt it is about to send: which of its lore entries and messages RPE keeps, by its window and its secrecy rules.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | at most 8 MiB |
| Params | none |
| Answers | JSON, the extension's own message (`src/adapter/lumiverse/wire.ts`) |

### `POST /api/v1/ext/start`

A page's start-up facts, asked for by the extension: a page token for the user this RPE belongs to, its end, RPE's addresses a browser may try, and its build.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Answers | JSON: the page's start-up facts (`StartFacts`, `src/adapter/lumiverse/pipe-wire.ts`) |

### `POST /api/v1/ext/stopped`

The extension's record of a generation it stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read.

| | |
|---|---|
| Access | extension: the light extension (its registration key) |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Answers | JSON: `{ kept: true }`, or 400 for a record the extension does not send |

### `POST /api/v1/signin/end`

Signs out: ends the session the call came with, so it opens nothing more, and the Lumiverse session the caller names, through the door to Lumiverse.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | `{ lumiverse?: string }` |
| Reply | nothing (204) |

### `POST /api/v1/signin/lumiverse`

Signs in with a Lumiverse account: a username and password, or a Lumiverse session the caller holds. RPE checks it against Lumiverse and accepts it only for the user it belongs to; it keeps no password. The answer is a session.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | `{ client?: "web shell" | "command line" | "mcp server"; username?: string; password?: string; session?: string }` |
| Reply | [`Session`](#session) |

### `POST /api/v1/signin/session`

Trades the web app's printed token for a session, or a session that is still in time for a new one before it ends; the session says which client asked for it (the web shell where none is named).

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | the server's `server.bodyBytes` (1 MiB as shipped) |
| Params | none |
| Query | none |
| Body | `{ client?: "web shell" | "command line" | "mcp server" }` |
| Reply | [`Session`](#session) |

### `GET /api/v1/status`

Says that RPE answers here, and its build; nothing more, and no work to say it.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`Status`](#status) |

### `GET /api/v1/status/builds`

When RPE started, and the builds that meet at it, its app file read again.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`BuildsReply`](#buildsreply) |

### `GET /api/v1/status/extension`

How RPE's extension in Lumiverse last said it stands with RPE.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`ExtensionStatusReply`](#extensionstatusreply) |

### `GET /api/v1/status/proof`

Proves to a page that this is the RPE that holds its page token, before the page sends it the token: a keyed hash of the page's nonce.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | takes no body |
| Params | none |
| Query | `id`: `string`, The first 8 hexadecimal characters of the SHA-256 of the page's token<br>`nonce`: `string`, The page's own nonce: 16 to 64 hexadecimal characters |
| Body | none |
| Reply | [`PageProof`](#pageproof) |

### `GET /api/v1/status/session`

Whose the page's credential is, and when it ends.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`SessionReply`](#sessionreply) |

### `GET /api/v1/switches`

Every thing that runs a command or calls out that the page's own user has listed, and whether it waits, is on or is off, with what it runs or calls, or the address its connection's key would go to. Only rpe allow and rpe deny on the server switch one; no page can.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`SwitchesShown`](#switchesshown) |

### `POST /api/v1/update`

"Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Query | none |
| Body | none |
| Reply | [`BuildsStatus`](#buildsstatus) |

## The live socket

### `GET /api/v1/live`

The live socket: a page follows chats on it (and ~jobs, ~user, or an address RPE gave it), and is sent each one's events in order (the live kinds), held to the token it opened with.

| | |
|---|---|
| Access | page: a page of the Lumiverse user this RPE belongs to (a page token or the web UI's token), or the server's own command line on its socket |
| Body limit | takes no body |
| Params | none |
| Answers | a WebSocket on the protocol rpe.live; 426 when the request is not a socket's, 400 when it offers protocols and not rpe.live |

## The web UI

### `GET /ui/*`

The web app's files, to anyone who reaches RPE; what a page then does is held to its own token by the API.

| | |
|---|---|
| Access | public: anyone who reaches RPE |
| Body limit | takes no body |
| Params | `*` (the rest of the path) |
| Answers | a file of the built web app (its page, scripts and styles), or 404 with words saying why there is none |

## The live socket's kinds

What a page following a chat on `/api/v1/live` is sent: each event is `{ chat, seq, kind, key?, at, data }`, numbered from 1 per chat, and `data` is what its kind carries.

| Kind | Carries | What it says |
|---|---|---|
| `trace` | [`TraceRecord`](#tracerecord) | A record of RPH's trace, for a run played in the chat: every event of the run, as RPH gave it. |
| `delta` | [`TraceDelta`](#tracedelta) | A piece of a model call's text as it streams, for the live view; the call's call_ended record holds it whole. |
| `reply` | [`ReplyPiece`](#replypiece) | What went to the chat as the reply was written: its text, and the progress lines of its thinking block. |
| `released` | [`ReplyReleased`](#replyreleased) | A run's reply began to go out to the chat (its first text, or the harness's release, whichever came first), told at that moment while the run may go on. |
| `state` | `Record<string, never>` | The chat's state changed, and a page reads it again. A newer one replaces one a page has not taken yet. |
| `handler_failed` | `{ op: string; error: string; turn: string; change: number | null }` | An engine handler failed on a change of this chat, which is recorded as not applied: the operation, the handler's error, the turn and the change (null for one never kept). |
| `requests` | `{ waiting: number }` | What waits in the chat, asked for beside the player's words, changed: how many requests wait now; a page reads them again. |
| `extension` | [`ExtensionStatusReply`](#extensionstatusreply) | The extension's status changed: as GET /api/v1/status/extension answers it. |

## The live socket's messages

A page opens `/api/v1/live` as a WebSocket, offering the protocol `rpe.live`. A page that cannot set the Authorization header offers its token as a second protocol: `rpe.token.` and then the token. Every message, either way, is JSON. Besides chats, a page follows `~jobs` (the user's jobs, in every chat and in none), `~user` (what concerns the user and no one chat) and `~to:` with an address RPE gave its caller.

| | |
|---|---|
| A page sends | [`LiveAsk`](#liveask) |
| A page is sent | [`LiveMessage`](#livemessage) |
| A chat's events, as the relay hands them on | [`LiveBatch`](#livebatch) |
| Closed | with the code 4401 and the reason "The page's token has run out or was replaced: open the live socket again with a new one.", once the token it opened with has run out or been replaced |

## Types

Every type a route, a live kind or the live socket's messages name, as the generated types write it. `JsonValue` is any JSON value.

### `AgentRef`

One agent of a run: its handle, its definition, the agent that started it, its job, and the character it plays.

```ts
export interface AgentRef {
  id: string;
  definition: string;
  parent?: string;
  job?: string;
  plays?: string;
}
```

### `ApplyNowAsk`

The chat whose open session starts its opening block afresh.

```ts
export interface ApplyNowAsk {
  chat: string;
}
```

### `ApplyNowReply`

What "Apply now" did: the session whose opening block starts afresh with the next run of each agent, or none when no session is open, and what that means in words.

```ts
export interface ApplyNowReply {
  session: string | null;
  note: string;
}
```

### `Arrived`

Whether RPE took the build, and where it stands, in words.

```ts
export interface Arrived {
  /** Whether RPE took the build: every file matched, and it started. */
  taken: boolean;
  /** Where the builds stand, in a sentence or two, with why a build was not taken. */
  words: string;
}
```

### `BackupShown`

A file of the backups folder: its name, its kind (a copy of the database taken before a new version's migrations, an archive `rpe backup` made, or the migration's backup of today's data), its size and when it was made.

```ts
export interface BackupShown {
  name: string;
  kind: "copy" | "migration" | "archive";
  bytes: number;
  at: number;
}
```

### `BackupsReply`

The backups folder's files, newest first, and where the folder is.

```ts
export interface BackupsReply {
  folder: string;
  items: BackupShown[];
}
```

### `BaseDocument`

The base's four documents.

```ts
export type BaseDocument = "seed" | "soul" | "inner_voice" | "background";
```

### `BaseVersionRow`

A version of a part of the base; `standing` marks the one in force (it stands outside turns: a swipe changes none of it).

```ts
export interface BaseVersionRow {
  part: BaseDocument;
  version: number;
  text: string;
  /** The newest version of its part: the one in force. */
  standing: boolean;
  /** The turn it was written in; null when written outside one. */
  turn: TurnId | null;
  by: string | null;
  created: number;
}
```

### `BootstrapBatchAsk`

The chats to start the bootstrap job for, one after another: a list of chat ids, or "migrated" for every chat the last migration carried; and the player's choice of what to relive.

```ts
export interface BootstrapBatchAsk {
  chats: "migrated" | string[];
  /** The player's choice of what to relive: one of the words the bootstrap skill offers for reliving the past; left out or null, none was made. */
  relive?: string | null;
}
```

### `BootstrapBatchReply`

What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why.

```ts
export interface BootstrapBatchReply {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}
```

### `BootstrapChatReply`

A chat's bootstrap: the six facts, and the chat's bootstrap jobs, oldest first.

```ts
export interface BootstrapChatReply {
  chat: string;
  facts: DoneEnoughShown;
  jobs: BootstrapJobShown[];
}
```

### `BootstrapJobShown`

A bootstrap job of a chat: what it was given (the player's relive word, the token limit), and its view as RPH gives it (null: RPH no longer holds it).

```ts
export interface BootstrapJobShown {
  id: string;
  relive: string | null;
  tokenLimit: number;
  view: JobView | null;
}
```

### `BootstrapStartAsk`

What starts a chat's bootstrap job: the player's choice of what to relive, where one was made.

```ts
export interface BootstrapStartAsk {
  /** The player's choice of what to relive: one of the words the bootstrap skill offers for reliving the past; left out or null, none was made. */
  relive?: string | null;
}
```

### `BuildsReply`

When RPE started (epoch milliseconds), and the builds that meet at it.

```ts
export interface BuildsReply {
  name: "rpe";
  version: string;
  started: number;
  builds: BuildsStatus;
}
```

### `BuildsStatus`

The builds that meet at RPE, as its builds route and "Update now" give them.

```ts
export interface BuildsStatus {
  /** The build this process runs. */
  running: string;
  /** The build of the app file on disk; null where there is no file, or it gives none. */
  disk: string | null;
  /** Why the file on disk gave no build: it is not there, does not start, or says something else. */
  broken: string | null;
  /** The extension's build as it said at its last registration; null before it has. */
  extension: string | null;
  /** Every build known is the running one, and the file on disk starts. */
  agree: boolean;
  restart: RestartState;
  /** All of it in a sentence or two, as `rpe status` prints it. */
  words: string;
}
```

### `BuildTunnelReply`

Today's answer to the message, and the pushes the request caused.

```ts
export interface BuildTunnelReply {
  result: ResultMessage | ErrorMessage;
  pushes: DraftChanged[];
}
```

### `Busy`

The turns and jobs running now.

```ts
export interface Busy {
  /** How many turns and jobs run now. */
  busy: number;
}
```

### `CallPermission`

The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call.

```ts
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}
```

### `CallRefusal`

Why a tool call never ran: a limit spent before it started, past the most tool calls one answer of its agent may make, the thing it calls out to not switched on for the user, its lane set to Never, the user's no with his reason, a rule that held it, or a permission or rule that could not be asked.

```ts
export type CallRefusal = { by: "limit"; hit: LimitHit } | { by: "answer"; max: number } | { by: "switch"; thing: { kind: "hook" | "rule-command" | "command-tool" | "mcp-server" | "http-tool" | "connection"; name: string; target: string }; state: "on" | "waiting" | "off" } | { by: "never"; lane: string } | { by: "declined"; lane: string; reason?: string } | { by: "hold"; rule: string } | { by: "unasked"; error: string };
```

### `CastingRow`

A casting in force: the player's pin, else the Author's; with the Author's line for the character, where it wrote one.

```ts
export interface CastingRow {
  as: CastRole;
  /** The player pinned it; it stands over the Author's. */
  pinned: boolean;
  line: string | null;
}
```

### `CastMemberRow`

A character as the cast lists it: its casting (null: none yet), where its record came from (carried by a migration, played on RPE), and its counts.

```ts
export interface CastMemberRow {
  id: string;
  name: string;
  /** The chat it was first cast in: this chat, or one this chat was branched from. */
  chat: string;
  /** Its casting at the reading; null when it has none there (in the cast, not yet cast). */
  casting: CastingRow | null;
  /** Where its record on the path came from: writes on turns a migration's import wrote (carried), and writes on turns RPE played. */
  from: { carried: boolean; played: boolean };
  counts: EntryCounts;
}
```

### `CastReply`

Every character the chat knows, with what each holds on the path read; `turn` null: at the chat's newest.

```ts
export interface CastReply {
  chat: string;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  /** In the order they were made: this chat's, and those of the chats it was branched from. */
  characters: CastMemberRow[];
}
```

### `CastRole`

How large a part a character plays.

```ts
export type CastRole = "principal" | "supporting" | "extra";
```

### `CastStrikeAsk`

An entry of the character's record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says.

```ts
export interface CastStrikeAsk {
  id: string;
  struck: boolean;
  why?: string | null;
}
```

### `CastStrikeReply`

What a strike, or taking one back, did: whether anything was recorded, the entry now, the knowledge struck with it, the secrets let go; for a strike taken back, the knowledge standing again with it and the secrets held again; and what it could not do, in the cast's words.

```ts
export interface CastStrikeReply {
  /** Whether anything was recorded: false when the entry already stood so. */
  changed: boolean;
  /** The entry as it stands now, at the chat's newest turn. */
  entry: EntryRow;
  /** The knowledge a struck perception gave, struck with it, by id. */
  alsoStruck: string[];
  /** The secrets whose holding the strike took back, by their fact's id. */
  letGo: string[];
  /** A perception's strike taken back: the knowledge its strike struck with it, standing again with it, by id. */
  alsoStood: string[];
  /** A strike taken back: the secrets the knowledge standing again gives, held again, by their fact's id. */
  heldAgain: string[];
  /** What it could not do, and what it left as it was (knowledge struck apart, and the secret it gave), in the cast's words. */
  notes: string[];
}
```

### `CharacterReply`

Everything on one character's record, by kind; `turn` null: at the chat's newest.

```ts
export interface CharacterReply {
  chat: string;
  turn: TurnId | null;
  character: CastMemberRow;
  sources: SourceBindingRow[];
  /** Every version of every part of the base, oldest first. */
  base: BaseVersionRow[];
  /** The Author's castings of it on the path, oldest first. */
  castings: EntryWriteRow[];
  growth: EntryRow[];
  /** What is on its mind; the carried mind files are under `files`. */
  mind: EntryRow[];
  memories: MemoryRow[];
  relationships: EntryRow[];
  knowledge: EntryRow[];
  history: EntryRow[];
  perceptions: PerceptionRow[];
  files: MindFileRow[];
}
```

### `ChatImportOutcome`

What came of a chat the last run looked at, in the run's own words.

```ts
export type ChatImportOutcome = "imported" | "replaced" | "played on RPE: left alone" | "a chat made from it was played on RPE: left alone" | "gone from Lumiverse: removed" | "gone from Lumiverse, played on RPE: left alone" | "gone from Lumiverse, a chat made from it was played on RPE: left alone" | "not imported";
```

### `ChatMessageShown`

A message of a chat as Lumiverse holds it: its place (`index_in_chat`, with a gap where one was deleted), who said it, the text the prompt is built from, the swipe it shows, whether it is hidden, and Lumiverse's revision of it.

```ts
export interface ChatMessageShown {
  /** Lumiverse's id of the message. */
  id: string;
  /** Its chat's id. */
  chat: string;
  /** Lumiverse's `index_in_chat`: a gap where a message was deleted. */
  index: number;
  /** Who said it. */
  role: "user" | "assistant" | "system";
  /** The name it was said under. */
  name: string;
  /** The text the prompt is built from. */
  text: string;
  /** The swipe it shows. */
  swipe: number;
  /** How many swipes it has. */
  swipes: number;
  /** Hidden from the prompt. */
  hidden: boolean;
  /** When it was sent, epoch milliseconds. */
  sentAt: number;
  /** Lumiverse's revision of it: an edit raises it. */
  revision: number;
}
```

### `ChatMessagesReply`

The messages of a chat asked for, in the chat's order.

```ts
export interface ChatMessagesReply {
  messages: ChatMessageShown[];
}
```

### `ChatRow`

A chat RPE plays, as the web shell lists them.

```ts
export interface ChatRow {
  id: string;
  /** The chat's name in Lumiverse. */
  name: string;
  /** When its newest turn on RPE began; null for a chat RPE holds and has not played yet (one a migration imported). */
  lastTurnAt: number | null;
  /** Whether a turn of it runs now. */
  running: boolean;
  /** Whether RPE has played a turn of it. */
  played: boolean;
  /** Whether RPE's store has a world for it. */
  world: boolean;
}
```

### `ChatsReply`

The chats of the user RPE belongs to, the most recently played first, then those its store holds that it has not played.

```ts
export interface ChatsReply {
  chats: ChatRow[];
}
```

### `ChatStorageRow`

What a chat's folder takes in all, and by area: its notes, its turn folders, its sessions' own files, and the rest of its files.

```ts
export interface ChatStorageRow {
  chat: string;
  /** Its folder below the tree's `chats/`. */
  folder: string;
  bytes: number;
  areas: { notes: number; turns: number; sessions: number; files: number };
  /** When RPE heard that Lumiverse deleted the chat, epoch milliseconds; its session files are gone and its other files stay until he prunes them. */
  deleted?: number | null;
  /** What the chat's rows take of the database, by the length of its rows in every table that carries the chat. */
  rows?: number;
  /** When the sizes were last checked against the disk, epoch milliseconds; null for a chat not measured yet, whose sizes are then none and come at the next read. */
  measured?: number | null;
}
```

### `CheckStoppedShown`

A generation RPE's extension stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read.

```ts
export interface CheckStoppedShown {
  /** When, epoch milliseconds by the extension's clock. */
  at: number;
  chat: string;
  /** The generation; null where Lumiverse had not announced it. */
  generation: string | null;
  connection: string;
  /** How the read of RPE's registration from the extension's storage failed. */
  registration: string;
  /** How the read of the connection's own record in Lumiverse failed. */
  mark: string;
}
```

### `CommandStatus`

How RPE stands as its own command line is told: the keys in force, the switches and the builds in words.

```ts
export interface CommandStatus {
  /** Each key in force: the provider key by its last four characters (null for one taken from today's connection, whose were never known), when it was made and, for the web token, when it ends; never a key's text. */
  keys: ({ kind: "provider" | "extension" | "web"; last4: string | null; made: number; ends: number | null; taken: boolean })[];
  /** Every user's own switches, each name's newest definition. */
  switches: SwitchEntry[];
  /** The builds that meet at RPE in a sentence or two; null where the server does not say. */
  builds: string | null;
}
```

### `ConnectionAuth`

How a connection signs its calls: with its own key, with the sign-in to its provider, or with nothing.

```ts
export type ConnectionAuth = "key" | "signin" | "none";
```

### `ConnectionInput`

A connection to save, whole: with the id of one that exists it replaces that one, and a field left out (or null) is cleared; headers left out keep the stored ones.

```ts
export interface ConnectionInput {
  id?: string;
  name: string;
  provider: string;
  auth: ConnectionAuth;
  baseUrl?: string | null;
  api?: string | null;
  model?: string | null;
  effort?: Effort | null;
  /** Exactly these headers, a text setting a value and null keeping the stored one; null takes them all away. */
  headers?: { [key: string]: string | null } | null;
  serialTools?: boolean | null;
  messageThreads?: boolean | null;
  retries?: number | null;
  /** The user's limits for its models, by model id; null clears them. */
  limits?: { [key: string]: ModelLimitsEntry } | null;
}
```

### `ConnectionShown`

A connection as the routes show it: whether a key is set and nothing of the key; its model's limits as RPH uses them, null where nobody knows them; and why they could not be read, where they could not.

```ts
export interface ConnectionShown {
  id: string;
  name: string;
  /** The provider kind the layer offers (anthropic, deepseek, openai-compatible, …). */
  provider: string;
  auth: ConnectionAuth;
  /** Where its calls go instead of the provider's own address. */
  baseUrl?: string;
  /** The API a compatible server speaks, where it may speak more than one. */
  api?: string;
  /** Its model, for an agent whose definition names none. */
  model?: string;
  /** Its own effort, for an agent that names none. */
  effort?: Effort;
  /** It takes one tool call per answer. */
  serialTools?: true;
  /** Message threads are on. */
  messageThreads?: true;
  /** How many times a call that failed before any answer arrived is tried again; 2 when absent. */
  retries?: number;
  /** What the user entered as each model's limits, by model id. */
  limits?: { [key: string]: ModelLimitsEntry };
  /** What the connection's server reported as each model's limits, by model id. */
  reported?: { [key: string]: ModelLimitsEntry };
  /** Its headers by name, and whether each has a value; never a value. */
  headers?: { name: string; set: boolean }[];
  default: boolean;
  /** For a connection that signs in: whether the sign-in holds. */
  signedIn?: boolean;
  key: { set: boolean; waiting?: boolean } | null;
  limitsInForce: ModelLimits | null;
  /** Why its model's limits could not be read; null where they were read, each of them known or not. */
  limitsProblem?: string | null;
}
```

### `ConnectionsShown`

The connections as shown, the default, and the providers offered.

```ts
export interface ConnectionsShown {
  connections: ConnectionShown[];
  default: string | null;
  providers: ProviderOffer[];
}
```

### `ConnectionTested`

A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them, or why they could not be read.

```ts
export type ConnectionTested = { ok: true; ms: number; model: string; limits: ModelLimits | null; limitsProblem?: string | null } | { ok: false; ms: number; error: string; limits: ModelLimits | null };
```

### `ConsentGrant`

Something the lead allowed to be invented (plan §10.5): who allowed it, for whom, how (its own write, or its answer to a sub-agent), what, within what bounds, and the gap check it rests on.

```ts
export interface ConsentGrant {
  id: string;
  by: AgentRef;
  to?: AgentRef;
  via: { kind: "write"; tool: string; callId: string } | { kind: "answer"; callId: string };
  topic: string;
  bounds?: string;
  /** The gap check it rests on; absent when none was cited. */
  gapCheck?: string;
}
```

### `DiffRow`

One line of a difference between two texts: in both, only in the second, or only in the first.

```ts
export interface DiffRow {
  op: "same" | "added" | "removed";
  text: string;
}
```

### `DoneEnoughShown`

The six facts of "done enough", in the order the bootstrap skill names them: the lore index, the history the window leaves out, the cast, the story model, the horizon, and each principal's base and memories.

```ts
export interface DoneEnoughShown {
  lore: { known: true; entries: number; indexed: number; stale: number } | FactNotKnown;
  history: { known: true; messages: number; leftOut: number; covered: number; stretches: number; summarized: number; nearestUncovered: MessageStretch | null; nearestUnsummarized: MessageStretch | null } | FactNotKnown;
  cast: { known: true; listed: number; cast: number; uncast: string[] } | FactNotKnown;
  story: { known: true; premise: number; chapters: number; scenes: number; beats: number; threads: number; openThreads: number; arcs: number; principals: number; principalsWithArc: number; player: number } | FactNotKnown;
  horizon: { known: true; entries: number; named: number; clock: boolean } | FactNotKnown;
  principals: { known: true; principals: { id: string; name: string; base: string[]; memories: number }[] } | FactNotKnown;
}
```

### `DueReply`

What a turn's time brought due, soonest first, as many as the chat's engine.dueItems lists, and how many more fell due (null: more did, uncounted).

```ts
export interface DueReply {
  turn: TurnId;
  /** The turn's span as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
  more: number | null;
}
```

### `DueShown`

One thing a turn's time brought due: its kind, what it is, when it fell due as the world prints it, the level it concerns (null where none), and the turn's changes recorded for it (null while none were).

```ts
export interface DueShown {
  kind: string;
  words: string;
  when: string;
  at: string | null;
  outcome: string | null;
}
```

### `EditOpAsk`

One field of the World page's edit: a value or a fact at a level (world, place:<id>, entity:<id>), set or removed, with how exact and how sure he says a fact is.

```ts
export interface EditOpAsk {
  op: "set" | "remove";
  at: string;
  key: string;
  as: "value" | "fact";
  value?: string;
  precision?: "exact" | "approximate" | "vague" | "unknown";
  standing?: "established" | "proposed" | "assumed";
}
```

### `Effect`

When a change to a setting is in force: at its next use, from the next turn, or from RPE's next start.

```ts
export type Effect = "use" | "turn" | "start";
```

### `Effort`

How hard a model reasons on a call.

```ts
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
```

### `EntryCount`

How many entries of a kind a character holds on the path read: standing, and struck.

```ts
export interface EntryCount {
  held: number;
  struck: number;
}
```

### `EntryCounts`

Each kind's counts; the carried mind files with how many of those standing are marked filed.

```ts
export interface EntryCounts {
  growth: EntryCount;
  mind: EntryCount;
  memories: EntryCount;
  relationships: EntryCount;
  knowledge: EntryCount;
  history: EntryCount;
  perceptions: EntryCount;
  files: { held: number; struck: number; filed: number };
}
```

### `EntryPart`

The parts of a character's record kept as rows tied to turns, the casting aside.

```ts
export type EntryPart = "growth" | "mind" | "relationship" | "knowledge" | "history" | "perception" | "memory";
```

### `EntryRow`

An entry of a character's record as it stands on the path read: its fields, story time of its first write, its first write, whether it is struck, and every write of it.

```ts
export interface EntryRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
}
```

### `EntryWriteRow`

One write of an entry, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said.

```ts
export interface EntryWriteRow {
  turn: TurnId;
  /** The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind). */
  message: number | null;
  /** That turn was written by a migration's import, not played on RPE. */
  imported: boolean;
  /** Who wrote it: an agent's definition (`author`, a character's own), `player`, or the migration. */
  by: string | null;
  /** What it said: the fields it set, `drop` among them. */
  wrote: { [key: string]: JsonValue };
}
```

### `ExtensionStatusReply`

How RPE's extension in Lumiverse last said it stands with RPE: whether it holds RPE's registration, why it does not, and the permissions it says it lacks.

```ts
export interface ExtensionStatusReply {
  /** Whether the extension holds RPE's registration, and so marks the replies RPE plays. */
  registered: boolean;
  /** Why it does not, in words a user is shown; null when it does. */
  why: string | null;
  /** The permissions it says it lacks, and why it needs each; null until it has said. */
  missing: MissingPermissionShown[] | null;
  /** The generations it stopped because it could not tell whose chat they were: the latest, and how many since RPE started; null when none. */
  stopped: { last: CheckStoppedShown; count: number } | null;
}
```

### `FactNotKnown`

A fact of "done enough" that could not be read, and why, as a code: `unreadable`, its records could not be read (RPE's log has what failed).

```ts
export interface FactNotKnown {
  known: false;
  why: "unreadable";
}
```

### `FactPrecision`

How exact a value or a fact is.

```ts
export type FactPrecision = "exact" | "approximate" | "vague" | "unknown";
```

### `FactSource`

Where a value or a fact came from.

```ts
export type FactSource = "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented";
```

### `FactStanding`

How sure a value or a fact is.

```ts
export type FactStanding = "established" | "proposed" | "assumed";
```

### `FileMoveAsk`

A file or folder of the user's to rename, move or copy: its path in the chat's view, and the path it goes to, which nothing stands at; a chat's level names the chat.

```ts
export interface FileMoveAsk {
  chat?: string | null;
  from: string;
  to: string;
}
```

### `FileMovedReply`

Where a file or folder went: its path, the file as the listing now shows it (none for a folder), and the kind of guidance it now is when it went into a folder of one.

```ts
export interface FileMovedReply {
  path: string;
  file: TreeFileRow | null;
  /** The kind of guidance the place is a folder of: a file moved into `rules/` is a rule; null for any other. */
  guidance: GuidanceKind | null;
}
```

### `FilePinAsk`

A file pinned for an agent, or the pin taken away, in the `pins:` list of a level's config: the global level's, or a chat's, which names the chat.

```ts
export interface FilePinAsk {
  level: "global" | "chat";
  chat?: string | null;
  /** The agent, by its definition's name. */
  agent: string;
  pinned: boolean;
}
```

### `FilePins`

Every pin the levels' configs hold for a chat, the file and the agent each names, with whether the file is in the chat's view now and whether a definition names the agent: a pin of a file that is gone or of an agent no definition names is listed as such, never dropped.

```ts
export interface FilePins {
  pins: ({ file: string; agent: string; level: LayerLevel; fileFound: boolean; agentNamed: boolean | null })[];
}
```

### `FileReply`

One file of a turn's folder, by its path below the folder, as text.

```ts
export interface FileReply {
  name: string;
  text: string;
}
```

### `FileSwitchAsk`

A file's name switched off or on again in the `off:` list of a level's config: the global level's, or a chat's, which names the chat.

```ts
export interface FileSwitchAsk {
  level: "global" | "chat";
  chat?: string | null;
  off: boolean;
}
```

### `FileWriteAsk`

The whole text of a file, written as the user at a level (for a file of another level, the user's own file of its name there); a chat's level names the chat.

```ts
export interface FileWriteAsk {
  level: LayerLevel;
  chat?: string | null;
  text: string;
}
```

### `FileWrittenReply`

What writing a file or switching its name answers: the file as the listing now shows it.

```ts
export interface FileWrittenReply {
  file: TreeFileRow | null;
}
```

### `FindStopped`

Why the file host stopped before it had looked everywhere, each way it did with its counts: at the cap on hits with more there, past files too large to search, at lines cut to a length, or out of time.

```ts
export interface FindStopped {
  /** The hits reached `max`, the host's own cap, and more were there. */
  limit?: { max: number };
  /** A search passed over `files` files larger than `bytes` bytes. */
  large?: { files: number; bytes: number };
  /** A search cut `lines` of the lines it gave to `chars` characters each. */
  cut?: { lines: number; chars: number };
  /** It ran out of the `ms` milliseconds it was given. */
  time?: { ms: number };
}
```

### `FoldDifference`

Where RPE's fold of a chat differs from today's: at a swipe (its message and number) or at the chat's head; the values that differ, by path; and whether today's state there is kept as the turn's start.

```ts
export interface FoldDifference {
  at: { message: string; swipe: number } | "head";
  turn: TurnId;
  values: string[];
  kept: boolean;
}
```

### `FolderAsk`

A folder of the user's to make, by its path in the chat's view; a chat's level names the chat.

```ts
export interface FolderAsk {
  chat?: string | null;
  path: string;
}
```

### `FolderEntry`

One entry of a turn's folder: its path below the folder, its size (a folder's is what its files hold), and whether it is a folder.

```ts
export interface FolderEntry {
  name: string;
  bytes: number;
  folder: boolean;
}
```

### `FolderReply`

The whole of a turn's folder, every level down; none for a turn that has no folder. Where the file host stopped short of the whole folder, what it found, and how it stopped.

```ts
export interface FolderReply {
  files: FolderEntry[];
  /** How the file host stopped short of the whole folder; absent when it listed it all. */
  stopped?: FindStopped;
}
```

### `GapCheck`

A gap check run (plan §10.5): who ran it, on what, by which names and words, each place it searched with what came back there, and where its evidence was saved.

```ts
export interface GapCheck {
  id: string;
  by: AgentRef;
  topic: string;
  terms: string[];
  searched: ({ where: string; hits: ({ ref: string; title: string; snippet: string; how: "words" | "meaning" })[] })[];
  saved?: string;
}
```

### `GuidanceKind`

A kind of guidance a folder of the tree holds: the agents' definitions, skills, rules, hooks, prompt parts or tools.

```ts
export type GuidanceKind = "agents" | "skills" | "rules" | "hooks" | "prompts" | "tools";
```

### `HorizonEntryRow`

An entry of the Author's horizon, as the store keeps it: as the Author wrote it, with the level of the world it names now (none: words that name nothing).

```ts
export interface HorizonEntryRow {
  at: string;
  ref: string | null;
  name: string | null;
}
```

### `InstallFact`

One of the install's facts, which the command line sets and no page writes: its key in config.json, what it is, its value, and where it was given (config.json, the environment, or where the install put the data folder).

```ts
export interface InstallFact {
  key: string;
  name: string;
  value: JsonValue;
  from: "config.json" | "environment" | "install";
}
```

### `JobCancelReply`

The job as it stands after the cancel; one that had already ended comes back as it ended.

```ts
export interface JobCancelReply {
  job: JobView;
}
```

### `JobLimits`

Limits of one job's own run, each holding only where it is tighter than the setting's: model calls, tokens sent, tokens written, tokens together as the day's job tokens are counted, seconds, and the tokens at which the job is held and the owner asked whether to go on.

```ts
export interface JobLimits {
  calls?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
  time?: number;
  askAt?: number;
}
```

### `JobsReply`

The user's jobs (of every chat, or of one) as RPH last kept each, the newest started first.

```ts
export interface JobsReply {
  jobs: JobView[];
}
```

### `JobState`

Where a job stands.

```ts
export type JobState = "queued" | "held" | "running" | "asking" | "done" | "failed" | "cancelled" | "off-path" | "interrupted";
```

### `JobToldReply`

What a job he started was told as it went.

```ts
export interface JobToldReply {
  job: string;
  told: TurnTold;
}
```

### `JobView`

A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, the limit it ended at, what its start named and gave, what it was not given, what it wrote, the job it repeats, and where it asks.

```ts
export interface JobView {
  id: string;
  agent: string;
  brief: string;
  state: JobState;
  scope: Scope;
  startedBy: AgentRef | "user";
  started: number;
  ended?: number;
  usage: Usage;
  report?: string;
  limit?: LimitHit;
  /** The attachments its start named, by name. */
  attach?: string[];
  /** The limits of its own its start gave. */
  limits?: JobLimits;
  /** The names in attach nobody could find. */
  missing?: string[];
  /** Each write it made, its sub-agents' included, in order. */
  wrote?: JobWrite[];
  /** For a job the owner started again: the job it repeats. */
  repeats?: string;
  /** For a job that asks: the ask point it reached, and the tokens it had spent when it did. */
  asks?: { at: number; tokens: number };
}
```

### `JobWrite`

A write a job made: the tool, the lane it writes to where it names one, and the first line of the tool's own answer.

```ts
export interface JobWrite {
  tool: string;
  lane?: string;
  line: string;
}
```

### `JoinedAnswer`

What a route that takes a turn's id answers, with status 409, for a turn that was joined to another: the turn asked for and the turn it joined, which is the one to ask for.

```ts
export interface JoinedAnswer {
  joined: { turn: TurnId; joined: TurnId };
}
```

### `KeptFor`

How long a kind is kept: for good, until the chat is deleted or he prunes it, or by a setting, which gives its key and what it is now (null: none, all kept).

```ts
export type KeptFor = { by: "never" } | { by: "chat" } | { by: "setting"; setting: string; value: number | null };
```

### `KeptMessage`

One message of a model call's request as it was sent: its role, its text, and the block the harness placed it as (`opening`, `frame`, `prompt`, `session:carry`, `briefing`, a given name, `brief`); none for the run's own conversation.

```ts
export interface KeptMessage {
  role: string;
  text: string;
  /** The block it was placed as; absent for the run's own conversation. */
  block?: string;
}
```

### `KeyAsk`

A new key of a kind, shown once; with `key`, the text of a key the caller made, which Lumiverse had to hold before RPE did.

```ts
export interface KeyAsk {
  /** Which key. */
  kind: "provider" | "web";
  /** The key's own text, in the form its kind's keys have. */
  key?: string;
}
```

### `KeyMade`

A key as it was made: shown this once, and kept only as its hash.

```ts
export interface KeyMade {
  /** Which key. */
  kind: "provider" | "web";
  /** The key itself. */
  key: string;
  /** When it was made, epoch milliseconds. */
  made: number;
  /** When it runs out, epoch milliseconds; null: it has no end. */
  ends: number | null;
}
```

### `LayerLevel`

A level of the agents' tree: what ships, the user's own, a character's, a chat's.

```ts
export type LayerLevel = "shipped" | "global" | "character" | "chat";
```

### `LevelFact`

A plain statement recorded about a level, with how exact and how sure it is and where it came from; never merged into the level's values.

```ts
export interface LevelFact {
  id: string;
  about: string;
  key: string;
  value: string;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  source: FactSource | null;
  by: string | null;
  turn: TurnId;
  n: number;
  replacedBy?: string;
  replacedAt?: number;
}
```

### `LevelKind`

What a level of the world's tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere).

```ts
export type LevelKind = "world" | "place" | "entity" | "groups" | "elsewhere";
```

### `LevelMark`

The change that last wrote a value: its turn, by id and by its number on the chat's path, and how exact, how sure and from where.

```ts
export interface LevelMark {
  turn: TurnId;
  n: number;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  source: FactSource | null;
}
```

### `LevelNode`

A level of the world's tree as the world route shows it.

```ts
export interface LevelNode {
  ref: string;
  kind: LevelKind;
  /** Its name in the data; null for the groups and for what is elsewhere. */
  name: string | null;
  /** An entity's kind, by its label; null for any other level. */
  what: string | null;
  reflection: LevelReflection;
  values: LevelValue[];
  facts: LevelFact[];
  children: string[];
  parent: string | null;
}
```

### `LevelReflection`

What is beneath a level, made from recorded values.

```ts
export interface LevelReflection {
  people: number;
  things: number;
  places: number;
  groups: number;
  records: number;
  notable: string[];
  open: number;
  /** The number of the last turn that changed something there. */
  changed: number | null;
  /** An agent's own line on the level. */
  note: string | null;
}
```

### `LevelValue`

One value of a level: its key, its value as text (null: none), where it comes from when it is not the level's own (a game system that keeps it, or the level above that sets it), and the change that last wrote it.

```ts
export interface LevelValue {
  key: string;
  value: string | null;
  from?: { system?: string; ref?: string; name?: string };
  mark?: LevelMark;
}
```

### `LimitHit`

A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs or its throttle.

```ts
export interface LimitHit {
  limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "depth" | "agents" | "jobs" | "callTokensIn" | "callTokensOut" | "callTime" | "toolRounds" | "repeats" | "tokensPerMinute";
  per: "turn" | "agent" | "job" | "day" | "connection";
  max: number;
  value: number;
  agent?: AgentRef;
  connection?: string;
}
```

### `LiveAsk`

What a page sends on the live socket: to follow a chat's events from its next one, or to stop; in `chat`, a chat's id, or ~jobs for the user's jobs, ~user for his own events, or ~to: and an address RPE gave the caller.

```ts
export interface LiveAsk {
  op: "follow" | "unfollow";
  chat: string;
}
```

### `LiveBatch`

A chat's events in order, and the numbers of those the hub dropped before them for a page that fell behind: an events message without its type, as the relay hands it on.

```ts
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: LiveMissed;
}
```

### `LiveEvent`

One event as the live socket sends it: of a chat (or of ~jobs, ~user, or an address), numbered from 1 for each, of one of the kinds the socket carries, with that kind's data; an event of a kind declared with a key carries it.

```ts
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "released"; at: number; data: ReplyReleased } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string; turn: string; change: number | null } } | { chat: string; seq: number; kind: "requests"; at: number; data: { waiting: number } } | { chat: string; seq: number; kind: "extension"; at: number; data: ExtensionStatusReply };
```

### `LiveMessage`

What the live socket sends a page: that following a chat (or a name) began, with the number of its last event then; its events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent.

```ts
export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };
```

### `LiveMissed`

The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than liveSocket.queueEvents holds for it.

```ts
export interface LiveMissed {
  from: number;
  to: number;
}
```

### `LocatedSlices`

Where RPH found each slice of the preset's map in a turn's prompt: each slice's marker, kind, places and length; the text that belongs to no slice; the notices of what changed since the turn before; and how much of the prompt's front stayed the same.

```ts
export interface LocatedSlices {
  preset: { id: string; name?: string; revision?: string } | null;
  slices: ({ marker: string; kind: "instructions" | "style" | "character" | "persona" | "world" | "note" | "lore" | "history" | "other"; at: { message: number; start: number; end: number }[]; length: number; hash: string })[];
  unclaimed: { message: number; start: number; end: number }[];
  notices: PromptNotice[];
  /** The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held. */
  front: { length: number; brokenBy?: string };
}
```

### `LoreActivation`

How Lumiverse activated an entry: always on, by one of its keys, by meaning, or still in force from an earlier turn.

```ts
export type LoreActivation = "constant" | "keyword" | "vector" | "sticky";
```

### `LoreBooks`

The user's books as his choice of the books the lore reads lists them.

```ts
export interface LoreBooks {
  /** Every book of his, the engine's own left out. */
  books: ({ id: string; name: string; attached: boolean; character: boolean; added: number | null })[];
}
```

### `LoreIndexJob`

The indexing job the owner started.

```ts
export interface LoreIndexJob {
  /** Its id in the jobs. */
  job: string;
  /** Its state as RPH keeps it. */
  state: string;
}
```

### `LoreIndexRow`

An entry of a chat's lore with what the database holds of it and what the index says of it: the user's own lines where he wrote them, else the latest indexing run's, an earlier revision's marked stale.

```ts
export interface LoreIndexRow {
  /** The id the lore map gives the entry: `e-` or `w-` and its number. */
  id: string;
  /** Its title. */
  title: string;
  /** Its book's name, or its world's. */
  source: string;
  /** Its book's id in Lumiverse; null for a world entry. */
  book: string | null;
  /** The keys that activate it. */
  keys: string[];
  /** Characters in its text. */
  size: number;
  /** How it comes into the prompt by itself; none for one that never does. */
  activation: ("constant" | "keyword" | "vector")[];
  /** Its revision: Lumiverse's for a book entry, a hash of its words for a world entry. */
  revision: string;
  /** What kind of thing it is, where a run or the user has said. */
  kind: string | null;
  /** One line saying what it is, where a run or the user has said. */
  line: string | null;
  /** What it defines. */
  defines: { what: string; aspect: string }[];
  /** Related entries, by id. */
  related: string[];
  /** The fields beside those that the indexer's file asks an index line to hold, by name. */
  fields: { [key: string]: string | string[] };
  /** Whether a run has written lines for the entry as it stands now. */
  indexed: boolean;
  /** Whether the lines shown were written for an earlier revision of it. */
  stale: boolean;
  /** Which of the lines are the user's own. */
  edited: ("kind" | "line" | "defines" | "related")[];
  /** What the entry is bound to: each binding in force, the owner's over an indexing run's, and the world's own pins of it, each to a record by its id. */
  links: ({ record: string; linked: boolean; aspect: string; by: "run" | "casting" | "bootstrap" | "owner" | "pin" })[];
}
```

### `LoreIndexStatus`

Where a chat's lore indexing stands, and what it runs on: how many entries the chat's lore holds, how many no run has indexed as they stand now, and the model the indexer's definition runs on.

```ts
export interface LoreIndexStatus {
  /** Entries in the chat's lore. */
  entries: number;
  /** Entries no run has written lines for as they stand now. */
  unindexed: number;
  /** The definition indexing runs as. */
  agent: string;
  /** The connection the definition runs on: the one it names, else his default; null where none is there. */
  connection: { id: string; name: string } | null;
  /** That connection's model; null where none resolves. */
  model: string | null;
}
```

### `LoreOverlays`

The overlays on a chat's path: the Author's notes that the story has moved past part of an entry, each tied to the turn that wrote it.

```ts
export interface LoreOverlays {
  /** In the path's order, and within a turn in the order they were written. */
  overlays: ({ id: number; entry: string; title: string | null; note: string; turn: number; turnId: string; by: string | null; agent: string | null })[];
}
```

### `LumiverseSave`

What the command line keeps of RPE's Lumiverse: its sign-in in the secrets file (null forgets it), and values of the config's `lumiverse` block.

```ts
export interface LumiverseSave {
  /** The sign-in to keep; null forgets the one kept; left out, it is not touched. */
  signIn?: { username: string; user: string; token: string; savedAt: number } | null;
  /** Values of the config's `lumiverse` block (url, user, database, connections, models); null takes one out. */
  set?: { [key: string]: string | string[] | null };
  /** Where RPE listens, as the swap takes it from today's runtime. */
  listens?: { address: string; port: number };
}
```

### `MemoryBand`

A memory's tier: top of mind, short term, long term.

```ts
export type MemoryBand = "top" | "short" | "long";
```

### `MemoryRow`

A memory, with its tier, strength (0 to 1) and whether it has faded to its gist, at story time at the reading (none while struck).

```ts
export interface MemoryRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  tier: MemoryBand | null;
  strength: number | null;
  faint: boolean;
}
```

### `MessageStretch`

Messages from `from` to `to`, both kept, as the chat numbers them from 0.

```ts
export interface MessageStretch {
  from: number;
  to: number;
}
```

### `MigrationChatRow`

One chat as the last run left it: what came of it and why it was not imported; the turns imported of its own; the messages it shares with the chat it was made from; its check against today's fold (matched at the head and at how many swipes, where it differed, and where its swipes were placed); and what the run carried of it.

```ts
export interface MigrationChatRow {
  chat: string;
  outcome: ChatImportOutcome;
  why: string | null;
  turns: number;
  shares: { chat: string; messages: number } | null;
  check: { matched: { head: boolean; swipes: number; of: number }; differences: FoldDifference[]; placed: { own: number; shown: number; lost: number; head: number } };
  /** What the run that imported it carried of it, over its whole path (a document the migration kept as JSON); null for a chat no run of this build imported. */
  carried: JsonValue | null;
}
```

### `MigrationReply`

The Migration page's data, in one read: the last real run's report and its text as the run printed it; each chat's check, what came of it and what was carried of it; the backup with its checksum, and whether it is still there; what is waiting on the user; the steps of going back with the permissions the previous build asks for; and what today's build put in Lumiverse.

```ts
export interface MigrationReply {
  /** Null before any run. */
  report: MigrationReportShown | null;
  text: string | null;
  chats: MigrationChatRow[];
  /** The backup the last run took before it wrote anything. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  /** In the order the plan lists it: GUIDANCE.md first. */
  waiting: WaitingOnUser[];
  goingBack: { steps: string[]; permissions: string[] };
  /** What today's build put in Lumiverse, left as it is until the user says they will not go back. */
  lumiverse: JsonValue | null;
}
```

### `MigrationReportShown`

The last real run's report as the run printed it, whole (counts and checksums, never content): the page reads of it what became of each world in Build; every other field is the migration's own document, carried as JSON.

```ts
export interface MigrationReportShown {
  format: JsonValue;
  at: JsonValue;
  mode: JsonValue;
  layout: JsonValue;
  database: JsonValue;
  rows: JsonValue;
  items: JsonValue;
  notClassified: JsonValue;
  chats: JsonValue;
  unreadable: JsonValue;
  unsent: JsonValue;
  runtime?: JsonValue;
  given?: JsonValue;
  standIn: JsonValue;
  lumiverse: JsonValue;
  disk: JsonValue;
  underWay: JsonValue;
  imports: JsonValue;
  backup: JsonValue;
  landed: JsonValue;
  carried: JsonValue;
  worldsInStore: JsonValue;
  worldsInBuild?: WorldsInBuildShown;
  changes: JsonValue;
  refusals: JsonValue;
}
```

### `MindFileRow`

A mind file a migration carried, word for word (null: its row holds no text), with its filed mark.

```ts
export interface MindFileRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  file: string;
  /** The file's text as carried, every byte; null where its row holds none. */
  text: string | null;
  filed: boolean;
}
```

### `MissingPermissionShown`

A permission RPE's extension in Lumiverse lacks, and why it needs it.

```ts
export interface MissingPermissionShown {
  permission: string;
  why: string;
}
```

### `ModelFigure`

A figure of a model the Connections page asks for where nobody has given it.

```ts
export type ModelFigure = "contextWindow" | "maxTokens" | "pictures";
```

### `ModelLimit`

One limit of a model, in tokens, and where it came from.

```ts
export interface ModelLimit {
  tokens: number;
  from: "user" | "pi" | "connection";
}
```

### `ModelLimits`

A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it; and the figures nobody has given, in the order the page asks for them.

```ts
export interface ModelLimits {
  contextWindow: ModelLimit | null;
  maxTokens: ModelLimit | null;
  pictures: ModelPictures | null;
  asked: ModelFigure[];
}
```

### `ModelLimitsEntry`

A model's figures as entered or reported: its context window and its longest answer, in tokens, and whether it takes pictures.

```ts
export interface ModelLimitsEntry {
  contextWindow?: number;
  maxTokens?: number;
  pictures?: boolean;
}
```

### `ModelPictures`

Whether a model takes pictures, and where that came from.

```ts
export interface ModelPictures {
  takes: boolean;
  from: "user" | "pi" | "connection";
}
```

### `NoteRow`

A note file of a chat: its path in the chat's view, its size now (0 for one no longer there), and how many times agents wrote it in turns.

```ts
export interface NoteRow {
  path: string;
  bytes: number;
  writes: number;
}
```

### `NotesReply`

A chat's largest notes, and those agents rewrote most.

```ts
export interface NotesReply {
  largest: NoteRow[];
  rewritten: NoteRow[];
}
```

### `NotGiven`

Something a run's lead was not given, as a fact its briefing told: pictures its model does not take, or parts that are neither text nor a picture, with the messages of the prompt that held them; or a part of the briefing that could not be made, with why.

```ts
export type NotGiven = { what: "pictures" | "parts"; messages: number[]; count: number } | { what: "world-state" | "on-stage"; error: string };
```

### `PageProof`

The proof of a page's nonce, keyed by the hash of its page token.

```ts
export interface PageProof {
  /** HMAC-SHA-256 of the nonce, keyed by the token's hash, as lowercase hex. */
  proof: string;
}
```

### `PerceptionRow`

A perception, with the turn it is of and that turn's reply.

```ts
export interface PerceptionRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  of: { turn: TurnId; message: number | null };
}
```

### `PromptNotice`

What changed in the prompt's shape since the turn before, or that it is not mapped or could not be told apart.

```ts
export type PromptNotice = { kind: "changed"; marker: string } | { kind: "gone"; marker: string } | { kind: "unclaimed"; message: number; start: number; end: number } | { kind: "order"; markers: string[] } | { kind: "preset"; was: { id: string; name?: string; revision?: string } | null; now: { id: string; name?: string; revision?: string } | null } | { kind: "unmapped" } | { kind: "incomplete" };
```

### `ProviderOffer`

A provider the Connections page offers, how its connections may sign their calls, the APIs it speaks, whether a connection of it must give its address, and whether it makes embeddings (for a connection that signs with a key or with nothing; one signed in makes none).

```ts
export interface ProviderOffer {
  id: string;
  name: string;
  auth: ConnectionAuth[];
  apis: string[];
  needsBaseUrl: boolean;
  embeds: boolean;
}
```

### `PruneAsk`

The chat whose old turn folders are pruned.

```ts
export interface PruneAsk {
  chat: string;
}
```

### `PrunedShown`

What pruning a chat's old turn folders took away: of how many folders, how many files, how many bytes.

```ts
export interface PrunedShown {
  folders: number;
  files: number;
  bytes: number;
}
```

### `PruneItem`

One place a prune takes from: a turn folder's snapshots, a closed session, a deleted chat's folder, a chat's decided suggestions, old note versions, a deleted chat's rows or a living chat's derived rows, or a backup; its path below the tree's folder (a backup's, its name), and the files (or rows) and bytes that go.

```ts
export interface PruneItem {
  kind: "turn-folder" | "session" | "chat" | "suggestions" | "note-versions" | "chat-rows" | "derived-rows" | "backup";
  path: string;
  files: number;
  bytes: number;
}
```

### `Release`

The reply's release: whose text, in which form, the file for a file released, and its length.

```ts
export interface Release {
  by: AgentRef;
  form: "tags" | "message" | "narrator" | "narrator-live" | "file";
  path?: string;
  length: number;
}
```

### `ReplyPiece`

What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or one progress line of the chat's thinking block, counted from 0.

```ts
export type ReplyPiece = { run: string; from: number; text: string } | { run: string; line: number; progress: string };
```

### `ReplyReleased`

A run's reply began to go out to the chat: the run, by RPH's own id for it, and when, epoch ms.

```ts
export interface ReplyReleased {
  run: string;
  at: number;
}
```

### `ReplySoFar`

What a run sent to the chat: the reply's text, and the progress lines of its thinking block.

```ts
export interface ReplySoFar {
  text: string;
  progress: string[];
}
```

### `RequestAsk`

A composer control's ask, for the next message: its kind, the choice made, and any words typed with it.

```ts
export interface RequestAsk {
  kind: "depth" | "swipe";
  choice: string;
  /** Words typed with it; left out, null or blank, none. */
  words?: string | null;
}
```

### `RequestHeldReply`

The request held: it waits for the next message, in place of one of its kind that waited.

```ts
export interface RequestHeldReply {
  request: RequestShown;
}
```

### `RequestReply`

One model call's request, by its file below the turn's folder, rebuilt from the pointers the harness kept into the turn's files: every message as it was sent, in order, and each tool declared with the file its words came from. Where what is rebuilt is not what was sent, it says so and shows nothing.

```ts
export interface RequestReply {
  name: string;
  /** What was rebuilt is what was sent, by the hash the file keeps; false where it is not, and nothing is shown. */
  same: boolean;
  /** Every message as it was sent, in order; none where `same` is false. */
  messages: KeptMessage[];
  /** Each tool declared, in order; none where `same` is false. */
  tools: { name: string; file?: string }[];
}
```

### `RequestShown`

Something he asked for beside his words: a panel's tap, or a composer control (depth, swipe), with what was asked as data, whether it was played now as a message of its own, the turn it is kept with (null while it waits) and when it was made.

```ts
export interface RequestShown {
  id: string;
  chat: string;
  kind: "panel" | "depth" | "swipe";
  asked: { action: string | null; values: { [key: string]: JsonValue }; from: "palette" | "map" | "panel" | "chip" | "send-now"; what: string; on: string | null } | { choice: string; words: string | null };
  /** Played now, as a message of its own, rather than with the next message. */
  played: boolean;
  /** The message it was sent as, where it was played now. */
  message: string | null;
  /** The turn it is kept with; null while it waits. */
  turn: TurnId | null;
  at: number;
}
```

### `RequestsReply`

Requests, oldest first.

```ts
export interface RequestsReply {
  requests: RequestShown[];
}
```

### `RequestWithdrawnReply`

The request was withdrawn.

```ts
export interface RequestWithdrawnReply {
  withdrawn: true;
}
```

### `RestartState`

Where a restart onto RPE's app file on disk stands: nothing to restart onto, waiting for the turns and jobs running, restarting, needed and not made while `update.restart` is off, or needed and not possible, RPE having been started by hand.

```ts
export type RestartState = "none" | "waiting" | "restarting" | "off" | "by hand";
```

### `RuleFiring`

A rule that fired: which, from where, at what moment, on what, what it did, and what the agent did next.

```ts
export interface RuleFiring {
  rule: string;
  path: string;
  level: LayerLevel;
  moment: "stream" | "tool-call" | "tool-result" | "after-message" | "run-end" | "turn-start" | "before-compaction" | "interval";
  watched?: "text" | "thinking" | "reply" | "arguments" | "result";
  agent: AgentRef;
  callId?: string;
  tool?: string;
  matched?: string;
  fact?: { name: string; value: { count: number; names?: string[]; by?: { [key: string]: number }; namesBy?: { [key: string]: string[] }; fields?: { [key: string]: JsonValue } } };
  reminded?: "connection";
  action: "cut" | "remind" | "hold" | "follow-up" | "briefing" | "call";
  dropped?: string;
  then?: { did: "called"; tools: string[] } | { did: "wrote" } | { did: "released" } | { did: "ended" };
}
```

### `RunOutcome`

How a run ended, whether a reply was released, the limit or the failure, and what every agent of it spent.

```ts
export interface RunOutcome {
  status: "released" | "no-reply" | "stopped" | "limit" | "failed";
  released: boolean;
  limit?: LimitHit;
  error?: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string };
  usage: Usage;
}
```

### `RunShown`

One run of a turn: its first, or a continue of it, which runs the turn again under a run id of its own; or a Settle now run on it.

```ts
export interface RunShown {
  /** RPE's own id for it. */
  id: string;
  /** RPH's own id for it, which its trace records carry as their `run`; null before its first record. */
  run: string | null;
  /** Its place among the turn's runs, from 1. */
  nth: number;
  kind: TurnRunKind;
  status: TurnState;
  /** The message its request named: the one a new reply is written into, the reply a swipe or a regenerate writes again, or the one a continue's tag named for it to go on, a first word only. A continue is tied where Lumiverse's end names the message, the turn's `message`: where the two differ, the tag had named another; where this is null, the message was learned at the end. */
  target: string | null;
  /** A continue's own turn, which held what it changed until Lumiverse's end decided its turn, and whose folder holds its files (its requests among them): the turn id its files are read under. Null for any other run. */
  held: string | null;
  timings: TurnMoments;
  usage: Usage;
  /** What this run sent to the chat. */
  reply: ReplySoFar;
  /** What Lumiverse saved for it where that is not what was released (beyond the prefill in front and a continue's join): the saved text whole, beside `reply`; null where it is the same, or nothing is saved yet. */
  saved: string | null;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string } | null;
  /** What stopped it where it stood; null for neither a limit nor the hold. */
  stoppedBy: StoppedBy | null;
  /** What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line. */
  lastText: boolean;
  /** What its lead was not given of its prompt and its briefing, each told in its briefing; none when it was given all. */
  notGiven: NotGiven[];
  /** Its own trace records, numbered from 1 within the run, as far as the read reaches (the turn's `trace`). */
  trace: TraceRecord[];
  /** The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call, each named by its path below the folder. */
  requests: { agent: string; definition: string; call: number; file: string }[];
}
```

### `Sampling`

Sampling by its usual names, as a preset sets it; each one absent is the connection's own.

```ts
export interface Sampling {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  seed?: number;
  stop?: string[];
}
```

### `SaveConnection`

A connection to save, and its key: left out keeps the key there is, null takes it away.

```ts
export interface SaveConnection {
  connection: ConnectionInput;
  key?: string | null;
}
```

### `Scope`

Where work is: the user, the chat, the session, and the turn where it belongs to one.

```ts
export interface Scope {
  user: string;
  chat: string;
  session: string;
  turn?: string;
}
```

### `Session`

A session of RPE's web app: its token, which a browser keeps in place of the printed token, when it ends, and whose it is. After a sign-in by password for the command line or the MCP server, the Lumiverse session token too, for the client to keep as it keeps its own.

```ts
export interface Session {
  /** The session's token: given as the bearer of every call, and traded again for a new one before it ends. */
  session: string;
  /** When it ends, epoch milliseconds. */
  ends: number;
  /** The Lumiverse user it is of. */
  user: string;
  /** Lumiverse's own session, handed back for a client that keeps one (the command line); never for the web shell. */
  lumiverse?: { token: string; username: string };
}
```

### `SessionReply`

Whose the page's credential is, and when it runs out (epoch milliseconds; null: it has no end).

```ts
export interface SessionReply {
  user: string;
  ends: number | null;
}
```

### `SettingsReply`

Each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); every setting; and the install's facts.

```ts
export interface SettingsReply {
  chat: string | null;
  files: ({ level: LayerLevel; file: string; problem: string | null })[];
  settings: SettingView[];
  facts: InstallFact[];
}
```

### `SettingsWrite`

A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`.

```ts
export interface SettingsWrite {
  level: LayerLevel;
  chat?: string | null;
  key: string;
  value?: JsonValue;
  none?: boolean;
}
```

### `SettingTakes`

One of RPH's shapes of a value: a whole number or a number, at least `least` and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names.

```ts
export type SettingTakes = { type: "whole"; least: number; most?: number } | { type: "number"; least: number; most?: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };
```

### `SettingView`

A setting as the Settings page shows it.

```ts
export interface SettingView {
  /** As a config file writes it; a per-connection setting's names the connection. */
  key: string;
  /** What the page calls it. */
  name: string;
  /** One line on what it does. */
  about: string;
  /** When a change to it is in force. */
  effect: Effect;
  /** The same, in words: at its next use, from the next turn, from RPE's next start. */
  effectWords: string;
  /** Its row of Appendix D.1; null for a value beyond D.1, listed for the owner's approval. */
  row: string | null;
  /** The value in force; for a setting every level of which applies, all of theirs together. */
  value: JsonValue;
  default: JsonValue;
  /** The level whose file decides the value in force; null where no file does, and the default holds. */
  from: LayerLevel | null;
  /** That level's file, as the Files page names it. */
  file: string | null;
  /** What each level's file sets, farthest first; a level that sets nothing is left out. */
  set: { level: LayerLevel; file: string; value: JsonValue }[];
  /** Every level's value applies, not the nearest alone. */
  joined: boolean;
  takes: Takes;
  /** What it takes, in words. */
  takesWords: string;
  /** What no value means, where the default is none or `~` may be set. */
  none: string | null;
  /** `~` may be set (`none: true` in a write). */
  orNone: boolean;
  /** The levels it may be set at here. */
  levels: LayerLevel[];
  /** For a per-connection setting, the connection it names; null for a name or id no connection has now. */
  connection?: { id: string; name: string } | null;
  /** A value a file sets that the setting does not take, and why: the default holds in its place. */
  passed: { value: JsonValue; why: string } | null;
}
```

### `SettleReply`

The newest turn, and the Settle now run begun on it.

```ts
export interface SettleReply {
  turn: TurnId;
  run: string;
}
```

### `SignInStart`

A sign-in started: its flow, to finish with what the user pastes back or to cancel; the address the user opens to sign in; and what to know first.

```ts
export interface SignInStart {
  flow: string;
  url: string;
  note: string;
}
```

### `SignInState`

Where a provider's sign-in stands: signed in or not, until when its token holds (RPH renews it when a call needs it), the flow open for it, and why its last flow ended without signing in.

```ts
export interface SignInState {
  provider: "anthropic" | "openai";
  signedIn: boolean;
  until: number | null;
  flow: string | null;
  ended: string | null;
}
```

### `SourceBindingKind`

What a source bound to a character points at.

```ts
export type SourceBindingKind = "card" | "persona" | "entry" | "memory";
```

### `SourceBindingRow`

A source bound to the character, as recorded (the text stays in Lumiverse).

```ts
export interface SourceBindingRow {
  kind: SourceBindingKind;
  ref: string;
  /** Which side of the character it defines, in the binder's words. */
  defines: string | null;
  created: number;
}
```

### `Span`

A stretch of a model's own writing, in milliseconds since 1970: from its first token to its last; `to` null while it began and has not ended (a run stopped inside it).

```ts
export interface Span {
  from: number;
  to: number | null;
}
```

### `StackPartRow`

One part of an agent's stack: its kind, which part, the file it came from, its level, whether it sits in the opening block or comes with the briefing, its text, and the situations that hand it to the briefing; a part left out is listed with why.

```ts
export interface StackPartRow {
  /** What the part is. */
  kind: "definition" | "instruction" | "rule" | "contract" | "guide" | "closing" | "description" | "skills" | "given";
  /** Its name as `off:` lists name it; for `given`, the item as `opening:` writes it. */
  part: string;
  /** The file it came from; for a part left out as `missing`, where it would be; for `given`, the definition that names it. */
  path: string;
  level: LayerLevel;
  /** SHA-256 of the file (for `given`, of its text), lower-case hex; absent for a part left out as `missing`. */
  hash?: string;
  /** Where it sits, or for a part left out, where it would. */
  where: "opening" | "briefing";
  /** Why it is left out; absent for a part in the stack. */
  left?: "missing" | "off" | "empty" | "broken" | "needs";
  /** Its text as the agent gets it; absent when left out, and for `given` outside a session. */
  text?: string;
  /** For a part the briefing is handed: the situations that add it. */
  situations?: string[];
}
```

### `StackReply`

The exact stack an agent gets in the chat, part by part in order, each with the file it comes from, its level, and whether it sits in the opening block or comes with the briefing; a part left out is listed with why.

```ts
export interface StackReply {
  agent: string;
  parts: StackPartRow[];
}
```

### `Status`

That RPE answers here, and its build: nothing more.

```ts
export interface Status {
  name: "rpe";
  version: string;
}
```

### `StoppedBy`

What stopped a run where it stood, its reply going out with what it had: one of RPH's limits (calls, tokens, time), or the hold of a reply asked for whole, in milliseconds from the request's arrival.

```ts
export type StoppedBy = { limit: LimitHit } | { hold: number };
```

### `StopReply`

True when the turn was running and is being stopped, false when it had already ended.

```ts
export interface StopReply {
  stopped: boolean;
}
```

### `StorageKindRow`

One kind RPE keeps: how many, how big, the oldest of it, and how long it is kept.

```ts
export interface StorageKindRow {
  kind: string;
  /** How many: files, rows, folders or backups, by what the kind is. */
  count: number;
  bytes: number;
  /** When the oldest of it was made, epoch milliseconds; null where there is none. */
  oldest: number | null;
  kept: KeptFor;
}
```

### `StorageKindsReply`

Each kind RPE keeps, with its count, size, oldest and how long it is kept, and when the user last pruned.

```ts
export interface StorageKindsReply {
  kinds: StorageKindRow[];
  /** When the user last pruned anything the page offers, epoch milliseconds; null when never. */
  lastPrune: number | null;
}
```

### `StoragePruneAsk`

What to prune: a chat's old turn folders, its closed sessions' files, a deleted chat's other files, the decided suggestions past what it keeps, the note versions past how far back they are kept, a deleted chat's database rows (not while a chat made from it reads its turns), a living chat's derived rows (its snapshots, vectors and caches, made again when next needed), or the backup or copy of the database named. Without `plan` it only says what would go; with the `plan` that answer gave, it takes exactly that.

```ts
export interface StoragePruneAsk {
  what: "turns" | "sessions" | "chat" | "backup" | "suggestions" | "versions" | "rows" | "derived";
  chat?: string | null;
  name?: string | null;
  plan?: string;
}
```

### `StoragePruneReply`

What a prune would take (its places, files and bytes, and the `plan` that stands for exactly that), or, when asked with the plan, took.

```ts
export interface StoragePruneReply {
  plan: string;
  /** False: this is what would go. True: this went. */
  removed: boolean;
  files: number;
  bytes: number;
  items: PruneItem[];
}
```

### `StorageReply`

A page of chats, each with what its folder takes by area and what its rows take of the database; the user's own level, its notes and the shipped level; and RPE's database file, with its write-ahead log and what no chat's rows take of it.

```ts
export interface StorageReply {
  chats: ChatStorageRow[];
  /** The chat after which the next page starts: send it as `after`; null at the end. */
  next?: string | null;
  /** The user's own level, the chats' folders, the shipped level and its notes apart. */
  global: number;
  /** The global level's notes, which every chat's agents read. */
  globalNotes: number;
  shipped: number;
  /** RPE's database file, with its write-ahead log. */
  database: number;
  /** What the database takes beyond the chats' rows: the installation's own tables, and what no chat owns. The chats' rows and this add up to the database. */
  rest?: number;
}
```

### `StoryItemRow`

An item of the story record as it stands on the path read: its fields, where it lies in the chat by message number (null: nowhere, or an end the record cannot place), its first write, whether it is closed or struck, and every write.

```ts
export interface StoryItemRow {
  id: string;
  part: StoryPartName;
  /** Every field its writes set, the latest of each: messages by their number on the chat's path (`first` and `last` as `from` and `to`), a due time as the engine shows a time. */
  fields: { [key: string]: JsonValue };
  /** Where it lies in the chat, by message number: a beat's messages, a scene's or a chapter's span. Null for a part that lies nowhere, or an end the record cannot place. */
  from: number | null;
  to: number | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  closed: boolean;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: StoryWriteRow[];
}
```

### `StoryItems`

A list of the record, bounded: what it gives, how many it holds in all, and how many it left out before and after what it gives.

```ts
export interface StoryItems {
  items: StoryItemRow[];
  total: number;
  before: number;
  after: number;
}
```

### `StoryListName`

The parts the story route gives as bounded lists: every part but the one premise.

```ts
export type StoryListName = "chapter" | "scene" | "beat" | "thread" | "arc" | "player" | "future" | "canon" | "retcon" | "record";
```

### `StoryPartName`

The parts of the story record.

```ts
export type StoryPartName = "premise" | "chapter" | "scene" | "beat" | "thread" | "arc" | "player" | "future" | "canon" | "retcon" | "record";
```

### `StoryReply`

The story record of a chat: the timeline, the story model's parts as recorded, the Author's horizon and the futures.

```ts
export interface StoryReply {
  chat: string;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  /** Story time at the reading, as the engine shows a time; null where the chat keeps none. */
  now: string | null;
  /** The most items one list gives at once: the setting `story.queryItems` for the chat. */
  listed: number;
  /** Chapters and scenes by where they start, beats by where they lie; what the record cannot place last. */
  timeline: { chapter: StoryItems; scene: StoryItems; beat: StoryItems };
  /** The chapter and the scene the chat is in now; null when it is in none (none yet, or the last one is closed). */
  current: { chapter: string | null; scene: string | null };
  /** The story model's parts as recorded, in the order first written: the premise, then each list. */
  model: { premise: StoryItemRow | null; thread: StoryItems; arc: StoryItems; player: StoryItems; canon: StoryItems; retcon: StoryItems; record: StoryItems };
  horizon: HorizonEntryRow[];
  /** The futures, today's drafts among them, in the order first written. */
  futures: StoryItems;
}
```

### `StoryStrikeAsk`

An item of the record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says.

```ts
export interface StoryStrikeAsk {
  id: string;
  struck: boolean;
  why?: string | null;
}
```

### `StoryStrikeReply`

What a strike, or taking one back, did: whether anything was recorded, and the item as it stands now, at the chat's newest turn.

```ts
export interface StoryStrikeReply {
  /** Whether anything was recorded: false when the item already stood so. */
  changed: boolean;
  item: StoryItemRow;
}
```

### `StoryWriteRow`

One write of an item, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said.

```ts
export interface StoryWriteRow {
  turn: TurnId;
  /** The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind). */
  message: number | null;
  /** That turn was written by a migration's import, not played on RPE. */
  imported: boolean;
  /** Who wrote it: an agent's definition (`author`), `player`, or the migration. */
  by: string | null;
  /** What it said, as the item's fields are shown: `close` and `drop` among them. */
  wrote: { [key: string]: JsonValue };
}
```

### `SuggestionAcceptAsk`

The text as accepted, when it was edited, and the level it is written at (absent: the file's own).

```ts
export interface SuggestionAcceptAsk {
  text?: string | null;
  level?: LayerLevel;
}
```

### `SuggestionAcceptedReply`

A suggestion accepted: it as it now stands, and the file as the listing now shows it.

```ts
export interface SuggestionAcceptedReply {
  suggestion: SuggestionRow | null;
  file: TreeFileRow | null;
}
```

### `SuggestionDismissedReply`

A suggestion dismissed: it as it now stands.

```ts
export interface SuggestionDismissedReply {
  suggestion: SuggestionRow | null;
}
```

### `SuggestionRow`

An agent's suggestion for a file: the file as the agent named it in the chat's view, the text proposed whole, and why.

```ts
export interface SuggestionRow {
  id: number;
  chat: string;
  /** The turn it was filed in; null for one filed outside a turn. */
  turn: TurnId | null;
  agent: AgentRef;
  /** The file it would change, as the agent named it in the chat's view. */
  path: string;
  /** The proposed text, whole. */
  text: string;
  reason: string;
  at: number;
  state: SuggestionStatus;
  /** When the user accepted or dismissed it; null while open. */
  decided: number | null;
}
```

### `SuggestionShown`

A suggestion with what it would change: from the file as it is now to the text proposed.

```ts
export interface SuggestionShown {
  id: number;
  chat: string;
  /** The turn it was filed in; null for one filed outside a turn. */
  turn: TurnId | null;
  agent: AgentRef;
  /** The file it would change, as the agent named it in the chat's view. */
  path: string;
  /** The proposed text, whole. */
  text: string;
  reason: string;
  at: number;
  state: SuggestionStatus;
  /** When the user accepted or dismissed it; null while open. */
  decided: number | null;
  lines: DiffRow[];
  /** The level accepting it writes at when no level is named: its file's own, or for a shipped file the chat's. */
  level?: LayerLevel;
  /** The levels that have a place for its file, any of which accepting it may name. */
  levels?: LayerLevel[];
}
```

### `SuggestionsReply`

A chat's suggestions (every chat's when none is named), newest first.

```ts
export interface SuggestionsReply {
  suggestions: SuggestionShown[];
}
```

### `SuggestionStatus`

Where an agent's suggestion stands: waiting on the user, accepted, or dismissed.

```ts
export type SuggestionStatus = "open" | "accepted" | "dismissed";
```

### `SwitchAsk`

Switch the named thing on or off, for the user it names.

```ts
export interface SwitchAsk {
  /** Which. */
  state: "on" | "off";
  /** The user whose own it is; the user this RPE belongs to where left out. */
  user?: string;
}
```

### `Switched`

The switched entry, or null with what is listed when nothing of that name is.

```ts
export interface Switched {
  /** The entry as it stands now; null where nothing of that name is listed. */
  entry: SwitchEntry | null;
  /** Every name listed, with its state. */
  listed: ({ name: string; state: "waiting" | "on" | "off" })[];
}
```

### `SwitchEntry`

A thing that runs a command or calls out, and where it stands.

```ts
export interface SwitchEntry {
  /** The user whose own it is: what is on for one user is not on for another. */
  user: string;
  /** Its name. */
  name: string;
  /** What sort of thing it is. */
  kind: string;
  /** Exactly what it runs or calls. */
  what: string;
  /** Whether it may run. */
  state: "waiting" | "on" | "off";
  /** When this definition was first listed. */
  listed: number;
  /** When the command line last switched it; null if never. */
  changed: number | null;
}
```

### `SwitchesShown`

The page user's own switches, each name's newest definition.

```ts
export interface SwitchesShown {
  /** Each of the user's things and where it stands. */
  switches: SwitchEntry[];
}
```

### `TakenKeyAsk`

The hash of the provider key today's connection holds, which RPE takes over at the swap.

```ts
export interface TakenKeyAsk {
  /** The key's SHA-256, in hex. */
  hash: string;
}
```

### `Takes`

What a level may set a setting to: one of RPH's shapes; a table of names, each to a value of `of` (with `whole`, such a value alone for every name); or a list of records, each holding every field.

```ts
export type Takes = SettingTakes | { type: "table"; of: SettingTakes; whole?: true } | { type: "records"; fields: readonly { name: string; takes: SettingTakes; about: string }[] };
```

### `TapAsk`

A tap that manages, recorded at once as his own edit: one of the world's actions done at once (money, a group, gear, a vehicle); one ✎ form (a hint, the time, a thing, things with a label, or a field); the World page's edit of values and facts; or an edit of operations ("Make this a property").

```ts
export type TapAsk = { kind: "action"; action: string; params: { [key: string]: JsonValue }; source: string; text?: string; now?: boolean; tell?: boolean } | { kind: "fix"; fix: { hint: string } | { time: string } | { thing: JsonValue } | { things: JsonValue[]; label: string } | { entity: string; field: string; value: JsonValue }; tell?: boolean } | { kind: "edit"; ops: EditOpAsk[]; tell?: boolean } | { kind: "ops"; ops: JsonValue[]; tell?: boolean };
```

### `TapReply`

What a tap or its Undo came to: whether it was applied, what the world's rules reported of it (kept with it, listed under unsettled), the id its Undo takes (null where nothing was recorded), and the answer in words.

```ts
export interface TapReply {
  applied: boolean;
  reports: string[];
  undo: string | null;
  words: string;
}
```

### `TapUndoAsk`

The Undo of an edit of his, by the id its answer gave.

```ts
export interface TapUndoAsk {
  undo: string;
}
```

### `ToolCallView`

A tool call a model made: the model's id for it, the tool, its arguments, and when the model began writing it, where the provider gave it in pieces.

```ts
export interface ToolCallView {
  id: string;
  name: string;
  args: JsonValue;
  began?: number;
}
```

### `ToolResult`

A tool's answer: what the model is shown, whether it failed, what it reports beyond it, its marks, and data for the live view.

```ts
export interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  error?: true;
  reports?: string[];
  marks?: string[];
  details?: JsonValue;
}
```

### `TraceDelta`

Text of a model call as it streams: what arrived since the last piece, never numbered.

```ts
export interface TraceDelta {
  run: string;
  agent: string;
  call: number;
  text?: string;
  thinking?: string;
  at: number;
}
```

### `TraceEvent`

What RPH did; each kind's fields are the facts of it.

```ts
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; session: string; given: string[]; tools?: { tokens: number; most: number } } | { kind: "tool_unheld"; tool: string; definition: string; reason: "unregistered" | "shadowed" | "withdrawn" } | { kind: "intent_began" } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "connection_wait"; connection: string; for: "minute" | "place"; ms?: number } | { kind: "waiting"; for: "tool" | "agent"; callId: string; tool: string; ms?: number } | { kind: "connection_stand_in"; named: string; used: string } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; closing: boolean; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission; refused?: CallRefusal } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "rule_failed"; rule: string; path: string; why: "time"; length: number } | { kind: "hook"; hook: string; on: "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end"; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "paused"; call: number } | { kind: "resumed"; call: number; ms: number } | { kind: "said"; call: number; text: string } | { kind: "released"; release: Release } | { kind: "progress_missing"; time: number } | { kind: "compacted"; session: string; reason: "would-not-fit" | "refused" | "asked" | "fold"; of: "turns" | "run"; before: number; after: number; keptTurns?: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened" | "unreadable"; from?: string; turn?: string; by?: "user"; reason?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };
```

### `TraceRecord`

An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it. No agent for a record of the host's word outside any agent's work (a session opened, closed, forked or opened again by a call of the sessions API).

```ts
export interface TraceRecord {
  seq: number;
  run: string;
  scope: Scope;
  at: number;
  agent?: AgentRef;
  parent?: { agent: string; run: string; call: string };
  event: TraceEvent;
}
```

### `TreeDiffReply`

A file's differences: from the shipped file of its name to this one; and what the updates that changed the shipped file since this one was written changed of it, together and one by one.

```ts
export interface TreeDiffReply {
  path: string;
  /** The shipped file of the same name; null when there is none, or the file is the shipped one. */
  shipped: string | null;
  /** From the shipped file to this one, line by line; none without a shipped file. */
  lines: DiffRow[];
  /** Every change to the shipped file since this one was last written, as one difference: when the latest update ran, and from the shipped file as it stood when this one was written to the shipped file now. */
  update: { at: number; lines: DiffRow[] } | null;
  /** The same changes one update at a time, oldest first: when each ran, and from the shipped file before it to the shipped file after it. */
  updates?: { at: number; lines: DiffRow[] }[];
}
```

### `TreeFileKind`

What a file of the tree is: one the user writes, a note an agent keeps, or one RPE makes again.

```ts
export type TreeFileKind = "yours" | "notes" | "generated";
```

### `TreeFileReply`

One file of the tree, as text: the whole of a short one, and of a long one the lines or bytes asked for (the page's setting `files.readLines` of its lines when none is asked), with its size and its count of lines.

```ts
export interface TreeFileReply {
  path: string;
  level: LayerLevel;
  kind: TreeFileKind;
  /** The file's size in bytes. */
  bytes: number;
  editable: boolean;
  /** The part read, whole lines or the bytes asked for. */
  text: string;
  /** The file's lines in all. */
  lines?: number;
  /** The first line the text holds; with `offset`, the first byte. */
  from?: number;
  /** The last line the text holds; with `offset`, the byte after the last. */
  to?: number;
  /** Whether the file goes on past what was read. */
  more?: boolean;
}
```

### `TreeFileRow`

One file of the agents' tree as the Files page lists it: its path in the chat's view, its level and kind, its size, whether RPH takes it, and what stands beside it at other levels.

```ts
export interface TreeFileRow {
  /** Its path in the chat's view, as the file routes take it: `@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder. */
  path: string;
  level: LayerLevel;
  kind: TreeFileKind;
  bytes: number;
  /** The name RPH loads it by, and an `off:` list names it by; null for a file RPH does not load by its name. */
  item: string | null;
  /** Whether RPH takes it: a named file when it is the nearest of its name, not switched off and not an example; any other file as it is. */
  applies: boolean;
  /** The nearer file of the same name taken in its place; null when none is. */
  replacedBy: string | null;
  /** Its name is in a config's `off:` list, which switches it off at every level. */
  off: boolean;
  /** The levels whose config's `off:` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing. */
  offIn: LayerLevel[];
  /** Whether the user may write it where it is: never a shipped file or a generated one. */
  editable: boolean;
  /** The shipped file of the same name, for a file of another level that has one; null otherwise. */
  shipped: string | null;
  /** For a file of the user's in place of a shipped one: when the latest update that changed that shipped file did so, if it did since this file was last written; null otherwise. */
  defaultChanged: number | null;
  /** For a file of the user's in place of a default an update has since taken away: when the update that removed it ran, if it did since this file was last written. */
  defaultRemoved?: number | null;
  /** The agents it is pinned for: each is handed the file whole at the start of its runs. Empty for a file pinned for none. */
  pinnedFor?: { agent: string; level: LayerLevel }[];
  /** Whether it is a level's config file, which the Settings page edits too. */
  isConfig?: boolean;
  /** The levels where a file of its kind and name has a place that the user may write: "save as" offers only those. */
  placeable?: LayerLevel[];
  /** For a generated file, the page where what it shows is edited, if one is; null otherwise. */
  editedOn?: string | null;
  /** Why RPH leaves it out though it is the nearest of its name and not switched off: what its `needs:` names is not in force, or its header does not parse; null when nothing does. */
  held?: "needs" | "broken" | null;
  /** What RPH found wrong with it, in its own words, line by line. */
  problems?: string[];
  /** The agents whose stacks it joins: a file `instructions:` names or an agent reads. */
  joins?: string[];
}
```

### `TreeListed`

One entry of a folder, or of a search: a folder, or a file with its entry.

```ts
export interface TreeListed {
  name: string;
  /** Its path in the chat's view, as the file routes take it. */
  path: string;
  folder: boolean;
  level: LayerLevel;
  /** The file as the listing shows it; null for a folder. */
  entry: TreeFileRow | null;
}
```

### `TreeListedReply`

A page of a folder of the chat's view, folders first and each by name, or of a search across every level: its entries, where the next page starts, the levels the view has, and whether a search stopped before it had looked everywhere.

```ts
export interface TreeListedReply {
  /** The folder listed, "" for the chat's own top (which holds the other levels' folders beside its files); empty for a search. */
  folder: string;
  items: TreeListed[];
  /** Where the next page starts: send it as `after`; null at the end. */
  next: string | null;
  /** The levels the view has now: a chat's and its character's once the chat has its folders. */
  levels: LayerLevel[];
  /** A search that ran out of its time with the entries it had found, and did not look everywhere. */
  stopped: "time" | null;
}
```

### `TreeListingReply`

Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.

```ts
export interface TreeListingReply {
  files: TreeFileRow[];
}
```

### `TurnChange`

One change a turn recorded, in its order: the operation and its values, who made it, whether it applied, what it reported, and how exact, how sure and from where it is.

```ts
export interface TurnChange {
  id: number;
  ord: number;
  op: string;
  value: JsonValue;
  by: string | null;
  applied: boolean;
  reports: { code: string; values?: { [key: string]: JsonValue } }[];
  source: FactSource | null;
  standing: FactStanding | null;
  precision: FactPrecision | null;
  /** The job that recorded it, when a job did. */
  job: string | null;
}
```

### `TurnId`

A turn's id: the id RPE gives a turn when it begins it.

```ts
export type TurnId = string;
```

### `TurnKind`

What a generation asks for.

```ts
export type TurnKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";
```

### `TurnLoreReply`

The lore Lumiverse activated for a turn's prompt, in the order the turn's tag lists it; none for a turn RPE holds no tag for.

```ts
export interface TurnLoreReply {
  entries: TurnLoreRow[];
}
```

### `TurnLoreRow`

An entry Lumiverse activated for a turn's prompt: its lore map id, its id and its book's id in Lumiverse, its title, and how it activated where the turn's tag says.

```ts
export interface TurnLoreRow {
  /** The id the Author's lore map gives the entry: `e-` and its number. */
  id: string;
  /** Lumiverse's id of the entry. */
  entry: string;
  /** Lumiverse's id of its book; empty where the tag does not say. */
  book: string;
  /** Its title as Lumiverse gave it. */
  title: string;
  /** How it activated; null where the tag does not say. */
  how: LoreActivation | null;
}
```

### `TurnMark`

A mark a turn carries apart from its run's status: interrupted (RPE restarted while a run of it went on), saved otherwise (what Lumiverse saved is not what was released, beyond the prefill in front and a continue's join), or standing on a message of the player's he edited, or inserted before it, since it was played; with that message, and when the mark was set.

```ts
export interface TurnMark {
  kind: "interrupted" | "saved-otherwise" | "edited-message" | "inserted-message";
  message: string | null;
  at: number;
}
```

### `TurnMoments`

When a turn's moments happened, in milliseconds since 1970; null for one that has not happened.

```ts
export interface TurnMoments {
  /** The request reached RPE. */
  received: number;
  /** The lead's run began, after intake and any wait for the turn before it. */
  started: number | null;
  /** The reply's first words went to the chat. */
  firstWord: number | null;
  /** The reply was released (plan §10.7). */
  released: number | null;
  /** The lead's run ended; it can go on after the release (plan §10.9). */
  ended: number | null;
  /** The reply went out whole; the run after the reply is from here to `ended`. */
  finished: number | null;
  /** The intent record's own time, its first token to its last; null when none began; to null when it began and did not end. */
  intent: Span | null;
  /** Each span of thinking before a model call's first output on the reply's path, in call order; none when no call thought. */
  thinking: Span[];
  /** Intake's own steps in order, from `received` to `started`, none of them holding a wait for the turn before; null for a run with no intake of its own (a Settle now) or one kept before they were. */
  intake: { step: string; from: number; to: number }[] | null;
  /** Each wait for the turn before, on its own, in order; none when nothing was waited for; null as for `intake`. */
  wait: { from: number; to: number }[] | null;
}
```

### `TurnReply`

One turn, read on from where a page has read to, and each of its runs.

```ts
export interface TurnReply {
  id: TurnId;
  kind: TurnRunKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnState;
  /** Its marks, in the order they were set; none for a turn that carries none. */
  marks: TurnMark[];
  timings: TurnMoments;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
  chat: string;
  /** The lead's intent record as it was written (plan §10.3); null when it wrote none. Shown behind the spoiler gate. */
  intent: string | null;
  /** What its latest run sent to the chat so far. */
  reply: ReplySoFar;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string } | null;
  /** Its runs' events as far as the read reaches, in order: of the run asked for (the turn's first when none), those numbered `from` on; and every record of each run that began after it. */
  trace: TraceRecord[];
  /** The lore of the turn's prompt, by id, as its intake kept it: the entries Lumiverse activated for it (Lumiverse's ids), and the entries its lore map showed the Author (RPE's ids, as the map writes them). */
  lore: { activated: string[]; map: string[] };
  /** Each of its runs, the first first. */
  runs: RunShown[];
  /** Where each slice of the preset's map was in this turn's prompt, with its notices; null where RPH kept none, or no longer keeps it (its folder was pruned). */
  prompt: LocatedSlices | null;
  /** What he asked for beside his words that this turn was told and keeps, and what was played as its message. */
  asked: RequestShown[];
  /** The Author's record of the turn as `story_query` shows it, every field; null when it wrote none. */
  record: { [key: string]: JsonValue } | null;
  /** The tools its agents reached through `tool_search` and `tool_use`, by name. */
  found: string[];
  /** Each agent's `todo` items still open as its list last stood. */
  todos: { agent: string; open: string[] }[];
  /** Its changes by lane, each lane's in order. */
  changes: { lane: string; changes: TurnChange[] }[];
  told: TurnTold;
  /** For a turn a migration carried: its message and swipe, and the old engine's record of it as kept; null for any other. */
  carried: { message: string; swipe: number; record: JsonValue } | null;
}
```

### `TurnRow`

A turn as a chat's list shows it.

```ts
export interface TurnRow {
  id: TurnId;
  kind: TurnRunKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnState;
  /** Its marks, in the order they were set; none for a turn that carries none. */
  marks: TurnMark[];
  timings: TurnMoments;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
}
```

### `TurnRunKind`

A run's kind: the kind of turn Lumiverse asked for, or a Settle now run, where the player asked the Author to settle an edit now and nothing is written to the chat.

```ts
export type TurnRunKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate" | "settle";
```

### `TurnsReply`

A chat's turns, newest first.

```ts
export interface TurnsReply {
  turns: TurnRow[];
  /** Older turns remain. */
  more: boolean;
}
```

### `TurnState`

Where a turn or a run stands: running, or how it ended.

```ts
export type TurnState = "running" | "released" | "no-reply" | "stopped" | "limit" | "failed";
```

### `TurnTold`

What a turn, or a job he started, was told as it went: each gap check, each consent, each rule that fired with what the agent did next, the attachments each agent was given by name, and each sub-agent's writes the lead dropped, in the order told.

```ts
export interface TurnTold {
  gapChecks: { check: GapCheck; at: number }[];
  consents: { grant: ConsentGrant; at: number }[];
  rules: { firing: RuleFiring; at: number }[];
  attachments: { agent: AgentRef; refs: JsonValue; at: number }[];
  dropped: { agent: AgentRef; at: number }[];
}
```

### `UndoAsk`

Today's Undo of a tap, as the previous build's Undo chip sends it: `{ lre: 1, type: "lre.chip", reqId, chatId, chip, choice: "undo" }`, the chip being the tap's id.

```ts
export interface UndoAsk {
  lre: 1;
  type: "lre.chip";
  reqId: string;
  chatId: string;
  /** The tap's id: `tap:<turn>:<tap>`, the turn it was recorded on and its own id there. */
  chip: string;
  choice: "undo";
  payload?: { [key: string]: JsonValue };
}
```

### `Usage`

Model calls and their tokens: sent (cached ones included), read from and written to the cache, written, and of those the reasoning.

```ts
export interface Usage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
}
```

### `WaitingOnUser`

One thing the last run left waiting on the user, by what it is.

```ts
export type WaitingOnUser = { kind: "guidance"; path: string } | { kind: "connection"; setting: string; connection: string } | { kind: "chat"; chat: string; questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean } | { kind: "own"; agents: number; skills: number; texts: number } | { kind: "filing"; chat: string; characters: number; notes: boolean } | { kind: "world"; world: string; name: string | null };
```

### `WorldReply`

The level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn.

```ts
export interface WorldReply {
  at: string;
  nodes: LevelNode[];
}
```

### `WorldsInBuildShown`

What a run did with each world it carried into Build's own copy, by the world's id: copied in, replaced (Build's copy was still a run's), unchanged, or kept as RPE has it (changed or made there); of those kept, which are newer on today's side too; and each world's name as today's index gives it. The last two are absent from a report kept before runs told them.

```ts
export interface WorldsInBuildShown {
  copied: string[];
  replaced: string[];
  unchanged: string[];
  kept: string[];
  newer?: string[];
  names?: { [key: string]: string };
}
```

### `DraftChanged`

The previous build's push that a world's working copy changed: `{ lre: 1, type: "lre.draft.changed", worldId, version, stored, base }`.

Carried as the previous build wrote it: the type `DraftChanged` of `src/shared/protocol.ts`.

### `ErrorMessage`

The previous build's answer to a request that could not be done: `{ lre: 1, type: "lre.error", reqId, code, message }`.

Carried as the previous build wrote it: the type `ErrorMessage` of `src/shared/protocol.ts`.

### `FrontendToBackend`

One of the previous build's requests, as a page of it sends it: `{ lre: 1, type, reqId, … }`, the rest of it by its `type`.

Carried as the previous build wrote it: the type `FrontendToBackend` of `src/shared/protocol.ts`.

### `ResultMessage`

The previous build's answer to a request that was done: `{ lre: 1, type: "lre.result", reqId, request, body }`.

Carried as the previous build wrote it: the type `ResultMessage` of `src/shared/protocol.ts`.

### `StateView`

A chat's state as the previous build's play pages take it: its status, its clock, its sheet, its scene, its chips and the rest of what the pages draw.

Carried as the previous build wrote it: the type `StateView` of `src/shared/state-view.ts`.
