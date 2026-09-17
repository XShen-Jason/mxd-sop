import { AlertCircle, Clock3, MessageSquare, Send, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AutoMessageResult } from '../../types';
import { accountCharacterLabel, accountStatusLabel, serverMessageTypes, type ConfiguredServer, type ServerAccount, type ServerMessageType } from './types';

type SentMessage = { message: string; type: ServerMessageType; response: AutoMessageResult };
type CommandKind = 'drop' | 'cashid' | 'herwarp' | 'ban' | 'message';

const commandLabels: Record<CommandKind, string> = {
  drop: 'DROP · 物品发放',
  cashid: 'CASHID · 点券发放',
  herwarp: 'HERWARP · 传送',
  ban: 'BAN · 封禁',
  message: '普通消息',
};

export function ServerMessagePanel({ server, statusFresh, onSend }: { server: ConfiguredServer; statusFresh: boolean; onSend: (server: ConfiguredServer, account: ServerAccount, type: ServerMessageType, message: string) => Promise<AutoMessageResult | undefined> }) {
  const accounts = server.accounts;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [messageType, setMessageType] = useState<ServerMessageType>('privateChat');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SentMessage | null>(null);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;

  useEffect(() => {
    if (!accounts.some((account) => account.id === accountId)) setAccountId(accounts[0]?.id ?? '');
  }, [accountId, accounts]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accounts.length) return setError('请先添加一个账号');
    if (!statusFresh) return setError('mxd-auto 状态同步中断，请等待同步完成后再发送');
    if (!selectedAccount) return setError('请选择发送消息的账号');
    if (!selectedAccount.enabled || selectedAccount.status !== 'online') return setError('当前账号未在线，请先启动或等待连接完成');
    const value = message.trim();
    if (!value) return setError('请输入消息内容');
    setError('');
    setSending(true);
    try {
      const response = await onSend(server, selectedAccount, messageType, value);
      if (!response) return setError('消息发送失败，请重试');
      setLastResult({ message: value, type: messageType, response });
      setMessage('');
    } catch {
      setError('消息发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  return <section className="server-message-panel" aria-labelledby="server-message-title">
    <div className="server-section-heading message-section-heading"><div><h3 id="server-message-title"><MessageSquare size={17} />发送消息</h3><span>仅发送给当前已开启的账号</span></div></div>
    <form className="server-message-form" onSubmit={submit}>
      <div className="message-account-row">
        {accounts.length > 1 ? <label className="message-account-field"><span>选择账号</span><div className="message-select-wrap"><UserRound size={15} /><select value={accountId} disabled={!statusFresh || sending} onChange={(event) => { setAccountId(event.target.value); setError(''); }}>{accounts.map((account) => { const status = statusFresh ? account.status : 'unknown'; return <option value={account.id} key={account.id} disabled={!statusFresh || !account.enabled || status !== 'online'}>{account.username} · {accountCharacterLabel(account)}{status === 'online' ? '' : `（${accountStatusLabel(status)}）`}</option>; })}</select></div></label> : <div className="message-account-field"><span>发送账号</span><div className="message-fixed-target"><strong>{selectedAccount ? `${selectedAccount.username} · ${accountCharacterLabel(selectedAccount)}${!statusFresh || selectedAccount.status !== 'online' ? `（${accountStatusLabel(statusFresh ? selectedAccount.status : 'unknown')}）` : ''}` : '暂无账号'}</strong></div></div>}
        <MessageLatencyMetrics result={lastResult?.response} />
      </div>
      <fieldset className="message-type-field" disabled={sending}><legend>消息类型</legend><div className="message-type-options" role="radiogroup" aria-label="消息类型">{serverMessageTypes.map((item) => <button type="button" key={item.id} className={messageType === item.id ? 'message-type-option selected' : 'message-type-option'} role="radio" aria-checked={messageType === item.id} onClick={() => { setMessageType(item.id); setError(''); }}>{item.label}</button>)}</div></fieldset>
      <label className="message-content-field"><span>消息内容</span><div className="message-textarea-wrap"><textarea maxLength={500} value={message} disabled={sending} placeholder="输入消息内容" onChange={(event) => { setMessage(event.target.value); setError(''); }} /><small>{message.length}/500</small></div></label>
      {error && <p className="setup-error message-form-error" role="alert"><AlertCircle size={14} />{error}</p>}
      <div className="server-message-actions"><span>{statusFresh ? (messageType === 'privateChat' ? '默认类型：私聊' : `当前类型：${messageTypeLabel(messageType)}`) : '等待 mxd-auto 状态同步'}</span><button type="submit" className="primary-button" disabled={sending || !statusFresh || !selectedAccount || !selectedAccount.enabled || selectedAccount.status !== 'online'}>{sending ? <Clock3 className="spin" size={16} /> : <Send size={16} />}{sending ? '发送中…' : '发送'}</button></div>
    </form>
    {lastResult && <MessageResultPanel sent={lastResult} />}
  </section>;
}

function MessageResultPanel({ sent }: { sent: SentMessage }) {
  const result = sent.response.result;
  const command = classifyMessageCommand(sent.message);
  const delivery = deliveryKind(result.game_server_status ?? result.delivery_status);
  const rawResponse = result.server_response?.trim() || '暂无服务器原始返回';
  return <section className={`message-result-panel delivery-${delivery}`} aria-labelledby="server-message-result-title" aria-live="polite">
    <div className="message-result-heading"><h4 id="server-message-result-title">服务器返回</h4></div>
    <div className="message-result-grid">
      <ResultField label="指令分析"><span className={`message-command-label command-${command}`}>{commandLabels[command]}</span></ResultField>
      <ResultField label="消息类型"><span className="message-result-value-text">{messageTypeLabel(sent.type)}</span></ResultField>
      <div className="message-result-card message-result-status-card"><div className="message-result-status-row"><span className="message-result-label">状态</span><span className={`message-delivery-badge delivery-${delivery}`}>{deliveryLabel(delivery)}</span></div></div>
      <ResultField label="消息内容" className="message-result-message-card"><code className="message-result-code">{sent.message}</code></ResultField>
      <div className="message-result-card message-result-raw-card"><span className="message-result-label">服务器原始返回</span><pre className="message-result-raw-content">{rawResponse}</pre></div>
      <div className="message-result-card message-result-card-wide"><span className="message-result-label">完整内容</span><pre className="message-result-full-content">{JSON.stringify(sent.response, null, 2)}</pre></div>
    </div>
  </section>;
}

function MessageLatencyMetrics({ result }: { result?: AutoMessageResult }) {
  return <div className="message-latency-metrics" role="group" aria-label="消息延迟">
    <ResponseMetric label="auto-process 服务响应" latency={result?.auto_process?.latency_ms} status={result?.auto_process?.status} />
    <ResponseMetric label="游戏服务器响应" latency={result?.result.game_server_response_latency_ms} status={result?.result.game_server_status ?? result?.result.delivery_status} />
  </div>;
}

function ResultField({ label, wide = false, className = '', children }: { label: string; wide?: boolean; className?: string; children: ReactNode }) {
  return <div className={`message-result-card ${wide ? 'message-result-card-wide' : ''} ${className}`.trim()}><span className="message-result-label">{label}</span><div className="message-result-value">{children}</div></div>;
}

function ResponseMetric({ label, latency, status }: { label: string; latency?: number; status?: string }) {
  const value = deliveryKind(status);
  return <div className="message-latency-field"><span className="message-result-label">{label}</span><div className="message-result-card message-result-metric"><div className="message-result-metric-value"><strong>{formatLatency(latency)}</strong>{status !== undefined && <span className={`message-service-status delivery-${value}`}>{deliveryLabel(value)}</span>}</div></div></div>;
}

function classifyMessageCommand(message: string): CommandKind {
  const prefix = message.trim().toLowerCase().split('@', 1)[0];
  return prefix === 'drop' || prefix === 'cashid' || prefix === 'herwarp' || prefix === 'ban' ? prefix : 'message';
}

function deliveryKind(status: string | undefined): 'success' | 'failure' | 'unknown' {
  return status === 'success' || status === 'failure' ? status : 'unknown';
}

function deliveryLabel(status: string) {
  return status === 'success' ? '成功' : status === 'failure' ? '失败' : '未知';
}

function messageTypeLabel(type: ServerMessageType) {
  return serverMessageTypes.find((item) => item.id === type)?.label ?? '私聊';
}

function formatLatency(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ms` : '—';
}
