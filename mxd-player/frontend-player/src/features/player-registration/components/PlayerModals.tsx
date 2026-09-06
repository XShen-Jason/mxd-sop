import { Check, Shield, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { PlayerSelect } from './PlayerSelect';
import type { CreatePrompt, Modal } from './player-types';

type CreateConfirmProps = {
  prompt: CreatePrompt;
  targetDay: string;
  lockTime: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function CreateConfirmModal({ prompt, targetDay, lockTime, busy, onClose, onConfirm }: CreateConfirmProps) {
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  return (
    <ModalShell title={`确认创建${targetDay}${prompt.boss}队伍`} kicker="CREATE TEAM" close={onClose} onBackdrop={closeOnBackdrop}>
      <div className="raid-confirm">
        <span className={`boss-dot ${prompt.bossType}`} />
        副本：<b>{prompt.boss}</b>
        <small>角色 ID {prompt.character}</small>
      </div>
      <p className="modal-copy">确认使用角色 ID <b>{prompt.character}</b> 成为本队队长吗？</p>
      <div className="warning"><Shield size={16} />{lockTime}锁定队伍；{targetDay}开战并共同参与击杀副本 Boss，完成结算。锁定前成员可以自行退出。</div>
      <button className="primary" disabled={busy} onClick={onConfirm}>确认创建队伍</button>
      <button className="secondary modal-cancel" onClick={onClose}>返回修改</button>
    </ModalShell>
  );
}

type ConfirmModalProps = {
  modal: Exclude<Modal, null>;
  targetDay: string;
  accountName: string;
  characters: string[];
  character: string;
  setCharacter: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onJoin: () => void;
  onApprove: () => void;
  onApproveMerge: () => void;
};

export function ConfirmModal(props: ConfirmModalProps) {
  const options = props.characters.map((value) => ({ value, label: `角色 ID ${value} · ${props.accountName}` }));
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) props.onClose();
  };
  if (props.modal.kind === 'join') {
    return (
      <ModalShell title={`确认申请加入${props.targetDay}${props.modal.boss}队伍`} kicker="FINAL STEP" close={props.onClose} onBackdrop={closeOnBackdrop}>
        <div className="raid-confirm">
          <span className={`boss-dot ${props.modal.boss === '黑龙' ? 'black-dragon' : 'zakum'}`} />
          副本：<b>{props.modal.boss}</b>
          <small>{props.targetDay} · 邀请码 {props.modal.invite}</small>
        </div>
        <p className="modal-copy">请选择真正参与击杀的角色 ID（账号：{props.accountName}）：</p>
        {props.characters.length === 1 ? <div className="character-fixed modal-character">角色 ID {props.characters[0]} · {props.accountName} <Check size={14} /></div> : <PlayerSelect value={props.character} options={options} onChange={props.setCharacter} placeholder="选择参与角色" aria-label="参与角色" disabled={props.busy} />}
        <div className="warning"><Shield size={16} />队伍将在{props.targetDay} 0 点（北京时间）锁定，锁定前可以自行退出；一个角色只能领取一次奖励，角色 ID 错误将无法获得奖励。</div>
        <button className="primary" disabled={!props.character || props.busy} onClick={props.onJoin}>确认申请</button>
        <button className="secondary modal-cancel" onClick={props.onClose}>返回</button>
      </ModalShell>
    );
  }
  if (props.modal.kind === 'approve') {
    return (
      <ModalShell title={`同意${props.targetDay}角色ID:${props.modal.request.characterId}入队`} kicker="LEADER APPROVAL" close={props.onClose} onBackdrop={closeOnBackdrop}>
        <p className="modal-copy">申请角色：<b>{props.modal.request.characterId}</b>。同意后将正式入队。</p>
        <div className="warning"><Shield size={16} />同意入队后队长不能移除成员，成员可在{props.targetDay} 0 点锁定前自行退出，请确认玩家与角色确实参与本次击杀。</div>
        <button className="primary" disabled={props.busy} onClick={props.onApprove}>确认同意入队</button>
        <button className="secondary modal-cancel" onClick={props.onClose}>返回</button>
      </ModalShell>
    );
  }
  return (
    <ModalShell title={`确认合并${props.targetDay}${props.modal.boss}队伍`} kicker="LEADER APPROVAL" close={props.onClose} onBackdrop={closeOnBackdrop}>
      <p className="modal-copy">对方会将整队成员一次性加入你的队伍，共 <b>{props.modal.request.memberCount} 人</b>。</p>
      <div className="warning"><Shield size={16} />合并后原队伍将锁定并失效，所有成员进入当前队伍；请确认总人数不超过 10 人。</div>
      <button className="primary" disabled={props.busy} onClick={props.onApproveMerge}>确认合并队伍</button>
      <button className="secondary modal-cancel" onClick={props.onClose}>返回</button>
    </ModalShell>
  );
}

function ModalShell({ title, kicker, close, onBackdrop, children }: { title: string; kicker: string; close: () => void; onBackdrop: (event: MouseEvent<HTMLDivElement>) => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onBackdrop}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" onClick={close} aria-label="关闭"><X size={18} /></button>
        <p className="kicker">{kicker}</p>
        <h2 id="confirm-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}
