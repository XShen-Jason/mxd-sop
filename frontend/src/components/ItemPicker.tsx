import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Search } from 'lucide-react';
import type { CatalogItem } from '../types';
import { ApiClient, ApiError } from '../api/client';
import { FloatingNotice } from './FloatingNotice';
import { ItemThumbnail } from './ItemThumbnail';

type InputState = 'empty' | 'invalid';

export function ItemPicker({ value, name, image, onChange, onClear, onInputState, token }: { value: string; name: string; image?: string; onChange: (item: CatalogItem) => boolean | void; onClear?: () => void; onInputState?: (state: InputState) => void; token?: string }) {
  const [query, setQuery] = useState(name);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(name);
  }, [name]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, value]);

  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < 1) { setItems([]); return; }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true); setError('');
      try {
        const result = await new ApiClient('customer', token).searchItems(text, controller.signal);
        if (!controller.signal.aborted) setItems(result.items);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : '目录暂不可用');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, query, token]);

  const unresolved = !value && query.trim().length > 0;
  return <div className="item-picker" ref={pickerRef}>
    <div className={`search-field ${value ? 'has-value' : ''} ${unresolved ? 'invalid' : ''}`}>
      <Search size={16} aria-hidden="true" />
      {value && <ItemThumbnail src={image} alt="" size="small" />}
      <input aria-label="搜索物品" value={query} placeholder="搜索物品名称或代码" onFocus={() => setOpen(true)} onChange={(event) => { const next = event.target.value; if (value && next !== name) onInputState ? onInputState(next.trim() ? 'invalid' : 'empty') : onClear?.(); else onInputState?.(next.trim() ? 'invalid' : 'empty'); setQuery(next); setOpen(true); }} />
      {loading ? <LoaderCircle className="spin" size={16} /> : <ChevronDown size={16} aria-hidden="true" />}
    </div>
    {open && <>
      <div className="picker-menu" role="listbox">
        {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} />}
        {!error && !loading && items.length === 0 && <div className="picker-message">{unresolved ? '未找到匹配物品，请从下拉列表选择' : '输入关键词开始搜索'}</div>}
        {items.map((item) => <button type="button" role="option" aria-selected={item.code === value} className="picker-option" key={item.code} onClick={() => { const accepted = onChange(item); if (accepted === false) { setQuery(name); setOpen(true); return; } setQuery(item.name); setOpen(false); }}>
          <ItemThumbnail src={item.image} alt="" size="medium" />
          <span><strong>{item.name}</strong><small>{item.code}{item.itemClass ? ` · ${item.itemClass}` : ''}</small></span>
          {item.code === value && <Check size={16} />}
        </button>)}
      </div>
    </>}
  </div>;
}
