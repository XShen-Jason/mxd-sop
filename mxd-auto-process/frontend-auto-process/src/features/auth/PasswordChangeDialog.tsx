import { KeyRound, X } from 'lucide-react';
import { useEffect } from 'react';
import type { OperatorSession } from '../../api/types';
import { PasswordChangeForm } from './PasswordChangeScreen';

export function PasswordChangeDialog({ session, onChanged, onClose }: { session: OperatorSession; onChanged: (value: OperatorSession) => void; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
      <header className="dialog-heading"><div><span className="login-mark warning" aria-hidden="true"><KeyRound size={20} /></span><div><p className="eyebrow">ACCOUNT SECURITY</p><h2 id="password-dialog-title">修改管理员密码</h2></div></div><button type="button" className="icon-button" aria-label="关闭修改密码" onClick={onClose}><X size={17} /></button></header>
      <p className="dialog-copy">账号 {session.user.username} 的新密码会立即生效，请牢记新密码。</p>
      <PasswordChangeForm onChanged={onChanged} onCancel={onClose} />
    </section>
  </div>;
}
