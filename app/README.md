# Dispatch — Phone App

Voice/text remote for an async coding agent. Built with **Expo + expo-router**, optimized for a working **web** build (dark-theme phone screens matching the Dispatch design).

## Run on web

From this directory (`dispatch/app`):

```bash
npm install          # first time only
npx expo start --web
```

Metro serves on **http://localhost:8081** (open it in a browser). The app renders
inside a centered phone frame on web.

- Confirmed compiling: `Web Bundled … node_modules/expo-router/entry.js (872 modules)`.
- If port 8081 is taken, pass `--port <n>`.

## Point at the backend

The app talks to the Dispatch backend REST API. Default base URL is
`http://localhost:4000`. Override with an env var (Expo public env):

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.50:4000 npx expo start --web
```

Auth is the static dev token `dev-token` (sent as `Authorization: Bearer dev-token`),
per the protocol. Start the backend separately:

```bash
cd ../backend && npm install && npm start   # listens on :4000
```

If the backend is not running, the app does **not** crash — every screen shows a
subtle "backend offline · retrying…" banner and keeps polling every 2s.

## Screens (routes)

| Route | Screen |
|---|---|
| `app/(tabs)/index.js` | **Capture** (home) — context bar, mic placeholder, text input → `POST /api/tasks`, Recent list |
| `app/(tabs)/tasks.js` | **Task Board** — grouped by Needs you / Running / Ready / Blocked |
| `app/(tabs)/digest.js` | **Digest** — triaged roll-up (needs-you / ready / blocked counts) |
| `app/(tabs)/settings.js` | **Settings** — runner status from `/api/health`, static prefs, autonomy "Draft only" |
| `app/repo-picker.js` | **Repo Picker** — `GET /api/repos`, client-side search, Pinned/Recent/All → `POST /api/context` |
| `app/branch-picker.js` | **Branch Picker** — protected default, recent branches, create branch (kebab-case slug) → `POST /api/context` |
| `app/spec/[id].js` | **Spec Confirm** — goal, assumptions, acceptance, risk, confidence meter → confirm/hold |
| `app/tasks/[id].js` | **Task Detail** — confidence-first summary, progress list, PR link |

## Data layer

- `src/api.js` — REST client (`API_BASE`, `dev-token`).
- `src/hooks.js` — 2s polling hooks (`useTasks`, `useHealth`, `useContext`) with graceful offline handling. No websockets required in v0.
- `src/theme.js` — design tokens + task-state → status mapping.
- `src/ui.js`, `src/components.js` — shared UI primitives (status bar, context bar, task rows, buttons, cards).

## Notes

- Live updates use polling (setInterval 2s), not websockets — more robust for the web build.
- Voice capture is a v0 placeholder (mic button toggles a hint); the text field is the primary capture path.
- Native (iOS/Android) compatibility is preserved, but there is no emulator here — web is the tested target.
