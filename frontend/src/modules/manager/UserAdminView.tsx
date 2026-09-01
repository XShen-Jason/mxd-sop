import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LoaderCircle, Pencil, Plus, Shield, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { Role, User } from '../../types';

const roleName: Record<Role, string> = { customer: '普通客服', manager: '管理', super_admin: '超级管理' };
type AccountForm = { role: Role; displayName: string; username: string; password: string };
const emptyForm = (): AccountForm => ({ role: 'customer', displayName: '', username: '', password: '' });

export function UserAdminView({ token, actorRole, actorId, onRequireRelogin }: { token?: string; actorRole: Role; actorId?: string; onRequireRelogin?: () => void }) {
  const client = useMemo(() => new ApiClient(actorRole, token), [actorRole, token]);
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
  const allowedRoles: Role[] = actorRole === 'super_admin' ? ['customer', 'manager', 'super_admin'] : ['customer', 'manager'];

  const openCreate = () => { setEditingUser(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (user: User) => { setEditingUser(user); setForm({ role: user.role, displayName: user.displayName, username: user.username, password: '' }); setDialogOpen(true); };
  const closeForm = () => { setEditingUser(null); setForm(emptyForm()); setDialogOpen(false); };

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      if (editingUser) {
        const input: Partial<{ displayName: string; role: Role; password: string }> = { displayName: form.displayName, role: form.role };
        if (form.password) input.password = form.password;
        const next = await client.updateUser(editingUser.id, input);
        setUsers((current) => current.map((item) => item.id === next.id ? next : item));
        if (editingUser.id === actorId && (Boolean(form.password) || form.role !== editingUser.role)) onRequireRelogin?.();
        else setNotice({ kind: 'success', text: '账号已更新' });
      } else {
        await client.createUser({ username: form.username, displayName: form.displayName, password: form.password, role: form.role });
        setNotice({ kind: 'success', text: '账号已创建' });
        await load();
      }
      closeForm();
    }
    catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : editingUser ? '更新失败' : '创建失败' }); }
    finally { setSaving(false); }
  };

  const toggle = async (user: User) => { try { const next = await client.updateUser(user.id, { active: !user.active }); setUsers((current) => current.map((item) => item.id === next.id ? next : item)); } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '更新失败' }); } };
  const remove = (user: User) => setDeleteTarget(user);
  const confirmRemove = async () => { if (!deleteTarget) return; setDeleteSaving(true); try { await client.deleteUser(deleteTarget.id); setUsers((current) => current.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null); setNotice({ kind: 'success', text: '账号已删除，历史申请记录仍会保留' }); } catch (error) { setNotice({ kind: 'error', text: error instanceof ApiError ? error.message : '删除失败' }); } finally { setDeleteSaving(false); } };
  const canManage = (user: User) => actorRole === 'super_admin' || user.role !== 'super_admin';
  const groupedUsers = (['super_admin', 'manager', 'customer'] as Role[]).map((role) => ({ role, users: users.filter((user) => user.role === role) })).filter((group) => group.users.length > 0);

  return <section className="users-panel"><div className="users-toolbar"><div><p className="eyebrow">账号权限</p><p className="heading-copy">可添加管理和客服，密码在编辑账号时修改</p></div><div className="toolbar-actions"><button type="button" className="primary-button" onClick={openCreate}><Plus size={17} />添加账号</button></div></div>
    {notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /></div> : <div className={`user-role-groups role-count-${groupedUsers.length} role-columns-${actorRole === 'super_admin' ? 3 : 2}`}>{groupedUsers.map((group) => <section className="user-role-group" key={group.role}><div className="user-role-heading"><h3>{roleName[group.role]}</h3><span>{group.users.length} 个账号</span></div><div className="user-list">{group.users.map((user) => <article className={`user-row ${user.active ? '' : 'inactive'}`} key={user.id}><div className="user-avatar"><Shield size={17} /></div><div className="user-main"><strong>{user.displayName}</strong><span>{user.username}</span></div><span className={`role-pill role-${user.role}`}>{roleName[user.role]}</span><span className={user.active ? 'active-label' : 'inactive-label'}>{user.active ? '启用' : '停用'}</span>{canManage(user) && <div className="user-actions"><button type="button" className="icon-button" title="编辑账号" aria-label={`编辑 ${user.username}`} onClick={() => openEdit(user)}><Pencil size={16} /></button><button type="button" className="icon-button" title={user.active ? '停用账号' : '启用账号'} aria-label={user.active ? `停用 ${user.username}` : `启用 ${user.username}`} onClick={() => void toggle(user)}>{user.active ? <UserX size={16} /> : <UserCheck size={16} />}</button>{user.id !== actorId && <button type="button" className="icon-button danger-button" title="删除账号" aria-label={`删除 ${user.username}`} onClick={() => void remove(user)}><Trash2 size={16} /></button>}</div>}</article>)}</div></section>)}</div>}
    {dialogOpen ? <AccountDialog editingUser={editingUser} form={form} setForm={setForm} allowedRoles={allowedRoles} saving={saving} onClose={closeForm} onSubmit={save} /> : null}
    {deleteTarget && <ConfirmDialog title={`确认删除账号“${deleteTarget.username}”？`} description="删除只会移除登录账号，历史申请记录和审计信息会保留。此操作不可恢复。" confirmLabel="删除账号" danger busy={deleteSaving} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmRemove()} />}
  </section>;
}

function AccountDialog({ editingUser, form, setForm, allowedRoles, saving, onClose, onSubmit }: { editingUser: User | null; form: AccountForm; setForm: (value: AccountForm) => void; allowedRoles: Role[]; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const creating = !editingUser;
  return <div className="dialog-backdrop" role="presentation"><div className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="dialog-header"><div><p className="eyebrow">账号权限</p><h2 id="account-dialog-title">{creating ? '添加账号' : '编辑账号'}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div><form onSubmit={onSubmit}><div className="role-options" role="radiogroup" aria-label="权限角色">{allowedRoles.map((role) => <button type="button" key={role} className={form.role === role ? 'role-option selected' : 'role-option'} onClick={() => setForm({ ...form, role })} aria-pressed={form.role === role}>{roleName[role]}</button>)}</div><div className="dialog-fields"><label><span>昵称</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label><span>账号</span><input required readOnly={!creating} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label><span>{creating ? '初始密码' : '新密码（可选）'}</span><input {...(creating ? { required: true, minLength: 6 } : { minLength: 6 })} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label></div><div className="user-form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button submit-button" disabled={saving}>{saving ? '保存中…' : creating ? '创建账号' : '保存修改'}<UserCheck size={16} /></button></div></form></div></div>;
}
