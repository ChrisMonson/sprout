# Sprout

Grow tools that build, maintain, and improve themselves.

You describe a tool you wish you had ("What do you want to grow?"). Sprout asks a few follow-up questions and asks how it should feel. Then a Claude Code agent builds the first version. After that, the tool keeps getting better as you use it. The agent learns from the errors it sees, from how you use the tool, and from things you point at and say ("whispers").

Drag sprouts in the home tray to reorder them (or focus one and press Option-← / →). **Export** any sprout from its Settings (the cog) as a single `.sprout` file (its code with full history, its agent's memory, and optionally your data), and **Import…** one from the home page. An imported sprout arrives resting, with Growth off.

Growth follows evidence: it happens because you asked for something, said yes to a suggestion, or the tool broke. Ideas you didn't ask for arrive as **buds**, and nothing gets built unless you say yes. Turn **Growth** off and the tool stops changing on its own; it still does what you ask it to.

## Running it

Requirements:
- macOS (the agent sandbox uses macOS Seatbelt)
- Node 24 or newer
- Git
- To grow sprouts: Claude Code signed in to your Claude account (`claude auth login`), or an Anthropic API key added in Settings. Without either, Sprout still runs your sprouts; it just can't grow them.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:4100. The first start installs the shared sprout runtime into `~/Sprout` and a headless Chromium used to check changes.

### As a Mac app

```bash
npm run package
```

This builds `release/mac-arm64/Sprout.app` (and a `.dmg`). Drag it to Applications and open it.

How the app behaves:
- It needs no Node or npm on the Mac: its own binary runs everything, and the sprout dependencies ship inside it. It still needs git (Apple's Command Line Tools), and Claude to grow sprouts; if you're not signed in, Sign in opens Terminal on `claude auth login` and Sprout notices when you're done.
- Closing the window keeps Sprout running in the menu bar, so agents keep working and reminders keep arriving. From the menu bar icon you can open any sprout, rest or resume all of them (when Claude is on), turn on Open at login, or quit.
- Notifications are Sprout's own, and clicking one opens that sprout.
- Only one greenhouse runs per Sprout folder, so `npm run dev` refuses to start while the app is open, and the other way round.
- The build is ad-hoc signed for your own Mac. Sharing it needs Developer ID signing and notarization (not set up yet).

### Developing the Mac app

```bash
npm run desktop:dev
```

This runs the app unpackaged, as **Sprout Dev** (its own name, icon and identity), against your real `~/Sprout`. Quit the installed Sprout first, since only one greenhouse can run per folder; Sprout Dev tells you if one already is. Set `SPROUT_HOME` to point it at another folder instead.
- edits to `web/` hot-reload in the window
- edits to `server/` rebuild automatically and restart the greenhouse in a second or two, window open (an agent turn in progress starts over)
- edits to `desktop/main.ts` (window, menu bar, notifications) need a relaunch: quit Sprout Dev (Ctrl-C in its terminal, or Quit from its menu bar icon) and run the command again
- edits to `runtime/` (the files copied into `~/Sprout/.runtime`) take effect at the next greenhouse start

Other ways to run it:
- `npm run desktop` builds once and runs it the way the packaged app does.
- `npx electron dist/desktop/selftest.mjs` runs the gate's pass/fail scenarios inside Electron.

### A sprout's own Settings

The cog in a sprout's top bar opens its Settings:
- **Name and description**: renaming wakes its agent to update any name the tool shows.
- **Icon**: Claude draws one for every sprout, in its current colors (new sprouts right after planting; older ones shortly after Sprout starts). **Use my own SVG…** replaces it (it's cleaned of scripts and outside references first), **Draw a new one** asks Claude for another. Icons show on the home tray, in the menu bar list, on its notifications and as its phone app's icon, and travel in exports (`server/icons.ts`).
- **Files**: what you've given it (see below).
- **Export**, **Harvest** (see Harvest to Android) and **Remove**.

### Without Claude

Using Sprout without Claude is normal: with Claude off, or before you've signed in, your sprouts keep running, reminders arrive and you can import sprouts. What would need Claude steps aside: a sprout's Growth switch, whisper bar and Sprout's ideas and questions are hidden (so are Grow/Rest all in the menu bar), and Grow explains what Claude does for Sprout and offers the one step that would make it work (turn it on, sign in, or add an API key).

### Giving a sprout files

Attach files to anything you tell a sprout (the paperclip in the whisper bar, or drop them on the page), or when you first describe it. Art, sounds, fonts, data or a picture to work from all work. They're kept in the sprout's `uploads` folder, outside its code, which its agent can read but not change. The agent copies what the tool actually uses into `public/assets`, so those are saved in its history, exported and built into phone apps; a reference picture stays where it is. Up to 25 MB a file and 300 MB a sprout (`server/uploads.ts`).

The sprout's Settings has a **Files** section that lists them, marks the ones the tool uses, and deletes one or all the unused ones; deleting never changes the tool, since what it uses is already part of it. Delete forever erases them with the sprout, and files given on the Grow page to a sprout that was never planted are discarded after a day.

### Greenhouse Settings

The cog on the home page opens Settings:
- **Appearance**: System (the default), Light or Dark, for Sprout's own screens. Each sprout keeps the look it was planted with.
- **Use Claude** turns Claude on or off. With it off, Sprout never contacts Claude: your tools keep running, reminders arrive and you can import sprouts, but nothing grows and new sprouts can't be planted. Whispers wait until it's back on.
- **Sign in with**: your Claude account (your Claude plan; the sign-in Claude Code keeps, made with `claude auth login`) or an Anthropic API key, billed per use. The key is kept in the macOS keychain (service "Sprout"); settings keep only its last four characters.
- **Usage**: on a Claude plan, how much of your session (5-hour) and weekly limits are used, account-wide, with reset times; with an API key, what Sprout has spent today and this month. The same readout sits in each sprout's top bar, the home page mentions it only past 80% of a session, and History shows what growing that sprout has cost. Plan numbers come from the Agent SDK's experimental usage call and from rate-limit updates during turns (`server/usage.ts`).
- **Models** come live from your Claude account. Pick a preset (Balanced, Thorough, Light) or a model and effort for each step (questions, planting, growing, observing). A family like `opus` always uses its newest version; a specific version stays pinned, and falls back to its family if your account stops offering it. Each turn records the exact model that ran.
- **Agents working at once**: 1 to 4.

A turn that fails waits before retrying (1, then 5, then 30 minutes) instead of trying again right away.

Settings (environment variables):
- `SPROUT_HOME`: where sprouts live (default `~/Sprout`)
- `SPROUT_PORT`: greenhouse port (default `4100`)
- `SPROUT_CONCURRENCY`: the starting value for agents working at once (default `1`; Settings overrides it)

> **Sharing Sprout:** someone else running it should use their own API key, not your Claude plan. Anthropic doesn't allow third-party developers to offer Claude account (claude.ai) sign-in in products built on the Agent SDK without its approval, so on a Claude plan Sprout is for your own use. See the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) ("Authentication and credential use"). `server/agent/credentials.ts` is the one place that decides how agents sign in.

### Harvest to Android

A sprout's Settings drawer can **Harvest** it into an Android app, installed over `adb` on a phone with USB debugging on or on an emulator, or saved as an `.apk`. It needs Android Studio (for the SDK and its Java). The app is a copy: the sprout's own code runs on the phone with its own database, optionally starting from your data, but it doesn't grow there and nothing flows back.

- The sprout's server runs inside the app's web view: `/api` requests go straight to its Hono app, `node:sqlite` is swapped for sql.js (saved to the phone after writes), outside `fetch` goes through Android's networking, and `notify()` schedules Android notifications (`runtime/harvest/`).
- Harvesting again keeps the data already on the phone; new migrations still apply.
- Background checks keep going while the app is closed: Android wakes it every 15 minutes at best (WorkManager), loads it in a hidden web view, runs its `every()` tasks (or the `setInterval` timers its server starts as it loads), saves and sleeps again. A native helper does that run's outside `fetch` and notifications (`runtime/harvest/android/`). If the app saved while a background run was going, the run's changes are dropped, and the open app reloads after a run so it shows what was found.
- A sprout that needs Node itself (files, UDP, other programs) can't be harvested, and the drawer says why (`server/harvest/check.ts`).
- Each sprout's Android project lives in `~/Sprout/harvest/<id>`. The first harvest downloads Gradle and takes a few minutes; later ones take seconds to a minute.

## How it fits together

```
server/        the greenhouse: API, scheduler, agent runner, gate, apply/rollback
desktop/       the Mac app: window, menu bar, notifications, hidden-window browser check
web/           the greenhouse UI (React): seed → questions → feel → sprouting → the tool
runtime/       copied into SPROUT_HOME: per-sprout Vite runner, plugin, observer script,
               @sprout/greenhouse (sdk/), and what phone builds use (harvest/)
template/      the starting point for every new sprout
briefs/        what the agent is told, per kind of turn
test/          unit tests; *.integration.test.ts runs the real gate
```

Each sprout lives in `SPROUT_HOME/sprouts/<id>/`:
- `live/`: the git repo (`main`) that you see, served by its own Vite dev server with hot reload
- `work/`: a worktree on branch `growing` where the agent edits
- `data/app.db`: the tool's SQLite data
- `snapshots/`: a database backup taken before every change goes live
- `memory/`: the agent's journal and understanding, kept outside git so rewinds never erase what it learned
- `uploads/`: files you gave it (read-only to the agent)
- `icon.svg`, `icon-custom.svg`, `icon-cache/`: the drawn icon, yours if you chose one, and PNGs made from it
- `devserver.log`: its dev server's output

Phone builds live apart, in `SPROUT_HOME/harvest/<id>/`.

Sprout server code can import `@sprout/greenhouse` (`runtime/sdk/`): `notify()` and `cancelNotification()` for reminders (macOS notifications, or Android ones in a phone build), and `every(interval, task)` for checks that should keep going (on the Mac like `setInterval`; in a phone build Android also runs them while the app is closed).

The **greenhouse is never edited by an agent.** It owns the gate, scheduling, rollback, and the observer.

### Turns

| Turn | When | Model (Balanced preset) | Changes code |
|---|---|---|---|
| Questions | while you describe the tool | Haiku | no |
| Plant | you press "Plant it" | Opus | yes |
| Grow | a whisper (with or without files), an accepted bud, an answered question, a rename, errors, or a rollback | Opus | yes |
| Observe | enough new usage, at most every 5 minutes | Haiku | no (journal, buds) |

The models are whatever Greenhouse Settings says; the column shows the default preset. A few smaller calls sit outside turns: drawing a sprout's icon (with the planting model), checking the Claude sign-in, reading plan usage, and listing the models your account offers.

How every turn runs:
- Each turn is a fresh Agent SDK session. Memory comes from files, not session resume.
- File tools are confined to `work/` by a `PreToolUse` hook and `canUseTool` (see `server/agent/confine.ts`), plus read-only access to the sprout's `uploads/`.
- Bash runs in the Claude Code sandbox with no network access; it can write only in `work/`, and read `uploads/` (to copy files into the tool).
- Your own `~/.claude` settings never load.
- A wall-clock deadline aborts any turn that runs too long.
- Transcripts are kept in `SPROUT_HOME/turns/`.

### Gate, apply, rollback

A change has to pass the gate before it's saved (`server/gate.ts`):
1. Migrations only add (`server/migrations.ts`).
2. Types check.
3. It builds.
4. It loads in headless Chromium (a hidden window, in the Mac app) against a throwaway copy of your data with no console errors, page crashes, or `/api` 5xx responses.

Saved changes go live at a quiet moment (10s without input), fast-forwarding `live/` so Vite hot-reloads them. If errors spike in the two minutes after a change, the watchdog reverts it and tells the agent. **Rewind** in History is your own undo.

Code rolls back but data doesn't, which is why migrations may only add.

## Tests

```bash
npm test
```

```bash
npm run test:integration
```

`npm test` runs the unit tests (`test/*.test.ts`): path confinement, the migration and wake rules, settings and sign-in, runtime setup and the greenhouse lock, export and import, ordering, removal, notifications, memory notes, icons, uploads, usage, and Harvest (the portability check, the phone's SQLite and its saving). `npm run test:integration` runs the real gate against a real sprout: install, build, browser, and WAL-safe snapshots.

## Lineage

The agent loop, wake rules, gate, and rollback ideas come from Og-World and its supervisor, ported to TypeScript and the Agent SDK.
