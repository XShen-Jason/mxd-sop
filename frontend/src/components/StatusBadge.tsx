import { Check, Clock3, PackageCheck, X, XCircle } from 'lucide-react';
import type { GroupStatus } from '../types';

const labels: Record<GroupStatus, string> = { pending: '\u5f85\u5ba1\u6838', approved: '\u5f85\u5b8c\u6210', rejected: '\u5df2\u9a73\u56de', issued: '\u5df2\u5b8c\u6210', completed: '\u5df2\u5b8c\u6210', cancelled: '\u5df2\u53d6\u6d88' };

export function StatusBadge({ status }: { status: GroupStatus }) {
  const Icon = status === 'pending' ? Clock3 : status === 'approved' ? PackageCheck : status === 'issued' || status === 'completed' ? Check : status === 'rejected' ? XCircle : X;
  return <span className={`status-badge status-${status}`}><Icon size={13} strokeWidth={2.5} />{labels[status]}</span>;
}

export function statusLabel(status: GroupStatus) { return labels[status]; }
