import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { api, ApiError } from '../../lib/api/client'
import type { AssignableTenantRole, TenantMember } from '../../lib/api/schemas'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canViewWorkerMonitoring } from '../../lib/auth/authorization'

const roles: { value: AssignableTenantRole; label: string }[] = [
  { value: 'TENANT_ADMIN', label: 'Tenant admin' },
  { value: 'MEMBER', label: 'Member' },
  { value: 'READ_ONLY', label: 'Read only' },
]

function messageFor(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request failed. Please try again.'
}

export function UserManagement() {
  const auth = useAuth()
  const allowed = canViewWorkerMonitoring(auth.session?.identity.role)
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableTenantRole>('MEMBER')
  const [formError, setFormError] = useState('')
  const [roleError, setRoleError] = useState('')
  const members = useQuery({ queryKey: ['tenant-members'], queryFn: ({ signal }) => api.tenantMembers(signal), enabled: allowed, retry: 1 })
  const addMember = useMutation({
    mutationFn: () => api.addTenantMember(email, role),
    onSuccess: async () => { setEmail(''); setRole('MEMBER'); setFormError(''); await queryClient.invalidateQueries({ queryKey: ['tenant-members'] }) },
    onError: error => setFormError(messageFor(error)),
  })
  const updateRole = useMutation({
    mutationFn: ({ userId, role: nextRole }: { userId: string; role: AssignableTenantRole }) => api.changeTenantMemberRole(userId, nextRole),
    onSuccess: async () => { setRoleError(''); await queryClient.invalidateQueries({ queryKey: ['tenant-members'] }) },
    onError: error => setRoleError(messageFor(error)),
  })
  function submit(event: FormEvent) { event.preventDefault(); setFormError(''); addMember.mutate() }

  if (!allowed) return <section className="panel user-access-denied"><ShieldCheck size={22}/><h2>Administrator access required</h2><p>Only tenant administrators and super administrators can manage workspace members.</p></section>

  const rows: TenantMember[] = members.data ?? []
  return <>
    <div className="page-intro"><div><div className="eyebrow">WORKSPACE ADMINISTRATION</div><h1>User management</h1><p>Add existing accounts to this workspace and manage their access level.</p></div></div>
    <section className="panel user-add-panel">
      <div className="panel-heading"><div><h3><Plus size={17}/> Add a user</h3><p>The person must already have a SitePilot account.</p></div></div>
      <form className="user-add-form" onSubmit={submit}>
        <label className="user-field"><span>Email address</span><input type="email" required maxLength={254} autoComplete="email" placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)}/></label>
        <label className="user-field"><span>Workspace role</span><select value={role} onChange={event => setRole(event.target.value as AssignableTenantRole)}>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <button className="button primary" type="submit" disabled={addMember.isPending}>{addMember.isPending ? <><LoaderCircle className="spin" size={15}/> Adding…</> : <><Plus size={15}/> Add user</>}</button>
      </form>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <p className="user-management-note">Password changes are handled by the account owner; this workspace API does not provide password management.</p>
    </section>

    <section className="panel user-members-panel">
      <div className="panel-heading"><div><h3><Users size={17}/> Workspace members</h3><p>{members.isSuccess ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'} with workspace access` : 'Members and their current access'}</p></div><button className="icon-button" aria-label="Refresh members" onClick={() => void members.refetch()} disabled={members.isFetching}><RefreshCw size={15} className={members.isFetching ? 'spin' : ''}/></button></div>
      {roleError && <p className="form-error" role="alert">{roleError}</p>}
      {members.isPending ? <div className="user-state"><LoaderCircle className="spin" size={18}/> Loading workspace members…</div>
        : members.isError ? <div className="user-state user-state-error"><p>{messageFor(members.error)}</p><button className="button secondary" onClick={() => void members.refetch()}>Try again</button></div>
        : rows.length === 0 ? <div className="user-state"><Users size={21}/><b>No members yet</b><span>Add an existing account to give it workspace access.</span></div>
        : <div className="user-member-list">{rows.map(member => <MemberRow key={member.user.id} member={member} saving={updateRole.isPending && updateRole.variables?.userId === member.user.id} onRoleChange={nextRole => { setRoleError(''); updateRole.mutate({ userId: member.user.id, role: nextRole }) }}/>)}</div>}
    </section>
  </>
}

function MemberRow({ member, saving, onRoleChange }: { member: TenantMember; saving: boolean; onRoleChange: (role: AssignableTenantRole) => void }) {
  const currentRole = member.role
  const roleLabel = roles.find(item => item.value === currentRole)?.label ?? 'Super admin'
  const identity = member.user.displayName || member.user.emailDisplay || member.user.email || 'Workspace member'
  return <article className="user-member-row"><span className="user-member-avatar">{identity.slice(0, 1).toUpperCase()}</span><span className="user-member-identity"><b>{identity}</b><small>{member.user.emailDisplay || member.user.email || 'Email hidden'}</small></span><span className="user-member-status">{member.user.disabledAt ? 'Account disabled' : 'Active'}</span><label className="user-role-control"><span className="sr-only">Role for {identity}</span><select aria-label={`Role for ${identity}`} value={currentRole} disabled={saving || currentRole === 'SUPER_ADMIN'} onChange={event => onRoleChange(event.target.value as AssignableTenantRole)}>{currentRole === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">Super admin</option>}{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{saving ? <LoaderCircle className="spin" size={14}/> : currentRole !== 'SUPER_ADMIN' && <Check size={14}/>}<span className="sr-only">{roleLabel}</span></label></article>
}
