import { Shield, Zap } from 'lucide-react';
import type { BossType } from '../api/types';

export const BOSSES: Array<{ id: BossType; name: string; icon: typeof Shield; color: string }> = [
  { id: 'black-dragon', name: '黑龙', icon: Shield, color: 'violet' },
  { id: 'zakum', name: '扎昆', icon: Zap, color: 'orange' },
];

export const bossName = (boss: BossType) => boss === 'black-dragon' ? '黑龙' : '扎昆';
