import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Bell, CalendarDays, ClipboardList, ContactRound, Headphones, KeyRound, ListTree, LoaderCircle, LogIn, LogOut, Menu, PackageCheck, Server, ShieldCheck, SlidersHorizontal, UserRound, Wrench, X } from 'lucide-react';
import { ApiClient, ApiError, invalidateApiCache, OPERATION_GROUPS_LOCAL_CHANGE_EVENT, resetApiClientState } from './api/client';
import { FloatingNotice } from './components/FloatingNotice';
import { CustomerView } from './modules/customer/CustomerView';
import { ManagerView } from './modules/manager/ManagerView';
import { ActivityView } from './modules/activities/ActivityView';
import { PlayerDirectoryView } from './modules/player-directory/PlayerDirectoryView';
import { TeamView } from './modules/team-view/TeamView';
import { ServerOperationsView } from './modules/server-operations/ServerOperationsView';
import type { AppOptions, Session, User, WorkspaceId } from './types';
import { isUploadEnabled, isWorkspaceEnabled } from './permissions';
import { GROUPS_CHANGED_EVENT, parseGroupChange } from './modules/operation-groups/live-refresh';

type Workspace = WorkspaceId;
type WorkspaceCounts = Partial<Record<Workspace, number>> & { reminderIssuance?: number; reminderRegular?: number; ownIssuance?: number; ownRegular?: number };
type NavItem = { id: Workspace; label: string; icon: typeof Headphones };
const workspacePaths: Record<Workspace, string> = { request: '/request', records: '/records', 'player-directory': '/player-directory', 'team-view': '/team-view', 'server-operations': '/server-operations', reminders: '/reminders', activities: '/activities', queue: '/queue', ready: '/ready', archive: '/archive', reissue: '/reissue', accounts: '/accounts' };
const allWorkspaceItems: NavItem[] = [
  { id: 'request', label: '申请操作', icon: Wrench }, { id: 'records', label: '我的申请', icon: ClipboardList },
  { id: 'reminders', label: '待提醒', icon: Bell }, { id: 'queue', label: '待审核', icon: Headphones },
  { id: 'ready', label: '待完成', icon: PackageCheck }, { id: 'reissue', label: '物资发放记录', icon: Archive },
  { id: 'archive', label: '常规操作记录', icon: Archive }, { id: 'activities', label: '活动与道具', icon: CalendarDays },
  { id: 'player-directory', label: '玩家列表', icon: ContactRound }, { id: 'team-view', label: '所有队伍', icon: ListTree },
  { id: 'accounts', label: '账号管理', icon: ShieldCheck }, { id: 'server-operations', label: '服务器管理', icon: Server },
];
const REMEMBER_LOGIN_KEY = 'ops-desk-remembered-login';

function readRememberedLogin() {
  if (typeof window === 'undefined') return { username: '', password: '' };
  try { const value = JSON.parse(window.localStorage.getItem(REMEMBER_LOGIN_KEY) ?? '{}') as { username?: unknown; password?: unknown }; return { username: typeof value.username === 'string' ? value.username : '', password: typeof value.password === 'string' ? value.password : '' }; }
  catch { return { username: '', password: '' }; }
}
function persistRememberedLogin(username: string, password: string, remember: boolean) { try { if (remember) window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({ username, password })); else window.localStorage.removeItem(REMEMBER_LOGIN_KEY); } catch { /* Storage can be disabled. */ } }
function roleLabel(role: Session['user']['role']) { return role === 'super_admin' ? '超级管理' : role === 'manager' ? '管理' : '普通客服'; }
function workspaceItems(user: User) { return allWorkspaceItems.filter(({ id }) => isWorkspaceEnabled(user, id)); }
function defaultWorkspace(user: User): Workspace | null { const preferred = user.role === 'customer' ? 'request' : user.role === 'super_admin' ? 'ready' : 'queue'; return workspaceItems(user).find(({ id }) => id === preferred)?.id ?? workspaceItems(user)[0]?.id ?? null; }
function workspaceFromPath(user: User): Workspace | null { const path = window.location.pathname.replace(/\/$/, ''); const found = (Object.entries(workspacePaths) as Array<[Workspace, string]>).find(([, value]) => value === path)?.[0]; return found && isWorkspaceEnabled(user, found) ? found : defaultWorkspace(user); }

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [options, setOptions] = useState<AppOptions | null>(null);
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<Workspace | null>('request');
  const [workspaceCounts, setWorkspaceCounts] = useState<WorkspaceCounts>({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const client = useMemo(() => new ApiClient(session?.user.id ?? 'anonymous'), [session?.user.id]);

  useEffect(() => { document.body.style.overflow = mobileNavOpen ? 'hidden' : ''; document.documentElement.style.overflow = mobileNavOpen ? 'hidden' : ''; return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }; }, [mobileNavOpen]);
  useEffect(() => { if (!session) return; const next = workspaceFromPath(session.user); setWorkspace(next); const nextPath = next ? workspacePaths[next] : '/'; if (window.location.pathname !== nextPath) window.history.replaceState({}, '', nextPath); }, [session?.user.id, session?.user.role, session?.user.workspacePermissions]);
  useEffect(() => { const onPopState = () => { if (session) { invalidateApiCache(); setWorkspace(workspaceFromPath(session.user)); } }; window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, [session]);
  useEffect(() => { const bootstrap = async () => { try { const user = await new ApiClient().me(); setSession({ user, expiresAt: '' }); } catch (reason) { if (reason instanceof ApiError && reason.code !== 'unauthorized') setError(reason.message); } finally { setChecking(false); } }; void bootstrap(); }, []);
  useEffect(() => { if (!session) { setOptions(null); return; } setError(''); client.options().then(setOptions).catch((reason) => { setSession(null); setOptions(null); setError(reason instanceof ApiError ? reason.message : '会话已失效，请重新登录'); }); }, [session?.user.id, client]);
  useWorkspaceCounts(session, client, setWorkspaceCounts);

  const login = async (username: string, password: string) => { const result = await new ApiClient().login(username, password); resetApiClientState(); setSession({ user: result.user, expiresAt: result.expiresAt }); setOptions(null); };
  const logout = async () => { try { await client.logout(); } catch { /* local session still clears */ } resetApiClientState(); setSession(null); setOptions(null); window.history.pushState({}, '', '/'); };
  const relogin = () => { void logout(); setError('密码已修改，请使用新密码重新登录'); };
  const selectWorkspace = (next: Workspace) => { if (!session || !isWorkspaceEnabled(session.user, next)) return; if (next !== workspace) invalidateApiCache(); setWorkspace(next); setMobileNavOpen(false); if (window.location.pathname !== workspacePaths[next]) window.history.pushState({}, '', workspacePaths[next]); };

  if (checking) return <div className="app-loading"><div className="loading-mark"><LoaderCircle className="spin" size={24} /></div><p>正在验证会话</p></div>;
  if (!session) return <LoginView onLogin={login} initialError={error} />;
  if (!options) return <div className="app-loading"><div className="loading-mark"><LoaderCircle className="spin" size={24} /></div><p>正在加载工作台</p></div>;
  if (!workspace) return <NoWorkspaceView onLogout={() => void logout()} />;
  const items = workspaceItems(session.user);
  const managerPanel = workspace === 'ready' || workspace === 'archive' || workspace === 'reissue' ? workspace : workspace === 'accounts' ? 'users' : 'queue';
  const updateSessionUser = (next: User) => setSession((current) => current && current.user.id === next.id ? { ...current, user: next } : current);
  const content = workspace === 'server-operations' ? <ServerOperationsView options={options} userId={session.user.id} token={session.token} />
    : workspace === 'player-directory' ? <PlayerDirectoryView options={options} userId={session.user.id} token={session.token} uploadEnabled={isUploadEnabled(session.user, 'player-directory')} />
    : workspace === 'team-view' ? <TeamView userId={session.user.id} token={session.token} uploadEnabled={isUploadEnabled(session.user, 'team-view')} />
    : workspace === 'activities' ? <ActivityView userId={session.user.id} token={session.token} uploadEnabled={isUploadEnabled(session.user, 'item-catalog')} />
    : workspace === 'reminders' ? <CustomerView options={options} userId={session.user.id} token={session.token} section="reminders" reminderCounts={{ issuance: workspaceCounts.reminderIssuance, regular: workspaceCounts.reminderRegular }} />
    : workspace === 'archive' || workspace === 'reissue' ? <ManagerView options={options} userId={session.user.id} token={session.token} panel={managerPanel} actorId={session.user.id} onRequireRelogin={relogin} />
    : workspace === 'queue' || workspace === 'ready' || workspace === 'accounts' ? <ManagerView options={options} userId={session.user.id} token={session.token} panel={managerPanel} actorId={session.user.id} onRequireRelogin={relogin} onUserUpdated={updateSessionUser} />
    : <CustomerView options={options} userId={session.user.id} token={session.token} section={workspace === 'records' ? 'records' : 'operations'} recordCounts={{ issuance: workspaceCounts.ownIssuance, regular: workspaceCounts.ownRegular }} onNavigate={(next) => selectWorkspace(next === 'records' ? 'records' : next === 'reminders' ? 'reminders' : 'request')} />;
  return <div className={`app-shell ${mobileNavOpen ? 'mobile-nav-open' : ''}`}><aside id="mobile-workspace-nav" className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}><div className="brand"><div className="brand-mark"><SlidersHorizontal size={18} /></div><div><strong>OPS DESK</strong><span>游戏客服工单</span></div><button type="button" className="icon-button mobile-nav-close" title="关闭导航" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={19} /></button></div><nav className="side-nav"><div className="nav-label">工作区</div>{items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={workspace === id ? 'side-link active' : 'side-link'} onClick={() => selectWorkspace(id)} aria-current={workspace === id ? 'page' : undefined}><Icon size={17} /><span>{label}</span>{workspaceCounts[id] ? <b className="nav-count">{workspaceCounts[id]}</b> : null}</button>)}</nav><div className="sidebar-foot"><div className="connection-dot" /><span>本地服务已连接</span></div></aside>{mobileNavOpen && <button type="button" className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}<main className="main-area"><header className="topbar"><button type="button" className="icon-button mobile-nav-toggle" title="打开导航" aria-label="打开导航" aria-controls="mobile-workspace-nav" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button><div className="mobile-brand"><div className="brand-mark"><SlidersHorizontal size={16} /></div><strong>OPS DESK</strong></div><div className="topbar-user"><span className="avatar">{session.user.displayName.slice(0, 1)}</span><span>{session.user.displayName} · {roleLabel(session.user.role)}</span><button type="button" className="icon-button logout-button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={17} /></button></div></header>{content}</main></div>;
}

function useWorkspaceCounts(session: Session | null, client: ApiClient, setCounts: (value: WorkspaceCounts) => void) {
  useEffect(() => {
    if (!session) { setCounts({}); return; }
    let timer: number | undefined; let dirty = false; let requestId = 0;
    const load = async () => { const id = ++requestId; try { const value = await client.workspaceCounts(); if (id === requestId) setCounts({ queue: value.pending, ready: value.ready, reminders: value.reminders, reminderIssuance: value.reminderIssuance, reminderRegular: value.reminderRegular, ownIssuance: value.ownIssuance, ownRegular: value.ownRegular }); } catch { /* panels expose errors */ } };
    const schedule = () => { if (!dirty || document.visibilityState === 'hidden' || timer !== undefined) return; timer = window.setTimeout(() => { timer = undefined; if (document.visibilityState === 'hidden') return; dirty = false; void load(); }, 50); };
    const localChanged = () => { dirty = true; schedule(); };
    const changed = (event: Event) => { const detail = parseGroupChange((event as MessageEvent<string>).data); if (!detail) return; invalidateApiCache(); dirty ||= detail.counts; schedule(); window.dispatchEvent(new CustomEvent(GROUPS_CHANGED_EVENT, { detail })); };
    void load(); const stream = client.events(); stream.addEventListener('changed', changed); document.addEventListener('visibilitychange', schedule); window.addEventListener(OPERATION_GROUPS_LOCAL_CHANGE_EVENT, localChanged);
    return () => { requestId += 1; stream.close(); document.removeEventListener('visibilitychange', schedule); window.removeEventListener(OPERATION_GROUPS_LOCAL_CHANGE_EVENT, localChanged); if (timer !== undefined) window.clearTimeout(timer); };
  }, [session?.user.id, session?.user.role, session?.user.workspacePermissions, client, setCounts]);
}

function NoWorkspaceView({ onLogout }: { onLogout: () => void }) { return <section className="workspace access-denied-workspace"><div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><h1>暂无可见工作区</h1><p>请联系管理员分配工作区权限。</p><button type="button" className="secondary-button" onClick={onLogout}><LogOut size={16} />退出登录</button></div></section>; }

function LoginView({ onLogin, initialError }: { onLogin: (username: string, password: string) => Promise<void>; initialError?: string }) {
  const remembered = readRememberedLogin();
  const [rememberLogin, setRememberLogin] = useState(Boolean(remembered.username || remembered.password));
  const [username, setUsername] = useState(remembered.username); const [password, setPassword] = useState(remembered.password); const [error, setError] = useState(initialError ?? ''); const [loading, setLoading] = useState(false);
  useEffect(() => { if (!rememberLogin) persistRememberedLogin('', '', false); }, [rememberLogin]);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (!username.trim() || !password) return setError('请输入账号和密码'); setLoading(true); try { await onLogin(username.trim(), password); persistRememberedLogin(username.trim(), password, rememberLogin); } catch (reason) { setError(reason instanceof ApiError ? reason.message : '登录失败，请稍后重试'); } finally { setLoading(false); } };
  return <main className="login-shell"><div className="login-aside"><div className="brand"><div className="brand-mark"><SlidersHorizontal size={20} /></div><div><strong>OPS DESK</strong><span>游戏客服工单</span></div></div><div className="login-aside-copy"><h1>管理后台</h1><p>统一处理申请、审核与账号权限。</p></div><div className="login-aside-foot">受控访问 · 三层权限</div></div><section className="login-panel"><div className="login-icon"><ShieldCheck size={24} /></div><p className="eyebrow">安全登录</p><h2>欢迎回来</h2><p className="login-subtitle">使用管理员分配的账号继续工作</p><form onSubmit={submit}><label><span>登录账号</span><div className="input-with-icon"><UserRound size={17} /><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入账号" /></div></label><label><span>密码</span><div className="input-with-icon"><KeyRound size={17} /><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" /></div></label><label className="remember-login"><input type="checkbox" checked={rememberLogin} onChange={(event) => setRememberLogin(event.target.checked)} /><span>记住账号密码</span></label><button className="primary-button login-button" disabled={loading} type="submit">{loading ? '登录中…' : '登录工作台'}<LogIn size={17} /></button></form><p className="login-note">不支持注册，请联系管理员。</p>{error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} />}</section></main>;
}
