# Research Planner

Research Planner is a personal time-blocking scheduler for research, reading, classes, English study, and side projects.

The core flow is:

1. Create a task.
2. Set the duration.
3. Drag the task into the weekly calendar.
4. The end time is calculated automatically.
5. Move the task through Todo, Doing, and Done.

## Current Scope

Implemented through a practical v0.4 prototype:

- v0.1: Task CRUD, Todo/Doing/Done Kanban, weekly calendar, drag-to-schedule, localStorage.
- v0.2: Recurring task generation, tags, search, status/project/tag filters.
- v0.3: Project management, default project areas, per-project summaries.
- v0.4: Gantt chart view for weekly project/task planning.

## Stack

- React
- TypeScript
- Vite
- CSS modules via `src/styles.css`
- localStorage
- Docker frontend container

Dependencies for future migration are already present:

- FullCalendar
- dnd-kit
- Zustand
- Tailwind CSS

The current prototype uses lightweight native drag-and-drop and React state so the core workflow stays simple while the product shape is still moving.

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

## Build Check

```bash
docker run --rm research-planner-frontend npm run build
```

Note: the WSL host Node.js in this environment is old, so Docker's Node 22 image is the reliable runtime.

## Next Candidates

- Replace native drag-and-drop with dnd-kit.
- Replace the custom weekly grid with FullCalendar once event editing/resizing becomes important.
- Move state into Zustand stores.
- Add PWA support and offline caching for v1.0.
