import { KeyRound } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api } from '../../api/client';
import type { OperatorSession } from '../../api/types';

export function PasswordChangeScreen({ session, onChanged }: { session: OperatorSession; onChanged: (value: OperatorSession) => void }) {
  return <main className="auth-shell">
    <section className="login-card" aria-labelledby="password-title">
      <div className="login-mark warning" aria-hidden="true"><KeyRound size={25} /></div>
      <p className="eyebrow">FIRST SIGN-IN</p>
      <h1 id="password-title">先更新管理员密码</h1>
      <p className="login-copy">账号 {session.user.username} 正在使用初始密码，更新后才能访问服务器数据。</p>
      <PasswordChangeForm onChanged={onChanged} submitLabel="更新并进入控制台" />
    </section>
  </main>;
}

export function PasswordChangeForm({ onChanged, onCancel, submitLabel = '保存新密码' }: { onChanged: (value: OperatorSession) => void; onCancel?: () => void; submitLabel?: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6) return setError('新密码至少需要 6 个字符。');
    if (newPassword !== confirmation) return setError('两次输入的新密码不一致。');
    setSubmitting(true);
    setError('');
    try { onChanged(await api.changePassword(currentPassword, newPassword)); }
    catch { setError('当前密码不正确，或新密码不符合要求。'); }
    finally { setSubmitting(false); }
  }

  return <form onSubmit={submit} className="auth-form">
        <label htmlFor="current-password">当前密码</label>
        <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoFocus />
        <label htmlFor="new-password">新密码</label>
        <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} required />
        <label htmlFor="password-confirmation">确认新密码</label>
        <input id="password-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={6} required />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="password-actions"><button className="primary-button" type="submit" disabled={submitting}>{submitting ? '正在更新…' : submitLabel}</button>{onCancel && <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>取消</button>}</div>
      </form>;
}
