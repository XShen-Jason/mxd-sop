import { useState } from 'react';
import type { Team, TeamMergeRequest } from '../api/types';
import { bossName } from '../config/player-config';

type MergeWorkspaceProps = {
  teams: Team[];
  disabled: boolean;
  onMerge: (source: string, target: string) => void;
  onApprove: (request: TeamMergeRequest) => void;
};

export function MergeWorkspace({ teams, disabled, onMerge, onApprove }: MergeWorkspaceProps) {
  const leaders = teams.filter((team) => team.leader);
  if (!leaders.length) return null;
  return (
    <section className="merge-workspace">
      <div className="section-heading">
        <div><p className="kicker">LEADER ONLY</p><h2>合并队伍</h2></div>
        <span className="capacity">同副本 · 合计不超过 10 人</span>
      </div>
      {leaders.map((team) => <MergeTeamRow key={team.inviteCode} team={team} disabled={disabled} onMerge={onMerge} onApprove={onApprove} />)}
    </section>
  );
}

type MergeTeamRowProps = Omit<MergeWorkspaceProps, 'teams'> & { team: Team };

function MergeTeamRow({ team, disabled, onMerge, onApprove }: MergeTeamRowProps) {
  const [target, setTarget] = useState('');
  const validTarget = /^[A-Z0-9]{6}$/.test(target);
  const updateTarget = (value: string) => setTarget(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return (
    <div className="merge-row">
      <div><strong>{bossName(team.bossType)}队伍</strong><small>当前 {team.members.length}/10 人 · 你的邀请码 {team.inviteCode}</small></div>
      <div className="merge-form">
        <input value={target} onChange={(event) => updateTarget(event.target.value)} maxLength={6} placeholder="输入对方队伍邀请码" aria-label="合并目标队伍邀请码" />
        <button disabled={disabled || !validTarget} onClick={() => { onMerge(team.inviteCode, target); setTarget(''); }}>申请合并</button>
      </div>
      {team.pendingMergeRequests?.map((request) => <div className="merge-request" key={request.requestId}>
        <span>来自 {request.sourceInviteCode} 的整队申请 · {request.memberCount} 人</span>
        <button disabled={disabled || team.members.length + request.memberCount > 10} onClick={() => onApprove(request)}>查看并同意</button>
      </div>)}
    </div>
  );
}
