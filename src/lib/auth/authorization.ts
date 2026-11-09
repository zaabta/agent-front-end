import type { TenantRole } from './session'

export function canViewWorkerMonitoring(role:TenantRole|undefined|null){return role==='SUPER_ADMIN'||role==='TENANT_ADMIN'}
