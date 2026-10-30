import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import timeGridPlugin from '@fullcalendar/timegrid';
import viLocale from '@fullcalendar/core/locales/vi';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const REGISTRATION_ENABLED = import.meta.env.VITE_ALLOW_REGISTRATION !== 'false';

type User = { id: string; email: string; timezone: string; createdAt: string };
type Project = { id: string; userId: string; name: string; color: string | null; createdAt: string; updatedAt: string; version: number };
type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
type DeadlineType = 'NONE' | 'DATE' | 'DATETIME';
type DeadlineBucket = 'NO_DEADLINE' | 'OVERDUE' | 'TODAY' | 'UPCOMING';
type ThemeMode = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'ptm-theme-mode';
type CalendarKind = 'TASK_BLOCK' | 'EVENT' | 'DEADLINE';
type CalendarRecurrence = { frequency: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; weekdays: number[]; until: string | null };
type CalendarItem = {
  id: string;
  userId: string;
  kind: CalendarKind;
  taskId: string | null;
  projectId: string | null;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  recurrence: CalendarRecurrence | null;
  seriesId: string;
  occurrenceStart: string;
  isOccurrence: boolean;
  isOverride: boolean;
  version: number;
};
type Task = {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadlineType: DeadlineType;
  dueDate: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
  deadlineBucket: DeadlineBucket;
  deadlineLabel: string;
  relativeDeadline: string;
};

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload.error?.message ?? 'Không thể kết nối tới máy chủ.', payload.error?.code);
  }
  return payload as T;
}

type TaskPayload = {
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadlineType: DeadlineType;
  dueDate: string | null;
  dueAt: string | null;
  version?: number;
};

type DateTimeParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function dateTimePartsInTimeZone(date: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function dateTimeLocalToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  if (Number.isNaN(localAsUtc)) return null;

  // Resolve the account's wall-clock value to an instant. Two passes handle
  // ordinary daylight-saving transitions without using the device timezone.
  let instant = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = dateTimePartsInTimeZone(instant, timeZone);
    const displayedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    instant = new Date(localAsUtc - (displayedAsUtc - instant.getTime()));
  }
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function isoToDateTimeLocal(value: string | null, timeZone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateTimePartsInTimeZone(date, timeZone);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return 'Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại, hãy kiểm tra rồi lưu lại.';
  if (error instanceof ApiError) return error.message;
  return 'Có lỗi xảy ra. Vui lòng thử lại.';
}

function todayLabel(timeZone: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
}

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'system' ? stored : 'light';
  } catch {
    return 'light';
  }
}

function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && mediaQuery.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171a23' : '#f6f7fb');
    };
    apply();
    if (mode === 'system') mediaQuery.addEventListener('change', apply);
    return () => mediaQuery.removeEventListener('change', apply);
  }, [mode]);

  function changeMode(nextMode: ThemeMode) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
    setMode(nextMode);
  }

  return [mode, changeMode];
}

function ThemeSwitcher({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return <label className="theme-switcher"><span>Giao diện</span><select aria-label="Chọn giao diện" value={mode} onChange={(event) => onChange(event.target.value as ThemeMode)}><option value="light">Sáng</option><option value="dark">Tối</option><option value="system">Hệ thống</option></select></label>;
}

export default function App() {
  const [auth, setAuth] = useState<{ loading: boolean; user: User | null }>({ loading: true, user: null });
  const [themeMode, setThemeMode] = useThemeMode();

  useEffect(() => {
    api<{ user: User | null }>('/api/v1/auth/me')
      .then(({ user }) => setAuth({ loading: false, user }))
      .catch(() => setAuth({ loading: false, user: null }));
  }, []);

  if (auth.loading) return <div className="app-loading"><span className="spinner" /> Đang tải không gian làm việc…</div>;
  if (!auth.user) return <AuthScreen themeMode={themeMode} onThemeChange={setThemeMode} onAuthenticated={(user) => setAuth({ loading: false, user })} />;
  return <Workspace user={auth.user} themeMode={themeMode} onThemeChange={setThemeMode} onLogout={() => setAuth({ loading: false, user: null })} />;
}

function AuthScreen({ themeMode, onThemeChange, onAuthenticated }: { themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => void; onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: User }>(`/api/v1/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      onAuthenticated(result.user);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-theme-control"><ThemeSwitcher mode={themeMode} onChange={onThemeChange} /></div>
      <section className="auth-intro">
        <div className="brand-mark">✓</div>
        <p className="eyebrow">PERSONAL TASK MANAGER</p>
        <h1>Nhẹ đầu hơn khi mọi việc có chỗ để đi.</h1>
        <p className="intro-copy">Gom những việc cần làm, deadline và dự án vào một không gian rõ ràng để bạn biết việc tiếp theo là gì.</p>
        <div className="intro-note"><span>✦</span> Bản local đầu tiên · múi giờ Asia/Ho_Chi_Minh (UTC+7)</div>
      </section>
      <section className="auth-card">
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
          {REGISTRATION_ENABLED && <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Tạo tài khoản</button>}
        </div>
        <div className="auth-heading">
          <p className="eyebrow">{mode === 'login' ? 'CHÀO MỪNG TRỞ LẠI' : 'BẮT ĐẦU GỌN GÀNG'}</p>
          <h2>{mode === 'login' ? 'Đăng nhập vào workspace' : 'Tạo tài khoản của bạn'}</h2>
          <p>{mode === 'login' ? 'Tiếp tục từ nơi bạn đã dừng lại.' : 'Dữ liệu được tách riêng theo tài khoản.'}</p>
        </div>
        <form className="stack-form" onSubmit={submit}>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
          <label>Mật khẩu<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" minLength={8} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button full-width" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        </form>
      </section>
    </main>
  );
}

function Workspace({ user, themeMode, onThemeChange, onLogout }: { user: User; themeMode: ThemeMode; onThemeChange: (mode: ThemeMode) => void; onLogout: () => void }) {
  const [activePage, setActivePage] = useState<'tasks' | 'calendar'>('tasks');
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [bucketFilter, setBucketFilter] = useState<'ALL' | DeadlineBucket>('ALL');
  const [search, setSearch] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const [projectResult, taskResult] = await Promise.all([
        api<{ projects: Project[] }>('/api/v1/projects'),
        api<{ tasks: Task[] }>('/api/v1/tasks')
      ]);
      setProjects(projectResult.projects);
      setTasks(taskResult.tasks);
      setError('');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  function showAllTasks() {
    setSelectedProject('all');
    setStatusFilter('ALL');
    setBucketFilter('ALL');
    setSearch('');
  }

  function showDeadlineBucket(bucket: 'TODAY' | 'OVERDUE') {
    setSelectedProject('all');
    setStatusFilter('ALL');
    setBucketFilter(bucket);
    setSearch('');
  }

  function showCompletedTasks() {
    setSelectedProject('all');
    setStatusFilter('DONE');
    setBucketFilter('ALL');
    setSearch('');
  }

  function showProject(projectId: string) {
    setSelectedProject(projectId);
    setStatusFilter('ALL');
    setBucketFilter('ALL');
    setSearch('');
  }

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchesProject = selectedProject === 'all' || (selectedProject === 'none' ? task.projectId === null : task.projectId === selectedProject);
    const matchesStatus = statusFilter === 'ALL' || task.status === statusFilter;
    const matchesBucket = bucketFilter === 'ALL' || task.deadlineBucket === bucketFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || task.title.toLowerCase().includes(query) || (task.description ?? '').toLowerCase().includes(query);
    return matchesProject && matchesStatus && matchesBucket && matchesSearch;
  }), [tasks, selectedProject, statusFilter, bucketFilter, search]);

  const counts = useMemo(() => ({
    active: tasks.filter((task) => task.status !== 'DONE').length,
    today: tasks.filter((task) => task.deadlineBucket === 'TODAY' && task.status !== 'DONE').length,
    overdue: tasks.filter((task) => task.deadlineBucket === 'OVERDUE' && task.status !== 'DONE').length,
    done: tasks.filter((task) => task.status === 'DONE').length
  }), [tasks]);

  async function saveTask(payload: TaskPayload, id?: string) {
    setBusy(true);
    setError('');
    try {
      const result = id
        ? await api<{ task: Task }>(`/api/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ task: Task }>('/api/v1/tasks', { method: 'POST', body: JSON.stringify(payload) });
      setTasks((current) => id ? current.map((task) => task.id === id ? result.task : task) : [result.task, ...current]);
      setShowTaskForm(false);
      setEditingTask(null);
      setNotice(id ? 'Đã cập nhật Task.' : 'Đã thêm Task mới.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await loadData();
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: Task) {
    await saveTask({
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status === 'DONE' ? 'TODO' : 'DONE',
      priority: task.priority,
      deadlineType: task.deadlineType,
      dueDate: task.dueDate,
      dueAt: task.dueAt,
      version: task.version
    }, task.id);
  }

  async function removeTask(task: Task) {
    if (!window.confirm(`Xóa “${task.title}”?`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/tasks/${task.id}`, { method: 'DELETE', body: JSON.stringify({ version: task.version }) });
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setNotice('Đã xóa Task.');
    } catch (caught) {
      setError(friendlyError(caught));
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await loadData();
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(name: string, color: string | null, id?: string, version?: number): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const result = id
        ? await api<{ project: Project }>(`/api/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name, color, version }) })
        : await api<{ project: Project }>('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name, color }) });
      setProjects((current) => id ? current.map((project) => project.id === id ? result.project : project) : [...current, result.project]);
      setNotice(id ? 'Đã cập nhật Project.' : 'Đã thêm Project.');
      return true;
    } catch (caught) {
      setError(friendlyError(caught));
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await loadData();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`Xóa Project “${project.name}”? Task sẽ được chuyển về chưa phân loại.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/projects/${project.id}`, { method: 'DELETE', body: JSON.stringify({ version: project.version }) });
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setTasks((current) => current.map((task) => task.projectId === project.id ? { ...task, projectId: null } : task));
      if (selectedProject === project.id) setSelectedProject('all');
      setNotice('Đã xóa Project.');
    } catch (caught) {
      setError(friendlyError(caught));
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await loadData();
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLogout();
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small">✓</div><span>Task Manager</span></div>
        <div className="sidebar-section-label">KHÔNG GIAN CỦA BẠN</div>
        <button type="button" className={`nav-item ${activePage === 'tasks' && selectedProject === 'all' && statusFilter === 'ALL' && bucketFilter === 'ALL' && !search ? 'selected' : ''}`} onClick={() => { setActivePage('tasks'); showAllTasks(); }} aria-current={activePage === 'tasks' && selectedProject === 'all' && statusFilter === 'ALL' && bucketFilter === 'ALL' && !search ? 'page' : undefined}><span className="nav-icon">▦</span> Công việc <span className="nav-count">{counts.active}</span></button>
        <button type="button" className={`nav-item ${activePage === 'calendar' ? 'selected' : ''}`} onClick={() => setActivePage('calendar')} aria-current={activePage === 'calendar' ? 'page' : undefined}><span className="nav-icon">▣</span> Lịch</button>
        <button type="button" className={`nav-item ${activePage === 'tasks' && selectedProject === 'all' && bucketFilter === 'TODAY' && !search ? 'selected' : ''}`} onClick={() => { setActivePage('tasks'); showDeadlineBucket('TODAY'); }} aria-current={activePage === 'tasks' && selectedProject === 'all' && bucketFilter === 'TODAY' && !search ? 'page' : undefined}><span className="nav-icon">◷</span> Hôm nay <span className="nav-count accent">{counts.today}</span></button>
        <button type="button" className={`nav-item ${activePage === 'tasks' && selectedProject === 'all' && bucketFilter === 'OVERDUE' && !search ? 'selected' : ''}`} onClick={() => { setActivePage('tasks'); showDeadlineBucket('OVERDUE'); }} aria-current={activePage === 'tasks' && selectedProject === 'all' && bucketFilter === 'OVERDUE' && !search ? 'page' : undefined}><span className="nav-icon">!</span> Quá hạn <span className="nav-count danger">{counts.overdue}</span></button>
        <button type="button" className={`nav-item ${activePage === 'tasks' && selectedProject === 'all' && statusFilter === 'DONE' && !search ? 'selected' : ''}`} onClick={() => { setActivePage('tasks'); showCompletedTasks(); }} aria-current={activePage === 'tasks' && selectedProject === 'all' && statusFilter === 'DONE' && !search ? 'page' : undefined}><span className="nav-icon">✓</span> Đã hoàn thành <span className="nav-count">{counts.done}</span></button>
        <div className="sidebar-section-label project-label">PROJECTS <button type="button" className="icon-button" title="Tạo Project" aria-label="Tạo Project" onClick={() => setShowProjectForm((current) => !current)}>＋</button></div>
        {showProjectForm && <ProjectForm busy={busy} onCancel={() => setShowProjectForm(false)} onSave={async (name, color) => { const saved = await saveProject(name, color); if (saved) setShowProjectForm(false); return saved; }} />}
        <div className="project-list">
          <button type="button" className={`project-filter ${selectedProject === 'all' && statusFilter === 'ALL' && bucketFilter === 'ALL' && !search ? 'selected' : ''}`} onClick={showAllTasks}><span className="project-dot all" /> Tất cả Project</button>
          {projects.map((project) => <ProjectRow key={project.id} project={project} selected={selectedProject === project.id} onSelect={() => showProject(project.id)} onSave={saveProject} onDelete={removeProject} busy={busy} />)}
          <button type="button" className={`project-filter ${selectedProject === 'none' ? 'selected' : ''}`} onClick={() => showProject('none')}><span className="project-dot muted" /> Chưa phân loại</button>
        </div>
        <div className="sidebar-footer">
          <div className="user-chip"><div className="avatar">{user.email.slice(0, 1).toUpperCase()}</div><div className="user-details"><strong>{user.email.split('@')[0]}</strong><span>{user.email}</span></div><button type="button" className="logout-button" title="Đăng xuất" onClick={logout}><span aria-hidden="true">↪</span><span>Đăng xuất</span></button></div>
          <ThemeSwitcher mode={themeMode} onChange={onThemeChange} />
          <div className="timezone-note">Múi giờ: {user.timezone}</div>
        </div>
      </aside>
      <main className="main-content">
        {activePage === 'calendar' ? <CalendarView user={user} projects={projects} tasks={tasks} onTasksChanged={loadData} /> : <>
        <header className="topbar"><div><p className="eyebrow">{todayLabel(user.timezone)}</p><h1>Xin chào, {user.email.split('@')[0]} <span className="wave">✦</span></h1></div><button className="primary-button" onClick={() => { setEditingTask(null); setShowTaskForm(true); }}>＋ Tạo Task</button></header>
        {(error || notice) && <div className={`toast ${error ? 'error' : 'success'}`}><span>{error ? '!' : '✓'}</span><span>{error || notice}</span><button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
        <section className="stats-grid"><StatCard label="ĐANG THỰC HIỆN" value={counts.active} hint="Task chưa hoàn thành" tone="blue" /><StatCard label="HÔM NAY" value={counts.today} hint="Có deadline hôm nay" tone="yellow" /><StatCard label="QUÁ HẠN" value={counts.overdue} hint={counts.overdue ? 'Cần bạn chú ý' : 'Mọi thứ đang đúng hạn'} tone="red" /><StatCard label="ĐÃ XONG" value={counts.done} hint="Task đã hoàn thành" tone="green" /></section>
        <section className="tasks-section">
          <div className="section-heading"><div><h2>Danh sách công việc</h2><p>{filteredTasks.length} Task trong chế độ xem hiện tại</p></div><button className="ghost-button" onClick={() => void loadData()}>↻ Làm mới</button></div>
          <div className="toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm công việc…" aria-label="Tìm kiếm công việc" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | TaskStatus)} aria-label="Lọc theo trạng thái"><option value="ALL">Tất cả trạng thái</option><option value="TODO">Chưa làm</option><option value="IN_PROGRESS">Đang làm</option><option value="DONE">Đã xong</option></select><select value={bucketFilter} onChange={(event) => setBucketFilter(event.target.value as 'ALL' | DeadlineBucket)} aria-label="Lọc theo deadline"><option value="ALL">Tất cả deadline</option><option value="OVERDUE">Quá hạn</option><option value="TODAY">Hôm nay</option><option value="UPCOMING">Sắp tới</option></select>{(search || selectedProject !== 'all' || statusFilter !== 'ALL' || bucketFilter !== 'ALL') && <button type="button" className="ghost-button clear-filters" onClick={showAllTasks}>Xóa lọc</button>}</div>
          {showTaskForm && <TaskForm projects={projects} timezone={user.timezone} editingTask={editingTask} defaultProjectId={selectedProject !== 'all' && selectedProject !== 'none' ? selectedProject : null} busy={busy} onCancel={() => { setShowTaskForm(false); setEditingTask(null); }} onSave={saveTask} />}
          {loading ? <div className="empty-state"><span className="spinner" /> Đang tải công việc…</div> : filteredTasks.length === 0 ? <EmptyState onCreate={() => { setEditingTask(null); setShowTaskForm(true); }} hasFilters={Boolean(search || selectedProject !== 'all' || statusFilter !== 'ALL' || bucketFilter !== 'ALL')} /> : <div className="task-list">{filteredTasks.map((task) => <TaskCard key={task.id} task={task} projects={projects} onToggle={toggleTask} onEdit={() => { setEditingTask(task); setShowTaskForm(true); }} onDelete={removeTask} busy={busy} />)}</div>}
        </section>
        </>}
      </main>
    </div>
  );
}

type ProjectSaveHandler = (name: string, color: string | null, id?: string, version?: number) => Promise<boolean>;

type CalendarEditorState = {
  item: CalendarItem | null;
  kind: 'TASK_BLOCK' | 'EVENT';
  taskId: string;
  createNewTask: boolean;
  projectId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  recurrence: CalendarRecurrence;
  scope: 'THIS' | 'SERIES';
};

type CalendarRange = { start: string; end: string };

function dateInputFromCalendar(value: string, allDay: boolean, timeZone: string): string {
  if (allDay) return value.slice(0, 10);
  return isoToDateTimeLocal(value, timeZone);
}

function calendarDateTimeToIso(value: string, timeZone: string): string | null {
  return dateTimeLocalToIso(value, timeZone);
}

function addMinutesIso(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function addDateInput(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function recurrenceDefault(): CalendarRecurrence {
  return { frequency: 'NONE', interval: 1, weekdays: [], until: null };
}

function editorFromSelection(selection: { start: string; end: string; allDay: boolean }, timeZone: string): CalendarEditorState {
  const start = selection.allDay ? selection.start.slice(0, 10) : dateInputFromCalendar(selection.start, false, timeZone);
  const end = selection.allDay ? selection.end.slice(0, 10) : dateInputFromCalendar(selection.end, false, timeZone);
  return {
    item: null,
    kind: 'TASK_BLOCK',
    taskId: '',
    createNewTask: false,
    projectId: '',
    title: '',
    description: '',
    start,
    end,
    allDay: selection.allDay,
    color: '#6678e8',
    recurrence: recurrenceDefault(),
    scope: 'SERIES'
  };
}

function editorFromItem(item: CalendarItem, timeZone: string): CalendarEditorState {
  return {
    item,
    kind: item.kind === 'EVENT' ? 'EVENT' : 'TASK_BLOCK',
    taskId: item.taskId ?? '',
    createNewTask: false,
    projectId: item.projectId ?? '',
    title: item.title.startsWith('Deadline: ') ? item.title.slice('Deadline: '.length) : item.title,
    description: item.description ?? '',
    start: dateInputFromCalendar(item.start, item.allDay, timeZone),
    end: dateInputFromCalendar(item.end, item.allDay, timeZone),
    allDay: item.allDay,
    color: item.color ?? '#6678e8',
    recurrence: item.recurrence ?? recurrenceDefault(),
    scope: item.isOccurrence ? 'THIS' : 'SERIES'
  };
}

function calendarEventForItem(item: CalendarItem, tasks: Task[] = []) {
  const deadline = item.kind === 'DEADLINE';
  const completed = item.kind === 'TASK_BLOCK' && Boolean(item.taskId && tasks.find((task) => task.id === item.taskId)?.status === 'DONE');
  const color = item.color ?? (item.kind === 'EVENT' ? '#8a6fe8' : '#6678e8');
  return {
    id: item.id,
    title: item.title,
    start: item.start,
    end: item.end,
    allDay: item.allDay,
    backgroundColor: deadline ? '#f7dca5' : color,
    borderColor: deadline ? '#d29c4c' : color,
    textColor: deadline ? '#986d27' : '#fff',
    editable: !deadline,
    durationEditable: !deadline,
    startEditable: !deadline,
    classNames: [deadline ? 'calendar-deadline' : item.kind === 'EVENT' ? 'calendar-event' : 'calendar-task-block', item.isOverride ? 'calendar-override' : '', completed ? 'calendar-completed' : '', item.kind === 'TASK_BLOCK' && !deadline ? 'calendar-task-item' : ''].filter(Boolean),
    extendedProps: { item }
  };
}

function CalendarView({ user, projects, tasks, onTasksChanged }: { user: User; projects: Project[]; tasks: Task[]; onTasksChanged: () => Promise<void> }) {
  const taskTrayRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [unscheduledTaskIds, setUnscheduledTaskIds] = useState<string[]>([]);
  const [range, setRange] = useState<CalendarRange | null>(null);
  const [editor, setEditor] = useState<CalendarEditorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showTasks, setShowTasks] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [projectFilter, setProjectFilter] = useState('all');

  const unscheduledTasks = useMemo(() => tasks.filter((task) => unscheduledTaskIds.includes(task.id)), [tasks, unscheduledTaskIds]);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (item.kind === 'TASK_BLOCK' && !showTasks) return false;
    if (item.kind === 'EVENT' && !showEvents) return false;
    if (item.kind === 'DEADLINE' && !showDeadlines) return false;
    if (projectFilter !== 'all' && item.projectId !== projectFilter) return false;
    return true;
  }), [items, projectFilter, showDeadlines, showEvents, showTasks]);

  async function loadCalendar(nextRange: CalendarRange) {
    setRange(nextRange);
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: nextRange.start, end: nextRange.end, kinds: 'TASK_BLOCK,EVENT,DEADLINE' });
      const result = await api<{ items: CalendarItem[]; unscheduledTaskIds: string[] }>(`/api/v1/calendar?${params.toString()}`);
      setItems(result.items);
      setUnscheduledTaskIds(result.unscheduledTaskIds);
      setError('');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!range) return;
    void loadCalendar(range);
    // The range is intentionally the only dependency: filters only affect local rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  useEffect(() => {
    if (!taskTrayRef.current) return;
    const draggable = new Draggable(taskTrayRef.current, {
      itemSelector: '[data-calendar-task]',
      eventData: (element) => ({
        title: element.getAttribute('data-title') ?? 'Task',
        duration: '01:00',
        taskId: element.getAttribute('data-task-id') ?? '',
        kind: 'TASK_BLOCK'
      })
    });
    return () => draggable.destroy();
  }, [unscheduledTasks]);

  function openNew(selection: { start: string; end: string; allDay: boolean }) {
    setError('');
    setNotice('');
    setEditor(editorFromSelection(selection, user.timezone));
  }

  function openItem(item: CalendarItem) {
    if (item.kind === 'DEADLINE') {
      setNotice('Deadline được quản lý trong thông tin Task; phiên làm việc có thể chỉnh riêng trên lịch.');
      return;
    }
    setError('');
    setNotice('');
    setEditor(editorFromItem(item, user.timezone));
  }

  function eventTimes(event: { start: Date | null; end: Date | null; startStr: string; endStr: string; allDay: boolean }): { start: string; end: string; allDay: boolean } | null {
    if (!event.start) return null;
    if (event.allDay) {
      const start = event.startStr.slice(0, 10);
      const end = event.endStr ? event.endStr.slice(0, 10) : addDateInput(start, 1);
      return { start, end, allDay: true };
    }
    const start = event.start.toISOString();
    const end = event.end ? event.end.toISOString() : addMinutesIso(start, 60);
    return { start, end, allDay: false };
  }

  async function saveCalendarItem(values: CalendarEditorState, itemOverride?: CalendarItem | null) {
    setBusy(true);
    setError('');
    try {
      let taskId = values.taskId || null;
      if (values.kind === 'TASK_BLOCK' && values.createNewTask) {
        const created = await api<{ task: Task }>('/api/v1/tasks', {
          method: 'POST',
          body: JSON.stringify({
            projectId: values.projectId || null,
            title: values.title.trim(),
            description: values.description.trim() || null,
            status: 'TODO',
            priority: 'MEDIUM',
            deadlineType: 'NONE',
            dueDate: null,
            dueAt: null
          })
        });
        taskId = created.task.id;
      }
      if (values.kind === 'TASK_BLOCK' && !taskId) throw new Error('Chọn Task hoặc bật “Tạo Task mới”.');
      const start = values.allDay ? values.start : calendarDateTimeToIso(values.start, user.timezone);
      const end = values.allDay ? values.end : calendarDateTimeToIso(values.end, user.timezone);
      if (!start || !end) throw new Error('Khoảng thời gian chưa hợp lệ.');
      const payload = {
        kind: values.kind,
        taskId: values.kind === 'TASK_BLOCK' ? taskId : null,
        title: values.kind === 'EVENT' ? values.title.trim() : null,
        description: values.description.trim() || null,
        allDay: values.allDay,
        start,
        end,
        color: values.color || null,
        recurrence: values.kind === 'EVENT' && !(itemOverride?.isOccurrence && values.scope === 'THIS') ? values.recurrence : recurrenceDefault(),
        ...(itemOverride ? { version: itemOverride.version, scope: itemOverride.isOccurrence ? values.scope : 'SERIES', occurrenceStart: itemOverride.occurrenceStart } : {})
      };
      const result = itemOverride
        ? await api<{ item: CalendarItem; conflicts: Array<{ title: string }> }>(`/api/v1/calendar/${itemOverride.seriesId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<{ item: CalendarItem; conflicts: Array<{ title: string }> }>('/api/v1/calendar', { method: 'POST', body: JSON.stringify(payload) });
      if (result.conflicts.length) setNotice(`Đã lưu, nhưng đang trùng với: ${result.conflicts.map((conflict) => conflict.title).join(', ')}.`);
      else setNotice(itemOverride ? 'Đã cập nhật mục lịch.' : 'Đã thêm mục vào lịch.');
      setEditor(null);
      await onTasksChanged();
      if (range) await loadCalendar(range);
    } catch (caught) {
      setError(caught instanceof Error && !(caught instanceof ApiError) ? caught.message : friendlyError(caught));
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT' && range) await loadCalendar(range);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCalendarItem(item: CalendarItem, scope: 'THIS' | 'SERIES') {
    if (!window.confirm(scope === 'THIS' ? 'Xóa lần lặp này?' : `Xóa “${item.title}”${item.recurrence ? ' và toàn bộ chuỗi?' : '?'}`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/calendar/${item.seriesId}`, { method: 'DELETE', body: JSON.stringify({ version: item.version, scope, occurrenceStart: item.occurrenceStart }) });
      setEditor(null);
      setNotice('Đã xóa khỏi lịch.');
      if (range) await loadCalendar(range);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function persistMovedEvent(item: CalendarItem, event: { start: Date | null; end: Date | null; startStr: string; endStr: string; allDay: boolean }, revert: () => void) {
    if (item.kind === 'DEADLINE') {
      revert();
      return;
    }
    const times = eventTimes(event);
    if (!times) {
      revert();
      return;
    }
    try {
      const result = await api<{ item: CalendarItem; conflicts: Array<{ title: string }> }>(`/api/v1/calendar/${item.seriesId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: item.kind,
          taskId: item.taskId,
          title: item.kind === 'EVENT' ? item.title : null,
          description: item.description,
          allDay: times.allDay,
          start: times.start,
          end: times.end,
          color: item.color,
          recurrence: item.isOccurrence ? recurrenceDefault() : item.recurrence ?? recurrenceDefault(),
          version: item.version,
          scope: item.isOccurrence ? 'THIS' : 'SERIES',
          occurrenceStart: item.occurrenceStart
        })
      });
      if (result.conflicts.length) setNotice(`Đã di chuyển, nhưng đang trùng với: ${result.conflicts.map((conflict) => conflict.title).join(', ')}.`);
      if (range) await loadCalendar(range);
    } catch (caught) {
      revert();
      setError(friendlyError(caught));
    }
  }

  async function receiveTask(info: { event: { start: Date | null; end: Date | null; startStr: string; endStr: string; allDay: boolean; extendedProps: Record<string, unknown>; remove: () => void } }) {
    const taskId = String(info.event.extendedProps.taskId ?? '');
    const times = eventTimes(info.event);
    if (!taskId || !times) {
      info.event.remove();
      return;
    }
    try {
      const result = await api<{ item: CalendarItem; conflicts: Array<{ title: string }> }>('/api/v1/calendar', {
        method: 'POST',
        body: JSON.stringify({ kind: 'TASK_BLOCK', taskId, title: null, description: null, allDay: times.allDay, start: times.start, end: times.end, color: null, recurrence: recurrenceDefault() })
      });
      if (result.conflicts.length) setNotice(`Đã gán Task, nhưng đang trùng với: ${result.conflicts.map((conflict) => conflict.title).join(', ')}.`);
      if (range) await loadCalendar(range);
    } catch (caught) {
      info.event.remove();
      setError(friendlyError(caught));
    }
  }

  return <>
    <header className="topbar calendar-topbar"><div className="calendar-page-title"><p className="eyebrow">LẬP KẾ HOẠCH</p><h1><span className="calendar-title-icon" aria-hidden="true">▦</span>Lịch của bạn <span className="wave">✦</span></h1><p className="calendar-page-subtitle">Quản lý thời gian, phiên làm việc và các sự kiện trong một nơi.</p></div></header>
    {(error || notice) && <div className={`toast ${error ? 'error' : 'success'}`}><span>{error ? '!' : '✓'}</span><span>{error || notice}</span><button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
    <div className="calendar-layout">
      <aside className="calendar-sidebar">
        <button type="button" className="primary-button calendar-sidebar-create" onClick={() => openNew({ start: new Date().toISOString(), end: addMinutesIso(new Date().toISOString(), 60), allDay: false })}><span aria-hidden="true">＋</span><span>Tạo mục</span></button>
        <div className="calendar-sidebar-heading"><strong>Chưa lên lịch</strong><span>{unscheduledTasks.length}</span></div>
        <p className="calendar-sidebar-hint">Kéo Task vào một ngày hoặc khung giờ để tạo phiên làm việc.</p>
        <div className="calendar-task-tray" ref={taskTrayRef}>{unscheduledTasks.length ? unscheduledTasks.map((task) => <div className="calendar-task-drag" data-calendar-task="true" data-task-id={task.id} data-title={task.title} key={task.id}><span className="calendar-drag-handle">⋮⋮</span><span>{task.title}</span></div>) : <div className="calendar-no-tasks">Mọi Task đang có lịch hoặc đã hoàn thành.</div>}</div>
        <div className="calendar-filter-panel"><strong>Hiển thị</strong><label><input type="checkbox" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} /> Phiên Task</label><label><input type="checkbox" checked={showEvents} onChange={(event) => setShowEvents(event.target.checked)} /> Sự kiện</label><label><input type="checkbox" checked={showDeadlines} onChange={(event) => setShowDeadlines(event.target.checked)} /> Deadline</label><label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">Tất cả Project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label></div>
      </aside>
      <section className="calendar-card"><div className="calendar-loading" aria-live="polite">{loading && <><span className="spinner" /> Đang tải lịch…</>}</div><FullCalendar plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]} locales={[viLocale]} locale="vi" initialView="timeGridWeek" headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }} buttonText={{ today: 'Hôm nay', month: 'Tháng', week: 'Tuần', day: 'Ngày' }} firstDay={1} timeZone={user.timezone} height="auto" expandRows selectable selectMirror editable droppable nowIndicator slotDuration="00:15:00" snapDuration="00:15:00" slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="08:00:00" allDaySlot dayMaxEvents={4} eventDisplay="block" eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }} events={visibleItems.map((item) => calendarEventForItem(item, tasks))} datesSet={(info) => { void loadCalendar({ start: info.startStr, end: info.endStr }); }} select={(info) => openNew({ start: info.startStr, end: info.endStr, allDay: info.allDay })} dateClick={(info) => { if (info.allDay) openNew({ start: info.dateStr, end: addDateInput(info.dateStr, 1), allDay: true }); else openNew({ start: info.date.toISOString(), end: addMinutesIso(info.date.toISOString(), 60), allDay: false }); }} eventClick={(info) => openItem(info.event.extendedProps.item as CalendarItem)} eventDrop={(info) => void persistMovedEvent(info.event.extendedProps.item as CalendarItem, info.event, info.revert)} eventResize={(info) => void persistMovedEvent(info.event.extendedProps.item as CalendarItem, info.event, info.revert)} eventReceive={(info) => void receiveTask(info)} />{editor && <CalendarEditor editor={editor} projects={projects} tasks={tasks} busy={busy} onChange={setEditor} onCancel={() => setEditor(null)} onSave={(value) => void saveCalendarItem(value, value.item)} onDelete={(item, scope) => void deleteCalendarItem(item, scope)} />}</section>
    </div>
  </>;
}

function CalendarEditor({ editor, projects, tasks, busy, onChange, onCancel, onSave, onDelete }: { editor: CalendarEditorState; projects: Project[]; tasks: Task[]; busy: boolean; onChange: (value: CalendarEditorState) => void; onCancel: () => void; onSave: (value: CalendarEditorState) => void; onDelete: (item: CalendarItem, scope: 'THIS' | 'SERIES') => void }) {
  const update = (changes: Partial<CalendarEditorState>) => onChange({ ...editor, ...changes });
  const recurring = editor.recurrence.frequency !== 'NONE';
  const currentTask = tasks.find((task) => task.id === editor.taskId);
  function toggleAllDay(allDay: boolean) {
    const startDate = editor.start.slice(0, 10);
    const endDate = editor.end.slice(0, 10);
    if (allDay) {
      update({ allDay: true, start: startDate, end: endDate > startDate ? endDate : addDateInput(startDate, 1) });
    } else {
      update({ allDay: false, start: `${startDate}T09:00`, end: `${endDate > startDate ? endDate : startDate}T10:00` });
    }
  }
  return <div className="calendar-editor-backdrop" role="presentation"><form className="calendar-editor" onSubmit={(event) => { event.preventDefault(); onSave(editor); }}><div className="form-heading"><div><p className="eyebrow">{editor.item ? 'CHỈNH SỬA LỊCH' : 'MỤC LỊCH MỚI'}</p><h3>{editor.kind === 'EVENT' ? 'Sự kiện' : 'Phiên làm việc Task'}</h3></div><button type="button" className="close-button" onClick={onCancel}>×</button></div><div className="calendar-kind-tabs"><button type="button" className={editor.kind === 'TASK_BLOCK' ? 'active' : ''} onClick={() => update({ kind: 'TASK_BLOCK', title: currentTask?.title ?? editor.title })}>Task</button><button type="button" className={editor.kind === 'EVENT' ? 'active' : ''} onClick={() => update({ kind: 'EVENT', taskId: '', createNewTask: false })}>Sự kiện</button></div>{editor.kind === 'TASK_BLOCK' ? <><label>Task<select value={editor.createNewTask ? '__new__' : editor.taskId} onChange={(event) => event.target.value === '__new__' ? update({ createNewTask: true, taskId: '', title: '' }) : update({ createNewTask: false, taskId: event.target.value, title: tasks.find((task) => task.id === event.target.value)?.title ?? '' })}><option value="">Chọn Task</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}<option value="__new__">＋ Tạo Task mới</option></select></label>{editor.createNewTask && <><label>Tiêu đề Task<input value={editor.title} onChange={(event) => update({ title: event.target.value })} maxLength={200} required /></label><label>Project<select value={editor.projectId} onChange={(event) => update({ projectId: event.target.value })}><option value="">Chưa phân loại</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label></>}</> : <label>Tiêu đề<input value={editor.title} onChange={(event) => update({ title: event.target.value })} maxLength={200} required /></label>}<label className="calendar-all-day-toggle"><input type="checkbox" checked={editor.allDay} onChange={(event) => toggleAllDay(event.target.checked)} /> Cả ngày</label><div className="calendar-time-grid"><label>Bắt đầu<input type={editor.allDay ? 'date' : 'datetime-local'} value={editor.start} onChange={(event) => update({ start: event.target.value })} required /></label><label>Kết thúc<input type={editor.allDay ? 'date' : 'datetime-local'} value={editor.end} onChange={(event) => update({ end: event.target.value })} required /></label></div>{editor.kind === 'EVENT' && <><label>Màu<input type="color" value={editor.color} onChange={(event) => update({ color: event.target.value })} /></label><label>Lặp lại<select value={editor.recurrence.frequency} onChange={(event) => update({ recurrence: { ...editor.recurrence, frequency: event.target.value as CalendarRecurrence['frequency'] } })}><option value="NONE">Không lặp</option><option value="DAILY">Mỗi ngày</option><option value="WEEKLY">Mỗi tuần</option><option value="MONTHLY">Mỗi tháng</option></select></label>{recurring && <div className="calendar-recurrence-grid"><label>Mỗi <input type="number" min={1} max={365} value={editor.recurrence.interval} onChange={(event) => update({ recurrence: { ...editor.recurrence, interval: Number(event.target.value) || 1 } })} /> chu kỳ</label><label>Kết thúc lặp<input type="date" value={editor.recurrence.until ?? ''} onChange={(event) => update({ recurrence: { ...editor.recurrence, until: event.target.value || null } })} /></label>{editor.recurrence.frequency === 'WEEKLY' && <div className="weekday-picker"><span>Ngày trong tuần</span>{['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((label, day) => <label key={day}><input type="checkbox" checked={editor.recurrence.weekdays.includes(day)} onChange={(event) => update({ recurrence: { ...editor.recurrence, weekdays: event.target.checked ? [...editor.recurrence.weekdays, day].sort((a, b) => a - b) : editor.recurrence.weekdays.filter((value) => value !== day) } })} />{label}</label>)}</div>}</div>}</>}<label>Mô tả <span className="optional">Tùy chọn</span><textarea rows={3} value={editor.description} onChange={(event) => update({ description: event.target.value })} maxLength={5000} /></label>{editor.item?.isOccurrence && <label>Phạm vi thay đổi<select value={editor.scope} onChange={(event) => update({ scope: event.target.value as 'THIS' | 'SERIES' })}><option value="THIS">Chỉ lần này</option><option value="SERIES">Cả chuỗi</option></select></label>}<div className="form-actions"><button type="button" className="ghost-button" onClick={onCancel}>Hủy</button>{editor.item && <button type="button" className="ghost-button danger-action" onClick={() => onDelete(editor.item!, editor.item!.isOccurrence ? editor.scope : 'SERIES')}>Xóa</button>}<button className="primary-button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button></div></form></div>;
}

function ProjectForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (name: string, color: string | null) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7084f7');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave(name.trim(), color);
    if (!saved) return;
  }

  return <form className="project-create" onSubmit={submit}>
    <label>Tên Project<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Cá nhân" autoFocus maxLength={80} required /></label>
    <label className="color-field">Màu <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Màu Project" /></label>
    <div className="project-form-actions"><button type="button" className="tiny-cancel" onClick={onCancel}>Hủy</button><button type="submit" className="tiny-save" disabled={busy}>{busy ? 'Đang lưu…' : 'Tạo Project'}</button></div>
  </form>;
}

function ProjectRow({ project, selected, onSelect, onSave, onDelete, busy }: { project: Project; selected: boolean; onSelect: () => void; onSave: ProjectSaveHandler; onDelete: (project: Project) => Promise<void>; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? '#7084f7');
  if (editing) return <form className="project-edit" onSubmit={async (event) => { event.preventDefault(); const saved = await onSave(name.trim(), color, project.id, project.version); if (saved) setEditing(false); }}><label>Tên Project<input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} required /></label><label className="color-field">Màu <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={`Màu của ${project.name}`} /></label><div><button type="submit" className="tiny-save" disabled={busy}>Lưu</button><button type="button" className="tiny-cancel" onClick={() => setEditing(false)}>Hủy</button></div></form>;
  return <div className={`project-row ${selected ? 'selected' : ''}`}><button type="button" className="project-filter" onClick={onSelect}><span className="project-dot" style={{ background: project.color ?? '#7084f7' }} />{project.name}</button><div className="row-actions"><button type="button" className="mini-icon" title="Sửa Project" aria-label={`Sửa ${project.name}`} onClick={() => { setName(project.name); setColor(project.color ?? '#7084f7'); setEditing(true); }}>✎</button><button type="button" className="mini-icon danger-text" title="Xóa Project" aria-label={`Xóa ${project.name}`} onClick={() => void onDelete(project)}>×</button></div></div>;
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) {
  return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-pulse" /></div><strong>{value}</strong><small>{hint}</small></div>;
}

function EmptyState({ onCreate, hasFilters }: { onCreate: () => void; hasFilters: boolean }) {
  return <div className="empty-state"><div className="empty-icon">◌</div><h3>{hasFilters ? 'Không có Task phù hợp' : 'Chưa có công việc nào'}</h3><p>{hasFilters ? 'Thử đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Tạo Task đầu tiên để bắt đầu ngày làm việc rõ ràng hơn.'}</p>{!hasFilters && <button className="primary-button" onClick={onCreate}>＋ Tạo Task đầu tiên</button>}</div>;
}

function TaskCard({ task, projects, onToggle, onEdit, onDelete, busy }: { task: Task; projects: Project[]; onToggle: (task: Task) => Promise<void>; onEdit: () => void; onDelete: (task: Task) => Promise<void>; busy: boolean }) {
  const project = projects.find((item) => item.id === task.projectId);
  const statusLabel = task.status === 'DONE' ? 'Đã xong' : task.status === 'IN_PROGRESS' ? 'Đang làm' : 'Chưa làm';
  return <article className={`task-card ${task.status === 'DONE' ? 'completed' : ''} ${task.deadlineBucket === 'OVERDUE' && task.status !== 'DONE' ? 'overdue-card' : ''}`}><button className={`check-button ${task.status === 'DONE' ? 'checked' : ''}`} title={task.status === 'DONE' ? 'Mở lại Task' : 'Đánh dấu hoàn thành'} onClick={() => void onToggle(task)} disabled={busy}>{task.status === 'DONE' ? '✓' : ''}</button><div className="task-main"><div className="task-title-line"><h3>{task.title}</h3><span className={`priority-pill ${task.priority.toLowerCase()}`}>{task.priority === 'HIGH' ? 'Cao' : task.priority === 'LOW' ? 'Thấp' : 'Vừa'}</span></div>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta"><span className={`deadline-pill ${task.deadlineBucket.toLowerCase()}`}>{task.deadlineBucket === 'OVERDUE' ? '!' : task.deadlineBucket === 'TODAY' ? '◷' : task.deadlineBucket === 'UPCOMING' ? '⌁' : '—'} {task.relativeDeadline}</span>{project && <span className="project-meta"><span className="project-dot" style={{ background: project.color ?? '#7084f7' }} />{project.name}</span>}<span className={`status-label ${task.status.toLowerCase()}`}>{statusLabel}</span></div></div><div className="task-actions"><button className="mini-icon" title="Sửa Task" onClick={onEdit}>✎</button><button className="mini-icon danger-text" title="Xóa Task" onClick={() => void onDelete(task)}>×</button></div><div className="task-date">{task.deadlineLabel}</div></article>;
}

type TaskFormProps = { projects: Project[]; timezone: string; editingTask: Task | null; defaultProjectId: string | null; busy: boolean; onCancel: () => void; onSave: (payload: TaskPayload, id?: string) => Promise<void> };
type TaskFormState = Omit<TaskPayload, 'dueAt' | 'version'> & { dueAt: string; version?: number };

function taskToForm(task: Task | null, timeZone: string, defaultProjectId: string | null): TaskFormState {
  return task ? { projectId: task.projectId, title: task.title, description: task.description ?? '', status: task.status, priority: task.priority, deadlineType: task.deadlineType, dueDate: task.dueDate, dueAt: isoToDateTimeLocal(task.dueAt, timeZone), version: task.version } : { projectId: defaultProjectId, title: '', description: '', status: 'TODO', priority: 'MEDIUM', deadlineType: 'NONE', dueDate: null, dueAt: '' };
}

function TaskForm({ projects, timezone, editingTask, defaultProjectId, busy, onCancel, onSave }: TaskFormProps) {
  const [form, setForm] = useState<TaskFormState>(() => taskToForm(editingTask, timezone, defaultProjectId));
  const [detailsOpen, setDetailsOpen] = useState(Boolean(editingTask));
  const [formError, setFormError] = useState('');
  useEffect(() => { setForm(taskToForm(editingTask, timezone, defaultProjectId)); setDetailsOpen(Boolean(editingTask)); setFormError(''); }, [editingTask, timezone, defaultProjectId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (form.deadlineType === 'DATE' && !form.dueDate) {
      setDetailsOpen(true);
      setFormError('Chọn ngày đến hạn hoặc đổi Deadline thành “Không có hạn”.');
      return;
    }
    if (form.deadlineType === 'DATETIME' && !form.dueAt) {
      setDetailsOpen(true);
      setFormError('Chọn thời điểm đến hạn hoặc đổi Deadline thành “Không có hạn”.');
      return;
    }
    await onSave({ ...form, description: form.description || null, dueDate: form.deadlineType === 'DATE' ? form.dueDate : null, dueAt: form.deadlineType === 'DATETIME' ? dateTimeLocalToIso(form.dueAt, timezone) : null }, editingTask?.id);
  }
  return <form className="task-form" onSubmit={submit}><div className="form-heading"><div><p className="eyebrow">{editingTask ? 'CHỈNH SỬA' : 'TASK MỚI'}</p><h3>{editingTask ? 'Cập nhật công việc' : 'Thêm công việc nhanh'}</h3>{!editingTask && <p className="form-hint">Nhập tiêu đề trước, thêm deadline hoặc Project nếu cần.</p>}</div><button type="button" className="close-button" onClick={onCancel} aria-label="Đóng biểu mẫu">×</button></div><label className="task-title-field">Tiêu đề<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ví dụ: Hoàn thiện báo cáo tuần" autoFocus required maxLength={200} /></label>{!editingTask && <button type="button" className="details-toggle" onClick={() => setDetailsOpen((current) => !current)}>{detailsOpen ? 'Ẩn bớt chi tiết' : '＋ Thêm deadline, Project và chi tiết'}</button>}{(detailsOpen || Boolean(editingTask)) && <div className="form-grid"><label>Mức ưu tiên<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}><option value="LOW">Thấp</option><option value="MEDIUM">Vừa</option><option value="HIGH">Cao</option></select></label><label>Trạng thái<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}><option value="TODO">Chưa làm</option><option value="IN_PROGRESS">Đang làm</option><option value="DONE">Đã xong</option></select></label><label>Project<select value={form.projectId ?? ''} onChange={(event) => setForm({ ...form, projectId: event.target.value || null })}><option value="">Chưa phân loại</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Deadline<select value={form.deadlineType} onChange={(event) => setForm({ ...form, deadlineType: event.target.value as DeadlineType, dueDate: null, dueAt: '' })}><option value="NONE">Không có hạn</option><option value="DATE">Chỉ ngày</option><option value="DATETIME">Ngày và giờ</option></select></label>{form.deadlineType === 'DATE' && <label>Ngày đến hạn<input type="date" value={form.dueDate ?? ''} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} required /></label>}{form.deadlineType === 'DATETIME' && <label>Thời điểm đến hạn<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} required /></label>}<label className="wide">Mô tả <span className="optional">Tùy chọn</span><textarea value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Thêm một chút ngữ cảnh…" maxLength={5000} /></label></div>}{formError && <div className="form-error">{formError}</div>}<div className="form-actions"><button type="button" className="ghost-button" onClick={onCancel}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? 'Đang lưu…' : editingTask ? 'Lưu thay đổi' : 'Tạo Task'}</button></div></form>;
}
