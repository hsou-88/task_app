import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import {DndContext, DragEndEvent, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors} from '@dnd-kit/core';
import {FormEvent, useMemo, useRef, useState} from 'react';
import {
  CalendarEvent,
  NO_RECURRENCE_DAY,
  Project,
  Recurrence,
  Task,
  TaskStatus,
  days,
  formatTime,
  normalizePlannerData,
  parseTags,
  projectColors,
  snapToQuarterHour,
  statuses,
  usePlannerStore,
} from './plannerStore';

type ViewMode = 'calendar' | 'gantt';
type FilterValue = TaskStatus | 'all';

const recurrenceOptions: {label: string; value: Recurrence}[] = [
  {label: 'None', value: 'none'},
  {label: 'Daily', value: 'daily'},
  {label: 'Weekly', value: 'weekly'},
];
const APP_VERSION = 'v1.3.4';
const WEEK_STORAGE_KEY = 'research-planner-selected-week';

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, daysToAdd: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + daysToAdd);
  return copy;
}

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function dayIndexFromDate(date: Date, weekStart: Date) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function eventDate(weekStart: Date, day: number, minute: number) {
  const date = addDays(weekStart, day);
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

function getInitialWeekStart() {
  const saved = localStorage.getItem(WEEK_STORAGE_KEY);
  if (saved) {
    const date = new Date(saved);
    if (!Number.isNaN(date.getTime())) return startOfWeek(date);
  }

  return startOfWeek(new Date());
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function createTaskFromForm(formData: FormData, fallbackProjectId: string): Task {
  const duration = Number(formData.get('duration') ?? 60);
  const ganttStartDay = Number(formData.get('ganttStartDay') ?? 0);

  return {
    id: crypto.randomUUID(),
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    duration: Number.isFinite(duration) ? Math.max(15, duration) : 60,
    status: 'Todo',
    projectId: String(formData.get('projectId') ?? fallbackProjectId),
    tags: parseTags(formData.get('tags')),
    recurrence: String(formData.get('recurrence') ?? 'none') as Recurrence,
    recurrenceDay: Number(formData.get('recurrenceDay') ?? NO_RECURRENCE_DAY),
    recurrenceStartMinute: Number(formData.get('recurrenceStartMinute') ?? 9 * 60),
    ganttStartDay,
    ganttEndDay: Math.max(ganttStartDay, Number(formData.get('ganttEndDay') ?? ganttStartDay)),
  };
}

function createProjectFromForm(formData: FormData): Project {
  return {
    id: crypto.randomUUID(),
    name: String(formData.get('name') ?? '').trim(),
    color: String(formData.get('color') ?? projectColors[0]),
    goal: String(formData.get('goal') ?? '').trim(),
  };
}

function DraggableTaskCard({
  project,
  selected,
  task,
  onSelect,
}: {
  project?: Project;
  selected: boolean;
  task: Task;
  onSelect: () => void;
}) {
  const {attributes, listeners, setNodeRef, transform, isDragging} = useDraggable({
    id: task.id,
    data: {taskId: task.id},
  });

  return (
    <button
      className={`task-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      type="button"
      {...listeners}
      {...attributes}
    >
      <span className="project-dot" style={{backgroundColor: project?.color}} />
      <strong>{task.title}</strong>
      <span>
        {task.duration} min / {project?.name ?? 'No project'}
      </span>
      <div className="tag-row">
        {task.tags.map((tag) => (
          <small key={tag}>{tag}</small>
        ))}
      </div>
    </button>
  );
}

export default function App() {
  const projects = usePlannerStore((state) => state.projects);
  const tasks = usePlannerStore((state) => state.tasks);
  const events = usePlannerStore((state) => state.events);
  const addTask = usePlannerStore((state) => state.addTask);
  const updateTask = usePlannerStore((state) => state.updateTask);
  const deleteTask = usePlannerStore((state) => state.deleteTask);
  const addProject = usePlannerStore((state) => state.addProject);
  const updateProject = usePlannerStore((state) => state.updateProject);
  const deleteProject = usePlannerStore((state) => state.deleteProject);
  const addEvent = usePlannerStore((state) => state.addEvent);
  const updateEvent = usePlannerStore((state) => state.updateEvent);
  const deleteEvent = usePlannerStore((state) => state.deleteEvent);
  const clearSchedule = usePlannerStore((state) => state.clearSchedule);
  const generateRecurringEvents = usePlannerStore((state) => state.generateRecurringEvents);
  const replaceData = usePlannerStore((state) => state.replaceData);

  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id ?? '');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [weekStart, setWeekStartState] = useState(getInitialWeekStart);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const allTags = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.tags))).sort(), [tasks]);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tasks.filter((task) => {
      const text = `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
      const matchesProject = projectFilter === 'all' || task.projectId === projectFilter;
      const matchesTag = tagFilter === 'all' || task.tags.includes(tagFilter);
      return matchesQuery && matchesStatus && matchesProject && matchesTag;
    });
  }, [projectFilter, query, statusFilter, tagFilter, tasks]);

  const filteredTaskIds = useMemo(() => new Set(filteredTasks.map((task) => task.id)), [filteredTasks]);
  const conflictGroups = useMemo(() => {
    const conflicts: {day: number; first: CalendarEvent; second: CalendarEvent}[] = [];

    for (const day of days.keys()) {
      const dayEvents = events
        .filter((event) => event.day === day)
        .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

      for (let index = 0; index < dayEvents.length; index += 1) {
        for (let next = index + 1; next < dayEvents.length; next += 1) {
          if (dayEvents[index].endMinute <= dayEvents[next].startMinute) break;
          conflicts.push({day, first: dayEvents[index], second: dayEvents[next]});
        }
      }
    }

    return conflicts;
  }, [events]);
  const conflictingEventIds = useMemo(
    () => new Set(conflictGroups.flatMap((conflict) => [conflict.first.id, conflict.second.id])),
    [conflictGroups],
  );
  const calendarEvents = useMemo(
    () =>
      events
        .filter((event) => filteredTaskIds.has(event.taskId))
        .map((event) => {
          const task = tasks.find((item) => item.id === event.taskId);
          const project = task ? projectById.get(task.projectId) : undefined;
          return {
            id: event.id,
            title: task?.title ?? 'Deleted task',
            start: eventDate(weekStart, event.day, event.startMinute),
            end: eventDate(weekStart, event.day, event.endMinute),
            backgroundColor: event.source === 'recurring' ? '#fff3d8' : '#dff3ea',
            borderColor: project?.color ?? '#75b997',
            textColor: '#1b2430',
            extendedProps: {conflict: conflictingEventIds.has(event.id), taskId: event.taskId, source: event.source},
          };
        }),
    [conflictingEventIds, events, filteredTaskIds, projectById, tasks, weekStart],
  );

  const summaries = useMemo(
    () =>
      projects.map((project) => {
        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        const scheduledMinutes = events
          .filter((event) => projectTasks.some((task) => task.id === event.taskId))
          .reduce((total, event) => total + event.endMinute - event.startMinute, 0);
        const doneMinutes = projectTasks
          .filter((task) => task.status === 'Done')
          .reduce((total, task) => total + task.duration, 0);
        const plannedMinutes = projectTasks.reduce((total, task) => total + task.duration, 0);
        return {...project, doneMinutes, plannedMinutes, scheduledMinutes, taskCount: projectTasks.length};
      }),
    [events, projects, tasks],
  );

  function scheduleTask(taskId: string, day: number, minute: number, source: CalendarEvent['source'] = 'manual', reflectDay = false) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || day < 0 || day > 6) return;

    const startMinute = snapToQuarterHour(minute);
    addEvent({
      id: crypto.randomUUID(),
      taskId,
      day,
      startMinute,
      endMinute: Math.min(24 * 60, startMinute + task.duration),
      source,
    });

    if (reflectDay && task.recurrenceDay !== day) {
      updateTask({...task, recurrenceDay: day});
    }
  }

  function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const task = createTaskFromForm(new FormData(event.currentTarget), projects[0]?.id ?? '');
    if (!task.title) return;
    addTask(task);
    setSelectedTaskId(task.id);
    event.currentTarget.reset();
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const project = createProjectFromForm(new FormData(event.currentTarget));
    if (!project.name) return;
    addProject(project);
    setSelectedProjectId(project.id);
    event.currentTarget.reset();
  }

  function updateEventFromDates(eventId: string, start: Date | null, end: Date | null) {
    const current = events.find((event) => event.id === eventId);
    if (!current || !start) return;

    const day = dayIndexFromDate(start, weekStart);
    if (day < 0 || day > 6) return;

    const startMinute = snapToQuarterHour(minutesFromDate(start));
    const endMinute = end ? Math.max(startMinute + 15, snapToQuarterHour(minutesFromDate(end))) : current.endMinute;
    updateEvent({...current, day, startMinute, endMinute});
  }

  function setWeekStart(nextWeekStart: Date) {
    const normalized = startOfWeek(nextWeekStart);
    localStorage.setItem(WEEK_STORAGE_KEY, normalized.toISOString());
    setWeekStartState(normalized);
  }

  function moveWeek(offset: number) {
    setWeekStart(addDays(weekStart, offset * 7));
  }

  function exportBackup() {
    const data = JSON.stringify({projects, tasks, events}, null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `research-planner-${dateInputValue(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file: File | undefined) {
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const imported = normalizePlannerData(JSON.parse(String(reader.result)));
        replaceData(imported);
        setSelectedTaskId(imported.tasks[0]?.id ?? '');
        setSelectedEventId('');
        setSelectedProjectId(imported.projects[0]?.id ?? '');
      } catch {
        window.alert('Could not import this backup file.');
      }
    });
    reader.readAsText(file);
  }

  function handleTaskDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const taskId = String(event.active.id);
    const rect = event.active.rect.current.translated;
    if (!rect) return;

    const dropX = rect.left + rect.width / 2;
    const dropY = rect.top + rect.height / 2;
    const elements = document.elementsFromPoint(dropX, dropY);
    const dateElement = elements.find((element) => element.closest('[data-date]'))?.closest('[data-date]');
    const timeElement = elements.find((element) => element.closest('[data-time]'))?.closest('[data-time]');
    const dateValue = dateElement?.getAttribute('data-date');
    const timeValue = timeElement?.getAttribute('data-time');
    if (!dateValue || !timeValue) return;

    const droppedDate = new Date(`${dateValue}T${timeValue}`);
    scheduleTask(taskId, dayIndexFromDate(droppedDate, weekStart), minutesFromDate(droppedDate), 'manual', true);
  }

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleTaskDragEnd} onDragStart={(event) => setActiveTaskId(String(event.active.id))}>
      <main className="planner-shell">
        <aside className="sidebar">
          <section className="brand-panel">
            <p className="eyebrow">Research Planner {APP_VERSION}</p>
            <h1>Week Blocking</h1>
            <div className="view-switch" role="tablist" aria-label="View mode">
              <button className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')} type="button">
                Calendar
              </button>
              <button className={viewMode === 'gantt' ? 'active' : ''} onClick={() => setViewMode('gantt')} type="button">
                Gantt
              </button>
            </div>
          </section>

          <section className="task-create-panel" aria-label="Create task">
            <h2>Create Task</h2>
            <form onSubmit={handleCreateTask} className="stack-form">
              <input name="title" placeholder="Task title" required />
              <textarea name="description" placeholder="Description" rows={3} />
              <div className="field-grid">
                <label>
                  Minutes
                  <input name="duration" type="number" min="15" step="15" defaultValue="60" />
                </label>
                <label>
                  Project
                  <select name="projectId" defaultValue={projects[0]?.id}>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <input name="tags" placeholder="Tags: paper, seminar" />
              <div className="field-grid">
                <label>
                  Recurrence
                  <select name="recurrence" defaultValue="none">
                    {recurrenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Day
                  <select name="recurrenceDay" defaultValue={NO_RECURRENCE_DAY}>
                    <option value={NO_RECURRENCE_DAY}>None</option>
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Recurrence time
                <select name="recurrenceStartMinute" defaultValue={9 * 60}>
                  {Array.from({length: 24}, (_, hour) => (
                    <option key={hour} value={hour * 60}>
                      {formatTime(hour * 60)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label>
                  Gantt start
                  <select name="ganttStartDay" defaultValue={0}>
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Gantt end
                  <select name="ganttEndDay" defaultValue={0}>
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit">Add Task</button>
            </form>
          </section>

          <section className="filters" aria-label="Search and filters">
            <h2>Search and Filters</h2>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, description, tags" />
            <div className="field-grid">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterValue)}>
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">All tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </section>

          <section className="kanban" aria-label="Tasks">
            {statuses.map((status) => (
              <div className="kanban-column" key={status}>
                <header>
                  <h2>{status}</h2>
                  <span>{filteredTasks.filter((task) => task.status === status).length}</span>
                </header>

                <div className="task-list">
                  {filteredTasks
                    .filter((task) => task.status === status)
                    .map((task) => (
                      <DraggableTaskCard
                        key={task.id}
                        onSelect={() => setSelectedTaskId(task.id)}
                        project={projectById.get(task.projectId)}
                        selected={selectedTaskId === task.id}
                        task={task}
                      />
                    ))}
                </div>
              </div>
            ))}
          </section>
        </aside>

        <section className="workspace">
          <header className="calendar-toolbar">
            <div>
              <p className="eyebrow">FullCalendar / dnd-kit / Zustand / PWA / {APP_VERSION}</p>
              <h2>{viewMode === 'calendar' ? 'Weekly Calendar' : 'Gantt Chart'}</h2>
            </div>
            <div className="toolbar-actions">
              <button type="button" onClick={() => moveWeek(-1)}>
                Prev
              </button>
              <button type="button" onClick={() => setWeekStart(new Date())}>
                Today
              </button>
              <button type="button" onClick={() => moveWeek(1)}>
                Next
              </button>
              <button type="button" onClick={generateRecurringEvents}>
                Generate Recurring
              </button>
              <button type="button" onClick={clearSchedule}>
                Clear Schedule
              </button>
              <button type="button" onClick={exportBackup}>
                Export
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Import
              </button>
              <input
                accept="application/json"
                className="hidden-input"
                onChange={(event) => {
                  importBackup(event.target.files?.[0]);
                  event.target.value = '';
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </header>

          <section className="summary-grid" aria-label="Project summaries">
            {summaries.map((summary) => (
              <button
                className={`summary-card ${selectedProjectId === summary.id ? 'selected' : ''}`}
                key={summary.id}
                onClick={() => setSelectedProjectId(summary.id)}
                type="button"
              >
                <span className="summary-color" style={{backgroundColor: summary.color}} />
                <strong>{summary.name}</strong>
                <span>{summary.taskCount} tasks</span>
                <b>{Math.round(summary.scheduledMinutes / 60)}h scheduled</b>
                <small>
                  {Math.round(summary.doneMinutes / 60)}h done / {Math.round(summary.plannedMinutes / 60)}h planned
                </small>
              </button>
            ))}
          </section>

          <section className="week-status" aria-label="Week and conflicts">
            <span>
              Week of <strong>{dateInputValue(weekStart)}</strong>
            </span>
            {conflictGroups.length > 0 ? (
              <div className="conflict-list" role="status">
                <strong>{conflictGroups.length} conflict{conflictGroups.length === 1 ? '' : 's'}</strong>
                {conflictGroups.slice(0, 4).map((conflict) => {
                  const firstTask = tasks.find((task) => task.id === conflict.first.taskId);
                  const secondTask = tasks.find((task) => task.id === conflict.second.taskId);
                  return (
                    <span key={`${conflict.first.id}-${conflict.second.id}`}>
                      {days[conflict.day]} {formatTime(conflict.second.startMinute)}: {firstTask?.title ?? 'Task'} /{' '}
                      {secondTask?.title ?? 'Task'}
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="no-conflicts">No conflicts</span>
            )}
          </section>

          {viewMode === 'calendar' ? (
            <div className="calendar-frame">
              <FullCalendar
                allDaySlot={false}
                dateClick={(arg) => {
                  if (selectedTask) scheduleTask(selectedTask.id, dayIndexFromDate(arg.date, weekStart), minutesFromDate(arg.date));
                }}
                dayHeaderFormat={{weekday: 'short'}}
                editable
                eventClassNames={(arg) => [
                  arg.event.extendedProps.conflict ? 'has-conflict' : '',
                  arg.event.id === selectedEventId ? 'is-selected' : '',
                ]}
                eventClick={(arg) => {
                  const taskId = String(arg.event.extendedProps.taskId ?? '');
                  if (taskId) setSelectedTaskId(taskId);
                  setSelectedEventId(arg.event.id);
                }}
                eventContent={(arg) => (
                  <div className="fc-task-event">
                    <strong>{arg.event.title}</strong>
                    <span>
                      {arg.timeText}
                      {arg.event.extendedProps.source === 'recurring' ? ' / recurring' : ''}
                    </span>
                  </div>
                )}
                eventDrop={(arg) => updateEventFromDates(arg.event.id, arg.event.start, arg.event.end)}
                eventResize={(arg) => updateEventFromDates(arg.event.id, arg.event.start, arg.event.end)}
                events={calendarEvents}
                expandRows
                firstDay={1}
                headerToolbar={false}
                height="100%"
                initialDate={weekStart}
                initialView="timeGridWeek"
                key={weekStart.toISOString()}
                plugins={[timeGridPlugin, interactionPlugin]}
                slotDuration="00:15:00"
                slotLabelInterval="01:00:00"
                slotMaxTime="24:00:00"
                slotMinTime="00:00:00"
                snapDuration="00:15:00"
              />
            </div>
          ) : (
            <div className="gantt-chart" aria-label="Gantt chart">
              <div className="gantt-row gantt-header">
                <span>Task</span>
                {days.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              {filteredTasks.map((task) => {
                const project = projectById.get(task.projectId);
                const start = Math.min(task.ganttStartDay, task.ganttEndDay);
                const end = Math.max(task.ganttStartDay, task.ganttEndDay);

                return (
                  <button className="gantt-row" key={task.id} onClick={() => setSelectedTaskId(task.id)} type="button">
                    <span className="gantt-title">
                      <b>{task.title}</b>
                      <small>{project?.name}</small>
                    </span>
                    <span
                      className="gantt-bar"
                      style={{
                        backgroundColor: project?.color,
                        gridColumn: `${start + 2} / ${end + 3}`,
                      }}
                    >
                      {days[start]} - {days[end]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="detail-panel" aria-label="Details">
          {selectedTask ? (
            <section className="detail-section">
              <header>
                <p className="eyebrow">Task Detail</p>
                <h2>Edit</h2>
              </header>

              <label>
                Title
                <input value={selectedTask.title} onChange={(event) => updateTask({...selectedTask, title: event.target.value})} />
              </label>
              <label>
                Description
                <textarea
                  rows={4}
                  value={selectedTask.description}
                  onChange={(event) => updateTask({...selectedTask, description: event.target.value})}
                />
              </label>
              <div className="field-grid">
                <label>
                  Minutes
                  <input
                    min="15"
                    step="15"
                    type="number"
                    value={selectedTask.duration}
                    onChange={(event) => updateTask({...selectedTask, duration: Number(event.target.value)})}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={selectedTask.status}
                    onChange={(event) => updateTask({...selectedTask, status: event.target.value as TaskStatus})}
                  >
                    {statuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Project
                <select value={selectedTask.projectId} onChange={(event) => updateTask({...selectedTask, projectId: event.target.value})}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input
                  value={selectedTask.tags.join(', ')}
                  onChange={(event) => updateTask({...selectedTask, tags: parseTags(event.target.value)})}
                />
              </label>
              <div className="field-grid">
                <label>
                  Recurrence
                  <select
                    value={selectedTask.recurrence}
                    onChange={(event) => updateTask({...selectedTask, recurrence: event.target.value as Recurrence})}
                  >
                    {recurrenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Day
                  <select
                    value={selectedTask.recurrenceDay}
                    onChange={(event) => updateTask({...selectedTask, recurrenceDay: Number(event.target.value)})}
                  >
                    <option value={NO_RECURRENCE_DAY}>None</option>
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Recurrence time
                <select
                  value={selectedTask.recurrenceStartMinute}
                  onChange={(event) => updateTask({...selectedTask, recurrenceStartMinute: Number(event.target.value)})}
                >
                  {Array.from({length: 24}, (_, hour) => (
                    <option key={hour} value={hour * 60}>
                      {formatTime(hour * 60)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label>
                  Gantt start
                  <select
                    value={selectedTask.ganttStartDay}
                    onChange={(event) => updateTask({...selectedTask, ganttStartDay: Number(event.target.value)})}
                  >
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Gantt end
                  <select
                    value={selectedTask.ganttEndDay}
                    onChange={(event) => updateTask({...selectedTask, ganttEndDay: Number(event.target.value)})}
                  >
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedEvent && selectedEvent.taskId === selectedTask.id && (
                <div className={`event-detail ${conflictingEventIds.has(selectedEvent.id) ? 'warning' : ''}`}>
                  <p className="eyebrow">Selected Event</p>
                  <strong>
                    {days[selectedEvent.day]} {formatTime(selectedEvent.startMinute)} - {formatTime(selectedEvent.endMinute)}
                  </strong>
                  <span>{selectedEvent.source === 'recurring' ? 'Recurring event' : 'Manual event'}</span>
                  {conflictingEventIds.has(selectedEvent.id) && <span>This event overlaps another event.</span>}
                  <button
                    className="danger"
                    onClick={() => {
                      deleteEvent(selectedEvent.id);
                      setSelectedEventId('');
                    }}
                    type="button"
                  >
                    Delete Event
                  </button>
                </div>
              )}

              <button
                className="danger"
                type="button"
                onClick={() => {
                  deleteTask(selectedTask.id);
                  setSelectedEventId('');
                }}
              >
                Delete
              </button>
            </section>
          ) : (
            <p className="muted">Select a task to edit it.</p>
          )}

          <section className="project-editor" aria-label="Project management">
            <header>
              <p className="eyebrow">Projects</p>
              <h2>Manage</h2>
            </header>
            <form onSubmit={handleCreateProject} className="stack-form">
              <input name="name" placeholder="New project name" />
              <input name="goal" placeholder="Goal or note" />
              <select name="color" defaultValue={projectColors[0]}>
                {projectColors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <button type="submit">Add Project</button>
            </form>

            {selectedProject && (
              <div className="selected-project">
                <label>
                  Name
                  <input value={selectedProject.name} onChange={(event) => updateProject({...selectedProject, name: event.target.value})} />
                </label>
                <label>
                  Goal
                  <textarea
                    rows={3}
                    value={selectedProject.goal}
                    onChange={(event) => updateProject({...selectedProject, goal: event.target.value})}
                  />
                </label>
                <label>
                  Color
                  <select value={selectedProject.color} onChange={(event) => updateProject({...selectedProject, color: event.target.value})}>
                    {projectColors.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="danger"
                  disabled={projects.length <= 1}
                  type="button"
                  onClick={() => {
                    const fallbackProject = projects.find((project) => project.id !== selectedProject.id);
                    deleteProject(selectedProject.id);
                    setSelectedProjectId(fallbackProject?.id ?? '');
                    if (projectFilter === selectedProject.id) setProjectFilter('all');
                  }}
                >
                  Delete Project
                </button>
              </div>
            )}
          </section>
        </aside>
      </main>

      <DragOverlay>
        {activeTask ? (
          <div className="task-card drag-overlay">
            <strong>{activeTask.title}</strong>
            <span>{activeTask.duration} min</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
