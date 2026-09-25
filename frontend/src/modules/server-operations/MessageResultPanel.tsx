import type { ReactNode } from 'react';
import type { AutoMessageResult } from '../../types';
import { serverMessageTypes, type ServerMessageType } from './types';

type SentMessage = { message: string; type: ServerMessageType; response: AutoMessageResult };
type CommandKind = 'drop' | 'cashid' | 'herwarp' | 'ban' | 'spawnrate' | 'exp' | 'droprate' | 'mesorate' | 'domaintimes' | 'message';

const commandLabels: Record<CommandKind, string> = {
  drop: 'DROP · 物品发放',
  cashid: 'CASHID · 点券发放',
  herwarp: 'HERWARP · 传送',
  ban: 'BAN · 封禁',
  spawnrate: 'SPAWNRATE · 怪物数量',
  exp: 'EXP · 经验倍率',
  droprate: 'DROPRATE · 爆率/掉落',
  mesorate: 'MESORATE · 金币倍率',
  domaintimes: 'DOMAINTIMES · 副本次数',
  message: '普通消息',
};

export function MessageResultPanel({ sent }: { sent: SentMessage }) {
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

export function MessageLatencyMetrics({ result }: { result?: AutoMessageResult }) {
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
  return Object.prototype.hasOwnProperty.call(commandLabels, prefix) ? prefix as CommandKind : 'message';
}

function deliveryKind(status: string | undefined): 'success' | 'failure' | 'unknown' {
  return status === 'success' || status === 'failure' ? status : 'unknown';
}

function deliveryLabel(status: string) {
  return status === 'success' ? '成功' : status === 'failure' ? '失败' : '未确认';
}

function messageTypeLabel(type: ServerMessageType) {
  return serverMessageTypes.find((item) => item.id === type)?.label ?? '私聊';
}

function formatLatency(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ms` : '—';
}
