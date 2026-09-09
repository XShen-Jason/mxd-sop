import { Check, GitMerge, LogOut, Sparkles, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { approveTeamJoin, approveTeamMerge, createTeam, getPlayerAccount, getServers, getTeams, joinTeam, leaveTeam, mergeTeams, previewTeamJoin, rejectTeamJoin, verify, type Account, type Team, type TeamApplication } from './api/client';
import { ApplicationHistory } from './components/ApplicationHistory';
import { TeamHistory } from './components/TeamHistory';
import { CreateConfirmModal, ConfirmModal } from './components/PlayerModals';
import { Landing, Logo, SessionLoading } from './components/PlayerLanding';
import { MergeWorkspace } from './components/MergeWorkspace';
import { type CreatePrompt, type Modal } from './components/player-types';
import { BossCard, JoinCard, TeamCard } from './components/TeamCards';
import { messageForError } from './config/messages';
import { formatLockDay, formatTargetDay } from './config/day';
import { BOSSES, bossName } from './config/player-config';
import { clearSessionToken, readSessionToken, writeSessionToken } from './session';

type NoticeTone = 'success' | 'error';

export default function App() {
  const initialToken = readSessionToken();
  const [token, setToken] = useState(initialToken);
  const [account, setAccount] = useState<Account | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [applications, setApplications] = useState<TeamApplication[]>([]);
  const [history, setHistory] = useState<TeamApplication[]>([]);
  const [servers, setServers] = useState<string[]>([]);
  const [server, setServer] = useState('');
  const [qq, setQq] = useState('');
  const [gameAccount, setGameAccount] = useState('');
  const [day, setDay] = useState('');
  const [invite, setInvite] = useState('');
  const [joinCharacter, setJoinCharacter] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [createPrompt, setCreatePrompt] = useState<CreatePrompt | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingServers, setLoadingServers] = useState(true);
  const [serverAttempt, setServerAttempt] = useState(0);
  const [restoring, setRestoring] = useState(Boolean(initialToken));
  const [messageTone, setMessageTone] = useState<NoticeTone>('success');

  const showNotice = (notice: string, tone: NoticeTone = 'success') => {
    setMessageTone(tone);
    setMessage(notice);
  };
  const showError = (error: unknown) => showNotice(messageForError(error, day), 'error');
  const resetPlayerData = () => {
    setAccount(null);
    setTeams([]);
    setApplications([]);
    setHistory([]);
    setDay('');
    setModal(null);
    setCreatePrompt(null);
  };

  useEffect(() => {
    setLoadingServers(true);
    void getServers().then(setServers).catch(showError).finally(() => setLoadingServers(false));
  }, [serverAttempt]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  const refresh = async (authToken: string): Promise<string | undefined> => {
    setLoadingTeams(true);
    try {
      const result = await getTeams(authToken);
      const autoClosed = result.applications.some((item) => item.reason === 'joined-other-team' && !applications.some((previous) => previous.requestId === item.requestId && previous.reason === 'joined-other-team'));
      setTeams(result.teams);
      setApplications(result.applications);
      setHistory(result.history);
      setDay(result.day);
      return autoClosed ? '你已加入其他队伍，其他申请已自动关闭' : undefined;
    } finally {
      setLoadingTeams(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    void getPlayerAccount(token).then((result) => {
      if (!active) return;
      setAccount(result.account);
      return refresh(token);
    }).then((notice) => {
      if (active && notice) showNotice(notice);
    }).catch((error) => {
      if (!active) return;
      clearSessionToken();
      setToken('');
      resetPlayerData();
      showError(error);
    }).finally(() => {
      if (active) setRestoring(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!account && !restoring) clearSessionToken();
  }, [account, restoring]);

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      const notice = await refresh(token);
      showNotice(notice ?? success);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const verifyAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQq = qq.trim();
    const normalizedAccount = gameAccount.trim();
    if (!servers.includes(server)) return showNotice('请选择有效服务器', 'error');
    if (!/^\d{5,16}$/.test(normalizedQq)) return showNotice('QQ 请输入 5–16 位数字', 'error');
    if (!/^[\w-]{1,64}$/.test(normalizedAccount)) return showNotice('游戏账号仅支持字母、数字、下划线和短横线', 'error');
    setBusy(true);
    setMessage('');
    try {
      const result = await verify({ server, qq: normalizedQq, gameAccount: normalizedAccount });
      writeSessionToken(result.token);
      setToken(result.token);
      setAccount(result.account);
      const notice = await refresh(result.token);
      if (notice) showNotice(notice);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearSessionToken();
    setToken('');
    resetPlayerData();
  };

  if (restoring) return <SessionLoading />;
  if (!account) return <Landing servers={servers} loadingServers={loadingServers} server={server} setServer={setServer} qq={qq} setQq={setQq} gameAccount={gameAccount} setGameAccount={setGameAccount} onVerify={verifyAccount} busy={busy} message={message} onRetryServers={() => setServerAttempt((value) => value + 1)} />;

  const joined = new Set(teams.map((team) => team.bossType));
  const targetDay = day ? formatTargetDay(day) : '目标日期';
  const lockDay = day ? formatLockDay(day) : '';
  const lockTime = day ? `${lockDay}晚上 24:00（即 ${targetDay} 0:00，北京时间）` : '今晚 24:00（北京时间）';
  const pending = applications.filter((item) => item.status === 'pending').length;
  const startJoin = async () => {
    const code = invite.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return showNotice('请输入 6 位邀请码', 'error');
    setBusy(true);
    setMessage('');
    try {
      const preview = await previewTeamJoin(token, code);
      setDay(preview.day);
      setJoinCharacter(account.characters.length === 1 ? account.characters[0] : '');
      setModal({ kind: 'join', invite: code, boss: bossName(preview.bossType) });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  const confirmJoin = () => {
    if (!modal || modal.kind !== 'join' || !joinCharacter) return;
    void mutate(() => joinTeam(token, modal.invite, joinCharacter), '申请已提交，等待队长同意');
    setModal(null);
    setInvite('');
  };
  const confirmApprove = () => {
    if (!modal || modal.kind !== 'approve') return;
    void mutate(() => approveTeamJoin(token, modal.request.requestId), '已同意玩家入队');
    setModal(null);
  };
  const confirmMerge = () => {
    if (!modal || modal.kind !== 'merge') return;
    void mutate(() => approveTeamMerge(token, modal.request.requestId), '已同意合并队伍');
    setModal(null);
  };
  const requestCreate = (boss: typeof BOSSES[number], character: string) => setCreatePrompt({ bossType: boss.id, boss: boss.name, character });
  const confirmCreate = () => {
    if (!createPrompt) return;
    void mutate(() => createTeam(token, createPrompt.bossType, createPrompt.character), `${createPrompt.boss} 队伍已创建，邀请码已刷新`);
    setCreatePrompt(null);
  };

  return (
    <div className="app">
      <header className="topbar"><Logo /><div className="player-chip"><span className="online" /><span className="player-name">{account.gameAccount}</span><small>{account.server} · QQ {account.qq}</small><button onClick={logout} aria-label="退出"><LogOut size={16} /></button></div></header>
      <main className="dashboard">
        <section className="hero"><div><p className="kicker">PLAYER PARTY HUB</p><h1>组队，<span className="gradient-text">出发</span></h1><p className="hero-copy">申请加入是{targetDay}开战队伍的主流程；创建队伍作为备用入口。</p></div><div className="hero-badge"><Sparkles size={16} /> {day ? `开战日期：${targetDay}（北京时间）` : '正在同步日期'}</div></section>
        <div className="status-strip"><span><Users size={14} /> 已入队 {teams.length} 个副本</span><span><Sparkles size={14} /> 待审批申请 {pending} 个</span><span className="status-lock"><Check size={14} /> {lockTime}锁定 · 成员可退出</span></div>
        <JoinCard invite={invite} setInvite={setInvite} disabled={busy} onJoin={startJoin} pending={pending} />
        <div className="content-grid">
          <section><div className="section-heading"><div><p className="kicker">CREATE TEAM</p><h2>创建队伍</h2></div><span className="capacity">每队最多 10 人</span></div><div className="lock-notice"><Sparkles size={20} /><div><strong>锁定时间：{lockTime}</strong><p>开战时间：{targetDay}；成员共同参与击杀副本 Boss，完成结算。</p></div></div><div className="boss-grid">{BOSSES.map((boss) => <BossCard key={boss.id} boss={boss} targetDay={targetDay} lockTime={lockTime} joined={joined.has(boss.id)} characters={account.characters} disabled={busy} onCreate={(character) => requestCreate(boss, character)} />)}</div><div className="create-guidance"><GitMerge size={18} /><div><strong>不小心创建了队伍？</strong><p>点击下方“合并队伍”，输入他人邀请码；对方队长同意后，你会退出自己的队伍，成为对方队伍成员。</p></div></div></section>
          <aside><div className="section-heading"><div><p className="kicker">ACTIVE TARGET DAY</p><h2>我的{targetDay}开战队伍</h2></div><span className="team-count">{teams.length} 个</span></div><div className="team-list">{loadingTeams ? <div className="empty"><Sparkles size={20} /><p>正在加载队伍…</p></div> : teams.length ? teams.map((team) => <TeamCard key={team.inviteCode} team={team} targetDay={targetDay} disabled={busy} onLeave={() => void mutate(() => leaveTeam(token, team.inviteCode), '已退出队伍')} onCopy={() => { void navigator.clipboard?.writeText(team.inviteCode); showNotice('邀请码已复制'); }} onApprove={(request) => setModal({ kind: 'approve', request, boss: bossName(team.bossType) })} onReject={(request) => void mutate(() => rejectTeamJoin(token, request.requestId), '已拒绝入队申请')} />) : <div className="empty"><Sparkles size={20} /><p>{targetDay}还没有已入队副本</p><small>可以分别报名黑龙和进阶扎昆</small></div>}</div></aside>
        </div>
        <MergeWorkspace teams={teams} disabled={busy} onMerge={(source, target) => void mutate(() => mergeTeams(token, source, target), '合并申请已提交，等待对方队长同意')} onApprove={(request) => setModal({ kind: 'merge', request, boss: bossName(request.bossType) })} />
        <div className="history-grid">
          <ApplicationHistory items={history} loading={loadingTeams} />
          <TeamHistory token={token} />
        </div>
        {message && <div className={`toast toast-${messageTone}`} role={messageTone === 'error' ? 'alert' : 'status'} aria-live={messageTone === 'error' ? 'assertive' : 'polite'}>{message}<button onClick={() => setMessage('')} aria-label="关闭提示"><X size={16} aria-hidden="true" /></button></div>}
        {modal && <ConfirmModal modal={modal} targetDay={targetDay} accountName={account.gameAccount} characters={account.characters} character={joinCharacter} setCharacter={setJoinCharacter} busy={busy} onClose={() => setModal(null)} onJoin={confirmJoin} onApprove={confirmApprove} onApproveMerge={confirmMerge} />}
        {createPrompt && <CreateConfirmModal prompt={createPrompt} targetDay={targetDay} lockTime={lockTime} busy={busy} onClose={() => setCreatePrompt(null)} onConfirm={confirmCreate} />}
      </main>
    </div>
  );
}
