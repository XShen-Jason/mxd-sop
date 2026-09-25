import { Clock3, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AccountSnapshot, AutoMessageResult, ServerRecord } from '../../api/types';
import { QuickCommandPanel } from './QuickCommandPanel';
import { MessageResultPanel } from './MessageResultPanel';
import { SendConfirmationDialog } from './SendConfirmationDialog';

type SendRequest = { server: ServerRecord; account: AccountSnapshot; message: string; mode: string; clearMessage: boolean };

const modes = [{ id: 'privateChat', label: '私聊' }, { id: 'scene', label: '所有人' }, { id: 'world', label: '世界' }, { id: 'guild', label: '公会' }, { id: 'team', label: '队伍' }];

export function MessagePanel({ server, busy, onSend }: {
  server: ServerRecord;
  busy: string;
  onSend: (server: ServerRecord, account: AccountSnapshot, mode: string, message: string) => Promise<AutoMessageResult | undefined>;
}) {
  const [accountId, setAccountId] = useState(server.accounts[0]?.id ?? '');
  const [mode, setMode] = useState('privateChat');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AutoMessageResult>();
  const [lastMessage, setLastMessage] = useState('');
  const [lastMode, setLastMode] = useState('privateChat');
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<SendRequest | null>(null);
  const inFlight = useRef(false);
  const account = server.accounts.find((item) => item.id === accountId) ?? server.accounts[0];
  const sending = pending || Boolean(account && busy === `message-${account.id}`);
  const disabled = sending || Boolean(busy) || !server.enabled || !account?.enabled || account.status !== 'online';
  useEffect(() => {
    if (!server.accounts.some((item) => item.id === accountId)) setAccountId(server.accounts[0]?.id ?? '');
  }, [accountId, server.accounts]);

  const requestSend = (value: string, selectedMode: string, clearMessage = false) => {
    if (inFlight.current || confirmation || disabled || !account) return;
    setError('');
    setConfirmation({ server, account, message: value, mode: selectedMode, clearMessage });
  };
  const confirmSend = async () => {
    if (!confirmation || inFlight.current) return;
    const target = server.accounts.find((item) => item.id === confirmation.account.id);
    if (busy || !server.enabled || server.id !== confirmation.server.id || server.address !== confirmation.server.address || !target?.enabled || target.status !== 'online' || target.username !== confirmation.account.username || target.character_id !== confirmation.account.character_id) {
      setConfirmation(null); setError('目标服务器或账号状态已变化，请重新确认后发送'); return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const valueResult = await onSend(server, target, confirmation.mode, confirmation.message);
      if (!valueResult) { setError('发送失败，请重试'); return; }
      setResult(valueResult);
      setLastMessage(confirmation.message);
      setLastMode(confirmation.mode);
      if (confirmation.clearMessage) setMessage((current) => current.trim() === confirmation.message ? '' : current);
    } catch {
      setError('发送失败，请重试');
    } finally {
      inFlight.current = false;
      setPending(false);
      setConfirmation(null);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) { setError('请输入消息内容'); return; }
    requestSend(message.trim(), mode, true);
  };

  return <section className="management-message">
    <div className="management-section-heading"><div><h3>GM 消息与快捷指令</h3>
      <span>快捷指令使用私聊发送；经验时长按分钟计算，生效情况以游戏服务器返回为准。</span>
    </div></div>
    <div className="management-message-form"><label><span>发送账号</span>
      <select aria-label="发送账号" value={account?.id ?? ''} disabled={sending} onChange={(event) => setAccountId(event.target.value)}>
        {server.accounts.length ? server.accounts.map((item) => <option value={item.id} key={item.id} disabled={!item.enabled || item.status !== 'online'}>{item.username}（{statusLabel(item.status)}）</option>) : <option value="">暂无账号</option>}
      </select>
    </label></div>
    <QuickCommandPanel server={server} sending={sending} disabled={disabled} onSend={(value) => requestSend(value, 'privateChat')} />
    <form onSubmit={submit} className="management-message-form">
      <label><span>消息类型</span><select aria-label="消息类型" value={mode} disabled={sending} onChange={(event) => setMode(event.target.value)}>{modes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label><span>消息内容</span><textarea maxLength={512} value={message} disabled={sending} onChange={(event) => { setMessage(event.target.value); setError(''); }} placeholder="输入自定义 GM 消息" /><small>{message.length}/512</small></label>
      <div className="management-message-actions">
        <span>{result ? `auto ${result.auto_process?.latency_ms ?? '-'} ms · 游戏服 ${result.result.game_server_response_latency_ms ?? '-'} ms` : '发送后显示服务器原始返回内容'}</span>
        <button type="submit" className="primary-button" disabled={disabled}>{sending ? <Clock3 size={16} className="spin" /> : <Send size={16} />}{sending ? '发送中…' : '发送消息'}</button>
      </div>
    </form>
    {error && <p className="management-form-error" role="alert">{error}</p>}
    {result && <MessageResultPanel response={result} message={lastMessage} channel={modes.find((item) => item.id === lastMode)?.label ?? lastMode} />}
    {confirmation && <SendConfirmationDialog serverName={confirmation.server.name} serverAddress={confirmation.server.address}
      username={confirmation.account.username} character={`${confirmation.account.character_name || '未命名'} · ${confirmation.account.character_id}`}
      channel={modes.find((item) => item.id === confirmation.mode)?.label ?? confirmation.mode} message={confirmation.message}
      busy={sending} onCancel={() => { if (!inFlight.current) setConfirmation(null); }} onConfirm={() => void confirmSend()} />}
  </section>;
}

function statusLabel(status: AccountSnapshot['status']) {
  return { online: '在线', connecting: '连接中', reconnecting: '重连中', offline: '离线', failed: '失败', disabled: '未登录' }[status];
}
