import type { GroupStatus, Identity, OperationGroup } from '../../../shared/types.js';
import { isIssuanceGroup } from './workflow-rules.js';

export type GroupChangeState = {
  ownerId: string; serverId: string; kind: 'issuance' | 'regular';
  status: GroupStatus; reminded: boolean;
};
export type GroupChange = { before?: GroupChangeState; after: GroupChangeState };
type Scope = { view: 'queue' | 'ready' | 'reissue' | 'archive' | 'records' | 'reminders'; serverId: string; kind: 'issuance' | 'regular'; status: GroupStatus };

export function groupChangeState(group: OperationGroup): GroupChangeState {
  return { ownerId: group.submittedBy.id, serverId: group.server.id,
    kind: isIssuanceGroup(group) ? 'issuance' : 'regular', status: group.status,
    reminded: (group.reminderCount ?? 0) > 0 };
}

function scopesFor(state: GroupChangeState, identity: Identity): Scope[] {
  const views: Scope['view'][] = [];
  if (identity.role !== 'customer') {
    views.push(state.kind === 'issuance' ? 'reissue' : 'archive');
    if (state.status === 'pending') views.push('queue');
    if (state.status === 'approved' && identity.role === 'super_admin') views.push('ready');
  }
  if (state.ownerId === identity.id) {
    views.push('records');
    if (state.status === 'approved' && state.reminded) views.push('reminders');
  }
  return views.map(view => ({ view, serverId: state.serverId, kind: state.kind, status: state.status }));
}

function countKeys(state: GroupChangeState | undefined, identity: Identity) {
  if (!state) return '';
  return scopesFor(state, identity).flatMap(scope => {
    if (scope.view === 'records' || scope.view === 'reminders') return [`${scope.view}:${scope.kind}`];
    return scope.view === 'queue' || scope.view === 'ready' ? [scope.view] : [];
  }).sort().join(',');
}

// Each subscriber receives only invalidation metadata for data they may read.
export function projectGroupChanges(changes: GroupChange[], identity: Identity) {
  const scopes = new Map<string, Scope>();
  let counts = false;
  for (const change of changes) {
    for (const state of [change.before, change.after]) {
      if (!state) continue;
      for (const scope of scopesFor(state, identity)) scopes.set(JSON.stringify(scope), scope);
    }
    counts ||= countKeys(change.before, identity) !== countKeys(change.after, identity);
  }
  return { scopes: [...scopes.values()], counts };
}
