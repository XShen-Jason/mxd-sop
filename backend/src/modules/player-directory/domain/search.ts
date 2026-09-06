import type { DirectoryRow } from './types.js';

export function groupRows(rows: DirectoryRow[]) {
  const groups = new Map<string, DirectoryRow[]>();
  for (const row of rows) {
    const key = `${row.serverId}\u0000${row.userId}\u0000${row.username}\u0000${row.bindQQ}`;
    const entries = groups.get(key) ?? [];
    entries.push(row);
    groups.set(key, entries);
  }
  return [...groups.values()].map((entries) => ({
    serverId: entries[0].serverId,
    userId: entries[0].userId,
    username: entries[0].username,
    bindQQ: entries[0].bindQQ,
    characterIds: [...new Set(entries.map((entry) => entry.charId))].sort(compareIds),
    sourceFiles: [...new Set(entries.map((entry) => entry.sourceFile))].sort()
  })).sort(compareAccounts);
}

function compareAccounts(left: { userId: string; serverId: string; username: string; bindQQ: string }, right: { userId: string; serverId: string; username: string; bindQQ: string }) {
  const userIdOrder = compareIds(left.userId, right.userId);
  if (userIdOrder !== 0) return userIdOrder;
  const serverOrder = left.serverId.localeCompare(right.serverId);
  if (serverOrder !== 0) return serverOrder;
  const usernameOrder = left.username.localeCompare(right.username);
  if (usernameOrder !== 0) return usernameOrder;
  return left.bindQQ.localeCompare(right.bindQQ);
}

function compareIds(left: string, right: string) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (leftNumeric && left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}
