import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CatalogPager({ page, hasNext, totalCount, totalPages, disabled, onPrevious, onNext }: {
  page: number;
  hasNext: boolean;
  totalCount: number;
  totalPages: number;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return <nav className="activity-catalog-pager" aria-label="道具目录分页">
    <span className="activity-catalog-total">共 {totalCount} 条 · 共 {totalPages} 页</span>
    <button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={disabled || page === 1} onClick={onPrevious}><ChevronLeft size={17} /></button>
    <span>第 {page} 页</span>
    <button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={disabled || !hasNext} onClick={onNext}><ChevronRight size={17} /></button>
  </nav>;
}
