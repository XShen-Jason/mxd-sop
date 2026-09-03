import { describe, expect, it } from 'vitest';
import { ItemCatalog } from '../src/modules/item-catalog/public/index.js';
import { OperationGroupsService } from '../src/modules/operation-groups/public/index.js';
import type { OperationGroup, Identity } from '../src/shared/types.js';
import type { GroupRepository } from '../src/modules/operation-groups/public/index.js';


class MemoryRepository implements GroupRepository {
  groups: OperationGroup[] = [];
  all() { return structuredClone(this.groups); }
  findById(id: string) { const group = this.groups.find((item) => item.id === id); return group ? structuredClone(group) : undefined; }
  insert(group: OperationGroup) { this.groups.push(structuredClone(group)); }
  replace(group: OperationGroup) { this.groups[this.groups.findIndex((item) => item.id === group.id)] = structuredClone(group); }
}

const customer: Identity = { id: 'customer-a', role: 'customer', displayName: '客服 A' };
const manager: Identity = { id: 'manager-b', role: 'manager', displayName: '管理 B' };
const superAdmin: Identity = { id: 'admin-c', role: 'super_admin', displayName: '超级管理' };
const catalog = new ItemCatalog([
  { code: '00000001', name: '金币', itemClass: '道具' },
  { code: '01012190', name: '扎昆面巾', itemClass: 'equip', image: '/item-images/01012190.png' }
]);

function service() {
  let id = 0;
  return new OperationGroupsService({ repository: new MemoryRepository(), catalog, idFactory: () => `group-${++id}`, now: () => new Date('2026-01-01T00:00:00.000Z') });
}

describe('operation-groups lifecycle and projections', () => {
  it('publishes the configured reason presets in default order', () => {
    const options = service().getOptions();
    expect(options.reasons.map((reason) => reason.displayName)).toEqual(['BUG补发', '活动奖励', '补偿', '自己人', '其他']);
    expect(options.actionReasons?.kick.map((reason) => reason.displayName)).toEqual(['尸体', '抢吸', '玩家反馈', '其他']);
    expect(options.actionReasons?.ban[0]).toMatchObject({ code: 'cheating', displayName: '外挂/作弊' });
  });

  it('rejects removed item reason codes', () => {
    const instance = service();
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'player-request' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('stores item name snapshots and never exposes commands to customer', () => {
    const instance = service();
    const group = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 2 }] }, 'key-1');
    expect(group.operations[0]).toMatchObject({ itemCode: '00000001', itemName: '金币', quantity: 2 });
    expect('commands' in group).toBe(false);
    const managerPage = instance.listQueue(manager);
    expect(managerPage.groups[0].commands.map((command) => command.text)).toEqual(['drop@123@00000001@2']);
  });

  it('normalizes equipment levels into command item codes', () => {
    const instance = service();
    const levelOne = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '01012190', quantity: 1 }] });
    const levelTwo = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '124', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '01012190', itemLevel: 2, quantity: 1 }] });
    const levelThree = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '125', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '01012190', itemLevel: 3, quantity: 1 }] });
    expect(levelOne.operations[0]).toMatchObject({ itemCode: '01012190', itemLevel: 1 });
    expect(levelTwo.operations[0]).toMatchObject({ itemCode: '01012190_2', itemLevel: 2 });
    expect(levelThree.operations[0]).toMatchObject({ itemCode: '01012190_3', itemLevel: 3 });
    expect(instance.listQueue(manager, 20).groups.map((group) => group.commands[0].text)).toEqual(expect.arrayContaining(['drop@124@01012190_2@1', 'drop@125@01012190_3@1']));
  });

  it('accepts legacy suffixed equipment codes and rejects invalid levels', () => {
    const instance = service();
    const legacy = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '126', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '01012190_2', quantity: 1 }] });
    expect(legacy.operations[0]).toMatchObject({ itemCode: '01012190_2', itemLevel: 2 });
    for (const itemLevel of [0, 1.5, 11, '2']) {
      expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '127', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '01012190', itemLevel, quantity: 1 }] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
    }
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '128', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', itemLevel: 2, quantity: 1 }] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('allows different equipment levels but still rejects duplicate final codes', () => {
    const instance = service();
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '129', playerQQ: '456', reason: { code: 'compensation' }, operations: [
      { type: 'item', itemCode: '01012190', itemLevel: 2, quantity: 1 },
      { type: 'item', itemCode: '01012190', itemLevel: 3, quantity: 1 }
    ] })).not.toThrow();
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '130', playerQQ: '456', reason: { code: 'compensation' }, operations: [
      { type: 'item', itemCode: '01012190', itemLevel: 2, quantity: 1 },
      { type: 'item', itemCode: '01012190_2', quantity: 1 }
    ] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('rejects duplicate item operations while allowing cash-only requests', () => {
    const instance = service();
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }, { type: 'item', itemCode: '00000001', quantity: 2 }] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
    const cashOnly = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'cash', quantity: 10 }] });
    expect(cashOnly.operations).toEqual([{ type: 'cash', quantity: 10 }]);
  });

  it('enforces owner cancellation and terminal transitions', () => {
    const instance = service();
    const group = instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'player-request' }, operations: [{ type: 'warp' }] });
    expect(() => instance.cancel({ ...customer, id: 'other' }, group.id)).toThrow('forbidden');
    const completed = instance.complete(manager, group.id);
    expect(completed.status).toBe('completed');
    expect(() => instance.complete(manager, group.id)).not.toThrow();
    expect(() => instance.cancel(customer, group.id)).toThrow('invalid-status-transition');
  });

  it('lets submitters modify or cancel regular requests before they are completed', () => {
    const instance = service();
    const regular = instance.submit(customer, { serverId: 'mushroom', characterId: '123', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    expect(regular.status).toBe('approved');

    const updated = instance.update(customer, regular.id, { serverId: 'yeti', characterId: '456', reason: { code: 'player-request' }, operations: [{ type: 'ban' }] });
    expect(updated.status).toBe('pending');
    expect(updated.characterId).toBe('456');

    const cancellable = instance.submit(customer, { serverId: 'mushroom', characterId: '789', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    expect(instance.cancel(customer, cancellable.id).status).toBe('cancelled');
  });

  it('publishes one change notification for every successful write', () => {
    let changes = 0;
    const instance = new OperationGroupsService({ repository: new MemoryRepository(), catalog, onChange: () => { changes += 1; } });
    const group = instance.submit(customer, { serverId: 'mushroom', characterId: '123', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    expect(changes).toBe(1);
    instance.update(customer, group.id, { serverId: 'yeti', characterId: '456', reason: { code: 'player-request' }, operations: [{ type: 'ban' }] });
    expect(changes).toBe(2);
    instance.cancel(customer, group.id);
    expect(changes).toBe(3);
  });

  it('returns both issuance and regular approved groups for the ready queue', () => {
    const instance = service();
    const issuance = instance.submit(customer, { serverId: 'mushroom', account: 'item-player', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] });
    const regular = instance.submit(customer, { serverId: 'mushroom', characterId: '789', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] });
    instance.approve(manager, issuance.id);
    const ready = instance.listArchive(superAdmin, 20, undefined, 'approved');
    expect(ready.groups.map((group) => group.id)).toEqual(expect.arrayContaining([issuance.id, regular.id]));
  });

  it('supports idempotent retries and conflicts', () => {
    const instance = service();
    const input = { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'player-request' }, operations: [{ type: 'ban' as const }] };
    const first = instance.submit(customer, input, 'same-key');
    expect(instance.submit(customer, input, 'same-key').id).toBe(first.id);
    expect(instance.submit(customer, { operations: input.operations, reason: input.reason, playerQQ: input.playerQQ, characterId: input.characterId, account: input.account, serverId: input.serverId }, 'same-key').id).toBe(first.id);
    expect(() => instance.submit(customer, { ...input, account: 'different' }, 'same-key')).toThrow('idempotency-conflict');
  });

  it('does not normalize command-bound identifiers with whitespace', () => {
    const instance = service();
    expect(() => instance.submit(customer, { serverId: 'mushroom', account: 'acc', characterId: ' 123', playerQQ: '456', reason: { code: 'player-request' }, operations: [{ type: 'warp' }] })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('keeps pending and cancelled groups visible in the manager archive', () => {
    const instance = service();
    const pending = instance.submit(customer, { serverId: 'mushroom', account: 'one', characterId: '1', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] });
    const cancelled = instance.submit(customer, { serverId: 'mushroom', account: 'two', characterId: '2', playerQQ: '2', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] });
    instance.cancel(customer, cancelled.id);
    const archive = instance.listArchive(manager, 10);
    expect(archive.groups.map((group) => group.id)).toEqual(expect.arrayContaining([pending.id, cancelled.id]));
    expect(archive.groups.find((group) => group.id === cancelled.id)?.status).toBe('cancelled');
  });

  it('returns bounded pages with an opaque continuation cursor', () => {
    const instance = service();
    instance.submit(customer, { serverId: 'mushroom', account: 'one', characterId: '1', playerQQ: '1', reason: { code: 'player-request' }, operations: [{ type: 'warp' }] });
    instance.submit(customer, { serverId: 'mushroom', account: 'two', characterId: '2', playerQQ: '2', reason: { code: 'player-request' }, operations: [{ type: 'warp' }] });
    const first = instance.listQueue(manager, 1);
    expect(first.groups).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = instance.listQueue(manager, 1, first.nextCursor ?? undefined);
    expect(second.groups).toHaveLength(1);
    expect(second.groups[0].id).not.toBe(first.groups[0].id);
  });

  it('lets both manager roles inspect every review state while own stays isolated', () => {
    const instance = service();
    const own = instance.submit(customer, { serverId: 'mushroom', account: 'one', characterId: '1', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] });
    const other = instance.submit({ ...customer, id: 'customer-b' }, { serverId: 'yeti', account: 'two', characterId: '2', playerQQ: '2', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '00000001', quantity: 1 }] });
    instance.approve(manager, own.id);
    expect(instance.listReview(manager, 20).groups.map((group) => group.id)).toEqual(expect.arrayContaining([own.id, other.id]));
    expect(instance.listReview(superAdmin, 20).groups.map((group) => group.id)).toEqual(expect.arrayContaining([own.id, other.id]));
    expect(instance.listOwn(customer, 20).groups.map((group) => group.id)).toEqual([own.id]);
  });
});
