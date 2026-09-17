import { Check, CircleCheck, Gamepad2, KeyRound, LoaderCircle, Pencil, UserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AppOptions, AutoRole, AutoSession } from '../../types';
import { defaultGameProtocolVersion, normalizeGameHost, normalizeGamePort, type AccountSetupValue, type ConfiguredServer, type ServerAccount, type ServerFormValue } from './types';

export function ServerConfigDialog({ options, server, configuredIds, onCancel, onSave }: { options: AppOptions; server: ConfiguredServer | null; configuredIds: string[]; onCancel: () => void; onSave: (value: ServerFormValue) => void }) {
  const availableServers = options.servers.filter((item) => item.id === server?.id || !configuredIds.includes(item.id));
  const initial = server ? splitAddress(server.address) : { host: '127.0.0.1', port: '12660' };
  const initialServerId = server?.id ?? availableServers[0]?.id ?? '';
  const [form, setForm] = useState<ServerFormValue>({ catalogId: initialServerId, host: initial.host, port: initial.port, version: server?.version ?? defaultGameProtocolVersion(initialServerId) });
  const [formError, setFormError] = useState('');
  useDialogEscape(onCancel);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const host = normalizeGameHost(form.host);
    const port = normalizeGamePort(form.port);
    if (!host) return setFormError('请输入有效的游戏服务器 IP 地址');
    if (!port) return setFormError('请输入 1 到 65535 之间的端口');
    if (!form.catalogId) return setFormError('请选择游戏服务器');
    if (!form.version.trim()) return setFormError('请输入协议版本');
    setFormError('');
    onSave({ catalogId: form.catalogId, host, port: String(port), version: form.version.trim() });
  };

  return <div className="server-dialog-backdrop" role="presentation"><div className="server-dialog" role="dialog" aria-modal="true" aria-labelledby="server-dialog-title"><div className="server-dialog-header"><div><h2 id="server-dialog-title">{server ? '修改游戏服务器' : '添加游戏服务器'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onCancel}><X size={18} /></button></div><form className="server-dialog-form" onSubmit={submit}><label><span>服务器标识</span><select required value={form.catalogId} onChange={(event) => setForm({ ...form, catalogId: event.target.value, version: defaultGameProtocolVersion(event.target.value) })} disabled={Boolean(server)}><option value="" disabled>选择服务器</option>{availableServers.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}{server && !availableServers.some((item) => item.id === server.id) && <option value={server.id}>{server.name}</option>}</select></label><div className="server-form-grid tcp-address-grid"><label className="server-endpoint-field"><span>游戏服务器 IP</span><input required type="text" inputMode="url" value={form.host} placeholder="127.0.0.1" onChange={(event) => { setForm({ ...form, host: event.target.value }); setFormError(''); }} /><small>auto 将通过 TCP 连接此地址</small></label><label className="server-endpoint-field"><span>端口</span><input required type="number" inputMode="numeric" min="1" max="65535" value={form.port} placeholder="12660" onChange={(event) => { setForm({ ...form, port: event.target.value }); setFormError(''); }} /><small>游戏服务端口</small></label></div><label><span>协议版本</span><input required value={form.version} placeholder="1.0.2" onChange={(event) => { setForm({ ...form, version: event.target.value }); setFormError(''); }} /><small>每台服务器单独保存；默认 1.0.2</small></label>{formError && <p className="setup-error" role="alert">{formError}</p>}<div className="server-dialog-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="submit" className="primary-button"><Check size={16} />保存配置</button></div></form></div></div>;
}

export function AccountSetupDialog({ server, account, onCancel, onResetLogin, onLogin, onEnterGame, onComplete }: { server: ConfiguredServer; account?: ServerAccount | null; onCancel: (sessionId?: string) => void; onResetLogin: (sessionId: string) => Promise<void>; onLogin?: (username: string, password: string) => Promise<AutoSession>; onEnterGame?: (sessionId: string, characterId: string) => Promise<AutoSession>; onComplete: (value: AccountSetupValue) => Promise<boolean> | boolean }) {
  const editing = Boolean(account);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [characterId, setCharacterId] = useState(account?.character_id ?? '');
  const [characterName, setCharacterName] = useState(account?.character_name ?? '');
  const [roles, setRoles] = useState<AutoRole[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  useDialogEscape(() => { if (!actionLoading) onCancel(sessionId || undefined); });

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || (!editing && !password)) return setError(editing ? '请输入账号名称' : '请输入账号名称和密码');
    setError('');
    if (editing) return setStep(2);
    if (!onLogin) return setError('登录服务未配置');
    setActionLoading(true);
    try {
      const result = await onLogin(username.trim(), password);
      if (!result.id) throw new Error('登录服务没有返回会话');
      setSessionId(result.id);
      if (!result.roles.length) {
        try {
          await onResetLogin(result.id);
          setSessionId('');
        } catch {
          // Keep the session id so cancelling the dialog can retry cleanup.
        }
        throw new Error('登录成功，但服务器没有返回可用角色');
      }
      setRoles(result.roles);
      setCharacterId(result.roles[0].id);
      setCharacterName(result.roles[0].name ?? '');
      setStep(2);
    } catch (reason) {
      setError(setupError(reason, '登录失败，请检查账号、密码和服务器连接'));
    } finally {
      setActionLoading(false);
    }
  };

  const backToCredentials = async () => {
    if (editing || !sessionId) return setStep(1);
    setActionLoading(true);
    setError('');
    try {
      await onResetLogin(sessionId);
      setSessionId('');
      setRoles([]);
      setCharacterId('');
      setCharacterName('');
      setStep(1);
    } catch (reason) {
      setError(setupError(reason, '无法结束当前登录会话，请重试'));
    } finally {
      setActionLoading(false);
    }
  };

  const enterGame = async () => {
    if (editing) {
      if (!characterId.trim()) return setError('请输入角色 ID');
      setError('');
      return setStep(3);
    }
    if (!sessionId || !characterId.trim()) return setError('请选择角色');
    if (!onEnterGame) return setError('进入游戏服务未配置');
    setActionLoading(true);
    setError('');
    try {
      const result = await onEnterGame(sessionId, characterId.trim());
      if (result.state !== 'ready') throw new Error('服务器尚未完成进入游戏');
      setStep(3);
    } catch (reason) {
      setError(setupError(reason, '进入游戏失败，请重试'));
    } finally {
      setActionLoading(false);
    }
  };

  const complete = async () => {
    setActionLoading(true);
    setError('');
    try {
      const saved = await onComplete({ username: username.trim(), password, characterId: characterId.trim(), characterName: characterName.trim(), enabled: account?.enabled ?? true, ...(sessionId ? { sessionId } : {}) });
      if (!saved) setError('账号保存失败，请重试');
    } catch (reason) {
      setError(setupError(reason, '账号保存失败，请重试'));
    } finally {
      setActionLoading(false);
    }
  };

  return <div className="server-dialog-backdrop" role="presentation"><div className="server-dialog account-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="server-dialog-header"><div><h2 id="account-dialog-title">{editing ? '编辑账号' : '添加账号'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => onCancel(sessionId || undefined)} disabled={actionLoading}><X size={18} /></button></div><div className={`setup-steps ${editing ? '' : 'setup-steps-two'}`} aria-label="账号接入步骤"><StepMarker number="01" label="账号凭据" active={step === 1} complete={step > 1} /><StepMarker number="02" label="选择角色" active={step === 2} complete={step > 2} />{editing && <StepMarker number="03" label="保存修改" active={step === 3} complete={false} />}</div>{step === 1 && <form className="server-dialog-form" onSubmit={login}><label><span>账号名称</span><div className="setup-input"><UserRound size={16} /><input autoFocus required value={username} placeholder="输入游戏账号" onChange={(event) => { setUsername(event.target.value); setError(''); }} /></div></label><label><span>{editing ? '新密码（留空表示不修改）' : '密码'}</span><div className="setup-input"><KeyRound size={16} /><input required={!editing} type="password" value={password} placeholder={editing ? '可选' : '输入游戏密码'} onChange={(event) => { setPassword(event.target.value); setError(''); }} /></div></label>{error && <p className="setup-error" role="alert">{error}</p>}<div className="server-dialog-actions"><button type="button" className="secondary-button" onClick={() => onCancel(sessionId || undefined)} disabled={actionLoading}>取消</button><button type="submit" className="primary-button" disabled={actionLoading}>{actionLoading ? '登录中…' : '继续'}{actionLoading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button></div></form>}{step === 2 && <div className="account-step-panel"><div className="logged-account"><span className="account-avatar"><UserRound size={16} /></span><div><strong>{username}</strong><span>{editing ? '准备保存账号设置' : `登录成功，已获取 ${roles.length} 个角色`}</span></div></div><div className="character-heading"><span>选择角色</span><small>{editing ? '填写要绑定的角色信息' : '角色列表来自服务器登录响应'}</small></div>{editing ? <><label><span>角色 ID</span><input autoFocus required value={characterId} placeholder="例如 role-1" onChange={(event) => { setCharacterId(event.target.value); setError(''); }} /></label><label><span>角色名称（可选）</span><input value={characterName} placeholder="例如 星河" onChange={(event) => setCharacterName(event.target.value)} /></label></> : <div className="character-options" role="radiogroup" aria-label="角色列表">{roles.map((role) => <button type="button" key={role.id} className={`character-option ${characterId === role.id ? 'selected' : ''}`} role="radio" aria-checked={characterId === role.id} onClick={() => { setCharacterId(role.id); setCharacterName(role.name ?? ''); setError(''); }}><span><strong>{role.name || `角色 ${role.id}`}</strong><small>ID：{role.id}{role.map_id ? ` · 地图 ${role.map_id}` : ''}</small></span>{characterId === role.id && <Check size={17} />}</button>)}</div>}{error && <p className="setup-error" role="alert">{error}</p>}<div className="server-dialog-actions"><button type="button" className="secondary-button" onClick={() => void backToCredentials()} disabled={actionLoading}>返回</button><button type="button" className="primary-button" onClick={() => void enterGame()} disabled={actionLoading}>{actionLoading ? '处理中…' : editing ? '继续保存' : '进入游戏'}{actionLoading ? <LoaderCircle className="spin" size={16} /> : <Gamepad2 size={16} />}</button></div></div>}{step === 3 && <div className="account-complete-panel"><div className="complete-icon"><CircleCheck size={28} /></div><h3>{editing ? '确认保存账号' : '角色已进入游戏'}</h3><p>{username} · {characterName || characterId}</p><span>{editing ? '保存后 auto 会重新应用账号配置。' : '登录会话已进入游戏，保存后会继续由服务器管理。'}</span>{error && <p className="setup-error" role="alert">{error}</p>}<button type="button" className="primary-button" onClick={() => void complete()} disabled={actionLoading}>{actionLoading ? '保存中…' : editing ? '保存修改' : '保存账号并完成'}{actionLoading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button></div>}</div></div>;
}

function StepMarker({ number, label, active, complete }: { number: string; label: string; active: boolean; complete: boolean }) { return <div className={`setup-step ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}><span>{complete ? <Check size={13} /> : number}</span><small>{label}</small></div>; }
function splitAddress(address: string) { const value = address.trim(); if (value.startsWith('[')) { const end = value.indexOf(']'); return end > 0 ? { host: value.slice(1, end), port: value.slice(end + 2) } : { host: value, port: '' }; } const separator = value.lastIndexOf(':'); return separator > 0 ? { host: value.slice(0, separator), port: value.slice(separator + 1) } : { host: value, port: '' }; }
function setupError(reason: unknown, fallback: string) { return reason instanceof Error && reason.message ? reason.message : fallback; }
function useDialogEscape(onCancel: () => void) { useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [onCancel]); }
