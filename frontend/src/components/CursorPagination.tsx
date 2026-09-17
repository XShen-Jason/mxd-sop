import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CursorPagination({ page, hasNext, totalCount, disabled, onPrevious, onNext, label = '分页' }: {
  page: number;
  hasNext: boolean;
  totalCount?: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  label?: string;
}) {
  return <nav className="cursor-pagination" aria-label={label}>
    {totalCount !== undefined && <span className="cursor-pagination-total">共 {totalCount} 条</span>}
    <button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={disabled || page === 1} onClick={onPrevious}><ChevronLeft size={18} /></button>
    <span>第 {page} 页</span>
    <button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={disabled || !hasNext} onClick={onNext}><ChevronRight size={18} /></button>
  </nav>;
}
