import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, CirclePlus, Layers3, Package, RefreshCw, Send, ShieldBan, Ticket, UserRound, X } from 'lucide-react';
import { useRef } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import { ItemPicker } from '../../components/ItemPicker';
import { ItemThumbnail } from '../../components/ItemThumbnail';
import { StatusBadge } from '../../components/StatusBadge';
import { formatRecordTime, isIssuanceGroup, IssuanceItemsDisplay, recordType, RecordTableHeader, reasonLabel } from '../operation-groups/RecordPresentation';
import type { AppOptions, CatalogItem, Group, Role } from '../../types';
import { activityRewardLabel, readActivities, writeActivities, type Activity } from '../activities/store';
import { expandCompletedStatuses } from '../operation-groups/pagination';
import { codeForLevel, isEquipment, MAX_EQUIPMENT_LEVEL, normalizeEquipmentLevel, splitEquipmentCode } from '../../shared/item-level';

type Mode = 'issue' | 'kick' | 'ban';
type ItemDraft = { itemCode: string; itemName: string; itemClass?: string; image?: string; itemLevel?: number; quantity: string; state: 'empty' | 'selected' | 'invalid' };
type FormState = { serverId: string; account: string; characterId: string; playerQQ: string; reasonCode: string; reasonText: string };
type ConfirmState = { title: string; description: string; payload: Record<string, unknown> } | null;
type Notice = { id: number; kind: 'success' | 'error'; text: string };
const emptyItem = (): ItemDraft => ({ itemCode: '', itemName: '', quantity: '1', state: 'empty' });
const actionLabel: Record<Mode, string> = { issue: '发物资', kick: '拖人', ban: '封禁' };
type RecordFilterStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled';
const recordStatusName: Record<RecordFilterStatus, string> = { pending: '\u5f85\u5ba1\u6838', approved: '\u5f85\u5b8c\u6210', completed: '\u5df2\u5b8c\u6210', rejected: '\u5df2\u9a73\u56de', cancelled: '\u5df2\u53d6\u6d88' };
const defaultRecordStatuses: RecordFilterStatus[] = ['pending', 'approved', 'completed', 'rejected'];
type RecordFilterType = 'issue' | 'regular';
const recordTypeName: Record<RecordFilterType, string> = { issue: '\u53d1\u7269\u8d44', regular: '\u5e38\u89c4\u64cd\u4f5c' };
const RECENT_ITEMS_KEY = 'game-support-recent-items';

function readRecentItems() {
  if (typeof window === 'undefined') return [] as CatalogItem[];
  try { const value = JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) ?? '[]') as CatalogItem[]; return Array.isArray(value) ? value.slice(0, 6) : []; } catch { return []; }
}

export function CustomerView({ options, token, role = 'customer', section = 'operations', onNavigate, reminderCounts, recordCounts }: { options: AppOptions; token?: string; role?: Role; section?: 'operations' | 'records' | 'reminders'; onNavigate?: (section: 'operations' | 'records' | 'reminders') => void; reminderCounts?: { issuance?: number; regular?: number }; recordCounts?: { issuance?: number; regular?: number } }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [mode, setMode] = useState<Mode>('issue');
  const [groups, setGroups] = useState<Group[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordFilterType>('issue');
  const [recordStatuses, setRecordStatuses] = useState<RecordFilterStatus[]>(defaultRecordStatuses);
  const [noticeQueue, setNoticeQueue] = useState<Notice[]>([]);
  const [activeNotice, setActiveNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [recentItems, setRecentItems] = useState<CatalogItem[]>(readRecentItems);
  const [form, setForm] = useState<FormState>({ serverId: options.servers[0]?.id ?? '', account: '', characterId: '', playerQQ: '', reasonCode: options.reasons[0]?.code ?? 'bug-recovery', reasonText: '' });
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [cashQuantity, setCashQuantity] = useState('');
  const [activities, setActivities] = useState<Activity[]>(readActivities);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const loadingRequest = useRef(0);
  const loadingMore = useRef(false);
  useEffect(() => { const sync = () => setActivities(readActivities()); window.addEventListener('storage', sync); window.addEventListener('activities-updated', sync); return () => { window.removeEventListener('storage', sync); window.removeEventListener('activities-updated', sync); }; }, []);
  useEffect(() => {
    if (section !== 'operations') return;
    let active = true;
    void client.activities().then(({ activities: remote }) => {
      if (!active) return;
      setActivities(remote);
      writeActivities(remote);
    }).catch(() => { /* retain the local cache when the API is temporarily unavailable */ });
    return () => { active = false; };
  }, [client, section]);

  const load = async (append = false) => {
    if (append && loadingMore.current) return;
    const requestId = ++loadingRequest.current;
    if (append) loadingMore.current = true;
    if (section === 'operations') {
      setGroups([]);
      setCursor(null);
      setLoading(false);
      loadingMore.current = false;
      return;
    }
    setLoading(true);
    try {
      if (section === 'reminders') {
        const kind = recordTypeFilter === 'issue' ? 'issuance' : 'regular';
        const result = await client.reminders(append ? cursor ?? undefined : undefined, 20, kind);
        if (requestId !== loadingRequest.current) return;
        setGroups((current) => append ? [...current, ...result.groups.filter((group) => !current.some((item) => item.id === group.id))] : result.groups);
        setCursor(result.nextCursor);
        return;
      }
       const kind = section === 'records' ? (recordTypeFilter === 'issue' ? 'issuance' : 'regular') : undefined;
      const statuses = section === 'records' ? expandCompletedStatuses(recordStatuses) : undefined;
      if (section === 'records' && statuses?.length === 0) {
        setGroups([]); setCursor(null); return;
      }
      const result = await client.mine(append ? cursor ?? undefined : undefined, 20, statuses, kind);
      if (requestId !== loadingRequest.current) return;
      setGroups((current) => append ? [...current, ...result.groups.filter((group) => !current.some((item) => item.id === group.id))] : result.groups);
      setCursor(result.nextCursor);
    }
    catch (error) { if (requestId === loadingRequest.current) pushNotice('error', error instanceof ApiError ? error.message : '暂时无法加载申请记录'); }
    finally { if (requestId === loadingRequest.current) setLoading(false); if (append) loadingMore.current = false; }
  };
  useEffect(() => { void load(); }, [client, section, recordTypeFilter, recordStatuses.join(',')]);
  useEffect(() => { let refreshTimer: number | undefined; const refresh = () => { if (section === 'operations') return; if (refreshTimer !== undefined) window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => { refreshTimer = undefined; void load(); }, 50); }; window.addEventListener('operation-groups-changed', refresh); return () => { window.removeEventListener('operation-groups-changed', refresh); if (refreshTimer !== undefined) window.clearTimeout(refreshTimer); }; }, [client, section, recordTypeFilter, recordStatuses.join(',')]);
  useEffect(() => { setExpandedRecordId(null); }, [section]);
  useEffect(() => { localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(recentItems)); }, [recentItems]);
  useEffect(() => { if (!activeNotice && noticeQueue.length) { setActiveNotice(noticeQueue[0]); setNoticeQueue((current) => current.slice(1)); } }, [activeNotice, noticeQueue]);

  const reset = (nextMode: Mode = 'issue') => {
    setMode(nextMode); setEditingId(null); setConfirm(null);
    setForm((current) => ({ ...current, account: '', characterId: '', playerQQ: '', reasonCode: nextMode === 'issue' ? options.reasons[0]?.code ?? 'bug-recovery' : (options.actionReasons?.[nextMode]?.[0]?.code ?? options.reasons[0]?.code ?? 'bug-recovery'), reasonText: '' }));
    setItems([emptyItem()]); setCashQuantity('');
    setSelectedActivities([]);
  };

  const toggleActivity = (activity: Activity) => {
    const removing = selectedActivities.includes(activity.id);
    setSelectedActivities((current) => removing ? current.filter((id) => id !== activity.id) : [...current, activity.id]);
    for (const reward of activity.rewards) {
      if (reward.kind === 'cash') {
        setCashQuantity((current) => { const next = Math.max(0, Number(current || 0) + (removing ? -reward.quantity : reward.quantity)); return next ? String(next) : ''; });
        continue;
      }
      if (!reward.itemCode) continue;
      const rewardCode = reward.itemCode;
      const rewardLevel = isEquipment(reward.itemClass) ? normalizeEquipmentLevel(reward.itemLevel) : undefined;
      setItems((current) => {
        const existing = current.findIndex((item) => codeForLevel(item.itemCode, item.itemClass, item.itemLevel) === codeForLevel(rewardCode, reward.itemClass, rewardLevel));
        if (existing >= 0) return current.map((item, index) => {
          if (index !== existing) return item;
          const quantity = Number(item.quantity || 0) + (removing ? -reward.quantity : reward.quantity);
          if (quantity > 0) return { ...item, quantity: String(quantity) };
          return current.length > 1 ? null : emptyItem();
        }).filter((item): item is ItemDraft => Boolean(item));
        if (removing) return current;
        const blank = current.findIndex((item) => item.state !== 'selected');
        const nextItem: ItemDraft = { itemCode: rewardCode, itemName: reward.itemName ?? rewardCode, itemClass: reward.itemClass, image: reward.image, itemLevel: rewardLevel, quantity: String(reward.quantity), state: 'selected' };
        return blank >= 0 ? current.map((item, index) => index === blank ? nextItem : item) : current.length < 100 ? [...current, nextItem] : current;
      });
    }
  };

  const edit = (group: Group) => {
    onNavigate?.('operations');
    const firstItem = group.operations.find((operation) => operation.type === 'item');
    const cash = group.operations.find((operation) => operation.type === 'cash');
    const action = group.operations.find((operation) => operation.type === 'kick' || operation.type === 'ban' || operation.type === 'warp');
    const nextMode: Mode = action?.type === 'ban' ? 'ban' : action ? 'kick' : 'issue';
    setMode(nextMode); setEditingId(group.id);
    setForm({ serverId: group.server.id, account: group.account ?? '', characterId: group.characterId, playerQQ: group.playerQQ ?? '', reasonCode: group.reason.code, reasonText: group.reason.text ?? '' });
    setItems(firstItem && firstItem.type === 'item' ? group.operations.filter((operation): operation is Extract<Group['operations'][number], { type: 'item' }> => operation.type === 'item').map((operation) => { const parsed = isEquipment(operation.itemClass) ? splitEquipmentCode(operation.itemCode) : { baseCode: operation.itemCode, level: undefined }; return { itemCode: parsed.baseCode, itemName: operation.itemName, itemClass: operation.itemClass, image: operation.itemImage, itemLevel: isEquipment(operation.itemClass) ? normalizeEquipmentLevel(operation.itemLevel ?? parsed.level) : undefined, quantity: String(operation.quantity), state: 'selected' }; }) : [emptyItem()]);
    setCashQuantity(cash && cash.type === 'cash' ? String(cash.quantity) : ''); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validateBase = () => {
    if (!form.serverId) throw new Error('请选择服务器');
    if (!form.characterId || !/^[0-9]+$/.test(form.characterId)) throw new Error('角色 ID 只能填写数字');
    if (mode === 'issue' && !form.account.trim()) throw new Error('请填写游戏账号');
    if (mode === 'issue' && !form.playerQQ.trim()) throw new Error('请填写玩家 QQ');
    if (!form.reasonCode) throw new Error('请选择申请理由');
    if (form.reasonCode === 'other' && !form.reasonText.trim()) throw new Error('选择“其他”时请补充说明');
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = { serverId: form.serverId, characterId: form.characterId, reason: { code: form.reasonCode, ...(form.reasonText.trim() ? { text: form.reasonText.trim() } : {}) } };
    if (mode === 'issue') {
      if (items.some((item) => item.state === 'invalid')) throw new Error('请从下拉列表选择有效物品');
      const hasBlankItem = items.some((item) => item.state !== 'selected');
      if (hasBlankItem && !(items.length === 1 && items[0].state === 'empty' && cashQuantity.trim())) throw new Error('请为每一行选择具体物品');
      const operations: Array<Record<string, unknown>> = [];
      const finalCodes = new Set<string>();
      for (const item of items) { if (!item.itemCode) continue; const quantity = Number(item.quantity); if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('物品数量必须是正整数'); if (isEquipment(item.itemClass) && item.itemLevel !== undefined && (!Number.isInteger(item.itemLevel) || item.itemLevel < 1 || item.itemLevel > MAX_EQUIPMENT_LEVEL)) throw new Error(`装备等级必须是 1-${MAX_EQUIPMENT_LEVEL} 的整数`); const itemLevel = isEquipment(item.itemClass) ? normalizeEquipmentLevel(item.itemLevel) : undefined; const finalCode = codeForLevel(item.itemCode, item.itemClass, itemLevel); if (finalCodes.has(finalCode)) throw new Error('同一物品和等级不能重复选择'); finalCodes.add(finalCode); operations.push({ type: 'item', itemCode: item.itemCode, ...(isEquipment(item.itemClass) ? { itemLevel } : {}), quantity }); }
      if (cashQuantity.trim()) { const quantity = Number(cashQuantity); if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('点券数量必须是正整数'); operations.push({ type: 'cash', quantity }); }
      if (!operations.length) throw new Error('至少添加一项发放内容');
      payload.account = form.account.trim(); payload.playerQQ = form.playerQQ.trim(); payload.operations = operations;
    } else payload.operations = [{ type: mode }];
    return payload;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      validateBase();
      const payload = buildPayload();
      setConfirm({ title: editingId ? '确认保存修改？' : `确认提交${actionLabel[mode]}申请？`, description: mode === 'issue' ? '提交后将进入审核队列，物资内容会按当前选择保存。' : `常规操作无需审核，将进入待完成状态。目标为 ${targetLabel(form, options)}。`, payload });
    } catch (error) { pushNotice('error', error instanceof Error ? error.message : '请检查填写内容'); }
  };

  const confirmSubmit = async () => {
    if (!confirm) return; setSubmitting(true);
    try {
      const saved = editingId ? await client.updateGroup(editingId, confirm.payload) : await client.submit(confirm.payload);
      setGroups((current) => editingId ? current.map((group) => group.id === saved.id ? saved : group) : [saved, ...current].slice(0, 20));
      setConfirm(null); pushNotice('success', editingId ? '申请已更新' : mode === 'issue' ? '申请已提交，等待管理审核' : '申请已提交，等待完成'); reset(mode);
    }
    catch (error) { pushNotice('error', error instanceof ApiError || error instanceof Error ? error.message : '提交失败'); }
    finally { setSubmitting(false); }
  };

  const chooseRecent = (item: CatalogItem) => { const parsed = isEquipment(item.itemClass) ? splitEquipmentCode(item.code) : { baseCode: item.code, level: undefined }; if (!isEquipment(item.itemClass) && items.some((entry) => entry.itemCode === item.code)) { pushNotice('error', '同一物品不能重复选择'); return; } setItems((current) => { const index = current.findIndex((entry) => entry.state !== 'selected'); const next = { itemCode: parsed.baseCode, itemName: item.name, itemClass: item.itemClass, image: item.image, itemLevel: isEquipment(item.itemClass) ? normalizeEquipmentLevel(parsed.level) : undefined, quantity: '1', state: 'selected' as const }; if (index >= 0) return current.map((entry, i) => i === index ? { ...entry, ...next } : entry); return current.length < 100 ? [...current, next] : current; }); };
  const rememberItem = (item: CatalogItem) => setRecentItems((current) => [item, ...current.filter((entry) => entry.code !== item.code)].slice(0, 6));
  const requestCancel = (id: string) => setCancelTarget(id);
  const cancel = async () => {
    if (!cancelTarget) return;
    setCanceling(true);
    try { await client.cancel(cancelTarget); setCancelTarget(null); await load(); pushNotice('success', '申请已取消'); }
    catch (error) { pushNotice('error', error instanceof ApiError ? error.message : '取消失败'); }
    finally { setCanceling(false); }
  };
  const reasons = mode === 'issue' ? options.reasons : options.actionReasons?.[mode] ?? options.reasons;
  const baseComplete = Boolean(form.serverId && /^[0-9]+$/.test(form.characterId) && form.reasonCode && (mode !== 'issue' || (form.account.trim() && form.playerQQ.trim())) && (form.reasonCode !== 'other' || form.reasonText.trim()));
  const showRecords = section === 'records' || section === 'reminders';
  const visibleGroups = groups;
  const reminderCountFor = (type: RecordFilterType) => type === 'issue' ? (reminderCounts?.issuance ?? 0) : (reminderCounts?.regular ?? 0);
  const recordCountFor = (type: RecordFilterType) => type === 'issue' ? (recordCounts?.issuance ?? 0) : (recordCounts?.regular ?? 0);
  const toggleRecordStatus = (status: RecordFilterStatus) => setRecordStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]);
  const selectAllRecordStatuses = () => setRecordStatuses(Object.keys(recordStatusName) as RecordFilterStatus[]);
  const resetRecordFilters = () => { setRecordTypeFilter('issue'); setRecordStatuses(defaultRecordStatuses); };

  return <section className="workspace customer-workspace">
    <div className={`page-heading ${showRecords ? 'records-heading' : 'manager-heading'}`}><div><p className="eyebrow">客服工作台</p><h1>{section === 'reminders' ? '待提醒' : showRecords ? '\u6211\u7684\u7533\u8bf7' : editingId ? '\u4fee\u6539\u7533\u8bf7' : '\u7533\u8bf7\u64cd\u4f5c'}</h1></div>{!showRecords && (editingId ? <button type="button" className="secondary-button" onClick={() => { reset(mode); onNavigate?.('records'); }}>返回我的申请</button> : <div className="heading-stat"><span>待审核</span><strong>{groups.filter((group) => group.status === 'pending').length}</strong></div>)}</div>
    {!showRecords && !editingId && <div className="action-tabs" role="tablist">{(['issue', 'kick', 'ban'] as Mode[]).map((item) => <button type="button" key={item} className={mode === item ? 'action-tab active' : 'action-tab'} onClick={() => reset(item)} role="tab" aria-selected={mode === item}>{item === 'issue' ? <Package size={16} /> : item === 'kick' ? <UserRound size={16} /> : <ShieldBan size={16} />}{actionLabel[item]}</button>)}</div>}
    {activeNotice && <FloatingNotice kind={activeNotice.kind} text={activeNotice.text} onDismiss={() => setActiveNotice(null)} />}
    {!showRecords && <form className="request-form" onSubmit={submit}>
      <div className={mode === 'issue' ? 'request-top-grid' : ''}><section className="panel-surface form-panel player-panel"><div className="section-title"><span className="step-index">01</span><div><h2>玩家信息</h2><p>{mode === 'issue' ? '发物资需要完整玩家资料' : `${actionLabel[mode]}只需填写服务器、角色 ID 和理由`}</p></div></div>
        <div className="server-picker" aria-label="选择服务器">{options.servers.map((server) => <button type="button" key={server.id} aria-pressed={form.serverId === server.id} className={form.serverId === server.id ? 'server-choice selected' : 'server-choice'} onClick={() => setForm({ ...form, serverId: server.id })}>{server.displayName}</button>)}</div>
        <div className={`field-grid ${mode !== 'issue' ? 'compact-grid' : ''}`}>{mode === 'issue' && <><label><span>游戏账号</span><input value={form.account} placeholder="输入账号" onChange={(event) => setForm({ ...form, account: event.target.value })} /></label><label><span>玩家 QQ</span><input inputMode="numeric" value={form.playerQQ} placeholder="输入 QQ" onChange={(event) => setForm({ ...form, playerQQ: event.target.value })} /></label></>}<label><span>角色 ID</span><input inputMode="numeric" value={form.characterId} placeholder="仅数字" onChange={(event) => setForm({ ...form, characterId: event.target.value.replace(/[^0-9]/g, '') })} /></label><label className="reason-select-field"><span>申请理由</span><select value={form.reasonCode} onChange={(event) => setForm({ ...form, reasonCode: event.target.value })}>{reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.displayName}</option>)}</select></label></div>
        <label className="reason-note"><span>补充说明 <em>{form.reasonCode === 'other' ? '必填' : '可选'}</em></span><textarea value={form.reasonText} rows={2} placeholder={mode === 'ban' ? '填写违规事实或证据摘要' : mode === 'kick' ? '填写踢人原因' : '补充必要背景'} onChange={(event) => setForm({ ...form, reasonText: event.target.value })} /></label>
      </section>{mode === 'issue' && <ActivityChooser activities={activities} selected={selectedActivities} enabled={baseComplete} onToggle={toggleActivity} />}</div>
      {mode === 'issue' && baseComplete && <IssueOperations items={items} setItems={setItems} cashQuantity={cashQuantity} setCashQuantity={setCashQuantity} token={token} recentItems={recentItems} onRecentSelect={chooseRecent} onItemSelected={rememberItem} onDuplicateItem={() => pushNotice('error', '同一物品不能重复选择')} />}
      {mode !== 'issue' && baseComplete && <section className="panel-surface mini-action-panel compact-action"><div className="mini-action-icon">{mode === 'kick' ? <UserRound size={20} /> : <ShieldBan size={20} />}</div><strong>{actionLabel[mode]}申请</strong><span>目标：{targetLabel(form, options)}</span></section>}
      <div className="form-footer request-footer"><span className="muted-note">{editingId ? '保存后重新进入审核队列' : mode === 'issue' && !baseComplete ? '填写完整玩家信息后自动展开操作内容' : '提交后可在申请记录中查看进度'}</span><div className="footer-actions">{editingId && <button type="button" className="secondary-button" onClick={() => reset(mode)}>取消编辑</button>}<button className="primary-button submit-button" disabled={submitting} type="submit">{submitting ? '处理中…' : editingId ? '保存修改' : '提交申请'}<Send size={17} /></button></div></div>
    </form>}
    {showRecords && <section id="my-requests" className="records-section records-page">{loading ? <div className="empty-state"><LoaderDots /></div> : <><div className="manager-toolbar"><div className="filter-row">{(section === 'records' || section === 'reminders') && <div className="record-type-filter filter-choice-group" role="group" aria-label="筛选申请类型"><span className="filter-choice-label"><Package size={14} />类型</span>{(Object.entries(recordTypeName) as Array<[RecordFilterType, string]>).map(([type, label]) => <button type="button" className={recordTypeFilter === type ? 'filter-choice selected' : 'filter-choice'} key={type} aria-pressed={recordTypeFilter === type} onClick={() => { setRecordTypeFilter(type); setExpandedRecordId(null); }}>{label}{section === 'reminders' ? ` ${reminderCountFor(type)}` : section === 'records' ? ` ${recordCountFor(type)}` : ''}</button>)}</div>}{section === 'records' && <div className="record-status-filter filter-choice-group" role="group" aria-label="筛选申请状态"><span className="filter-choice-label"><Layers3 size={14} />状态</span><button type="button" className={recordStatuses.length === Object.keys(recordStatusName).length ? 'filter-choice selected' : 'filter-choice'} onClick={selectAllRecordStatuses}>全部</button>{Object.entries(recordStatusName).map(([status, label]) => <button type="button" className={`filter-choice status-filter-choice status-filter-${status} ${recordStatuses.includes(status as RecordFilterStatus) ? 'selected' : ''}`} key={status} onClick={() => toggleRecordStatus(status as RecordFilterStatus)}>{label}</button>)}</div>}<button type="button" className="icon-button refresh-button" title="刷新" aria-label="刷新申请记录" onClick={() => void load()}><RefreshCw size={17} /></button></div></div>{visibleGroups.length === 0 ? <div className="empty-state"><div className="empty-icon"><Package size={22} /></div><h3>{groups.length ? '没有符合筛选条件的记录' : section === 'reminders' ? '暂无待提醒记录' : '还没有申请记录'}</h3><p>{groups.length ? `当前筛选：${recordTypeName[recordTypeFilter]}，请选择其他条件查看申请` : '提交的申请会显示在这里'}</p></div> : <div className="record-table-shell">{section === 'reminders' || recordTypeFilter === 'issue' ? <RecordTableHeader isReissue /> : <RecordTableHeader />}<div className="record-table-body">{visibleGroups.map((group, index) => <OwnRecordCard key={group.id} index={index + 1} group={group} options={options} expanded={expandedRecordId === group.id} onToggle={() => setExpandedRecordId((current) => current === group.id ? null : group.id)} onEdit={edit} onCancel={requestCancel} />)}</div></div>}</>}{cursor && <button type="button" className="load-more" disabled={loading} onClick={() => void load(true)}>加载更多</button>}</section>}
    {confirm && <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={editingId ? '保存修改' : '确认提交'} busy={submitting} onCancel={() => setConfirm(null)} onConfirm={() => void confirmSubmit()} />}
    {cancelTarget && <ConfirmDialog title="确认取消申请？" description="取消后将停止处理，且无法恢复。" confirmLabel="确认取消" danger busy={canceling} onCancel={() => setCancelTarget(null)} onConfirm={() => void cancel()} />}
  </section>;

  function pushNotice(kind: Notice['kind'], text: string) {
    const id = Date.now() + Math.random(); setNoticeQueue((current) => [...current, { id, kind, text }]);
  }
}

function targetLabel(form: FormState, options: AppOptions) { return `${options.servers.find((server) => server.id === form.serverId)?.displayName ?? '未选择'} · ${form.characterId || '角色 ID'}`; }

function ActivityChooser({ activities, selected, enabled, onToggle }: { activities: Activity[]; selected: string[]; enabled: boolean; onToggle: (activity: Activity) => void }) {
  return <section className={`panel-surface activity-chooser ${enabled ? '' : 'is-disabled'}`}><div className="section-title"><span className="step-index">活动</span><div><h2>活动快捷填充</h2></div></div>{activities.length ? <div className="activity-chooser-list">{activities.map((activity) => <button type="button" key={activity.id} aria-pressed={selected.includes(activity.id)} className={`activity-choice ${selected.includes(activity.id) ? 'selected' : ''}`} disabled={!enabled} onClick={() => onToggle(activity)}><span className="activity-choice-main"><strong>{activity.name}</strong></span><span className="activity-choice-rewards">{activity.rewards.map((reward, index) => <em key={`${reward.itemCode ?? reward.kind}-${index}`}>{activityRewardLabel(reward)}</em>)}</span>{selected.includes(activity.id) && <span className="activity-selected-mark">已选</span>}</button>)}</div> : <div className="activity-chooser-empty">暂无活动</div>}</section>;
}

function IssueOperations({ items, setItems, cashQuantity, setCashQuantity, token, recentItems, onRecentSelect, onItemSelected, onDuplicateItem }: { items: ItemDraft[]; setItems: (value: ItemDraft[] | ((current: ItemDraft[]) => ItemDraft[])) => void; cashQuantity: string; setCashQuantity: (value: string) => void; token?: string; recentItems: CatalogItem[]; onRecentSelect: (item: CatalogItem) => void; onItemSelected: (item: CatalogItem) => void; onDuplicateItem: () => void }) {
  const selectItem = (index: number, next: CatalogItem) => { const parsed = isEquipment(next.itemClass) ? splitEquipmentCode(next.code) : { baseCode: next.code, level: undefined }; if (!isEquipment(next.itemClass) && items.some((entry, i) => i !== index && entry.itemCode === next.code)) { onDuplicateItem(); return false; } onItemSelected(next); setItems((current) => current.map((entry, i) => i === index ? { ...entry, itemCode: parsed.baseCode, itemName: next.name, itemClass: next.itemClass, image: next.image, itemLevel: isEquipment(next.itemClass) ? normalizeEquipmentLevel(parsed.level) : undefined, state: 'selected' } : entry)); return true; };
  const clearItem = (index: number) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, itemCode: '', itemName: '', itemClass: undefined, image: undefined, itemLevel: undefined, quantity: '', state: 'empty' } : entry));
  const removeItem = (index: number) => setItems((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current.map((entry, i) => i === index ? { ...entry, itemCode: '', itemName: '', itemClass: undefined, image: undefined, itemLevel: undefined, quantity: '', state: 'empty' } : entry));
  const markInput = (index: number, state: 'empty' | 'invalid') => setItems((current) => current.map((entry, i) => i === index ? { ...entry, itemCode: '', itemName: state === 'empty' ? '' : entry.itemName, itemClass: undefined, image: undefined, itemLevel: undefined, state } : entry));
  return <section className="panel-surface form-panel operations-panel"><div className="section-title"><span className="step-index">02</span><div><h2>具体操作内容</h2></div></div><div className="recent-items-panel"><div><strong>最近选择</strong><span>常用物品快捷入口</span></div><div className="recent-items-list">{recentItems.length ? recentItems.map((item) => <button type="button" key={item.code} className="recent-item-button" onClick={() => onRecentSelect(item)}><span className="recent-item-content"><ItemThumbnail src={item.image} alt="" size="small" /><span>{item.name}</span></span></button>) : <span className="recent-empty">选择物品后会出现在这里</span>}</div></div><div className="operation-split"><div className="operation-block"><div className="operation-block-title"><Package size={17} /><strong>发物品</strong><span>{items.filter((item) => item.itemCode).length}/100</span></div>{items.map((item, index) => <div className="item-line" key={index}><ItemPicker token={token} value={item.itemCode} name={item.itemName} image={item.image} onChange={(next: CatalogItem) => selectItem(index, next)} onClear={() => clearItem(index)} onInputState={(state) => markInput(index, state)} />{isEquipment(item.itemClass) && <label className="item-level-control"><span>等级</span><input className="item-level-input" type="text" inputMode="numeric" pattern="[0-9]*" aria-label={`第 ${index + 1} 个装备等级`} value={item.itemLevel ?? 1} onChange={(event) => { const value = event.target.value.replace(/[^0-9]/g, ''); setItems((current) => current.map((entry, i) => i === index ? { ...entry, itemLevel: value ? Number(value) : undefined } : entry)); }} onBlur={(event) => { if (!event.currentTarget.value) setItems((current) => current.map((entry, i) => i === index ? { ...entry, itemLevel: 1 } : entry)); }} /></label>}<label className="item-quantity-control"><span>数量</span><input className="item-quantity" inputMode="numeric" aria-label={`第 ${index + 1} 种物品数量`} value={item.quantity} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, quantity: event.target.value.replace(/[^0-9]/g, '') } : entry))} /></label><button type="button" className="icon-button danger-button clear-item-button" title={items.length > 1 ? '删除整条物品' : '清空物品和数量'} aria-label={items.length > 1 ? '删除整条物品' : '清空物品和数量'} onClick={() => removeItem(index)}><X size={16} /></button></div>)}<button type="button" className="add-operation" disabled={items.length >= 100 || items.some((item) => item.state !== 'selected')} onClick={() => setItems((current) => [...current, emptyItem()])}><CirclePlus size={16} />添加物品</button></div><div className="operation-block cash-block"><div className="operation-block-title"><Ticket size={17} /><strong>发点券</strong><span>单次数量</span></div><label><span>点券数量</span><input inputMode="numeric" value={cashQuantity} placeholder="可选" onChange={(event) => setCashQuantity(event.target.value.replace(/[^0-9]/g, ''))} /></label><div className="cash-hint">留空表示本次不发点券</div></div></div></section>;
}

function OwnRecordCard({ index, group, options, expanded, onToggle, onEdit, onCancel }: { index: number; group: Group; options: AppOptions; expanded: boolean; onToggle: () => void; onEdit: (group: Group) => void; onCancel: (id: string) => void }) {
  const kind = recordType(group); const reason = reasonLabel(options, group); const isIssuance = isIssuanceGroup(group); const expandable = isIssuance;
  const canModify = group.status === 'pending' || group.status === 'approved' || group.status === 'rejected';
  return <article className={`group-card record-card status-card-${group.status} ${expanded ? 'is-expanded' : ''}`}><div className={`record-table-row ${isIssuance ? 'record-table-reissue' : 'record-table-without-actor'} ${expandable ? 'is-expandable' : ''}`} role="row" tabIndex={expandable ? 0 : undefined} aria-expanded={expandable ? expanded : undefined} onClick={expandable ? onToggle : undefined} onKeyDown={expandable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); } } : undefined}><span className="record-index" role="cell" aria-label={`第 ${index} 条`}>{String(index).padStart(2, '0')}</span><div className="record-cell record-server" data-label="服务器" role="cell"><strong>{group.server.displayName}</strong></div>{isIssuance && <div className="record-cell record-account" data-label="游戏账号" role="cell"><span>{group.account || '--'}</span></div>}{isIssuance && <div className="record-cell record-qq" data-label="玩家 QQ" role="cell"><span>{group.playerQQ || '--'}</span></div>}<div className="record-cell record-character" data-label="角色 ID" role="cell"><code>{group.characterId}</code></div><div className="record-cell record-type-cell" data-label="类型" role="cell"><span className={`record-type record-type-${kind.key}`}>{kind.label}</span></div><div className="record-cell record-reason" data-label="理由" role="cell" title={reason}>{reason}{group.rejectionReason ? ` · ${group.rejectionReason}` : ''}</div><time className="record-time" data-label="提交时间" role="cell" dateTime={group.submittedAt}>{formatRecordTime(group.submittedAt)}</time><div className="record-status-cell" data-label="状态" role="cell"><StatusBadge status={group.status} /></div><div className="record-operation" data-label="操作" role="cell" onKeyDown={(event) => event.stopPropagation()}>{canModify && <><button type="button" className="record-action-button" onClick={(event) => { event.stopPropagation(); onEdit(group); }}>修改</button><button type="button" className="record-action-button danger" onClick={(event) => { event.stopPropagation(); onCancel(group.id); }}>取消</button></>}{expandable && <button type="button" className="record-action-button record-expand-button" title={expanded ? '收起详情' : '展开详情'} aria-label={expanded ? '收起详情' : '展开详情'} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}</div></div>{expanded && expandable && <div className="record-card-content"><IssuanceItemsDisplay group={group} /></div>}</article>;
}

function LoaderDots() { return <div className="loader-dots" aria-label="加载中"><i /><i /><i /></div>; }
