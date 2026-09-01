import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ text, label = '复制指令' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return <button type="button" className="icon-button copy-button" title={label} aria-label={`${label}: ${text}`} onClick={copy}>
    {copied ? <Check size={15} /> : <Copy size={15} />}
  </button>;
}
