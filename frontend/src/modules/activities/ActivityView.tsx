import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { CirclePlus, Pencil, Plus, Save, Search, Ticket, Trash2, X } from 'lucide-react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import { ItemThumbnail } from '../../components/ItemThumbnail';
import type { CatalogItem, Role } from '../../types';
import { CatalogPager } from './CatalogPager';
import { activityRewardLabel, catalogToReward, readActivities, writeActivities, type Activity, type ActivityReward } from './store';
import { codeForLevel, isEquipment, MAX_EQUIPMENT_LEVEL, normalizeEquipmentLevel } from '../../shared/item-level';

const RECENT_ITEMS_KEY = 'game-support-recent-items';
const ITEM_TYPE_LABELS: Record<string, string> = {
  consume: '消耗品', equip: '装备', fashion: '时装', material: '材料', chair: '椅子', quest: '任务', title: '称号'
};
const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS);
const ITEMS_PER_PAGE = 8;
const emptyActivity = (): Activity => ({ id: '', name: '', description: '', rewards: [{ kind: 'cash', quantity: 0 }, { kind: 'item', quantity: 1 }], updatedAt: '' });
type CatalogPage = { source: string; index: number; cursors: Array<string | undefined>; nextCursor: string | null; totalCount: number | null };
const emptyCatalogPage = (): CatalogPage => ({ source: '', index: 0, cursors: [undefined], nextCursor: null, totalCount: null });

function readRecentItems() {
  if (typeof window === 'undefined') return [] as CatalogItem[];
  try { const value = JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) ?? '[]') as CatalogItem[]; return Array.isArray(value) ? value.slice(0, 12) : []; } catch { return []; }
}

export function ActivityView({ role = 'manager', token }: { role?: Role; token?: string }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [activities, setActivities] = useState<Activity[]>(readActivities);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Activity>(emptyActivity);
  const [recentItems, setRecentItems] = useState<CatalogItem[]>(readRecentItems);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogPage, setCatalogPage] = useState<CatalogPage>(emptyCatalogPage);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const catalogCursor = catalogPage.cursors[catalogPage.index];

  useEffect(() => writeActivities(activities), [activities]);
  useEffect(() => { try { localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(recentItems)); } catch { /* storage may be unavailable */ } }, [recentItems]);
  useEffect(() => {
    const text = query.trim();
    const source = typeFilter ? `class:${typeFilter}` : text ? `search:${text}` : '';
    if (!source) {
      setCatalogItems([]);
      setCatalogLoading(false);
      if (catalogPage.source) setCatalogPage(emptyCatalogPage());
      return;
    }
    if (catalogPage.source !== source) { setCatalogItems([]); setCatalogPage({ source, index: 0, cursors: [undefined], nextCursor: null, totalCount: null }); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    const load = async () => {
      try {
        const result = typeFilter
          ? await client.listItemsByClass(typeFilter, controller.signal, catalogCursor, ITEMS_PER_PAGE)
          : await client.searchItems(text, controller.signal, catalogCursor, ITEMS_PER_PAGE);
        if (controller.signal.aborted) return;
        setCatalogItems(result.items);
        setCatalogPage((current) => current.source === source && current.index === catalogPage.index ? { ...current, nextCursor: result.nextCursor, totalCount: result.totalCount } : current);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCatalogItems([]);
        setCatalogPage((current) => current.source === source && current.index === catalogPage.index ? { ...current, nextCursor: null, totalCount: 0 } : current);
        setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '道具目录暂不可用' });
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    };
    const timer = typeFilter ? undefined : window.setTimeout(() => void load(), 220);
    if (typeFilter) void load();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogCursor, catalogPage.index, catalogPage.source, client, query, typeFilter]);

  const hasCatalogQuery = Boolean(typeFilter || query.trim());
  const visibleItems = useMemo(() => hasCatalogQuery ? catalogItems : recentItems, [catalogItems, hasCatalogQuery, recentItems]);
  const startAdd = () => { setEditing(null); setDraft(emptyActivity()); setEditorOpen(true); };
  const startEdit = (activity: Activity) => { const cash = activity.rewards.find((reward) => reward.kind === 'cash'); const itemRewards = activity.rewards.filter((reward) => reward.kind === 'item'); setEditing(activity); setDraft({ ...activity, rewards: [cash ?? { kind: 'cash', quantity: 0 }, ...itemRewards].map((reward) => ({ ...reward })) }); setEditorOpen(true); };
  const setReward = (index: number, next: Partial<ActivityReward>) => setDraft((current) => ({ ...current, rewards: current.rewards.map((reward, i) => i === index ? { ...reward, ...next } : reward) }));
  const save = () => {
    const cleanName = draft.name.trim();
    const rewards = draft.rewards.filter((reward) => reward.quantity > 0 && (reward.kind === 'cash' || reward.itemCode));
    if (!cleanName) { setNotice({ kind: 'error', text: '请输入活动名称' }); return; }
    if (!rewards.length) { setNotice({ kind: 'error', text: '至少添加一个有效奖励，数量需大于 0' }); return; }
    if (rewards.some((reward) => reward.kind === 'item' && isEquipment(reward.itemClass) && reward.itemLevel !== undefined && (!Number.isInteger(reward.itemLevel) || reward.itemLevel < 1 || reward.itemLevel > MAX_EQUIPMENT_LEVEL))) { setNotice({ kind: 'error', text: `装备等级必须是 1-${MAX_EQUIPMENT_LEVEL} 的整数` }); return; }
    const normalizedRewards = rewards.map((reward) => reward.kind === 'item' ? {
      ...reward,
      itemCode: reward.itemCode?.replace(/_[0-9]+$/u, ''),
      ...(isEquipment(reward.itemClass) ? { itemLevel: normalizeEquipmentLevel(reward.itemLevel) } : { itemLevel: undefined })
    } : reward);
    const itemCodes = normalizedRewards.filter((reward) => reward.kind === 'item').map((reward) => codeForLevel(reward.itemCode as string, reward.itemClass, reward.itemLevel));
    if (new Set(itemCodes).size !== itemCodes.length) { setNotice({ kind: 'error', text: '同一物品和等级不能重复添加' }); return; }
    const next = { ...draft, id: editing?.id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`), name: cleanName, description: draft.description.trim(), rewards: normalizedRewards, updatedAt: new Date().toISOString() };
    setActivities((current) => editing ? current.map((activity) => activity.id === editing.id ? next : activity) : [next, ...current]);
    setEditing(null); setDraft(emptyActivity()); setEditorOpen(false); setNotice({ kind: 'success', text: editing ? '活动已更新' : '活动已添加' }); window.dispatchEvent(new Event('activities-updated'));
  };
  const remove = (activity: Activity) => setDeleteTarget(activity);
  const selectType = (next: string) => { setTypeFilter(next); setQuery(''); };
  const confirmRemove = () => {
    if (!deleteTarget) return;
    setActivities((current) => current.filter((activity) => activity.id !== deleteTarget.id));
    setDeleteTarget(null); setNotice({ kind: 'success', text: '活动已删除' });
    window.dispatchEvent(new Event('activities-updated'));
  };
  const chooseItem = (item: CatalogItem) => {
    if (!editorOpen) return;
    if (!isEquipment(item.itemClass) && draft.rewards.some((reward) => reward.kind === 'item' && reward.itemCode === item.code)) { setNotice({ kind: 'error', text: '同一物品不能重复添加' }); return; }
    const index = draft.rewards.findIndex((reward) => reward.kind === 'item' && !reward.itemCode);
    setDraft((current) => index >= 0 ? { ...current, rewards: current.rewards.map((reward, i) => i === index ? catalogToReward(item, reward.quantity || 1) : reward) } : { ...current, rewards: [...current.rewards, catalogToReward(item)] });
    setRecentItems((current) => [item, ...current.filter((entry) => entry.code !== item.code)].slice(0, 12));
  };

  const cancelEditor = () => { setEditing(null); setDraft(emptyActivity()); setEditorOpen(false); };
  const selectedItemCodes = new Set(draft.rewards.filter((reward) => reward.kind === 'item' && reward.itemCode).map((reward) => codeForLevel(reward.itemCode as string, reward.itemClass, reward.itemLevel)));
  const previousPage = () => setCatalogPage((current) => current.index > 0 ? { ...current, index: current.index - 1, nextCursor: null } : current);
  const nextPage = () => setCatalogPage((current) => current.nextCursor ? { ...current, index: current.index + 1, cursors: [...current.cursors.slice(0, current.index + 1), current.nextCursor], nextCursor: null } : current);
  const totalPages = catalogPage.totalCount === null ? 0 : Math.ceil(catalogPage.totalCount / ITEMS_PER_PAGE);

  return <section className="workspace activity-workspace"><div className="page-heading manager-heading"><div><p className="eyebrow">活动与道具</p><h1>活动与道具</h1></div><div className="heading-stat"><span>活动数量</span><strong>{activities.length}</strong></div></div><div className="activity-layout">
    <section className="activity-left">{editorOpen ? <ActivityEditor draft={draft} setDraft={setDraft} setReward={setReward} onSave={save} onCancel={cancelEditor} /> : <><div className="activity-list-heading"><div><p className="eyebrow">活动列表</p><h2>已配置活动</h2></div><button type="button" className="primary-button" onClick={startAdd}><Plus size={16} />添加活动</button></div><div className="activity-cards">{activities.length ? activities.map((activity) => <article className="activity-card" key={activity.id}><div className="activity-card-header"><div><h3>{activity.name}</h3>{activity.description && <p>{activity.description}</p>}</div><div className="activity-card-actions"><button type="button" className="icon-button" aria-label="编辑活动" onClick={() => startEdit(activity)}><Pencil size={15} /></button><button type="button" className="icon-button danger-button" aria-label="删除活动" onClick={() => remove(activity)}><Trash2 size={15} /></button></div></div><div className="activity-reward-list">{activity.rewards.map((reward, index) => <span className={`activity-reward-pill ${reward.kind}`} key={`${reward.kind}-${reward.itemCode ?? index}-${reward.itemLevel ?? 1}`}>{activityRewardLabel(reward)}</span>)}</div></article>) : <div className="empty-state"><h3>还没有活动</h3></div>}</div></>}</section>
    <section className={`activity-item-board ${editorOpen ? '' : 'is-disabled'}`}><div className="activity-list-heading"><div><p className="eyebrow">道具目录</p><h2>选择道具</h2></div><span>{catalogLoading ? '加载中…' : `${visibleItems.length} 项`}</span></div><div className="activity-board-toolbar"><div className="activity-search"><Search size={15} /><input value={query} placeholder="搜索道具名称或代码" onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setTypeFilter(''); }} /></div><div className="activity-type-filters"><button type="button" className={!typeFilter ? 'selected' : ''} onClick={() => selectType('')}>全部</button>{ITEM_TYPES.map((type) => <button type="button" className={typeFilter === type ? 'selected' : ''} key={type} onClick={() => selectType(type)}>{ITEM_TYPE_LABELS[type]}</button>)}</div></div><div className="activity-item-grid">{visibleItems.map((item) => { const selected = selectedItemCodes.has(codeForLevel(item.code, item.itemClass, 1)); const locked = selected && !isEquipment(item.itemClass); return <button type="button" className="activity-item-tile" key={item.code} disabled={!editorOpen || locked} aria-label={locked ? `${item.name}（已添加）` : item.name} onClick={() => chooseItem(item)}><ItemThumbnail src={item.image} alt="" size="medium" /><span><strong>{item.name}</strong><small>{item.code}{item.itemClass && ITEM_TYPE_LABELS[item.itemClass] ? ` · ${ITEM_TYPE_LABELS[item.itemClass]}` : ''}{selected ? ' · 已添加' : ''}</small></span>{selected ? <span className="activity-item-added">已添加</span> : <CirclePlus size={15} />}</button>; })}{!visibleItems.length && <div className="activity-board-empty">{catalogLoading ? '正在加载物品' : query ? '未找到匹配道具' : typeFilter ? '暂无该分类物品' : '暂无最近使用道具'}</div>}</div>{hasCatalogQuery && <CatalogPager page={catalogPage.index + 1} hasNext={Boolean(catalogPage.nextCursor)} totalCount={catalogPage.totalCount ?? 0} totalPages={totalPages} disabled={catalogLoading} onPrevious={previousPage} onNext={nextPage} />}</section>
    </div>{notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}{deleteTarget && <ConfirmDialog title={`确认删除活动“${deleteTarget.name}”？`} description="删除后活动奖励配置将无法恢复。" confirmLabel="删除活动" danger onCancel={() => setDeleteTarget(null)} onConfirm={confirmRemove} />}</section>;
}

function ActivityEditor({ draft, setDraft, setReward, onSave, onCancel }: { draft: Activity; setDraft: (value: Activity | ((current: Activity) => Activity)) => void; setReward: (index: number, next: Partial<ActivityReward>) => void; onSave: () => void; onCancel: () => void }) {
  const cash = draft.rewards.findIndex((reward) => reward.kind === 'cash');
  const itemRewards = draft.rewards.map((reward, index) => ({ reward, index })).filter(({ reward }) => reward.kind === 'item');
  const hasEmptyItem = itemRewards.some(({ reward }) => !reward.itemCode);
  const quantity = (event: ChangeEvent<HTMLInputElement>) => Number(event.target.value.replace(/[^0-9]/g, ''));
  return <section className="panel-surface form-panel activity-editor">
    <div className="section-title"><span className="step-index">编辑</span><div><h2>{draft.id ? '编辑活动' : '添加活动'}</h2></div></div>
    <label><span>活动名称</span><input value={draft.name} placeholder="例如：周年庆登录礼" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
    <label className="activity-description"><span>活动说明</span><textarea rows={2} value={draft.description} placeholder="说明适用范围或客服备注" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
    <div className="activity-reward-title"><strong>奖励设置</strong><button type="button" className="text-button" disabled={hasEmptyItem} onClick={() => setDraft((current) => ({ ...current, rewards: [...current.rewards, { kind: 'item', quantity: 1 }] }))}><CirclePlus size={15} />添加道具奖励</button></div>
    <div className="activity-fixed-reward cash-reward-row"><Ticket size={15} /><span>点券</span><input inputMode="numeric" aria-label="点券数量" placeholder="数量" value={cash >= 0 ? draft.rewards[cash].quantity || '' : ''} onChange={(event) => setDraft((current) => cash >= 0 ? { ...current, rewards: current.rewards.map((reward, index) => index === cash ? { ...reward, quantity: quantity(event) } : reward) } : { ...current, rewards: [{ kind: 'cash', quantity: quantity(event) }, ...current.rewards] })} /><button type="button" className="icon-button danger-button" aria-label="清除点券" onClick={() => setDraft((current) => ({ ...current, rewards: current.rewards.filter((reward) => reward.kind !== 'cash') }))}><X size={15} /></button></div>
    <div className="activity-fixed-reward item-reward-heading"><span>道具奖励</span></div>
    {itemRewards.map(({ reward, index }) => <div className={`activity-fixed-reward item-reward-row ${isEquipment(reward.itemClass) ? 'has-item-level' : ''}`} key={index}><span className="activity-item-name">{reward.itemName || '请从右侧选择道具'}</span>{isEquipment(reward.itemClass) && <label className="item-level-control"><span>等级</span><input className="item-level-input" type="text" inputMode="numeric" pattern="[0-9]*" aria-label="装备等级" value={reward.itemLevel ?? 1} onChange={(event) => { const value = event.target.value.replace(/[^0-9]/g, ''); setReward(index, { itemLevel: value ? Number(value) : undefined }); }} onBlur={(event) => { if (!event.currentTarget.value) setReward(index, { itemLevel: 1 }); }} /></label>}<label className="item-quantity-control"><span>数量</span><input className="item-quantity-input" inputMode="numeric" aria-label="道具数量" value={reward.quantity || ''} onChange={(event) => setReward(index, { quantity: quantity(event) })} /></label><button type="button" className="icon-button danger-button" aria-label="删除道具奖励" onClick={() => setDraft((current) => ({ ...current, rewards: current.rewards.filter((_, rewardIndex) => rewardIndex !== index) }))}><X size={15} /></button></div>)}
    {!itemRewards.length && <div className="activity-no-items">还没有道具奖励</div>}
    <div className="form-footer activity-editor-footer"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="primary-button" onClick={onSave}><Save size={16} />保存活动</button></div>
  </section>;
}
