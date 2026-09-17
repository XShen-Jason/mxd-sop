import { Check, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ServerRecord } from '../../api/types';

export interface ServerFormValue { id: string; name: string; address: string; version: string; map_id: string; enabled: boolean }

export function ServerFormDialog({ server, onClose, onSave }: { server?: ServerRecord; onClose: () => void; onSave: (value: ServerFormValue) => Promise<boolean> }) {
  const [form, setForm] = useState<ServerFormValue>({ id: server?.id ?? '', name: server?.name ?? '', address: server?.address ?? '127.0.0.1:12660', version: server?.version ?? '1.0.2', map_id: server?.map_id ?? '211000000', enabled: server?.enabled ?? true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose, saving]);
  const update = (key: keyof ServerFormValue, value: string | boolean) => { setForm((current) => ({ ...current, [key]: value })); setError(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!server && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(form.id.trim())) return setError('服务器标识只能使用小写字母、数字和连字符');
    if (!form.name.trim()) return setError('请输入服务器名称');
    if (!form.address.trim() || !/^[^\s/:]+:\d{1,5}$/u.test(form.address.trim()) && !/^\[[0-9a-f:]+\]:\d{1,5}$/iu.test(form.address.trim())) return setError('请输入有效的 IP:端口地址');
    const port = Number(form.address.trim().split(':').pop()?.replace(']', ''));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setError('端口必须在 1 到 65535 之间');
    if (!form.version.trim() || !form.map_id.trim()) return setError('协议版本和地图 ID 不能为空');
    setSaving(true);
    try { if (!await onSave({ ...form, id: form.id.trim(), name: form.name.trim(), address: form.address.trim(), version: form.version.trim(), map_id: form.map_id.trim() })) setError('保存失败，请检查页面提示后重试'); }
    finally { setSaving(false); }
  };
  return <div className="management-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="management-dialog" role="dialog" aria-modal="true" aria-labelledby="server-form-title"><header className="management-dialog-heading"><div><p className="eyebrow">AUTO SERVER</p><h2 id="server-form-title">{server ? '编辑服务器' : '添加服务器'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose} disabled={saving}><X size={18} /></button></header><form className="management-form" onSubmit={submit}><label><span>服务器标识</span><input required disabled={Boolean(server) || saving} value={form.id} placeholder="例如 local" onChange={(event) => update('id', event.target.value)} /><small>只属于 auto 项目的稳定 ID</small></label><label><span>服务器名称</span><input required disabled={saving} value={form.name} placeholder="例如 本地一区" onChange={(event) => update('name', event.target.value)} /></label><label><span>游戏服务器地址</span><input required disabled={saving} value={form.address} placeholder="127.0.0.1:12660" onChange={(event) => update('address', event.target.value)} /><small>auto 会通过 TCP 连接此地址</small></label><div className="management-form-grid"><label><span>协议版本</span><input required disabled={saving} value={form.version} onChange={(event) => update('version', event.target.value)} /></label><label><span>地图 ID</span><input required disabled={saving} value={form.map_id} onChange={(event) => update('map_id', event.target.value)} /></label></div><label className="management-checkbox"><input type="checkbox" disabled={saving} checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span>启用服务器，允许账号自动连接</span></label>{error && <p className="management-form-error" role="alert">{error}</p>}<div className="management-dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : <><Check size={16} />保存配置</>}</button></div></form></section></div>;
}
