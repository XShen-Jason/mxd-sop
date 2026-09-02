import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ text, label = '复制指令', copied: persistedCopied = false, onCopied, showCopiedState = true }: { text: string; label?: string; copied?: boolean; onCopied?: () => void; showCopiedState?: boolean }) {
  const [localCopied, setLocalCopied] = useState(false);
  const isCopied = showCopiedState && (persistedCopied || localCopied);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLocalCopied(true);
      onCopied?.();
      window.setTimeout(() => setLocalCopied(false), 1400);
    } catch {
      setLocalCopied(false);
    }
  };
  return <button type="button" className="icon-button copy-button" title={label} aria-label={`${label}: ${text}`} onClick={copy}>
    {isCopied ? <Check size={15} /> : <Copy size={15} />}
  </button>;
}
