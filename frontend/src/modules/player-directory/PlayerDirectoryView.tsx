import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ChevronLeft, ChevronRight, ContactRound, FileUp, LoaderCircle, RefreshCw, Search, Upload, X } from 'lucide-react';
import { ApiClient, ApiError } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { AppOptions, DirectoryAccount, Role } from '../../types';

const pageSize = 20;

export function PlayerDirectoryView({ options, role = 'customer', token }: { options: AppOptions; role?: Role; token?: string }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [query, setQuery] = useState('');
  const [serverId, setServerId] = useState('');
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [uploadServerId, setUploadServerId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const canUpload = role === 'super_admin';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setAccounts([]);
    setNextCursor(null);
    setPageCursors([undefined]);
    setPageIndex(0);
    const timer = window.setTimeout(async () => {
      try {
        const result = await client.searchPlayerDirectory(query.trim(), serverId || undefined, controller.signal, undefined, pageSize);
        if (controller.signal.aborted) return;
        setAccounts(result.accounts);
        setNextCursor(result.nextCursor);
        setTotalCount(result.totalCount);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : '无法加载账号目录');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 260);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [client, query, serverId, refreshKey]);

  const changePage = async (direction: -1 | 1) => {
    if (paging) return;
    const targetIndex = pageIndex + direction;
    if (targetIndex < 0 || (direction > 0 && !nextCursor)) return;
    const cursor = direction > 0 ? nextCursor ?? undefined : pageCursors[targetIndex];
    setPaging(true);
    setError('');
    try {
      const result = await client.searchPlayerDirectory(query.trim(), serverId || undefined, undefined, cursor, pageSize);
      setAccounts(result.accounts);
      setNextCursor(result.nextCursor);
      setTotalCount(result.totalCount);
      setPageIndex(targetIndex);
      if (direction > 0) setPageCursors((current) => [...current, cursor]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '无法切换目录分页');
    } finally {
      setPaging(false);
    }
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])].find((entry) => entry.name.toLowerCase().endsWith('.csv')) ?? null;
    setFile(selected);
    event.target.value = '';
  };

  const selectUploadServer = (nextServerId: string) => {
    setUploadServerId(nextServerId);
    setFile(null);
  };

  const upload = async () => {
    if (!uploadServerId || !file || uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      const result = await client.importPlayerDirectory(uploadServerId, { name: file.name, content: await file.text() });
      setFile(null);
      setUploadServerId('');
      setRefreshKey((value) => value + 1);
      setNotice({ kind: 'success', text: `已替换 ${serverName(options, result.serverId)}，导入 ${result.rowCount} 条记录` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : '上传失败，请检查 CSV 文件' });
    } finally {
      setUploading(false);
    }
  };

  return <section className="workspace directory-workspace">
    <div className="page-heading directory-heading"><div><p className="eyebrow">客服工作台</p><h1>玩家列表</h1><p className="heading-copy">按服务器、账号、角色 ID 或绑定 QQ 查询，复制服务器、账户和 QQ 直接发送给玩家。</p></div><div className="heading-stat"><span>匹配账号</span><strong>{totalCount}</strong></div></div>
    {canUpload && <section className="directory-upload-panel"><div><p className="eyebrow">超管工具</p><h2>更新服务器账号数据</h2><p>先选择服务器，再上传对应 CSV；新文件会替换该服务器的旧数据。</p></div><label className="directory-server-picker"><span>服务器</span><select value={uploadServerId} onChange={(event) => selectUploadServer(event.target.value)}><option value="">请选择服务器</option>{options.servers.map((server) => <option key={server.id} value={server.id}>{server.displayName}</option>)}</select></label><label className={`directory-file-picker ${!uploadServerId ? 'disabled' : ''}`}><FileUp size={17} /><span>{file ? file.name : '选择 CSV'}</span><input type="file" accept=".csv,text/csv" disabled={!uploadServerId} onChange={selectFile} /></label>{file && <button type="button" className="icon-button directory-file-remove" title="移除文件" aria-label={`移除 ${file.name}`} onClick={() => setFile(null)}><X size={14} /></button>}<button type="button" className="primary-button" disabled={!uploadServerId || !file || uploading} onClick={() => void upload()}>{uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{uploading ? '替换中…' : '上传并替换'}</button></section>}
    <section className="directory-search-panel"><div className="directory-toolbar"><label className="directory-search-field"><Search size={17} /><span className="visually-hidden">搜索账号目录</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="账户、QQ、角色 ID 或用户 ID" /></label><button type="button" className="icon-button" title="刷新目录" aria-label="刷新目录" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={16} /></button></div><div className="directory-server-filters" role="group" aria-label="按服务器筛选"><button type="button" className={!serverId ? 'selected' : ''} onClick={() => setServerId('')}>全部服务器</button>{options.servers.map((server) => <button type="button" className={serverId === server.id ? 'selected' : ''} key={server.id} onClick={() => setServerId(server.id)}>{server.displayName}</button>)}</div></section>
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={() => setRefreshKey((value) => value + 1)} />}
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /></div> : accounts.length ? <DirectoryTable accounts={accounts} onCopied={() => setNotice({ kind: 'success', text: '已复制完整玩家信息' })} /> : <div className="empty-state"><div className="empty-icon"><ContactRound size={22} /></div><h3>没有找到匹配账号</h3><p>尝试输入账户、绑定 QQ 或角色 ID。</p></div>}
    {!loading && accounts.length > 0 && <nav className="directory-pagination" aria-label="账号目录分页"><button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={pageIndex === 0 || paging} onClick={() => void changePage(-1)}><ChevronLeft size={18} /></button><span>第 {pageIndex + 1} 页 · 共 {totalCount} 个账号</span><button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={!nextCursor || paging} onClick={() => void changePage(1)}><ChevronRight size={18} /></button></nav>}
    {notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}
  </section>;
}

function DirectoryTable({ accounts, onCopied }: { accounts: DirectoryAccount[]; onCopied: () => void }) {
  return <div className="directory-table-wrap"><table className="directory-table"><thead><tr><th>服务器</th><th>用户 ID</th><th>账户</th><th>QQ</th><th>角色 ID</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <DirectoryRow key={`${account.server.id}:${account.userId}:${account.username}:${account.bindQQ}`} account={account} onCopied={onCopied} />)}</tbody></table></div>;
}

function DirectoryRow({ account, onCopied }: { account: DirectoryAccount; onCopied: () => void }) {
  const copyText = `服务器：${account.server.displayName}\n账户：${account.username}\nQQ：${account.bindQQ}`;
  return <tr><td data-label="服务器">{account.server.displayName}</td><td data-label="用户 ID" className="directory-mono">{account.userId}</td><td data-label="账户" className="directory-account">{account.username}</td><td data-label="QQ" className="directory-mono">{account.bindQQ}</td><td data-label="角色 ID" className="directory-character-ids">{account.characterIds.join('、')}</td><td data-label="操作"><CopyButton text={copyText} label="复制服务器、账户和 QQ" onCopied={onCopied} /></td></tr>;
}

function serverName(options: AppOptions, serverId: string) {
  return options.servers.find((server) => server.id === serverId)?.displayName ?? serverId;
}
