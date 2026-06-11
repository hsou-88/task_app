# Research Planner

Research Planner is a personal time-blocking scheduler for research, reading, classes, English study, and side projects.

The core flow is:

1. Create a task.
2. Set the duration.
3. Drag the task into the weekly calendar.
4. The end time is calculated automatically.
5. Move the task through Todo, Doing, and Done.

## Current Scope

Implemented through a practical v1.0 local-first prototype:

- v0.1: Task CRUD, Todo/Doing/Done Kanban, weekly calendar, drag-to-schedule, localStorage.
- v0.2: Recurring task generation, tags, search, status/project/tag filters.
- v0.3: Project management, default project areas, per-project summaries.
- v0.4: Gantt chart view for weekly project/task planning.
- v1.0: FullCalendar weekly time grid, dnd-kit task dragging, Zustand state store, installable PWA shell, and offline fallback caching.
- v1.1: Event deletion, conflict warnings, persistent week navigation, and JSON backup import/export.
- v1.2: iPhone/iPad responsive layout, iOS PWA metadata, and development cache reset tools.
- v1.3: GitHub Pages deployment workflow and subpath-safe PWA assets.

## Stack

- React
- TypeScript
- Vite
- FullCalendar
- dnd-kit
- Zustand
- CSS via `src/styles.css`
- localStorage
- PWA manifest and service worker
- Docker frontend container

Tailwind CSS is installed for future design-system migration, but the current app uses a focused CSS file while the UI is still evolving.

## Run

With Docker:

```bash
docker build -t research-planner-frontend ./frontend
docker run --rm --name research-planner-dev -p 5173:5173 research-planner-frontend
```

Open:

```text
http://localhost:5173/
```

If an old screen is still shown because of a previous service worker cache, open:

```text
http://localhost:5173/reset.html
```

That page unregisters old service workers, clears browser caches for the app, and redirects back to the planner.

## iPhone / iPad

The UI is responsive for iPhone and iPad widths. For quick testing on the same network, expose the running dev server through the host machine's LAN address and open it from Safari:

```text
http://<your-computer-lan-ip>:5173/
```

For Home Screen installation and offline mode on iPhone/iPad, serve the app over HTTPS. iOS requires a secure context for service workers except on the device's own localhost. Good options are:

- Deploy the built app to an HTTPS host such as Vercel, Netlify, Cloudflare Pages, or GitHub Pages.
- Use an HTTPS tunnel for testing.
- Later, add a production container that serves `npm run build` output behind HTTPS.

## GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

Setup:

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings` > `Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to the `main` branch, or run the workflow manually from the `Actions` tab.

The app will be published at a URL like:

```text
https://<github-user>.github.io/<repository-name>/
```

The app uses `localStorage`, so data is stored per browser/device. GitHub Pages makes the planner reachable outside your Wi-Fi, but it does not sync data between devices. Use `Export` and `Import` for manual backup or moving data between devices.

## Build Check

```bash
docker run --rm research-planner-frontend npm run build
```

Note: the WSL host Node.js in this environment is old, so Docker's Node 22 image is the reliable runtime.

## Next Candidates

- Add event conflict resolution suggestions.
- Add recurring rules beyond daily/weekly.
- Add project-level deadline and progress views.
- Add automated browser tests once the local browser runner is stable.
