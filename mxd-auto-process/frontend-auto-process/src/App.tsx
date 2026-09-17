import { useEffect, useState } from 'react';
import { api, ApiError } from './api/client';
import type { OperatorSession } from './api/types';
import { LoginScreen } from './features/auth/LoginScreen';
import { PasswordChangeScreen } from './features/auth/PasswordChangeScreen';
import { Dashboard } from './features/monitoring/Dashboard';

type AuthState =
  | { status: 'checking' }
  | { status: 'guest' }
  | { status: 'authenticated'; session: OperatorSession };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    api.me(controller.signal)
      .then((session) => setAuth({ status: 'authenticated', session }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setAuth({ status: 'guest' });
      });
    return () => controller.abort();
  }, []);

  if (auth.status === 'checking') return <div className="auth-shell" aria-label="正在检查登录状态"><span className="status-loader" /></div>;
  if (auth.status === 'guest') return <LoginScreen onLogin={(session) => setAuth({ status: 'authenticated', session })} />;
  if (auth.session.must_change) {
    return <PasswordChangeScreen session={auth.session} onChanged={(session) => setAuth({ status: 'authenticated', session })} />;
  }
  return <Dashboard session={auth.session} onSessionChanged={(session) => setAuth({ status: 'authenticated', session })} onUnauthorized={() => setAuth({ status: 'guest' })} onLogout={async () => {
    try { await api.logout(); } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    setAuth({ status: 'guest' });
  }} />;
}
