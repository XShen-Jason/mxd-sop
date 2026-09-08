import { FileUp, LoaderCircle, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { ServerOption, TeamClearImportResult } from '../../types';

export function TeamClearUpload({ client, servers, onImported }: {
  client: ApiClient; servers: ServerOption[]; onImported: (result: TeamClearImportResult) => void;
}) {
  const [serverId, setServerId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function upload() {
    if (!serverId || !file || uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('CSV 文件不能超过 2 MiB');
      const result = await client.importTeamClears(serverId, { name: file.name, content: await file.text() });
      setFile(null);
      onImported(result);
      setNotice({ kind: 'success', text: `已导入 ${result.rowCount} 条通关记录，${result.dates.length} 个日期${result.skippedRows ? `，跳过 ${result.skippedRows} 条其他记录` : ''}` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof ApiError || error instanceof Error ? error.message : '通关列表上传失败' });
    } finally { setUploading(false); }
  }

  return <>
    <div className="team-clear-upload" aria-label="上传通关列表">
      <label className="directory-server-picker">
        <select aria-label="通关服务器" value={serverId} disabled={uploading} onChange={event => { setServerId(event.target.value); setFile(null); }}>
          <option value="">请选择服务器</option>{servers.map(server => <option key={server.id} value={server.id}>{server.displayName}</option>)}
        </select>
      </label>
      <label className={`directory-file-picker ${!serverId || uploading ? 'disabled' : ''}`}>
        <FileUp size={17} /><span>{file?.name ?? '选择 CSV'}</span>
        <input aria-label="通关 CSV" type="file" accept=".csv,text/csv" disabled={!serverId || uploading} onChange={event => {
          setFile(event.target.files?.[0] ?? null); event.target.value = '';
        }} />
      </label>
      {file && <button type="button" className="icon-button" title="移除文件" aria-label="移除文件" disabled={uploading} onClick={() => setFile(null)}><X size={16} /></button>}
      <button type="button" className="primary-button" disabled={!serverId || !file || uploading} onClick={() => void upload()}>
        {uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{uploading ? '上传中…' : '上传通关列表'}
      </button>
    </div>
    {notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}
  </>;
}
