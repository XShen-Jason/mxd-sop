import type { GeneratedCommand, Operation } from '../../../shared/types.js';

export interface CommandGenerationInput {
  characterId: string;
  operations: Operation[];
}

export type CommandErrorCode =
  | 'invalid-character-id'
  | 'invalid-operation'
  | 'invalid-quantity'
  | 'unknown-operation-type'
  | 'unsafe-command-field';

export class CommandGenerationError extends Error {
  constructor(public readonly code: CommandErrorCode, message: string = code) {
    super(message);
    this.name = 'CommandGenerationError';
  }
}

function assertSafeField(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\s@]/u.test(value)) {
    throw new CommandGenerationError('unsafe-command-field');
  }
}

function assertQuantity(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CommandGenerationError('invalid-quantity');
  }
}

export const MAX_ITEM_CHUNKS = 10_000;

function assertNoExtraKeys(operation: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(operation).some((key) => !allowed.includes(key))) {
    throw new CommandGenerationError('invalid-operation');
  }
}

export function generateCommands(input: CommandGenerationInput): GeneratedCommand[];
export function generateCommands(characterId: string, operations: Operation[]): GeneratedCommand[];
export function generateCommands(inputOrCharacterId: CommandGenerationInput | string, suppliedOperations?: Operation[]): GeneratedCommand[] {
  const characterId = typeof inputOrCharacterId === 'string' ? inputOrCharacterId : inputOrCharacterId?.characterId;
  const operations = typeof inputOrCharacterId === 'string' ? suppliedOperations : inputOrCharacterId?.operations;
  if (typeof characterId !== 'string' || !/^[0-9]+$/u.test(characterId)) {
    throw new CommandGenerationError('invalid-character-id');
  }
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 100) {
    throw new CommandGenerationError('invalid-operation');
  }

  const commands: GeneratedCommand[] = [];
  for (const [operationIndex, operation] of operations.entries()) {
    if (!operation || typeof operation !== 'object' || typeof operation.type !== 'string') {
      throw new CommandGenerationError('invalid-operation');
    }
    switch (operation.type) {
      case 'item': {
        assertNoExtraKeys(operation as unknown as Record<string, unknown>, ['type', 'itemCode', 'itemLevel', 'itemName', 'itemClass', 'itemImage', 'quantity']);
        assertSafeField(operation.itemCode);
        assertQuantity(operation.quantity);
        if (Math.ceil(operation.quantity / 1000) > MAX_ITEM_CHUNKS) throw new CommandGenerationError('invalid-quantity');
        let remaining = operation.quantity;
        let sequence = 0;
        while (remaining > 0) {
          const chunk = Math.min(1000, remaining);
          commands.push({ operationIndex, sequence, text: `drop@${characterId}@${operation.itemCode}@${chunk}` });
          remaining -= chunk;
          sequence += 1;
        }
        break;
      }
      case 'cash':
        assertNoExtraKeys(operation as unknown as Record<string, unknown>, ['type', 'quantity']);
        assertQuantity(operation.quantity);
        commands.push({ operationIndex, sequence: 0, text: `cashid@${characterId}@${operation.quantity}` });
        break;
      case 'warp':
        assertNoExtraKeys(operation as unknown as Record<string, unknown>, ['type']);
        commands.push({ operationIndex, sequence: 0, text: `herwarp@${characterId}` });
        break;
      case 'kick':
        assertNoExtraKeys(operation as unknown as Record<string, unknown>, ['type']);
        commands.push({ operationIndex, sequence: 0, text: `herwarp@${characterId}` });
        break;
      case 'ban':
        assertNoExtraKeys(operation as unknown as Record<string, unknown>, ['type']);
        commands.push({ operationIndex, sequence: 0, text: `ban@${characterId}` });
        break;
      default:
        throw new CommandGenerationError('unknown-operation-type');
    }
  }
  return commands;
}
