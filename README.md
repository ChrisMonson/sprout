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
- Claude Code, signed in with your Claude subscription (`claude`, then `/login`)

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
- It needs no Node or npm on the Mac: its own binary runs everything, and the sprout dependencies ship inside it. It still needs git (Apple's Command Line Tools) and a Claude sign-in; if either is missing, Sprout says so and offers to open Terminal for `/login`.
- Closing the window keeps Sprout running in the menu bar, so agents keep working and reminders keep arriving. From the menu bar icon you can open any sprout, rest or resume all of them, turn on Open at login, or quit.
- Notifications are Sprout's own, and clicking one opens that sprout.
- Only one greenhouse runs per Sprout folder, so `npm run dev` refuses to start while the app is open, and the other way round.
- The build is ad-hoc signed for your own Mac. Sharing it needs Developer ID signing and notarization (not set up yet).

For development, `npm run desktop:dev` runs the app unpackaged, as **Sprout Dev** (its own name, icon and identity), against your real `~/Sprout`. Quit the installed Sprout first, since only one greenhouse can run per folder; Sprout Dev tells you if one already is.
- edits to `web/` hot-reload in the window
- edits to `server/` rebuild automatically and restart the greenhouse in a second or two, window open (an agent turn in progress starts over)
- edits to `desktop/main.ts` (window, menu bar, notifications) need a relaunch

`npm run desktop` builds once and runs it the way the packaged app does. `npx electron dist/desktop/selftest.mjs` runs the gate's pass/fail scenarios inside Electron.

### Greenhouse Settings

The cog on the home page opens Settings:
- **Use Claude** turns Claude on or off. With it off, Sprout never contacts Claude: your tools keep running, reminders arrive and you can import sprouts, but nothing grows and new sprouts can't be planted. Whispers wait until it's back on.
- **Models** come live from your Claude account. Pick a preset (Balanced, Thorough, Light) or a model and effort for each step (questions, planting, growing, observing). A family like `opus` always uses its newest version; a specific version stays pinned, and falls back to its family if your account stops offering it. Each turn records the exact model that ran.
- **Agents working at once**: 1 to 4.

A turn that fails waits before retrying (1, then 5, then 30 minutes) instead of trying again right away.

Settings (environment variables):
- `SPROUT_HOME`: where sprouts live (default `~/Sprout`)
- `SPROUT_PORT`: greenhouse port (default `4100`)
- `SPROUT_CONCURRENCY`: the starting value for agents working at once (default `1`; Settings overrides it)

> **Personal use only, for now.** Sprout runs agents on the Claude subscription you're signed in with. Anthropic's terms don't allow a third-party app to route other people's Pro/Max credentials. Before sharing Sprout, add an API-key path in `server/agent/credentials.ts`, the only place that handles sign-in.

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
runtime/       copied into SPROUT_HOME: per-sprout Vite runner, plugin, observer script
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

The **greenhouse is never edited by an agent.** It owns the gate, scheduling, rollback, and the observer.

### Turns

| Turn | When | Model | Changes code |
|---|---|---|---|
| Questions | while you describe the tool | Haiku | no |
| Plant | you press "Plant it" | Opus | yes |
| Grow | a whisper, an accepted bud, an answered question, errors, or a rollback | Opus | yes |
| Observe | enough new usage, at most every 5 minutes | Haiku | no (journal, buds) |

How every turn runs:
- Each turn is a fresh Agent SDK session. Memory comes from files, not session resume.
- File tools are confined to `work/` by a `PreToolUse` hook and `canUseTool` (see `server/agent/confine.ts`).
- Bash runs in the Claude Code sandbox with no network access.
- Your own `~/.claude` settings never load.
- A wall-clock deadline aborts any turn that runs too long.
- Transcripts are kept in `SPROUT_HOME/turns/`.

### Gate, apply, rollback

A change has to pass the gate before it's saved (`server/gate.ts`):
1. Migrations only add (`server/migrations.ts`).
2. Types check.
3. It builds.
4. It loads in headless Chromium against a throwaway copy of your data with no console errors, page crashes, or `/api` 5xx responses.

Saved changes go live at a quiet moment (10s without input), fast-forwarding `live/` so Vite hot-reloads them. If errors spike in the two minutes after a change, the watchdog reverts it and tells the agent. **Rewind** in History is your own undo.

Code rolls back but data doesn't, which is why migrations may only add.

## Tests

```bash
npm test
```

```bash
npm run test:integration
```

`npm test` runs the unit tests: path confinement, the migration rules, and the wake rules. `npm run test:integration` runs the real gate against a real sprout: install, build, browser, and WAL-safe snapshots.

## Lineage

The agent loop, wake rules, gate, and rollback ideas come from Og-World and its supervisor, ported to TypeScript and the Agent SDK.
