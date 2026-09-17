import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { OperatorSession } from '../../api/types';

export function LoginScreen({ onLogin }: { onLogin: (session: OperatorSession) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onLogin(await api.login(username.trim(), password));
    } catch (reason) {
      setError(loginError(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-shell">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-mark" aria-hidden="true"><ShieldCheck size={25} strokeWidth={1.8} /></div>
      <p className="eyebrow">MXD / SECURE ACCESS</p>
      <h1 id="login-title">自动化控制台</h1>
      <p className="login-copy">登录后查看服务器、账号与游戏请求日志。</p>
      <form onSubmit={submit} className="auth-form">
        <label htmlFor="username">管理员账号</label>
        <input id="username" name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        <label htmlFor="password">密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          <LockKeyhole size={17} aria-hidden="true" />
          {submitting ? '正在验证…' : '安全登录'}
        </button>
      </form>
    </section>
  </main>;
}

function loginError(error: unknown) {
  if (error instanceof ApiError && error.status === 429) return '尝试次数过多，请稍后再试。';
  if (error instanceof ApiError && error.status === 401) return '账号或密码不正确。';
  return '暂时无法连接自动化服务。';
}
