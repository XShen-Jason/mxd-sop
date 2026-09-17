import { Check, KeyRound, LoaderCircle, UserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AccountSnapshot, AutoRole, AutoSession, ServerRecord } from '../../api/types';

export interface AccountFormValue { username: string; password: string; character_id: string; character_name: string; enabled: boolean; session_id?: string }
type Step = 'credentials' | 'role' | 'edit';

export function AccountFormDialog({ server, account, onClose, onLogin, onEnter, onSave }: { server: ServerRecord; account?: AccountSnapshot; onClose: (sessionId?: string) => void; onLogin: (serverId: string, username: string, password: string) => Promise<AutoSession>; onEnter: (sessionId: string, characterId: string) => Promise<AutoSession>; onSave: (value: AccountFormValue) => Promise<boolean> }) {
  const editing = Boolean(account);
  const [step, setStep] = useState<Step>(editing ? 'edit' : 'credentials');
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [characterId, setCharacterId] = useState(account?.character_id ?? '');
  const [characterName, setCharacterName] = useState(account?.character_name ?? '');
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [roles, setRoles] = useState<AutoRole[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(sessionId || undefined); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [busy, onClose, sessionId]);
  const close = () => { if (!busy) onClose(sessionId || undefined); };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return setError('请输入游戏账号和密码');
    setBusy(true); setError('');
    try {
      const result = await onLogin(server.id, username.trim(), password);
      setSessionId(result.id); setRoles(result.roles); setCharacterId(result.roles[0]?.id ?? ''); setCharacterName(result.roles[0]?.name ?? '');
      if (!result.roles.length) return setError('登录成功，但服务器没有返回可用角色；关闭窗口后会清理登录会话');
      setStep('role');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败，请检查账号密码'); }
    finally { setBusy(false); }
  };
  const saveEdit = async (event: FormEvent) => { event.preventDefault(); if (!characterId.trim()) return setError('请输入角色 ID'); await save({ username, password, character_id: characterId, character_name: characterName, enabled }); };
  const enterAndSave = async () => { if (!sessionId || !characterId) return setError('请选择角色'); setBusy(true); setError(''); try { await onEnter(sessionId, characterId); await save({ username, password, character_id: characterId, character_name: characterName, enabled, session_id: sessionId }); } catch (reason) { setError(reason instanceof Error ? reason.message : '角色进入游戏失败'); } finally { setBusy(false); } };
  const save = async (value: AccountFormValue) => { setBusy(true); setError(''); try { if (!await onSave(value)) setError('保存失败，请检查提示后重试'); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); } finally { setBusy(false); } };
  return <div className="management-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="management-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-form-title"><header className="management-dialog-heading"><div><p className="eyebrow">AUTO ACCOUNT</p><h2 id="account-form-title">{editing ? '编辑账号' : '添加账号'}</h2><span>{server.name} · {server.address}</span></div><button type="button" className="icon-button" aria-label="关闭" onClick={close} disabled={busy}><X size={18} /></button></header>{step === 'role' ? <RoleStep roles={roles} characterId={characterId} characterName={characterName} setCharacterId={setCharacterId} setCharacterName={setCharacterName} onSubmit={() => void enterAndSave()} onBack={() => setStep('credentials')} busy={busy} error={error} /> : <form className="management-form" onSubmit={editing ? saveEdit : login}><label><span>游戏账号</span><div className="management-input-icon"><UserRound size={16} /><input autoFocus required value={username} onChange={(event) => { setUsername(event.target.value); setError(''); }} /></div></label><label><span>{editing ? '新密码（留空表示不修改）' : '密码'}</span><div className="management-input-icon"><KeyRound size={16} /><input type="password" required={!editing} value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} /></div></label>{editing && <><label><span>角色 ID</span><input required value={characterId} onChange={(event) => setCharacterId(event.target.value)} /></label><label><span>角色名称（可选）</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} /></label><label className="management-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用账号并允许自动重连</span></label></>}{error && <p className="management-form-error" role="alert">{error}</p>}<div className="management-dialog-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{editing ? '保存修改' : '登录并选择角色'}</button></div></form>}</section></div>;
}

function RoleStep({ roles, characterId, characterName, setCharacterId, setCharacterName, onSubmit, onBack, busy, error }: { roles: AutoRole[]; characterId: string; characterName: string; setCharacterId: (value: string) => void; setCharacterName: (value: string) => void; onSubmit: () => void; onBack: () => void; busy: boolean; error: string }) {
  return <div className="management-form role-step"><div className="role-step-heading"><strong>选择角色</strong><span>角色列表来自游戏服务器登录响应</span></div><div className="management-role-list" role="radiogroup" aria-label="角色列表">{roles.map((role) => <button type="button" key={role.id} className={`management-role-option${role.id === characterId ? ' selected' : ''}`} role="radio" aria-checked={role.id === characterId} onClick={() => { setCharacterId(role.id); setCharacterName(role.name ?? ''); }}><span><strong>{role.name || `角色 ${role.id}`}</strong><small>ID：{role.id}{role.map_id ? ` · 地图 ${role.map_id}` : ''}</small></span>{role.id === characterId && <Check size={17} />}</button>)}</div><label><span>角色名称（可选）</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} /></label>{error && <p className="management-form-error" role="alert">{error}</p>}<div className="management-dialog-actions"><button type="button" className="secondary-button" onClick={onBack} disabled={busy}>返回</button><button type="button" className="primary-button" onClick={onSubmit} disabled={busy || !characterId}>{busy && <LoaderCircle size={16} className="spin" />}进入游戏并保存</button></div></div>;
}
