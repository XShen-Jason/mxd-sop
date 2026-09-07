import { useState } from 'react';
import { Search, X } from 'lucide-react';
import './archive-search.css';

export function ArchiveSearch({ issuance, value, onSearch }: { issuance: boolean; value: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const label = issuance ? '搜索QQ号、角色ID、物品名称或物品代码' : '搜索角色ID';
  return <form className="archive-search" role="search" aria-label={issuance ? '搜索物资发放记录' : '搜索常规操作记录'} onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim()); }}>
    <div className="search-field">
      <input type="search" aria-label={label} placeholder={issuance ? 'QQ / 角色ID / 名称 / 代码' : '角色ID'} value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)} />
      <button type="button" className="icon-button" title="清空搜索" aria-label="清空搜索" disabled={!draft && !value} onClick={() => { setDraft(''); onSearch(''); }}><X size={16} /></button>
    </div>
    <button type="submit" className="icon-button refresh-button" title="搜索" aria-label="搜索"><Search size={18} /></button>
  </form>;
}
