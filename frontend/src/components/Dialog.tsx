import { AlertTriangle, Check, KeyRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

type ConfirmDialogProps = { title: string; description: string; confirmLabel?: string; busy?: boolean; danger?: boolean; onCancel: () => void; onConfirm: () => void };

export function ConfirmDialog({ title, description, confirmLabel = '确认', busy = false, danger = false, onCancel, onConfirm }: ConfirmDialogProps) {
  useDialogEscape(onCancel, busy);
  return <div className="dialog-backdrop" role="presentation"><div className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><div className="dialog-header"><div className={`dialog-icon ${danger ? 'danger' : ''}`}><AlertTriangle size={19} /></div><button type="button" className="icon-button" aria-label="关闭" onClick={onCancel} disabled={busy}><X size={18} /></button></div><h2 id="confirm-dialog-title">{title}</h2><p className="dialog-description">{description}</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button><button type="button" className={`primary-button ${danger ? 'danger-primary' : ''}`} onClick={onConfirm} disabled={busy}>{busy ? '处理中…' : confirmLabel}<Check size={16} /></button></div></div></div>;
}

type TextPromptDialogProps = { title: string; description?: string; label: string; placeholder?: string; submitLabel?: string; inputType?: 'text' | 'password'; minLength?: number; busy?: boolean; onCancel: () => void; onSubmit: (value: string) => void };

export function TextPromptDialog({ title, description, label, placeholder, submitLabel = '确认', inputType = 'password', minLength = 0, busy = false, onCancel, onSubmit }: TextPromptDialogProps) {
  const [value, setValue] = useState('');
  useDialogEscape(onCancel, busy);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(value.trim()); };
  return <div className="dialog-backdrop" role="presentation"><div className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-dialog-title"><div className="dialog-header"><div className="dialog-icon"><KeyRound size={19} /></div><button type="button" className="icon-button" aria-label="关闭" onClick={onCancel} disabled={busy}><X size={18} /></button></div><h2 id="prompt-dialog-title">{title}</h2>{description && <p className="dialog-description">{description}</p>}<form onSubmit={submit}><label className="dialog-prompt-field"><span>{label}</span><input autoFocus type={inputType} minLength={minLength || undefined} value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy || value.length < minLength}>{busy ? '处理中…' : submitLabel}<Check size={16} /></button></div></form></div></div>;
}

function useDialogEscape(onCancel: () => void, disabled: boolean) {
  useEffect(() => { if (disabled) return; const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [onCancel, disabled]);
}
