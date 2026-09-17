import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { AuditEntry, Overview } from '../../api/types';

const refreshMilliseconds = 2_000;

export function useOverview(onUnauthorized: () => void) {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState('');

  useEffect(() => pollVisible(
    (signal) => api.overview(signal),
    (value) => { setOverview(value); setError(''); },
    (reason) => handleError(reason, onUnauthorized, setError),
  ), [onUnauthorized]);
  return { overview, error };
}

export function useServerLogs(serverId: string | null, accountId: string | null, onUnauthorized: () => void) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setLogs([]);
    setError('');
    if (!serverId || !accountId) return;
    return pollVisible(
      (signal) => api.logs(serverId, accountId, signal),
      (value) => { setLogs(value.logs); setError(''); },
      (reason) => handleError(reason, onUnauthorized, setError),
    );
  }, [serverId, accountId, onUnauthorized]);
  return { logs, error };
}

function pollVisible<T>(load: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, failure: (reason: unknown) => void) {
  let controller: AbortController | undefined;
  let timer: number | undefined;
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    if (document.visibilityState === 'visible') {
      controller?.abort();
      controller = new AbortController();
      try { success(await load(controller.signal)); }
      catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) failure(reason);
      }
    }
    if (!stopped) timer = window.setTimeout(run, refreshMilliseconds);
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
    if (timer) window.clearTimeout(timer);
  };
}

function handleError(reason: unknown, onUnauthorized: () => void, setError: (value: string) => void) {
  if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
    onUnauthorized();
    return;
  }
  setError('数据刷新失败，正在等待下一次重试。');
}
