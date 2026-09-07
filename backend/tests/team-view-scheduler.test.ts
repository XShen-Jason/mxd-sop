import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamViewScheduler, TeamViewService, type TeamSnapshot, type TeamViewRepository } from '../src/modules/team-view/public/index.js';

describe('locked team daily synchronization', () => {
  let scheduler: TeamViewScheduler;
  const snapshots = new Map<string, TeamSnapshot>();
  const repository: TeamViewRepository = {
    get: (date) => snapshots.get(date) ?? null,
    save: (snapshot) => { snapshots.set(snapshot.date, snapshot); },
  };
  const fetch = vi.fn(async (_date: string) => [{
    id: 'locked-team', serverId: 'mushroom', bossType: 'zakum' as const,
    members: [{ characterId: '101', joinedAt: '2026-09-07T12:00:00Z' }],
  }]);
  const onError = vi.fn();
  let service: TeamViewService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T00:04:00+08:00'));
    snapshots.clear();
    fetch.mockClear();
    onError.mockClear();
    service = new TeamViewService(repository, { fetch }, [{ id: 'mushroom', displayName: 'Mushroom' }]);
    scheduler = new TeamViewScheduler(service, onError);
  });

  afterEach(async () => { await scheduler.stop(); vi.useRealTimers(); });

  it('fetches September 8 at September 8 00:05 Beijing, then September 9 the next day', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.mock.calls.map(([date]) => date)).toEqual(['2026-09-08']);
    expect(snapshots.get('2026-09-08')?.teams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(fetch.mock.calls.map(([date]) => date)).toEqual(['2026-09-08', '2026-09-09']);
  });

  it('repairs an existing premature empty snapshot when restarted after 00:05', async () => {
    vi.setSystemTime(new Date('2026-09-08T10:00:00+08:00'));
    snapshots.set('2026-09-08', { date: '2026-09-08', fetchedAt: '2026-09-06T16:05:00Z', source: 'mxd-player', teams: [] });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(snapshots.get('2026-09-08')?.teams).toHaveLength(1);
  });

  it('retries a failed fetch after one minute without replacing saved data', async () => {
    await service.sync('2026-09-08');
    const saved = snapshots.get('2026-09-08');
    fetch.mockClear();
    fetch.mockRejectedValueOnce(new Error('player restarting'));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(snapshots.get('2026-09-08')).toBe(saved);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch.mock.calls.map(([date]) => date)).toEqual(['2026-09-08', '2026-09-08']);
    expect(snapshots.get('2026-09-08')).not.toBe(saved);
  });

  it('does not schedule more work after stopping during a fetch', async () => {
    let release!: () => void;
    fetch.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return []; });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    const stopped = scheduler.stop();
    release();
    await stopped;
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults the read API to the current Beijing lock date', () => {
    expect(service.view({ id: 'reader', role: 'customer', displayName: 'Reader' }).date).toBe('2026-09-08');
  });
});
