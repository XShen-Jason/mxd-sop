import { describe, expect, it } from 'vitest';
import { CommandGenerationError, generate, generateCommands } from '../src/modules/command-generation/public/index.js';

describe('command-generation.generate', () => {
  it('splits item quantities at 1000 and preserves operation order', () => {
    const result = generateCommands('123456', [
      { type: 'item', itemCode: '02000000', itemName: '金币', quantity: 2888 },
      { type: 'cash', quantity: 500 },
      { type: 'warp' },
      { type: 'kick' },
      { type: 'ban' }
    ]);
    expect(result.map((command) => command.text)).toEqual([
      'drop@123456@02000000@1000',
      'drop@123456@02000000@1000',
      'drop@123456@02000000@888',
      'cashid@123456@500',
      'herwarp@123456',
      'herwarp@123456',
      'ban@123456'
    ]);
    expect(result[0]).toMatchObject({ operationIndex: 0, sequence: 0 });
    expect(result[2]).toMatchObject({ operationIndex: 0, sequence: 2 });
  });

  it('accepts item image snapshots without changing generated commands', () => {
    const result = generateCommands('7', [{ type: 'item', itemCode: '02000000', itemName: 'Potion', itemImage: '/item-images/02000000.png', quantity: 1 }]);
    expect(result[0].text).toBe('drop@7@02000000@1');
  });

  it('accepts the contract object form as well as positional arguments', () => {
    expect(generateCommands({ characterId: '7', operations: [{ type: 'cash', quantity: 1 }] })[0].text).toBe('cashid@7@1');
    expect(generate({ characterId: '7', operations: [{ type: 'cash', quantity: 1 }] }).commands[0].text).toBe('cashid@7@1');
  });

  it('keeps one generated command per submitted item operation', () => {
    const operations = Array.from({ length: 20 }, (_, index) => ({
      type: 'item' as const,
      itemCode: `020000${String(index).padStart(2, '0')}`,
      itemName: `Test item ${index}`,
      quantity: 1,
    }));
    const commands = generateCommands('7', operations);
    expect(commands).toHaveLength(20);
    expect(commands.map((command) => command.text)).toEqual(
      operations.map((operation) => `drop@7@${operation.itemCode}@1`),
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s', (quantity) => {
    expect(() => generateCommands('1', [{ type: 'cash', quantity }])).toThrowError(CommandGenerationError);
  });

  it('rejects unsafe command fields without partial output', () => {
    expect(() => generateCommands('12 3', [{ type: 'warp' }])).toThrowError('invalid-character-id');
    expect(() => generateCommands('123', [{ type: 'item', itemCode: '02@bad', itemName: 'x', quantity: 1 }])).toThrowError('unsafe-command-field');
  });
});
