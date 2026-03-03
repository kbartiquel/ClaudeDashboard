# Claude Dashboard

A Mac desktop app that solves the problem of managing Claude Code CLI sessions — browsing conversation history, switching between projects, and launching terminal sessions — all from one interface instead of juggling multiple terminal windows.

## The Problem

Claude Code CLI is powerful but managing it gets messy fast:

- **Scattered conversations** — Your chat history lives in hidden JSONL files under `~/.claude/projects/`. Finding an old conversation means digging through encoded directory names like `-Users-you-Documents-PROJECTS-ForexBot`.
- **No overview** — There's no way to see all your projects and conversations at a glance. You have to remember which folder you were in and what session ID to resume.
- **One session at a time** — Working on multiple projects means opening multiple terminal windows, losing track of which is which.
- **Memory files are hidden** — Claude's per-project memory (`MEMORY.md`, topic files) is buried in `~/.claude/` and never makes it into your actual project repo.
- **Can't drag files in** — Sharing screenshots or files with Claude means typing out full file paths manually.

## What This App Does

- **Project sidebar** — Auto-discovers all your Claude Code projects with human-readable names. Expand any project to see its conversations.
- **Multiple terminal tabs** — Open several Claude sessions as tabs with project titles. Each runs a real `claude` CLI instance via node-pty.
- **Conversation browser** — Read full chat history with syntax-highlighted code blocks, formatted markdown, and tool use details.
- **Search** — Search across all conversations in all projects.
- **Resume sessions** — One-click resume any past conversation, either in the dashboard terminal or in an external Terminal.app window.
- **Rename conversations** — Give conversations meaningful names instead of "Implement the following plan..."
- **Sync Memory** — One button to copy Claude's memory files from `~/.claude/projects/.../memory/` into your actual project's `docs/` folder.
- **Drag & drop** — Drag any file (images, PDFs, code files) into the terminal. Files from the iOS Simulator work too — they get saved to a temp path automatically.
- **Dark / Light mode** — Toggle in the sidebar.
- **Portable** — Config is stored in `~/.claude-dashboard/` with auto-detection of project directories. No hardcoded paths. Works on any Mac.

## Requirements

- macOS (Apple Silicon or Intel)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`~/.local/bin/claude`)

## Install

Download the DMG for your architecture from [Releases](https://github.com/kbartiquel/ClaudeDashboard/releases):

- `Claude Dashboard-1.0.0-arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
- `Claude Dashboard-1.0.0.dmg` — Intel

Since the app is unsigned, right-click → **Open** on first launch to bypass Gatekeeper.

## Build from Source

```bash
git clone git@github.com:kbartiquel/ClaudeDashboard.git
cd ClaudeDashboard
npm install
npm run build    # produces DMGs in dist/
npm start        # or run in dev mode
```

## First Launch

On first launch the app auto-detects your project directories from `~/.claude/projects/`. You can also add or remove scan directories in **Settings**.

## Architecture

```
main.js              Electron main process, IPC handlers
preload.js           Context bridge (folder picker, file save, external terminal)
backend/
  server.js          Express API + WebSocket server (runs inside Electron)
  claude-data.js     Parses ~/.claude/ JSONL files, resolves project names
  config.js          User config in ~/.claude-dashboard/
  terminal.js        node-pty session management, PATH resolution
frontend/
  index.html         SPA shell
  js/app.js          Hash router
  js/api.js          API client
  js/components/     Sidebar, tabs, message renderer, code blocks
  js/pages/          Dashboard, projects, conversation, settings, search
  css/               Dark/light theme styles
  vendor/            xterm.js, marked, highlight.js
```

## License

MIT
