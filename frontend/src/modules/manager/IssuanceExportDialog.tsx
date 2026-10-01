import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect } from 'react';

export function IssuanceExportDialog({ includeRelated, busy, onIncludeRelatedChange, onCancel, onConfirm }: {
  includeRelated: boolean;
  busy: boolean;
  onIncludeRelatedChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (busy) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);
  return <div className="dialog-backdrop" role="presentation"><div className="action-dialog issuance-export-dialog" role="dialog" aria-modal="true" aria-labelledby="issuance-export-title">
    <div className="dialog-header"><div className="dialog-icon"><AlertTriangle size={19} /></div><button type="button" className="icon-button" aria-label="关闭" onClick={onCancel} disabled={busy}><X size={18} /></button></div>
    <h2 id="issuance-export-title">导出物资发放记录</h2>
    <p className="dialog-description">将按当前搜索、服务器和状态筛选导出全部结果。</p>
    <label className="issuance-export-option"><input type="checkbox" checked={includeRelated} onChange={(event) => onIncludeRelatedChange(event.target.checked)} disabled={busy} /><span><strong>包含关联物品</strong><small>同时导出相同服务器、相同角色 ID 的其他物资记录</small></span></label>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button><button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? '导出中…' : '确认导出'}<Check size={16} /></button></div>
  </div></div>;
}
