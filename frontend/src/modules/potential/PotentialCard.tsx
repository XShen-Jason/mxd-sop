import { useEffect, useState } from 'react';
import { LoaderCircle, Package, RotateCcw, Save } from 'lucide-react';
import type { PotentialEquipment, PotentialOption } from '../../types';
import { PotentialSlot } from './PotentialSlot';
import { equipmentSlots, hasSlotGap, optionKey, optionLabel, replaceSlot, slotPayload } from './potential-options';

interface Props {
  item: PotentialEquipment;
  options: PotentialOption[];
  disabled: boolean;
  saving: boolean;
  onSave: (item: PotentialEquipment, values: ReturnType<typeof slotPayload>) => void;
}

export function PotentialCard({ item, options, disabled, saving, onSave }: Props) {
  const [values, setValues] = useState(() => equipmentSlots(item));
  const [brokenImage, setBrokenImage] = useState(false);
  const saved = equipmentSlots(item);
  const signature = JSON.stringify(saved);
  useEffect(() => { setValues(JSON.parse(signature) as string[]); }, [signature]);
  const changed = JSON.stringify(values) !== signature;
  const gap = hasSlotGap(values);
  const unknown = values.some((value) => value && !options.some((option) => optionKey(option) === value));
  const count = values.filter(Boolean).length;
  return <article className={`potential-card ${changed ? 'is-dirty' : ''}`}>
    <header className="potential-card-heading">
      <div className="potential-item-image">{item.image && !brokenImage
        ? <img src={item.image} alt="" onError={() => setBrokenImage(true)} />
        : <Package size={26} aria-hidden="true" />}</div>
      <div><h3>{item.name || `装备 ${item.templateId}`}</h3>
        <p>实例 <code>{item.instanceId}</code></p><p>模板 <code>{item.templateId}</code></p>
      </div>
      <span className={`potential-count ${item.potentials.length ? '' : 'is-empty'}`}>
        {item.potentials.length ? `${item.potentials.length} 个潜能` : '无潜能'}
      </span>
    </header>
    <div className="potential-comparison">
      <div className="potential-comparison-head"><span>已保存 <small>只读</small></span><span>编辑潜能 <small>可搜索</small></span></div>
      {values.map((value, index) => {
        const modified = value !== saved[index];
        const original = item.potentials.find((entry) => entry.slot === index + 1);
        const option = options.find((entry) => optionKey(entry) === saved[index]);
        const label = original ? option ? optionLabel(option) : `${original.statName} +${original.value} (${original.grade})` : '暂无潜能';
        const changeLabel = modified ? !saved[index] ? '新增' : !value ? '待移除' : '已修改' : undefined;
        return <div key={index} className={`potential-comparison-row ${modified ? 'is-modified' : ''}`}>
          <div className="potential-saved-slot" aria-label={`已保存槽位 ${index + 1}`}>
            <div className="potential-saved-label"><span className="potential-slot-number">{index + 1}</span>潜能槽位</div>
            <div className={`potential-saved-value ${original ? '' : 'is-empty'}`}>{label}</div>
          </div>
          <PotentialSlot index={index} value={value} options={options} disabled={disabled} changeLabel={changeLabel}
            onChange={(next) => setValues((current) => replaceSlot(current, index, next))} />
        </div>;
      })}
    </div>
    <div className="potential-card-note" role={gap || unknown ? 'alert' : undefined}>
      {gap ? '请从第 1 槽连续配置，避免提交后槽位顺序发生变化。'
        : unknown ? '存在未识别属性，请重新选择后再保存。'
        : count ? `将按当前顺序完整提交 ${count} 个潜能。` : '选择第 1 槽的潜能，即可为这件装备添加属性。'}
    </div>
    <footer className="potential-card-actions">
      <span className="potential-change-summary">{changed ? `${values.filter((value, index) => value !== saved[index]).length} 处待保存` : '与已保存一致'}</span>
      <button type="button" className="secondary-button" disabled={disabled || !changed}
        onClick={() => setValues(equipmentSlots(item))}><RotateCcw size={14} />还原</button>
      <button type="button" className="primary-button" disabled={disabled || !changed || gap || unknown || !count}
        onClick={() => onSave(item, slotPayload(values))}>
        {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
        {saving ? '提交中…' : item.potentials.length ? '保存潜能' : '添加潜能'}
      </button>
    </footer>
  </article>;
}
