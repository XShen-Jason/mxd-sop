import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ItemCatalog } from '../src/modules/item-catalog/public/index.js';
import { buildPotentialCommand, loadPool } from '../src/modules/potential/pool.js';
import { parseResponse } from '../src/modules/potential/parser.js';

const pool = loadPool(path.resolve('../data/tbl_potential_pool.csv'));
const catalog = new ItemCatalog([{ code: '01102041', name: '测试装备', image: '/test.png' }]);
const text = '可洗练装备(实例ID / 模板ID):\n681604 / 01102041\n    1槽 力量 +5 (D)\n    2槽 移速 +0.15 (C)\n    3槽 力量 +15 (B)\n681605 / 01472244\n    1槽 智力 +5 (D)\n681606 / 01082149\n    1槽 回避 +10 (C)\n    2槽 敏捷 +15 (B)\n558106 / 01302120  [无潜能]';

describe('potential equipment and complete replacement commands', () => {
  it('parses the supplied list, keeps empty equipment and exact template IDs', () => {
    const result = parseResponse(text, catalog, pool);
    expect(result).toHaveLength(4);
    expect(result.map((item) => item.potentials.length)).toEqual([3, 1, 2, 0]);
    expect(result[0]).toMatchObject({ instanceId: '681604', templateId: '01102041', name: '测试装备', image: '/test.png' });
    expect(result[0].potentials[1]).toMatchObject({ slot: 2, statType: 'move', value: '0.15' });
    expect(result[3].instanceId).toBe('558106');
  });
  it('ignores heartbeat events and accepts raw System-event fixtures', () => {
    const result = parseResponse(JSON.stringify([
      { ev: 18, p: [], t: 'evt' },
      { ev: 20, p: [[36, text], [65, 'System']], t: 'evt' },
    ]), catalog, pool);
    expect(result).toEqual(parseResponse(text, catalog, pool));
  });
  it('maps percentage and fashion stats by pool metadata', () => {
    const result = parseResponse('可洗练装备:\n1 / 01102041\n1槽 装备攻击力 +7% (A)\n2槽 时装攻击力 +4% (C)', catalog, pool);
    expect(result[0].potentials.map(({ statType, value }) => [statType, value])).toEqual([['equipatk', '0.07'], ['fashionatk', '0.04']]);
  });
  it('does not treat an unconfirmed list response as an empty inventory', () => {
    expect(() => parseResponse(undefined, catalog, pool)).toThrow();
    expect(() => parseResponse('potential@list', catalog, pool)).toThrow();
  });
  it('adds one, two or three potentials to an empty equipment instance', () => {
    const values = [{ stat_type: 'equipatk', value: '0.07' }, { stat_type: 'equipluk', value: '0.06' }, { stat_type: 'fashionatk', value: '0.04' }];
    expect(buildPotentialCommand('558106', values.slice(0, 1), pool)).toBe('potentialset@558106@equipatk:0.07');
    expect(buildPotentialCommand('558106', values.slice(0, 2), pool)).toBe('potentialset@558106@equipatk:0.07,equipluk:0.06');
    expect(buildPotentialCommand('558106', values, pool)).toBe('potentialset@558106@equipatk:0.07,equipluk:0.06,fashionatk:0.04');
  });
  it('retains other slots in their original order when one slot changes', () => {
    const item = parseResponse(text, catalog, pool)[0];
    const values = item.potentials.map((entry) => ({ stat_type: entry.statType, value: entry.value }));
    values[0] = { stat_type: 'int', value: '5' };
    expect(buildPotentialCommand(item.instanceId, values, pool)).toBe('potentialset@681604@int:5,move:0.15,str:15');
  });
  it('rejects more than three slots, unknown values and command injection', () => {
    const value = { stat_type: 'str', value: '5' };
    expect(() => buildPotentialCommand('1', [value, value, value, value], pool)).toThrow();
    expect(() => buildPotentialCommand('1@other', [value], pool)).toThrow();
    expect(() => buildPotentialCommand('1', [{ stat_type: 'str', value: '999' }], pool)).toThrow();
    expect(() => buildPotentialCommand('1', [], pool)).toThrow();
  });
});
