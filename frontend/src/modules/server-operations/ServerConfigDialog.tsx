import { Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppOptions } from '../../types';
import { defaultGameProtocolVersion, normalizeGameHost, normalizeGamePort, type ConfiguredServer, type ServerFormValue } from './types';

interface Props {
  options: AppOptions;
  server: ConfiguredServer | null;
  configuredIds: string[];
  error?: string;
  onCancel: () => void;
  onSave: (value: ServerFormValue) => Promise<boolean>;
}

export function ServerConfigDialog({ options, server, configuredIds, error, onCancel, onSave }: Props) {
  const available = options.servers.filter(item => !configuredIds.includes(item.id));
  const initial = server ? splitAddress(server.address) : { host: '127.0.0.1', port: '12660' };
  const [preset, setPreset] = useState('');
  const [form, setForm] = useState<ServerFormValue>({ catalogId: server?.id ?? '', name: server?.name ?? '', ...initial, version: server?.version ?? defaultGameProtocolVersion('') });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const cancel = () => { if (!inFlight.current) onCancel(); };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const change = (patch: Partial<ServerFormValue>) => { setForm(current => ({ ...current, ...patch })); setFormError(''); };
  const choosePreset = (id: string) => {
    setPreset(id);
    change({ catalogId: id, name: available.find(item => item.id === id)?.displayName ?? '', version: defaultGameProtocolVersion(id) });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const catalogId = form.catalogId.trim();
    const name = form.name.trim();
    const host = normalizeGameHost(form.host);
    const port = normalizeGamePort(form.port);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(catalogId)) return setFormError('标识请使用 1–64 位小写字母、数字或短横线，并以字母或数字开头');
    if (!server && configuredIds.includes(catalogId)) return setFormError('该服务器标识已配置，请换一个标识');
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) return setFormError('请输入 1–80 个字符的服务器名称');
    if (!host) return setFormError('请输入有效的游戏服务器地址');
    if (!port) return setFormError('请输入 1 到 65535 之间的端口');
    if (!form.version.trim()) return setFormError('请输入协议版本');
    inFlight.current = true;
    setSaving(true);
    setFormError('');
    try { if (!await onSave({ catalogId, name, host, port: String(port), version: form.version.trim() })) setFormError('保存失败，请检查提示后重试'); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { inFlight.current = false; setSaving(false); }
  };

  return <div className="server-dialog-backdrop" role="presentation"><div className="server-dialog" role="dialog" aria-modal="true" aria-labelledby="server-dialog-title"><div className="server-dialog-header"><h2 id="server-dialog-title">{server ? '修改游戏服务器' : '添加游戏服务器'}</h2><button type="button" className="icon-button" aria-label="关闭" disabled={saving} onClick={cancel}><X size={18} /></button></div>
    <form className="server-dialog-form" onSubmit={event => void submit(event)}>
      {!server && available.length > 0 && <label><span>已有服务器（可选）</span><select disabled={saving} value={preset} onChange={event => choosePreset(event.target.value)}><option value="">新增自定义服务器</option>{available.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
      <label><span>服务器名称</span><input autoFocus required maxLength={80} disabled={saving} value={form.name} placeholder="例如：新区" onChange={event => change({ name: event.target.value })} /><small>保存后自动出现在客服工作台的服务器选项中</small></label>
      <label><span>服务器标识</span><input required maxLength={64} disabled={Boolean(server) || saving} value={form.catalogId} placeholder="例如：new-world" onChange={event => change({ catalogId: event.target.value })} /><small>唯一标识，使用小写字母、数字或短横线；保存后不可修改</small></label>
      <div className="server-form-grid tcp-address-grid">
        <label className="server-endpoint-field"><span>游戏服务器 IP</span><input required disabled={saving} value={form.host} placeholder="127.0.0.1" onChange={event => change({ host: event.target.value })} /><small>IP 地址或域名</small></label>
        <label className="server-endpoint-field"><span>端口</span><input required disabled={saving} type="number" inputMode="numeric" min="1" max="65535" value={form.port} placeholder="12660" onChange={event => change({ port: event.target.value })} /><small>游戏服务端口</small></label>
      </div>
      <label><span>协议版本</span><input required disabled={saving} value={form.version} placeholder="1.0.2" onChange={event => change({ version: event.target.value })} /><small>按该游戏服务器实际版本填写</small></label>
      {(formError || error) && <p className="setup-error" role="alert">{error || formError}</p>}
      <div className="server-dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={cancel}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? '保存中…' : '保存配置'}</button></div>
    </form>
  </div></div>;
}

function splitAddress(address: string) {
  if (address.startsWith('[')) { const end = address.indexOf(']'); return { host: address.slice(1, end), port: address.slice(end + 2) }; }
  const separator = address.lastIndexOf(':');
  return { host: address.slice(0, separator), port: address.slice(separator + 1) };
}
