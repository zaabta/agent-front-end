import {describe,expect,it} from 'vitest'
import {canViewWorkerMonitoring} from './authorization'

describe('admin route authorization',()=>{
 it('allows only backend admin roles to view worker monitoring',()=>{expect(canViewWorkerMonitoring('TENANT_ADMIN')).toBe(true);expect(canViewWorkerMonitoring('SUPER_ADMIN')).toBe(true);expect(canViewWorkerMonitoring('MEMBER')).toBe(false);expect(canViewWorkerMonitoring('READ_ONLY')).toBe(false);expect(canViewWorkerMonitoring(null)).toBe(false)})
})
