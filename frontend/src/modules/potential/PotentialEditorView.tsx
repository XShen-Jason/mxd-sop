import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, PackageSearch, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiClient } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { AppOptions, AutoCredentialType, AutoServer, PotentialEquipment, PotentialOption } from '../../types';
import { PotentialCard } from './PotentialCard';
import { PotentialSessionPanel } from './PotentialSessionPanel';
import { slotPayload, uniqueOptions } from './potential-options';
import { potentialError, usePotentialSession } from './usePotentialSession';
import './potential.css';

export function PotentialEditorView({ userId = 'anonymous', token }: { options: AppOptions; userId?: string; token?: string }) {
  const client = useMemo(() => new ApiClient(userId, token), [userId, token]);
  const connection = usePotentialSession(client, userId);
  const [servers, setServers] = useState<AutoServer[]>([]);
  const [pool, setPool] = useState<PotentialOption[]>([]);
  const [equipment, setEquipment] = useState<PotentialEquipment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const options = useMemo(() => uniqueOptions(pool), [pool]);
  const ready = connection.session?.state === 'ready' && !connection.connectionError;

  useEffect(() => {
    let active = true;
    Promise.all([client.autoOverview(), client.potentialPool()]).then(([overview, values]) => {
      if (active) { setServers(overview.servers); setPool(values.options); }
    }).catch((reason) => { if (active) setError(potentialError(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => { setEquipment([]); setLoaded(false); }, [connection.session?.id]);
  useEffect(() => {
    if (connection.connectionError) { setError(connection.connectionError); setNotice(''); }
  }, [connection.connectionError]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(key); setError(''); setNotice('');
    try { await action(); return true; }
    catch (reason) { setError(potentialError(reason)); return false; }
    finally { lock.current = false; setBusy(''); connection.refresh(); }
  };
  const login = (serverId: string, account: string, password: string, type: AutoCredentialType) =>
    run('login', async () => {
      const session = await client.startAutoSession(serverId, { account, password, credential_type: type });
      connection.accept(session, account);
      setNotice('账号验证成功，请选择角色并进入游戏。');
    });
  const enter = (characterId: string) => void run('enter', async () => {
    const session = await client.selectAndEnterAutoSession(connection.session!.id, characterId);
    connection.accept(session);
    setNotice('已进入游戏，后台心跳持续运行。');
  });
  const loadList = () => void run('list', async () => {
    const response = await client.getPotentialList(connection.session!.id);
    connection.accept(response.session);
    setEquipment(response.equipment);
    setLoaded(true);
    setNotice(`已获取 ${response.equipment.length} 件装备。`);
  });
  const save = (item: PotentialEquipment, values: ReturnType<typeof slotPayload>) => void run(`save-${item.instanceId}`, async () => {
    const response = await client.setPotential(connection.session!.id, item.instanceId, values);
    connection.accept(response.session);
    const result = response.result as { delivery_status?: string; server_response?: string };
    if (result.delivery_status === 'failure') throw new Error(result.server_response || '游戏服务器拒绝了修改');
    const confirmed = result.delivery_status === 'success';
    if (confirmed) {
      setEquipment((current) => current.map((entry) => entry.instanceId !== item.instanceId ? entry : {
        ...entry, potentials: values.map((value, index) => {
          const option = options.find((option) => option.statType === value.stat_type && option.value === value.value)!;
          return { slot: index + 1, statType: option.statType, statName: option.statName, value: option.value, grade: option.grade };
        }),
      }));
    }
    if (confirmed) setNotice('服务器已确认修改，已更新左侧保存基准。');
    else setError('指令已发送，结果尚未确认，请获取潜能列表核对后再操作。');
  });
  const logout = () => void run('logout', async () => {
    await connection.logout(); setConfirmLogout(false); setEquipment([]); setLoaded(false); setNotice('已退出游戏账号。');
  });
  const visible = equipment.filter((item) => `${item.name ?? ''} ${item.instanceId} ${item.templateId}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <section className="workspace potential-workspace">
    <div className="page-heading"><div><p className="eyebrow">EQUIPMENT POTENTIAL</p><h1>修改潜能</h1>
      <p className="heading-copy">左侧查看已保存潜能，右侧编辑并对比；保存后更新对照基准。</p></div>
      <span className="potential-access-badge"><ShieldCheck size={15} />专用游戏会话</span>
    </div>
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')}
      actionLabel={connection.connectionError ? '刷新状态' : undefined} onAction={connection.refresh} duration={6000} />}
    {!error && notice && <FloatingNotice kind="success" text={notice} onDismiss={() => setNotice('')} />}
    <PotentialSessionPanel servers={servers} session={connection.session} account={connection.saved?.account ?? ''}
      restoring={Boolean(connection.saved)} loading={loading || connection.checking} busy={busy}
      onLogin={login} onEnter={enter} onLogout={() => setConfirmLogout(true)} />
    <div className="potential-equipment-toolbar"><div><h2><Sparkles size={18} />装备潜能 <span>{loaded ? equipment.length : '—'}</span></h2>
      <p>支持为无潜能装备添加属性，每件装备最多 3 个槽位。</p></div>
      <button type="button" className="primary-button" onClick={loadList} disabled={!ready || Boolean(busy)}>
        {busy === 'list' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}获取潜能列表</button>
    </div>
    {loaded && equipment.length > 0 && <div className="potential-equipment-search"><Search size={17} aria-hidden="true" />
      <input aria-label="筛选装备" placeholder="搜索装备名称、实例 ID 或模板 ID" value={query} onChange={(event) => setQuery(event.target.value)} />
      <span>{visible.length} 件</span>
    </div>}
    {visible.length > 0 ? <div className="potential-grid">{visible.map((item) => <PotentialCard key={item.instanceId}
      item={item} options={options} disabled={!ready || Boolean(busy)} saving={busy === `save-${item.instanceId}`} onSave={save} />)}</div>
      : <div className="potential-empty panel-surface"><PackageSearch size={34} /><h3>{loaded ? '暂无匹配装备' : '准备编辑装备潜能'}</h3>
        <p>{loaded ? '调整搜索条件，或重新获取潜能列表。' : ready ? '点击“获取潜能列表”，查看此角色的装备。' : '登录账号并进入游戏后，即可读取装备列表。'}</p></div>}
    <p className="potential-footnote">此账号独立于自动发物资账号池。退出工作区不会退出游戏账号。</p>
    {confirmLogout && <ConfirmDialog title="退出当前游戏账号？" description="确认后将关闭游戏连接并停止该会话的心跳。"
      confirmLabel="退出账号" danger busy={Boolean(busy)} onCancel={() => setConfirmLogout(false)} onConfirm={logout} />}
  </section>;
}
