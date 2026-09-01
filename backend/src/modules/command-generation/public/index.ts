export { CommandGenerationError, generateCommands, MAX_ITEM_CHUNKS } from '../domain/generate.js';
export type { CommandErrorCode, CommandGenerationInput } from '../domain/generate.js';
import { generateCommands } from '../domain/generate.js';
import type { CommandGenerationInput } from '../domain/generate.js';
import type { Operation } from '../../../shared/types.js';

export function generate(input: CommandGenerationInput): { commands: ReturnType<typeof generateCommands> };
export function generate(characterId: string, operations: Operation[]): { commands: ReturnType<typeof generateCommands> };
export function generate(inputOrCharacterId: CommandGenerationInput | string, operations?: Operation[]) {
  return { commands: typeof inputOrCharacterId === 'string' ? generateCommands(inputOrCharacterId, operations ?? []) : generateCommands(inputOrCharacterId) };
}
