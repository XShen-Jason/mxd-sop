import { Clock3, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AccountSnapshot, AutoMessageResult, ServerRecord } from '../../api/types';

const modes = [{ id: 'privateChat', label: '私聊' }, { id: 'scene', label: '场景' }, { id: 'world', label: '世界' }, { id: 'guild', label: '公会' }, { id: 'team', label: '队伍' }];

export function MessagePanel({ server, busy, onSend }: { server: ServerRecord; busy: string; onSend: (server: ServerRecord, account: AccountSnapshot, mode: string, message: string) => Promise<AutoMessageResult | undefined> }) {
  const [accountId, setAccountId] = useState(server.accounts[0]?.id ?? '');
  const [mode, setMode] = useState('privateChat');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AutoMessageResult>();
  const account = server.accounts.find((item) => item.id === accountId) ?? server.accounts[0];
  const sending = Boolean(account && busy === `message-${account.id}`);
  useEffect(() => { if (!server.accounts.some((item) => item.id === accountId)) setAccountId(server.accounts[0]?.id ?? ''); }, [accountId, server.accounts]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!account) return setError('请先添加账号');
    if (!account.enabled || account.status !== 'online') return setError('请选择在线账号');
    if (!message.trim()) return setError('请输入消息内容');
    setError('');
    try { const value = await onSend(server, account, mode, message.trim()); if (value) { setResult(value); setMessage(''); } } catch { setError('消息发送失败，请重试'); }
  };
  return <section className="management-message"><div className="management-section-heading"><div><h3>发送消息</h3><span>仅发送给当前在线账号，消息通过 auto 直接发送。</span></div></div><form onSubmit={submit} className="management-message-form"><div className="management-message-grid"><label><span>发送账号</span><select value={account?.id ?? ''} onChange={(event) => setAccountId(event.target.value)}>{server.accounts.length ? server.accounts.map((item) => <option value={item.id} key={item.id} disabled={!item.enabled || item.status !== 'online'}>{item.username} · {item.character_name || item.character_id}（{statusLabel(item.status)}）</option>) : <option value="">暂无账号</option>}</select></label><label><span>消息类型</span><select value={mode} onChange={(event) => setMode(event.target.value)}>{modes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div><label><span>消息内容</span><textarea maxLength={512} value={message} onChange={(event) => { setMessage(event.target.value); setError(''); }} placeholder="输入要发送的游戏消息" /><small>{message.length}/512</small></label>{error && <p className="management-form-error" role="alert">{error}</p>}<div className="management-message-actions"><span>{result ? `auto ${result.auto_process?.latency_ms ?? '—'} ms · 游戏服 ${result.result.game_server_response_latency_ms ?? '—'} ms` : '发送后显示响应延迟和状态'}</span><button type="submit" className="primary-button" disabled={sending || !account || !account.enabled || account.status !== 'online'}>{sending ? <Clock3 size={16} className="spin" /> : <Send size={16} />}{sending ? '发送中…' : '发送消息'}</button></div></form>{result && <div className={`management-message-result result-${result.result.game_server_status ?? result.result.delivery_status}`}><strong>{result.result.game_server_status === 'success' ? '服务器已确认' : result.result.game_server_status === 'failure' ? '服务器返回失败' : '已写入，等待确认'}</strong><span>{result.result.server_response || result.result.message}</span></div>}</section>;
}

function statusLabel(status: AccountSnapshot['status']) { return { online: '在线', connecting: '连接中', reconnecting: '重连中', offline: '离线', failed: '失败', disabled: '已停用' }[status]; }
