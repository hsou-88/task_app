import {FormEvent, useEffect, useMemo, useState} from 'react';

type TaskStatus = 'Todo' | 'Doing' | 'Done';
type Recurrence = 'none' | 'daily' | 'weekly';
type ViewMode = 'calendar' | 'gantt';

type Project = {
  id: string;
  name: string;
  color: string;
  goal: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  duration: number;
  status: TaskStatus;
  projectId: string;
  tags: string[];
  recurrence: Recurrence;
  recurrenceDay: number;
  recurrenceStartMinute: number;
  ganttStartDay: number;
  ganttEndDay: number;
};

type CalendarEvent = {
  id: string;
  taskId: string;
  day: number;
  startMinute: number;
  endMinute: number;
  source: 'manual' | 'recurring';
};

type PlannerData = {
  projects: Project[];
  tasks: Task[];
  events: CalendarEvent[];
};

const STORAGE_KEY = 'research-planner-v0.4';
const legacyStorageKey = 'research-planner-v0.1';
const statuses: TaskStatus[] = ['Todo', 'Doing', 'Done'];
const recurrenceOptions: {label: string; value: Recurrence}[] = [
  {label: 'なし', value: 'none'},
  {label: '毎日', value: 'daily'},
  {label: '毎週', value: 'weekly'},
];
const days = ['月', '火', '水', '木', '金', '土', '日'];
const projectColors = ['#2e6fbb', '#168260', '#b45b2a', '#8c5ab8', '#ad3f5f', '#5d6b7a'];
const hourHeight = 64;

const defaultProjects: Project[] = [
  {id: 'master-research', name: '修士研究', color: '#2e6fbb', goal: '文献調査から論文執筆までを前に進める'},
  {id: 'classes', name: '授業', color: '#168260', goal: '課題と予習を締切前に処理する'},
  {id: 'english', name: '英語学習', color: '#b45b2a', goal: '毎日少しずつ読む・聞く時間を確保する'},
  {id: 'dev', name: '個人開発', color: '#8c5ab8', goal: '作りたいものを小さく実装して公開する'},
];

const initialData: PlannerData = {
  projects: defaultProjects,
  tasks: [
    {
      id: crypto.randomUUID(),
      title: '論文Aを読む',
      description: '関連研究の主張、手法、限界をメモする',
      duration: 120,
      status: 'Todo',
      projectId: 'master-research',
      tags: ['paper', 'research'],
      recurrence: 'weekly',
      recurrenceDay: 1,
      recurrenceStartMinute: 13 * 60,
      ganttStartDay: 0,
      ganttEndDay: 2,
    },
    {
      id: crypto.randomUUID(),
      title: 'ゼミ資料を作る',
      description: '進捗、課題、次の実験計画をまとめる',
      duration: 90,
      status: 'Doing',
      projectId: 'master-research',
      tags: ['seminar'],
      recurrence: 'weekly',
      recurrenceDay: 3,
      recurrenceStartMinute: 10 * 60,
      ganttStartDay: 2,
      ganttEndDay: 4,
    },
    {
      id: crypto.randomUUID(),
      title: '英語シャドーイング',
      description: '発音とリズムを意識して練習する',
      duration: 45,
      status: 'Todo',
      projectId: 'english',
      tags: ['english', 'habit'],
      recurrence: 'daily',
      recurrenceDay: 0,
      recurrenceStartMinute: 8 * 60,
      ganttStartDay: 0,
      ganttEndDay: 6,
    },
  ],
  events: [],
};

function formatTime(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function snapToQuarterHour(value: number) {
  return Math.max(0, Math.min(24 * 60 - 15, Math.round(value / 15) * 15));
}

function parseTags(value: FormDataEntryValue | null) {
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTask(raw: Partial<Task>, projectId: string): Task {
  return {
    id: raw.id ?? crypto.randomUUID(),
    title: raw.title ?? 'Untitled',
    description: raw.description ?? '',
    duration: Number(raw.duration) || 60,
    status: raw.status ?? 'Todo',
    projectId: raw.projectId ?? projectId,
    tags: raw.tags ?? [],
    recurrence: raw.recurrence ?? 'none',
    recurrenceDay: raw.recurrenceDay ?? 0,
    recurrenceStartMinute: raw.recurrenceStartMinute ?? 9 * 60,
    ganttStartDay: raw.ganttStartDay ?? 0,
    ganttEndDay: raw.ganttEndDay ?? Math.min(6, raw.ganttStartDay ?? 0),
  };
}

function loadPlannerData(): PlannerData {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<PlannerData>;
      const projects = parsed.projects?.length ? parsed.projects : defaultProjects;
      return {
        projects,
        tasks: (parsed.tasks ?? []).map((task) => normalizeTask(task, projects[0].id)),
        events: (parsed.events ?? []).map((event) => ({...event, source: event.source ?? 'manual'})),
      };
    } catch {
      return initialData;
    }
  }

  const legacy = localStorage.getItem(legacyStorageKey);
  if (!legacy) return initialData;

  try {
    const parsed = JSON.parse(legacy) as {tasks?: Partial<Task>[]; events?: Partial<CalendarEvent>[]};
    return {
      projects: defaultProjects,
      tasks: (parsed.tasks ?? []).map((task) => normalizeTask(task, defaultProjects[0].id)),
      events: (parsed.events ?? []).map((event) => ({
        id: event.id ?? crypto.randomUUID(),
        taskId: event.taskId ?? '',
        day: event.day ?? 0,
        startMinute: event.startMinute ?? 9 * 60,
        endMinute: event.endMinute ?? 10 * 60,
        source: 'manual',
      })),
    };
  } catch {
    return initialData;
  }
}

export default function App() {
  const [plannerData, setPlannerData] = useState<PlannerData>(loadPlannerData);
  const [selectedTaskId, setSelectedTaskId] = useState(plannerData.tasks[0]?.id ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState(plannerData.projects[0]?.id ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const {projects, tasks, events} = plannerData;
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
  const filteredEvents = useMemo(() => events.filter((event) => filteredTaskIds.has(event.taskId)), [events, filteredTaskIds]);

  const eventsByDay = useMemo(
    () =>
      days.map((_, dayIndex) =>
        filteredEvents
          .filter((event) => event.day === dayIndex)
          .sort((a, b) => a.startMinute - b.startMinute),
      ),
    [filteredEvents],
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

        return {
          ...project,
          taskCount: projectTasks.length,
          plannedMinutes,
          scheduledMinutes,
          doneMinutes,
        };
      }),
    [events, projects, tasks],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plannerData));
  }, [plannerData]);

  function setTasks(updater: (current: Task[]) => Task[]) {
    setPlannerData((current) => ({...current, tasks: updater(current.tasks)}));
  }

  function setEvents(updater: (current: CalendarEvent[]) => CalendarEvent[]) {
    setPlannerData((current) => ({...current, events: updater(current.events)}));
  }

  function setProjects(updater: (current: Project[]) => Project[]) {
    setPlannerData((current) => ({...current, projects: updater(current.projects)}));
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get('title') ?? '').trim();
    const duration = Number(formData.get('duration') ?? 60);
    const ganttStartDay = Number(formData.get('ganttStartDay') ?? 0);

    if (!title) return;

    const task: Task = {
      id: crypto.randomUUID(),
      title,
      description: String(formData.get('description') ?? '').trim(),
      duration: Number.isFinite(duration) ? Math.max(15, duration) : 60,
      status: 'Todo',
      projectId: String(formData.get('projectId') ?? projects[0]?.id),
      tags: parseTags(formData.get('tags')),
      recurrence: String(formData.get('recurrence') ?? 'none') as Recurrence,
      recurrenceDay: Number(formData.get('recurrenceDay') ?? 0),
      recurrenceStartMinute: Number(formData.get('recurrenceStartMinute') ?? 9 * 60),
      ganttStartDay,
      ganttEndDay: Math.max(ganttStartDay, Number(formData.get('ganttEndDay') ?? ganttStartDay)),
    };

    setTasks((current) => [task, ...current]);
    setSelectedTaskId(task.id);
    event.currentTarget.reset();
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return;

    const project: Project = {
      id: crypto.randomUUID(),
      name,
      color: String(formData.get('color') ?? projectColors[0]),
      goal: String(formData.get('goal') ?? '').trim(),
    };

    setProjects((current) => [...current, project]);
    setSelectedProjectId(project.id);
    event.currentTarget.reset();
  }

  function updateTask(updated: Task) {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
  }

  function updateProject(updated: Project) {
    setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)));
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setEvents((current) => current.filter((event) => event.taskId !== taskId));
    setSelectedTaskId((current) => (current === taskId ? tasks.find((task) => task.id !== taskId)?.id ?? '' : current));
  }

  function scheduleTask(taskId: string, day: number, minute: number, source: CalendarEvent['source'] = 'manual') {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    const startMinute = snapToQuarterHour(minute);
    const endMinute = Math.min(24 * 60, startMinute + task.duration);

    setEvents((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        taskId,
        day,
        startMinute,
        endMinute,
        source,
      },
    ]);

    if (task.status === 'Todo') updateTask({...task, status: 'Doing'});
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>, day: number) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const minute = (offsetY / (24 * hourHeight)) * 24 * 60;
    scheduleTask(taskId, day, minute);
  }

  function generateRecurringEvents() {
    const recurringEvents = tasks.flatMap((task) => {
      if (task.recurrence === 'none') return [];
      const targetDays = task.recurrence === 'daily' ? days.map((_, dayIndex) => dayIndex) : [task.recurrenceDay];

      return targetDays.map((day) => ({
        id: crypto.randomUUID(),
        taskId: task.id,
        day,
        startMinute: snapToQuarterHour(task.recurrenceStartMinute),
        endMinute: Math.min(24 * 60, snapToQuarterHour(task.recurrenceStartMinute) + task.duration),
        source: 'recurring' as const,
      }));
    });

    setEvents((current) => [...current.filter((event) => event.source !== 'recurring'), ...recurringEvents]);
  }

  function clearSchedule() {
    setEvents(() => []);
    setTasks((current) => current.map((task) => ({...task, status: task.status === 'Done' ? 'Done' : 'Todo'})));
  }

  return (
    <main className="planner-shell">
      <aside className="sidebar">
        <section className="brand-panel">
          <p className="eyebrow">Research Planner</p>
          <h1>Week Blocking</h1>
          <div className="view-switch" role="tablist" aria-label="表示切替">
            <button className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')} type="button">
              Calendar
            </button>
            <button className={viewMode === 'gantt' ? 'active' : ''} onClick={() => setViewMode('gantt')} type="button">
              Gantt
            </button>
          </div>
        </section>

        <section className="task-create-panel" aria-label="新規タスク">
          <h2>タスク作成</h2>
          <form onSubmit={createTask} className="stack-form">
            <input name="title" placeholder="タスク名" required />
            <textarea name="description" placeholder="説明" rows={3} />
            <div className="field-grid">
              <label>
                分
                <input name="duration" type="number" min="15" step="15" defaultValue="60" />
              </label>
              <label>
                プロジェクト
                <select name="projectId" defaultValue={projects[0]?.id}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input name="tags" placeholder="タグ: paper, seminar" />
            <div className="field-grid">
              <label>
                定期
                <select name="recurrence" defaultValue="none">
                  {recurrenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                曜日
                <select name="recurrenceDay" defaultValue={0}>
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              定期開始
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
                Gantt開始
                <select name="ganttStartDay" defaultValue={0}>
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Gantt終了
                <select name="ganttEndDay" defaultValue={0}>
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit">追加</button>
          </form>
        </section>

        <section className="filters" aria-label="検索とフィルタ">
          <h2>検索・フィルタ</h2>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、説明、タグで検索" />
          <div className="field-grid">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatus | 'all')}>
              <option value="all">全ステータス</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">全プロジェクト</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="all">全タグ</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </section>

        <section className="kanban" aria-label="タスク一覧">
          {statuses.map((status) => (
            <div className="kanban-column" key={status}>
              <header>
                <h2>{status}</h2>
                <span>{filteredTasks.filter((task) => task.status === status).length}</span>
              </header>

              <div className="task-list">
                {filteredTasks
                  .filter((task) => task.status === status)
                  .map((task) => {
                    const project = projectById.get(task.projectId);

                    return (
                      <button
                        className={`task-card ${selectedTaskId === task.id ? 'selected' : ''}`}
                        draggable
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                        type="button"
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
                  })}
              </div>
            </div>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="calendar-toolbar">
          <div>
            <p className="eyebrow">v0.4 localStorage</p>
            <h2>{viewMode === 'calendar' ? '週間カレンダー' : 'ガントチャート'}</h2>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={generateRecurringEvents}>
              定期予定を生成
            </button>
            <button type="button" onClick={clearSchedule}>
              予定をクリア
            </button>
          </div>
        </header>

        <section className="summary-grid" aria-label="プロジェクト集計">
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
              <small>{Math.round(summary.doneMinutes / 60)}h done / {Math.round(summary.plannedMinutes / 60)}h planned</small>
            </button>
          ))}
        </section>

        {viewMode === 'calendar' ? (
          <div className="week-calendar">
            <div className="day-header spacer" />
            {days.map((day) => (
              <div className="day-header" key={day}>
                {day}
              </div>
            ))}

            <div className="time-axis">
              {Array.from({length: 25}, (_, hour) => (
                <span key={hour}>{formatTime(hour * 60)}</span>
              ))}
            </div>

            {days.map((day, dayIndex) => (
              <div
                className="day-column"
                key={day}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, dayIndex)}
              >
                {Array.from({length: 24}, (_, hour) => (
                  <div className="hour-line" key={hour} />
                ))}

                {eventsByDay[dayIndex].map((calendarEvent) => {
                  const task = tasks.find((item) => item.id === calendarEvent.taskId);
                  if (!task) return null;
                  const project = projectById.get(task.projectId);

                  return (
                    <button
                      className={`calendar-event ${calendarEvent.source}`}
                      key={calendarEvent.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      style={{
                        borderColor: project?.color,
                        height: `${Math.max(34, ((calendarEvent.endMinute - calendarEvent.startMinute) / 60) * hourHeight - 4)}px`,
                        top: `${(calendarEvent.startMinute / 60) * hourHeight + 2}px`,
                      }}
                      type="button"
                    >
                      <strong>{task.title}</strong>
                      <span>
                        {formatTime(calendarEvent.startMinute)} - {formatTime(calendarEvent.endMinute)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="gantt-chart" aria-label="ガントチャート">
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

      <aside className="detail-panel" aria-label="詳細編集">
        {selectedTask ? (
          <section className="detail-section">
            <header>
              <p className="eyebrow">Task Detail</p>
              <h2>編集</h2>
            </header>

            <label>
              タイトル
              <input value={selectedTask.title} onChange={(event) => updateTask({...selectedTask, title: event.target.value})} />
            </label>
            <label>
              説明
              <textarea
                rows={4}
                value={selectedTask.description}
                onChange={(event) => updateTask({...selectedTask, description: event.target.value})}
              />
            </label>
            <div className="field-grid">
              <label>
                所要時間
                <input
                  min="15"
                  step="15"
                  type="number"
                  value={selectedTask.duration}
                  onChange={(event) => updateTask({...selectedTask, duration: Number(event.target.value)})}
                />
              </label>
              <label>
                状態
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
              プロジェクト
              <select value={selectedTask.projectId} onChange={(event) => updateTask({...selectedTask, projectId: event.target.value})}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              タグ
              <input
                value={selectedTask.tags.join(', ')}
                onChange={(event) => updateTask({...selectedTask, tags: parseTags(event.target.value)})}
              />
            </label>
            <div className="field-grid">
              <label>
                定期
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
                曜日
                <select
                  value={selectedTask.recurrenceDay}
                  onChange={(event) => updateTask({...selectedTask, recurrenceDay: Number(event.target.value)})}
                >
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              定期開始
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
                Gantt開始
                <select value={selectedTask.ganttStartDay} onChange={(event) => updateTask({...selectedTask, ganttStartDay: Number(event.target.value)})}>
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Gantt終了
                <select value={selectedTask.ganttEndDay} onChange={(event) => updateTask({...selectedTask, ganttEndDay: Number(event.target.value)})}>
                  {days.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button className="danger" type="button" onClick={() => deleteTask(selectedTask.id)}>
              削除
            </button>
          </section>
        ) : (
          <p className="muted">タスクを選択してください。</p>
        )}

        <section className="project-editor" aria-label="プロジェクト管理">
          <header>
            <p className="eyebrow">Projects</p>
            <h2>管理</h2>
          </header>
          <form onSubmit={createProject} className="stack-form">
            <input name="name" placeholder="新規プロジェクト名" />
            <input name="goal" placeholder="目的・メモ" />
            <select name="color" defaultValue={projectColors[0]}>
              {projectColors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <button type="submit">プロジェクト追加</button>
          </form>

          {selectedProject && (
            <div className="selected-project">
              <label>
                名前
                <input value={selectedProject.name} onChange={(event) => updateProject({...selectedProject, name: event.target.value})} />
              </label>
              <label>
                目的
                <textarea
                  rows={3}
                  value={selectedProject.goal}
                  onChange={(event) => updateProject({...selectedProject, goal: event.target.value})}
                />
              </label>
              <label>
                色
                <select value={selectedProject.color} onChange={(event) => updateProject({...selectedProject, color: event.target.value})}>
                  {projectColors.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>
      </aside>
    </main>
  );
}
