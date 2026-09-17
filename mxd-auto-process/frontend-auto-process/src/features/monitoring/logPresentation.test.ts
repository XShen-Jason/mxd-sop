import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../api/types';
import { logOutcome, logSummary, requestPayload, responsePayload } from './logPresentation';

const base: AuditEntry = {
  id: '1', created_at: '2026-09-16T00:00:00Z', method: 'TCP',
  path: '/game/servers/local', status: 200, duration_ms: 12,
  detail: { operation: 10, outcome: 'success', request: { op: 10 }, responses: [{ rc: 0 }] },
};

describe('request log presentation', () => {
  it('translates game operations into concise Chinese summaries', () => {
    expect(logSummary(base)).toBe('发送游戏消息');
  });

  it('exposes complete captured request and response values', () => {
    expect(requestPayload(base)).toEqual({ op: 10 });
    expect(responsePayload(base)).toEqual([{ rc: 0 }]);
  });

  it('marks an unconfirmed exchange as pending', () => {
    expect(logOutcome({ ...base, status: 202, detail: { ...base.detail, outcome: 'unconfirmed' } })).toEqual({ label: '待确认', tone: 'pending' });
  });
});
