import { describe, expect, it } from 'vitest';
import { ItemCatalog } from '../src/modules/item-catalog/public/index.js';
import { OperationGroupsService, type GroupRepository } from '../src/modules/operation-groups/public/index.js';
import { projectGroupChanges, type GroupChange } from '../src/modules/operation-groups/domain/changes.js';
import type { Identity, OperationGroup, SubmitGroupInput } from '../src/shared/types.js';

const owner: Identity = { id: 'owner', role: 'customer', displayName: 'Owner' };
const admin: Identity = { id: 'admin', role: 'super_admin', displayName: 'Admin' };
const input: SubmitGroupInput = { serverId: 'mushroom', account: 'account', playerQQ: '123', characterId: '123',
  reason: { code: 'compensation' }, operations: [{ type: 'cash', quantity: 1 }] };

function setup() {
  const saved = new Map<string, OperationGroup>();
  const repository: GroupRepository = {
    all: () => structuredClone([...saved.values()]),
    findById: id => saved.has(id) ? structuredClone(saved.get(id)) : undefined,
    insert: group => { saved.set(group.id, structuredClone(group)); },
    replace: group => { saved.set(group.id, structuredClone(group)); },
    insertMany: groups => { for (const group of groups) saved.set(group.id, structuredClone(group)); },
  };
  const service = new OperationGroupsService({ repository, catalog: new ItemCatalog([]) });
  const events: GroupChange[][] = [];
  service.subscribe(changes => events.push(changes));
  return { service, events, event: (identity = admin) => projectGroupChanges(events.at(-1)!, identity) };
}
const views = (event: ReturnType<typeof projectGroupChanges>) => [...new Set(event.scopes.map(scope => scope.view))].sort();

describe('scoped operation-group notifications', () => {
  it('routes submit, approve, remind, repeat and issue to their affected lists', () => {
    const { service, event, events } = setup();
    const group = service.submit(owner, input);
    expect(views(event())).toEqual(['queue', 'reissue']);
    expect(event().counts).toBe(true);
    expect(views(event(owner))).toEqual(['records']);
    expect(event({ ...owner, id: 'another-customer' })).toEqual({ scopes: [], counts: false });
    service.approve(admin, group.id);
    expect(views(event())).toEqual(['queue', 'ready', 'reissue']);
    expect(views(event({ ...admin, role: 'manager' }))).toEqual(['queue', 'reissue']);
    service.remind(admin, group.id);
    expect(views(event())).toEqual(['ready', 'reissue']);
    expect(event().counts).toBe(false);
    expect(views(event(owner))).toEqual(['records', 'reminders']);
    expect(event(owner).counts).toBe(true);
    service.remind(admin, group.id);
    expect(event(owner).counts).toBe(false);
    service.issue(admin, group.id);
    expect(views(event())).toEqual(['ready', 'reissue']);
    expect(event(owner).scopes).toContainEqual({ view: 'reminders', serverId: 'mushroom', kind: 'issuance', status: 'approved' });
    const count = events.length;
    service.issue(admin, group.id);
    expect(events).toHaveLength(count);
    expect(() => service.remind(admin, group.id)).toThrow();
    expect(events).toHaveLength(count);
    expect(JSON.stringify(event())).not.toMatch(/ownerId|characterId|commands|account/);
  });

  it('includes old and new memberships when editing server, kind and reminded state', () => {
    const { service, event } = setup();
    const group = service.submit(owner, input);
    service.approve(admin, group.id);
    service.remind(admin, group.id);
    service.update(owner, group.id, { serverId: 'yeti', characterId: '123', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    expect(event().scopes).toContainEqual({ view: 'ready', serverId: 'mushroom', kind: 'issuance', status: 'approved' });
    expect(event().scopes).toContainEqual({ view: 'queue', serverId: 'yeti', kind: 'regular', status: 'pending' });
    expect(views(event(owner))).toEqual(['records', 'reminders']);
    service.cancel(owner, group.id);
    expect(views(event())).toEqual(['archive', 'queue']);
  });

  it('routes regular completion and rejected requests without touching ready unnecessarily', () => {
    const { service, event } = setup();
    const regular = service.submit(owner, { serverId: 'mushroom', characterId: '123', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    expect(views(event())).toEqual(['archive', 'ready']);
    service.complete(admin, regular.id);
    expect(views(event())).toEqual(['archive', 'ready']);
    const issuance = service.submit(owner, input);
    service.reject(admin, issuance.id);
    expect(views(event())).toEqual(['queue', 'reissue']);
  });

  it('coalesces approved batches and emits nothing when replayed', () => {
    const { service, event, events } = setup();
    const entries = ['first', 'second'].map(key => ({ key, input }));
    service.submitApprovedBatch(admin, entries);
    expect(events).toHaveLength(1);
    expect(event().scopes).toHaveLength(3);
    expect(views(event())).toEqual(['ready', 'records', 'reissue']);
    expect(service.submitApprovedBatch(admin, entries)).toEqual({ count: 0, skippedCount: 2 });
    expect(events).toHaveLength(1);
  });

  it('clears only the owner reminder, preserves approval and supports another reminder cycle', () => {
    const { service, event, events } = setup();
    const group = service.submit(owner, input);
    expect(() => service.markOnline(owner, group.id)).toThrowError(expect.objectContaining({ code: 'invalid-status-transition' }));
    service.approve(admin, group.id);
    service.remind(admin, group.id);
    expect(() => service.markOnline(admin, group.id)).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    expect(() => service.markOnline({ ...owner, id: 'other' }, group.id)).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    const cleared = service.markOnline(owner, group.id);
    expect(cleared).toMatchObject({ status: 'approved', approvedBy: { id: admin.id }, operations: group.operations });
    for (const field of ['reminderCount', 'lastRemindedAt', 'lastRemindedBy', 'commands']) expect(cleared).not.toHaveProperty(field);
    expect(service.listReminders(owner).groups).toEqual([]);
    expect(service.workspaceCounts(owner).reminders).toBe(0);
    expect(views(event())).toEqual(['ready', 'reissue']);
    expect(event().counts).toBe(false);
    expect(views(event(owner))).toEqual(['records', 'reminders']);
    expect(event(owner).counts).toBe(true);
    const count = events.length;
    service.markOnline(owner, group.id);
    expect(events).toHaveLength(count);
    expect(service.remind(admin, group.id).reminderCount).toBe(1);
    expect(service.listReminders(owner).groups).toHaveLength(1);
    service.issue(admin, group.id);
    expect(() => service.markOnline(owner, group.id)).toThrowError(expect.objectContaining({ code: 'invalid-status-transition' }));
  });
});
