import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, LogIn, X } from 'lucide-react';
import type { AutoCredentialType } from '../../types';
import type { PotentialSessionProps } from './PotentialSessionPanel';

export function PotentialLoginDialog(props: PotentialSessionProps & { onClose: () => void }) {
  const { servers, session, busy, loading, onClose } = props;
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  const [serverId, setServerId] = useState(() => servers.find((server) => server.enabled)?.id ?? '');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [credentialType, setCredentialType] = useState<AutoCredentialType>('password');
  const [characterId, setCharacterId] = useState('');
  const disabled = Boolean(busy) || loading;
  useEffect(() => {
    if (session) setCharacterId(session.character_id ?? (session.roles.length === 1 ? session.roles[0].id : ''));
  }, [session?.id, session?.character_id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const fields = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])];
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (session) { props.onEnter(characterId); return; }
    if (await props.onLogin(serverId, account.trim(), password, credentialType)) setPassword('');
  };

  return <div className="dialog-backdrop" role="presentation">
    <div ref={root} className="action-dialog potential-login-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="dialog-header"><span className="dialog-icon"><LogIn size={19} /></span>
        <button type="button" className="icon-button" aria-label="关闭登录弹窗" disabled={Boolean(busy)} onClick={onClose}><X size={18} /></button></div>
      <h2 id={titleId}>{session ? '选择角色并进入游戏' : '登录游戏账号'}</h2>
      <p className="dialog-description">{session ? '账号验证成功，关闭弹窗后也可以继续选择角色。' : '选择已配置的服务器，此账号仅用于潜能修改。'}</p>
      <form className="potential-login-form" onSubmit={submit}>
        {session ? <label>选择角色<select value={characterId} disabled={disabled} required onChange={(event) => setCharacterId(event.target.value)}>
          <option value="">请选择角色</option>{session.roles.map((role) => <option key={role.id} value={role.id}>{role.name || role.id} · {role.id}</option>)}
        </select></label> : <>
          <label>服务器<select value={serverId} disabled={disabled} required onChange={(event) => setServerId(event.target.value)}>
            <option value="">选择服务器</option>{servers.map((server) => <option key={server.id} value={server.id} disabled={!server.enabled}>{server.name}{server.enabled ? '' : '（已停用）'}</option>)}
          </select></label>
          <label>游戏账号<input value={account} disabled={disabled} required autoComplete="username" onChange={(event) => setAccount(event.target.value)} placeholder="输入游戏账号" /></label>
          <label>凭据类型<select value={credentialType} disabled={disabled} onChange={(event) => setCredentialType(event.target.value as AutoCredentialType)}>
            <option value="password">密码</option><option value="md5">16 位 MD5</option>
          </select></label>
          <label>{credentialType === 'md5' ? '16 位 MD5 登录值' : '游戏密码'}<input type="password" value={password} disabled={disabled} required autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)} placeholder="输入登录凭据" /></label>
        </>}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onClose}>{session ? '稍后进入' : '取消'}</button>
          <button type="submit" className="primary-button" disabled={disabled || (session ? !characterId : !serverId || !account.trim() || !password)}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}
            {session ? busy === 'enter' ? '进入中…' : '进入游戏' : busy === 'login' ? '登录中…' : '登录账号'}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
