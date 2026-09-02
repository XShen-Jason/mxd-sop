export type Role = 'customer' | 'manager' | 'super_admin';
export type GroupStatus = 'pending' | 'approved' | 'rejected' | 'issued' | 'completed' | 'cancelled';
export type OperationType = 'item' | 'cash' | 'kick' | 'ban' | 'warp';

export interface Identity {
  id: string;
  role: Role;
  displayName: string;
}

export interface UserSummary extends Identity {
  username: string;
  active: boolean;
  createdAt: string;
  createdBy?: { id: string; displayName: string };
}

export interface ServerOption {
  id: string;
  displayName: string;
}

export interface ReasonOption {
  code: string;
  displayName: string;
}

export interface OperationOption {
  type: OperationType;
  displayName: string;
  fields: string[];
  allowMultiple: boolean;
}

export interface AppOptions {
  servers: ServerOption[];
  reasons: ReasonOption[];
  actionReasons?: {
    kick: ReasonOption[];
    ban: ReasonOption[];
  };
  operations: OperationOption[];
  commandRuleVersion: string;
}

export interface ItemOperation {
  type: 'item';
  itemCode: string;
  /** Equipment level after normalization. Level 1 is represented without a code suffix. */
  itemLevel?: number;
  itemName: string;
  itemClass?: string;
  itemImage?: string;
  quantity: number;
}

export interface CashOperation {
  type: 'cash';
  quantity: number;
}

export interface WarpOperation {
  type: 'warp';
}

export interface KickOperation {
  type: 'kick';
}

export interface BanOperation {
  type: 'ban';
}

export type Operation = ItemOperation | CashOperation | KickOperation | WarpOperation | BanOperation;

export interface GroupReason {
  code: string;
  text?: string;
}

export interface OperationGroup {
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
  commandRuleVersion: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
}

export interface SubmitGroupInput {
  serverId: string;
  account?: string;
  characterId: string;
  playerQQ?: string;
  reason: GroupReason;
  operations: Array<Record<string, unknown>>;
}

export interface GeneratedCommand {
  operationIndex: number;
  sequence: number;
  text: string;
}

export interface CustomerGroupProjection {
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

export interface ManagerGroupProjection extends CustomerGroupProjection {
  commands: GeneratedCommand[];
  commandRuleVersion: string;
}
