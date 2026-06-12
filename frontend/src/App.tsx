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
type ModalMode = 'createTask' | 'taskDetail' | 'projects' | null;
type GanttSortMode = 'project' | 'time';

const recurrenceOptions: {label: string; value: Recurrence}[] = [
  {label: 'None', value: 'none'},
  {label: 'Daily', value: 'daily'},
  {label: 'Weekly', value: 'weekly'},
];
const APP_VERSION = 'v1.3.13';
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

function getInitialDayIndex() {
  const index = dayIndexFromDate(new Date(), getInitialWeekStart());
  return index >= 0 && index <= 6 ? index : 0;
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isDateInRange(date: Date, startDate: string, endDate: string) {
  if (startDate && endDate && startDate > endDate) return isDateInRange(date, endDate, startDate);
  const dateValue = dateInputValue(date);
  const startsAfterStart = !startDate || dateValue >= startDate;
  const endsBeforeEnd = !endDate || dateValue <= endDate;
  return startsAfterStart && endsBeforeEnd;
}

function isDateInRecurrenceRange(date: Date, task: Task) {
  return isDateInRange(date, task.recurrenceStartDate, task.recurrenceEndDate);
}

function getTaskWeeklyDays(task: Task) {
  if (task.recurrenceDays.length > 0) return task.recurrenceDays;
  return task.recurrenceDay === NO_RECURRENCE_DAY ? [] : [task.recurrenceDay];
}

function getTaskRecurrenceDays(task: Task) {
  if (task.recurrence === 'daily') return days.map((_, dayIndex) => dayIndex);
  if (task.recurrence !== 'weekly') return [];
  return getTaskWeeklyDays(task);
}

function createTaskFromForm(formData: FormData, fallbackProjectId: string): Task {
  const duration = Number(formData.get('duration') ?? 60);
  const ganttStartDay = Number(formData.get('ganttStartDay') ?? 0);
  const requestedRecurrence = String(formData.get('recurrence') ?? 'none') as Recurrence;
  const recurrenceDays = formData
    .getAll('recurrenceDays')
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day < days.length);
  const recurrenceDay = Number(formData.get('recurrenceDay') ?? NO_RECURRENCE_DAY);
  const hasWeeklySelection = recurrenceDays.length > 0 || recurrenceDay !== NO_RECURRENCE_DAY;

  return {
    id: crypto.randomUUID(),
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    duration: Number.isFinite(duration) ? Math.max(15, duration) : 60,
    status: 'Todo',
    projectId: String(formData.get('projectId') ?? fallbackProjectId),
    tags: parseTags(formData.get('tags')),
    recurrence: requestedRecurrence === 'none' && hasWeeklySelection ? 'weekly' : requestedRecurrence,
    recurrenceDay: recurrenceDays[0] ?? recurrenceDay,
    recurrenceDays,
    recurrenceStartMinute: Number(formData.get('recurrenceStartMinute') ?? 9 * 60),
    recurrenceStartDate: String(formData.get('recurrenceStartDate') ?? ''),
    recurrenceEndDate: String(formData.get('recurrenceEndDate') ?? ''),
    ganttStartDay,
    ganttEndDay: Math.max(ganttStartDay, Number(formData.get('ganttEndDay') ?? ganttStartDay)),
    ganttStartDate: String(formData.get('ganttStartDate') ?? ''),
    ganttEndDate: String(formData.get('ganttEndDate') ?? ''),
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
  onDelete,
  project,
  selected,
  task,
  onSelect,
}: {
  onDelete: () => void;
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
    <div
      className={`task-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      {...listeners}
      {...attributes}
    >
      <span className="project-dot" style={{backgroundColor: project?.color}} />
      <div className="task-card-title">
        <strong>{task.title}</strong>
        <button
          aria-label={`Delete ${task.title}`}
          className="task-delete-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          x
        </button>
      </div>
      <span>
        {task.duration} min / {project?.name ?? 'No project'}
      </span>
      <div className="tag-row">
        {task.tags.map((tag) => (
          <small key={tag}>{tag}</small>
        ))}
      </div>
    </div>
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
  const [selectedDayIndex, setSelectedDayIndex] = useState(getInitialDayIndex);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [ganttSortMode, setGanttSortMode] = useState<GanttSortMode>('project');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const weekKey = dateInputValue(weekStart);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
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
  const scheduledEvents = useMemo(() => {
    const manualEvents = events.filter((event) => event.source === 'manual' && event.weekStart === weekKey);
    const recurringEvents = tasks.flatMap((task) => {
      if (task.recurrence === 'none') return [];

      const targetDays = getTaskRecurrenceDays(task);
      const startMinute = snapToQuarterHour(task.recurrenceStartMinute);

      return targetDays
        .filter((day) => isDateInRecurrenceRange(addDays(weekStart, day), task))
        .map((day) => ({
          id: `recurring-${weekKey}-${task.id}-${day}`,
          taskId: task.id,
          weekStart: weekKey,
          day,
          startMinute,
          endMinute: Math.min(24 * 60, startMinute + task.duration),
          source: 'recurring' as const,
        }));
    });

    return [...manualEvents, ...recurringEvents];
  }, [events, tasks, weekKey, weekStart]);
  const selectedEvent = scheduledEvents.find((event) => event.id === selectedEventId) ?? null;
  const selectedEventTask = selectedEvent ? tasks.find((task) => task.id === selectedEvent.taskId) ?? null : null;
  const selectedDayTaskIds = useMemo(
    () => new Set(scheduledEvents.filter((event) => event.day === selectedDayIndex).map((event) => event.taskId)),
    [scheduledEvents, selectedDayIndex],
  );
  const scheduledTaskIds = useMemo(() => new Set(scheduledEvents.map((event) => event.taskId)), [scheduledEvents]);
  const selectedDayTasks = useMemo(
    () => filteredTasks.filter((task) => selectedDayTaskIds.has(task.id) || !scheduledTaskIds.has(task.id)),
    [filteredTasks, scheduledTaskIds, selectedDayTaskIds],
  );
  const conflictGroups = useMemo(() => {
    const conflicts: {day: number; first: CalendarEvent; second: CalendarEvent}[] = [];

    for (const day of days.keys()) {
      const dayEvents = scheduledEvents
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
  }, [scheduledEvents]);
  const conflictingEventIds = useMemo(
    () => new Set(conflictGroups.flatMap((conflict) => [conflict.first.id, conflict.second.id])),
    [conflictGroups],
  );
  const calendarEvents = useMemo(
    () =>
      scheduledEvents
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
    [conflictingEventIds, filteredTaskIds, projectById, scheduledEvents, tasks, weekStart],
  );

  const summaries = useMemo(
    () =>
      projects.map((project) => {
        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        const scheduledMinutes = scheduledEvents
          .filter((event) => projectTasks.some((task) => task.id === event.taskId))
          .reduce((total, event) => total + event.endMinute - event.startMinute, 0);
        const doneMinutes = projectTasks
          .filter((task) => task.status === 'Done')
          .reduce((total, task) => total + task.duration, 0);
        const plannedMinutes = projectTasks.reduce((total, task) => total + task.duration, 0);
        return {...project, doneMinutes, plannedMinutes, scheduledMinutes, taskCount: projectTasks.length};
      }),
    [projects, scheduledEvents, tasks],
  );
  const ganttRows = useMemo(() => {
    return filteredTasks
      .map((task) => {
        const taskEvents = scheduledEvents.filter((event) => event.taskId === task.id);
        if (taskEvents.length === 0) return null;
        const start = Math.min(...taskEvents.map((event) => event.day));
        const end = Math.max(...taskEvents.map((event) => event.day));
        const firstStartMinute = Math.min(...taskEvents.filter((event) => event.day === start).map((event) => event.startMinute));
        const lastEndMinute = Math.max(...taskEvents.filter((event) => event.day === end).map((event) => event.endMinute));
        return {task, start, end, firstStartMinute, lastEndMinute};
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        const timeSort = a.start - b.start || a.firstStartMinute - b.firstStartMinute || a.end - b.end || a.lastEndMinute - b.lastEndMinute;
        if (ganttSortMode === 'time') return timeSort || a.task.title.localeCompare(b.task.title);

        const aProject = projectById.get(a.task.projectId)?.name ?? '';
        const bProject = projectById.get(b.task.projectId)?.name ?? '';
        return aProject.localeCompare(bProject) || timeSort || a.task.title.localeCompare(b.task.title);
      });
  }, [filteredTasks, ganttSortMode, projectById, scheduledEvents]);

  function removeTask(taskId: string) {
    deleteTask(taskId);
    if (selectedTaskId === taskId) {
      const nextTask = tasks.find((task) => task.id !== taskId);
      setSelectedTaskId(nextTask?.id ?? '');
    }
    if (selectedEvent?.taskId === taskId) setSelectedEventId('');
  }

  function scheduleTask(taskId: string, day: number, minute: number, source: CalendarEvent['source'] = 'manual', reflectDay = false) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || day < 0 || day > 6) return;

    const startMinute = snapToQuarterHour(minute);
    setSelectedDayIndex(day);
    if (task.recurrence !== 'none') {
      const nextRecurrenceDays =
        task.recurrence === 'weekly' ? Array.from(new Set([...getTaskRecurrenceDays(task), day])).sort((a, b) => a - b) : task.recurrenceDays;
      updateTask({
        ...task,
        recurrenceDay: task.recurrence === 'weekly' ? (nextRecurrenceDays[0] ?? NO_RECURRENCE_DAY) : task.recurrenceDay,
        recurrenceDays: nextRecurrenceDays,
        recurrenceStartMinute: startMinute,
        recurrenceStartDate: task.recurrenceStartDate || dateInputValue(addDays(weekStart, day)),
      });
      return;
    }

    addEvent({
      id: crypto.randomUUID(),
      taskId,
      weekStart: weekKey,
      day,
      startMinute,
      endMinute: Math.min(24 * 60, startMinute + task.duration),
      source,
    });

    if (reflectDay && task.recurrenceDay !== day) {
      updateTask({...task, recurrenceDay: day, recurrenceDays: [day]});
    }
  }

  function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const task = createTaskFromForm(new FormData(event.currentTarget), projects[0]?.id ?? '');
    if (!task.title) return;
    addTask(task);
    setSelectedTaskId(task.id);
    setModalMode(null);
    event.currentTarget.reset();
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const project = createProjectFromForm(new FormData(event.currentTarget));
    if (!project.name) return;
    addProject(project);
    setSelectedProjectId(project.id);
    setModalMode(null);
    event.currentTarget.reset();
  }

  function updateEventFromDates(eventId: string, start: Date | null, end: Date | null) {
    const current = scheduledEvents.find((event) => event.id === eventId);
    if (!current || !start) return;

    const day = dayIndexFromDate(start, weekStart);
    if (day < 0 || day > 6) return;
    setSelectedDayIndex(day);

    const startMinute = snapToQuarterHour(minutesFromDate(start));
    const endMinute = end ? Math.max(startMinute + 15, snapToQuarterHour(minutesFromDate(end))) : current.endMinute;

    if (current.source === 'recurring') {
      const task = tasks.find((item) => item.id === current.taskId);
      if (!task) return;
      const nextRecurrenceDays =
        task.recurrence === 'weekly'
          ? Array.from(new Set(getTaskRecurrenceDays(task).map((item) => (item === current.day ? day : item)))).sort((a, b) => a - b)
          : task.recurrenceDays;

      updateTask({
        ...task,
        recurrenceDay: task.recurrence === 'weekly' ? (nextRecurrenceDays[0] ?? NO_RECURRENCE_DAY) : task.recurrenceDay,
        recurrenceDays: nextRecurrenceDays,
        recurrenceStartMinute: startMinute,
        duration: endMinute - startMinute,
      });
      return;
    }

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

  function closeEventPopup() {
    setSelectedEventId('');
  }

  function deleteSelectedEvent() {
    if (!selectedEvent || !selectedEventTask) return;

    if (selectedEvent.source === 'recurring') {
      if (selectedEventTask.recurrence === 'weekly') {
        const nextRecurrenceDays = getTaskRecurrenceDays(selectedEventTask).filter((day) => day !== selectedEvent.day);
        updateTask({
          ...selectedEventTask,
          recurrence: nextRecurrenceDays.length > 0 ? 'weekly' : 'none',
          recurrenceDay: nextRecurrenceDays[0] ?? NO_RECURRENCE_DAY,
          recurrenceDays: nextRecurrenceDays,
        });
      } else {
        updateTask({...selectedEventTask, recurrence: 'none', recurrenceDay: NO_RECURRENCE_DAY, recurrenceDays: []});
      }
    } else {
      deleteEvent(selectedEvent.id);
    }

    closeEventPopup();
  }

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleTaskDragEnd} onDragStart={(event) => setActiveTaskId(String(event.active.id))}>
      <main className="planner-shell">
        <aside className="sidebar day-board">
          <section className="brand-panel">
            <p className="eyebrow">Research Planner {APP_VERSION}</p>
            <div className="board-title-row">
              <h1>Week Blocking</h1>
              <button aria-label="Create task" className="add-task-button" onClick={() => setModalMode('createTask')} type="button">
                +
              </button>
            </div>
            <div className="view-switch" role="tablist" aria-label="View mode">
              <button className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')} type="button">
                Calendar
              </button>
              <button className={viewMode === 'gantt' ? 'active' : ''} onClick={() => setViewMode('gantt')} type="button">
                Gantt
              </button>
            </div>
            <div className="app-actions">
              <button onClick={() => setModalMode('taskDetail')} disabled={!selectedTask} type="button">
                Task Detail
              </button>
              <button onClick={() => setModalMode('projects')} type="button">
                Projects
              </button>
            </div>
          </section>

          <section className="day-selector" aria-label="Selected day">
            {days.map((day, index) => (
              <button className={selectedDayIndex === index ? 'active' : ''} key={day} onClick={() => setSelectedDayIndex(index)} type="button">
                {day}
              </button>
            ))}
          </section>

          <section className="kanban" aria-label={`${days[selectedDayIndex]} tasks`}>
            <header className="day-board-header">
              <div>
                <p className="eyebrow">Dropped on</p>
                <h2>{days[selectedDayIndex]}</h2>
              </div>
              <span>{selectedDayTasks.length} tasks</span>
            </header>
            {statuses.map((status) => (
              <div className="kanban-column" key={status}>
                <header>
                  <h2>{status}</h2>
                  <span>{selectedDayTasks.filter((task) => task.status === status).length}</span>
                </header>

                <div className="task-list">
                  {selectedDayTasks
                    .filter((task) => task.status === status)
                    .map((task) => (
                      <DraggableTaskCard
                        key={task.id}
                        onDelete={() => removeTask(task.id)}
                        onSelect={() => {
                          setSelectedTaskId(task.id);
                          setModalMode('taskDetail');
                        }}
                        project={projectById.get(task.projectId)}
                        selected={selectedTaskId === task.id}
                        task={task}
                      />
                    ))}
                  {!selectedDayTasks.some((task) => task.status === status) && <p className="empty-state">No tasks</p>}
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
                  const clickedDay = dayIndexFromDate(arg.date, weekStart);
                  if (clickedDay >= 0 && clickedDay <= 6) setSelectedDayIndex(clickedDay);
                  if (selectedTask) scheduleTask(selectedTask.id, clickedDay, minutesFromDate(arg.date));
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
                  const event = scheduledEvents.find((item) => item.id === arg.event.id);
                  if (event) setSelectedDayIndex(event.day);
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
              <div className="gantt-controls">
                <label>
                  Sort
                  <select value={ganttSortMode} onChange={(event) => setGanttSortMode(event.target.value as GanttSortMode)}>
                    <option value="project">Project, then time</option>
                    <option value="time">Time</option>
                  </select>
                </label>
              </div>
              <div className="gantt-row gantt-header">
                <span>Task</span>
                {days.map((day, index) => (
                  <span key={day}>
                    {day}
                    <small>{dateInputValue(addDays(weekStart, index)).slice(5)}</small>
                  </span>
                ))}
              </div>
              {ganttRows.map(({task, start, end, firstStartMinute, lastEndMinute}) => {
                const project = projectById.get(task.projectId);

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
                      {dateInputValue(addDays(weekStart, start)).slice(5)} {formatTime(firstStartMinute)} -{' '}
                      {dateInputValue(addDays(weekStart, end)).slice(5)} {formatTime(lastEndMinute)}
                    </span>
                  </button>
                );
              })}
              {ganttRows.length === 0 && <p className="empty-state gantt-empty">No scheduled tasks this week</p>}
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
                    onClick={deleteSelectedEvent}
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
                  removeTask(selectedTask.id);
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

      {modalMode === 'createTask' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalMode(null)}>
          <section
            aria-label="Create task"
            aria-modal="true"
            className="event-modal app-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <p className="eyebrow">Create Task</p>
                <h2>Add task</h2>
              </div>
              <button aria-label="Close create task" className="icon-button" onClick={() => setModalMode(null)} type="button">
                x
              </button>
            </header>

            <form onSubmit={handleCreateTask} className="stack-form modal-form">
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
              <fieldset className="day-checkboxes">
                <legend>Weekly days</legend>
                {days.map((day, index) => (
                  <label key={day}>
                    <input name="recurrenceDays" type="checkbox" value={index} />
                    {day}
                  </label>
                ))}
              </fieldset>
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
                  Repeat start
                  <input name="recurrenceStartDate" type="date" defaultValue={dateInputValue(weekStart)} />
                </label>
                <label>
                  Repeat end
                  <input name="recurrenceEndDate" type="date" />
                </label>
              </div>
              <div className="field-grid">
                <label>
                  Gantt start
                  <input name="ganttStartDate" type="date" defaultValue={dateInputValue(weekStart)} />
                </label>
                <label>
                  Gantt end
                  <input name="ganttEndDate" type="date" defaultValue={dateInputValue(addDays(weekStart, 6))} />
                </label>
              </div>
              <footer className="modal-actions">
                <button className="secondary" onClick={() => setModalMode(null)} type="button">
                  Cancel
                </button>
                <button type="submit">Add Task</button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {modalMode === 'taskDetail' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalMode(null)}>
          <section
            aria-label="Task details"
            aria-modal="true"
            className="event-modal app-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <p className="eyebrow">Task Detail</p>
                <h2>{selectedTask?.title ?? 'No task selected'}</h2>
              </div>
              <button aria-label="Close task details" className="icon-button" onClick={() => setModalMode(null)} type="button">
                x
              </button>
            </header>

            {selectedTask ? (
              <section className="detail-section modal-section">
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
                      type="number"
                      min="15"
                      step="15"
                      value={selectedTask.duration}
                      onChange={(event) => updateTask({...selectedTask, duration: Number(event.target.value)})}
                    />
                  </label>
                  <label>
                    Status
                    <select value={selectedTask.status} onChange={(event) => updateTask({...selectedTask, status: event.target.value as TaskStatus})}>
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
                  Recurrence
                  <select value={selectedTask.recurrence} onChange={(event) => updateTask({...selectedTask, recurrence: event.target.value as Recurrence})}>
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
                    onChange={(event) => {
                      const day = Number(event.target.value);
                      updateTask({
                        ...selectedTask,
                        recurrence: day === NO_RECURRENCE_DAY ? selectedTask.recurrence : 'weekly',
                        recurrenceDay: day,
                        recurrenceDays: day === NO_RECURRENCE_DAY ? [] : [day],
                      });
                    }}
                  >
                    <option value={NO_RECURRENCE_DAY}>None</option>
                    {days.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="day-checkboxes">
                  <legend>Weekly days</legend>
                  {days.map((day, index) => (
                    <label key={day}>
                      <input
                        checked={getTaskWeeklyDays(selectedTask).includes(index)}
                        onChange={(event) => {
                          const checkedDays = new Set(getTaskWeeklyDays(selectedTask));
                          if (event.target.checked) checkedDays.add(index);
                          else checkedDays.delete(index);
                          const recurrenceDays = Array.from(checkedDays).sort((a, b) => a - b);
                          updateTask({
                            ...selectedTask,
                            recurrence: recurrenceDays.length > 0 ? 'weekly' : selectedTask.recurrence,
                            recurrenceDay: recurrenceDays[0] ?? NO_RECURRENCE_DAY,
                            recurrenceDays,
                          });
                        }}
                        type="checkbox"
                      />
                      {day}
                    </label>
                  ))}
                </fieldset>
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
                    Repeat start
                    <input
                      type="date"
                      value={selectedTask.recurrenceStartDate || dateInputValue(weekStart)}
                      onChange={(event) => updateTask({...selectedTask, recurrenceStartDate: event.target.value})}
                    />
                  </label>
                  <label>
                    Repeat end
                    <input
                      type="date"
                      value={selectedTask.recurrenceEndDate}
                      onChange={(event) => updateTask({...selectedTask, recurrenceEndDate: event.target.value})}
                    />
                  </label>
                </div>
                <div className="field-grid">
                  <label>
                    Gantt start
                    <input
                      type="date"
                      value={selectedTask.ganttStartDate || dateInputValue(weekStart)}
                      onChange={(event) => updateTask({...selectedTask, ganttStartDate: event.target.value})}
                    />
                  </label>
                  <label>
                    Gantt end
                    <input
                      type="date"
                      value={selectedTask.ganttEndDate || dateInputValue(addDays(weekStart, 6))}
                      onChange={(event) => updateTask({...selectedTask, ganttEndDate: event.target.value})}
                    />
                  </label>
                </div>
                <footer className="modal-actions">
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      removeTask(selectedTask.id);
                      setModalMode(null);
                    }}
                  >
                    Delete
                  </button>
                  <button onClick={() => setModalMode(null)} type="button">
                    Done
                  </button>
                </footer>
              </section>
            ) : (
              <p className="empty-state">Select a task first.</p>
            )}
          </section>
        </div>
      )}

      {modalMode === 'projects' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalMode(null)}>
          <section
            aria-label="Projects"
            aria-modal="true"
            className="event-modal app-modal wide"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <p className="eyebrow">Projects</p>
                <h2>Manage</h2>
              </div>
              <button aria-label="Close projects" className="icon-button" onClick={() => setModalMode(null)} type="button">
                x
              </button>
            </header>

            <section className="summary-grid modal-summary" aria-label="Project summaries">
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

            <section className="project-editor modal-section" aria-label="Project management">
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
          </section>
        </div>
      )}

      {selectedEvent && selectedEventTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeEventPopup}>
          <section
            aria-label="Event details"
            aria-modal="true"
            className={`event-modal ${conflictingEventIds.has(selectedEvent.id) ? 'warning' : ''}`}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <p className="eyebrow">{selectedEvent.source === 'recurring' ? 'Recurring Event' : 'Scheduled Event'}</p>
                <h2>{selectedEventTask.title}</h2>
              </div>
              <button aria-label="Close event details" className="icon-button" onClick={closeEventPopup} type="button">
                x
              </button>
            </header>

            <div className="event-modal-body">
              <div className="event-time-row">
                <strong>
                  {days[selectedEvent.day]} {formatTime(selectedEvent.startMinute)} - {formatTime(selectedEvent.endMinute)}
                </strong>
                <span>{projectById.get(selectedEventTask.projectId)?.name ?? 'No project'}</span>
              </div>

              {conflictingEventIds.has(selectedEvent.id) && <p className="event-warning">This event overlaps another event.</p>}

              <label>
                Status
                <select
                  value={selectedEventTask.status}
                  onChange={(event) => updateTask({...selectedEventTask, status: event.target.value as TaskStatus})}
                >
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>

              <label>
                Description
                <textarea
                  rows={4}
                  value={selectedEventTask.description}
                  onChange={(event) => updateTask({...selectedEventTask, description: event.target.value})}
                />
              </label>
            </div>

            <footer className="modal-actions">
              <button className="danger" onClick={deleteSelectedEvent} type="button">
                Delete Event
              </button>
              <button onClick={closeEventPopup} type="button">
                Done
              </button>
            </footer>
          </section>
        </div>
      )}

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
