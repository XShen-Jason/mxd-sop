import type { AutoMessageResult } from '../../api/types';
import './message-result.css';

export function MessageResultPanel({ response, message, channel }: { response: AutoMessageResult; message: string; channel: string }) {
  const result = response.result;
  const status = result.game_server_status ?? result.delivery_status;
  const delivery = status === 'success' || status === 'failure' ? status : 'unknown';
  const label = delivery === 'success' ? '成功' : delivery === 'failure' ? '失败' : '未确认';
  return <section className={`management-message-result result-${delivery}`} aria-label="服务器返回" aria-live="polite">
    <header><h4>服务器返回</h4><span className="management-delivery-badge">{label}</span></header>
    <div className="management-response-grid">
      <div><span>消息类型</span><b>{channel}</b></div>
      <div><span>游戏服务器响应</span><b>{typeof result.game_server_response_latency_ms === 'number' ? `${result.game_server_response_latency_ms} ms` : '—'}</b></div>
      <div className="management-response-wide"><span>消息内容</span><code>{message}</code></div>
      <div className="management-response-wide"><span>服务器原始返回</span><pre>{result.server_response?.trim() || result.message || '暂无服务器原始返回'}</pre></div>
      <div className="management-response-wide"><span>完整内容</span><pre>{JSON.stringify(response, null, 2)}</pre></div>
    </div>
  </section>;
}
