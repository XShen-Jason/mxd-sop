export type Role = 'customer' | 'manager' | 'super_admin';
export type GroupStatus = 'pending' | 'approved' | 'rejected' | 'issued' | 'completed' | 'cancelled';
export type OperationType = 'item' | 'cash' | 'kick' | 'ban' | 'warp';

export interface ServerOption { id: string; displayName: string }
export interface ReasonOption { code: string; displayName: string }
export interface OperationOption { type: OperationType; displayName: string; fields: string[]; allowMultiple: boolean }
export interface AppOptions { servers: ServerOption[]; reasons: ReasonOption[]; actionReasons?: { kick: ReasonOption[]; ban: ReasonOption[] }; operations: OperationOption[]; commandRuleVersion: string }
export interface CatalogItem { code: string; name: string; itemClass?: string; image?: string }

export interface ItemOperation { type: 'item'; itemCode: string; itemLevel?: number; itemName: string; itemClass?: string; itemImage?: string; quantity: number }
export interface CashOperation { type: 'cash'; quantity: number }
export interface WarpOperation { type: 'warp' }
export interface KickOperation { type: 'kick' }
export interface BanOperation { type: 'ban' }
export type Operation = ItemOperation | CashOperation | KickOperation | WarpOperation | BanOperation;

export interface GroupReason { code: string; text?: string }
export interface Group {
  id: string;
  server: ServerOption;
  account?: string;
  characterId: string;
  playerQQ?: string;
  reason: GroupReason;
  operations: Operation[];
  status: GroupStatus;
  submittedAt: string;
  submittedBy: { id: string; displayName: string };
  completedAt?: string;
  completedBy?: { id: string; displayName: string };
  approvedAt?: string;
  approvedBy?: { id: string; displayName: string };
  rejectedAt?: string;
  rejectedBy?: { id: string; displayName: string };
  rejectionReason?: string;
  issuedAt?: string;
  issuedBy?: { id: string; displayName: string };
  cancelledAt?: string;
  cancelledBy?: { id: string; displayName: string };
  updatedAt?: string;
  updatedBy?: { id: string; displayName: string };
  executionNote?: string;
}
export interface GeneratedCommand { operationIndex: number; sequence: number; text: string }
export interface ManagerGroup extends Group { commands: GeneratedCommand[]; commandRuleVersion: string }
export interface Page<T> { groups: T[]; nextCursor: string | null }
export interface User { id: string; username: string; displayName: string; role: Role; active: boolean; createdAt: string; createdBy?: { id: string; displayName: string } }
export interface Session { token?: string; expiresAt: string; user: User }
