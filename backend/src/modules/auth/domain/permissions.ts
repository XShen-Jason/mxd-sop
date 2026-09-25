import type {
  Identity,
  Role,
  UploadPermissionId,
  UploadPermissions,
  WorkspaceId,
  WorkspacePermissions,
} from '../../../shared/types.js';

export const WORKSPACES = ['request', 'records', 'reminders', 'queue', 'ready', 'reissue', 'archive', 'activities', 'player-directory', 'team-view', 'accounts', 'server-operations', 'potential-editor'] as const satisfies readonly WorkspaceId[];
export const UPLOAD_PERMISSIONS = ['player-directory', 'team-view', 'item-catalog'] as const satisfies readonly UploadPermissionId[];

const ROLE_DEFAULT_WORKSPACES: Record<Role, readonly WorkspaceId[]> = {
  customer: ['request', 'records', 'reminders', 'player-directory', 'team-view'],
  manager: ['request', 'records', 'reminders', 'queue', 'reissue', 'archive', 'activities', 'player-directory', 'team-view', 'accounts'],
  super_admin: WORKSPACES,
};
const ROLE_DEFAULT_UPLOADS: Record<Role, readonly UploadPermissionId[]> = {
  customer: ['player-directory', 'team-view'],
  manager: UPLOAD_PERMISSIONS,
  super_admin: UPLOAD_PERMISSIONS,
};

export function defaultWorkspacePermissions(role: Role): WorkspacePermissions {
  const enabled = new Set(ROLE_DEFAULT_WORKSPACES[role]);
  return Object.fromEntries(WORKSPACES.map((workspace) => [workspace, enabled.has(workspace)])) as WorkspacePermissions;
}

export function effectiveWorkspacePermissions(role: Role, value?: Partial<WorkspacePermissions>) {
  const next = defaultWorkspacePermissions(role);
  for (const workspace of WORKSPACES) if (typeof value?.[workspace] === 'boolean') next[workspace] = value[workspace] as boolean;
  return next;
}

export function hasWorkspaceAccess(identity: Identity, workspace: WorkspaceId) {
  return identity.workspacePermissions?.[workspace] ?? defaultWorkspacePermissions(identity.role)[workspace];
}

export function defaultUploadPermissions(role: Role): UploadPermissions {
  const enabled = new Set(ROLE_DEFAULT_UPLOADS[role]);
  return Object.fromEntries(UPLOAD_PERMISSIONS.map((permission) => [permission, enabled.has(permission)])) as UploadPermissions;
}

export function effectiveUploadPermissions(role: Role, value?: Partial<UploadPermissions>) {
  const next = defaultUploadPermissions(role);
  for (const permission of UPLOAD_PERMISSIONS) if (typeof value?.[permission] === 'boolean') next[permission] = value[permission] as boolean;
  return next;
}

export function hasUploadAccess(identity: Identity, permission: UploadPermissionId) {
  return identity.uploadPermissions?.[permission] ?? defaultUploadPermissions(identity.role)[permission];
}
