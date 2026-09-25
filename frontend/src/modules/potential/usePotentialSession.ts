import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import type { AutoSession } from '../../types';

interface SavedSession { id: string; serverId: string; createdAt: string; account: string }
const memory = new Map<string, SavedSession>();
function readSaved(key: string): SavedSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as SavedSession | null;
    if (value?.id && value.serverId && value.createdAt) return value;
  } catch { /* Memory fallback also supports navigation when storage is unavailable. */ }
  return memory.get(key) ?? null;
}
function writeSaved(key: string, value: SavedSession | null) {
  if (value) memory.set(key, value); else memory.delete(key);
  try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* Keep runtime reference. */ }
}
export function potentialError(reason: unknown) {
  return reason instanceof Error ? reason.message : '连接失败，请稍后重试';
}

export function usePotentialSession(client: ApiClient, userId: string) {
  const key = `ops-potential-session:${userId}`;
  const [saved, setSaved] = useState(() => readSaved(key));
  const savedRef = useRef(saved);
  const [session, setSession] = useState<AutoSession | null>(null);
  const [checking, setChecking] = useState(Boolean(saved));
  const [connectionError, setConnectionError] = useState('');
  const [revision, setRevision] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const accept = useCallback((next: AutoSession, account?: string) => {
    generation.current++;
    requestRef.current?.abort();
    const value = { id: next.id, serverId: next.server_id, createdAt: next.created_at, account: account ?? savedRef.current?.account ?? '' };
    savedRef.current = value;
    writeSaved(key, value);
    setSaved(value);
    setSession(next);
    setConnectionError('');
    setChecking(false);
  }, [key]);

  const forget = useCallback(() => {
    generation.current++;
    requestRef.current?.abort();
    savedRef.current = null;
    writeSaved(key, null);
    setSaved(null);
    setSession(null);
    setConnectionError('');
    setChecking(false);
  }, [key]);

  useEffect(() => {
    if (!saved) return;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (disposed || controller || document.visibilityState === 'hidden') return;
      window.clearTimeout(timer);
      controller = new AbortController();
      requestRef.current = controller;
      const epoch = generation.current;
      try {
        const next = await client.autoSession(saved.id, controller.signal);
        if (disposed || controller.signal.aborted || epoch !== generation.current) return;
        if (next.created_at !== saved.createdAt || next.server_id !== saved.serverId || next.state === 'closed') {
          forget();
          setConnectionError('原会话已结束或 auto 服务已重启，请重新登录。');
        } else { setSession(next); setConnectionError(''); }
      } catch (reason) {
        if (disposed || controller.signal.aborted || epoch !== generation.current) return;
        if (reason instanceof ApiError && reason.status === 404) forget();
        setConnectionError(potentialError(reason));
      } finally {
        if (!disposed) setChecking(false);
        if (requestRef.current === controller) requestRef.current = null;
        controller = null;
        if (!disposed) timer = window.setTimeout(() => void refresh(), 5_000);
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = readSaved(key);
      // A successful explicit logout in another tab should clear this tab too.
      if (event.newValue === null) { memory.delete(key); forget(); }
      else if (next) { savedRef.current = next; setSaved(next); setSession(null); }
    };
    // Defer the initial read so React's setup/cleanup probe does not issue
    // an extra request that outlives its aborted browser connection.
    timer = window.setTimeout(() => void refresh(), 0);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('storage', storage);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('storage', storage);
      // Component disposal only stops browser reads; the game session stays alive.
    };
  }, [client, saved?.id, saved?.createdAt, revision, forget, key]);

  const logout = async () => {
    if (!savedRef.current) return;
    try { await client.stopAutoSession(savedRef.current.id); }
    catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason; }
    forget();
  };
  return { session, saved, checking, connectionError, accept, logout, refresh: () => setRevision((value) => value + 1) };
}
