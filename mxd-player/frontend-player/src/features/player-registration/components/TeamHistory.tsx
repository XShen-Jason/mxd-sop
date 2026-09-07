import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getTeamHistory } from '../api/client';
import type { TeamHistory as HistoryData } from '../api/types';
import { bossName } from '../config/player-config';
import './team-history.css';

function adjacentDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function TeamHistory({ token }: { token: string }) {
  const [date, setDate] = useState('');
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void getTeamHistory(token, date, controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [token, date, attempt]);

  const selectedDay = date || data?.day || '';
  const isToday = selectedDay === data?.today;
  return (
    <section className="team-history" aria-labelledby="team-history-title">
      <div className="team-history-heading">
        <h2 id="team-history-title">我的队伍历史</h2>
        <span>北京时间 · 已锁定名单</span>
      </div>
      <div className="team-history-toolbar">
        <button type="button" title="前一天" aria-label="前一天" disabled={!selectedDay || selectedDay <= '1970-01-02' || loading} onClick={() => setDate(adjacentDay(selectedDay, -1))}><ChevronLeft size={18} /></button>
        <input aria-label="开战日期" type="date" min="1970-01-02" max={data?.today} value={selectedDay} disabled={!data || loading} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
        <button type="button" title="后一天" aria-label="后一天" disabled={!selectedDay || !data || selectedDay >= data.today || loading} onClick={() => setDate(adjacentDay(selectedDay, 1))}><ChevronRight size={18} /></button>
        <button type="button" className="history-today" disabled={loading} onClick={() => { setDate(''); setAttempt((value) => value + 1); }}>今天</button>
      </div>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <p className="history-state">正在加载队伍…</p> : error ? (
          <div className="history-state">队伍加载失败<button type="button" title="重试" aria-label="重试" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={18} /></button></div>
        ) : data && <>
          <p className="history-date">{isToday ? '今日' : '历史'}队伍 · {data.day}</p>
          {data.teams.length ? data.teams.map((team) => (
            <article className="history-roster" key={team.bossType}>
              <h3>{bossName(team.bossType)}<small>{team.members.length} 人</small></h3>
              <ul>{team.members.map((member) => <li key={member.characterId}><span>{member.characterId}</span>{member.isLeader && <small>队长</small>}</li>)}</ul>
            </article>
          )) : <p className="history-state">{isToday ? '今天' : '当天'}没有已锁定的队伍</p>}
        </>}
      </div>
    </section>
  );
}
