import { FormEvent, useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type User = { id: string; email: string; timezone: string; createdAt: string };
type Project = { id: string; userId: string; name: string; color: string | null; createdAt: string; updatedAt: string; version: number };
type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
type DeadlineType = 'NONE' | 'DATE' | 'DATETIME';
type DeadlineBucket = 'NO_DEADLINE' | 'OVERDUE' | 'TODAY' | 'UPCOMING';
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

function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return 'Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại, hãy kiểm tra rồi lưu lại.';
  if (error instanceof ApiError) return error.message;
  return 'Có lỗi xảy ra. Vui lòng thử lại.';
}

function todayLabel(timeZone: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
}

export default function App() {
  const [auth, setAuth] = useState<{ loading: boolean; user: User | null }>({ loading: true, user: null });

  useEffect(() => {
    api<{ user: User | null }>('/api/v1/auth/me')
      .then(({ user }) => setAuth({ loading: false, user }))
      .catch(() => setAuth({ loading: false, user: null }));
  }, []);

  if (auth.loading) return <div className="app-loading"><span className="spinner" /> Đang tải không gian làm việc…</div>;
  if (!auth.user) return <AuthScreen onAuthenticated={(user) => setAuth({ loading: false, user })} />;
  return <Workspace user={auth.user} onLogout={() => setAuth({ loading: false, user: null })} />;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
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
      <section className="auth-intro">
        <div className="brand-mark">✓</div>
        <p className="eyebrow">PERSONAL TASK MANAGER</p>
        <h1>Nhẹ đầu hơn khi mọi việc có chỗ để đi.</h1>
        <p className="intro-copy">Gom những việc cần làm, deadline và dự án vào một không gian rõ ràng để bạn biết việc tiếp theo là gì.</p>
        <div className="intro-note"><span>✦</span> Bản local đầu tiên · múi giờ Asia/Bangkok</div>
      </section>
      <section className="auth-card">
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Tạo tài khoản</button>
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

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [bucketFilter, setBucketFilter] = useState<'ALL' | DeadlineBucket>('ALL');
  const [search, setSearch] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
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

  async function saveProject(name: string, color: string | null, id?: string, version?: number) {
    setBusy(true);
    try {
      const result = id
        ? await api<{ project: Project }>(`/api/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name, color, version }) })
        : await api<{ project: Project }>('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name, color }) });
      setProjects((current) => id ? current.map((project) => project.id === id ? result.project : project) : [...current, result.project]);
      setNotice(id ? 'Đã cập nhật Project.' : 'Đã thêm Project.');
    } catch (caught) {
      setError(friendlyError(caught));
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await loadData();
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`Xóa Project “${project.name}”? Task sẽ được chuyển về chưa phân loại.`)) return;
    setBusy(true);
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
        <button className="nav-item active"><span className="nav-icon">▦</span> Công việc <span className="nav-count">{counts.active}</span></button>
        <button className={`nav-item ${bucketFilter === 'TODAY' ? 'selected' : ''}`} onClick={() => { setBucketFilter('TODAY'); setStatusFilter('ALL'); }}><span className="nav-icon">◷</span> Hôm nay <span className="nav-count accent">{counts.today}</span></button>
        <button className={`nav-item ${bucketFilter === 'OVERDUE' ? 'selected' : ''}`} onClick={() => { setBucketFilter('OVERDUE'); setStatusFilter('ALL'); }}><span className="nav-icon">!</span> Quá hạn <span className="nav-count danger">{counts.overdue}</span></button>
        <button className={`nav-item ${statusFilter === 'DONE' ? 'selected' : ''}`} onClick={() => { setStatusFilter('DONE'); setBucketFilter('ALL'); }}><span className="nav-icon">✓</span> Đã hoàn thành <span className="nav-count">{counts.done}</span></button>
        <div className="sidebar-section-label project-label">PROJECTS <button className="icon-button" title="Tạo Project" onClick={() => void saveProject('Project mới', null)}>＋</button></div>
        <div className="project-list">
          <button className={`project-filter ${selectedProject === 'all' ? 'selected' : ''}`} onClick={() => setSelectedProject('all')}><span className="project-dot all" /> Tất cả Project</button>
          {projects.map((project) => <ProjectRow key={project.id} project={project} selected={selectedProject === project.id} onSelect={() => setSelectedProject(project.id)} onSave={saveProject} onDelete={removeProject} busy={busy} />)}
          <button className={`project-filter ${selectedProject === 'none' ? 'selected' : ''}`} onClick={() => setSelectedProject('none')}><span className="project-dot muted" /> Chưa phân loại</button>
        </div>
        <div className="sidebar-footer">
          <div className="user-chip"><div className="avatar">{user.email.slice(0, 1).toUpperCase()}</div><div className="user-details"><strong>{user.email.split('@')[0]}</strong><span>{user.email}</span></div><button className="icon-button" title="Đăng xuất" onClick={logout}>↪</button></div>
          <div className="timezone-note">Múi giờ: {user.timezone}</div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div><p className="eyebrow">{todayLabel(user.timezone)}</p><h1>Xin chào, {user.email.split('@')[0]} <span className="wave">✦</span></h1></div><button className="primary-button" onClick={() => { setEditingTask(null); setShowTaskForm(true); }}>＋ Tạo Task</button></header>
        {(error || notice) && <div className={`toast ${error ? 'error' : 'success'}`}><span>{error ? '!' : '✓'}</span><span>{error || notice}</span><button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
        <section className="stats-grid"><StatCard label="ĐANG THỰC HIỆN" value={counts.active} hint="Task chưa hoàn thành" tone="blue" /><StatCard label="HÔM NAY" value={counts.today} hint="Có deadline hôm nay" tone="yellow" /><StatCard label="QUÁ HẠN" value={counts.overdue} hint={counts.overdue ? 'Cần bạn chú ý' : 'Mọi thứ đang đúng hạn'} tone="red" /><StatCard label="ĐÃ XONG" value={counts.done} hint="Task đã hoàn thành" tone="green" /></section>
        <section className="tasks-section">
          <div className="section-heading"><div><h2>Danh sách công việc</h2><p>{filteredTasks.length} Task trong chế độ xem hiện tại</p></div><button className="ghost-button" onClick={() => void loadData()}>↻ Làm mới</button></div>
          <div className="toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm công việc…" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | TaskStatus)}><option value="ALL">Tất cả trạng thái</option><option value="TODO">Chưa làm</option><option value="IN_PROGRESS">Đang làm</option><option value="DONE">Đã xong</option></select><select value={bucketFilter} onChange={(event) => setBucketFilter(event.target.value as 'ALL' | DeadlineBucket)}><option value="ALL">Tất cả deadline</option><option value="OVERDUE">Quá hạn</option><option value="TODAY">Hôm nay</option><option value="UPCOMING">Sắp tới</option></select></div>
          {showTaskForm && <TaskForm projects={projects} editingTask={editingTask} busy={busy} onCancel={() => { setShowTaskForm(false); setEditingTask(null); }} onSave={saveTask} />}
          {loading ? <div className="empty-state"><span className="spinner" /> Đang tải công việc…</div> : filteredTasks.length === 0 ? <EmptyState onCreate={() => { setEditingTask(null); setShowTaskForm(true); }} hasFilters={Boolean(search || selectedProject !== 'all' || statusFilter !== 'ALL' || bucketFilter !== 'ALL')} /> : <div className="task-list">{filteredTasks.map((task) => <TaskCard key={task.id} task={task} projects={projects} onToggle={toggleTask} onEdit={() => { setEditingTask(task); setShowTaskForm(true); }} onDelete={removeTask} busy={busy} />)}</div>}
        </section>
      </main>
    </div>
  );
}

function ProjectRow({ project, selected, onSelect, onSave, onDelete, busy }: { project: Project; selected: boolean; onSelect: () => void; onSave: (name: string, color: string | null, id?: string, version?: number) => Promise<void>; onDelete: (project: Project) => Promise<void>; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? '#7084f7');
  if (editing) return <form className="project-edit" onSubmit={async (event) => { event.preventDefault(); await onSave(name, color, project.id, project.version); setEditing(false); }}><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /><div><button type="submit" className="tiny-save" disabled={busy}>Lưu</button><button type="button" className="tiny-cancel" onClick={() => setEditing(false)}>Hủy</button></div></form>;
  return <div className={`project-row ${selected ? 'selected' : ''}`}><button className="project-filter" onClick={onSelect}><span className="project-dot" style={{ background: project.color ?? '#7084f7' }} />{project.name}</button><div className="row-actions"><button className="mini-icon" title="Sửa Project" onClick={() => { setName(project.name); setColor(project.color ?? '#7084f7'); setEditing(true); }}>✎</button><button className="mini-icon danger-text" title="Xóa Project" onClick={() => void onDelete(project)}>×</button></div></div>;
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

type TaskFormProps = { projects: Project[]; editingTask: Task | null; busy: boolean; onCancel: () => void; onSave: (payload: TaskPayload, id?: string) => Promise<void> };
type TaskFormState = Omit<TaskPayload, 'dueAt' | 'version'> & { dueAt: string; version?: number };

function taskToForm(task: Task | null): TaskFormState {
  return task ? { projectId: task.projectId, title: task.title, description: task.description ?? '', status: task.status, priority: task.priority, deadlineType: task.deadlineType, dueDate: task.dueDate, dueAt: isoToDateTimeLocal(task.dueAt), version: task.version } : { projectId: null, title: '', description: '', status: 'TODO', priority: 'MEDIUM', deadlineType: 'NONE', dueDate: null, dueAt: '' };
}

function TaskForm({ projects, editingTask, busy, onCancel, onSave }: TaskFormProps) {
  const [form, setForm] = useState<TaskFormState>(() => taskToForm(editingTask));
  useEffect(() => setForm(taskToForm(editingTask)), [editingTask]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({ ...form, description: form.description || null, dueDate: form.deadlineType === 'DATE' ? form.dueDate : null, dueAt: form.deadlineType === 'DATETIME' ? dateTimeLocalToIso(form.dueAt) : null }, editingTask?.id);
  }
  return <form className="task-form" onSubmit={submit}><div className="form-heading"><div><p className="eyebrow">{editingTask ? 'CHỈNH SỬA' : 'TASK MỚI'}</p><h3>{editingTask ? 'Cập nhật công việc' : 'Bạn muốn hoàn thành gì?'}</h3></div><button type="button" className="close-button" onClick={onCancel}>×</button></div><div className="form-grid"><label className="wide">Tiêu đề<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ví dụ: Hoàn thiện báo cáo tuần" autoFocus required maxLength={200} /></label><label>Mức ưu tiên<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}><option value="LOW">Thấp</option><option value="MEDIUM">Vừa</option><option value="HIGH">Cao</option></select></label><label>Trạng thái<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}><option value="TODO">Chưa làm</option><option value="IN_PROGRESS">Đang làm</option><option value="DONE">Đã xong</option></select></label><label>Project<select value={form.projectId ?? ''} onChange={(event) => setForm({ ...form, projectId: event.target.value || null })}><option value="">Chưa phân loại</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Deadline<select value={form.deadlineType} onChange={(event) => setForm({ ...form, deadlineType: event.target.value as DeadlineType, dueDate: null, dueAt: '' })}><option value="NONE">Không có hạn</option><option value="DATE">Chỉ ngày</option><option value="DATETIME">Ngày và giờ</option></select></label>{form.deadlineType === 'DATE' && <label>Ngày đến hạn<input type="date" value={form.dueDate ?? ''} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} required /></label>}{form.deadlineType === 'DATETIME' && <label>Thời điểm đến hạn<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} required /></label>}<label className="wide">Mô tả <span className="optional">Tùy chọn</span><textarea value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Thêm một chút ngữ cảnh…" maxLength={5000} /></label></div><div className="form-actions"><button type="button" className="ghost-button" onClick={onCancel}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? 'Đang lưu…' : editingTask ? 'Lưu thay đổi' : 'Tạo Task'}</button></div></form>;
}
