import type { Role, UploadPermissionId, UploadPermissions, User, WorkspaceId, WorkspacePermissions } from './types';

export const WORKSPACES: readonly WorkspaceId[] = ['request', 'records', 'reminders', 'queue', 'ready', 'reissue', 'archive', 'activities', 'player-directory', 'team-view', 'accounts', 'server-operations', 'potential-editor'];
export const VISIBLE_WORKSPACES: readonly WorkspaceId[] = WORKSPACES;
export const UPLOAD_PERMISSIONS: readonly UploadPermissionId[] = ['player-directory', 'team-view', 'item-catalog'];
export const uploadPermissionDefinitions: Record<UploadPermissionId, { label: string; description: string }> = {
  'player-directory': { label: '玩家目录上传', description: '替换服务器玩家账号 CSV' },
  'team-view': { label: '通关列表上传', description: '导入队伍通关记录 CSV' },
  'item-catalog': { label: '道具目录上传', description: '替换道具目录 CSV' },
};

export const workspaceDefinitions: Record<WorkspaceId, { label: string; description: string }> = {
  request: { label: '申请操作', description: '提交物资和常规操作申请' },
  records: { label: '我的申请', description: '查看本人提交的申请' },
  reminders: { label: '待提醒', description: '查看待提醒的本人申请' },
  queue: { label: '待审核', description: '审核物资申请' },
  ready: { label: '待完成', description: '处理已通过的申请' },
  reissue: { label: '物资发放记录', description: '查看全部物资发放记录' },
  archive: { label: '常规操作记录', description: '查看全部常规操作记录' },
  activities: { label: '活动与道具', description: '维护活动奖励配置' },
  'player-directory': { label: '玩家列表', description: '查询玩家账号信息' },
  'team-view': { label: '所有队伍', description: '查看每日队伍名单' },
  accounts: { label: '账号管理', description: '维护客服和管理账号' },
  'server-operations': { label: '服务器管理', description: '管理服务连接和游戏服务器' },
  'potential-editor': { label: '潜能工作区', description: '登录临时账号并修改装备潜能' }
};

const roleDefaults: Record<Role, readonly WorkspaceId[]> = {
  customer: ['request', 'records', 'reminders', 'player-directory', 'team-view'],
  manager: ['request', 'records', 'reminders', 'queue', 'reissue', 'archive', 'activities', 'player-directory', 'team-view', 'accounts'],
  super_admin: WORKSPACES,
};

export function defaultWorkspacePermissions(role: Role): WorkspacePermissions {
  const enabled = new Set(roleDefaults[role]);
  return Object.fromEntries(WORKSPACES.map((workspace) => [workspace, enabled.has(workspace)])) as WorkspacePermissions;
}

export function effectiveWorkspacePermissions(role: Role, value?: Partial<WorkspacePermissions>): WorkspacePermissions {
  const next = defaultWorkspacePermissions(role);
  for (const workspace of WORKSPACES) if (typeof value?.[workspace] === 'boolean') next[workspace] = value[workspace] as boolean;
  return next;
}

export function isWorkspaceEnabled(user: Pick<User, 'role' | 'workspacePermissions'>, workspace: WorkspaceId) {
  return effectiveWorkspacePermissions(user.role, user.workspacePermissions)[workspace];
}

const uploadRoleDefaults: Record<Role, readonly UploadPermissionId[]> = { customer: ['player-directory', 'team-view'], manager: UPLOAD_PERMISSIONS, super_admin: UPLOAD_PERMISSIONS };
export function defaultUploadPermissions(role: Role): UploadPermissions {
  const enabled = new Set(uploadRoleDefaults[role]);
  return Object.fromEntries(UPLOAD_PERMISSIONS.map((permission) => [permission, enabled.has(permission)])) as UploadPermissions;
}
export function effectiveUploadPermissions(role: Role, value?: Partial<UploadPermissions>): UploadPermissions {
  const next = defaultUploadPermissions(role);
  for (const permission of UPLOAD_PERMISSIONS) if (typeof value?.[permission] === 'boolean') next[permission] = value[permission] as boolean;
  return next;
}
export function isUploadEnabled(user: Pick<User, 'role' | 'uploadPermissions'>, permission: UploadPermissionId) {
  return effectiveUploadPermissions(user.role, user.uploadPermissions)[permission];
}
