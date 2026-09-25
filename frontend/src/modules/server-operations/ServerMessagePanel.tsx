import { AlertCircle, Clock3, MessageSquare, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AutoMessageResult } from '../../types';
import { MessageLatencyMetrics, MessageResultPanel } from './MessageResultPanel';
import { QuickCommandPanel } from './QuickCommandPanel';
import { SendConfirmationDialog } from './SendConfirmationDialog';
import { accountCharacterLabel, accountStatusLabel, serverMessageTypes, type ConfiguredServer, type ServerAccount, type ServerMessageType } from './types';

type SentMessage = { message: string; type: ServerMessageType; response: AutoMessageResult };
type SendRequest = { server: ConfiguredServer; account: ServerAccount; message: string; type: ServerMessageType; clearMessage: boolean };

export function ServerMessagePanel({ server, statusFresh, onSend }: {
  server: ConfiguredServer;
  statusFresh: boolean;
  onSend: (server: ConfiguredServer, account: ServerAccount, type: ServerMessageType, message: string) => Promise<AutoMessageResult | undefined>;
}) {
  const accounts = server.accounts;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [messageType, setMessageType] = useState<ServerMessageType>('privateChat');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SentMessage | null>(null);
  const [confirmation, setConfirmation] = useState<SendRequest | null>(null);
  const inFlight = useRef(false);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const disabled = sending || !statusFresh || !server.enabled || !selectedAccount?.enabled || selectedAccount.status !== 'online';
  useEffect(() => {
    if (!accounts.some((account) => account.id === accountId)) setAccountId(accounts[0]?.id ?? '');
  }, [accountId, accounts]);

  const requestSend = (value: string, type: ServerMessageType, clearMessage = false) => {
    if (inFlight.current || confirmation || disabled || !selectedAccount) return;
    setError('');
    setConfirmation({ server, account: selectedAccount, message: value, type, clearMessage });
  };
  const confirmSend = async () => {
    if (!confirmation || inFlight.current) return;
    const target = accounts.find((account) => account.id === confirmation.account.id);
    if (!statusFresh || !server.enabled || server.id !== confirmation.server.id || server.address !== confirmation.server.address || !target?.enabled || target.status !== 'online' || target.username !== confirmation.account.username || target.character_id !== confirmation.account.character_id) {
      setConfirmation(null); setError('目标服务器或账号状态已变化，请重新确认后发送'); return;
    }
    inFlight.current = true;
    setError('');
    setSending(true);
    try {
      const response = await onSend(server, target, confirmation.type, confirmation.message);
      if (!response) { setError('发送失败，请重试'); return; }
      setLastResult({ message: confirmation.message, type: confirmation.type, response });
      if (confirmation.clearMessage) setMessage((current) => current.trim() === confirmation.message ? '' : current);
    } catch {
      setError('发送失败，请重试');
    } finally {
      inFlight.current = false;
      setSending(false);
      setConfirmation(null);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) { setError('请输入消息内容'); return; }
    requestSend(message.trim(), messageType, true);
  };

  return <section className="server-message-panel" aria-labelledby="server-message-title">
    <div className="server-section-heading message-section-heading"><div>
      <h3 id="server-message-title"><MessageSquare size={17} /> GM 消息与快捷指令</h3>
      <span>快捷指令使用私聊发送；经验时长按分钟计算，生效情况以游戏服务器返回为准。</span>
    </div></div>
    <div className="message-account-row">
      <label className="message-account-field"><span>发送账号</span><div className="message-select-wrap">
        <UserRound size={15} /><select value={accountId} disabled={!statusFresh || sending} onChange={(event) => setAccountId(event.target.value)}>
          {accounts.length ? accounts.map((account) => <option value={account.id} key={account.id} disabled={!account.enabled || account.status !== 'online'}>
            {account.username} · {accountCharacterLabel(account)}（{accountStatusLabel(statusFresh ? account.status : 'unknown')}）
          </option>) : <option value="">暂无账号</option>}
        </select>
      </div></label>
      <MessageLatencyMetrics result={lastResult?.response} />
    </div>
    <QuickCommandPanel server={server} sending={sending} disabled={disabled} onSend={(value) => requestSend(value, 'privateChat')} />
    <form className="server-message-form" onSubmit={submit}>
      <fieldset className="message-type-field" disabled={sending}><legend>消息类型</legend>
        <div className="message-type-options" role="radiogroup" aria-label="消息类型">
          {serverMessageTypes.map((item) => <button type="button" key={item.id} className={messageType === item.id ? 'message-type-option selected' : 'message-type-option'} role="radio" aria-checked={messageType === item.id} onClick={() => setMessageType(item.id)}>{item.label}</button>)}
        </div>
      </fieldset>
      <label className="message-content-field"><span>消息内容</span><div className="message-textarea-wrap">
        <textarea maxLength={512} value={message} disabled={sending} placeholder="输入自定义 GM 消息" onChange={(event) => setMessage(event.target.value)} /><small>{message.length}/512</small>
      </div></label>
      <div className="server-message-actions">
        <span>{lastResult ? `游戏服务器响应：${lastResult.response.result.game_server_status ?? lastResult.response.result.delivery_status}` : '发送后显示服务器原始返回内容'}</span>
        <button type="submit" className="primary-button" disabled={disabled}>{sending ? <Clock3 className="spin" size={16} /> : <Send size={16} />}{sending ? '发送中…' : '发送消息'}</button>
      </div>
    </form>
    {error && <p className="setup-error message-form-error" role="alert"><AlertCircle size={14} />{error}</p>}
    {lastResult && <MessageResultPanel sent={lastResult} />}
    {confirmation && <SendConfirmationDialog serverName={confirmation.server.name} serverAddress={confirmation.server.address}
      username={confirmation.account.username} character={accountCharacterLabel(confirmation.account)}
      channel={serverMessageTypes.find((item) => item.id === confirmation.type)?.label ?? confirmation.type} message={confirmation.message}
      busy={sending} onCancel={() => { if (!inFlight.current) setConfirmation(null); }} onConfirm={() => void confirmSend()} />}
  </section>;
}
