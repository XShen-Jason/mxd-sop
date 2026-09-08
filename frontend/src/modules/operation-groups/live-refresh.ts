import { useEffect, useRef } from 'react';
import type { GroupStatus } from '../../types';

export const GROUPS_CHANGED_EVENT = 'operation-groups-changed';
type View = 'queue' | 'ready' | 'reissue' | 'archive' | 'records' | 'reminders';
type Scope = { view: View; serverId: string; kind: 'issuance' | 'regular'; status: GroupStatus };
export type GroupChangeEvent = { scopes: Scope[]; counts: boolean; reconnect?: boolean };
type ActiveScope = { view: string; serverId?: string; kind?: 'issuance' | 'regular'; statuses?: string[] };

export function parseGroupChange(data: string): GroupChangeEvent | null {
  try {
    const value = JSON.parse(data) as GroupChangeEvent;
    if (!value || !Array.isArray(value.scopes) || typeof value.counts !== 'boolean') return null;
    if (!value.scopes.every(scope => scope && typeof scope.view === 'string'
      && typeof scope.serverId === 'string' && ['issuance', 'regular'].includes(scope.kind)
      && typeof scope.status === 'string')) return null;
    return { scopes: value.scopes, counts: value.counts };
  } catch { return null; }
}

export function useOperationGroupRefresh(scope: ActiveScope, reload: () => Promise<void>) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    const active = JSON.parse(scopeKey) as ActiveScope;
    if (!['queue', 'ready', 'reissue', 'archive', 'records', 'reminders'].includes(active.view)) return;
    let timer: number | undefined;
    let dirty = false;
    const refresh = () => {
      if (!dirty || document.visibilityState === 'hidden' || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (document.visibilityState === 'hidden') return;
        dirty = false;
        void reloadRef.current();
      }, 50);
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<GroupChangeEvent>).detail;
      if (!detail) return;
      if (!detail.reconnect && !detail.scopes.some(change => change.view === active.view
        && (!active.serverId || change.serverId === active.serverId)
        && (!active.kind || change.kind === active.kind)
        && (!active.statuses || active.statuses.includes(change.status)))) return;
      dirty = true;
      refresh();
    };
    window.addEventListener(GROUPS_CHANGED_EVENT, changed);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener(GROUPS_CHANGED_EVENT, changed);
      document.removeEventListener('visibilitychange', refresh);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [scopeKey]);
}
