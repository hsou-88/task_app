import {create} from 'zustand';

export type TaskStatus = 'Todo' | 'Doing' | 'Done';
export type Recurrence = 'none' | 'daily' | 'weekly';
export type EventSource = 'manual' | 'recurring';

export type Project = {
  id: string;
  name: string;
  color: string;
  goal: string;
};

export type Task = {
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

export type CalendarEvent = {
  id: string;
  taskId: string;
  day: number;
  startMinute: number;
  endMinute: number;
  source: EventSource;
};

export type PlannerData = {
  projects: Project[];
  tasks: Task[];
  events: CalendarEvent[];
};

type PlannerStore = PlannerData & {
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  deleteProject: (projectId: string) => void;
  addEvent: (event: CalendarEvent) => void;
  updateEvent: (event: CalendarEvent) => void;
  deleteEvent: (eventId: string) => void;
  clearSchedule: () => void;
  generateRecurringEvents: () => void;
  replaceData: (data: PlannerData) => void;
};

const STORAGE_KEY = 'research-planner-v1';
const LEGACY_KEYS = ['research-planner-v0.4', 'research-planner-v0.1'];

export const statuses: TaskStatus[] = ['Todo', 'Doing', 'Done'];
export const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const projectColors = ['#2e6fbb', '#168260', '#b45b2a', '#8c5ab8', '#ad3f5f', '#5d6b7a'];

const defaultProjects: Project[] = [
  {id: 'master-research', name: 'Master Research', color: '#2e6fbb', goal: 'Move from literature review to thesis writing.'},
  {id: 'classes', name: 'Classes', color: '#168260', goal: 'Finish assignments and preparation before deadlines.'},
  {id: 'english', name: 'English Study', color: '#b45b2a', goal: 'Protect daily reading and listening practice.'},
  {id: 'dev', name: 'Personal Dev', color: '#8c5ab8', goal: 'Build small projects and ship them.'},
];

const initialData: PlannerData = {
  projects: defaultProjects,
  tasks: [
    {
      id: crypto.randomUUID(),
      title: 'Read paper A',
      description: 'Summarize claim, method, limitations, and related work.',
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
      title: 'Prepare seminar slides',
      description: 'Collect progress, blockers, and next experiment plan.',
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
      title: 'English shadowing',
      description: 'Practice rhythm and pronunciation.',
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

export function formatTime(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseTags(value: FormDataEntryValue | string | null) {
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function snapToQuarterHour(value: number) {
  return Math.max(0, Math.min(24 * 60 - 15, Math.round(value / 15) * 15));
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
    recurrenceDay: Number(raw.recurrenceDay) || 0,
    recurrenceStartMinute: Number(raw.recurrenceStartMinute) || 9 * 60,
    ganttStartDay: Number(raw.ganttStartDay) || 0,
    ganttEndDay: Number(raw.ganttEndDay) || Number(raw.ganttStartDay) || 0,
  };
}

function normalizeData(raw: Partial<PlannerData>): PlannerData {
  const projects = raw.projects?.length ? raw.projects : defaultProjects;
  return {
    projects,
    tasks: (raw.tasks ?? []).map((task) => normalizeTask(task, projects[0].id)),
    events: (raw.events ?? []).map((event) => ({
      id: event.id ?? crypto.randomUUID(),
      taskId: event.taskId ?? '',
      day: Number(event.day) || 0,
      startMinute: Number(event.startMinute) || 9 * 60,
      endMinute: Number(event.endMinute) || 10 * 60,
      source: event.source ?? 'manual',
    })),
  };
}

export function normalizePlannerData(raw: Partial<PlannerData>): PlannerData {
  return normalizeData(raw);
}

function loadData(): PlannerData {
  const keys = [STORAGE_KEY, ...LEGACY_KEYS];

  for (const key of keys) {
    const saved = localStorage.getItem(key);
    if (!saved) continue;

    try {
      const data = normalizeData(JSON.parse(saved) as Partial<PlannerData>);
      return data.tasks.length ? data : initialData;
    } catch {
      continue;
    }
  }

  return initialData;
}

function persist(data: PlannerData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function withPersist(state: PlannerData, patch: Partial<PlannerData>) {
  const next = {...state, ...patch};
  persist(next);
  return next;
}

export const usePlannerStore = create<PlannerStore>((set, get) => ({
  ...loadData(),

  addTask: (task) => set((state) => withPersist(state, {tasks: [task, ...state.tasks]})),
  updateTask: (task) =>
    set((state) => withPersist(state, {tasks: state.tasks.map((item) => (item.id === task.id ? task : item))})),
  deleteTask: (taskId) =>
    set((state) =>
      withPersist(state, {
        tasks: state.tasks.filter((task) => task.id !== taskId),
        events: state.events.filter((event) => event.taskId !== taskId),
      }),
    ),
  addProject: (project) => set((state) => withPersist(state, {projects: [...state.projects, project]})),
  updateProject: (project) =>
    set((state) => withPersist(state, {projects: state.projects.map((item) => (item.id === project.id ? project : item))})),
  deleteProject: (projectId) =>
    set((state) => {
      if (state.projects.length <= 1) return state;

      const fallbackProject = state.projects.find((project) => project.id !== projectId);
      if (!fallbackProject) return state;

      return withPersist(state, {
        projects: state.projects.filter((project) => project.id !== projectId),
        tasks: state.tasks.map((task) => (task.projectId === projectId ? {...task, projectId: fallbackProject.id} : task)),
      });
    }),
  addEvent: (event) =>
    set((state) => {
      const task = state.tasks.find((item) => item.id === event.taskId);
      return withPersist(state, {
        events: [...state.events, event],
        tasks: task?.status === 'Todo' ? state.tasks.map((item) => (item.id === task.id ? {...item, status: 'Doing'} : item)) : state.tasks,
      });
    }),
  updateEvent: (event) =>
    set((state) => withPersist(state, {events: state.events.map((item) => (item.id === event.id ? event : item))})),
  deleteEvent: (eventId) => set((state) => withPersist(state, {events: state.events.filter((event) => event.id !== eventId)})),
  clearSchedule: () =>
    set((state) =>
      withPersist(state, {
        events: [],
        tasks: state.tasks.map((task) => ({...task, status: task.status === 'Done' ? 'Done' : 'Todo'})),
      }),
    ),
  generateRecurringEvents: () =>
    set((state) => {
      const recurringEvents = state.tasks.flatMap((task) => {
        if (task.recurrence === 'none') return [];

        const targetDays = task.recurrence === 'daily' ? days.map((_, dayIndex) => dayIndex) : [task.recurrenceDay];
        return targetDays.map((day) => {
          const startMinute = snapToQuarterHour(task.recurrenceStartMinute);
          return {
            id: crypto.randomUUID(),
            taskId: task.id,
            day,
            startMinute,
            endMinute: Math.min(24 * 60, startMinute + task.duration),
            source: 'recurring' as const,
          };
        });
      });

      return withPersist(state, {
        events: [...state.events.filter((event) => event.source !== 'recurring'), ...recurringEvents],
      });
    }),
  replaceData: (data) =>
    set(() => {
      persist(data);
      return data;
    }),
}));

export function getStoreSnapshot() {
  const {projects, tasks, events} = getPlannerState();
  return {projects, tasks, events};
}

function getPlannerState() {
  return usePlannerStore.getState();
}
