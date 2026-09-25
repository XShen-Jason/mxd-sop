import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { PotentialOption } from '../../types';
import { optionKey, optionLabel, searchOptions } from './potential-options';

interface Props {
  index: number;
  value: string;
  options: PotentialOption[];
  disabled: boolean;
  changeLabel?: string;
  onChange: (value: string) => void;
}

export function PotentialSlot({ index, value, options, disabled, changeLabel, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((option) => optionKey(option) === value);
  const matches = searchOptions(options, query);
  const shown = matches.slice(0, 60);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id, open]);

  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(''); };
  const expand = () => { setQuery(''); setActive(0); setOpen(true); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) expand();
      else setActive((current) => Math.max(0, Math.min(shown.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (shown[active]) choose(optionKey(shown[active]));
    }
  };

  return <div ref={root} className="potential-slot" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); }
  }}>
    <label htmlFor={id}><span className="potential-slot-number">{index + 1}</span>潜能槽位
      <span className={`potential-slot-hint ${changeLabel ? 'is-changed' : ''}`}>{changeLabel || (value ? '未修改' : '可新增')}</span>
    </label>
    <div className={`potential-combobox ${open ? 'is-open' : ''}`}>
      <Search size={15} aria-hidden="true" />
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={`${id}-list`} aria-activedescendant={open && shown[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off" disabled={disabled} placeholder="搜索潜能名称 / 数值 / 等级"
        value={open ? query : selected ? optionLabel(selected) : value ? `未识别属性 · ${value}` : ''}
        onFocus={expand} onClick={() => { if (!open) expand(); }} onKeyDown={keyDown}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }} />
      {value ? <button type="button" className="icon-button" disabled={disabled}
        aria-label={`清空槽位 ${index + 1}`} onClick={() => choose('')}><X size={15} /></button>
        : <ChevronDown size={15} aria-hidden="true" />}
    </div>
    {open && !disabled && <div className="potential-dropdown">
      <div className="potential-result-count">{matches.length} 项匹配{matches.length > 60 ? ' · 请继续输入缩小范围' : ''}</div>
      <div id={`${id}-list`} role="listbox" aria-label={`槽位 ${index + 1} 可选潜能`} className="potential-results">
        {shown.map((option, position) => <button type="button" role="option" tabIndex={-1}
          id={`${id}-option-${position}`} aria-selected={value === optionKey(option)} key={optionKey(option)}
          className={`potential-option ${active === position ? 'is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(position)}
          onClick={() => choose(optionKey(option))}>
          <span><strong>{option.statName} +{option.showValue}</strong><small>{option.statType}</small></span>
          <span className="potential-grade">{option.grade}</span>
          {value === optionKey(option) && <Check size={14} aria-hidden="true" />}
        </button>)}
        {!shown.length && <p className="potential-no-results">没有匹配项，试试“力量 15”或“equipatk”。</p>}
      </div>
    </div>}
  </div>;
}
