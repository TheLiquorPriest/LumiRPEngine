# RPE

RPE is an application for roleplay with AI models. It runs beside [Lumiverse](https://github.com/prolix-oc/Lumiverse) on the same machine.

- You chat in Lumiverse as usual. A chat that uses RPE's connection is played by RPE's agents.
- Lumiverse builds the prompt from your preset, character, lore and history. That whole prompt is what RPE's lead agent, the Author, starts from.
- The Author decides each moment. It can hand work to a character agent, a game master or a narrator, and it writes or has written the reply you see.
- RPE keeps the world in its own database: places, people, belongings, money, time, quests, the story so far and what each character knows. Swipes, edits and branches are tracked turn by turn.
- How the agents behave is written in plain files you can read and change, not fixed in code. See [How behaviour lives in files](docs/behaviour.md).
- RPE calls your model providers itself, on connections you add to it.

## What you need

- [Bun](https://bun.sh) 1.4 or later, on the machine that runs Lumiverse.
- A Lumiverse you can sign in to, and an admin of it to approve the extension's permissions.
- A model connection: an account and key with a provider (DeepSeek, OpenAI, Anthropic, OpenRouter and others), or a provider that signs in without a key.
- For a service that starts by itself: Linux with systemd. Anywhere else, run RPE in the foreground, or keep it running with your system's own service manager ([how](docs/install.md#keep-it-running-on-macos-windows-and-in-a-container)).

## From nothing to a first reply

In these steps, `rpe` stands for `bun <the folder of this repository>/dist/rpe.js`. Lumiverse keeps an installed extension's copy in `<Lumiverse's data folder>/extensions/lumi_rp_engine/repo`, so that copy is the one to use once the extension is installed.

1. **Install the extension.** In Lumiverse, open **Extensions**, tap **Add Extension**, choose **Install from Source**, enter `https://github.com/TheLiquorPriest/LumiRPEngine` and the branch `standalone`, and install it. An admin approves its five permissions ([why each one](docs/install.md#the-extension-and-its-five-permissions)). Switch it on.
2. **Start RPE and sign it in to Lumiverse.** On the machine that runs Lumiverse:

   ```sh
   bun <Lumiverse's data folder>/extensions/lumi_rp_engine/repo/dist/rpe.js up --url <Lumiverse's address> --user <your Lumiverse username> --systemd
   ```

   It asks for your Lumiverse password once, and does not keep it. It makes a connection called "RPE" in Lumiverse, starts RPE as a service of your account, and ends with a numbered list of what is left to do. Without `--systemd` (anywhere without systemd), it starts RPE itself and stays in the foreground until you press Ctrl-C: leave it running and use another terminal for the steps that follow. To start it again later, run `rpe serve`, or `rpe up` again.
3. **Add a model connection to RPE.** For example:

   ```sh
   rpe connection add --name deepseek --provider deepseek --model deepseek-v4-flash
   ```

   It asks for the provider's key and does not show it. You can also add one on the **Connections** page, in RPE's tab of Lumiverse's drawer or in RPE's web app.
4. **Switch a chat to RPE.** In Lumiverse, open a chat and choose the connection "RPE" for it. Write a message. RPE plays the turn, and the **Live** page in RPE's tab shows what the agents are doing while they work.

`rpe status` says whether RPE answers, which builds are running, and which keys are set. If a reply fails, see [Troubleshooting](docs/troubleshooting.md).

## The pages

RPE's pages are in a tab of Lumiverse's drawer called **RPE**, and in RPE's own web app. The pages of one chat: **Live** (what the agents are doing now), **Turns** (each turn and what its agents did; **Settle now**), **Sessions** (the Author's working memory between turns), **World** (the world's state at any turn), **Places**, **Quests**, **Cast** (each character's whole record), **Story** (the story record, and bootstrap: setting RPE's agents to go over a chat's past), **Lore** (your books and the world's lore as RPE understands them), **Prompt** (how the chat's preset is cut into named parts) and **Play** (the play panels: scene, map, money, gear, vehicles, people, organizations, quests and the rest). The pages for everything: **Build** (the world builder), **Jobs**, **Agents**, **Rules**, **Files**, **Connections**, **Settings**, **Runtime**, **Storage** and **Migration**. The web app also has **Chats**. RPE also draws in the chat itself: the HUD, the controls beside the composer, and the line and markers under each reply. What each does is in [Install and run](docs/install.md#the-pages).

## Already using the previous build?

Do not install over it. Read [Moving from the previous build](docs/migration.md) first. You rehearse the move, run it for real, and only then switch the extension over with Lumiverse's own branch switch. Your chats and their connection keep working, and you can go back to the previous build, which is kept on the branch `before-standalone`.

## What is not in this build

Two things come with a later build:

- **The `lumirpengine` command line and MCP server for outside harnesses.** Until then the commands that read or change worlds and chats say that the command returns with a later build; worlds are edited in **Build**.
- **Talk, the GM assistant chat.** The assistant's definition ships, and nothing starts it yet. The GM assistant threads you had in the previous build are kept in the migration's backup.

RPE never writes your own Lumiverse lore books by itself. It writes an entry only on your word: a lore proposal you approve, or one of Build's actions that write to an entry (its fields, a secret line, the lore index entry, moving a book's secrecy). Each write checks that the entry is as it was read, keeps what it was, and is listed on the **Lore** page with **Put it back**. A chat can have a book of RPE's own, which is off until you switch on `lore.projection`.

## Where to go next

- [Install and run](docs/install.md): the service, the extension, RPE's connection in Lumiverse, the pages, the web app and its key, updating, and every `rpe` command.
- [Moving from the previous build](docs/migration.md): the rehearsal, the real run, the switch, the report, and going back.
- [How behaviour lives in files](docs/behaviour.md): the files the agents read, and how to change what they do.
- [Worlds in RPE](docs/world.md): what a world is, Build, attaching one to a chat, the packs, formulas and recipes.
- [Settings](docs/settings.md): every setting, its default and what it does.
- [Security](docs/security.md): keys, tokens, and what RPE never does by itself.
- [Troubleshooting](docs/troubleshooting.md): what a failed reply's reason means, and what to do.
- [The engine's operations](docs/operations.md): every tool the agents call on the world.

## Building and testing

The built files in `dist/` are part of the repository, so installing the extension or running `dist/rpe.js` needs no build. To build from a clone: `bun install`, then `bun run build`, which builds everything into `dist/`. `bun run test` runs the tests of this build, and `bun run typecheck` checks the types.

## Credits

Parts of the engine are adapted from [Warp](https://github.com/japolino/warp) by japolino, used with the author's permission for this non-commercial project. The details, file by file, are in [NOTICE](NOTICE).

The agents run on [RPHarness](https://github.com/TheLiquorPriest/RPHarness) (`rp-harness`), a harness for roleplay on pi's agent loop, built into RPE.

## License

No license yet; all rights reserved for now. The third-party code in the built bundles is under its own licences: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
