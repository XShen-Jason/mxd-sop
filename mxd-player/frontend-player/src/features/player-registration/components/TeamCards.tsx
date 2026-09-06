import { ArrowRight, Check, Clipboard, Crown, LogOut, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Team, TeamRequest } from '../api/types';
import { PlayerSelect } from './PlayerSelect';
import { BOSSES, bossName } from '../config/player-config';

type BossCardProps = {
  boss: typeof BOSSES[number];
  targetDay: string;
  lockTime: string;
  joined: boolean;
  characters: string[];
  disabled: boolean;
  onCreate: (character: string) => void;
};

export function BossCard({ boss, targetDay, lockTime, joined, characters, disabled, onCreate }: BossCardProps) {
  const [character, setCharacter] = useState(characters.length === 1 ? characters[0] : '');
  const Icon = boss.icon;
  useEffect(() => {
    if (characters.length === 1) setCharacter(characters[0]);
  }, [characters]);
  const options = characters.map((value) => ({ value, label: `角色 ID ${value}` }));
  return (
    <div className={`boss-card ${boss.color}`}>
      <div className="boss-art"><Icon size={34} /></div>
      <div className="boss-info">
        <span className="raid-label">10 PLAYERS · DAILY</span>
        <h3>{boss.name}</h3>
        <p>{lockTime}锁定，{targetDay}开战并共同击杀副本 Boss</p>
        <div className="card-action">
          {joined ? <span className="joined"><Check size={14} /> {targetDay}已入队 · {targetDay} 0 点锁定</span> : <>
            {characters.length === 1 ? <span className="character-fixed">角色 ID {characters[0]} <Check size={13} /></span> : <PlayerSelect value={character} options={options} onChange={setCharacter} placeholder="选择参与角色" aria-label={`${boss.name}角色`} disabled={disabled} />}
            <button disabled={!character || disabled} onClick={() => onCreate(character)}>创建队伍 <ArrowRight size={14} /></button>
          </>}
        </div>
      </div>
    </div>
  );
}

type JoinCardProps = {
  invite: string;
  setInvite: (value: string) => void;
  disabled: boolean;
  onJoin: () => void;
  pending: number;
};

export function JoinCard({ invite, setInvite, disabled, onJoin, pending }: JoinCardProps) {
  const updateInvite = (value: string) => setInvite(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return (
    <div className="join-card join-card-primary">
      <div className="join-icon"><Users size={22} /></div>
      <div className="join-copy">
        <span className="raid-label">PRIMARY ACTION · APPLY</span>
        <h3>申请加入队伍</h3>
        <p>{pending ? `已有 ${pending} 个申请等待队长同意` : '输入邀请码后选择角色，队长确认后正式入队'}</p>
      </div>
      <div className="join-controls">
        <input value={invite} onChange={(event) => updateInvite(event.target.value)} maxLength={6} placeholder="6 位邀请码" aria-label="6 位邀请码" />
        <button disabled={!/^[A-Z0-9]{6}$/.test(invite) || disabled} onClick={onJoin}>下一步 <ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

type TeamCardProps = {
  team: Team;
  targetDay: string;
  onCopy: () => void;
  onLeave: () => void;
  disabled: boolean;
  onApprove: (request: TeamRequest) => void;
  onReject: (request: TeamRequest) => void;
};

export function TeamCard({ team, targetDay, onCopy, onLeave, disabled, onApprove, onReject }: TeamCardProps) {
  return (
    <div className="team-card">
      <div className="team-card-head">
        <span className={`boss-dot ${team.bossType}`} />
        <strong>{bossName(team.bossType)}</strong>
        {team.leader && <span className="leader-tag"><Crown size={11} /> 队长 · 已锁定</span>}
        <span className="member-total"><Users size={13} />{team.members.length}/10</span>
      </div>
      <div className="member-list">{team.members.map((member) => <span key={member.characterId} className={member.isLeader ? 'leader' : ''}>{member.characterId}</span>)}</div>
      {team.leader && team.pendingRequests?.length ? <div className="pending-box">
        <small>待你确认的入队申请</small>
        {team.pendingRequests.map((request) => <div className="pending-row" key={request.requestId}>
          <span>角色 ID: {request.characterId}</span>
          <div className="pending-actions"><button className="approve-request" onClick={() => onApprove(request)} disabled={team.members.length >= 10 || disabled}>同意</button><button className="reject-request" onClick={() => onReject(request)} disabled={disabled}>拒绝</button></div>
        </div>)}
      </div> : null}
      <div className="invite-row"><small>{targetDay}邀请码</small><b>{team.inviteCode}</b>{!team.leader && <button className="leave-team" onClick={onLeave} disabled={disabled}><LogOut size={13} />退出队伍</button>}<button onClick={onCopy} aria-label="复制邀请码"><Clipboard size={14} /></button></div>
    </div>
  );
}
