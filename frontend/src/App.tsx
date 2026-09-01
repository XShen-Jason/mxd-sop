import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, ClipboardList, Headphones, KeyRound, LoaderCircle, LogIn, LogOut, Menu, PackageCheck, ShieldCheck, SlidersHorizontal, UserRound, Wrench, X } from 'lucide-react';
import { ApiClient, ApiError } from './api/client';
import { FloatingNotice } from './components/FloatingNotice';
import { CustomerView } from './modules/customer/CustomerView';
import { ManagerView } from './modules/manager/ManagerView';
import type { AppOptions, Session } from './types';

function roleLabel(role: Session['user']['role']) { return role === 'super_admin' ? '超级管理' : role === 'manager' ? '管理' : '普通客服'; }
type Workspace = 'request' | 'records' | 'queue' | 'ready' | 'archive' | 'reissue' | 'accounts';
type NavItem = { id: Workspace; label: string; icon: typeof Headphones };
function defaultWorkspace(role: Session['user']['role']): Workspace { return role === 'customer' ? 'request' : role === 'super_admin' ? 'ready' : 'queue'; }
function workspaceItems(role: Session['user']['role']): NavItem[] {
  const items: NavItem[] = [
    { id: 'request', label: '申请操作', icon: Wrench },
    { id: 'records', label: '我的申请', icon: ClipboardList }
  ];
  if (role === 'customer') return items;
  items.push({ id: 'queue', label: '待审核', icon: Headphones });
  if (role === 'super_admin') items.push({ id: 'ready', label: '待完成', icon: PackageCheck });
  items.push({ id: 'reissue', label: '物资发放记录', icon: Archive }, { id: 'archive', label: '常规记录', icon: Archive }, { id: 'accounts', label: '账号管理', icon: ShieldCheck });
  return items;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [options, setOptions] = useState<AppOptions | null>(null);
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>(() => session ? defaultWorkspace(session.user.role) : 'request');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const client = useMemo(() => new ApiClient(session?.user.role ?? 'customer'), [session?.user.role]);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    document.documentElement.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; };
  }, [mobileNavOpen]);

  useEffect(() => { if (session) setWorkspace(defaultWorkspace(session.user.role)); }, [session?.user.role]);

  useEffect(() => {
    const bootstrap = async () => {
      try { const user = await new ApiClient().me(); setSession({ user, expiresAt: '' }); }
      catch { /* no active cookie; show login */ }
      finally { setChecking(false); }
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!session) { setOptions(null); return; }
    setError('');
    client.options().then(setOptions).catch((err) => { setSession(null); setOptions(null); setError(err instanceof ApiError ? err.message : '会话已失效，请重新登录'); });
  }, [session?.user.id]);

  const login = async (username: string, password: string) => { const result = await new ApiClient().login(username, password); setSession({ user: result.user, expiresAt: result.expiresAt }); setOptions(null); };
  const logout = async () => { try { await client.logout(); } catch { /* local session is still cleared */ } setSession(null); setOptions(null); };
  const relogin = () => { void logout(); setError('密码已修改，请使用新密码重新登录'); };
  const selectWorkspace = (next: Workspace) => { setWorkspace(next); setMobileNavOpen(false); };

  if (checking) return <div className="app-loading"><div className="loading-mark"><LoaderCircle className="spin" size={24} /></div><p>正在验证会话</p></div>;
  if (!session) return <LoginView onLogin={login} initialError={error} />;
  if (checking || !options) return <div className="app-loading"><div className="loading-mark"><LoaderCircle className="spin" size={24} /></div><p>{checking ? '正在验证会话' : '正在加载工作台'}</p></div>;
  const manager = session.user.role === 'manager' || session.user.role === 'super_admin';
  const items = workspaceItems(session.user.role);
  const managerPanel = workspace === 'ready' || workspace === 'archive' || workspace === 'reissue' ? workspace : workspace === 'accounts' ? 'users' : 'queue';
  return <div className={`app-shell role-theme-${session.user.role} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}><aside id="mobile-workspace-nav" className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}><div className="brand"><div className="brand-mark"><SlidersHorizontal size={18} /></div><div><strong>OPS DESK</strong><span>游戏客服工单</span></div><button type="button" className="icon-button mobile-nav-close" title="关闭导航" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={19} /></button></div><nav className="side-nav"><div className="nav-label">工作区</div>{items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={workspace === id ? 'side-link active' : 'side-link'} onClick={() => selectWorkspace(id)} aria-current={workspace === id ? 'page' : undefined}><Icon size={17} /><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="connection-dot" /><span>本地服务已连接</span></div></aside>{mobileNavOpen && <button type="button" className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}<main className="main-area"><header className="topbar"><button type="button" className="icon-button mobile-nav-toggle" title="打开导航" aria-label="打开导航" aria-controls="mobile-workspace-nav" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button><div className="mobile-brand"><div className="brand-mark"><SlidersHorizontal size={16} /></div><strong>OPS DESK</strong></div><div className="topbar-user"><span className="avatar">{session.user.displayName.slice(0, 1)}</span><span>{session.user.displayName} · {roleLabel(session.user.role)}</span><button type="button" className="icon-button logout-button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={17} /></button></div></header>{manager && workspace !== 'request' && workspace !== 'records' ? <ManagerView options={options} token={session.token} role={session.user.role} panel={managerPanel} actorId={session.user.id} onRequireRelogin={relogin} /> : <CustomerView options={options} token={session.token} role={session.user.role} section={workspace === 'records' ? 'records' : 'operations'} onNavigate={(next) => selectWorkspace(next === 'records' ? 'records' : 'request')} />}</main></div>;
}

function LoginView({ onLogin, initialError }: { onLogin: (username: string, password: string) => Promise<void>; initialError?: string }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(initialError ?? ''); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (!username.trim() || !password) return setError('请输入账号和密码'); setLoading(true); try { await onLogin(username.trim(), password); } catch (err) { setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试'); } finally { setLoading(false); } };
  return <main className="login-shell"><div className="login-aside"><div className="brand"><div className="brand-mark"><SlidersHorizontal size={20} /></div><div><strong>OPS DESK</strong><span>游戏客服工单</span></div></div><div className="login-aside-copy"><h1>管理后台</h1><p>统一处理申请、审核与账号权限。</p></div><div className="login-aside-foot">受控访问 · 三层权限</div></div><section className="login-panel"><div className="login-icon"><ShieldCheck size={24} /></div><p className="eyebrow">安全登录</p><h2>欢迎回来</h2><p className="login-subtitle">使用管理员分配的账号继续工作</p><form onSubmit={submit}><label><span>登录账号</span><div className="input-with-icon"><UserRound size={17} /><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入账号" /></div></label><label><span>密码</span><div className="input-with-icon"><KeyRound size={17} /><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" /></div></label><button className="primary-button login-button" disabled={loading} type="submit">{loading ? '登录中…' : '登录工作台'}<LogIn size={17} /></button></form><p className="login-note">不支持注册，请联系管理员。</p>{error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} />}</section></main>;
}
