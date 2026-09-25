import { RotateCcw } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import './quick-commands.css';
import type { ServerRecord } from '../../api/types';

type Setting = 'spawn_rate' | 'exp_rate' | 'exp_max' | 'drop_rate' | 'meso_rate' | 'domain_times';
type Command = { id: string; label: string; fields: ReadonlyArray<readonly [Setting, string]> };

const commands: Command[] = [
  { id: 'spawnrate', label: '怪物数量', fields: [['spawn_rate', '怪物数量倍率']] },
  { id: 'exp', label: '经验倍率', fields: [['exp_rate', '经验倍率'], ['exp_max', '持续分钟数']] },
  { id: 'droprate', label: '爆率/掉落', fields: [['drop_rate', '掉落倍率']] },
  { id: 'mesorate', label: '金币倍率', fields: [['meso_rate', '金币倍率']] },
  { id: 'domaintimes', label: '副本次数', fields: [['domain_times', '副本次数']] },
];

type Props = {
  server: ServerRecord;
  sending: boolean;
  disabled: boolean;
  onSend: (message: string) => void;
};

export function QuickCommandPanel({ server, sending, disabled, onSend }: Props) {
  return <section className="management-quick-command-panel" aria-label="快捷指令参数">
    <div className="management-quick-command-heading">
      <strong>当前服务器配置</strong>
      <span>修改下方参数后逐项发送；自动刷新不会覆盖输入。</span>
    </div>
    <div className="management-quick-command-grid">
      {commands.map((command) => <QuickCommandRow key={`${server.id}:${command.id}`} command={command} server={server} sending={sending} disabled={disabled} onSend={onSend} />)}
    </div>
  </section>;
}

function QuickCommandRow({ command, server, sending, disabled, onSend }: Props & { command: Command }) {
  const id = useId();
  const [draft, setDraft] = useState(() => command.fields.map(([key]) => referenceInput(server[key])));
  const [error, setError] = useState('');
  const values = draft.map((value) => Number(value));
  const valid = draft.every((value, index) => value.trim() !== '' && Number.isSafeInteger(values[index]) && values[index] > 0);
  const preview = `${command.id}@${draft.map((value) => value.trim() || '…').join('@')}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) { setError('请输入大于 0 的整数'); return; }
    if (disabled) return;
    setError('');
    onSend(`${command.id}@${values.join('@')}`);
  };
  const reset = () => {
    setDraft(command.fields.map(([key]) => referenceInput(server[key])));
    setError('');
  };

  return <form className="management-quick-command-row" aria-label={`${command.label}快捷指令`} onSubmit={submit} noValidate>
    <div className="management-quick-command-summary">
      <strong>{command.label}</strong>
      <span className="management-quick-command-reference">{command.fields.map(([key]) => `${referenceInput(server[key]) || '未配置'} ${fieldUnit(key)}`).join(' · ')}</span>
    </div>
    <div className="management-quick-command-controls">
      <div className="management-quick-command-inputs">
        {command.fields.map(([key, label], index) => <label key={key} htmlFor={`${id}-${key}`} className={key === 'exp_max' ? 'duration-field' : undefined}>
          <input id={`${id}-${key}`} aria-label={label} title={label} type="number" inputMode="numeric" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft[index]} disabled={sending}
            aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error) && !valid}
            onChange={(event) => { const value = event.target.value; setDraft((current) => current.map((item, position) => position === index ? value : item)); setError(''); }} />
          <span aria-hidden="true">{fieldUnit(key)}</span>
        </label>)}
      </div>
      <button type="button" className="secondary-button management-quick-command-reset" aria-label="恢复当前配置" title="恢复当前配置" disabled={sending} onClick={reset}><RotateCcw size={14} aria-hidden="true" /></button>
      <button type="submit" className="primary-button" aria-label={`发送${command.label}`} title={preview} disabled={disabled}>{sending ? '发送中…' : '发送'}</button>
    </div>
    {error && <p id={`${id}-error`} className="management-form-error" role="alert">{error}</p>}
  </form>;
}

function referenceInput(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
}

function fieldUnit(key: Setting) {
  return key === 'exp_max' ? '分钟' : key === 'domain_times' ? '次' : '倍';
}
