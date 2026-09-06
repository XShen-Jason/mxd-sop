import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type PlayerSelectOption = { value: string; label: string };

type PlayerSelectProps = {
  value: string;
  options: PlayerSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
  top: number;
};

const VIEWPORT_GUTTER = 12;
const MENU_GAP = 8;
const MENU_MAX_HEIGHT = 320;
// The mobile option row is 46px tall with a 2px inter-row gap.  Use the
// slightly conservative value here so a short list is not clipped by the
// viewport-placement calculation.
const OPTION_HEIGHT = 48;

export function PlayerSelect({ value, options, placeholder, onChange, disabled = false, 'aria-label': ariaLabel, className = '' }: PlayerSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectOptions = useMemo(() => options.length && !options.some((option) => option.value === '') ? [{ value: '', label: placeholder }, ...options] : options, [options, placeholder]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => initialIndex(selectOptions, value));
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const listboxId = `player-select-${useId().replace(/:/g, '')}`;
  const selected = selectOptions.find((option) => option.value === value);
  const hasSelection = value !== '' && Boolean(selected);

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportWidth = Math.min(layoutWidth, window.visualViewport?.width || layoutWidth);
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportWidthLimit = Math.max(1, viewportWidth - VIEWPORT_GUTTER * 2);
    const viewportHeightLimit = Math.max(1, viewportHeight - VIEWPORT_GUTTER * 2);
    // Keep the menu aligned with its trigger.  A long label is truncated in
    // the option row instead of widening the popup past the control/card.
    const width = Math.min(Math.max(rect.width, 1), viewportWidthLimit);
    const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - VIEWPORT_GUTTER - width);
    const left = Math.min(Math.max(rect.left, VIEWPORT_GUTTER), maxLeft);
    const estimatedHeight = Math.min(MENU_MAX_HEIGHT, Math.max(OPTION_HEIGHT, selectOptions.length * OPTION_HEIGHT + 8));
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - VIEWPORT_GUTTER);
    const spaceAbove = Math.max(0, rect.top - VIEWPORT_GUTTER);
    const placement = spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? 'above' : 'below';
    const availableSpace = placement === 'above' ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(estimatedHeight, viewportHeightLimit, Math.max(OPTION_HEIGHT, availableSpace || viewportHeightLimit));
    const desiredTop = placement === 'above' ? rect.top - MENU_GAP - maxHeight : rect.bottom + MENU_GAP;
    const top = Math.min(Math.max(desiredTop, VIEWPORT_GUTTER), Math.max(VIEWPORT_GUTTER, viewportHeight - VIEWPORT_GUTTER - maxHeight));
    const nextPosition: MenuPosition = { left, width, maxHeight, placement, top };
    setPosition((current) => samePosition(current, nextPosition) ? current : nextPosition);
  }, [placeholder, selectOptions, value]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;
    const option = menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    setActiveIndex(initialIndex(selectOptions, value));
  }, [selectOptions, value]);

  useEffect(() => {
    if (disabled && open) closeMenu(false);
  }, [closeMenu, disabled, open]);

  const choose = (option: PlayerSelectOption) => {
    onChange(option.value);
    closeMenu();
  };

  const moveActive = (direction: 1 | -1) => {
    if (!selectOptions.length) return;
    const current = activeIndex < 0 ? (direction === 1 ? -1 : 0) : activeIndex;
    setActiveIndex((current + direction + selectOptions.length) % selectOptions.length);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') {
      if (open) closeMenu(false);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closeMenu();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' && open && selectOptions.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open && selectOptions.length) {
      event.preventDefault();
      setActiveIndex(Math.max(0, selectOptions.length - 1));
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !open) {
      event.preventDefault();
      setActiveIndex(initialIndex(selectOptions, value));
      setOpen(true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open && activeIndex >= 0) {
      event.preventDefault();
      const option = selectOptions[activeIndex];
      if (option) choose(option);
    }
  };

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      id={listboxId}
      className={`player-select-menu ${position?.placement === 'above' ? 'is-above' : 'is-below'}`}
      role="listbox"
      aria-label={ariaLabel ?? placeholder}
      style={position ? {
        left: `${position.left}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
        top: `${position.top}px`,
      } : { visibility: 'hidden', left: '12px', top: '12px', width: `${Math.max(1, Math.min(240, window.innerWidth - 24))}px` }}
    >
      {selectOptions.length ? selectOptions.map((option, index) => <button
        type="button"
        role="option"
        tabIndex={-1}
        id={`${listboxId}-option-${index}`}
        data-option-index={index}
        aria-selected={option.value === value}
        className={`player-select-option ${index === activeIndex ? 'is-active' : ''}`}
        key={option.value}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(option)}
      >
        <span className="player-select-option-label" title={option.label}>{option.label}</span>
        {option.value === value && <Check size={16} aria-hidden="true" />}
      </button>) : <span className="player-select-empty">暂无选项</span>}
    </div>,
    document.body,
  ) : null;

  return <div className={`player-select ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className={`player-select-trigger ${hasSelection ? '' : 'is-placeholder'}`}
      disabled={disabled}
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listboxId : undefined}
      aria-activedescendant={open && activeIndex >= 0 && activeIndex < selectOptions.length ? `${listboxId}-option-${activeIndex}` : undefined}
      onClick={() => { if (open) closeMenu(false); else { setActiveIndex(initialIndex(selectOptions, value)); setOpen(true); } }}
      onKeyDown={onTriggerKeyDown}
    >
      <span className="player-select-value" title={selected?.label}>{selected?.label ?? placeholder}</span>
      <ChevronDown className="player-select-chevron" size={16} aria-hidden="true" />
    </button>
    {menu}
  </div>;
}

function selectedIndex(options: PlayerSelectOption[], value: string) {
  return options.findIndex((option) => option.value === value);
}

function initialIndex(options: PlayerSelectOption[], value: string) {
  const index = selectedIndex(options, value);
  return index >= 0 ? index : options.length ? 0 : -1;
}

function samePosition(current: MenuPosition | null, next: MenuPosition) {
  return current?.left === next.left && current.width === next.width && current.maxHeight === next.maxHeight && current.placement === next.placement && current.top === next.top;
}
