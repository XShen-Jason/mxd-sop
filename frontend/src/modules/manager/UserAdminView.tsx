import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LoaderCircle, Pencil, Plus, RotateCcw, Shield, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import { UPLOAD_PERMISSIONS, VISIBLE_WORKSPACES, WORKSPACES, defaultUploadPermissions, defaultWorkspacePermissions, effectiveUploadPermissions, effectiveWorkspacePermissions, uploadPermissionDefinitions, workspaceDefinitions } from '../../permissions';
import type { Role, UploadPermissionId, UploadPermissions, User, WorkspaceId, WorkspacePermissions } from '../../types';

const roleName: Record<Role, string> = { customer: '客服', manager: '管理', super_admin: '超级管理' };
type AccountForm = { role: Role; displayName: string; username: string; password: string; workspacePermissions: WorkspacePermissions; uploadPermissions: UploadPermissions };
const emptyForm = (role: Role = 'customer'): AccountForm => ({ role, displayName: '', username: '', password: '', workspacePermissions: defaultWorkspacePermissions(role), uploadPermissions: defaultUploadPermissions(role) });

export function UserAdminView({ token, actorId, onRequireRelogin, onUserUpdated }: { token?: string; actorId?: string; onRequireRelogin?: () => void; onUserUpdated?: (user: User) => void }) {
  const client = useMemo(() => new ApiClient(actorId ?? 'anonymous', token), [actorId, token]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<AccountForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const load = async () => { setLoading(true); try { setUsers((await client.users()).users); } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '无法加载账号' }); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [client]);

  const openCreate = () => { setEditingUser(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (user: User) => { setEditingUser(user); setForm({ role: user.role, displayName: user.displayName, username: user.username, password: '', workspacePermissions: effectiveWorkspacePermissions(user.role, user.workspacePermissions), uploadPermissions: effectiveUploadPermissions(user.role, user.uploadPermissions) }); setDialogOpen(true); };
  const closeForm = () => { setEditingUser(null); setForm(emptyForm()); setDialogOpen(false); };
  const changeRole = (role: Role) => setForm((current) => {
    const customWorkspaces = WORKSPACES.some((id) => current.workspacePermissions[id] !== defaultWorkspacePermissions(current.role)[id]);
    const customUploads = UPLOAD_PERMISSIONS.some((id) => current.uploadPermissions[id] !== defaultUploadPermissions(current.role)[id]);
    return { ...current, role, workspacePermissions: customWorkspaces ? current.workspacePermissions : defaultWorkspacePermissions(role), uploadPermissions: customUploads ? current.uploadPermissions : defaultUploadPermissions(role) };
  });

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      if (editingUser) {
        const input: Parameters<ApiClient['updateUser']>[1] = { displayName: form.displayName, role: form.role, workspacePermissions: form.workspacePermissions, uploadPermissions: form.uploadPermissions };
        if (form.password) input.password = form.password;
        const next = await client.updateUser(editingUser.id, input);
        setUsers((current) => current.map((item) => item.id === next.id ? next : item));
        onUserUpdated?.(next);
        if (editingUser.id === actorId && (Boolean(form.password) || form.role !== editingUser.role || !next.active)) onRequireRelogin?.();
        else setNotice({ kind: 'success', text: '账号已更新' });
      } else {
        await client.createUser({ username: form.username, displayName: form.displayName, password: form.password, role: form.role, workspacePermissions: form.workspacePermissions, uploadPermissions: form.uploadPermissions });
        setNotice({ kind: 'success', text: '账号已创建' }); await load();
      }
      closeForm();
    } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : editingUser ? '更新失败' : '创建失败' }); }
    finally { setSaving(false); }
  };
  const toggle = async (user: User) => { try { const next = await client.updateUser(user.id, { active: !user.active }); setUsers((current) => current.map((item) => item.id === next.id ? next : item)); } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '更新失败' }); } };
  const confirmRemove = async () => { if (!deleteTarget) return; setDeleteSaving(true); try { await client.deleteUser(deleteTarget.id); setUsers((current) => current.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null); setNotice({ kind: 'success', text: '账号已删除，历史申请记录仍会保留' }); } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '删除失败' }); } finally { setDeleteSaving(false); } };
  const groupedUsers = (['super_admin', 'manager', 'customer'] as Role[]).map((role) => ({ role, users: users.filter((user) => user.role === role) })).filter((group) => group.users.length);

  return <section className="users-panel"><div className="users-toolbar"><div><p className="eyebrow">账号权限</p><p className="heading-copy">工作区权限与上传权限可以分别设置</p></div><button type="button" className="primary-button" onClick={openCreate}><Plus size={17} />添加账号</button></div>
    {notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /></div> : <div className={`user-role-groups role-count-${groupedUsers.length}`}>{groupedUsers.map((group) => <section className="user-role-group" key={group.role}><div className="user-role-heading"><h3>{roleName[group.role]}</h3><span>{group.users.length} 个账号</span></div><div className="user-list">{group.users.map((user) => <article className={`user-row ${user.active ? '' : 'inactive'}`} key={user.id}><div className="user-avatar"><Shield size={17} /></div><div className="user-main"><strong>{user.displayName}</strong><span>{user.username}</span><span className="permission-count">{Object.values(user.workspacePermissions).filter(Boolean).length} 个工作区</span></div><span className={`role-pill role-${user.role}`}>{roleName[user.role]}</span><span className={user.active ? 'active-label' : 'inactive-label'}>{user.active ? '启用' : '停用'}</span><div className="user-actions"><button type="button" className="icon-button" title="编辑账号" aria-label={`编辑 ${user.username}`} onClick={() => openEdit(user)}><Pencil size={16} /></button><button type="button" className="icon-button" title={user.active ? '停用账号' : '启用账号'} onClick={() => void toggle(user)}>{user.active ? <UserCheck size={16} /> : <UserX size={16} />}</button>{user.id !== actorId && <button type="button" className="icon-button danger-button" title="删除账号" onClick={() => setDeleteTarget(user)}><Trash2 size={16} /></button>}</div></article>)}</div></section>)}</div>}
    {dialogOpen && <AccountDialog editingUser={editingUser} form={form} setForm={setForm} onRoleChange={changeRole} saving={saving} onClose={closeForm} onSubmit={save} />}
    {deleteTarget && <ConfirmDialog title={`确认删除账号“${deleteTarget.username}”？`} description="删除只会移除登录账号，历史申请记录和审计信息会保留。此操作不可恢复。" confirmLabel="删除账号" danger busy={deleteSaving} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmRemove()} />}
  </section>;
}

type AccountDialogTab = 'basic' | 'workspaces' | 'uploads';
function AccountDialog({ editingUser, form, setForm, onRoleChange, saving, onClose, onSubmit }: { editingUser: User | null; form: AccountForm; setForm: (value: AccountForm | ((current: AccountForm) => AccountForm)) => void; onRoleChange: (role: Role) => void; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const [activeTab, setActiveTab] = useState<AccountDialogTab>('basic');
  const toggleWorkspace = (id: WorkspaceId, enabled: boolean) => setForm((current) => ({ ...current, workspacePermissions: { ...current.workspacePermissions, [id]: enabled } }));
  const toggleUpload = (id: UploadPermissionId, enabled: boolean) => setForm((current) => ({ ...current, uploadPermissions: { ...current.uploadPermissions, [id]: enabled } }));
  const permissionPanel = (kind: 'workspaces' | 'uploads') => <fieldset className="permission-fieldset"><div className="permission-heading"><div><legend>{kind === 'workspaces' ? '可见工作区' : '上传权限'}</legend><p>{kind === 'workspaces' ? '选择这个账号可以进入的工作区。' : '单独选择这个账号可以使用的文件上传功能。'}</p></div><button type="button" className="text-button permission-reset" onClick={() => setForm((current) => kind === 'workspaces' ? { ...current, workspacePermissions: defaultWorkspacePermissions(current.role) } : { ...current, uploadPermissions: defaultUploadPermissions(current.role) })}><RotateCcw size={14} />恢复默认</button></div><div className="permission-grid">{kind === 'workspaces' ? VISIBLE_WORKSPACES.map((id) => <PermissionOption key={id} checked={form.workspacePermissions[id]} label={workspaceDefinitions[id].label} description={workspaceDefinitions[id].description} onChange={(enabled) => toggleWorkspace(id, enabled)} />) : UPLOAD_PERMISSIONS.map((id) => <PermissionOption key={id} checked={form.uploadPermissions[id]} label={uploadPermissionDefinitions[id].label} description={uploadPermissionDefinitions[id].description} onChange={(enabled) => toggleUpload(id, enabled)} />)}</div></fieldset>;
  return <div className="dialog-backdrop" role="presentation"><div className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="dialog-header"><div><p className="eyebrow">账号权限</p><h2 id="account-dialog-title">{editingUser ? '编辑账号' : '添加账号'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div><div className="account-dialog-tabs" role="tablist"><button type="button" className={activeTab === 'basic' ? 'account-dialog-tab active' : 'account-dialog-tab'} onClick={() => setActiveTab('basic')}>基础设置</button><button type="button" className={activeTab === 'workspaces' ? 'account-dialog-tab active' : 'account-dialog-tab'} onClick={() => setActiveTab('workspaces')}>可见工作区</button><button type="button" className={activeTab === 'uploads' ? 'account-dialog-tab active' : 'account-dialog-tab'} onClick={() => setActiveTab('uploads')}>上传权限</button></div><form onSubmit={onSubmit}><div className="account-dialog-content">{activeTab === 'basic' ? <section className="account-dialog-panel"><div className="role-options">{(['customer', 'manager', 'super_admin'] as Role[]).map((role) => <button type="button" key={role} className={form.role === role ? 'role-option selected' : 'role-option'} onClick={() => onRoleChange(role)}>{roleName[role]}</button>)}</div><div className="dialog-fields"><label><span>昵称</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label><span>账号</span><input required readOnly={Boolean(editingUser)} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label><span>{editingUser ? '新密码（可选）' : '初始密码'}</span><input required={!editingUser} minLength={6} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label></div></section> : permissionPanel(activeTab)}</div><div className="user-form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button submit-button" disabled={saving}>{saving ? '保存中…' : editingUser ? '保存修改' : '创建账号'}<UserCheck size={16} /></button></div></form></div></div>;
}
function PermissionOption({ checked, label, description, onChange }: { checked: boolean; label: string; description: string; onChange: (enabled: boolean) => void }) { return <label className="permission-option"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{description}</small></span></label>; }
