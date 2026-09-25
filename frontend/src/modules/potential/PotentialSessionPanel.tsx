import { useEffect, useState } from 'react';
import { Activity, LoaderCircle, LogIn, LogOut, Server } from 'lucide-react';
import type { AutoCredentialType, AutoServer, AutoSession } from '../../types';
import { PotentialLoginDialog } from './PotentialLoginDialog';

export interface PotentialSessionProps {
  servers: AutoServer[];
  session: AutoSession | null;
  account: string;
  restoring: boolean;
  loading: boolean;
  busy: string;
  onLogin: (serverId: string, account: string, password: string, type: AutoCredentialType) => Promise<boolean>;
  onEnter: (characterId: string) => void;
  onLogout: () => void;
}

export function PotentialSessionPanel(props: PotentialSessionProps) {
  const { servers, session, busy, restoring, loading } = props;
  const [loginOpen, setLoginOpen] = useState(false);
  const disabled = Boolean(busy) || loading;
  const canEnter = session && ['logged_in', 'character_selected'].includes(session.state);
  useEffect(() => { if (session?.state === 'ready') setLoginOpen(false); }, [session?.state]);
  const stateLabel = session?.state === 'ready' ? '已进入游戏' : session?.state === 'reconnecting'
    ? '正在自动重连' : session?.state === 'failed' ? '连接异常' : '等待选择角色';

  return <section className="potential-session-panel panel-surface" aria-label="游戏账号会话">
    <div className="potential-panel-title"><span className="potential-section-icon"><Server size={19} /></span>
      <div><h2>{session ? '当前游戏账号' : restoring ? '恢复已有会话' : '游戏账号'}</h2>
        <p>{session ? '后台心跳保活，刷新页面后可继续操作。' : '使用独立游戏账号读取和修改装备潜能。'}</p></div>
      {session && <span className={`potential-session-state state-${session.state}`}><Activity size={14} />{stateLabel}</span>}
    </div>
    {restoring && !session ? <p className="potential-restoring"><LoaderCircle className="spin" size={18} />
      正在连接已有会话；请求失败时会保留会话，不会重新登录。</p>
      : session ? <div className="potential-session-content">
        <div className="potential-account-summary">
          <strong>{props.account || '游戏账号'}</strong>
          <span>{servers.find((server) => server.id === session.server_id)?.name ?? session.server_id}</span>
          <span>{session.roles.find((role) => role.id === session.character_id)?.name ?? session.character_id ?? '尚未选择角色'}</span>
        </div>
        {canEnter && <button type="button" className="primary-button" disabled={disabled} onClick={() => setLoginOpen(true)}>
          <LogIn size={15} />继续进入游戏</button>}
        <button type="button" className="secondary-button potential-logout" disabled={disabled} onClick={props.onLogout}>
          <LogOut size={15} />退出游戏账号</button>
      </div> : <button type="button" className="primary-button" disabled={disabled} onClick={() => setLoginOpen(true)}>
        {loading ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}登录账号</button>}
    {loginOpen && <PotentialLoginDialog {...props} onClose={() => setLoginOpen(false)} />}
  </section>;
}
