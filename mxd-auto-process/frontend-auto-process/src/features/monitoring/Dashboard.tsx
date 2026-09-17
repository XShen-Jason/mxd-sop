import { Activity, KeyRound, LogOut, ServerCog, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { OperatorSession } from '../../api/types';
import { PasswordChangeDialog } from '../auth/PasswordChangeDialog';
import { ServerManagement } from '../management/ServerManagement';
import { RequestLogs } from './RequestLogs';
import { ServerDirectory } from './ServerDirectory';
import { useOverview, useServerLogs } from './useMonitoring';

export function Dashboard({ session, onUnauthorized, onLogout, onSessionChanged }: { session: OperatorSession; onUnauthorized: () => void; onLogout: () => Promise<void>; onSessionChanged: (session: OperatorSession) => void }) {
  const unauthorized = useCallback(onUnauthorized, [onUnauthorized]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { overview, error: overviewError } = useOverview(unauthorized);
  const { logs, error: logsError } = useServerLogs(selectedId, selectedAccountId, unauthorized);
  const selectedServer = overview?.servers.find((server) => server.id === selectedId);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);

  useEffect(() => {
    if (selectedId && overview && !overview.servers.some((server) => server.id === selectedId)) { setSelectedId(null); setSelectedAccountId(null); }
    if (selectedId && selectedAccountId && overview) {
      const server = overview.servers.find((item) => item.id === selectedId);
      if (!server?.accounts.some((account) => account.id === selectedAccountId)) setSelectedAccountId(null);
    }
  }, [overview, selectedId, selectedAccountId]);

  return <div className="console-shell">
    <header className="console-header">
      <div className="brand-lockup"><span><Activity size={19} aria-hidden="true" /></span><div><strong>MXD AUTO</strong><small>游戏自动化观测台</small></div></div>
      <div className="operator-tools"><span className="secure-indicator"><ShieldCheck size={14} aria-hidden="true" />已认证 · {session.user.username}</span><button type="button" className="header-nav-button" onClick={() => setManagementOpen((open) => !open)}><ServerCog size={16} />{managementOpen ? '返回监控' : '服务器管理'}</button><button type="button" className="icon-button" onClick={() => setPasswordDialogOpen(true)} aria-label="修改密码"><KeyRound size={17} /></button><button type="button" className="icon-button" onClick={() => void onLogout()} aria-label="退出登录"><LogOut size={17} /></button></div>
    </header>
    {(overviewError || logsError) && <div className="refresh-warning" role="status">{overviewError || logsError}</div>}
    {managementOpen ? <main className="management-main"><ServerManagement onBack={() => setManagementOpen(false)} /></main> : <main className="console-main"><ServerDirectory servers={overview?.servers ?? []} selectedId={selectedId} selectedAccountId={selectedAccountId} onSelect={(serverId, accountId) => { setSelectedId(serverId); setSelectedAccountId(accountId); }} /><RequestLogs server={selectedServer} accountId={selectedAccountId} logs={logs} loading={!overview} /></main>}
    {passwordDialogOpen && <PasswordChangeDialog session={session} onChanged={(updated) => { onSessionChanged(updated); setPasswordDialogOpen(false); }} onClose={() => setPasswordDialogOpen(false)} />}
  </div>;
}
