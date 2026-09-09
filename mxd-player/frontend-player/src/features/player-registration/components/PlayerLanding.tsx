import { ArrowRight, Shield, Sparkles, Zap } from 'lucide-react';
import type { FormEvent } from 'react';
import { PlayerSelect } from './PlayerSelect';

type LandingProps = {
  servers: string[];
  loadingServers: boolean;
  server: string;
  setServer: (value: string) => void;
  qq: string;
  setQq: (value: string) => void;
  gameAccount: string;
  setGameAccount: (value: string) => void;
  onVerify: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  message: string;
  onRetryServers: () => void;
};

export function SessionLoading() {
  return (
    <div className="landing">
      <main className="login-main" aria-busy="true">
        <div className="intro">
          <p className="kicker">PLAYER ACCESS</p>
          <h1>正在恢复<span className="gradient-text">登录</span></h1>
          <p>正在验证当前会话，请稍候。</p>
        </div>
      </main>
    </div>
  );
}

export function Logo() {
  return <div className="logo"><span className="logo-orb"><Sparkles size={18} /></span>远征<span className="accent">大厅</span></div>;
}

export function Landing(p: LandingProps) {
  const options = p.servers.map((value) => ({ value, label: value }));
  return (
    <div className="landing">
      <header className="topbar"><Logo /><span className="top-note">PLAYER ACCESS</span></header>
      <main className="login-main">
        <div className="intro">
          <p className="kicker">MAPLE WORLD · PARTY FINDER</p>
          <h1>一起<span className="gradient-text">组队</span></h1>
          <p>验证账号后，创建或申请加入黑龙、进阶扎昆队伍。</p>
          <div className="raid-pills"><span><Shield size={14} /> 黑龙</span><span><Zap size={14} /> 进阶扎昆</span></div>
        </div>
        <form className="verify-card" onSubmit={p.onVerify}>
          <div className="card-top"><div className="card-icon"><Sparkles size={16} aria-hidden="true" /></div><h2>玩家验证</h2></div>
          <label>服务器
            <PlayerSelect value={p.server} options={options} placeholder={p.loadingServers ? '正在加载服务器…' : '选择服务器'} onChange={p.setServer} disabled={p.loadingServers} aria-label="服务器" />
          </label>
          <label>QQ<input value={p.qq} onChange={(event) => p.setQq(event.target.value)} inputMode="numeric" disabled={p.loadingServers || !p.server} /></label>
          <label>游戏账号<input value={p.gameAccount} onChange={(event) => p.setGameAccount(event.target.value)} disabled={p.loadingServers || !p.server} /></label>
          {p.message && <div className="form-error" role="alert">{p.message}</div>}
          <button className="primary" disabled={p.busy || p.loadingServers || !p.server}>{p.busy ? '验证中…' : '进入'}<ArrowRight size={16} /></button>
          {!p.loadingServers && !p.servers.length && <button type="button" className="secondary" onClick={p.onRetryServers}>重新加载服务器列表</button>}
        </form>
      </main>
    </div>
  );
}
