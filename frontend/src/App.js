import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
const STORAGE_KEY = 'research-planner-v0.1';
const statuses = ['Todo', 'Doing', 'Done'];
const days = ['月', '火', '水', '木', '金', '土', '日'];
const hourHeight = 64;
const initialTasks = [
    {
        id: crypto.randomUUID(),
        title: '論文Aを読む',
        description: '関連研究の主張と手法をメモする',
        duration: 120,
        status: 'Todo',
    },
    {
        id: crypto.randomUUID(),
        title: 'ゼミ資料を作る',
        description: '進捗、課題、次の実験計画をまとめる',
        duration: 90,
        status: 'Doing',
    },
    {
        id: crypto.randomUUID(),
        title: '英語シャドーイング',
        description: '発音とリズムを意識して練習する',
        duration: 45,
        status: 'Todo',
    },
];
function formatTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
function snapToQuarterHour(value) {
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(value / 15) * 15));
}
function App() {
    const [tasks, setTasks] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved)
            return initialTasks;
        try {
            const parsed = JSON.parse(saved);
            return parsed.tasks?.length ? parsed.tasks : initialTasks;
        }
        catch {
            return initialTasks;
        }
    });
    const [events, setEvents] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved)
            return [];
        try {
            const parsed = JSON.parse(saved);
            return parsed.events ?? [];
        }
        catch {
            return [];
        }
    });
    const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id ?? '');
    const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
    const eventsByDay = useMemo(() => days.map((_, dayIndex) => events
        .filter((event) => event.day === dayIndex)
        .sort((a, b) => a.startMinute - b.startMinute)), [events]);
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, events }));
    }, [tasks, events]);
    function createTask(event) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const title = String(formData.get('title') ?? '').trim();
        const duration = Number(formData.get('duration') ?? 60);
        if (!title)
            return;
        const task = {
            id: crypto.randomUUID(),
            title,
            description: String(formData.get('description') ?? '').trim(),
            duration: Number.isFinite(duration) ? Math.max(15, duration) : 60,
            status: 'Todo',
        };
        setTasks((current) => [task, ...current]);
        setSelectedTaskId(task.id);
        event.currentTarget.reset();
    }
    function updateTask(updated) {
        setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
    }
    function deleteTask(taskId) {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        setEvents((current) => current.filter((event) => event.taskId !== taskId));
        setSelectedTaskId((current) => (current === taskId ? '' : current));
    }
    function scheduleTask(taskId, day, minute) {
        const task = tasks.find((item) => item.id === taskId);
        if (!task)
            return;
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
            },
        ]);
        updateTask({ ...task, status: 'Doing' });
    }
    function handleDrop(event, day) {
        event.preventDefault();
        const taskId = event.dataTransfer.getData('text/plain');
        const rect = event.currentTarget.getBoundingClientRect();
        const offsetY = event.clientY - rect.top;
        const minute = (offsetY / (24 * hourHeight)) * 24 * 60;
        scheduleTask(taskId, day, minute);
    }
    return (_jsxs("main", { className: "planner-shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("section", { className: "task-create-panel", "aria-label": "\u65B0\u898F\u30BF\u30B9\u30AF", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Research Planner" }), _jsx("h1", { children: "Week Blocking" })] }), _jsxs("form", { onSubmit: createTask, className: "task-form", children: [_jsx("input", { name: "title", placeholder: "\u30BF\u30B9\u30AF\u540D", required: true }), _jsx("textarea", { name: "description", placeholder: "\u8AAC\u660E", rows: 3 }), _jsxs("div", { className: "duration-row", children: [_jsx("input", { name: "duration", type: "number", min: "15", step: "15", defaultValue: "60" }), _jsx("span", { children: "minutes" }), _jsx("button", { type: "submit", children: "\u8FFD\u52A0" })] })] })] }), _jsx("section", { className: "kanban", "aria-label": "\u30BF\u30B9\u30AF\u4E00\u89A7", children: statuses.map((status) => (_jsxs("div", { className: "kanban-column", children: [_jsxs("header", { children: [_jsx("h2", { children: status }), _jsx("span", { children: tasks.filter((task) => task.status === status).length })] }), _jsx("div", { className: "task-list", children: tasks
                                        .filter((task) => task.status === status)
                                        .map((task) => (_jsxs("button", { className: `task-card ${selectedTaskId === task.id ? 'selected' : ''}`, draggable: true, onClick: () => setSelectedTaskId(task.id), onDragStart: (event) => event.dataTransfer.setData('text/plain', task.id), type: "button", children: [_jsx("strong", { children: task.title }), _jsxs("span", { children: [task.duration, " min"] })] }, task.id))) })] }, status))) })] }), _jsxs("section", { className: "calendar-area", children: [_jsxs("header", { className: "calendar-toolbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "v0.1 localStorage" }), _jsx("h2", { children: "\u9031\u9593\u30AB\u30EC\u30F3\u30C0\u30FC" })] }), _jsx("button", { type: "button", onClick: () => {
                                    setEvents([]);
                                    setTasks((current) => current.map((task) => ({ ...task, status: task.status === 'Done' ? 'Done' : 'Todo' })));
                                }, children: "\u4E88\u5B9A\u3092\u30AF\u30EA\u30A2" })] }), _jsxs("div", { className: "week-calendar", children: [_jsx("div", { className: "day-header spacer" }), days.map((day) => (_jsx("div", { className: "day-header", children: day }, day))), _jsx("div", { className: "time-axis", children: Array.from({ length: 25 }, (_, hour) => (_jsx("span", { children: formatTime(hour * 60) }, hour))) }), days.map((day, dayIndex) => (_jsxs("div", { className: "day-column", onDragOver: (event) => event.preventDefault(), onDrop: (event) => handleDrop(event, dayIndex), children: [Array.from({ length: 24 }, (_, hour) => (_jsx("div", { className: "hour-line" }, hour))), eventsByDay[dayIndex].map((calendarEvent) => {
                                        const task = tasks.find((item) => item.id === calendarEvent.taskId);
                                        if (!task)
                                            return null;
                                        return (_jsxs("button", { className: "calendar-event", onClick: () => setSelectedTaskId(task.id), style: {
                                                height: `${((calendarEvent.endMinute - calendarEvent.startMinute) / 60) * hourHeight - 4}px`,
                                                top: `${(calendarEvent.startMinute / 60) * hourHeight + 2}px`,
                                            }, type: "button", children: [_jsx("strong", { children: task.title }), _jsxs("span", { children: [formatTime(calendarEvent.startMinute), " - ", formatTime(calendarEvent.endMinute)] })] }, calendarEvent.id));
                                    })] }, day)))] })] }), selectedTask && (_jsxs("aside", { className: "detail-panel", "aria-label": "\u30BF\u30B9\u30AF\u8A73\u7D30", children: [_jsxs("header", { children: [_jsx("p", { className: "eyebrow", children: "Task Detail" }), _jsx("h2", { children: "\u7DE8\u96C6" })] }), _jsxs("label", { children: ["\u30BF\u30A4\u30C8\u30EB", _jsx("input", { value: selectedTask.title, onChange: (event) => updateTask({ ...selectedTask, title: event.target.value }) })] }), _jsxs("label", { children: ["\u8AAC\u660E", _jsx("textarea", { rows: 5, value: selectedTask.description, onChange: (event) => updateTask({ ...selectedTask, description: event.target.value }) })] }), _jsxs("label", { children: ["\u6240\u8981\u6642\u9593", _jsx("input", { min: "15", step: "15", type: "number", value: selectedTask.duration, onChange: (event) => updateTask({ ...selectedTask, duration: Number(event.target.value) }) })] }), _jsxs("label", { children: ["\u72B6\u614B", _jsx("select", { value: selectedTask.status, onChange: (event) => updateTask({ ...selectedTask, status: event.target.value }), children: statuses.map((status) => (_jsx("option", { children: status }, status))) })] }), _jsx("button", { className: "danger", type: "button", onClick: () => deleteTask(selectedTask.id), children: "\u524A\u9664" })] }))] }));
}
export default App;
