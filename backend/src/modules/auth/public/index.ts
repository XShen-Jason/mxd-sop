export { AuthError, AuthService } from '../domain/service.js';
export type { AuthErrorCode, CreateUserInput, UpdateUserInput } from '../domain/service.js';
export { defaultUploadPermissions, defaultWorkspacePermissions, hasUploadAccess, hasWorkspaceAccess, UPLOAD_PERMISSIONS, WORKSPACES } from '../domain/permissions.js';
export { JsonUserRepository } from '../infrastructure/json-users.js';
export type { StoredUser, UserRepository } from '../infrastructure/json-users.js';
