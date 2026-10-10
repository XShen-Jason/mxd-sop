import { useEffect, useState } from 'react';
import { ApiClient, ApiError, SERVER_OPTIONS_CHANGED_EVENT } from '../../api/client';
import type { AppOptions } from '../../types';

/** One visible-page refresh loop for every SOP consumer of the catalog. */
export function useAppOptions(client: ApiClient, userId: string | undefined, workspace: string | null) {
  const [options, setOptions] = useState<AppOptions | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { setOptions(null); setError(''); }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let controller: AbortController | undefined;
    let dirty = false;
    const refresh = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (controller) { dirty = true; return; }
      controller = new AbortController();
      try {
        const next = await client.options(controller.signal);
        if (active) {
          setOptions(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
          setError('');
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : '服务器选项加载失败，请稍后重试');
      } finally {
        controller = undefined;
        if (active && dirty) { dirty = false; void refresh(); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const changed = () => void refresh();
    window.addEventListener(SERVER_OPTIONS_CHANGED_EVENT, changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener(SERVER_OPTIONS_CHANGED_EVENT, changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [client, userId, workspace, retry]);
  return { options, error, retry: () => setRetry(current => current + 1) };
}
