import { useState } from 'react';
import { Search, X } from 'lucide-react';
import './archive-search.css';

export type ArchiveSearchField = 'characterId' | 'playerQQ' | 'itemName' | 'itemCode';
const issuanceFields: Array<[ArchiveSearchField, string, string]> = [['playerQQ', '玩家 QQ', '输入完整 QQ'], ['characterId', '角色 ID', '输入完整角色 ID'], ['itemName', '物品名称', '输入物品名称'], ['itemCode', '物品代码', '输入物品代码']];

export function ArchiveSearch({ issuance, value, field, onSearch }: { issuance: boolean; value: string; field: ArchiveSearchField; onSearch: (value: string, field: ArchiveSearchField) => void }) {
  const [draft, setDraft] = useState(value);
  const fields = issuance ? issuanceFields : issuanceFields.slice(1, 2);
  const selected = fields.find(([key]) => key === field) ?? fields[0];
  return <form className="archive-search" role="search" aria-label={issuance ? '搜索物资发放记录' : '搜索常规操作记录'} onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim(), selected[0]); }}>
    <label className="archive-search-field"><span>搜索字段</span><select value={selected[0]} onChange={(event) => onSearch(value, event.target.value as ArchiveSearchField)}>{fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className="search-field">
      <input type="search" aria-label={selected[1]} placeholder={selected[2]} value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)} />
      <button type="button" className="icon-button" title="清空搜索" aria-label="清空搜索" disabled={!draft && !value} onClick={() => { setDraft(''); onSearch('', selected[0]); }}><X size={16} /></button>
    </div>
    <button type="submit" className="icon-button refresh-button" title="搜索" aria-label="搜索"><Search size={18} /></button>
  </form>;
}
