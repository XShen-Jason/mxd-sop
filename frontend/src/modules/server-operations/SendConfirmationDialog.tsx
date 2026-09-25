import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './send-confirmation.css';

type Props = {
  serverName: string;
  serverAddress: string;
  username: string;
  character: string;
  channel: string;
  message: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SendConfirmationDialog({ serverName, serverAddress, username, character, channel, message, busy, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={dialog} className="action-dialog server-send-confirmation" aria-labelledby="send-confirmation-title" aria-describedby="send-confirmation-description"
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <header className="dialog-header"><h2 id="send-confirmation-title">确认发送？</h2>
      <button type="button" className="icon-button" aria-label="关闭确认" disabled={busy} onClick={onCancel}><X size={18} aria-hidden="true" /></button>
    </header>
    <p id="send-confirmation-description">请核对目标和内容，确认后将发送至游戏服务器。</p>
    <dl>
      <div><dt>服务器</dt><dd>{serverName} · {serverAddress}</dd></div>
      <div><dt>发送账号</dt><dd>{username} · {character}</dd></div>
      <div><dt>消息类型</dt><dd>{channel}</dd></div>
    </dl>
    <strong className="server-send-content-label">发送内容</strong>
    <pre aria-label="待发送内容">{message}</pre>
    <div className="dialog-actions">
      <button ref={cancel} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? '发送中…' : '确认发送'}</button>
    </div>
  </dialog>;
}
