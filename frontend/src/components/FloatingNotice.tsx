import { useEffect, useRef } from 'react';
import { AlertCircle, Check, RefreshCw } from 'lucide-react';

type FloatingNoticeProps = {
  kind: 'success' | 'error';
  text: string;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
};

export function FloatingNotice({ kind, text, onDismiss, actionLabel, onAction, duration = 3200 }: FloatingNoticeProps) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, text]);

  return <div className="notice-stack" aria-live={kind === 'error' ? 'assertive' : 'polite'}>
    <div className={`notice toast ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      <span>{text}</span>
      {actionLabel && onAction && <button type="button" className="notice-action" onClick={onAction} title={actionLabel}><RefreshCw size={14} />{actionLabel}</button>}
    </div>
  </div>;
}
