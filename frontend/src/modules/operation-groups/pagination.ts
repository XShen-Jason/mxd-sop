/** Shared pagination helpers keep cursor state and status expansion consistent across role views. */
export function expandCompletedStatuses(statuses: string[]) {
  return statuses.flatMap((status) => status === 'completed' ? ['issued', 'completed'] : [status]);
}

export function appendUniqueById<T extends { id: string }>(current: T[], next: T[]) {
  const seen = new Set(current.map((item) => item.id));
  const unique = next.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [...current, ...unique];
}
